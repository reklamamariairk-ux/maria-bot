/**
 * Админка игры «Котик Комбат»: метрики, игроки, рассылка пушей, коррекции.
 * Все ручки под requireAdminToken (X-User-Token = ADMIN_TOKEN env) + rateLimit.
 * UI: public/admin/game.html.
 *
 * Рассылка идёт через PushService.sendRaw (роутинг TG/VK/МАКС сам) с паузой
 * 60 мс (~16 msg/s — под лимитом TG 30/s) в фоне; статус пишется в память
 * процесса (одна рассылка за раз) и в clicker_events (admin_push).
 */
import { Router } from "express";
import { pool } from "../db";
import { requireAdminRole, requireAdminToken, rateLimit } from "../middleware";
import { platformOf, toPlatformId } from "../platform";
import { linksOf } from "../account-link";
import { trackEvent } from "../analytics";
import type { PushService } from "../push";
import { log } from "../logger";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function adminCoinsChangeMessage(delta: number, balance: number, reason: string): string {
  const sign = delta > 0 ? "+" : "−";
  const action = delta > 0 ? "начислены" : "списаны";
  return `🔔 Изменение игрового баланса\n\n` +
    `Администратор изменил ваш баланс: ${action} ${sign}${Math.abs(delta).toLocaleString("ru-RU")} монет.\n` +
    `Причина: ${reason}\n` +
    `Текущий баланс: ${Math.max(0, balance).toLocaleString("ru-RU")} монет.`;
}

// Статус текущей/последней рассылки (процесс один — память достаточна)
let pushState: {
  running: boolean; startedAt?: number; total?: number; sent?: number; failed?: number; text?: string;
} = { running: false };

type Segment = "all" | "active7" | "active30" | "tg" | "vk" | "max";

function segmentWhere(seg: Segment): string {
  switch (seg) {
    case "active7":  return `WHERE s.updated_at > NOW() - INTERVAL '7 days'`;
    case "active30": return `WHERE s.updated_at > NOW() - INTERVAL '30 days'`;
    case "tg":  return `WHERE s.chat_id < 2e12`;
    case "vk":  return `WHERE s.chat_id >= 2e12 AND s.chat_id < 4e12`;
    case "max": return `WHERE s.chat_id >= 4e12`;
    default: return "";
  }
}

export default function adminGameRouter(push: PushService): Router {
  const router = Router();

  // ── Метрики ────────────────────────────────────────────────────────────────
  router.get("/api/admin/game/metrics", requireAdminToken, rateLimit(60), async (req, res) => {
    const days = Math.min(90, Math.max(7, Number(req.query.days) || 14));
    try {
      const [totals, daily, events, race, funnel] = await Promise.all([
        pool.query(`SELECT
            (SELECT COUNT(*) FROM clicker_state) AS players,
            (SELECT COUNT(*) FROM clicker_state WHERE updated_at > NOW() - INTERVAL '1 day')  AS dau,
            (SELECT COUNT(*) FROM clicker_state WHERE updated_at > NOW() - INTERVAL '7 days') AS wau,
            (SELECT COUNT(*) FROM clicker_state WHERE chat_id < 2e12) AS tg,
            (SELECT COUNT(*) FROM clicker_state WHERE chat_id >= 2e12 AND chat_id < 4e12) AS vk,
            (SELECT COUNT(*) FROM clicker_state WHERE chat_id >= 4e12) AS max,
            (SELECT COUNT(*) FROM subscribers) AS subscribers,
            (SELECT COUNT(*) FROM subscribers WHERE phone_verified_at IS NOT NULL) AS phones,
            (SELECT COUNT(*) FROM account_links) AS links,
            (SELECT COALESCE(SUM(taps),0) FROM clicker_state) AS taps,
            (SELECT COUNT(*) FROM clicker_redemptions) AS redemptions`),
        pool.query(`WITH firsts AS (
                      SELECT chat_id, MIN(created_at) AS f FROM clicker_events GROUP BY 1
                    )
                    SELECT d.d,
                           COALESCE(a.active, 0) AS active,
                           COALESCE(n.new_players, 0) AS new_players
                      FROM (SELECT to_char(g, 'YYYY-MM-DD') AS d
                              FROM generate_series((NOW() AT TIME ZONE 'Asia/Irkutsk')::date - ($1 - 1),
                                                   (NOW() AT TIME ZONE 'Asia/Irkutsk')::date, '1 day') g) d
                      LEFT JOIN (SELECT to_char(created_at AT TIME ZONE 'Asia/Irkutsk', 'YYYY-MM-DD') AS d,
                                        COUNT(DISTINCT chat_id) AS active
                                   FROM clicker_events
                                  WHERE created_at > NOW() - make_interval(days => $1)
                                  GROUP BY 1) a ON a.d = d.d
                      LEFT JOIN (SELECT to_char(f AT TIME ZONE 'Asia/Irkutsk', 'YYYY-MM-DD') AS d,
                                        COUNT(*) AS new_players
                                   FROM firsts WHERE f > NOW() - make_interval(days => $1)
                                  GROUP BY 1) n ON n.d = d.d
                     ORDER BY d.d`, [days]),
        pool.query(`SELECT event, COUNT(*) AS n FROM clicker_events
                     WHERE created_at > NOW() - make_interval(days => $1)
                     GROUP BY 1 ORDER BY n DESC LIMIT 15`, [days]),
        pool.query(`SELECT COUNT(*) AS entrants FROM pigeon_race_entries
                     WHERE entered_at > NOW() - INTERVAL '7 days'`),
        pool.query(`SELECT ftue_claimed, COUNT(*) AS n FROM clicker_state GROUP BY 1`),
      ]);
      res.json({
        totals: totals.rows[0],
        daily: daily.rows,
        events: events.rows,
        raceEntrants7d: Number(race.rows[0]?.entrants || 0),
        ftue: funnel.rows,
        push: pushState,
      });
    } catch (e) {
      log.error({ err: e }, "[admin metrics]");
      res.status(500).json({ error: "internal" });
    }
  });

  // ── Игроки: поиск/список ───────────────────────────────────────────────────
  router.get("/api/admin/game/users", requireAdminToken, rateLimit(60), async (req, res) => {
    const q = String(req.query.q || "").trim();
    const limit = Math.min(100, Number(req.query.limit) || 50);
    try {
      const params: unknown[] = [];
      let where = "";
      if (q) {
        params.push(/^\d+$/.test(q) ? Number(q) : -1, `%${q}%`);
        where = `WHERE s.chat_id = $1 OR sub.username ILIKE $2 OR sub.first_name ILIKE $2 OR sub.phone ILIKE $2`;
      }
      const { rows } = await pool.query(
        `SELECT s.chat_id, s.balance, s.total_earned, s.taps, s.prestige, s.updated_at,
                sub.username, sub.first_name, sub.phone
           FROM clicker_state s LEFT JOIN subscribers sub ON sub.chat_id = s.chat_id
           ${where} ORDER BY s.updated_at DESC LIMIT ${limit}`, params);
      res.json({
        users: rows.map((r) => ({
          ...r,
          chat_id: String(r.chat_id),
          platform: platformOf(Number(r.chat_id)),
          platformId: toPlatformId(Number(r.chat_id)),
        })),
      });
    } catch (e) {
      log.error({ err: e }, "[admin users]");
      res.status(500).json({ error: "internal" });
    }
  });

  // ── Игрок: детальная карточка ──────────────────────────────────────────────
  router.get("/api/admin/game/user/:id", requireAdminToken, rateLimit(60), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "bad_id" }); return; }
    try {
      const [state, sub, cards, cardItems, cases, pigeons, redemptions, links, events] = await Promise.all([
        pool.query(`SELECT * FROM clicker_state WHERE chat_id=$1`, [id]),
        pool.query(`SELECT username, first_name, phone, phone_verified_at, joined_at FROM subscribers WHERE chat_id=$1`, [id]),
        pool.query(`SELECT COUNT(*) AS n, COALESCE(SUM(level),0) AS lv FROM clicker_cards WHERE chat_id=$1`, [id]),
        pool.query(`SELECT card, level FROM clicker_cards WHERE chat_id=$1 ORDER BY card`, [id]),
        pool.query(`SELECT request_id, cost, prize, balance_before, balance_after, created_at
                      FROM clicker_case_history WHERE chat_id=$1 ORDER BY created_at DESC LIMIT 50`, [id]),
        pool.query(`SELECT breed, count FROM pigeon_inventory WHERE chat_id=$1 ORDER BY breed`, [id]),
        pool.query(`SELECT reward_id, cost, code, created_at FROM clicker_redemptions WHERE chat_id=$1 ORDER BY created_at DESC LIMIT 10`, [id]),
        linksOf(id),
        pool.query(`SELECT event, meta, created_at FROM clicker_events WHERE chat_id=$1 ORDER BY created_at DESC LIMIT 20`, [id]),
      ]);
      res.json({
        chat_id: String(id),
        platform: platformOf(id),
        platformId: toPlatformId(id),
        state: state.rows[0] ? { ...state.rows[0], chat_id: String(id) } : null,
        subscriber: sub.rows[0] || null,
        cards: cards.rows[0],
        cardItems: cardItems.rows,
        cases: cases.rows,
        pigeons: pigeons.rows,
        redemptions: redemptions.rows,
        links: links.map((l) => ({ alias: String(l.alias), platform: platformOf(l.alias) })),
        events: events.rows,
      });
    } catch (e) {
      log.error({ err: e, id }, "[admin user]");
      res.status(500).json({ error: "internal" });
    }
  });

  // ── Коррекция монет (+/-) ──────────────────────────────────────────────────
  router.post("/api/admin/game/user/:id/coins", requireAdminToken, requireAdminRole("operator"), rateLimit(30), async (req, res) => {
    const id = Number(req.params.id);
    const delta = Math.trunc(Number((req.body as { delta?: unknown })?.delta));
    const reason = String((req.body as { reason?: unknown })?.reason || "").slice(0, 200);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "bad_id", message: "Некорректный ID игрока" }); return; }
    if (!Number.isFinite(delta) || delta === 0) { res.status(400).json({ error: "bad_delta", message: "Укажи целое ненулевое число, например +5000 или -5000" }); return; }
    if (Math.abs(delta) > 10_000_000) { res.status(400).json({ error: "bad_delta", message: "Разовое изменение не может превышать 10 000 000 монет" }); return; }
    try {
      const { rows } = await pool.query(
        `UPDATE clicker_state
            SET balance = GREATEST(0, balance + $2),
                total_earned = total_earned + GREATEST(0, $2),
                updated_at = NOW()
          WHERE chat_id = $1
        RETURNING balance`, [id, delta]);
      if (!rows[0]) { res.status(404).json({ error: "not_found" }); return; }
      trackEvent(id, "admin_coins", { delta, reason });
      const balance = Number(rows[0].balance);
      const notified = await push.sendRaw(id, adminCoinsChangeMessage(delta, balance, reason)).catch((error) => {
        log.warn({ err: error, id }, "[admin coins] user notification failed");
        return false;
      });
      res.json({ ok: true, balance, notified });
    } catch (e) {
      log.error({ err: e, id }, "[admin coins]");
      res.status(500).json({ error: "internal" });
    }
  });

  // ── Рассылка ───────────────────────────────────────────────────────────────
  router.post("/api/admin/game/push", requireAdminToken, requireAdminRole("operator"), rateLimit(10), async (req, res) => {
    const body = req.body as { text?: unknown; segment?: unknown; testChatId?: unknown };
    const text = String(body?.text || "").trim();
    const segment = String(body?.segment || "all") as Segment;
    const testChatId = Number(body?.testChatId) || 0;
    if (!text || text.length > 3500) { res.status(400).json({ error: "bad_text" }); return; }
    if (!["all", "active7", "active30", "tg", "vk", "max"].includes(segment)) {
      res.status(400).json({ error: "bad_segment" }); return;
    }

    // Тестовая отправка одному получателю — синхронно
    if (testChatId) {
      const ok = await push.sendRaw(testChatId, text, { parse_mode: "Markdown" });
      res.json({ ok, test: true });
      return;
    }

    if (pushState.running) { res.status(409).json({ error: "push_in_progress", state: pushState }); return; }
    const { rows } = await pool.query(
      `SELECT s.chat_id FROM clicker_state s ${segmentWhere(segment)} ORDER BY s.chat_id`);
    const targets = rows.map((r) => Number(r.chat_id));
    pushState = { running: true, startedAt: Date.now(), total: targets.length, sent: 0, failed: 0, text: text.slice(0, 80) };
    res.json({ ok: true, queued: targets.length });

    // Фоновая отправка после ответа
    void (async () => {
      for (const chatId of targets) {
        const ok = await push.sendRaw(chatId, text, { parse_mode: "Markdown" }).catch(() => false);
        if (ok) pushState.sent = (pushState.sent || 0) + 1;
        else pushState.failed = (pushState.failed || 0) + 1;
        await sleep(60);
      }
      pushState.running = false;
      trackEvent(0, "admin_push", { segment, total: targets.length, sent: pushState.sent, failed: pushState.failed });
      log.info({ segment, ...pushState }, "[admin push] done");
    })();
  });

  router.get("/api/admin/game/push", requireAdminToken, rateLimit(120), (_req, res) => {
    res.json(pushState);
  });

  return router;
}

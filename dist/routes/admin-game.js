"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminCoinsChangeMessage = adminCoinsChangeMessage;
exports.default = adminGameRouter;
/**
 * Админка игры «Котик Комбат»: метрики, игроки, рассылка пушей, коррекции.
 * Все ручки под requireAdminToken (X-User-Token = ADMIN_TOKEN env) + rateLimit.
 * UI: public/admin/game.html.
 *
 * Рассылка идёт через PushService.sendRaw (роутинг TG/VK/МАКС сам) с паузой
 * 60 мс (~16 msg/s — под лимитом TG 30/s) в фоне; статус пишется в память
 * процесса (одна рассылка за раз) и в clicker_events (admin_push).
 */
const express_1 = require("express");
const db_1 = require("../db");
const middleware_1 = require("../middleware");
const platform_1 = require("../platform");
const account_link_1 = require("../account-link");
const analytics_1 = require("../analytics");
const logger_1 = require("../logger");
const clicker_1 = require("../clicker");
const game_auth_1 = require("../game-auth");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function adminCoinsChangeMessage(delta, balance, reason) {
    const sign = delta > 0 ? "+" : "−";
    const action = delta > 0 ? "начислены" : "списаны";
    return `🔔 Изменение игрового баланса\n\n` +
        `Администратор изменил ваш баланс: ${action} ${sign}${Math.abs(delta).toLocaleString("ru-RU")} монет.\n` +
        `Причина: ${reason}\n` +
        `Текущий баланс: ${Math.max(0, balance).toLocaleString("ru-RU")} монет.`;
}
// Статус текущей/последней рассылки (процесс один — память достаточна)
let pushState = { running: false };
function segmentWhere(seg) {
    switch (seg) {
        case "active7": return `WHERE s.admin_blocked=FALSE AND s.updated_at > NOW() - INTERVAL '7 days'`;
        case "active30": return `WHERE s.admin_blocked=FALSE AND s.updated_at > NOW() - INTERVAL '30 days'`;
        case "tg": return `WHERE s.admin_blocked=FALSE AND s.chat_id < 2e12`;
        case "vk": return `WHERE s.admin_blocked=FALSE AND s.chat_id >= 2e12 AND s.chat_id < 4e12`;
        case "max": return `WHERE s.admin_blocked=FALSE AND s.chat_id >= 4e12`;
        default: return "WHERE s.admin_blocked=FALSE";
    }
}
function adminGameRouter(push) {
    const router = (0, express_1.Router)();
    // ── Метрики ────────────────────────────────────────────────────────────────
    router.get("/api/admin/game/metrics", middleware_1.requireAdminToken, (0, middleware_1.rateLimit)(60), async (req, res) => {
        const days = Math.min(90, Math.max(7, Number(req.query.days) || 14));
        try {
            const [totals, daily, events, race, funnel] = await Promise.all([
                db_1.pool.query(`SELECT
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
                db_1.pool.query(`WITH firsts AS (
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
                db_1.pool.query(`SELECT event, COUNT(*) AS n FROM clicker_events
                     WHERE created_at > NOW() - make_interval(days => $1)
                     GROUP BY 1 ORDER BY n DESC LIMIT 15`, [days]),
                db_1.pool.query(`SELECT COUNT(*) AS entrants FROM pigeon_race_entries
                     WHERE entered_at > NOW() - INTERVAL '7 days'`),
                db_1.pool.query(`SELECT ftue_claimed, COUNT(*) AS n FROM clicker_state GROUP BY 1`),
            ]);
            res.json({
                totals: totals.rows[0],
                daily: daily.rows,
                events: events.rows,
                raceEntrants7d: Number(race.rows[0]?.entrants || 0),
                ftue: funnel.rows,
                push: pushState,
            });
        }
        catch (e) {
            logger_1.log.error({ err: e }, "[admin metrics]");
            res.status(500).json({ error: "internal" });
        }
    });
    // ── Игроки: поиск/список ───────────────────────────────────────────────────
    router.get("/api/admin/game/users", middleware_1.requireAdminToken, (0, middleware_1.rateLimit)(60), async (req, res) => {
        const q = String(req.query.q || "").trim();
        const limit = Math.min(100, Number(req.query.limit) || 50);
        try {
            const params = [];
            let where = "";
            if (q) {
                params.push(/^\d+$/.test(q) ? Number(q) : -1, `%${q}%`);
                where = `WHERE s.chat_id = $1 OR sub.username ILIKE $2 OR sub.first_name ILIKE $2 OR sub.phone ILIKE $2`;
            }
            const { rows } = await db_1.pool.query(`SELECT s.chat_id, s.balance, s.total_earned, s.taps, s.prestige, s.updated_at,
                sub.username, sub.first_name, sub.phone
           FROM clicker_state s LEFT JOIN subscribers sub ON sub.chat_id = s.chat_id
           ${where} ORDER BY s.updated_at DESC LIMIT ${limit}`, params);
            res.json({
                users: rows.map((r) => ({
                    ...r,
                    chat_id: String(r.chat_id),
                    platform: (0, platform_1.platformOf)(Number(r.chat_id)),
                    platformId: (0, platform_1.toPlatformId)(Number(r.chat_id)),
                })),
            });
        }
        catch (e) {
            logger_1.log.error({ err: e }, "[admin users]");
            res.status(500).json({ error: "internal" });
        }
    });
    // ── Игрок: детальная карточка ──────────────────────────────────────────────
    router.get("/api/admin/game/user/:id", middleware_1.requireAdminToken, (0, middleware_1.rateLimit)(60), async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            res.status(400).json({ error: "bad_id" });
            return;
        }
        try {
            const [state, sub, cards, cardItems, cases, pigeons, redemptions, links, events] = await Promise.all([
                db_1.pool.query(`SELECT * FROM clicker_state WHERE chat_id=$1`, [id]),
                db_1.pool.query(`SELECT username, first_name, phone, phone_verified_at, joined_at FROM subscribers WHERE chat_id=$1`, [id]),
                db_1.pool.query(`SELECT COUNT(*) AS n, COALESCE(SUM(level),0) AS lv FROM clicker_cards WHERE chat_id=$1`, [id]),
                db_1.pool.query(`SELECT card, level FROM clicker_cards WHERE chat_id=$1 ORDER BY card`, [id]),
                db_1.pool.query(`SELECT request_id, cost, prize, balance_before, balance_after, created_at
                      FROM clicker_case_history WHERE chat_id=$1 ORDER BY created_at DESC LIMIT 50`, [id]),
                db_1.pool.query(`SELECT breed, count FROM pigeon_inventory WHERE chat_id=$1 ORDER BY breed`, [id]),
                db_1.pool.query(`SELECT reward_id, cost, code, created_at FROM clicker_redemptions WHERE chat_id=$1 ORDER BY created_at DESC LIMIT 10`, [id]),
                (0, account_link_1.linksOf)(id),
                db_1.pool.query(`SELECT event, meta, created_at FROM clicker_events WHERE chat_id=$1 ORDER BY created_at DESC LIMIT 20`, [id]),
            ]);
            res.json({
                chat_id: String(id),
                platform: (0, platform_1.platformOf)(id),
                platformId: (0, platform_1.toPlatformId)(id),
                state: state.rows[0] ? { ...state.rows[0], chat_id: String(id) } : null,
                subscriber: sub.rows[0] || null,
                cards: cards.rows[0],
                cardItems: cardItems.rows,
                cases: cases.rows,
                pigeons: pigeons.rows,
                redemptions: redemptions.rows,
                links: links.map((l) => ({ alias: String(l.alias), platform: (0, platform_1.platformOf)(l.alias) })),
                events: events.rows,
            });
        }
        catch (e) {
            logger_1.log.error({ err: e, id }, "[admin user]");
            res.status(500).json({ error: "internal" });
        }
    });
    // ── Коррекция монет (+/-) ──────────────────────────────────────────────────
    router.post("/api/admin/game/user/:id/coins", middleware_1.requireAdminToken, (0, middleware_1.requireAdminRole)("operator"), (0, middleware_1.rateLimit)(30), async (req, res) => {
        const id = Number(req.params.id);
        const delta = Math.trunc(Number(req.body?.delta));
        const reason = String(req.body?.reason || "").slice(0, 200);
        if (!Number.isFinite(id)) {
            res.status(400).json({ error: "bad_id", message: "Некорректный ID игрока" });
            return;
        }
        if (!Number.isFinite(delta) || delta === 0) {
            res.status(400).json({ error: "bad_delta", message: "Укажи целое ненулевое число, например +5000 или -5000" });
            return;
        }
        if (Math.abs(delta) > 10000000) {
            res.status(400).json({ error: "bad_delta", message: "Разовое изменение не может превышать 10 000 000 монет" });
            return;
        }
        try {
            const { rows } = await db_1.pool.query(`UPDATE clicker_state
            SET balance = GREATEST(0, balance + $2),
                total_earned = total_earned + GREATEST(0, $2),
                state_revision = state_revision + 1,
                updated_at = NOW()
          WHERE chat_id = $1
        RETURNING balance`, [id, delta]);
            if (!rows[0]) {
                res.status(404).json({ error: "not_found" });
                return;
            }
            (0, analytics_1.trackEvent)(id, "admin_coins", { delta, reason });
            const balance = Number(rows[0].balance);
            const notified = await push.sendRaw(id, adminCoinsChangeMessage(delta, balance, reason)).catch((error) => {
                logger_1.log.warn({ err: error, id }, "[admin coins] user notification failed");
                return false;
            });
            res.json({ ok: true, balance, notified });
        }
        catch (e) {
            logger_1.log.error({ err: e, id }, "[admin coins]");
            res.status(500).json({ error: "internal" });
        }
    });
    router.post("/api/admin/game/user/:id/block", middleware_1.requireAdminToken, (0, middleware_1.requireAdminRole)("operator"), (0, middleware_1.rateLimit)(20), async (req, res) => {
        const id = Number(req.params.id);
        const blockedRaw = req.body?.blocked;
        const reason = String(req.body?.reason || "Административное решение").trim().slice(0, 200);
        if (!Number.isSafeInteger(id) || id <= 0) {
            res.status(400).json({ error: "bad_id" });
            return;
        }
        if (typeof blockedRaw !== "boolean") {
            res.status(400).json({ error: "bad_blocked" });
            return;
        }
        const blocked = blockedRaw;
        try {
            const { rows } = await db_1.pool.query(`UPDATE clicker_state SET admin_blocked=$2, admin_block_reason=$3,
                admin_blocked_at=CASE WHEN $2 THEN NOW() ELSE NULL END,
                state_revision=state_revision+1, updated_at=NOW()
          WHERE chat_id=$1 RETURNING balance`, [id, blocked, blocked ? reason : null]);
            if (!rows[0]) {
                res.status(404).json({ error: "not_found" });
                return;
            }
            // Блокировка меняет состав допустимых вкладчиков: не держим до минуты
            // устаревший множитель копилки в process-cache.
            (0, clicker_1._clearSquadBankCache)();
            (0, game_auth_1.clearGameAccessCache)(id);
            (0, analytics_1.trackEvent)(id, blocked ? "admin_block" : "admin_unblock", { reason });
            const message = blocked
                ? `🔒 Доступ к «Котик Комбат» временно ограничен администрацией.\nПричина: ${reason}`
                : `🔓 Доступ к «Котик Комбат» восстановлен администрацией.\nПричина: ${reason}`;
            const notified = await push.sendRaw(id, message).catch((error) => { logger_1.log.warn({ err: error, id }, "[admin block] notification failed"); return false; });
            res.json({ ok: true, blocked, notified });
        }
        catch (error) {
            logger_1.log.error({ err: error, id }, "[admin block]");
            res.status(500).json({ error: "internal" });
        }
    });
    router.post("/api/admin/game/user/:id/reset", middleware_1.requireAdminToken, (0, middleware_1.requireAdminRole)("operator"), (0, middleware_1.rateLimit)(10), async (req, res) => {
        const id = Number(req.params.id);
        const reason = String(req.body?.reason || "Сброс игрового прогресса").trim().slice(0, 200);
        if (!Number.isSafeInteger(id) || id <= 0) {
            res.status(400).json({ error: "bad_id" });
            return;
        }
        try {
            await (0, clicker_1.resetClickerProgress)(id);
            (0, analytics_1.trackEvent)(id, "admin_reset", { reason });
            const notified = await push.sendRaw(id, `♻️ Игровой прогресс «Котик Комбат» сброшен администрацией.\nПричина: ${reason}`).catch((error) => { logger_1.log.warn({ err: error, id }, "[admin reset] notification failed"); return false; });
            res.json({ ok: true, notified });
        }
        catch (error) {
            if (error instanceof Error && error.message === "not_found") {
                res.status(404).json({ error: "not_found" });
                return;
            }
            logger_1.log.error({ err: error, id }, "[admin reset]");
            res.status(500).json({ error: "internal" });
        }
    });
    // ── Рассылка ───────────────────────────────────────────────────────────────
    router.post("/api/admin/game/push", middleware_1.requireAdminToken, (0, middleware_1.requireAdminRole)("operator"), (0, middleware_1.rateLimit)(10), async (req, res) => {
        const body = req.body;
        const text = String(body?.text || "").trim();
        const segment = String(body?.segment || "all");
        const testChatId = Number(body?.testChatId) || 0;
        if (!text || text.length > 3500) {
            res.status(400).json({ error: "bad_text" });
            return;
        }
        if (!["all", "active7", "active30", "tg", "vk", "max"].includes(segment)) {
            res.status(400).json({ error: "bad_segment" });
            return;
        }
        // Тестовая отправка одному получателю — синхронно
        if (testChatId) {
            const ok = await push.sendRaw(testChatId, text, { parse_mode: "Markdown" });
            res.json({ ok, test: true });
            return;
        }
        if (pushState.running) {
            res.status(409).json({ error: "push_in_progress", state: pushState });
            return;
        }
        const { rows } = await db_1.pool.query(`SELECT s.chat_id FROM clicker_state s ${segmentWhere(segment)} ORDER BY s.chat_id`);
        const targets = rows.map((r) => Number(r.chat_id));
        pushState = { running: true, startedAt: Date.now(), total: targets.length, sent: 0, failed: 0, text: text.slice(0, 80) };
        res.json({ ok: true, queued: targets.length });
        // Фоновая отправка после ответа
        void (async () => {
            for (const chatId of targets) {
                const ok = await push.sendRaw(chatId, text, { parse_mode: "Markdown" }).catch(() => false);
                if (ok)
                    pushState.sent = (pushState.sent || 0) + 1;
                else
                    pushState.failed = (pushState.failed || 0) + 1;
                await sleep(60);
            }
            pushState.running = false;
            (0, analytics_1.trackEvent)(0, "admin_push", { segment, total: targets.length, sent: pushState.sent, failed: pushState.failed });
            logger_1.log.info({ segment, ...pushState }, "[admin push] done");
        })();
    });
    router.get("/api/admin/game/push", middleware_1.requireAdminToken, (0, middleware_1.rateLimit)(120), (_req, res) => {
        res.json(pushState);
    });
    return router;
}

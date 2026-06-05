/**
 * Referral routes — реферальная схема (code-based).
 *
 * - GET  /api/referral/me   — мой код + количество использований
 * - POST /api/referral/use  — записать использование чужого кода (с уведомлением владельца)
 *
 * Уведомление владельца кода идёт через push.sendRaw — владелец может быть
 * юзером любой платформы (TG/VK), сервис роутит сам.
 */

import { Router } from "express";
import type { Pool } from "pg";
import { getOrCreateReferralCode, recordReferralUse } from "../db";
import { requireTgUser, getTgUser } from "../auth";
import { referralLink } from "../links";
import type { PushService } from "../push";
import { log } from "../logger";

export function createReferralRouter(push: PushService, pool: Pool): Router {
  const router = Router();

  router.get("/api/referral/me", requireTgUser, async (req, res) => {
    const u = getTgUser(req)!;
    try {
      const code = await getOrCreateReferralCode(u.id, u.first_name);
      const used = await pool.query<{ used: number }>(
        `SELECT COUNT(*)::int AS used FROM referral_uses WHERE code = $1`,
        [code]
      );
      res.json({
        code,
        used: used.rows[0]?.used ?? 0,
        // Ссылка на платформу владельца кода (друг скорее всего там же)
        share_url: referralLink(u.id, code),
      });
    } catch (e) {
      log.error({ err: e, chatId: u.id }, "[referral/me]");
      res.status(500).json({ error: "internal" });
    }
  });

  router.post("/api/referral/use", requireTgUser, async (req, res) => {
    const u = getTgUser(req)!;
    const code = String(req.body?.code ?? "").trim().toUpperCase();
    if (!code) {
      res.status(400).json({ error: "code_required" });
      return;
    }
    try {
      const r = await recordReferralUse(u.id, code);
      if (!r.ok) {
        res.status(400).json({ error: r.reason });
        return;
      }
      // Уведомляем владельца кода — best-effort (он может быть на другой платформе)
      if (r.ownerChat) {
        const userName = [u.first_name, u.last_name].filter(Boolean).join(" ") || "Новый друг";
        push.sendRaw(
          r.ownerChat,
          `🎉 *${userName}* пришёл по твоему коду \`${code}\` — спасибо, что зовёшь друзей в «Марию»!`,
          { parse_mode: "Markdown" }
        ).catch(() => {});
      }
      res.json({ ok: true });
    } catch (e) {
      log.error({ err: e, chatId: u.id, code }, "[referral/use]");
      res.status(500).json({ error: "internal" });
    }
  });

  return router;
}

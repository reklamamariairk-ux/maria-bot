/**
 * Wheel of Fortune + visit streak routes.
 *
 * - GET  /api/wheel/status   — текущий статус (canSpin, lastPrize, nextSpinAt)
 * - POST /api/wheel/spin     — крутить (раз в день)
 * - POST /api/streak/touch   — отметить визит (если 7 дней подряд → push награды)
 *
 * Streak использует sendPushSafely для уведомления о награде — фабрика
 * принимает PushService.
 */

import { Router } from "express";
import { getSpinStatus, recordSpin, WHEEL_PRIZES, touchVisitStreak } from "../db";
import type { PushService } from "../push";
import { requireTgUser, getTgUser } from "../auth";
import { rateLimit } from "../middleware";
import { log } from "../logger";

export function createWheelStreakRouter(push: PushService): Router {
  const router = Router();

  router.get("/api/wheel/status", requireTgUser, async (req, res) => {
    const u = getTgUser(req)!;
    try {
      const status = await getSpinStatus(u.id);
      res.json({
        canSpin: status.canSpin,
        lastPrize: status.lastPrize,
        nextSpinAt: status.nextSpinAt,
        prizes: WHEEL_PRIZES,
      });
    } catch (e) {
      log.error({ err: e, chatId: u.id }, "[wheel/status]");
      res.status(500).json({ error: "internal" });
    }
  });

  router.post("/api/wheel/spin", requireTgUser, async (req, res) => {
    const u = getTgUser(req)!;
    try {
      const r = await recordSpin(u.id);
      const idx = WHEEL_PRIZES.findIndex((p) => p.kind === r.prize.kind);
      res.json({ prize: r.prize, prizeIndex: idx, alreadySpunToday: r.alreadySpunToday });
    } catch (e) {
      log.error({ err: e, chatId: u.id }, "[wheel/spin]");
      res.status(500).json({ error: "internal" });
    }
  });

  router.post("/api/streak/touch", rateLimit(20), requireTgUser, async (req, res) => {
    const u = getTgUser(req)!;
    try {
      const r = await touchVisitStreak(u.id);
      if (r.reachedReward) {
        push.sendPushSafely(
          u.id,
          "transactional",
          `🎉 *Streak 7 дней!*\n\nТы заходишь в Mini App неделю подряд — получаешь *бесплатный десерт* при следующем заказе. Промокод применится автоматически.`,
        ).catch(() => {});
      }
      res.json(r);
    } catch (e) {
      log.error({ err: e, chatId: u.id }, "[streak/touch]");
      res.status(500).json({ error: "internal" });
    }
  });

  return router;
}

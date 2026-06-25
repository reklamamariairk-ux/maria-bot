/**
 * Notification preferences routes.
 *
 * - GET  /api/notify-prefs    — текущие prefs юзера (marketing_promo, marketing_rewards)
 * - POST /api/notify-prefs    — обновить (валидируем что bool)
 */

import { Router } from "express";
import { getNotificationPrefs, setNotificationPrefs } from "../db";
import { requireTgUser, getTgUser } from "../auth";
import { log } from "../logger";

const router = Router();

router.get("/api/notify-prefs", requireTgUser, async (req, res) => {
  const u = getTgUser(req)!;
  try {
    const prefs = await getNotificationPrefs(u.id);
    res.json(prefs);
  } catch (e) {
    log.error({ err: e, chatId: u.id }, "[notify-prefs GET]");
    res.status(500).json({ error: "internal" });
  }
});

router.post("/api/notify-prefs", requireTgUser, async (req, res) => {
  const u = getTgUser(req)!;
  const body = req.body as { marketing_promo?: boolean; marketing_rewards?: boolean; marketing_game?: boolean };
  const prefs: { marketing_promo?: boolean; marketing_rewards?: boolean; marketing_game?: boolean } = {};
  if (typeof body.marketing_promo === "boolean") prefs.marketing_promo = body.marketing_promo;
  if (typeof body.marketing_rewards === "boolean") prefs.marketing_rewards = body.marketing_rewards;
  if (typeof body.marketing_game === "boolean") prefs.marketing_game = body.marketing_game;
  try {
    await setNotificationPrefs(u.id, prefs);
    const fresh = await getNotificationPrefs(u.id);
    res.json(fresh);
  } catch (e) {
    log.error({ err: e, chatId: u.id }, "[notify-prefs POST]");
    res.status(500).json({ error: "internal" });
  }
});

export default router;

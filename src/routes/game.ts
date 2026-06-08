/**
 * Game results route.
 *
 * - POST /api/game-result — записать результат мини-игры (flappy_cake / memory / bakery),
 *                            если телефон verified → начисляем звёзды + rec. бонус.
 *                            Без verified — возвращаем gated=true.
 */

import { Router } from "express";
import { isPhoneVerified, getBalance, recordGameResult } from "../club";
import { rateLimit } from "../middleware";
import { requireTgUser, getTgUser } from "../auth";
import { log } from "../logger";

const router = Router();

router.post("/api/game-result", requireTgUser, rateLimit(30), async (req, res) => {
  const u = getTgUser(req)!;
  const { game, score } = req.body as { game?: string; score?: number };
  if (!game || typeof score !== "number" || score < 0) {
    res.status(400).json({ error: "bad_input" });
    return;
  }
  if (!["flappy_cake", "memory", "bakery", "cat_catch", "cat_feed"].includes(game)) {
    res.status(400).json({ error: "unknown_game" });
    return;
  }
  try {
    if (!(await isPhoneVerified(u.id))) {
      res.json({ starsAwarded: 0, recordBeaten: false, recordBonus: 0, capped: false, gated: true });
      return;
    }
    const result = await recordGameResult(u.id, game, score);
    const balance = await getBalance(u.id);
    res.json({ ...result, balance });
  } catch (e) {
    log.error({ err: e, chatId: u.id, game, score }, "[API /game-result]");
    res.status(500).json({ error: "internal" });
  }
});

export default router;

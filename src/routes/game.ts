/**
 * Game results route.
 *
 * - POST /api/game-result — записать личный рекорд мини-игры.
 *   Конвертируемые звёзды за клиентский score отключены в club.ts.
 */

import { Router } from "express";
import { isPhoneVerified, getBalance, recordGameResult } from "../club";
import { rateLimit } from "../middleware";
import { requireTgUser, getTgUser } from "../auth";
import { log } from "../logger";

const router = Router();
const GAME_SCORE_CAP: Record<string, number> = {
  flappy_cake: 5000,
  memory: 5000,
  bakery: 5000,
  cat_catch: 5000,
  cat_feed: 5000,
};

router.post("/api/game-result", requireTgUser, rateLimit(30), async (req, res) => {
  const u = getTgUser(req)!;
  const { game, score } = req.body as { game?: string; score?: number };
  if (!game || typeof score !== "number" || !Number.isFinite(score) || score < 0) {
    res.status(400).json({ error: "bad_input" });
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(GAME_SCORE_CAP, game)) {
    res.status(400).json({ error: "unknown_game" });
    return;
  }
  const safeScore = Math.min(GAME_SCORE_CAP[game], Math.floor(score));
  try {
    if (!(await isPhoneVerified(u.id))) {
      res.json({ starsAwarded: 0, recordBeaten: false, recordBonus: 0, capped: false, gated: true });
      return;
    }
    const result = await recordGameResult(u.id, game, safeScore);
    const balance = await getBalance(u.id);
    res.json({ ...result, balance });
  } catch (e) {
    log.error({ err: e, chatId: u.id, game, score }, "[API /game-result]");
    res.status(500).json({ error: "internal" });
  }
});

export default router;

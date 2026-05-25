/**
 * Club routes — программа лояльности (points/stars/rewards/daily/convert).
 *
 * Эндпоинты:
 * - POST /api/daily/claim         — ежедневный логин-бонус (требует verified phone)
 * - GET  /api/conversion-tiers    — таблица конвертации points→stars
 * - POST /api/convert             — points→stars обмен
 * - GET  /api/rewards             — каталог наград клуба
 * - POST /api/redeem              — обменять stars на reward (промокод)
 * - GET  /api/my-rewards          — мои redeemed-награды (промокоды от клуба)
 * - GET  /api/rewards/mine        — мои unused награды с колеса/streak
 *
 * /api/streak/touch остался в src/index.ts — там вызывается sendPushSafely
 * который ещё не вынесен (push-волна).
 */

import { Router } from "express";
import {
  isPhoneVerified,
  claimDailyLogin,
  getBalance,
  convertStars,
  redeemReward,
  getRewardsCatalog,
  getMyRewards,
  CONVERSION_TIERS,
} from "../club";
import { getUnusedRewards } from "../db";
import { rateLimit } from "../middleware";
import { requireTgUser, getTgUser } from "../auth";
import { log } from "../logger";

const router = Router();

router.post("/api/daily/claim", requireTgUser, rateLimit(10), async (req, res) => {
  const u = getTgUser(req)!;
  try {
    if (!(await isPhoneVerified(u.id))) {
      res.status(403).json({ error: "phone_not_verified" });
      return;
    }
    const result = await claimDailyLogin(u.id);
    const balance = await getBalance(u.id);
    res.json({ ...result, balance });
  } catch (e) {
    log.error({ err: e, chatId: u.id }, "[club] /api/daily/claim");
    res.status(500).json({ error: "internal" });
  }
});

router.get("/api/conversion-tiers", rateLimit(30), (_req, res) => {
  res.json(CONVERSION_TIERS);
});

router.post("/api/convert", requireTgUser, rateLimit(10), async (req, res) => {
  const u = getTgUser(req)!;
  const { stars } = req.body as { stars?: number };
  if (typeof stars !== "number") {
    res.status(400).json({ error: "bad_stars" });
    return;
  }
  try {
    const result = await convertStars(u.id, stars);
    const balance = await getBalance(u.id);
    res.json({ ...result, balance });
  } catch (e) {
    log.error({ err: e, chatId: u.id, stars }, "[club] /api/convert");
    res.status(500).json({ error: "internal" });
  }
});

router.get("/api/rewards", rateLimit(60), async (_req, res) => {
  try {
    const items = await getRewardsCatalog();
    res.json(items);
  } catch (e) {
    log.error({ err: e }, "[club] /api/rewards");
    res.status(500).json({ error: "internal" });
  }
});

router.post("/api/redeem", requireTgUser, rateLimit(10), async (req, res) => {
  const u = getTgUser(req)!;
  const { rewardId } = req.body as { rewardId?: number };
  if (typeof rewardId !== "number") {
    res.status(400).json({ error: "bad_reward_id" });
    return;
  }
  try {
    if (!(await isPhoneVerified(u.id))) {
      res.status(403).json({ error: "phone_not_verified" });
      return;
    }
    const result = await redeemReward(u.id, rewardId);
    const balance = await getBalance(u.id);
    res.json({ ...result, balance });
  } catch (e) {
    log.error({ err: e, chatId: u.id, rewardId }, "[club] /api/redeem");
    res.status(500).json({ error: "internal" });
  }
});

router.get("/api/my-rewards", requireTgUser, async (req, res) => {
  const u = getTgUser(req)!;
  try {
    const items = await getMyRewards(u.id);
    res.json(items);
  } catch (e) {
    log.error({ err: e, chatId: u.id }, "[club] /api/my-rewards");
    res.status(500).json({ error: "internal" });
  }
});

router.get("/api/rewards/mine", requireTgUser, async (req, res) => {
  const u = getTgUser(req)!;
  try {
    const rewards = await getUnusedRewards(u.id);
    res.json({ rewards });
  } catch (e) {
    log.error({ err: e, chatId: u.id }, "[club] /api/rewards/mine");
    res.status(500).json({ error: "internal" });
  }
});

export default router;

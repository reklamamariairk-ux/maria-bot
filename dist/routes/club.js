"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const club_1 = require("../club");
const db_1 = require("../db");
const middleware_1 = require("../middleware");
const auth_1 = require("../auth");
const logger_1 = require("../logger");
const router = (0, express_1.Router)();
router.post("/api/daily/claim", auth_1.requireTgUser, (0, middleware_1.rateLimit)(10), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        if (!(await (0, club_1.isPhoneVerified)(u.id))) {
            res.status(403).json({ error: "phone_not_verified" });
            return;
        }
        const result = await (0, club_1.claimDailyLogin)(u.id);
        const balance = await (0, club_1.getBalance)(u.id);
        res.json({ ...result, balance });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[club] /api/daily/claim");
        res.status(500).json({ error: "internal" });
    }
});
router.get("/api/conversion-tiers", (0, middleware_1.rateLimit)(30), (_req, res) => {
    res.json(club_1.CONVERSION_TIERS);
});
router.post("/api/convert", auth_1.requireTgUser, (0, middleware_1.rateLimit)(10), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    const { stars } = req.body;
    if (typeof stars !== "number") {
        res.status(400).json({ error: "bad_stars" });
        return;
    }
    try {
        const result = await (0, club_1.convertStars)(u.id, stars);
        const balance = await (0, club_1.getBalance)(u.id);
        res.json({ ...result, balance });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id, stars }, "[club] /api/convert");
        res.status(500).json({ error: "internal" });
    }
});
router.get("/api/rewards", (0, middleware_1.rateLimit)(60), async (_req, res) => {
    try {
        const items = await (0, club_1.getRewardsCatalog)();
        res.json(items);
    }
    catch (e) {
        logger_1.log.error({ err: e }, "[club] /api/rewards");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/redeem", auth_1.requireTgUser, (0, middleware_1.rateLimit)(10), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    const { rewardId } = req.body;
    if (typeof rewardId !== "number") {
        res.status(400).json({ error: "bad_reward_id" });
        return;
    }
    try {
        if (!(await (0, club_1.isPhoneVerified)(u.id))) {
            res.status(403).json({ error: "phone_not_verified" });
            return;
        }
        const result = await (0, club_1.redeemReward)(u.id, rewardId);
        const balance = await (0, club_1.getBalance)(u.id);
        res.json({ ...result, balance });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id, rewardId }, "[club] /api/redeem");
        res.status(500).json({ error: "internal" });
    }
});
router.get("/api/my-rewards", auth_1.requireTgUser, async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        const items = await (0, club_1.getMyRewards)(u.id);
        res.json(items);
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[club] /api/my-rewards");
        res.status(500).json({ error: "internal" });
    }
});
router.get("/api/rewards/mine", auth_1.requireTgUser, async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        const rewards = await (0, db_1.getUnusedRewards)(u.id);
        res.json({ rewards });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[club] /api/rewards/mine");
        res.status(500).json({ error: "internal" });
    }
});
exports.default = router;

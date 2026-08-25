"use strict";
/**
 * Game results route.
 *
 * - POST /api/game-result — записать личный рекорд мини-игры.
 *   Конвертируемые звёзды за клиентский score отключены в club.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const club_1 = require("../club");
const middleware_1 = require("../middleware");
const auth_1 = require("../auth");
const logger_1 = require("../logger");
const router = (0, express_1.Router)();
const GAME_SCORE_CAP = {
    flappy_cake: 5000,
    memory: 5000,
    bakery: 5000,
    cat_catch: 5000,
    cat_feed: 5000,
};
router.post("/api/game-result", auth_1.requireTgUser, (0, middleware_1.rateLimit)(30), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    const { game, score } = req.body;
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
        if (!(await (0, club_1.isPhoneVerified)(u.id))) {
            res.json({ starsAwarded: 0, recordBeaten: false, recordBonus: 0, capped: false, gated: true });
            return;
        }
        const result = await (0, club_1.recordGameResult)(u.id, game, safeScore);
        const balance = await (0, club_1.getBalance)(u.id);
        res.json({ ...result, balance });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id, game, score }, "[API /game-result]");
        res.status(500).json({ error: "internal" });
    }
});
exports.default = router;

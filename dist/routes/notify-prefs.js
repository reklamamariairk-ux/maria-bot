"use strict";
/**
 * Notification preferences routes.
 *
 * - GET  /api/notify-prefs    — текущие prefs юзера (marketing_promo, marketing_rewards)
 * - POST /api/notify-prefs    — обновить (валидируем что bool)
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const auth_1 = require("../auth");
const logger_1 = require("../logger");
const router = (0, express_1.Router)();
router.get("/api/notify-prefs", auth_1.requireTgUser, async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        const prefs = await (0, db_1.getNotificationPrefs)(u.id);
        res.json(prefs);
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[notify-prefs GET]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/notify-prefs", auth_1.requireTgUser, async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    const body = req.body;
    const prefs = {};
    if (typeof body.marketing_promo === "boolean")
        prefs.marketing_promo = body.marketing_promo;
    if (typeof body.marketing_rewards === "boolean")
        prefs.marketing_rewards = body.marketing_rewards;
    if (typeof body.marketing_game === "boolean")
        prefs.marketing_game = body.marketing_game;
    try {
        await (0, db_1.setNotificationPrefs)(u.id, prefs);
        const fresh = await (0, db_1.getNotificationPrefs)(u.id);
        res.json(fresh);
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[notify-prefs POST]");
        res.status(500).json({ error: "internal" });
    }
});
exports.default = router;

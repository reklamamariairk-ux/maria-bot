"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWheelStreakRouter = createWheelStreakRouter;
const express_1 = require("express");
const db_1 = require("../db");
const auth_1 = require("../auth");
const middleware_1 = require("../middleware");
const logger_1 = require("../logger");
function createWheelStreakRouter(push) {
    const router = (0, express_1.Router)();
    router.get("/api/wheel/status", auth_1.requireTgUser, async (req, res) => {
        const u = (0, auth_1.getTgUser)(req);
        try {
            const status = await (0, db_1.getSpinStatus)(u.id);
            res.json({
                canSpin: status.canSpin,
                lastPrize: status.lastPrize,
                nextSpinAt: status.nextSpinAt,
                prizes: db_1.WHEEL_PRIZES,
            });
        }
        catch (e) {
            logger_1.log.error({ err: e, chatId: u.id }, "[wheel/status]");
            res.status(500).json({ error: "internal" });
        }
    });
    router.post("/api/wheel/spin", auth_1.requireTgUser, async (req, res) => {
        const u = (0, auth_1.getTgUser)(req);
        try {
            const r = await (0, db_1.recordSpin)(u.id);
            const idx = db_1.WHEEL_PRIZES.findIndex((p) => p.kind === r.prize.kind);
            res.json({ prize: r.prize, prizeIndex: idx, alreadySpunToday: r.alreadySpunToday });
        }
        catch (e) {
            logger_1.log.error({ err: e, chatId: u.id }, "[wheel/spin]");
            res.status(500).json({ error: "internal" });
        }
    });
    router.post("/api/streak/touch", (0, middleware_1.rateLimit)(20), auth_1.requireTgUser, async (req, res) => {
        const u = (0, auth_1.getTgUser)(req);
        try {
            const r = await (0, db_1.touchVisitStreak)(u.id);
            if (r.reachedReward) {
                push.sendPushSafely(u.id, "transactional", `🎉 *Streak 7 дней!*\n\nТы заходишь в Mini App неделю подряд — получаешь *бесплатный десерт* при следующем заказе. Промокод применится автоматически.`).catch(() => { });
            }
            res.json(r);
        }
        catch (e) {
            logger_1.log.error({ err: e, chatId: u.id }, "[streak/touch]");
            res.status(500).json({ error: "internal" });
        }
    });
    return router;
}

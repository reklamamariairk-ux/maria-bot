"use strict";
/**
 * Order rating routes — оценка заказа после выполнения.
 *
 * Эндпоинты:
 * - GET  /api/order-rating/:orderId — текущая оценка (для отображения «уже оценили»)
 * - POST /api/order-rating          — upsert оценки (1-5 + опц. text)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderListHasId = orderListHasId;
const express_1 = require("express");
const db_1 = require("../db");
const middleware_1 = require("../middleware");
const auth_1 = require("../auth");
const logger_1 = require("../logger");
const lk_1 = require("../lk");
const router = (0, express_1.Router)();
function orderListHasId(orders, orderId) {
    return Array.isArray(orders) && orders.some((order) => String(order.id) === orderId);
}
async function requireOwnedOrder(chatId, orderId) {
    if (await (0, db_1.isAppOrderOwner)(chatId, orderId))
        return "owned";
    const lk = await (0, lk_1.fetchLk)(chatId);
    if (!lk.ok || !lk.data?.configured)
        return "unavailable";
    return orderListHasId(lk.data.orders, orderId) ? "owned" : "missing";
}
router.get("/api/order-rating/:orderId", auth_1.requireTgUser, (0, middleware_1.rateLimit)(30), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    const orderId = String(req.params.orderId || "").trim().slice(0, 64);
    if (!orderId) {
        res.status(400).json({ error: "bad_order_id" });
        return;
    }
    try {
        const ownership = await requireOwnedOrder(u.id, orderId);
        if (ownership === "unavailable") {
            res.status(503).json({ error: "orders_unavailable" });
            return;
        }
        if (ownership === "missing") {
            res.status(404).json({ error: "order_not_found" });
            return;
        }
        const rating = await (0, db_1.getOrderRating)(u.id, orderId);
        res.json({ rating });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id, orderId }, "[order-rating GET]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/order-rating", auth_1.requireTgUser, (0, middleware_1.rateLimit)(5), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    const body = req.body;
    const orderId = String(body.order_id ?? "").trim().slice(0, 64);
    const rating = Number(body.rating);
    const text = String(body.text ?? "").trim().slice(0, 500);
    if (!orderId) {
        res.status(400).json({ error: "order_id_required" });
        return;
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        res.status(400).json({ error: "rating_must_be_1_to_5" });
        return;
    }
    try {
        const ownership = await requireOwnedOrder(u.id, orderId);
        if (ownership === "unavailable") {
            res.status(503).json({ error: "orders_unavailable" });
            return;
        }
        if (ownership === "missing") {
            res.status(404).json({ error: "order_not_found" });
            return;
        }
        const saved = await (0, db_1.upsertOrderRating)(u.id, orderId, rating, text);
        res.json({ ok: true, rating: saved });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id, orderId, rating }, "[order-rating POST]");
        res.status(500).json({ error: "internal" });
    }
});
exports.default = router;

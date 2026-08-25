"use strict";
/**
 * Cart route — синхронизация снимка корзины для cart-abandonment push.
 *
 * - POST /api/cart/sync — items[] → пишем в cart_snapshots (или удаляем если пусто).
 *                          Cron-задача через 24h отправит push если корзина не дошла
 *                          до заказа.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const auth_1 = require("../auth");
const logger_1 = require("../logger");
const router = (0, express_1.Router)();
router.post("/api/cart/sync", auth_1.requireTgUser, async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    const body = req.body;
    const items = Array.isArray(body.items)
        ? body.items.filter((i) => i && Number(i.id) > 0 && Number(i.qty) > 0)
        : [];
    try {
        if (items.length === 0) {
            await (0, db_1.clearCartSnapshot)(u.id);
        }
        else {
            const totalSum = items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
            await (0, db_1.saveCartSnapshot)(u.id, items, totalSum);
        }
        res.json({ ok: true });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id, count: items.length }, "[cart/sync]");
        res.status(500).json({ error: "internal" });
    }
});
exports.default = router;

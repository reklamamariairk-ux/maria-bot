"use strict";
/**
 * Wishlist routes — список «нравится» + поделиться + back-in-stock подписка.
 *
 * - POST /api/wishlist/share        — создать share-link (требует tma auth, 10/сутки)
 * - GET  /api/wishlist/share/:code  — публичная страница shared wishlist
 *                                      (+ инкрементим opens, не блокирующее)
 * - POST /api/wishlist/sync         — синк wishlist пользователя (для back-in-stock push)
 *
 * Принимает getter каталога — для подмешивания product detail в GET share.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWishlistRouter = createWishlistRouter;
const express_1 = require("express");
const db_1 = require("../db");
const middleware_1 = require("../middleware");
const auth_1 = require("../auth");
const links_1 = require("../links");
const logger_1 = require("../logger");
function createWishlistRouter(getCatalog) {
    const router = (0, express_1.Router)();
    router.post("/api/wishlist/share", auth_1.requireTgUser, (0, middleware_1.rateLimit)(5), async (req, res) => {
        const u = (0, auth_1.getTgUser)(req);
        const body = req.body;
        const ids = Array.isArray(body.product_ids)
            ? body.product_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 30)
            : [];
        if (ids.length === 0) {
            res.status(400).json({ error: "wishlist_empty" });
            return;
        }
        const message = String(body.message ?? "").trim().slice(0, 200);
        try {
            const todayCount = await (0, db_1.countWishlistSharesLast24h)(u.id);
            if (todayCount >= 10) {
                res.status(429).json({ error: "rate_limit_exceeded", limit: 10 });
                return;
            }
            const ownerName = (u.first_name || "").trim().slice(0, 60) || null;
            const share = await (0, db_1.createWishlistShare)(u.id, ownerName, ids, message);
            // Deep-link на платформу владельца (TG: ?startapp=, VK: #hash)
            const url = (0, links_1.miniAppLink)(u.id, `wish_${share.short_code}`);
            res.json({
                ok: true,
                code: share.short_code,
                url,
                expires_at: share.expires_at,
                product_count: ids.length,
            });
        }
        catch (e) {
            logger_1.log.error({ err: e, chatId: u.id, count: ids.length }, "[wishlist/share POST]");
            res.status(500).json({ error: "internal" });
        }
    });
    router.get("/api/wishlist/share/:code", (0, middleware_1.rateLimit)(30), async (req, res) => {
        const code = String(req.params.code || "").toUpperCase().slice(0, 16);
        if (!/^[A-Z0-9]+$/.test(code)) {
            res.status(400).json({ error: "bad_code" });
            return;
        }
        try {
            const share = await (0, db_1.getWishlistShare)(code);
            if (!share) {
                res.status(404).json({ error: "not_found_or_expired" });
                return;
            }
            // Подмешиваем product detail из in-memory каталога
            const catalog = getCatalog();
            const products = share.product_ids
                .map((pid) => catalog.find((p) => p.id === pid))
                .filter((p) => Boolean(p));
            (0, db_1.incrementWishlistShareOpens)(code).catch(() => { });
            res.json({
                code: share.short_code,
                owner_name: share.owner_name,
                message: share.message,
                expires_at: share.expires_at,
                products,
            });
        }
        catch (e) {
            logger_1.log.error({ err: e, code }, "[wishlist/share GET]");
            res.status(500).json({ error: "internal" });
        }
    });
    router.post("/api/wishlist/sync", auth_1.requireTgUser, (0, middleware_1.rateLimit)(30), async (req, res) => {
        const u = (0, auth_1.getTgUser)(req);
        const ids = Array.isArray(req.body?.ids)
            ? [...new Set(req.body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 500)
            : [];
        try {
            await (0, db_1.wishlistSync)(u.id, ids);
            res.json({ ok: true, count: ids.length });
        }
        catch (e) {
            logger_1.log.error({ err: e, chatId: u.id, count: ids.length }, "[wishlist/sync]");
            res.status(500).json({ error: "internal" });
        }
    });
    return router;
}

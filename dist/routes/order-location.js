"use strict";
/**
 * Live-трекинг доставки для нативного приложения maria-app.
 *
 * Эндпоинты:
 * - POST /api/order/location            — курьер шлёт свою позицию (Bearer DELIVERY_TOKEN)
 * - GET  /api/order/location?orderId=…  — клиент читает с X-Order-Tracking-Token
 *
 * Хранение — В ПАМЯТИ: только последняя точка на заказ, TTL 30 мин. GPS-крошки не
 * персистим (эфемерные, высокочастотные) — схему БД не трогаем, магазин/чекаут тоже.
 * maria-bot одноинстансный (docker-compose) → in-memory достаточно; при масштабировании
 * заменить Map на Redis.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderTrackingToken = orderTrackingToken;
const crypto_1 = __importDefault(require("crypto"));
const express_1 = require("express");
const middleware_1 = require("../middleware");
const logger_1 = require("../logger");
const router = (0, express_1.Router)();
const TTL_MS = 30 * 60 * 1000; // 30 мин без обновлений → точка протухла
const positions = new Map();
/** Неподделываемый capability-token для чтения координат конкретного заказа. */
function orderTrackingToken(orderId) {
    const secret = process.env.ORDER_TRACKING_SECRET || process.env.ORDER_TOKEN || "";
    if (!secret)
        return null;
    return crypto_1.default.createHmac("sha256", secret).update(`order-location:${String(orderId)}`).digest("hex");
}
function bearer(req) {
    const h = String(req.headers.authorization || "");
    return h.startsWith("Bearer ") ? h.slice(7).trim() : null;
}
function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
// ── Курьер → сервер (частые пинги: ~1/10с) ──────────────────────────────────
router.post("/api/order/location", (0, middleware_1.rateLimit)(30), (req, res) => {
    const token = bearer(req);
    if (!process.env.DELIVERY_TOKEN || !(0, middleware_1.safeEq)(token, process.env.DELIVERY_TOKEN)) {
        res.status(401).json({ error: "unauthorized" });
        return;
    }
    const b = (req.body ?? {});
    const orderId = String(b.orderId ?? "").trim().slice(0, 64);
    const lat = num(b.lat);
    const lng = num(b.lng);
    if (!orderId) {
        res.status(400).json({ error: "order_id_required" });
        return;
    }
    if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        res.status(400).json({ error: "bad_coords" });
        return;
    }
    positions.set(orderId, {
        lat,
        lng,
        accuracy: num(b.accuracy),
        heading: num(b.heading),
        speed: num(b.speed),
        ts: num(b.ts) ?? Date.now(),
        updatedAt: Date.now(),
    });
    res.json({ ok: true });
});
// ── Клиент ← сервер (пуллинг позиции курьера) ───────────────────────────────
router.get("/api/order/location", (0, middleware_1.rateLimit)(60), (req, res) => {
    const orderId = String(req.query.orderId ?? "").trim().slice(0, 64);
    if (!orderId) {
        res.status(400).json({ error: "order_id_required" });
        return;
    }
    const expectedToken = orderTrackingToken(orderId);
    const suppliedToken = String(req.header("x-order-tracking-token") ?? "");
    const courierAuthorized = Boolean(process.env.DELIVERY_TOKEN)
        && (0, middleware_1.safeEq)(bearer(req), process.env.DELIVERY_TOKEN);
    if (!expectedToken) {
        res.status(503).json({ error: "tracking_not_configured" });
        return;
    }
    if (!courierAuthorized && !(0, middleware_1.safeEq)(suppliedToken, expectedToken)) {
        res.status(403).json({ error: "forbidden" });
        return;
    }
    const p = positions.get(orderId);
    if (!p || Date.now() - p.updatedAt > TTL_MS) {
        if (p)
            positions.delete(orderId); // протухло — чистим
        res.json({ tracking: false, position: null });
        return;
    }
    res.json({
        tracking: true,
        position: {
            lat: p.lat,
            lng: p.lng,
            accuracy: p.accuracy,
            heading: p.heading,
            speed: p.speed,
            ts: p.ts,
            ageMs: Date.now() - p.updatedAt,
        },
    });
});
// Периодическая чистка протухших, чтобы Map не рос без границ.
const sweep = setInterval(() => {
    const now = Date.now();
    let dropped = 0;
    for (const [k, v] of positions) {
        if (now - v.updatedAt > TTL_MS) {
            positions.delete(k);
            dropped++;
        }
    }
    if (dropped)
        logger_1.log.debug({ dropped, live: positions.size }, "[order-location] sweep");
}, 5 * 60 * 1000);
sweep.unref?.(); // не держать процесс живым ради таймера
exports.default = router;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Pet routes — виртуальный питомец «Котик Марии».
 * - GET  /api/pet                 — состояние (с применённым decay)
 * - POST /api/pet/action {action} — уход: feed|sleep|wash|play
 * - POST /api/pet/location {location} — сменить локацию
 */
const express_1 = require("express");
const pet_1 = require("../pet");
const middleware_1 = require("../middleware");
const game_auth_1 = require("../game-auth");
const logger_1 = require("../logger");
const router = (0, express_1.Router)();
router.get("/api/pet", game_auth_1.requireTgUser, (0, middleware_1.rateLimit)(60), async (req, res) => {
    const u = (0, game_auth_1.getTgUser)(req);
    try {
        res.json(await (0, pet_1.getPet)(u.id));
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[GET /api/pet]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/pet/action", game_auth_1.requireTgUser, (0, middleware_1.rateLimit)(60), async (req, res) => {
    const u = (0, game_auth_1.getTgUser)(req);
    const action = String(req.body.action || "");
    try {
        const r = await (0, pet_1.doPetAction)(u.id, action);
        if (!r.ok) {
            res.status(400).json({ error: r.reason });
            return;
        }
        res.json({ ...r.state, streakBonus: r.streakBonus ?? 0, careStreak: r.careStreak ?? r.state?.careStreak ?? 0 });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id, action }, "[POST /api/pet/action]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/pet/location", game_auth_1.requireTgUser, (0, middleware_1.rateLimit)(60), async (req, res) => {
    const u = (0, game_auth_1.getTgUser)(req);
    const location = String(req.body.location || "");
    try {
        const r = await (0, pet_1.setPetLocation)(u.id, location);
        if (!r.ok) {
            res.status(400).json({ error: r.reason });
            return;
        }
        res.json(r.state);
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[POST /api/pet/location]");
        res.status(500).json({ error: "internal" });
    }
});
// Каталог магазина (публичный, без авторизации)
router.get("/api/pet/shop", (_req, res) => res.json({ shop: pet_1.SHOP }));
router.post("/api/pet/buy", game_auth_1.requireTgUser, (0, middleware_1.rateLimit)(40), async (req, res) => {
    const u = (0, game_auth_1.getTgUser)(req);
    const item = String(req.body.item || "");
    try {
        const r = await (0, pet_1.buyPetItem)(u.id, item);
        if (!r.ok) {
            res.status(400).json({ error: r.reason });
            return;
        }
        res.json(r.state);
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id, item }, "[POST /api/pet/buy]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/pet/equip", game_auth_1.requireTgUser, (0, middleware_1.rateLimit)(60), async (req, res) => {
    const u = (0, game_auth_1.getTgUser)(req);
    const item = String(req.body.item || "");
    try {
        const r = await (0, pet_1.equipPetItem)(u.id, item);
        if (!r.ok) {
            res.status(400).json({ error: r.reason });
            return;
        }
        res.json(r.state);
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id, item }, "[POST /api/pet/equip]");
        res.status(500).json({ error: "internal" });
    }
});
exports.default = router;

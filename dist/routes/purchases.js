"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../auth");
const middleware_1 = require("../middleware");
const game_auth_1 = require("../game-auth");
const club_1 = require("../club");
const purchase1c_1 = require("../purchase1c");
const router = (0, express_1.Router)();
router.get("/api/clicker/purchase-tasks", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(60), async (req, res) => {
    const user = (0, auth_1.getTgUser)(req);
    try {
        res.json({ tasks: await (0, purchase1c_1.getPurchaseTasks)(user.id), claims: await (0, purchase1c_1.getPurchaseTaskClaims)(user.id), phoneVerified: await (0, club_1.isPhoneVerified)(user.id) });
    }
    catch {
        res.status(500).json({ error: "internal" });
    }
});
// Manual admin sync is useful for acceptance tests; normal sync is scheduled.
router.post("/api/admin/purchases/sync", middleware_1.requireAdminToken, (0, middleware_1.rateLimit)(10), async (req, res) => {
    try {
        const result = await (0, purchase1c_1.syncPurchases)(typeof req.body?.period === "string" ? req.body.period : undefined);
        res.json(result);
    }
    catch {
        res.status(502).json({ error: "purchase_sync_failed" });
    }
});
router.get("/api/admin/purchase-tasks", middleware_1.requireAdminToken, (0, middleware_1.rateLimit)(30), async (_req, res) => {
    try {
        const { pool } = await Promise.resolve().then(() => __importStar(require("../db")));
        const { rows } = await pool.query(`SELECT id,title,description,product_codes AS "productCodes",store_codes AS "storeCodes",min_qty AS "minQty",min_amount AS "minAmount",reward_coins AS "rewardCoins",loyalty_points AS "loyaltyPoints",starts_at AS "startsAt",ends_at AS "endsAt",max_claims AS "maxClaims",is_active AS "isActive" FROM purchase_tasks ORDER BY id DESC`);
        res.json({ tasks: rows });
    }
    catch {
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/admin/purchase-tasks", middleware_1.requireAdminToken, (0, middleware_1.rateLimit)(20), async (req, res) => {
    const b = req.body ?? {};
    const title = String(b.title ?? "").trim();
    const productCodes = Array.isArray(b.productCodes) ? b.productCodes.map(String).map((x) => x.trim()).filter(Boolean) : [];
    if (!title || !productCodes.length) {
        res.status(400).json({ error: "title_and_productCodes_required" });
        return;
    }
    try {
        const { pool } = await Promise.resolve().then(() => __importStar(require("../db")));
        const { rows } = await pool.query(`INSERT INTO purchase_tasks (title,description,product_codes,store_codes,min_qty,min_amount,reward_coins,loyalty_points,starts_at,ends_at,max_claims) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::timestamptz,NOW()),$10,$11) RETURNING id`, [title, String(b.description ?? ""), productCodes, Array.isArray(b.storeCodes) ? b.storeCodes.map(String) : [], Math.max(0.01, Number(b.minQty) || 1), Math.max(0, Number(b.minAmount) || 0), Math.max(0, Math.floor(Number(b.rewardCoins) || 0)), Math.max(0, Math.floor(Number(b.loyaltyPoints) || 0)), b.startsAt ?? null, b.endsAt ?? null, b.maxClaims == null ? null : Math.max(1, Math.floor(Number(b.maxClaims) || 1))]);
        res.status(201).json({ id: rows[0].id });
    }
    catch {
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/admin/purchase-tasks/:id/disable", middleware_1.requireAdminToken, (0, middleware_1.rateLimit)(30), async (req, res) => {
    try {
        const { pool } = await Promise.resolve().then(() => __importStar(require("../db")));
        await pool.query(`UPDATE purchase_tasks SET is_active=false WHERE id=$1`, [Number(req.params.id)]);
        res.json({ ok: true });
    }
    catch {
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/admin/purchase-card-links", middleware_1.requireAdminToken, (0, middleware_1.rateLimit)(30), async (req, res) => {
    const cardCode = String(req.body?.cardCode ?? "").trim();
    const chatId = Number(req.body?.chatId);
    if (!cardCode || !Number.isSafeInteger(chatId) || chatId <= 0) {
        res.status(400).json({ error: "cardCode_and_chatId_required" });
        return;
    }
    try {
        const { pool } = await Promise.resolve().then(() => __importStar(require("../db")));
        await pool.query(`INSERT INTO purchase_card_links(card_code,chat_id) VALUES($1,$2) ON CONFLICT(card_code) DO UPDATE SET chat_id=EXCLUDED.chat_id`, [cardCode, chatId]);
        res.json({ ok: true });
    }
    catch {
        res.status(500).json({ error: "internal" });
    }
});
exports.default = router;

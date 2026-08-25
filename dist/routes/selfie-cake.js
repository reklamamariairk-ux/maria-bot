"use strict";
/**
 * Selfie-cake routes — AI-портрет на торте (img2img через Pollinations).
 *
 * - POST /api/selfie-cake       — принимает base64 фото → возвращает 3 концепта
 * - GET  /api/selfie-img/:id    — публичная раздача сохранённого селфи
 *                                 (Pollinations скачивает по этому URL)
 *
 * SSRF-защита: baseUrl для скачивания строится из WEBHOOK_URL/MINI_APP_URL env,
 * не из заголовков. ID = 128-бит random + path-traversal regex в readSelfie.
 */
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
const express_1 = __importStar(require("express"));
const cake_concept_1 = require("../cake-concept");
const selfie_cake_1 = require("../selfie-cake");
const middleware_1 = require("../middleware");
const auth_1 = require("../auth");
const logger_1 = require("../logger");
const router = (0, express_1.Router)();
router.post("/api/selfie-cake", auth_1.requireTgUser, (0, middleware_1.rateLimit)(3), 
// 6 МБ бинарного файла превращаются примерно в 8 МБ base64 + JSON overhead.
express_1.default.json({ limit: "9mb" }), async (req, res) => {
    const healthy = await (0, cake_concept_1.isConceptEnabled)();
    if (!healthy) {
        res.status(503).json({ error: "not_configured", message: "Сервис временно недоступен. Попробуй позже." });
        return;
    }
    const body = req.body;
    const b64 = String(body.image_b64 ?? "");
    if (!b64) {
        res.status(400).json({ error: "no_image" });
        return;
    }
    try {
        // Pollinations должен мочь скачать наш selfie. baseUrl берётся из ENV (WEBHOOK_URL
        // или MINI_APP_URL), НЕ из request-заголовков — иначе атакующий через подделку
        // X-Forwarded-Host превратит наш API в SSRF-прокси (Pollinations скачает с evil.com).
        const baseUrl = (process.env.WEBHOOK_URL || process.env.MINI_APP_URL || "").trim();
        if (!baseUrl) {
            res.status(503).json({ error: "no_base_url", message: "Сервис не сконфигурирован." });
            return;
        }
        const stored = await (0, selfie_cake_1.storeSelfie)(b64, baseUrl);
        const variants = (0, selfie_cake_1.generateSelfieCakes)(stored.publicUrl);
        res.json({ ok: true, variants, selfie_id: stored.id });
    }
    catch (e) {
        const msg = e.message;
        logger_1.log.error({ err: e }, "[selfie-cake]");
        if (msg === "bad_image_format") {
            res.status(400).json({ error: "bad_format", message: "Поддерживаются JPG, PNG, WebP" });
        }
        else if (msg === "image_too_large") {
            res.status(400).json({ error: "too_large", message: "Размер фото — до 6 МБ" });
        }
        else if (msg === "image_too_small") {
            res.status(400).json({ error: "too_small", message: "Слишком маленькое фото" });
        }
        else {
            res.status(500).json({ error: "internal", message: "Что-то пошло не так. Попробуй ещё раз." });
        }
    }
});
// Публичная раздача временных selfie (Pollinations скачивает по этому URL).
// Защита: 128-бит random ID + path-traversal regex в readSelfie.
router.get("/api/selfie-img/:id", (0, middleware_1.rateLimit)(120), async (req, res) => {
    const id = String(req.params.id || "");
    const file = await (0, selfie_cake_1.readSelfie)(id);
    if (!file) {
        res.status(404).end();
        return;
    }
    res.setHeader("Content-Type", file.type);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.end(file.buf);
});
exports.default = router;

"use strict";
/**
 * Leads + voice transcribe routes.
 *
 * - POST /api/lead             — индивидуальный заказ торта → лид в Bitrix24 CRM
 * - POST /api/lead-corporate   — B2B-заказ → лид в Bitrix24 с тэгом «корпоратив»
 * - POST /api/transcribe       — голосовой ввод → Groq Whisper → текст (RU)
 *
 * Все три самостоятельны (Bitrix24 https + Groq fetch).
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importStar(require("express"));
const https_1 = __importDefault(require("https"));
const path_1 = __importDefault(require("path"));
const fsSync = __importStar(require("fs"));
const crypto = __importStar(require("crypto"));
const middleware_1 = require("../middleware");
const logger_1 = require("../logger");
const router = (0, express_1.Router)();
const BITRIX_WEBHOOK = () => process.env.BITRIX_WEBHOOK ?? "";
// Fire-and-forget копия лида в дашборд кампании (maria-marketing) для расчёта
// CPL/CAC/ROAS по каналам. Не блокирует ответ клиенту, ошибки只 логируются.
function pushLeadToMarketing(payload) {
    const url = process.env.MARKETING_INGEST_URL ?? "";
    if (!url)
        return;
    const token = process.env.MARKETING_INGEST_TOKEN ?? "";
    fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { "X-Ingest-Token": token } : {}) },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
    }).then((r) => {
        if (!r.ok)
            logger_1.log.warn({ status: r.status }, "[LEAD→mk] ingest non-200");
    }).catch((e) => logger_1.log.warn({ err: e.message }, "[LEAD→mk] ingest failed"));
}
// ─── Индивидуальный заказ торта ─────────────────────────────────────────────
router.post("/api/lead", (0, middleware_1.rateLimit)(10), express_1.default.json({ limit: "20mb" }), async (req, res) => {
    const { name, phone, description, date, portions, comment, photo, photos, source, utm } = req.body;
    if (!name || !phone) {
        res.status(400).json({ error: "Имя и телефон обязательны" });
        return;
    }
    // Источник лида (для атрибуции рекламных каналов в CRM). По умолчанию — Mini App.
    const srcLabel = (typeof source === "string" && source.trim()) ? source.trim().slice(0, 80) : "Telegram Mini App";
    // UTM-метки рекламной кампании → одна строка в комментарий + SOURCE_DESCRIPTION
    const utmStr = utm && typeof utm === "object"
        ? ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]
            .map((k) => (utm[k] ? `${k}=${String(utm[k]).slice(0, 80)}` : null))
            .filter(Boolean).join(" · ")
        : "";
    // Копия лида в дашборд кампании (не ждём ответа)
    pushLeadToMarketing({ name, phone, source: srcLabel, utm, description, portions, comment });
    // До трёх фото-референсов → /tmp + отдельные URL в комментарии лида.
    // `photo` оставлен как fallback для старых клиентов.
    const photoInputs = (Array.isArray(photos) ? photos : (photo ? [photo] : []))
        .filter((v) => typeof v === "string")
        .slice(0, 3);
    const photoUrls = [];
    for (const photoInput of photoInputs) {
        try {
            const m = photoInput.match(/^data:image\/(jpe?g|png|webp);base64,([A-Za-z0-9+/=]+)$/i);
            if (m) {
                const ext = /^jpe?g$/i.test(m[1]) ? "jpg" : m[1].toLowerCase();
                const buf = Buffer.from(m[2], "base64");
                if (buf.length > 0 && buf.length <= 4 * 1024 * 1024) {
                    const id = crypto.randomBytes(8).toString("hex");
                    const dir = path_1.default.join("/tmp", "lead_photos");
                    fsSync.mkdirSync(dir, { recursive: true });
                    const fname = `${Date.now()}_${id}.${ext}`;
                    fsSync.writeFileSync(path_1.default.join(dir, fname), buf);
                    const base = (process.env.MINI_APP_URL || process.env.WEBHOOK_URL || "").replace(/\/$/, "");
                    photoUrls.push(`${base}/lead-photo/${fname}`);
                }
            }
        }
        catch (e) {
            logger_1.log.warn({ err: e }, "[LEAD] photo save failed");
        }
    }
    const title = `Заказ торта — ${name} (${srcLabel})`;
    const comments = [
        description && `Торт: ${description}`,
        date && `Дата: ${date}`,
        portions && `Порций: ${portions}`,
        comment && `Комментарий: ${comment}`,
        ...photoUrls.map((url, i) => `Фото референса ${i + 1}: ${url}`),
        utmStr && `UTM: ${utmStr}`,
    ].filter(Boolean).join("\n");
    const webhook = BITRIX_WEBHOOK();
    if (!webhook) {
        logger_1.log.warn("[ORDER] BITRIX_WEBHOOK not set, lead not created");
        res.json({ ok: true, warn: "no_webhook" });
        return;
    }
    try {
        const body = JSON.stringify({
            fields: {
                TITLE: title,
                NAME: name,
                PHONE: [{ VALUE: phone, VALUE_TYPE: "WORK" }],
                COMMENTS: comments,
                SOURCE_ID: "WEB",
                SOURCE_DESCRIPTION: [srcLabel, utmStr].filter(Boolean).join(" · "),
            },
        });
        await new Promise((resolve, reject) => {
            const url = new URL(`${webhook}crm.lead.add.json`);
            const r = https_1.default.request({
                hostname: url.hostname,
                path: url.pathname + url.search,
                method: "POST",
                headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
            }, (resp) => {
                let d = "";
                resp.on("data", (c) => (d += c));
                resp.on("end", () => {
                    const json = JSON.parse(d);
                    if (json.error)
                        reject(new Error(json.error_description ?? json.error));
                    else
                        resolve();
                });
            });
            r.on("error", reject);
            r.write(body);
            r.end();
        });
        logger_1.log.info({ name }, "[ORDER] Lead created");
        res.json({ ok: true });
    }
    catch (e) {
        logger_1.log.error({ err: e }, "[ORDER] Bitrix24 sync failed");
        res.status(502).json({ error: "Не удалось создать заявку, попробуйте позже" });
    }
});
// ─── B2B (корпоративные заказы) ─────────────────────────────────────────────
router.post("/api/lead-corporate", (0, middleware_1.rateLimit)(5), express_1.default.json({ limit: "1mb" }), async (req, res) => {
    const b = req.body;
    if (!b.contact_name || !b.phone) {
        res.status(400).json({ error: "Контактное лицо и телефон обязательны" });
        return;
    }
    const people = Number(b.people) || 0;
    const extras = Array.isArray(b.extras) ? b.extras.filter((s) => typeof s === "string").slice(0, 10) : [];
    const company = (b.company || "").trim() || "—";
    const title = `🏢 Корпоратив · ${company} · ${b.contact_name}`;
    const lines = [];
    lines.push(`▼ Компания: ${company}`);
    lines.push(`▼ Контакт: ${b.contact_name}`);
    if (b.phone)
        lines.push(`☎ Телефон: ${b.phone}`);
    if (b.email)
        lines.push(`✉ Email: ${b.email}`);
    lines.push("");
    if (b.event_type)
        lines.push(`🎯 Тип события: ${b.event_type}`);
    if (people > 0)
        lines.push(`👥 Кол-во гостей: ${people}`);
    if (b.budget)
        lines.push(`💰 Бюджет: ${b.budget}`);
    if (b.date)
        lines.push(`📅 Дата: ${b.date}${b.time ? " · " + b.time : ""}`);
    if (b.address)
        lines.push(`📍 Адрес доставки: ${b.address}`);
    if (extras.length > 0) {
        lines.push("");
        lines.push("⚙ Доп. услуги:");
        for (const e of extras)
            lines.push(`  • ${e}`);
    }
    if (b.comment) {
        lines.push("");
        lines.push(`ⓘ Комментарий:`);
        lines.push(b.comment);
    }
    const comments = lines.join("\n");
    const webhook = BITRIX_WEBHOOK();
    if (!webhook) {
        logger_1.log.warn("[B2B] BITRIX_WEBHOOK not set, lead not created");
        res.json({ ok: true, warn: "no_webhook" });
        return;
    }
    try {
        const parts = String(b.contact_name).trim().split(/\s+/);
        const firstName = parts[0] || b.contact_name;
        const lastName = parts.slice(1).join(" ");
        const fields = {
            TITLE: title,
            NAME: firstName,
            LAST_NAME: lastName,
            COMPANY_TITLE: company !== "—" ? company : undefined,
            PHONE: [{ VALUE: b.phone, VALUE_TYPE: "WORK" }],
            COMMENTS: comments,
            SOURCE_ID: "WEB",
            SOURCE_DESCRIPTION: "Telegram Mini App · B2B",
        };
        if (b.email)
            fields.EMAIL = [{ VALUE: b.email, VALUE_TYPE: "WORK" }];
        if (b.address)
            fields.ADDRESS = b.address;
        const body = JSON.stringify({ fields });
        await new Promise((resolve, reject) => {
            const base = webhook.endsWith("/") ? webhook : webhook + "/";
            const url = new URL(`${base}crm.lead.add.json`);
            const r = https_1.default.request({
                hostname: url.hostname,
                path: url.pathname + url.search,
                method: "POST",
                headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
            }, (resp) => {
                let d = "";
                resp.on("data", (c) => (d += c));
                resp.on("end", () => {
                    try {
                        const json = JSON.parse(d);
                        if (json.error)
                            reject(new Error(json.error_description ?? json.error));
                        else
                            resolve();
                    }
                    catch (e) {
                        reject(e);
                    }
                });
            });
            r.on("error", reject);
            r.write(body);
            r.end();
        });
        logger_1.log.info({ company, contact: b.contact_name }, "[B2B] Lead created");
        res.json({ ok: true });
    }
    catch (e) {
        logger_1.log.error({ err: e }, "[B2B] Bitrix24 sync failed");
        res.status(502).json({ error: "Не удалось создать заявку, попробуйте позже" });
    }
});
// ─── Voice transcribe (Groq Whisper) ────────────────────────────────────────
router.post("/api/transcribe", (0, middleware_1.rateLimit)(20), express_1.default.raw({ type: ["audio/*", "application/octet-stream"], limit: "6mb" }), async (req, res) => {
    const audio = req.body;
    if (!Buffer.isBuffer(audio) || audio.length === 0) {
        res.status(400).json({ error: "audio body required" });
        return;
    }
    if (audio.length > 5 * 1024 * 1024) {
        res.status(413).json({ error: "audio too large (>5MB)" });
        return;
    }
    const ct = String(req.headers["content-type"] || "audio/webm");
    const ext = /mp4|m4a/i.test(ct) ? "m4a" : /ogg/i.test(ct) ? "ogg" : /wav/i.test(ct) ? "wav" : "webm";
    const groqKey = process.env.GROQ_KEY ?? "";
    if (!groqKey) {
        res.status(503).json({ error: "GROQ_KEY не задан" });
        return;
    }
    try {
        const fd = new FormData();
        fd.append("file", new Blob([audio], { type: ct }), `voice.${ext}`);
        fd.append("model", "whisper-large-v3-turbo");
        fd.append("language", "ru");
        fd.append("response_format", "json");
        fd.append("temperature", "0");
        const resp = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${groqKey}` },
            body: fd,
        });
        if (!resp.ok) {
            const errText = await resp.text();
            logger_1.log.error({ status: resp.status, body: errText.slice(0, 200) }, "[TRANSCRIBE] Groq error");
            if (resp.status === 429) {
                res.status(429).json({ error: "Распознавание временно недоступно (лимит). Попробуй через минуту." });
            }
            else {
                res.status(502).json({ error: "Распознавание не удалось. Попробуй ещё раз или напиши текстом." });
            }
            return;
        }
        const data = await resp.json();
        const text = (data.text ?? "").trim();
        res.json({ text });
    }
    catch (e) {
        logger_1.log.error({ err: e }, "[TRANSCRIBE]");
        res.status(500).json({ error: "Ошибка распознавания. Попробуй ещё раз." });
    }
});
exports.default = router;

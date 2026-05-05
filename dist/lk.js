"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchLk = fetchLk;
const https_1 = __importDefault(require("https"));
const db_1 = require("./db");
const LK_API = process.env.LK_API ?? ""; // https://www.maria-irk.ru/local/api/lk.php
const LK_TOKEN = process.env.LK_TOKEN ?? "";
function fetchJson(url) {
    return new Promise((resolve, reject) => {
        const req = https_1.default.get(url, { rejectUnauthorized: false }, (r) => {
            let body = "";
            r.on("data", (c) => (body += c));
            r.on("end", () => {
                try {
                    resolve(JSON.parse(body));
                }
                catch (e) {
                    reject(e);
                }
            });
        });
        req.on("error", reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error("Timeout")); });
    });
}
async function getVerifiedPhone(chatId) {
    const { rows } = await db_1.pool.query(`SELECT phone FROM subscribers WHERE chat_id = $1 AND phone_verified_at IS NOT NULL`, [chatId]);
    return rows[0]?.phone ?? null;
}
async function fetchLk(chatId) {
    if (!LK_API || !LK_TOKEN) {
        return {
            ok: true,
            data: { found: false, configured: false },
        };
    }
    const phone = await getVerifiedPhone(chatId);
    if (!phone)
        return { ok: false, reason: "phone_not_verified" };
    try {
        const sep = LK_API.includes("?") ? "&" : "?";
        const url = `${LK_API}${sep}token=${encodeURIComponent(LK_TOKEN)}&phone=${encodeURIComponent(phone)}`;
        const raw = (await fetchJson(url));
        if (raw.error)
            return { ok: false, reason: String(raw.error) };
        return {
            ok: true,
            data: {
                found: Boolean(raw.found),
                name: raw.name ?? null,
                level: raw.level ?? null,
                balance: Number(raw.balance ?? 0),
                year_spent: Number(raw.year_spent ?? 0),
                tickets: Array.isArray(raw.tickets) ? raw.tickets : [],
                configured: true,
            },
        };
    }
    catch (e) {
        console.error("[LK]", e.message);
        return { ok: false, reason: "service_error" };
    }
}

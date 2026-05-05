"use strict";
/**
 * Создание заказа: бот-обёртка вокруг /api/order-create.php на сайте.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOrder = createOrder;
const https_1 = __importDefault(require("https"));
const ORDER_API = process.env.ORDER_API ?? ""; // https://www.maria-irk.ru/api/order-create.php
const ORDER_TOKEN = process.env.ORDER_TOKEN ?? ""; // shared
async function createOrder(req) {
    if (!ORDER_API || !ORDER_TOKEN) {
        return { ok: false, error: "order_api_not_configured" };
    }
    if (!req.phone || !req.name || !Array.isArray(req.items) || req.items.length === 0) {
        return { ok: false, error: "missing_fields" };
    }
    return new Promise((resolve) => {
        const sep = ORDER_API.includes("?") ? "&" : "?";
        const url = `${ORDER_API}${sep}token=${encodeURIComponent(ORDER_TOKEN)}`;
        const body = JSON.stringify(req);
        const u = new URL(url);
        const opts = {
            hostname: u.hostname,
            port: u.port || 443,
            path: u.pathname + u.search,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
            },
            rejectUnauthorized: false,
        };
        const httpReq = https_1.default.request(opts, (r) => {
            let d = "";
            r.on("data", (c) => (d += c));
            r.on("end", () => {
                try {
                    const json = JSON.parse(d);
                    resolve(json);
                }
                catch (e) {
                    resolve({ ok: false, error: `bad_response:${e.message}` });
                }
            });
        });
        httpReq.on("error", (e) => resolve({ ok: false, error: e.message }));
        httpReq.setTimeout(20000, () => { httpReq.destroy(); resolve({ ok: false, error: "timeout" }); });
        httpReq.write(body);
        httpReq.end();
    });
}

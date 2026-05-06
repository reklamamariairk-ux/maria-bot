"use strict";
/**
 * Создание заказа: бот-обёртка вокруг /api/order-create.php на сайте.
 * Дополнительно — создание deal в Bitrix24 (CRM) через входящий webhook,
 * чтобы менеджер увидел заявку в B24 сразу, не дожидаясь Sale-sync.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOrder = createOrder;
const https_1 = __importDefault(require("https"));
const ORDER_API = process.env.ORDER_API ?? ""; // https://www.maria-irk.ru/api/order-create.php
const ORDER_TOKEN = process.env.ORDER_TOKEN ?? ""; // shared
const B24_WEBHOOK = process.env.BITRIX_WEBHOOK ?? ""; // https://b24.maria-irk.ru/rest/USER_ID/HASH/
async function createOrder(req) {
    if (!ORDER_API || !ORDER_TOKEN) {
        return { ok: false, error: "order_api_not_configured" };
    }
    if (!req.phone || !req.name || !Array.isArray(req.items) || req.items.length === 0) {
        return { ok: false, error: "missing_fields" };
    }
    // 1) Создание заказа в Bitrix Sale (b_sale_order)
    const saleResult = await callJsonPost(`${ORDER_API}${ORDER_API.includes("?") ? "&" : "?"}token=${encodeURIComponent(ORDER_TOKEN)}`, req);
    if (!saleResult.ok) {
        return saleResult;
    }
    // 2) Параллельно — создание deal в Bitrix24 CRM (для менеджера)
    // Не блокирует ответ юзеру — fire-and-log.
    if (B24_WEBHOOK) {
        pushToBitrix24(req, saleResult).catch((e) => {
            console.error("[B24] failed:", e.message);
        });
    }
    return saleResult;
}
function callJsonPost(url, body) {
    return new Promise((resolve) => {
        const u = new URL(url);
        const payload = JSON.stringify(body);
        const opts = {
            hostname: u.hostname,
            port: u.port || 443,
            path: u.pathname + u.search,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
            },
            rejectUnauthorized: false,
        };
        const httpReq = https_1.default.request(opts, (r) => {
            let d = "";
            r.on("data", (c) => (d += c));
            r.on("end", () => {
                try {
                    resolve(JSON.parse(d));
                }
                catch (e) {
                    resolve({ ok: false, error: `bad_response:${e.message}` });
                }
            });
        });
        httpReq.on("error", (e) => resolve({ ok: false, error: e.message }));
        httpReq.setTimeout(20000, () => { httpReq.destroy(); resolve({ ok: false, error: "timeout" }); });
        httpReq.write(payload);
        httpReq.end();
    });
}
async function pushToBitrix24(req, sale) {
    const itemsList = req.items.map((i) => `• [#${i.id}] ×${i.qty}`).join("\n");
    const tail = (req.phone || "").replace(/\D/g, "").slice(-10);
    const phoneFmt = tail ? `+7 (${tail.slice(0, 3)}) ${tail.slice(3, 6)}-${tail.slice(6, 8)}-${tail.slice(8, 10)}` : req.phone;
    const nameParts = (req.name || "").trim().split(/\s+/);
    const firstName = nameParts[0] || req.name;
    const lastName = nameParts.slice(1).join(" ");
    const title = `🍰 Заказ #${sale.orderId ?? '—'} · ${req.name}`;
    // Структурированный комментарий — менеджер видит всё подряд в правой панели лида
    const lines = [];
    lines.push(`💰 Сумма: ${sale.total ?? '?'} ₽`);
    lines.push(`📞 Телефон: ${phoneFmt}`);
    if (req.email)
        lines.push(`✉️ Email: ${req.email}`);
    if (req.address)
        lines.push(`📍 Адрес: ${req.address}`);
    if (req.delivery_date)
        lines.push(`📅 Дата доставки: ${req.delivery_date}`);
    if (req.delivery_time)
        lines.push(`⏰ Время доставки: ${req.delivery_time}`);
    lines.push("");
    lines.push("🛒 Состав заказа:");
    lines.push(itemsList);
    if (req.comment) {
        lines.push("");
        lines.push("ℹ️ Контекст клиента:");
        lines.push(req.comment);
    }
    lines.push("");
    lines.push(`🔗 Заказ в Sale: https://www.maria-irk.ru/bitrix/admin/sale_order_view.php?ID=${sale.orderId ?? ''}`);
    const comments = lines.join("\n");
    const fields = {
        TITLE: title,
        NAME: firstName,
        LAST_NAME: lastName,
        PHONE: [{ VALUE: req.phone, VALUE_TYPE: "WORK" }],
        COMMENTS: comments,
        SOURCE_ID: "WEB",
        SOURCE_DESCRIPTION: "Telegram Mini App",
        OPPORTUNITY: sale.total ?? 0,
        CURRENCY_ID: "RUB",
    };
    if (req.email)
        fields.EMAIL = [{ VALUE: req.email, VALUE_TYPE: "WORK" }];
    if (req.address)
        fields.ADDRESS = req.address;
    const url = B24_WEBHOOK.endsWith("/") ? B24_WEBHOOK + "crm.lead.add.json" : B24_WEBHOOK + "/crm.lead.add.json";
    const result = await callJsonPost(url, { fields });
    console.log(`[B24] lead for #${sale.orderId} →`, JSON.stringify(result).substring(0, 300));
}

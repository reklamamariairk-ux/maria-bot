/**
 * Создание заказа: бот-обёртка вокруг /api/order-create.php на сайте.
 * Дополнительно — создание deal в Bitrix24 (CRM) через входящий webhook,
 * чтобы менеджер увидел заявку в B24 сразу, не дожидаясь Sale-sync.
 */

import https from "https";

const ORDER_API   = process.env.ORDER_API   ?? ""; // https://www.maria-irk.ru/api/order-create.php
const ORDER_TOKEN = process.env.ORDER_TOKEN ?? ""; // shared
const B24_WEBHOOK = process.env.BITRIX_WEBHOOK ?? ""; // https://b24.maria-irk.ru/rest/USER_ID/HASH/

export interface OrderItem {
  id: number;
  qty: number;
}

export interface OrderRequest {
  phone: string;
  name: string;
  items: OrderItem[];
  address?: string;
  delivery_date?: string;
  delivery_time?: string;
  comment?: string;
  email?: string;
}

export interface OrderResult {
  ok: boolean;
  orderId?: number;
  accountNumber?: string;
  total?: number;
  currency?: string;
  message?: string;
  error?: string;
}

export async function createOrder(req: OrderRequest): Promise<OrderResult> {
  if (!ORDER_API || !ORDER_TOKEN) {
    return { ok: false, error: "order_api_not_configured" };
  }
  if (!req.phone || !req.name || !Array.isArray(req.items) || req.items.length === 0) {
    return { ok: false, error: "missing_fields" };
  }

  // 1) Создание заказа в Bitrix Sale (b_sale_order)
  const saleResult = await callJsonPost(
    `${ORDER_API}${ORDER_API.includes("?") ? "&" : "?"}token=${encodeURIComponent(ORDER_TOKEN)}`,
    req,
  ) as OrderResult;

  if (!saleResult.ok) {
    return saleResult;
  }

  // 2) Параллельно — создание deal в Bitrix24 CRM (для менеджера)
  // Не блокирует ответ юзеру — fire-and-log.
  if (B24_WEBHOOK) {
    pushToBitrix24(req, saleResult).catch((e) => {
      console.error("[B24] failed:", (e as Error).message);
    });
  }

  return saleResult;
}

function callJsonPost(url: string, body: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    const u = new URL(url);
    const payload = JSON.stringify(body);
    const opts: https.RequestOptions = {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: "POST",
      headers: {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
      rejectUnauthorized: false,
    };
    const httpReq = https.request(opts, (r) => {
      let d = "";
      r.on("data", (c: Buffer) => (d += c));
      r.on("end", () => {
        try { resolve(JSON.parse(d)); }
        catch (e) { resolve({ ok: false, error: `bad_response:${(e as Error).message}` }); }
      });
    });
    httpReq.on("error", (e) => resolve({ ok: false, error: e.message }));
    httpReq.setTimeout(20_000, () => { httpReq.destroy(); resolve({ ok: false, error: "timeout" }); });
    httpReq.write(payload);
    httpReq.end();
  });
}

async function pushToBitrix24(req: OrderRequest, sale: OrderResult): Promise<void> {
  const itemsList = req.items.map((i) => `• [#${i.id}] ×${i.qty}`).join("\n");
  const tail = (req.phone || "").replace(/\D/g, "").slice(-10);
  const phoneFmt = tail ? `+7 (${tail.slice(0,3)}) ${tail.slice(3,6)}-${tail.slice(6,8)}-${tail.slice(8,10)}` : req.phone;

  const title = `🍰 Заказ из Telegram-бота #${sale.orderId ?? '—'} · ${req.name}`;
  const comments = [
    `Сумма: ${sale.total ?? '?'} ₽`,
    `Телефон: ${phoneFmt}`,
    req.address       ? `Адрес: ${req.address}`               : null,
    req.delivery_date ? `Дата:  ${req.delivery_date}`          : null,
    req.delivery_time ? `Время: ${req.delivery_time}`          : null,
    req.email         ? `Email: ${req.email}`                  : null,
    `\nСостав:\n${itemsList}`,
    req.comment       ? `\n${req.comment}`                     : null,
    `\n→ В Sale админке: www.maria-irk.ru/bitrix/admin/sale_order_view.php?ID=${sale.orderId ?? ''}`,
  ].filter(Boolean).join("\n");

  const fields = {
    TITLE: title,
    NAME: (req.name || "").split(/\s+/)[0] || req.name,
    LAST_NAME: (req.name || "").split(/\s+/).slice(1).join(" ") || "",
    PHONE: [{ VALUE: req.phone, VALUE_TYPE: "WORK" }],
    EMAIL: req.email ? [{ VALUE: req.email, VALUE_TYPE: "WORK" }] : undefined,
    COMMENTS: comments,
    SOURCE_ID: "WEB",
    SOURCE_DESCRIPTION: "Telegram Mini App",
    OPPORTUNITY: sale.total ?? 0,
    CURRENCY_ID: "RUB",
  };

  // Используем crm.lead.add — самый простой и универсальный
  const url = B24_WEBHOOK.endsWith("/") ? B24_WEBHOOK + "crm.lead.add.json" : B24_WEBHOOK + "/crm.lead.add.json";
  const result = await callJsonPost(url, { fields });
  console.log(`[B24] lead created for order #${sale.orderId}:`, JSON.stringify(result).substring(0, 200));
}

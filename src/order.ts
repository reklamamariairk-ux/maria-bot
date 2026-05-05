/**
 * Создание заказа: бот-обёртка вокруг /api/order-create.php на сайте.
 */

import https from "https";

const ORDER_API   = process.env.ORDER_API   ?? ""; // https://www.maria-irk.ru/api/order-create.php
const ORDER_TOKEN = process.env.ORDER_TOKEN ?? ""; // shared

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

  return new Promise((resolve) => {
    const sep = ORDER_API.includes("?") ? "&" : "?";
    const url = `${ORDER_API}${sep}token=${encodeURIComponent(ORDER_TOKEN)}`;
    const body = JSON.stringify(req);

    const u = new URL(url);
    const opts: https.RequestOptions = {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: "POST",
      headers: {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      rejectUnauthorized: false,
    };
    const httpReq = https.request(opts, (r) => {
      let d = "";
      r.on("data", (c: Buffer) => (d += c));
      r.on("end", () => {
        try {
          const json = JSON.parse(d);
          resolve(json as OrderResult);
        } catch (e) {
          resolve({ ok: false, error: `bad_response:${(e as Error).message}` });
        }
      });
    });
    httpReq.on("error", (e) => resolve({ ok: false, error: e.message }));
    httpReq.setTimeout(20_000, () => { httpReq.destroy(); resolve({ ok: false, error: "timeout" }); });
    httpReq.write(body);
    httpReq.end();
  });
}

import https from "https";
import { pool } from "./db";

const LK_API     = process.env.LK_API     ?? ""; // https://www.maria-irk.ru/api/lk.php
const LK_TOKEN   = process.env.LK_TOKEN   ?? "";
const ORDERS_API = process.env.ORDERS_API ?? ""; // https://www.maria-irk.ru/api/orders.php

export interface LkOrder {
  id: number;
  date: string;
  sum: number;
  currency: string;
  status: string;
  paid: boolean;
  canceled: boolean;
  items: { name: string; qty: number; price: number }[];
}

export interface LkData {
  found: boolean;
  name?: string | null;
  level?: string | null;
  balance?: number;
  year_spent?: number;
  tickets?: { id: string; name: string; date: string }[];
  tickets_count?: number;
  orders?: LkOrder[];
  configured: boolean;
}

function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (r) => {
      let body = "";
      r.on("data", (c: Buffer) => (body += c));
      r.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

export async function getVerifiedPhone(chatId: number): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT phone FROM subscribers WHERE chat_id = $1 AND phone_verified_at IS NOT NULL`,
    [chatId]
  );
  return rows[0]?.phone ?? null;
}

export async function fetchLk(chatId: number): Promise<{
  ok: boolean;
  reason?: string;
  data?: LkData;
}> {
  if (!LK_API || !LK_TOKEN) {
    return {
      ok: true,
      data: { found: false, configured: false },
    };
  }

  const phone = await getVerifiedPhone(chatId);
  if (!phone) return { ok: false, reason: "phone_not_verified" };

  try {
    const sep = LK_API.includes("?") ? "&" : "?";
    const url = `${LK_API}${sep}token=${encodeURIComponent(LK_TOKEN)}&phone=${encodeURIComponent(phone)}`;
    const raw = (await fetchJson(url)) as Record<string, unknown>;
    if (raw.error) return { ok: false, reason: String(raw.error) };

    const ticketsRaw = raw.tickets;

    // Параллельно подтягиваем историю заказов (best-effort, не валим LK если упало)
    let orders: LkOrder[] = [];
    if (ORDERS_API) {
      try {
        const sep2 = ORDERS_API.includes("?") ? "&" : "?";
        const u2 = `${ORDERS_API}${sep2}token=${encodeURIComponent(LK_TOKEN)}&phone=${encodeURIComponent(phone)}`;
        const o = (await fetchJson(u2)) as Record<string, unknown>;
        if (Array.isArray(o.orders)) {
          orders = o.orders as LkOrder[];
        }
      } catch (e) {
        console.error("[ORDERS]", (e as Error).message);
      }
    }

    return {
      ok: true,
      data: {
        found:         Boolean(raw.found) || orders.length > 0,
        name:          (raw.name as string | null) ?? null,
        level:         (raw.level as string | null) ?? null,
        balance:       Number(raw.balance ?? 0),
        year_spent:    Number(raw.year_spent ?? 0),
        tickets:       Array.isArray(ticketsRaw) ? (ticketsRaw as { id: string; name: string; date: string }[]) : [],
        tickets_count: typeof raw.tickets_count === "number"
          ? raw.tickets_count
          : (typeof ticketsRaw === "number" ? ticketsRaw : (Array.isArray(ticketsRaw) ? ticketsRaw.length : 0)),
        orders,
        configured:    true,
      },
    };
  } catch (e) {
    console.error("[LK]", (e as Error).message);
    return { ok: false, reason: "service_error" };
  }
}

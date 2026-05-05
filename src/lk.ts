import https from "https";
import { pool } from "./db";

const LK_API   = process.env.LK_API   ?? ""; // https://www.maria-irk.ru/local/api/lk.php
const LK_TOKEN = process.env.LK_TOKEN ?? "";

export interface LkData {
  found: boolean;
  name?: string | null;
  level?: string | null;
  balance?: number;
  year_spent?: number;
  tickets?: { id: string; name: string; date: string }[];
  configured: boolean;
}

function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { rejectUnauthorized: false }, (r) => {
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

async function getVerifiedPhone(chatId: number): Promise<string | null> {
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

    return {
      ok: true,
      data: {
        found:      Boolean(raw.found),
        name:       (raw.name as string | null) ?? null,
        level:      (raw.level as string | null) ?? null,
        balance:    Number(raw.balance ?? 0),
        year_spent: Number(raw.year_spent ?? 0),
        tickets:    Array.isArray(raw.tickets) ? (raw.tickets as { id: string; name: string; date: string }[]) : [],
        configured: true,
      },
    };
  } catch (e) {
    console.error("[LK]", (e as Error).message);
    return { ok: false, reason: "service_error" };
  }
}

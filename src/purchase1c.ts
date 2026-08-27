import { pool } from "./db";
import { enqueueAccrual, enqueueAdjustment } from "./bonus1c";
import { log } from "./logger";

type SaleRow = {
  date?: string; storeCode?: string; chequeNo?: string | number; operation?: string;
  cardCode?: string; cardName?: string; phone?: string; productCode?: string;
  qty?: number | string; sum?: number | string; discount?: number | string;
};

const SALES_API = (process.env.PURCHASE_SALES_API ?? "").trim();
const SALES_KEY = (process.env.PURCHASE_SALES_API_KEY ?? "").trim();
export function purchaseSyncConfigured(): boolean { return Boolean(SALES_API && SALES_KEY); }
let purchaseNotifier: ((chatId: number, text: string) => Promise<unknown>) | null = null;
export function setPurchaseNotifier(fn: (chatId: number, text: string) => Promise<unknown>): void { purchaseNotifier = fn; }

export async function initPurchaseSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS purchase_tasks (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      product_codes TEXT[] NOT NULL DEFAULT '{}',
      store_codes TEXT[] NOT NULL DEFAULT '{}',
      min_qty NUMERIC(12,2) NOT NULL DEFAULT 1 CHECK (min_qty > 0),
      min_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (min_amount >= 0),
      reward_coins BIGINT NOT NULL DEFAULT 0 CHECK (reward_coins >= 0),
      loyalty_points INT NOT NULL DEFAULT 0 CHECK (loyalty_points >= 0),
      starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ends_at TIMESTAMPTZ,
      max_claims INT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS purchase_tasks_active_idx ON purchase_tasks (is_active, starts_at, ends_at);
    CREATE TABLE IF NOT EXISTS purchase_events (
      id BIGSERIAL PRIMARY KEY,
      event_key TEXT NOT NULL UNIQUE,
      receipt_id TEXT NOT NULL,
      operation TEXT NOT NULL DEFAULT 'sale',
      sold_at TIMESTAMPTZ NOT NULL,
      store_code TEXT,
      card_code TEXT,
      card_name TEXT,
      phone TEXT,
      product_code TEXT NOT NULL,
      qty NUMERIC(12,2) NOT NULL DEFAULT 0,
      amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS purchase_events_phone_idx ON purchase_events (phone, sold_at DESC);
    CREATE INDEX IF NOT EXISTS purchase_events_card_idx ON purchase_events (card_code, sold_at DESC);
    CREATE TABLE IF NOT EXISTS purchase_card_links (
      card_code TEXT PRIMARY KEY,
      chat_id BIGINT NOT NULL REFERENCES subscribers(chat_id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS purchase_claims (
      id BIGSERIAL PRIMARY KEY,
      task_id BIGINT NOT NULL REFERENCES purchase_tasks(id),
      chat_id BIGINT NOT NULL,
      event_id BIGINT NOT NULL REFERENCES purchase_events(id),
      reward_coins BIGINT NOT NULL DEFAULT 0,
      loyalty_points INT NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','reversed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reversed_at TIMESTAMPTZ,
      UNIQUE (task_id, chat_id, event_id)
    );
    CREATE INDEX IF NOT EXISTS purchase_claims_chat_idx ON purchase_claims (chat_id, created_at DESC);
  `);
}

function digits(value: unknown): string {
  const d = String(value ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}
function periodNow(): string {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function asNumber(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function isSale(operation: string): boolean { return !/возврат|return|refund/i.test(operation); }

async function fetchRows(period: string): Promise<SaleRow[]> {
  if (!purchaseSyncConfigured()) return [];
  const url = `${SALES_API}${SALES_API.includes("?") ? "&" : "?"}period=${encodeURIComponent(period)}&limit=200000`;
  // Supports both the public sales-dashboard proxy and the internal
  // maria-marketing feed used on the VPS.
  const res = await fetch(url, { headers: { "X-API-Key": SALES_KEY, "X-Ingest-Token": SALES_KEY }, signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`sales_api_http_${res.status}`);
  const body = await res.json() as { rows?: SaleRow[] };
  return Array.isArray(body.rows) ? body.rows : [];
}

/** Imports receipt lines and settles all matching active tasks. Safe to run repeatedly. */
export async function syncPurchases(period = periodNow()): Promise<{ rows: number; imported: number; rewarded: number }> {
  const rows = await fetchRows(period);
  let imported = 0; let rewarded = 0;
  for (const row of rows) {
    const receipt = String(row.chequeNo ?? "").trim();
    const product = String(row.productCode ?? "").trim();
    const soldAt = new Date(String(row.date ?? ""));
    if (!receipt || !product || Number.isNaN(soldAt.getTime())) continue;
    const operation = String(row.operation ?? "sale");
    const eventKey = `${soldAt.toISOString()}|${String(row.storeCode ?? "")}|${receipt}|${product}|${operation}`;
    const phone = digits(row.phone);
    const inserted = await pool.query(
      `INSERT INTO purchase_events (event_key, receipt_id, operation, sold_at, store_code, card_code, card_name, phone, product_code, qty, amount, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (event_key) DO NOTHING RETURNING id`,
      [eventKey, receipt, operation, soldAt.toISOString(), row.storeCode ?? null, row.cardCode ?? null,
       row.cardName ?? null, phone || null, product, asNumber(row.qty), asNumber(row.sum), row]
    );
    if (!inserted.rows[0]) continue;
    imported++;
    if (!isSale(operation)) { await reverseEvent(Number(inserted.rows[0].id), phone, String(row.cardCode ?? "").trim(), product); continue; }
    if (!phone && !String(row.cardCode ?? "").trim()) continue;
    const { rows: users } = await pool.query<{ chat_id: number }>(
      `SELECT chat_id FROM subscribers WHERE RIGHT(regexp_replace(COALESCE(phone,''),'\\D','','g'),10)=$1 AND phone_verified_at IS NOT NULL
       UNION SELECT chat_id FROM purchase_card_links WHERE card_code=$2`, [phone, String(row.cardCode ?? "").trim()]
    );
    for (const user of users) rewarded += await settleEvent(Number(user.chat_id), Number(inserted.rows[0].id), product, row);
  }
  return { rows: rows.length, imported, rewarded };
}

async function reverseEvent(eventId: number, phone: string, cardCode: string, product: string): Promise<void> {
  const { rows } = await pool.query<any>(
    `SELECT pc.id,pc.chat_id,pc.reward_coins,pc.loyalty_points,pe.phone
       FROM purchase_claims pc JOIN purchase_events pe ON pe.id=pc.event_id
      WHERE pc.status='confirmed' AND pe.product_code=$1 AND (pe.phone=$2 OR ($3<>'' AND pe.card_code=$3))
      ORDER BY pc.created_at DESC LIMIT 20`, [product, phone, cardCode]
  );
  for (const claim of rows) {
    const updated = await pool.query(`UPDATE purchase_claims SET status='reversed',reversed_at=NOW() WHERE id=$1 AND status='confirmed'`, [claim.id]);
    if (!updated.rowCount) continue;
    if (Number(claim.reward_coins) > 0) await pool.query(`UPDATE clicker_state SET balance=GREATEST(0,balance-$2),state_revision=state_revision+1,updated_at=NOW() WHERE chat_id=$1`, [claim.chat_id, Number(claim.reward_coins)]);
    if (Number(claim.loyalty_points) > 0 && claim.phone) await enqueueAdjustment(claim.phone, -Number(claim.loyalty_points), `purchase_return`, `purchase-return:${claim.id}`);
    break;
  }
}

async function settleEvent(chatId: number, eventId: number, product: string, row: SaleRow): Promise<number> {
  const qty = asNumber(row.qty); const amount = asNumber(row.sum);
  const client = await pool.connect();
  const notifications: string[] = [];
  try {
    await client.query("BEGIN");
    const { rows: tasks } = await client.query<any>(
      `SELECT * FROM purchase_tasks WHERE is_active AND starts_at <= NOW() AND (ends_at IS NULL OR ends_at >= NOW())
       AND ($1 = ANY(product_codes)) AND ($2 = 0 OR $2 >= min_qty) AND ($3 >= min_amount)
       AND (cardinality(store_codes)=0 OR $4 = ANY(store_codes)) ORDER BY id FOR UPDATE`,
      [product, qty, amount, row.storeCode ?? ""]
    );
    let count = 0;
    for (const task of tasks) {
      if (task.max_claims != null) {
        const c = await client.query(`SELECT COUNT(*)::int AS n FROM purchase_claims WHERE task_id=$1 AND status='confirmed'`, [task.id]);
        if (Number(c.rows[0]?.n) >= Number(task.max_claims)) continue;
      }
      const claim = await client.query(
        `INSERT INTO purchase_claims (task_id,chat_id,event_id,reward_coins,loyalty_points) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`,
        [task.id, chatId, eventId, Number(task.reward_coins), Number(task.loyalty_points)]
      );
      if (!claim.rows[0]) continue;
      if (Number(task.reward_coins) > 0) {
        await client.query(`UPDATE clicker_state SET balance=balance+$2,total_earned=total_earned+$2,state_revision=state_revision+1,updated_at=NOW() WHERE chat_id=$1`, [chatId, Number(task.reward_coins)]);
      }
      if (Number(task.loyalty_points) > 0) {
        const { rows: p } = await client.query(`SELECT phone FROM subscribers WHERE chat_id=$1 AND phone_verified_at IS NOT NULL`, [chatId]);
        if (p[0]?.phone) await enqueueAccrual(p[0].phone, Number(task.loyalty_points), `purchase_task:${task.id}`, `purchase:${task.id}:${eventId}:${chatId}`);
      }
      const rewardText = [Number(task.reward_coins) > 0 ? `+${Number(task.reward_coins).toLocaleString('ru-RU')} монет` : '', Number(task.loyalty_points) > 0 ? `+${Number(task.loyalty_points).toLocaleString('ru-RU')} баллов лояльности` : ''].filter(Boolean).join(' и ');
      notifications.push(`🎉 Покупка засчитана!\n\n${task.title}\nНаграда: ${rewardText}.`);
      count++;
    }
    await client.query("COMMIT");
    if (purchaseNotifier) for (const text of notifications) await purchaseNotifier(chatId, text).catch(() => {});
    return count;
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}

export async function getPurchaseTasks(chatId: number): Promise<any[]> {
  const { rows } = await pool.query(
    `SELECT t.id,t.title,t.description,t.product_codes AS "productCodes",t.store_codes AS "storeCodes",t.min_qty AS "minQty",t.min_amount AS "minAmount",t.reward_coins AS "rewardCoins",t.loyalty_points AS "loyaltyPoints",t.starts_at AS "startsAt",t.ends_at AS "endsAt",c.status
       FROM purchase_tasks t LEFT JOIN purchase_claims c ON c.task_id=t.id AND c.chat_id=$1 AND c.status='confirmed'
      WHERE t.is_active AND t.starts_at <= NOW() AND (t.ends_at IS NULL OR t.ends_at >= NOW()) ORDER BY t.id`, [chatId]
  );
  return rows.map(r => ({ ...r, status: r.status ?? "active" }));
}

export async function getPurchaseTaskClaims(chatId: number): Promise<any[]> {
  const { rows } = await pool.query(`SELECT pc.id,pc.task_id AS "taskId",pc.reward_coins AS "rewardCoins",pc.loyalty_points AS "loyaltyPoints",pc.status,pc.created_at AS "createdAt",pe.receipt_id AS "receiptId",pe.sold_at AS "soldAt",pe.store_code AS "storeCode",pe.product_code AS "productCode" FROM purchase_claims pc JOIN purchase_events pe ON pe.id=pc.event_id WHERE pc.chat_id=$1 ORDER BY pc.created_at DESC LIMIT 100`, [chatId]);
  return rows;
}

export async function runPurchaseSync(): Promise<void> {
  if (!purchaseSyncConfigured()) return;
  try { const r = await syncPurchases(); log.info(r, "[purchases] sync complete"); }
  catch (e) { log.error({ err: e }, "[purchases] sync failed"); }
}

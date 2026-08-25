/**
 * Начисление бонусов на карту клиента в 1С (по телефону).
 *
 * Реальная карта лояльности живёт в 1С (f_base_2023, HTTP-сервис /hs/Website/).
 * Игровые/клубные бонусы (earnPoints) зеркалим туда через идемпотентный OUTBOX:
 *   earnPoints → enqueueAccrual(phone, amount, reason, key) → bonus_outbox
 *   воркер (раз в 60с) → POST на шлюз bonus-add.php (на maria-irk.ru, в whitelist 1С)
 *                      → 1С POST /f_base_2023/hs/Website/BonusAdd
 *
 * Идемпотентность: idem_key (= pt:<point_transaction.id>) уникален → одна заявка
 * на одно начисление. Воркер шлёт key в 1С → 1С может дедуплицировать при ретрае.
 * Если интеграция не настроена (нет BONUS_ADD_API) — enqueue/flush это no-op.
 */
import { pool } from "./db";
import { log } from "./logger";
import { safeEq } from "./middleware";

const BONUS_ADD_API = process.env.BONUS_ADD_API ?? "";       // push-режим: шлюз на сайте
const BONUS_ADD_TOKEN = process.env.BONUS_ADD_TOKEN ?? "";
const BONUS_QUEUE_TOKEN = process.env.BONUS_QUEUE_TOKEN ?? ""; // pull-режим: токен для 1С, которая забирает очередь
const MAX_ATTEMPTS = 8;
const BATCH = 25;

// Очередь активна, если настроен ЛЮБОЙ режим: push (шлюз) ИЛИ pull (1С тянет сама).
export function bonusSyncEnabled(): boolean {
  return Boolean(BONUS_ADD_API || BONUS_QUEUE_TOKEN);
}
export function queueAuthOk(token: string | undefined): boolean {
  return Boolean(BONUS_QUEUE_TOKEN) && safeEq(token, BONUS_QUEUE_TOKEN);
}

/** PULL-режим: 1С забирает pending-начисления. Возвращает список к зачислению. */
export async function getBonusQueue(limit = 100): Promise<{ id: number; phone: string; amount: number; reason: string | null; key: string | null }[]> {
  const lim = Math.max(1, Math.min(500, Math.floor(limit) || 100));
  const rows = await claimBonusRows(lim);
  return rows.map((r) => ({ id: Number(r.id), phone: r.phone, amount: r.amount, reason: r.reason, key: r.idem_key }));
}

/** PULL-режим: 1С подтверждает зачисление — помечаем строки отправленными. */
export async function ackBonusQueue(ids: number[]): Promise<number> {
  const clean = (Array.isArray(ids) ? ids : []).map((x) => Math.floor(Number(x))).filter((x) => Number.isFinite(x) && x > 0);
  if (!clean.length) return 0;
  const { rowCount } = await pool.query(
    `UPDATE bonus_outbox SET status='sent', sent_at=NOW(), processing_at=NULL, last_error=NULL
      WHERE id = ANY($1::bigint[]) AND status='processing'`,
    [clean]
  );
  return rowCount || 0;
}

export async function initBonusSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bonus_outbox (
      id         BIGSERIAL PRIMARY KEY,
      phone      TEXT NOT NULL,
      amount     INT NOT NULL,
      reason     TEXT,
      idem_key   TEXT UNIQUE,
      status     TEXT NOT NULL DEFAULT 'pending',
      attempts   INT NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sent_at    TIMESTAMPTZ
    );
    ALTER TABLE bonus_outbox ADD COLUMN IF NOT EXISTS processing_at TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS bonus_outbox_pending ON bonus_outbox (id) WHERE status = 'pending';
  `);
}

/** Поставить начисление в очередь на 1С (no-op, если интеграция не настроена). */
export async function enqueueAccrual(phone: string, amount: number, reason: string, idemKey?: string): Promise<void> {
  if (!bonusSyncEnabled()) return;
  const p = String(phone || "").replace(/\D+/g, "");
  const a = Math.floor(Number(amount) || 0);
  if (!p || a <= 0) return;
  await pool.query(
    `INSERT INTO bonus_outbox (phone, amount, reason, idem_key) VALUES ($1,$2,$3,$4)
     ON CONFLICT (idem_key) DO NOTHING`,
    [p, a, reason || null, idemKey || null]
  ).catch((e) => log.error({ err: e }, "[bonus] enqueue"));
}

async function postOne(row: { id: number; phone: string; amount: number; reason: string | null; idem_key: string | null }): Promise<void> {
  const key = row.idem_key || `outbox-${row.id}`;
  const r = await fetch(BONUS_ADD_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: BONUS_ADD_TOKEN, phone: row.phone, amount: row.amount, reason: row.reason || "", key }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`http_${r.status}:${(await r.text().catch(() => "")).slice(0, 200)}`);
  const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (j && j.ok === false) throw new Error(`gateway:${j.error || "unknown"}`);
}

type BonusRow = { id: number; phone: string; amount: number; reason: string | null; idem_key: string | null; attempts: number };

/** Атомарная аренда строк: параллельный worker/1С не получают одну запись. */
async function claimBonusRows(limit: number): Promise<BonusRow[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE bonus_outbox SET status='pending', processing_at=NULL
        WHERE status='processing' AND processing_at < NOW() - INTERVAL '10 minutes'`,
    );
    const selected = await client.query(
      `SELECT id FROM bonus_outbox
        WHERE status='pending' AND attempts < $1
        ORDER BY id FOR UPDATE SKIP LOCKED LIMIT $2`,
      [MAX_ATTEMPTS, limit],
    );
    const ids = selected.rows.map((row) => Number(row.id));
    if (!ids.length) { await client.query("COMMIT"); return []; }
    const claimed = await client.query(
      `UPDATE bonus_outbox SET status='processing', processing_at=NOW()
        WHERE id=ANY($1::bigint[])
        RETURNING id, phone, amount, reason, idem_key, attempts`,
      [ids],
    );
    await client.query("COMMIT");
    return claimed.rows as BonusRow[];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

let flushRunning = false;
export async function flushBonusOutbox(): Promise<void> {
  if (!BONUS_ADD_API || flushRunning) return;
  flushRunning = true;
  try {
    const rows = await claimBonusRows(BATCH);
    for (const row of rows) {
      try {
        await postOne(row);
        await pool.query(
          `UPDATE bonus_outbox SET status='sent', sent_at=NOW(), processing_at=NULL, last_error=NULL
            WHERE id=$1 AND status='processing'`,
          [row.id],
        );
      } catch (e) {
        const attempts = Number(row.attempts) + 1;
        const status = attempts >= MAX_ATTEMPTS ? "failed" : "pending";
        await pool.query(
          `UPDATE bonus_outbox SET attempts=$2, status=$3, processing_at=NULL, last_error=$4
            WHERE id=$1 AND status='processing'`,
          [row.id, attempts, status, String((e as Error).message).slice(0, 300)]
        ).catch(() => {});
        if (status === "failed") log.error({ outboxId: row.id, err: (e as Error).message }, "[bonus] accrual FAILED (max attempts)");
      }
    }
  } finally {
    flushRunning = false;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startBonusWorker(): void {
  if (!BONUS_ADD_API || timer) return;
  // первый прогон со сдвигом + далее раз в минуту
  setTimeout(() => flushBonusOutbox().catch((e) => log.error({ err: e }, "[bonus] flush")), 8000);
  timer = setInterval(() => flushBonusOutbox().catch((e) => log.error({ err: e }, "[bonus] flush")), 60000);
  log.info("[bonus] 1С accrual worker started");
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bonusSyncEnabled = bonusSyncEnabled;
exports.queueAuthOk = queueAuthOk;
exports.getBonusQueue = getBonusQueue;
exports.ackBonusQueue = ackBonusQueue;
exports.initBonusSchema = initBonusSchema;
exports.enqueueAccrual = enqueueAccrual;
exports.enqueueAdjustment = enqueueAdjustment;
exports.flushBonusOutbox = flushBonusOutbox;
exports.startBonusWorker = startBonusWorker;
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
const db_1 = require("./db");
const logger_1 = require("./logger");
const middleware_1 = require("./middleware");
const BONUS_ADD_API = process.env.BONUS_ADD_API ?? ""; // push-режим: шлюз на сайте
const BONUS_ADD_TOKEN = process.env.BONUS_ADD_TOKEN ?? "";
const BONUS_QUEUE_TOKEN = process.env.BONUS_QUEUE_TOKEN ?? ""; // pull-режим: токен для 1С, которая забирает очередь
const MAX_ATTEMPTS = 8;
const BATCH = 25;
// Очередь активна, если настроен ЛЮБОЙ режим: push (шлюз) ИЛИ pull (1С тянет сама).
function bonusSyncEnabled() {
    return Boolean(BONUS_ADD_API || BONUS_QUEUE_TOKEN);
}
function queueAuthOk(token) {
    return Boolean(BONUS_QUEUE_TOKEN) && (0, middleware_1.safeEq)(token, BONUS_QUEUE_TOKEN);
}
/** PULL-режим: 1С забирает pending-начисления. Возвращает список к зачислению. */
async function getBonusQueue(limit = 100) {
    const lim = Math.max(1, Math.min(500, Math.floor(limit) || 100));
    const rows = await claimBonusRows(lim);
    return rows.map((r) => ({ id: Number(r.id), phone: r.phone, amount: r.amount, reason: r.reason, key: r.idem_key }));
}
/** PULL-режим: 1С подтверждает зачисление — помечаем строки отправленными. */
async function ackBonusQueue(ids) {
    const clean = (Array.isArray(ids) ? ids : []).map((x) => Math.floor(Number(x))).filter((x) => Number.isFinite(x) && x > 0);
    if (!clean.length)
        return 0;
    const { rowCount } = await db_1.pool.query(`UPDATE bonus_outbox SET status='sent', sent_at=NOW(), processing_at=NULL, last_error=NULL
      WHERE id = ANY($1::bigint[]) AND status='processing'`, [clean]);
    return rowCount || 0;
}
async function initBonusSchema() {
    await db_1.pool.query(`
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
async function enqueueAccrual(phone, amount, reason, idemKey) {
    if (!bonusSyncEnabled())
        return;
    const p = String(phone || "").replace(/\D+/g, "");
    const a = Math.floor(Number(amount) || 0);
    if (!p || a <= 0)
        return;
    await db_1.pool.query(`INSERT INTO bonus_outbox (phone, amount, reason, idem_key) VALUES ($1,$2,$3,$4)
     ON CONFLICT (idem_key) DO NOTHING`, [p, a, reason || null, idemKey || null]).catch((e) => logger_1.log.error({ err: e }, "[bonus] enqueue"));
}
async function postOne(row) {
    const key = row.idem_key || `outbox-${row.id}`;
    const r = await fetch(BONUS_ADD_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: BONUS_ADD_TOKEN, phone: row.phone, amount: row.amount, reason: row.reason || "", key }),
        signal: AbortSignal.timeout(15000),
    });
    if (!r.ok)
        throw new Error(`http_${r.status}:${(await r.text().catch(() => "")).slice(0, 200)}`);
    const j = (await r.json().catch(() => null));
    if (j && j.ok === false)
        throw new Error(`gateway:${j.error || "unknown"}`);
}
/** Сторнирующее начисление (возврат покупки). 1С получает отрицательную сумму. */
async function enqueueAdjustment(phone, amount, reason, idemKey) {
    if (!bonusSyncEnabled())
        return;
    const p = String(phone || "").replace(/\D+/g, "");
    const a = Math.floor(Number(amount) || 0);
    if (!p || a === 0)
        return;
    await db_1.pool.query(`INSERT INTO bonus_outbox (phone, amount, reason, idem_key) VALUES ($1,$2,$3,$4) ON CONFLICT (idem_key) DO NOTHING`, [p, a, reason || null, idemKey || null]).catch((e) => logger_1.log.error({ err: e }, "[bonus] enqueue adjustment"));
}
/** Атомарная аренда строк: параллельный worker/1С не получают одну запись. */
async function claimBonusRows(limit) {
    const client = await db_1.pool.connect();
    try {
        await client.query("BEGIN");
        await client.query(`UPDATE bonus_outbox SET status='pending', processing_at=NULL
        WHERE status='processing' AND processing_at < NOW() - INTERVAL '10 minutes'`);
        const selected = await client.query(`SELECT id FROM bonus_outbox
        WHERE status='pending' AND attempts < $1
        ORDER BY id FOR UPDATE SKIP LOCKED LIMIT $2`, [MAX_ATTEMPTS, limit]);
        const ids = selected.rows.map((row) => Number(row.id));
        if (!ids.length) {
            await client.query("COMMIT");
            return [];
        }
        const claimed = await client.query(`UPDATE bonus_outbox SET status='processing', processing_at=NOW()
        WHERE id=ANY($1::bigint[])
        RETURNING id, phone, amount, reason, idem_key, attempts`, [ids]);
        await client.query("COMMIT");
        return claimed.rows;
    }
    catch (error) {
        await client.query("ROLLBACK").catch(() => { });
        throw error;
    }
    finally {
        client.release();
    }
}
let flushRunning = false;
async function flushBonusOutbox() {
    if (!BONUS_ADD_API || flushRunning)
        return;
    flushRunning = true;
    try {
        const rows = await claimBonusRows(BATCH);
        for (const row of rows) {
            try {
                await postOne(row);
                await db_1.pool.query(`UPDATE bonus_outbox SET status='sent', sent_at=NOW(), processing_at=NULL, last_error=NULL
            WHERE id=$1 AND status='processing'`, [row.id]);
            }
            catch (e) {
                const attempts = Number(row.attempts) + 1;
                const status = attempts >= MAX_ATTEMPTS ? "failed" : "pending";
                await db_1.pool.query(`UPDATE bonus_outbox SET attempts=$2, status=$3, processing_at=NULL, last_error=$4
            WHERE id=$1 AND status='processing'`, [row.id, attempts, status, String(e.message).slice(0, 300)]).catch(() => { });
                if (status === "failed")
                    logger_1.log.error({ outboxId: row.id, err: e.message }, "[bonus] accrual FAILED (max attempts)");
            }
        }
    }
    finally {
        flushRunning = false;
    }
}
let timer = null;
function startBonusWorker() {
    if (!BONUS_ADD_API || timer)
        return;
    // первый прогон со сдвигом + далее раз в минуту
    setTimeout(() => flushBonusOutbox().catch((e) => logger_1.log.error({ err: e }, "[bonus] flush")), 8000);
    timer = setInterval(() => flushBonusOutbox().catch((e) => logger_1.log.error({ err: e }, "[bonus] flush")), 60000);
    logger_1.log.info("[bonus] 1С accrual worker started");
}

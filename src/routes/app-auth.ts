/**
 * Вход в maria-app через Telegram (device-flow, без SMS-провайдера и шлюзов сайта).
 *
 * Поток:
 *   1. Приложение: POST /api/app/auth/start → {nonce, link} (link = t.me/<bot>?start=applogin_<nonce>)
 *   2. Клиент открывает ссылку → бот просит «Поделиться номером» (reply-keyboard, криптографически
 *      верифицированный contact — тот же путь, что и клуб) → :contact связывает телефон с nonce.
 *   3. Приложение поллит GET /api/app/auth/poll?nonce= → {status:"ok", token, phone}.
 *   4. Токен (HMAC, 30 дней) ходит в GET /api/app/lk → мост на Timeweb VDS (whitelist 1С) →
 *      живые бонусы и последние покупки по телефону.
 *
 * Телефон в токене — ЕДИНСТВЕННЫЙ источник identity; выдаётся только после
 * verifyPhone-совместимой верификации (:contact, c.user_id === ctx.from.id).
 */
import crypto from "crypto";
import { Router } from "express";
import { pool } from "../db";
import { rateLimit } from "../middleware";

const BOT_TOKEN = process.env.BOT_TOKEN ?? "";
const BOT_USERNAME = process.env.BOT_USERNAME ?? "mariatortik_bot";
const APP_BRIDGE_URL = process.env.APP_BRIDGE_URL ?? "";     // напр. http://186.246.14.117
const APP_BRIDGE_TOKEN = process.env.APP_BRIDGE_TOKEN ?? "";
const NONCE_TTL_MIN = 10;
const TOKEN_TTL_S = 30 * 24 * 3600;

// Ключ подписи app-токенов — производный от BOT_TOKEN (отдельный env не нужен,
// ротация BOT_TOKEN инвалидирует сессии приложения — приемлемо).
const signKey = BOT_TOKEN
  ? crypto.createHmac("sha256", "MariaAppAuth").update(BOT_TOKEN).digest()
  : null;

export async function initAppAuthSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_login_nonces (
      nonce      TEXT PRIMARY KEY,
      chat_id    BIGINT,
      phone      TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function signAppToken(phone: string): string {
  if (!signKey) throw new Error("app_auth_not_configured");
  const payload = b64url(Buffer.from(JSON.stringify({ p: phone, e: Math.floor(Date.now() / 1000) + TOKEN_TTL_S })));
  const sig = b64url(crypto.createHmac("sha256", signKey).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyAppToken(token: string): { phone: string } | null {
  if (!signKey) return null;
  const [payload, sig] = String(token || "").split(".");
  if (!payload || !sig) return null;
  const expect = b64url(crypto.createHmac("sha256", signKey).update(payload).digest());
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    if (!data.p || !data.e || data.e < Date.now() / 1000) return null;
    return { phone: String(data.p) };
  } catch {
    return null;
  }
}

/** /start applogin_<nonce>: привязать чат к nonce (телефон придёт в :contact). */
export async function attachAppLoginChat(nonce: string, chatId: number): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rowCount } = await client.query(
      `UPDATE app_login_nonces SET chat_id = $2
        WHERE nonce = $1 AND phone IS NULL AND created_at > NOW() - INTERVAL '${NONCE_TTL_MIN} minutes'`,
      [nonce, chatId]
    );
    if (!rowCount) { await client.query("ROLLBACK"); return false; }
    // У одного чата может быть только один активный device-flow. Иначе один
    // contact завершал сразу все когда-либо открытые устройства.
    await client.query(
      `UPDATE app_login_nonces SET chat_id=NULL
        WHERE chat_id=$1 AND nonce<>$2 AND phone IS NULL`,
      [chatId, nonce],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** :contact: если у чата есть свежий pending-nonce — завершить вход. Вернёт true, если вход состоялся. */
export async function completeAppLogin(chatId: number, phone: string): Promise<boolean> {
  const clean = phone.replace(/[^\d+]/g, "");
  const { rowCount } = await pool.query(
    `UPDATE app_login_nonces SET phone = $2
      WHERE nonce = (
        SELECT nonce FROM app_login_nonces
         WHERE chat_id = $1 AND phone IS NULL
           AND created_at > NOW() - INTERVAL '${NONCE_TTL_MIN} minutes'
         ORDER BY created_at DESC, nonce DESC LIMIT 1
      )`,
    [chatId, clean]
  );
  return (rowCount ?? 0) > 0;
}

const router = Router();

// Rate-limit на выдачу nonce: без него любой может спамить app_login_nonces.
// 10 запросов/мин на IP; окно скользящее, карта чистится лениво.
const startHits = new Map<string, number[]>();
function startRateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (startHits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (arr.length >= 10) { startHits.set(ip, arr); return true; }
  arr.push(now);
  startHits.set(ip, arr);
  if (startHits.size > 5000) {
    for (const [k, v] of startHits) if (!v.some((t) => now - t < 60_000)) startHits.delete(k);
    if (startHits.size > 5000) startHits.delete(startHits.keys().next().value!);
  }
  return false;
}

router.post("/auth/start", async (req, res) => {
  if (!BOT_TOKEN) { res.status(503).json({ ok: false, error: "app_auth_not_configured" }); return; }
  const ip = String(req.ip || req.socket.remoteAddress || "unknown");
  if (startRateLimited(ip)) { res.status(429).json({ ok: false, error: "rate_limited" }); return; }
  const nonce = crypto.randomBytes(16).toString("hex");
  await pool.query(`INSERT INTO app_login_nonces (nonce) VALUES ($1)`, [nonce]);
  // Ленивая уборка протухших nonce (дешёвая, раз на выдачу)
  pool.query(`DELETE FROM app_login_nonces WHERE created_at < NOW() - INTERVAL '1 hour'`).catch(() => {});
  res.json({ ok: true, nonce, link: `https://t.me/${BOT_USERNAME}?start=applogin_${nonce}` });
});

router.get("/auth/poll", rateLimit(120), async (req, res) => {
  const nonce = String(req.query.nonce || "");
  if (!/^[a-f0-9]{32}$/.test(nonce)) { res.status(400).json({ ok: false, error: "bad_nonce" }); return; }
  // DELETE ... RETURNING делает выдачу токена одноразовой даже при двух
  // одновременных poll-запросах.
  const completed = await pool.query(
    `DELETE FROM app_login_nonces
      WHERE nonce = $1 AND phone IS NOT NULL
        AND created_at > NOW() - INTERVAL '${NONCE_TTL_MIN} minutes'
      RETURNING phone`,
    [nonce]
  );
  if (completed.rows[0]?.phone) {
    const phone = String(completed.rows[0].phone);
    res.json({ ok: true, status: "ok", token: signAppToken(phone), phone });
    return;
  }
  const pending = await pool.query(
    `SELECT 1 FROM app_login_nonces
      WHERE nonce=$1 AND phone IS NULL
        AND created_at > NOW() - INTERVAL '${NONCE_TTL_MIN} minutes'`,
    [nonce],
  );
  if (pending.rowCount) { res.json({ ok: true, status: "pending" }); return; }
  res.status(410).json({ ok: false, error: "expired" });
});

router.get("/lk", async (req, res) => {
  const m = String(req.headers.authorization || "").match(/^Bearer (.+)$/);
  const auth = m ? verifyAppToken(m[1]) : null;
  if (!auth) { res.status(401).json({ ok: false, error: "unauthorized" }); return; }
  if (!APP_BRIDGE_URL || !APP_BRIDGE_TOKEN) { res.status(503).json({ ok: false, error: "bridge_not_configured" }); return; }
  try {
    // Аутентификация к мосту — HMAC-подпись `phone:ts`, а не сырой токен: секрет
    // не уходит в сеть, подпись живёт 60с и валидна только для этого телефона.
    const ts = String(Date.now());
    const sig = crypto.createHmac("sha256", APP_BRIDGE_TOKEN).update(auth.phone + ":" + ts).digest("hex");
    const r = await fetch(`${APP_BRIDGE_URL}/api/app-bridge/lk?phone=${encodeURIComponent(auth.phone)}`, {
      headers: { "X-Bridge-Ts": ts, "X-Bridge-Sig": sig },
      signal: AbortSignal.timeout(15000),
    });
    const data = await r.json();
    res.status(r.ok ? 200 : 502).json(data);
  } catch (e) {
    res.status(502).json({ ok: false, error: "bridge_error", detail: (e as Error).message.slice(0, 120) });
  }
});

export default router;

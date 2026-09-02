import crypto from "crypto";
import { Pool, type PoolClient } from "pg";

// SSL нужен только внешним managed-БД (Neon); локальный postgres в docker-сети без TLS.
const needSsl = /neon\.tech|sslmode=require/.test(process.env.DATABASE_URL || "");
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: needSsl ? { rejectUnauthorized: true } : undefined,
  max: Math.max(4, Math.min(20, Number(process.env.PG_POOL_MAX) || 12)),
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // Не даём одному тяжёлому запросу удерживать дефицитное соединение бесконечно.
  statement_timeout: Math.max(1_000, Math.min(60_000, Number(process.env.PG_STATEMENT_TIMEOUT_MS) || 15_000)),
  query_timeout: Math.max(1_000, Math.min(65_000, Number(process.env.PG_QUERY_TIMEOUT_MS) || 20_000)),
});

pool.on("error", (error) => {
  // Ошибка idle-клиента не должна превращаться в необработанное событие EventEmitter.
  console.error("[DB] idle client error", error.message);
});

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscribers (
      chat_id   BIGINT PRIMARY KEY,
      username  TEXT,
      first_name TEXT,
      joined_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_birthdays (
      chat_id           BIGINT PRIMARY KEY,
      birthday          DATE NOT NULL,
      last_notified_year INT DEFAULT 0
    );

    ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
    ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS launch_count INT DEFAULT 0;
    -- VK-порт: разрешил ли юзер сообщения от сообщества
    -- (NULL = неизвестно; ставится callback-событиями message_allow / message_deny)
    ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS vk_messages_allowed BOOLEAN;
    -- Источник привлечения: payload /start qr_* (QR на чеке/POS/упаковке).
    -- Пишется один раз при первом заходе, не перетирается (setSubscriberSourceOnce).
    ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS source TEXT;
    ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS source_at TIMESTAMPTZ;

    CREATE TABLE IF NOT EXISTS wishlist_subs (
      chat_id    BIGINT NOT NULL,
      product_id INT    NOT NULL,
      added_at   TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (chat_id, product_id)
    );
    CREATE INDEX IF NOT EXISTS wishlist_subs_product_idx ON wishlist_subs (product_id);

    CREATE TABLE IF NOT EXISTS referral_codes (
      code         TEXT PRIMARY KEY,
      owner_chat   BIGINT NOT NULL,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS referral_codes_owner_idx ON referral_codes (owner_chat);

    CREATE TABLE IF NOT EXISTS referral_uses (
      used_by_chat BIGINT PRIMARY KEY,
      code         TEXT NOT NULL,
      used_at      TIMESTAMPTZ DEFAULT NOW(),
      rewarded     BOOLEAN DEFAULT FALSE
    );

    CREATE TABLE IF NOT EXISTS order_status_seen (
      chat_id    BIGINT NOT NULL,
      order_id   TEXT   NOT NULL,
      status     TEXT,
      seen_at    TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (chat_id, order_id)
    );

    CREATE TABLE IF NOT EXISTS notification_log (
      chat_id   BIGINT NOT NULL,
      kind      TEXT   NOT NULL,
      sent_at   TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE notification_log ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'sent';
    ALTER TABLE notification_log ADD COLUMN IF NOT EXISTS reservation_id TEXT;
    ALTER TABLE notification_log ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
    CREATE INDEX IF NOT EXISTS notification_log_chat_idx ON notification_log (chat_id, sent_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS notification_log_reservation_idx ON notification_log (reservation_id) WHERE reservation_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS notification_log_dedupe_idx ON notification_log (chat_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

    CREATE TABLE IF NOT EXISTS notification_prefs (
      chat_id           BIGINT PRIMARY KEY,
      marketing_promo   BOOLEAN DEFAULT TRUE,
      marketing_rewards BOOLEAN DEFAULT TRUE,
      marketing_game    BOOLEAN DEFAULT TRUE,
      updated_at        TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE notification_prefs ADD COLUMN IF NOT EXISTS marketing_game BOOLEAN DEFAULT TRUE;

    CREATE TABLE IF NOT EXISTS cart_snapshots (
      chat_id        BIGINT PRIMARY KEY,
      items_json     TEXT,
      total_sum      INT,
      item_count     INT,
      snapshot_at    TIMESTAMPTZ DEFAULT NOW(),
      abandoned_pushed BOOLEAN DEFAULT FALSE
    );

    -- Daily-spin wheel ──────────────────────────────────
    CREATE TABLE IF NOT EXISTS daily_spins (
      chat_id      BIGINT PRIMARY KEY,
      last_spin_at TIMESTAMPTZ,
      prize_kind   TEXT,
      prize_value  TEXT
    );

    -- Visit streaks (7-day rewards) ─────────────────────
    CREATE TABLE IF NOT EXISTS visit_streaks (
      chat_id        BIGINT PRIMARY KEY,
      current_streak INT DEFAULT 0,
      longest_streak INT DEFAULT 0,
      last_visit_date DATE
    );

    -- Secret-of-day (один товар со скидкой 24h) ─────────
    CREATE TABLE IF NOT EXISTS secret_of_day (
      date         DATE PRIMARY KEY,
      product_id   INT NOT NULL,
      discount_pct INT DEFAULT 15,
      set_at       TIMESTAMPTZ DEFAULT NOW()
    );

    -- Earned rewards (выигрыши с колеса + streak) ───────
    CREATE TABLE IF NOT EXISTS earned_rewards (
      id          BIGSERIAL PRIMARY KEY,
      chat_id     BIGINT NOT NULL,
      kind        TEXT NOT NULL,
      value       TEXT,
      source      TEXT,
      earned_at   TIMESTAMPTZ DEFAULT NOW(),
      used_at     TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS earned_rewards_chat_idx ON earned_rewards (chat_id, earned_at DESC);

    -- Holiday push dedup (один pre-order push на юзера на праздник в году)
    CREATE TABLE IF NOT EXISTS holiday_push_log (
      chat_id    BIGINT NOT NULL,
      holiday_id TEXT   NOT NULL,
      year       INT    NOT NULL,
      sent_at    TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (chat_id, holiday_id, year)
    );

    -- Отзывы на товары (один отзыв на товар от юзера, post-moderation)
    CREATE TABLE IF NOT EXISTS product_reviews (
      id         BIGSERIAL PRIMARY KEY,
      product_id INT    NOT NULL,
      chat_id    BIGINT NOT NULL,
      rating     INT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
      text       TEXT   DEFAULT '',
      author_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      hidden     BOOLEAN DEFAULT FALSE,
      UNIQUE (product_id, chat_id)
    );
    CREATE INDEX IF NOT EXISTS product_reviews_product_idx ON product_reviews (product_id, created_at DESC) WHERE hidden = FALSE;
    CREATE INDEX IF NOT EXISTS product_reviews_chat_idx ON product_reviews (chat_id, created_at DESC);

    -- Share-link для wishlist'а (т.е. "вот что я хочу на ДР")
    CREATE TABLE IF NOT EXISTS wishlist_shares (
      short_code   TEXT   PRIMARY KEY,
      owner_chat   BIGINT NOT NULL,
      owner_name   TEXT,
      product_ids  INT[]  NOT NULL,
      message      TEXT   DEFAULT '',
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      expires_at   TIMESTAMPTZ NOT NULL,
      opens        INT    DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS wishlist_shares_owner_idx ON wishlist_shares (owner_chat, created_at DESC);

    -- Карта впечатлений: пост-заказная оценка от клиента
    CREATE TABLE IF NOT EXISTS order_ratings (
      chat_id    BIGINT NOT NULL,
      order_id   TEXT   NOT NULL,
      rating     INT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
      text       TEXT   DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (chat_id, order_id)
    );
    -- Лог отправленных rating-prompt'ов (чтоб не дёргать юзера дважды по заказу)
    CREATE TABLE IF NOT EXISTS order_rating_prompts (
      chat_id    BIGINT NOT NULL,
      order_id   TEXT   NOT NULL,
      sent_at    TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (chat_id, order_id)
    );

    -- Лог использований промокодов (для одного per user + max_uses_total)
    CREATE TABLE IF NOT EXISTS promo_uses (
      id         BIGSERIAL PRIMARY KEY,
      code       TEXT   NOT NULL,
      chat_id    BIGINT,
      order_id   TEXT,
      used_at    TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS promo_uses_code_idx ON promo_uses (code, used_at DESC);
    CREATE INDEX IF NOT EXISTS promo_uses_chat_idx ON promo_uses (chat_id, code);

    -- Идемпотентность оформления заказа: повторный клик/повтор сети с тем же
    -- ключом возвращает уже созданный заказ, а не создаёт второй.
    CREATE TABLE IF NOT EXISTS order_requests (
      idempotency_key TEXT PRIMARY KEY,
      owner_key       TEXT NOT NULL,
      request_hash    TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',
      response        JSONB,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS order_requests_created_idx ON order_requests (created_at DESC);

    -- Локальная привязка заказов, созданных Mini App, к владельцу. Нужна для
    -- безопасной оценки заказа до того, как он появится в истории внешнего LK.
    CREATE TABLE IF NOT EXISTS app_order_owners (
      order_id   TEXT NOT NULL,
      chat_id    BIGINT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (order_id, chat_id)
    );

    DELETE FROM order_requests
      WHERE status='succeeded' AND created_at < NOW() - INTERVAL '30 days';
  `);
  console.log("[DB] Tables ready");
}

// Promo codes ──────────────────────────────────────────────
export async function countPromoUses(code: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM promo_uses WHERE code = $1`,
    [code]
  );
  return Number(rows[0]?.cnt ?? 0);
}

export async function hasUserUsedPromo(chatId: number, code: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM promo_uses WHERE chat_id = $1 AND code = $2 LIMIT 1`,
    [chatId, code]
  );
  return rows.length > 0;
}

export async function recordPromoUse(code: string, chatId: number | null, orderId: string | null): Promise<void> {
  await pool.query(
    `INSERT INTO promo_uses (code, chat_id, order_id) VALUES ($1, $2, $3)`,
    [code, chatId, orderId]
  );
}

// Order ratings ──────────────────────────────────────────
export interface OrderRating {
  chat_id: number;
  order_id: string;
  rating: number;
  text: string;
  created_at: Date;
}

export async function getOrderRating(chatId: number, orderId: string): Promise<OrderRating | null> {
  const { rows } = await pool.query(
    `SELECT chat_id, order_id, rating, text, created_at FROM order_ratings
     WHERE chat_id = $1 AND order_id = $2`,
    [chatId, orderId]
  );
  return rows[0] ?? null;
}

export async function upsertOrderRating(
  chatId: number, orderId: string, rating: number, text: string
): Promise<OrderRating> {
  const { rows } = await pool.query(
    `INSERT INTO order_ratings (chat_id, order_id, rating, text)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (chat_id, order_id) DO UPDATE SET
       rating = EXCLUDED.rating,
       text = EXCLUDED.text,
       created_at = NOW()
     RETURNING chat_id, order_id, rating, text, created_at`,
    [chatId, orderId, rating, text]
  );
  return rows[0];
}

export async function hasRatingPromptSent(chatId: number, orderId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM order_rating_prompts WHERE chat_id = $1 AND order_id = $2`,
    [chatId, orderId]
  );
  return rows.length > 0;
}

export async function markRatingPromptSent(chatId: number, orderId: string): Promise<void> {
  await pool.query(
    `INSERT INTO order_rating_prompts (chat_id, order_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [chatId, orderId]
  );
}

// Wishlist share ──────────────────────────────────────────
export interface WishlistShare {
  short_code: string;
  owner_chat: number;
  owner_name: string | null;
  product_ids: number[];
  message: string;
  created_at: Date;
  expires_at: Date;
  opens: number;
}

// Алфавит без неоднозначных символов (0/O, 1/I/l)
const SHORT_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function generateShortCode(len = 8): string {
  let s = "";
  for (let i = 0; i < len; i++) {
    s += SHORT_CODE_ALPHABET[Math.floor(Math.random() * SHORT_CODE_ALPHABET.length)];
  }
  return s;
}

export async function createWishlistShare(
  ownerChat: number, ownerName: string | null, productIds: number[], message: string, ttlDays = 90
): Promise<WishlistShare> {
  // Несколько попыток на случай коллизии short_code (вероятность ~0 при 32^8)
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateShortCode();
    try {
      const { rows } = await pool.query(
        `INSERT INTO wishlist_shares (short_code, owner_chat, owner_name, product_ids, message, expires_at)
         VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' days')::interval)
         RETURNING *`,
        [code, ownerChat, ownerName, productIds, message, String(ttlDays)]
      );
      return rows[0];
    } catch (e) {
      const msg = (e as Error).message || "";
      if (!/duplicate key|unique/i.test(msg)) throw e;
      // collision — повторяем
    }
  }
  throw new Error("failed_to_generate_unique_code");
}

export async function getWishlistShare(code: string): Promise<WishlistShare | null> {
  const { rows } = await pool.query(
    `SELECT * FROM wishlist_shares
     WHERE short_code = $1 AND expires_at > NOW()`,
    [code]
  );
  return rows[0] ?? null;
}

export async function incrementWishlistShareOpens(code: string): Promise<void> {
  await pool.query(
    `UPDATE wishlist_shares SET opens = opens + 1 WHERE short_code = $1`,
    [code]
  );
}

export async function countWishlistSharesLast24h(chatId: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM wishlist_shares
     WHERE owner_chat = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
    [chatId]
  );
  return Number(rows[0]?.cnt ?? 0);
}

// Reviews ─────────────────────────────────────────────────
export interface ProductReview {
  id: number;
  product_id: number;
  chat_id: number;
  rating: number;
  text: string;
  author_name: string | null;
  created_at: Date;
  hidden: boolean;
}

export interface ReviewStats {
  count: number;
  avg: number;          // округлённое до 1 знака
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}

export async function getReviewsForProduct(productId: number, limit = 20, offset = 0): Promise<ProductReview[]> {
  const { rows } = await pool.query(
    `SELECT id, product_id, chat_id, rating, text, author_name, created_at, hidden
     FROM product_reviews
     WHERE product_id = $1 AND hidden = FALSE
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [productId, limit, offset]
  );
  return rows;
}

export async function getReviewStats(productId: number): Promise<ReviewStats> {
  const { rows } = await pool.query(
    `SELECT rating, COUNT(*)::int AS cnt FROM product_reviews
     WHERE product_id = $1 AND hidden = FALSE
     GROUP BY rating`,
    [productId]
  );
  const dist: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0, sum = 0;
  for (const r of rows) {
    const k = Number(r.rating) as 1 | 2 | 3 | 4 | 5;
    if (k >= 1 && k <= 5) {
      dist[k] = Number(r.cnt);
      total += Number(r.cnt);
      sum += k * Number(r.cnt);
    }
  }
  const avg = total > 0 ? Math.round((sum / total) * 10) / 10 : 0;
  return { count: total, avg, distribution: dist };
}

// Массовое получение статов для grid-карточек (1 query вместо N)
export async function getReviewStatsBatch(productIds: number[]): Promise<Map<number, { count: number; avg: number }>> {
  const result = new Map<number, { count: number; avg: number }>();
  if (productIds.length === 0) return result;
  const { rows } = await pool.query(
    `SELECT product_id, COUNT(*)::int AS cnt, AVG(rating)::numeric(2,1) AS avg
     FROM product_reviews
     WHERE product_id = ANY($1::int[]) AND hidden = FALSE
     GROUP BY product_id`,
    [productIds]
  );
  for (const r of rows) {
    result.set(Number(r.product_id), { count: Number(r.cnt), avg: Number(r.avg) });
  }
  return result;
}

export async function getMyReview(productId: number, chatId: number): Promise<ProductReview | null> {
  const { rows } = await pool.query(
    `SELECT id, product_id, chat_id, rating, text, author_name, created_at, hidden
     FROM product_reviews
     WHERE product_id = $1 AND chat_id = $2`,
    [productId, chatId]
  );
  return rows[0] ?? null;
}

export async function upsertReview(
  productId: number, chatId: number, rating: number, text: string, authorName: string | null
): Promise<ProductReview> {
  const { rows } = await pool.query(
    `INSERT INTO product_reviews (product_id, chat_id, rating, text, author_name)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (product_id, chat_id) DO UPDATE SET
       rating = EXCLUDED.rating,
       text = EXCLUDED.text,
       author_name = EXCLUDED.author_name,
       created_at = NOW()
     RETURNING id, product_id, chat_id, rating, text, author_name, created_at, hidden`,
    [productId, chatId, rating, text, authorName]
  );
  return rows[0];
}

export async function deleteMyReview(reviewId: number, chatId: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM product_reviews WHERE id = $1 AND chat_id = $2`,
    [reviewId, chatId]
  );
  return (rowCount ?? 0) > 0;
}

export async function setReviewHidden(reviewId: number, hidden: boolean): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE product_reviews SET hidden = $2 WHERE id = $1`,
    [reviewId, hidden]
  );
  return (rowCount ?? 0) > 0;
}

// Rate-limit на новые отзывы (макс N в сутки на юзера, не считая update'ов)
export async function countReviewsLast24h(chatId: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM product_reviews
     WHERE chat_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
    [chatId]
  );
  return Number(rows[0]?.cnt ?? 0);
}

// Holiday push dedup ─────────────────────────────────────
export async function hasHolidayPushSent(chatId: number, holidayId: string, year: number): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM holiday_push_log WHERE chat_id = $1 AND holiday_id = $2 AND year = $3`,
    [chatId, holidayId, year]
  );
  return rows.length > 0;
}

export async function markHolidayPushSent(chatId: number, holidayId: string, year: number): Promise<void> {
  await pool.query(
    `INSERT INTO holiday_push_log (chat_id, holiday_id, year)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [chatId, holidayId, year]
  );
}

// Referral codes
export async function getOrCreateReferralCode(chatId: number, firstName?: string | null): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Сериализуем создание кода одного владельца: без этого два параллельных
    // запроса могли выдать разные коды или вернуть код чужого владельца.
    await client.query(`SELECT pg_advisory_xact_lock($1::bigint)`, [chatId]);
    const existing = await client.query(`SELECT code FROM referral_codes WHERE owner_chat=$1 ORDER BY created_at LIMIT 1`, [chatId]);
    if (existing.rows[0]?.code) {
      await client.query("COMMIT");
      return String(existing.rows[0].code);
    }
    const cleanName = (firstName || "").toUpperCase().replace(/[^A-ZА-Я0-9]/g, "").slice(0, 8);
    const tail = cleanName.length >= 2 ? cleanName : chatId.toString(36).toUpperCase().slice(-6);
    const ownerSuffix = chatId.toString(36).toUpperCase().slice(-6);
    for (let attempt = 0; attempt < 20; attempt++) {
      const suffix = attempt === 0 ? "" : `-${ownerSuffix}${attempt === 1 ? "" : attempt}`;
      const code = `MARIA-${tail}${suffix}`;
      const inserted = await client.query(
        `INSERT INTO referral_codes (code, owner_chat) VALUES ($1,$2)
         ON CONFLICT (code) DO NOTHING RETURNING code`,
        [code, chatId],
      );
      if (inserted.rows[0]?.code) {
        await client.query("COMMIT");
        return String(inserted.rows[0].code);
      }
    }
    throw new Error("referral_code_collision");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function getReferralOwner(code: string): Promise<number | null> {
  const { rows } = await pool.query(`SELECT owner_chat FROM referral_codes WHERE code = $1`, [code.toUpperCase()]);
  return rows[0]?.owner_chat ?? null;
}

// Order status tracking — diff между прошлым snapshot'ом и текущим
export async function getOrderStatusMap(chatId: number): Promise<Map<string, string>> {
  const { rows } = await pool.query(
    `SELECT order_id, status FROM order_status_seen WHERE chat_id = $1`,
    [chatId]
  );
  const m = new Map<string, string>();
  for (const r of rows) m.set(String(r.order_id), String(r.status ?? ""));
  return m;
}

export async function setOrderStatus(chatId: number, orderId: string, status: string) {
  await pool.query(
    `INSERT INTO order_status_seen (chat_id, order_id, status, seen_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (chat_id, order_id) DO UPDATE SET status = $3, seen_at = NOW()`,
    [chatId, orderId, status]
  );
}

// Notification preferences (user-controlled opt-in/out для marketing)
export interface NotificationPrefs {
  marketing_promo: boolean;
  marketing_rewards: boolean;
  marketing_game: boolean;
}

/** Проверка лимитов и запись использования выполняются под одной DB-блокировкой. */
export async function recordPromoUseGuarded(
  code: string,
  chatId: number | null,
  orderId: string | null,
  maxUsesTotal: number | null,
  onePerUser: boolean,
): Promise<{ ok: boolean; reason?: "login_required" | "already_used" | "max_uses_reached" }> {
  if (onePerUser && !chatId) return { ok: false, reason: "login_required" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [String(code).toUpperCase()]);
    if (orderId) {
      const duplicate = await client.query(
        `SELECT 1 FROM promo_uses WHERE code=$1 AND order_id=$2 LIMIT 1`,
        [String(code).toUpperCase(), orderId],
      );
      if (duplicate.rowCount) {
        await client.query("COMMIT");
        return { ok: true };
      }
    }
    if (onePerUser && chatId) {
      const used = await client.query(
        `SELECT 1 FROM promo_uses WHERE chat_id=$1 AND code=$2 LIMIT 1`,
        [chatId, String(code).toUpperCase()],
      );
      if (used.rowCount) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "already_used" };
      }
    }
    if (maxUsesTotal != null) {
      const count = await client.query(
        `SELECT COUNT(*)::int AS cnt FROM promo_uses WHERE code=$1`,
        [String(code).toUpperCase()],
      );
      if (Number(count.rows[0]?.cnt ?? 0) >= maxUsesTotal) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "max_uses_reached" };
      }
    }
    await client.query(
      `INSERT INTO promo_uses (code, chat_id, order_id) VALUES ($1, $2, $3)`,
      [String(code).toUpperCase(), chatId, orderId],
    );
    await client.query("COMMIT");
    return { ok: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function releasePromoUse(code: string, orderRef: string): Promise<void> {
  await pool.query(`DELETE FROM promo_uses WHERE code=$1 AND order_id=$2`, [String(code).toUpperCase(), orderRef]);
}

export async function finalizePromoUseOrder(code: string, orderRef: string, orderId: string): Promise<void> {
  await pool.query(
    `UPDATE promo_uses SET order_id=$3 WHERE code=$1 AND order_id=$2`,
    [String(code).toUpperCase(), orderRef, orderId],
  );
}

export type OrderRequestClaim =
  | { state: "claimed" }
  | { state: "pending" }
  | { state: "conflict" }
  | { state: "succeeded"; response: Record<string, unknown> };

export async function lookupOrderRequest(
  idempotencyKey: string,
  ownerKey: string,
  requestHash: string,
): Promise<OrderRequestClaim | null> {
  const { rows } = await pool.query(
    `SELECT owner_key, request_hash, status, response FROM order_requests WHERE idempotency_key=$1`,
    [idempotencyKey],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.owner_key !== ownerKey || row.request_hash !== requestHash) return { state: "conflict" };
  if (row.status === "succeeded" && row.response && typeof row.response === "object") {
    return { state: "succeeded", response: row.response as Record<string, unknown> };
  }
  return { state: "pending" };
}

export async function claimOrderRequest(
  idempotencyKey: string,
  ownerKey: string,
  requestHash: string,
): Promise<OrderRequestClaim> {
  const inserted = await pool.query(
    `INSERT INTO order_requests (idempotency_key, owner_key, request_hash)
     VALUES ($1,$2,$3) ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING idempotency_key`,
    [idempotencyKey, ownerKey, requestHash],
  );
  if (inserted.rowCount) return { state: "claimed" };
  const { rows } = await pool.query(
    `SELECT owner_key, request_hash, status, response FROM order_requests WHERE idempotency_key=$1`,
    [idempotencyKey],
  );
  const row = rows[0];
  if (!row || row.owner_key !== ownerKey || row.request_hash !== requestHash) return { state: "conflict" };
  if (row.status === "succeeded" && row.response && typeof row.response === "object") {
    return { state: "succeeded", response: row.response as Record<string, unknown> };
  }
  return { state: "pending" };
}

export async function completeOrderRequest(idempotencyKey: string, response: Record<string, unknown>): Promise<void> {
  await pool.query(
    `UPDATE order_requests SET status='succeeded', response=$2::jsonb, updated_at=NOW()
     WHERE idempotency_key=$1 AND status='pending'`,
    [idempotencyKey, JSON.stringify(response)],
  );
}

export async function releaseOrderRequest(idempotencyKey: string): Promise<void> {
  await pool.query(`DELETE FROM order_requests WHERE idempotency_key=$1 AND status='pending'`, [idempotencyKey]);
}

export async function recordAppOrderOwner(chatId: number, orderId: string): Promise<void> {
  await pool.query(
    `INSERT INTO app_order_owners (order_id, chat_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [orderId, chatId],
  );
}

export async function isAppOrderOwner(chatId: number, orderId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM app_order_owners WHERE order_id=$1 AND chat_id=$2 LIMIT 1`,
    [orderId, chatId],
  );
  return Boolean(rowCount);
}
type QueryDb = Pick<PoolClient, "query">;
export async function getNotificationPrefs(chatId: number, db: QueryDb = pool): Promise<NotificationPrefs> {
  const { rows } = await db.query(
    `SELECT marketing_promo, marketing_rewards, marketing_game FROM notification_prefs WHERE chat_id = $1`,
    [chatId]
  );
  if (rows[0]) return { marketing_promo: rows[0].marketing_promo, marketing_rewards: rows[0].marketing_rewards, marketing_game: rows[0].marketing_game };
  return { marketing_promo: true, marketing_rewards: true, marketing_game: true };
}
export async function setNotificationPrefs(chatId: number, prefs: Partial<NotificationPrefs>) {
  await pool.query(
    `INSERT INTO notification_prefs (chat_id, marketing_promo, marketing_rewards, marketing_game, updated_at)
     VALUES ($1, COALESCE($2, TRUE), COALESCE($3, TRUE), COALESCE($4, TRUE), NOW())
     ON CONFLICT (chat_id) DO UPDATE
       SET marketing_promo   = COALESCE($2, notification_prefs.marketing_promo),
           marketing_rewards = COALESCE($3, notification_prefs.marketing_rewards),
           marketing_game    = COALESCE($4, notification_prefs.marketing_game),
           updated_at        = NOW()`,
    [chatId, prefs.marketing_promo ?? null, prefs.marketing_rewards ?? null, prefs.marketing_game ?? null]
  );
}

// Cart snapshot — для abandonment push
export interface CartSnapshot {
  chat_id: number;
  items_json: string;
  total_sum: number;
  item_count: number;
  snapshot_at: Date;
  abandoned_pushed: boolean;
}
export async function saveCartSnapshot(chatId: number, items: unknown[], totalSum: number) {
  const itemCount: number = Array.isArray(items)
    ? items.reduce((s: number, it: unknown) => s + (Number((it as { qty?: number })?.qty) || 0), 0)
    : 0;
  await pool.query(
    `INSERT INTO cart_snapshots (chat_id, items_json, total_sum, item_count, snapshot_at, abandoned_pushed)
     VALUES ($1, $2, $3, $4, NOW(), FALSE)
     ON CONFLICT (chat_id) DO UPDATE
       SET items_json = $2, total_sum = $3, item_count = $4, snapshot_at = NOW(), abandoned_pushed = FALSE`,
    [chatId, JSON.stringify(items || []), totalSum | 0, itemCount | 0]
  );
}
export async function clearCartSnapshot(chatId: number) {
  await pool.query(`DELETE FROM cart_snapshots WHERE chat_id = $1`, [chatId]);
}
export async function getAbandonedCarts(): Promise<CartSnapshot[]> {
  // Активные корзины старше 24h, ещё не было abandonment push, есть items
  const { rows } = await pool.query(
    `SELECT chat_id, items_json, total_sum, item_count, snapshot_at, abandoned_pushed
     FROM cart_snapshots
     WHERE abandoned_pushed = FALSE
       AND item_count > 0
       AND snapshot_at < NOW() - INTERVAL '24 hours'
       AND snapshot_at > NOW() - INTERVAL '7 days'`
  );
  return rows;
}
export async function markCartAbandonedPushed(chatId: number) {
  await pool.query(
    `UPDATE cart_snapshots SET abandoned_pushed = TRUE WHERE chat_id = $1`,
    [chatId]
  );
}

// ─── Daily Spin Wheel ────────────────────────────────────────────────────────
export interface SpinPrize {
  kind: string;
  value: string;
  label: string;
  emoji: string;
  weight: number;
}
export const WHEEL_PRIZES: SpinPrize[] = [
  { kind: "discount_coupon", value: "5",     label: "Купон −5%",                          emoji: "🎫", weight: 22 },
  { kind: "points",          value: "50",    label: "+50 баллов",                         emoji: "💎", weight: 25 },
  { kind: "free_eclair",     value: "1",     label: "Бесплатный эклер от 800 ₽",          emoji: "🍫", weight: 15 },
  { kind: "double_points",   value: "1",     label: "×2 баллов сегодня",                  emoji: "✨", weight: 12 },
  { kind: "sweet_ticket",    value: "1",     label: "Билет в Sweet Check",                emoji: "🎟", weight: 10 },
  { kind: "cake_month_10",   value: "10",    label: "Торт месяца −10%",                   emoji: "🎂", weight:  8 },
  { kind: "nothing",         value: "0",     label: "Удача рядом — крутни завтра",        emoji: "🙈", weight:  8 },
];
function pickWeightedPrize(): SpinPrize {
  const total = WHEEL_PRIZES.reduce((s, p) => s + p.weight, 0);
  let r = Math.random() * total;
  for (const p of WHEEL_PRIZES) {
    if (r < p.weight) return p;
    r -= p.weight;
  }
  return WHEEL_PRIZES[0];
}
function isSameDayIrkutsk(d1: Date | null, d2: Date): boolean {
  if (!d1) return false;
  // Иркутск UTC+8
  const toIrk = (d: Date) => new Date(d.getTime() + 8 * 3600_000);
  const a = toIrk(d1).toISOString().slice(0, 10);
  const b = toIrk(d2).toISOString().slice(0, 10);
  return a === b;
}
export async function getSpinStatus(chatId: number): Promise<{ canSpin: boolean; lastPrize?: SpinPrize | null; nextSpinAt?: string | null }> {
  const { rows } = await pool.query(
    `SELECT last_spin_at, prize_kind, prize_value FROM daily_spins WHERE chat_id = $1`,
    [chatId]
  );
  if (!rows[0] || !rows[0].last_spin_at) return { canSpin: true, lastPrize: null };
  const last = new Date(rows[0].last_spin_at);
  const now  = new Date();
  if (isSameDayIrkutsk(last, now)) {
    // Уже крутил сегодня
    const prizeIdx = WHEEL_PRIZES.findIndex((p) => p.kind === rows[0].prize_kind);
    const lastPrize = prizeIdx >= 0 ? WHEEL_PRIZES[prizeIdx] : null;
    // Время до завтра 00:00 Иркутск
    const toIrk = (d: Date) => new Date(d.getTime() + 8 * 3600_000);
    const irkNow = toIrk(now);
    const nextMidnightIrk = new Date(Date.UTC(irkNow.getUTCFullYear(), irkNow.getUTCMonth(), irkNow.getUTCDate() + 1));
    const nextUTC = new Date(nextMidnightIrk.getTime() - 8 * 3600_000);
    return { canSpin: false, lastPrize, nextSpinAt: nextUTC.toISOString() };
  }
  return { canSpin: true, lastPrize: null };
}
export async function recordSpin(chatId: number): Promise<{ prize: SpinPrize; alreadySpunToday: boolean }> {
  // Атомарная защита от двойного клика: транзакция + FOR UPDATE.
  // Сначала вставляем заглушку (если строки нет), потом блокируем и решаем.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO daily_spins (chat_id) VALUES ($1) ON CONFLICT (chat_id) DO NOTHING`,
      [chatId]
    );
    const { rows } = await client.query(
      `SELECT last_spin_at, prize_kind, prize_value FROM daily_spins WHERE chat_id = $1 FOR UPDATE`,
      [chatId]
    );
    const last = rows[0]?.last_spin_at ? new Date(rows[0].last_spin_at) : null;
    if (last && isSameDayIrkutsk(last, new Date())) {
      const prizeIdx = WHEEL_PRIZES.findIndex((p) => p.kind === rows[0].prize_kind);
      const lastPrize = prizeIdx >= 0 ? WHEEL_PRIZES[prizeIdx] : WHEEL_PRIZES[WHEEL_PRIZES.length - 1];
      await client.query("COMMIT");
      return { prize: lastPrize, alreadySpunToday: true };
    }

    const prize = pickWeightedPrize();
    await client.query(
      `UPDATE daily_spins SET last_spin_at = NOW(), prize_kind = $2, prize_value = $3 WHERE chat_id = $1`,
      [chatId, prize.kind, prize.value]
    );
    if (prize.kind !== "nothing") {
      await client.query(
        `INSERT INTO earned_rewards (chat_id, kind, value, source) VALUES ($1, $2, $3, 'wheel')`,
        [chatId, prize.kind, prize.value]
      );
    }
    await client.query("COMMIT");
    return { prize, alreadySpunToday: false };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ─── Visit Streaks ───────────────────────────────────────────────────────────
export function advanceVisitStreak(
  current: number,
  longest: number,
  consecutiveDay: boolean,
): { current: number; longest: number; reachedReward: boolean } {
  const reached = consecutiveDay ? Math.max(0, Math.floor(current)) + 1 : 1;
  const nextLongest = Math.max(Math.max(0, Math.floor(longest)), reached);
  return {
    current: reached >= 7 ? 0 : reached,
    longest: nextLongest,
    reachedReward: reached >= 7,
  };
}

export async function touchVisitStreak(chatId: number): Promise<{ currentStreak: number; longestStreak: number; reachedReward: boolean }> {
  const now = new Date();
  const toIrk = (d: Date) => new Date(d.getTime() + 8 * 3600_000);
  const todayIrk = toIrk(now).toISOString().slice(0, 10);
  const yesterdayIrk = toIrk(new Date(now.getTime() - 24 * 3600_000)).toISOString().slice(0, 10);
  // Атомарно (транзакция + FOR UPDATE как в recordSpin): иначе пачка параллельных
  // /api/streak/touch на 7-й день читает cur=6 всеми запросами и каждый выдаёт
  // реальный купон free_dessert. Строка блокируется до COMMIT.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ins = await client.query(
      `INSERT INTO visit_streaks (chat_id, current_streak, longest_streak, last_visit_date)
       VALUES ($1, 1, 1, $2::date) ON CONFLICT (chat_id) DO NOTHING`,
      [chatId, todayIrk]
    );
    if (ins.rowCount && ins.rowCount > 0) {
      await client.query("COMMIT");
      return { currentStreak: 1, longestStreak: 1, reachedReward: false };
    }
    const { rows } = await client.query(
      `SELECT current_streak, longest_streak, last_visit_date FROM visit_streaks WHERE chat_id = $1 FOR UPDATE`,
      [chatId]
    );
    const lastDate = rows[0].last_visit_date as Date | null;
    let cur = Number(rows[0].current_streak) || 0;
    let longest = Number(rows[0].longest_streak) || 0;
    const lastIrk = lastDate ? toIrk(new Date(lastDate)).toISOString().slice(0, 10) : null;
    if (lastIrk === todayIrk) {
      // Уже отмечен сегодня
      await client.query("COMMIT");
      return { currentStreak: cur, longestStreak: longest, reachedReward: false };
    }
    const advanced = advanceVisitStreak(cur, longest, lastIrk === yesterdayIrk);
    cur = advanced.current;
    longest = advanced.longest;
    const reachedReward = advanced.reachedReward;
    if (reachedReward) {
      // Награда! Сбрасываем streak.
      await client.query(
        `INSERT INTO earned_rewards (chat_id, kind, value, source)
         VALUES ($1, 'free_dessert', '1', 'streak_7')`,
        [chatId]
      );
    }
    await client.query(
      `UPDATE visit_streaks SET current_streak = $2, longest_streak = $3, last_visit_date = $4::date WHERE chat_id = $1`,
      [chatId, cur, longest, todayIrk]
    );
    await client.query("COMMIT");
    return { currentStreak: cur, longestStreak: longest, reachedReward };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ─── Secret of the Day ───────────────────────────────────────────────────────
export async function setSecretOfDay(productId: number, discountPct = 0) {
  const today = new Date();
  const toIrk = (d: Date) => new Date(d.getTime() + 8 * 3600_000);
  const dateIrk = toIrk(today).toISOString().slice(0, 10);
  await pool.query(
    `INSERT INTO secret_of_day (date, product_id, discount_pct)
     VALUES ($1::date, $2, $3)
     ON CONFLICT (date) DO UPDATE SET product_id = $2, discount_pct = $3`,
    [dateIrk, productId, discountPct]
  );
}
export async function getSecretOfDay(): Promise<{ productId: number; discountPct: number; expiresAt: string } | null> {
  const today = new Date();
  const toIrk = (d: Date) => new Date(d.getTime() + 8 * 3600_000);
  const dateIrk = toIrk(today).toISOString().slice(0, 10);
  const { rows } = await pool.query(
    `SELECT product_id, discount_pct FROM secret_of_day WHERE date = $1::date`,
    [dateIrk]
  );
  if (!rows[0]) return null;
  // Истекает в 23:59 Иркутска
  const irkNow = toIrk(today);
  const eod = new Date(Date.UTC(irkNow.getUTCFullYear(), irkNow.getUTCMonth(), irkNow.getUTCDate(), 23, 59, 59));
  const expiresAt = new Date(eod.getTime() - 8 * 3600_000).toISOString();
  return { productId: Number(rows[0].product_id), discountPct: Number(rows[0].discount_pct), expiresAt };
}

// ─── Earned rewards (выигрыши) ────────────────────────────────────────────────
export async function getUnusedRewards(chatId: number): Promise<{ id: number; kind: string; value: string; source: string; earned_at: Date }[]> {
  const { rows } = await pool.query(
    `SELECT id, kind, value, source, earned_at FROM earned_rewards
     WHERE chat_id = $1 AND used_at IS NULL
     ORDER BY earned_at DESC LIMIT 20`,
    [chatId]
  );
  return rows;
}

export async function consumeRewards(chatId: number, rewardIds: number[]): Promise<{ id: number; kind: string; value: string; source: string }[]> {
  const ids = [...new Set(rewardIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) return [];
  // Помечаем только тот снимок наград, который реально попал в заказ. Награда,
  // заработанная параллельно во время оформления, останется неиспользованной.
  const { rows } = await pool.query(
    `UPDATE earned_rewards SET used_at = NOW()
     WHERE chat_id = $1 AND id = ANY($2::bigint[]) AND used_at IS NULL
     RETURNING id, kind, value, source`,
    [chatId, ids]
  );
  return rows;
}

// Smart-notification policy
export type NotificationKind = "transactional" | "marketing" | "marketing_promo" | "marketing_rewards" | "marketing_game";
const RATE_RULES = {
  transactional: { maxPerDay: 999, minIntervalMin: 0 },
  marketing:     { maxPerWeek: 1,  minIntervalMin: 60 },
};

function isQuietHours(): boolean {
  // 22:00 – 09:00 по Иркутску (UTC+8)
  const utc = new Date();
  const irkHour = (utc.getUTCHours() + 8) % 24;
  return irkHour >= 22 || irkHour < 9;
}

export async function canSendNotification(chatId: number, kind: NotificationKind, db: QueryDb = pool): Promise<{ ok: boolean; reason?: string }> {
  const isMarketing = kind === "marketing" || kind === "marketing_promo" || kind === "marketing_rewards" || kind === "marketing_game";
  if (isMarketing && isQuietHours()) {
    return { ok: false, reason: "quiet_hours" };
  }
  // User-prefs check
  if (kind === "marketing_promo" || kind === "marketing_rewards" || kind === "marketing_game") {
    const prefs = await getNotificationPrefs(chatId, db);
    if (kind === "marketing_promo"   && !prefs.marketing_promo)   return { ok: false, reason: "promo_disabled" };
    if (kind === "marketing_rewards" && !prefs.marketing_rewards) return { ok: false, reason: "rewards_disabled" };
    if (kind === "marketing_game"    && !prefs.marketing_game)    return { ok: false, reason: "game_disabled" };
  }
  // Недельный лимит маркетинга (1/нед) — НЕ распространяется на игровые пуши:
  // у них своя частота (1/день максимум, контролируется крон-джобом).
  if (isMarketing && kind !== "marketing_game") {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS cnt FROM notification_log
       WHERE chat_id = $1 AND kind LIKE 'marketing%' AND kind <> 'marketing_game'
         AND sent_at > NOW() - INTERVAL '7 days'
         AND (status='sent' OR sent_at > NOW() - INTERVAL '15 minutes')`,
      [chatId]
    );
    if ((rows[0]?.cnt ?? 0) >= RATE_RULES.marketing.maxPerWeek) {
      return { ok: false, reason: "marketing_quota_exceeded" };
    }
  }
  // Глобальный лимит — max 5 push за сутки на юзера
  const { rows: total } = await db.query(
    `SELECT COUNT(*)::int AS cnt FROM notification_log
     WHERE chat_id = $1 AND sent_at > NOW() - INTERVAL '24 hours'
       AND (status='sent' OR sent_at > NOW() - INTERVAL '15 minutes')`,
    [chatId]
  );
  if ((total[0]?.cnt ?? 0) >= 5) {
    return { ok: false, reason: "daily_quota_exceeded" };
  }
  return { ok: true };
}

export async function logNotification(chatId: number, kind: NotificationKind) {
  await pool.query(
    `INSERT INTO notification_log (chat_id, kind) VALUES ($1, $2)`,
    [chatId, kind]
  );
}

export interface NotificationReservation { ok: boolean; token?: string; reason?: string }

/** Атомарно резервирует место в push-квоте до внешней отправки. Advisory lock
 * сериализует все виды уведомлений одного пользователя между процессами. */
export async function reserveNotification(
  chatId: number,
  kind: NotificationKind,
  dedupeKey?: string,
): Promise<NotificationReservation> {
  const client = await pool.connect();
  const token = crypto.randomUUID();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`notification:${chatId}`]);
    await client.query(
      `DELETE FROM notification_log WHERE chat_id=$1 AND status='pending' AND sent_at < NOW() - INTERVAL '15 minutes'`,
      [chatId]
    );
    const gate = await canSendNotification(chatId, kind, client);
    if (!gate.ok) { await client.query("ROLLBACK"); return gate; }
    if (dedupeKey) {
      const duplicate = await client.query(
        `SELECT 1 FROM notification_log WHERE chat_id=$1 AND dedupe_key=$2 LIMIT 1`,
        [chatId, dedupeKey]
      );
      if (duplicate.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "duplicate" }; }
    }
    await client.query(
      `INSERT INTO notification_log (chat_id, kind, status, reservation_id, dedupe_key)
       VALUES ($1,$2,'pending',$3,$4)`,
      [chatId, kind, token, dedupeKey || null]
    );
    await client.query("COMMIT");
    return { ok: true, token };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { client.release(); }
}

/** Завершает резерв: успешный становится историей, неуспешный освобождает квоту
 * и dedupe-key, чтобы временную ошибку можно было повторить. */
export async function completeNotificationReservation(token: string, sent: boolean): Promise<void> {
  if (sent) {
    await pool.query(
      `UPDATE notification_log SET status='sent', sent_at=NOW() WHERE reservation_id=$1 AND status='pending'`,
      [token]
    );
  } else {
    await pool.query(`DELETE FROM notification_log WHERE reservation_id=$1 AND status='pending'`, [token]);
  }
}

export async function wasNotificationSent(chatId: number, dedupeKey: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM notification_log
      WHERE chat_id=$1 AND dedupe_key=$2 AND status='sent' LIMIT 1`,
    [chatId, dedupeKey],
  );
  return Boolean(rowCount);
}

export async function recordReferralUse(usedByChat: number, code: string): Promise<{ ok: boolean; ownerChat?: number; reason?: string }> {
  // Один юзер может ввести реф-код только один раз. Не может ввести свой код.
  const ownerChat = await getReferralOwner(code);
  if (!ownerChat) return { ok: false, reason: "code_not_found" };
  if (ownerChat === usedByChat) return { ok: false, reason: "own_code" };
  // Атомарно: дедуп через PK used_by_chat, а не check-then-insert (иначе гонка двух
  // запросов роняла второй INSERT в 500 вместо already_used).
  const ins = await pool.query(
    `INSERT INTO referral_uses (used_by_chat, code) VALUES ($1, $2)
     ON CONFLICT (used_by_chat) DO NOTHING
     RETURNING code`,
    [usedByChat, code.toUpperCase()]
  );
  if ((ins.rowCount ?? 0) === 0) return { ok: false, reason: "already_used" };
  return { ok: true, ownerChat };
}

// Wishlist subscriptions — для уведомлений «снова в наличии»
export async function wishlistSubscribe(chatId: number, productId: number) {
  await pool.query(
    `INSERT INTO wishlist_subs (chat_id, product_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [chatId, productId]
  );
}

export async function wishlistUnsubscribe(chatId: number, productId: number) {
  await pool.query(
    `DELETE FROM wishlist_subs WHERE chat_id = $1 AND product_id = $2`,
    [chatId, productId]
  );
}

export async function wishlistSync(chatId: number, productIds: number[]) {
  const ids = [...new Set(productIds.filter((id) => Number.isInteger(id) && id > 0))].slice(0, 500);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // DELETE и INSERT — одна транзакция: ошибка вставки больше не оставляет
    // пользователя с наполовину очищенным wishlist.
    await client.query(
      `DELETE FROM wishlist_subs WHERE chat_id=$1 AND product_id <> ALL($2::int[])`,
      [chatId, ids],
    );
    if (ids.length) {
      await client.query(
        `INSERT INTO wishlist_subs (chat_id, product_id)
         SELECT $1, input.product_id FROM UNNEST($2::int[]) AS input(product_id)
         ON CONFLICT DO NOTHING`,
        [chatId, ids],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function getWishlistSubsForProducts(productIds: number[]): Promise<{ chat_id: number; product_id: number }[]> {
  if (productIds.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT chat_id, product_id FROM wishlist_subs WHERE product_id = ANY($1::int[])`,
    [productIds]
  );
  return rows;
}

export async function touchSubscriber(chatId: number, username?: string, firstName?: string) {
  await pool.query(
    `INSERT INTO subscribers (chat_id, username, first_name, last_seen_at, launch_count)
     VALUES ($1, $2, $3, NOW(), 1)
     ON CONFLICT (chat_id) DO UPDATE
       SET username = COALESCE($2, subscribers.username),
           first_name = COALESCE($3, subscribers.first_name),
           last_seen_at = NOW(),
           launch_count = subscribers.launch_count + 1`,
    [chatId, username ?? null, firstName ?? null]
  );
}

export interface SubscriberInfo {
  joined_at: string | null;
  last_seen_at: string | null;
  launch_count: number;
}

export async function getSubscriberInfo(chatId: number): Promise<SubscriberInfo | null> {
  const { rows } = await pool.query(
    `SELECT joined_at, last_seen_at, launch_count FROM subscribers WHERE chat_id = $1`,
    [chatId]
  );
  return rows[0] ?? null;
}

export async function addSubscriber(chatId: number, username: string | undefined, firstName: string | undefined) {
  await pool.query(
    `INSERT INTO subscribers (chat_id, username, first_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (chat_id) DO UPDATE SET username = $2, first_name = $3`,
    [chatId, username ?? null, firstName ?? null]
  );
}

export async function getAllSubscribers(): Promise<{ chat_id: number }[]> {
  const { rows } = await pool.query(`SELECT chat_id FROM subscribers`);
  return rows;
}

/**
 * Источник привлечения (/start qr_check, qr_pos_<точка>, qr_box…).
 * Пишется только если source ещё пуст: первый источник — самый честный,
 * повторные сканы/переходы его не перетирают.
 */
export async function setSubscriberSourceOnce(chatId: number, source: string) {
  await pool.query(
    `UPDATE subscribers SET source = $2, source_at = NOW()
     WHERE chat_id = $1 AND source IS NULL`,
    [chatId, source]
  );
}

// ─── VK: разрешение сообщений от сообщества ──────────────────────────────────

export async function setVkMessagesAllowed(chatId: number, allowed: boolean) {
  await pool.query(
    `INSERT INTO subscribers (chat_id, vk_messages_allowed)
     VALUES ($1, $2)
     ON CONFLICT (chat_id) DO UPDATE SET vk_messages_allowed = $2`,
    [chatId, allowed]
  );
}

/** null = неизвестно (юзер ещё не отвечал на запрос) — пробуем отправить. */
export async function getVkMessagesAllowed(chatId: number): Promise<boolean | null> {
  const { rows } = await pool.query(
    `SELECT vk_messages_allowed FROM subscribers WHERE chat_id = $1`,
    [chatId]
  );
  return rows[0]?.vk_messages_allowed ?? null;
}

export async function setUserBirthday(chatId: number, birthday: string) {
  await pool.query(
    `INSERT INTO user_birthdays (chat_id, birthday)
     VALUES ($1, $2)
     ON CONFLICT (chat_id) DO UPDATE SET birthday = $2`,
    [chatId, birthday]
  );
}

export async function getTodayBirthdays(): Promise<{ chat_id: number; first_name: string | null }[]> {
  const { rows } = await pool.query(`
    SELECT b.chat_id, s.first_name
    FROM user_birthdays b
    LEFT JOIN subscribers s ON s.chat_id = b.chat_id
    WHERE EXTRACT(MONTH FROM b.birthday) = EXTRACT(MONTH FROM NOW())
      AND EXTRACT(DAY   FROM b.birthday) = EXTRACT(DAY   FROM NOW())
      AND (b.last_notified_year IS NULL OR b.last_notified_year < EXTRACT(YEAR FROM NOW()))
  `);
  return rows;
}

export async function markBirthdayNotified(chatId: number) {
  await pool.query(
    `UPDATE user_birthdays SET last_notified_year = EXTRACT(YEAR FROM NOW()) WHERE chat_id = $1`,
    [chatId]
  );
}

// ─── User rewards (персональные коды из клубной системы) ─────────────────────
export async function findUserReward(chatId: number, code: string): Promise<
  { reward_type: "percent" | "amount" | "free_item"; discount_value: number | null; min_order: number; title: string; expires_at: Date; used_at: Date | null } | null> {
  const { rows } = await pool.query(
    `SELECT rc.reward_type, rc.discount_value, rc.min_order, rc.title, ur.expires_at, ur.used_at
       FROM user_rewards ur JOIN rewards_catalog rc ON rc.id = ur.reward_id
      WHERE ur.promo_code = $1 AND ur.chat_id = $2`,
    [String(code).toUpperCase(), chatId]
  );
  return rows[0] ?? null;
}

export async function markUserRewardUsed(code: string, chatId: number, orderId: string | null): Promise<boolean> {
  const result = await pool.query(
    `UPDATE user_rewards SET used_at = NOW(), used_order_id = $3
      WHERE promo_code = $1 AND chat_id = $2 AND used_at IS NULL`,
    [String(code).toUpperCase(), chatId, orderId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function releaseUserReward(code: string, chatId: number, orderRef: string): Promise<void> {
  await pool.query(
    `UPDATE user_rewards SET used_at=NULL, used_order_id=NULL
      WHERE promo_code=$1 AND chat_id=$2 AND used_order_id=$3`,
    [String(code).toUpperCase(), chatId, orderRef],
  );
}

export async function finalizeUserRewardOrder(code: string, chatId: number, orderRef: string, orderId: string): Promise<void> {
  await pool.query(
    `UPDATE user_rewards SET used_order_id=$4
      WHERE promo_code=$1 AND chat_id=$2 AND used_order_id=$3`,
    [String(code).toUpperCase(), chatId, orderRef, orderId],
  );
}

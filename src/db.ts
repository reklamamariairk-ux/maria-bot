import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
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

    CREATE TABLE IF NOT EXISTS wishlist_subs (
      chat_id    BIGINT NOT NULL,
      product_id INT    NOT NULL,
      added_at   TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (chat_id, product_id)
    );
    CREATE INDEX IF NOT EXISTS wishlist_subs_product_idx ON wishlist_subs (product_id);

    CREATE TABLE IF NOT EXISTS referrals (
      code         TEXT PRIMARY KEY,
      owner_chat   BIGINT NOT NULL,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS referrals_owner_idx ON referrals (owner_chat);

    CREATE TABLE IF NOT EXISTS referral_uses (
      used_by_chat BIGINT PRIMARY KEY,
      code         TEXT NOT NULL,
      used_at      TIMESTAMPTZ DEFAULT NOW(),
      rewarded     BOOLEAN DEFAULT FALSE
    );
  `);
  console.log("[DB] Tables ready");
}

// Referral codes
export async function getOrCreateReferralCode(chatId: number, firstName?: string | null): Promise<string> {
  const { rows } = await pool.query(`SELECT code FROM referrals WHERE owner_chat = $1 LIMIT 1`, [chatId]);
  if (rows[0]?.code) return rows[0].code as string;
  // Генерация кода: MARIA-{first_name uppercase ASCII или короткий hash}
  const cleanName = (firstName || "")
    .toUpperCase()
    .replace(/[^A-ZА-Я0-9]/g, "")
    .slice(0, 8);
  const tail = cleanName.length >= 2 ? cleanName : chatId.toString(36).toUpperCase().slice(-5);
  let code = `MARIA-${tail}`;
  // Проверка уникальности — если занято, добавим суффикс
  for (let i = 0; i < 5; i++) {
    const taken = await pool.query(`SELECT 1 FROM referrals WHERE code = $1`, [code]);
    if (taken.rows.length === 0) break;
    code = `MARIA-${tail}${i + 2}`;
  }
  await pool.query(
    `INSERT INTO referrals (code, owner_chat) VALUES ($1, $2)
     ON CONFLICT (code) DO NOTHING`,
    [code, chatId]
  );
  return code;
}

export async function getReferralOwner(code: string): Promise<number | null> {
  const { rows } = await pool.query(`SELECT owner_chat FROM referrals WHERE code = $1`, [code.toUpperCase()]);
  return rows[0]?.owner_chat ?? null;
}

export async function recordReferralUse(usedByChat: number, code: string): Promise<{ ok: boolean; ownerChat?: number; reason?: string }> {
  // Один юзер может ввести реф-код только один раз. Не может ввести свой код.
  const ownerChat = await getReferralOwner(code);
  if (!ownerChat) return { ok: false, reason: "code_not_found" };
  if (ownerChat === usedByChat) return { ok: false, reason: "own_code" };
  const exists = await pool.query(`SELECT code FROM referral_uses WHERE used_by_chat = $1`, [usedByChat]);
  if (exists.rows.length > 0) return { ok: false, reason: "already_used" };
  await pool.query(
    `INSERT INTO referral_uses (used_by_chat, code) VALUES ($1, $2)`,
    [usedByChat, code.toUpperCase()]
  );
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
  // Полная синхронизация: продукты в массиве остаются, остальное удаляется
  await pool.query(`DELETE FROM wishlist_subs WHERE chat_id = $1 AND product_id <> ALL($2::int[])`,
    [chatId, productIds.length > 0 ? productIds : [0]]);
  if (productIds.length > 0) {
    const values = productIds.map((_, i) => `($1, $${i + 2})`).join(", ");
    await pool.query(
      `INSERT INTO wishlist_subs (chat_id, product_id) VALUES ${values}
       ON CONFLICT DO NOTHING`,
      [chatId, ...productIds]
    );
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

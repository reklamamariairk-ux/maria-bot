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
  `);
  console.log("[DB] Tables ready");
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

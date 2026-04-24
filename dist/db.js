"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.initDb = initDb;
exports.addSubscriber = addSubscriber;
exports.getAllSubscribers = getAllSubscribers;
exports.setUserBirthday = setUserBirthday;
exports.getTodayBirthdays = getTodayBirthdays;
exports.markBirthdayNotified = markBirthdayNotified;
const pg_1 = require("pg");
exports.pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
});
async function initDb() {
    await exports.pool.query(`
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
async function addSubscriber(chatId, username, firstName) {
    await exports.pool.query(`INSERT INTO subscribers (chat_id, username, first_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (chat_id) DO UPDATE SET username = $2, first_name = $3`, [chatId, username ?? null, firstName ?? null]);
}
async function getAllSubscribers() {
    const { rows } = await exports.pool.query(`SELECT chat_id FROM subscribers`);
    return rows;
}
async function setUserBirthday(chatId, birthday) {
    await exports.pool.query(`INSERT INTO user_birthdays (chat_id, birthday)
     VALUES ($1, $2)
     ON CONFLICT (chat_id) DO UPDATE SET birthday = $2`, [chatId, birthday]);
}
async function getTodayBirthdays() {
    const { rows } = await exports.pool.query(`
    SELECT b.chat_id, s.first_name
    FROM user_birthdays b
    LEFT JOIN subscribers s ON s.chat_id = b.chat_id
    WHERE EXTRACT(MONTH FROM b.birthday) = EXTRACT(MONTH FROM NOW())
      AND EXTRACT(DAY   FROM b.birthday) = EXTRACT(DAY   FROM NOW())
      AND (b.last_notified_year IS NULL OR b.last_notified_year < EXTRACT(YEAR FROM NOW()))
  `);
    return rows;
}
async function markBirthdayNotified(chatId) {
    await exports.pool.query(`UPDATE user_birthdays SET last_notified_year = EXTRACT(YEAR FROM NOW()) WHERE chat_id = $1`, [chatId]);
}

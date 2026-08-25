"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initAnalyticsSchema = initAnalyticsSchema;
exports.trackEvent = trackEvent;
exports.wasFunnelSent = wasFunnelSent;
exports.markFunnelSent = markFunnelSent;
exports.trackActivity = trackActivity;
exports.getDormantPlayers = getDormantPlayers;
exports.getClickerStats = getClickerStats;
/**
 * Аналитика «Котик Комбат» — лёгкий лог событий + дневная активность.
 *
 * Две таблицы:
 *  - clicker_activity — один upsert-ряд на (игрок, день по Иркутску): тапы, заходы,
 *    заработок. Дёшево, тянет DAU/WAU/MAU, retention, объём тапов.
 *  - clicker_events   — append-only воронка конверсий (levelup/daily/redeem/ref/…).
 *
 * trackEvent/trackActivity — fire-and-forget: НИКОГДА не бросают в путь запроса
 * (ошибка только в лог). Аналитика не должна ронять игру.
 *
 * Дашборд: GET /api/clicker/stats?token=ADMIN_TOKEN → JSON (см. getClickerStats),
 * статика public/admin/clicker-stats.html.
 */
const db_1 = require("./db");
const logger_1 = require("./logger");
const clicker_1 = require("./clicker");
// Сутки — по Иркутску (UTC+8), как и вся остальная игра.
const irkToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
async function initAnalyticsSchema() {
    await db_1.pool.query(`
    CREATE TABLE IF NOT EXISTS clicker_activity (
      chat_id   BIGINT NOT NULL,
      day       TEXT NOT NULL,
      taps      BIGINT NOT NULL DEFAULT 0,
      opens     INT NOT NULL DEFAULT 0,
      earned    BIGINT NOT NULL DEFAULT 0,
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (chat_id, day)
    );
    CREATE INDEX IF NOT EXISTS clicker_activity_day_idx ON clicker_activity (day);

    CREATE TABLE IF NOT EXISTS clicker_events (
      id         BIGSERIAL PRIMARY KEY,
      chat_id    BIGINT NOT NULL,
      event      TEXT NOT NULL,
      meta       JSONB,
      day        TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS clicker_events_day_event_idx ON clicker_events (day, event);
    CREATE INDEX IF NOT EXISTS clicker_events_chat_idx ON clicker_events (chat_id, created_at DESC);

    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS notified_level INT NOT NULL DEFAULT 0;
    -- Воронка MVP: реф-бонус за первый заказ приглашённого (T4) + welcome-промокод (T5).
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS ref_order_rewarded BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS welcome_promo_at TIMESTAMPTZ;

    -- Дедуп вороночных пушей: не слать один и тот же тип чаще, чем раз в N дней.
    CREATE TABLE IF NOT EXISTS funnel_dedup (
      chat_id BIGINT NOT NULL,
      tag     TEXT   NOT NULL,
      at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (chat_id, tag)
    );
  `);
    // Бэкфилл для уже существовавших игроков: ADD COLUMN проставил created_at=NOW()
    // всем старым рядам (искусственно «зарегистрированы сегодня»). Приближаем к
    // реальности — берём updated_at (created_at не может быть позже последней активности).
    await db_1.pool.query(`UPDATE clicker_state SET created_at = updated_at WHERE created_at > updated_at`);
}
/** Fire-and-forget событие воронки. meta — любой JSON-сериализуемый объект. */
function trackEvent(chatId, event, meta) {
    db_1.pool
        .query(`INSERT INTO clicker_events (chat_id, event, meta, day) VALUES ($1, $2, $3::jsonb, $4)`, [chatId, event, meta ? JSON.stringify(meta) : null, irkToday()])
        .catch((e) => logger_1.log.warn({ err: e, event }, "[analytics event]"));
}
/** Воронка: слался ли пуш с этим `tag` этому юзеру за последние `days` дней. */
async function wasFunnelSent(chatId, tag, days) {
    const { rows } = await db_1.pool.query(`SELECT 1 FROM funnel_dedup WHERE chat_id=$1 AND tag=$2 AND at > NOW() - ($3||' days')::interval`, [chatId, tag, String(Math.max(1, Math.floor(days)))]);
    return rows.length > 0;
}
/** Пометить, что пуш с `tag` отправлен юзеру (обновляет время при повторе). */
async function markFunnelSent(chatId, tag) {
    await db_1.pool
        .query(`INSERT INTO funnel_dedup (chat_id, tag, at) VALUES ($1,$2,NOW())
       ON CONFLICT (chat_id, tag) DO UPDATE SET at = NOW()`, [chatId, tag])
        .catch((e) => logger_1.log.warn({ err: e, tag }, "[funnel dedup]"));
}
/** Fire-and-forget дневная активность (upsert по игроку+дню). */
function trackActivity(chatId, opts = {}) {
    const { taps = 0, earned = 0, open = false } = opts;
    db_1.pool
        .query(`INSERT INTO clicker_activity (chat_id, day, taps, opens, earned, last_seen)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (chat_id, day) DO UPDATE SET
         taps   = clicker_activity.taps + EXCLUDED.taps,
         opens  = clicker_activity.opens + EXCLUDED.opens,
         earned = clicker_activity.earned + EXCLUDED.earned,
         last_seen = NOW()`, [chatId, irkToday(), taps, open ? 1 : 0, earned])
        .catch((e) => logger_1.log.warn({ err: e }, "[analytics activity]"));
}
/** T3: игроки, «уснувшие» между minDays и maxDays назад (для реактивации). */
async function getDormantPlayers(minDays, maxDays = 90) {
    const { rows } = await db_1.pool.query(`SELECT chat_id FROM clicker_activity
      GROUP BY chat_id
     HAVING MAX(last_seen) < NOW() - ($1||' days')::interval
        AND MAX(last_seen) > NOW() - ($2||' days')::interval`, [String(Math.max(1, Math.floor(minDays))), String(Math.max(1, Math.floor(maxDays)))]);
    return rows.map((r) => Number(r.chat_id));
}
// ── Дашборд ────────────────────────────────────────────────────────────────
const num = (v) => Number(v) || 0;
async function getClickerStats() {
    // Уровень считаем тем же порогом, что и игра (leagueFor). CASE строим из LEAGUES.
    const levelCase = "CASE " +
        [...clicker_1.LEAGUES]
            .slice()
            .sort((a, b) => b.need - a.need)
            .map((l) => `WHEN total_earned >= ${l.need} THEN ${l.level}`)
            .join(" ") +
        " ELSE 1 END";
    const [totals, active, taps, retD1, retD7, funnel, levels, events7d, series] = await Promise.all([
        db_1.pool.query(`
      SELECT
        (SELECT count(*) FROM clicker_state) AS players,
        (SELECT count(*) FROM clicker_state WHERE created_at >= NOW() - interval '1 day') AS new_today,
        (SELECT count(*) FROM clicker_state WHERE created_at >= NOW() - interval '7 day') AS new7d,
        (SELECT count(*) FROM clicker_state WHERE created_at >= NOW() - interval '30 day') AS new30d
    `),
        db_1.pool.query(`SELECT
         count(*) FILTER (WHERE day = $1) AS dau_today,
         count(*) FILTER (WHERE day = $2) AS dau_yesterday,
         count(DISTINCT chat_id) FILTER (WHERE day >= $3) AS wau,
         count(DISTINCT chat_id) FILTER (WHERE day >= $4) AS mau
       FROM clicker_activity`, [dayOffset(0), dayOffset(-1), dayOffset(-6), dayOffset(-29)]),
        db_1.pool.query(`SELECT
         COALESCE(sum(taps) FILTER (WHERE day = $1), 0) AS today,
         COALESCE(sum(taps) FILTER (WHERE day >= $2), 0) AS last7d
       FROM clicker_activity`, [dayOffset(0), dayOffset(-6)]),
        // D1: когорта зарегистрировавшихся 2..15 дней назад, вернулись ли на следующий день
        db_1.pool.query(`
      WITH cohort AS (
        SELECT chat_id, to_char(created_at AT TIME ZONE 'Asia/Irkutsk', 'YYYY-MM-DD') AS d0
        FROM clicker_state
        WHERE created_at >= NOW() - interval '15 day' AND created_at < NOW() - interval '1 day'
      )
      SELECT count(*) AS n,
        count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM clicker_activity a
          WHERE a.chat_id = c.chat_id AND a.day = to_char((c.d0::date + 1), 'YYYY-MM-DD')
        )) AS ret
      FROM cohort c
    `),
        // D7: когорта 8..30 дней назад, вернулись ли на 7-й день
        db_1.pool.query(`
      WITH cohort AS (
        SELECT chat_id, to_char(created_at AT TIME ZONE 'Asia/Irkutsk', 'YYYY-MM-DD') AS d0
        FROM clicker_state
        WHERE created_at >= NOW() - interval '30 day' AND created_at < NOW() - interval '7 day'
      )
      SELECT count(*) AS n,
        count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM clicker_activity a
          WHERE a.chat_id = c.chat_id AND a.day = to_char((c.d0::date + 7), 'YYYY-MM-DD')
        )) AS ret
      FROM cohort c
    `),
        // Воронка: сколько уникальных игроков КОГДА-ЛИБО совершили ключевое действие (за 30д)
        db_1.pool.query(`SELECT
         (SELECT count(DISTINCT chat_id) FROM clicker_activity WHERE day >= $1) AS players,
         (SELECT count(DISTINCT chat_id) FROM clicker_events WHERE event='daily'  AND day >= $1) AS daily,
         (SELECT count(DISTINCT chat_id) FROM clicker_events WHERE event='game'   AND day >= $1) AS game,
         (SELECT count(DISTINCT chat_id) FROM clicker_events WHERE event='redeem' AND day >= $1) AS redeem,
         (SELECT count(DISTINCT chat_id) FROM clicker_events WHERE event='ref'    AND day >= $1) AS ref`, [dayOffset(-29)]),
        db_1.pool.query(`SELECT ${levelCase} AS level, count(*) AS count FROM clicker_state GROUP BY 1 ORDER BY 1`),
        db_1.pool.query(`SELECT event, count(*) AS count FROM clicker_events WHERE day >= $1 GROUP BY event ORDER BY count DESC`, [dayOffset(-6)]),
        // Серия за 14 дней: DAU + тапы + новые игроки по дням
        db_1.pool.query(`SELECT d.day,
        (SELECT count(*) FROM clicker_activity a WHERE a.day = d.day) AS dau,
        (SELECT COALESCE(sum(taps),0) FROM clicker_activity a WHERE a.day = d.day) AS taps,
        (SELECT count(*) FROM clicker_state s
           WHERE to_char(s.created_at AT TIME ZONE 'Asia/Irkutsk','YYYY-MM-DD') = d.day) AS new_users
       FROM (SELECT to_char((NOW() AT TIME ZONE 'Asia/Irkutsk')::date - g, 'YYYY-MM-DD') AS day
             FROM generate_series(0, 13) g) d
       ORDER BY d.day`),
    ]);
    const lvlName = (lv) => clicker_1.LEAGUES.find((l) => l.level === lv)?.name || `Ур. ${lv}`;
    const t = totals.rows[0], a = active.rows[0], tp = taps.rows[0];
    const r1 = retD1.rows[0], r7 = retD7.rows[0], f = funnel.rows[0];
    return {
        generatedAt: new Date().toISOString(),
        tz: "Asia/Irkutsk (UTC+8)",
        totals: { players: num(t.players), newToday: num(t.new_today), new7d: num(t.new7d), new30d: num(t.new30d) },
        active: { dauToday: num(a.dau_today), dauYesterday: num(a.dau_yesterday), wau: num(a.wau), mau: num(a.mau) },
        taps: { today: num(tp.today), last7d: num(tp.last7d) },
        retention: {
            d1: num(r1.n) ? Math.round((num(r1.ret) / num(r1.n)) * 100) : 0,
            d1Cohort: num(r1.n),
            d7: num(r7.n) ? Math.round((num(r7.ret) / num(r7.n)) * 100) : 0,
            d7Cohort: num(r7.n),
        },
        funnel: {
            players: num(f.players), daily: num(f.daily), game: num(f.game), redeem: num(f.redeem), ref: num(f.ref),
        },
        levels: levels.rows.map((r) => ({ level: num(r.level), name: lvlName(num(r.level)), count: num(r.count) })),
        events7d: events7d.rows.map((r) => ({ event: String(r.event), count: num(r.count) })),
        series: series.rows.map((r) => ({ day: String(r.day), dau: num(r.dau), taps: num(r.taps), newUsers: num(r.new_users) })),
    };
}
// День по Иркутску со сдвигом на N суток (0 = сегодня, -1 = вчера).
function dayOffset(n) {
    return new Date(Date.now() + 8 * 3600 * 1000 + n * 86400000).toISOString().slice(0, 10);
}

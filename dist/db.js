"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WHEEL_PRIZES = exports.pool = void 0;
exports.initDb = initDb;
exports.getOrCreateReferralCode = getOrCreateReferralCode;
exports.getReferralOwner = getReferralOwner;
exports.getOrderStatusMap = getOrderStatusMap;
exports.setOrderStatus = setOrderStatus;
exports.getNotificationPrefs = getNotificationPrefs;
exports.setNotificationPrefs = setNotificationPrefs;
exports.saveCartSnapshot = saveCartSnapshot;
exports.clearCartSnapshot = clearCartSnapshot;
exports.getAbandonedCarts = getAbandonedCarts;
exports.markCartAbandonedPushed = markCartAbandonedPushed;
exports.getSpinStatus = getSpinStatus;
exports.recordSpin = recordSpin;
exports.touchVisitStreak = touchVisitStreak;
exports.getStreak = getStreak;
exports.setSecretOfDay = setSecretOfDay;
exports.getSecretOfDay = getSecretOfDay;
exports.getUnusedRewards = getUnusedRewards;
exports.canSendNotification = canSendNotification;
exports.logNotification = logNotification;
exports.recordReferralUse = recordReferralUse;
exports.wishlistSubscribe = wishlistSubscribe;
exports.wishlistUnsubscribe = wishlistUnsubscribe;
exports.wishlistSync = wishlistSync;
exports.getWishlistSubsForProducts = getWishlistSubsForProducts;
exports.touchSubscriber = touchSubscriber;
exports.getSubscriberInfo = getSubscriberInfo;
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

    ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
    ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS launch_count INT DEFAULT 0;

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
    CREATE INDEX IF NOT EXISTS notification_log_chat_idx ON notification_log (chat_id, sent_at DESC);

    CREATE TABLE IF NOT EXISTS notification_prefs (
      chat_id           BIGINT PRIMARY KEY,
      marketing_promo   BOOLEAN DEFAULT TRUE,
      marketing_rewards BOOLEAN DEFAULT TRUE,
      updated_at        TIMESTAMPTZ DEFAULT NOW()
    );

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
  `);
    console.log("[DB] Tables ready");
}
// Referral codes
async function getOrCreateReferralCode(chatId, firstName) {
    const { rows } = await exports.pool.query(`SELECT code FROM referral_codes WHERE owner_chat = $1 LIMIT 1`, [chatId]);
    if (rows[0]?.code)
        return rows[0].code;
    // Генерация кода: MARIA-{first_name uppercase ASCII или короткий hash}
    const cleanName = (firstName || "")
        .toUpperCase()
        .replace(/[^A-ZА-Я0-9]/g, "")
        .slice(0, 8);
    const tail = cleanName.length >= 2 ? cleanName : chatId.toString(36).toUpperCase().slice(-5);
    let code = `MARIA-${tail}`;
    // Проверка уникальности — если занято, добавим суффикс
    for (let i = 0; i < 5; i++) {
        const taken = await exports.pool.query(`SELECT 1 FROM referral_codes WHERE code = $1`, [code]);
        if (taken.rows.length === 0)
            break;
        code = `MARIA-${tail}${i + 2}`;
    }
    await exports.pool.query(`INSERT INTO referral_codes (code, owner_chat) VALUES ($1, $2)
     ON CONFLICT (code) DO NOTHING`, [code, chatId]);
    return code;
}
async function getReferralOwner(code) {
    const { rows } = await exports.pool.query(`SELECT owner_chat FROM referral_codes WHERE code = $1`, [code.toUpperCase()]);
    return rows[0]?.owner_chat ?? null;
}
// Order status tracking — diff между прошлым snapshot'ом и текущим
async function getOrderStatusMap(chatId) {
    const { rows } = await exports.pool.query(`SELECT order_id, status FROM order_status_seen WHERE chat_id = $1`, [chatId]);
    const m = new Map();
    for (const r of rows)
        m.set(String(r.order_id), String(r.status ?? ""));
    return m;
}
async function setOrderStatus(chatId, orderId, status) {
    await exports.pool.query(`INSERT INTO order_status_seen (chat_id, order_id, status, seen_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (chat_id, order_id) DO UPDATE SET status = $3, seen_at = NOW()`, [chatId, orderId, status]);
}
async function getNotificationPrefs(chatId) {
    const { rows } = await exports.pool.query(`SELECT marketing_promo, marketing_rewards FROM notification_prefs WHERE chat_id = $1`, [chatId]);
    if (rows[0])
        return { marketing_promo: rows[0].marketing_promo, marketing_rewards: rows[0].marketing_rewards };
    return { marketing_promo: true, marketing_rewards: true };
}
async function setNotificationPrefs(chatId, prefs) {
    await exports.pool.query(`INSERT INTO notification_prefs (chat_id, marketing_promo, marketing_rewards, updated_at)
     VALUES ($1, COALESCE($2, TRUE), COALESCE($3, TRUE), NOW())
     ON CONFLICT (chat_id) DO UPDATE
       SET marketing_promo   = COALESCE($2, notification_prefs.marketing_promo),
           marketing_rewards = COALESCE($3, notification_prefs.marketing_rewards),
           updated_at        = NOW()`, [chatId, prefs.marketing_promo ?? null, prefs.marketing_rewards ?? null]);
}
async function saveCartSnapshot(chatId, items, totalSum) {
    const itemCount = Array.isArray(items)
        ? items.reduce((s, it) => s + (Number(it?.qty) || 0), 0)
        : 0;
    await exports.pool.query(`INSERT INTO cart_snapshots (chat_id, items_json, total_sum, item_count, snapshot_at, abandoned_pushed)
     VALUES ($1, $2, $3, $4, NOW(), FALSE)
     ON CONFLICT (chat_id) DO UPDATE
       SET items_json = $2, total_sum = $3, item_count = $4, snapshot_at = NOW(), abandoned_pushed = FALSE`, [chatId, JSON.stringify(items || []), totalSum | 0, itemCount | 0]);
}
async function clearCartSnapshot(chatId) {
    await exports.pool.query(`DELETE FROM cart_snapshots WHERE chat_id = $1`, [chatId]);
}
async function getAbandonedCarts() {
    // Активные корзины старше 24h, ещё не было abandonment push, есть items
    const { rows } = await exports.pool.query(`SELECT chat_id, items_json, total_sum, item_count, snapshot_at, abandoned_pushed
     FROM cart_snapshots
     WHERE abandoned_pushed = FALSE
       AND item_count > 0
       AND snapshot_at < NOW() - INTERVAL '24 hours'
       AND snapshot_at > NOW() - INTERVAL '7 days'`);
    return rows;
}
async function markCartAbandonedPushed(chatId) {
    await exports.pool.query(`UPDATE cart_snapshots SET abandoned_pushed = TRUE WHERE chat_id = $1`, [chatId]);
}
exports.WHEEL_PRIZES = [
    { kind: "discount_coupon", value: "5", label: "Купон −5%", emoji: "🎫", weight: 22 },
    { kind: "points", value: "50", label: "+50 баллов", emoji: "💎", weight: 25 },
    { kind: "free_eclair", value: "1", label: "Бесплатный эклер от 800 ₽", emoji: "🍫", weight: 15 },
    { kind: "double_points", value: "1", label: "×2 баллов сегодня", emoji: "✨", weight: 12 },
    { kind: "sweet_ticket", value: "1", label: "Билет в Sweet Check", emoji: "🎟", weight: 10 },
    { kind: "cake_month_10", value: "10", label: "Торт месяца −10%", emoji: "🎂", weight: 8 },
    { kind: "nothing", value: "0", label: "Удача рядом — крутни завтра", emoji: "🙈", weight: 8 },
];
function pickWeightedPrize() {
    const total = exports.WHEEL_PRIZES.reduce((s, p) => s + p.weight, 0);
    let r = Math.random() * total;
    for (const p of exports.WHEEL_PRIZES) {
        if (r < p.weight)
            return p;
        r -= p.weight;
    }
    return exports.WHEEL_PRIZES[0];
}
function isSameDayIrkutsk(d1, d2) {
    if (!d1)
        return false;
    // Иркутск UTC+8
    const toIrk = (d) => new Date(d.getTime() + 8 * 3600000);
    const a = toIrk(d1).toISOString().slice(0, 10);
    const b = toIrk(d2).toISOString().slice(0, 10);
    return a === b;
}
async function getSpinStatus(chatId) {
    const { rows } = await exports.pool.query(`SELECT last_spin_at, prize_kind, prize_value FROM daily_spins WHERE chat_id = $1`, [chatId]);
    if (!rows[0] || !rows[0].last_spin_at)
        return { canSpin: true, lastPrize: null };
    const last = new Date(rows[0].last_spin_at);
    const now = new Date();
    if (isSameDayIrkutsk(last, now)) {
        // Уже крутил сегодня
        const prizeIdx = exports.WHEEL_PRIZES.findIndex((p) => p.kind === rows[0].prize_kind);
        const lastPrize = prizeIdx >= 0 ? exports.WHEEL_PRIZES[prizeIdx] : null;
        // Время до завтра 00:00 Иркутск
        const toIrk = (d) => new Date(d.getTime() + 8 * 3600000);
        const irkNow = toIrk(now);
        const nextMidnightIrk = new Date(Date.UTC(irkNow.getUTCFullYear(), irkNow.getUTCMonth(), irkNow.getUTCDate() + 1));
        const nextUTC = new Date(nextMidnightIrk.getTime() - 8 * 3600000);
        return { canSpin: false, lastPrize, nextSpinAt: nextUTC.toISOString() };
    }
    return { canSpin: true, lastPrize: null };
}
async function recordSpin(chatId) {
    const status = await getSpinStatus(chatId);
    if (!status.canSpin && status.lastPrize) {
        return { prize: status.lastPrize, alreadySpunToday: true };
    }
    const prize = pickWeightedPrize();
    await exports.pool.query(`INSERT INTO daily_spins (chat_id, last_spin_at, prize_kind, prize_value)
     VALUES ($1, NOW(), $2, $3)
     ON CONFLICT (chat_id) DO UPDATE SET last_spin_at = NOW(), prize_kind = $2, prize_value = $3`, [chatId, prize.kind, prize.value]);
    // Логируем earned_reward кроме nothing
    if (prize.kind !== "nothing") {
        await exports.pool.query(`INSERT INTO earned_rewards (chat_id, kind, value, source) VALUES ($1, $2, $3, 'wheel')`, [chatId, prize.kind, prize.value]);
    }
    return { prize, alreadySpunToday: false };
}
// ─── Visit Streaks ───────────────────────────────────────────────────────────
async function touchVisitStreak(chatId) {
    const { rows } = await exports.pool.query(`SELECT current_streak, longest_streak, last_visit_date FROM visit_streaks WHERE chat_id = $1`, [chatId]);
    const now = new Date();
    const toIrk = (d) => new Date(d.getTime() + 8 * 3600000);
    const todayIrk = toIrk(now).toISOString().slice(0, 10);
    if (!rows[0]) {
        await exports.pool.query(`INSERT INTO visit_streaks (chat_id, current_streak, longest_streak, last_visit_date)
       VALUES ($1, 1, 1, $2::date)`, [chatId, todayIrk]);
        return { currentStreak: 1, longestStreak: 1, reachedReward: false };
    }
    const lastDate = rows[0].last_visit_date;
    let cur = Number(rows[0].current_streak) || 0;
    let longest = Number(rows[0].longest_streak) || 0;
    const lastIrk = lastDate ? toIrk(new Date(lastDate)).toISOString().slice(0, 10) : null;
    if (lastIrk === todayIrk) {
        // Уже отмечен сегодня
        return { currentStreak: cur, longestStreak: longest, reachedReward: false };
    }
    // Проверяем — было ли вчера
    const yesterday = new Date(now.getTime() - 24 * 3600000);
    const yesterdayIrk = toIrk(yesterday).toISOString().slice(0, 10);
    if (lastIrk === yesterdayIrk) {
        cur += 1;
    }
    else {
        cur = 1; // streak обнулён
    }
    let reachedReward = false;
    if (cur >= 7) {
        // Награда! Сбрасываем streak.
        await exports.pool.query(`INSERT INTO earned_rewards (chat_id, kind, value, source)
       VALUES ($1, 'free_dessert', '1', 'streak_7')`, [chatId]);
        reachedReward = true;
        cur = 0; // или оставить, но новый цикл — пусть сбросится
    }
    longest = Math.max(longest, cur);
    await exports.pool.query(`UPDATE visit_streaks SET current_streak = $2, longest_streak = $3, last_visit_date = $4::date WHERE chat_id = $1`, [chatId, cur, longest, todayIrk]);
    return { currentStreak: cur, longestStreak: longest, reachedReward };
}
async function getStreak(chatId) {
    const { rows } = await exports.pool.query(`SELECT current_streak, longest_streak, last_visit_date FROM visit_streaks WHERE chat_id = $1`, [chatId]);
    if (!rows[0])
        return { currentStreak: 0, longestStreak: 0 };
    // Если последний визит не вчера и не сегодня — streak уже сломан, но фактически в DB не обновлён
    // Возвращаем как есть; touchVisitStreak обновит при следующем визите.
    const now = new Date();
    const toIrk = (d) => new Date(d.getTime() + 8 * 3600000);
    const todayIrk = toIrk(now).toISOString().slice(0, 10);
    const yesterdayIrk = toIrk(new Date(now.getTime() - 24 * 3600000)).toISOString().slice(0, 10);
    const lastIrk = rows[0].last_visit_date ? toIrk(new Date(rows[0].last_visit_date)).toISOString().slice(0, 10) : null;
    const cur = (lastIrk === todayIrk || lastIrk === yesterdayIrk) ? (Number(rows[0].current_streak) || 0) : 0;
    return { currentStreak: cur, longestStreak: Number(rows[0].longest_streak) || 0 };
}
// ─── Secret of the Day ───────────────────────────────────────────────────────
async function setSecretOfDay(productId, discountPct = 15) {
    const today = new Date();
    const toIrk = (d) => new Date(d.getTime() + 8 * 3600000);
    const dateIrk = toIrk(today).toISOString().slice(0, 10);
    await exports.pool.query(`INSERT INTO secret_of_day (date, product_id, discount_pct)
     VALUES ($1::date, $2, $3)
     ON CONFLICT (date) DO UPDATE SET product_id = $2, discount_pct = $3`, [dateIrk, productId, discountPct]);
}
async function getSecretOfDay() {
    const today = new Date();
    const toIrk = (d) => new Date(d.getTime() + 8 * 3600000);
    const dateIrk = toIrk(today).toISOString().slice(0, 10);
    const { rows } = await exports.pool.query(`SELECT product_id, discount_pct FROM secret_of_day WHERE date = $1::date`, [dateIrk]);
    if (!rows[0])
        return null;
    // Истекает в 23:59 Иркутска
    const irkNow = toIrk(today);
    const eod = new Date(Date.UTC(irkNow.getUTCFullYear(), irkNow.getUTCMonth(), irkNow.getUTCDate(), 23, 59, 59));
    const expiresAt = new Date(eod.getTime() - 8 * 3600000).toISOString();
    return { productId: Number(rows[0].product_id), discountPct: Number(rows[0].discount_pct), expiresAt };
}
// ─── Earned rewards (выигрыши) ────────────────────────────────────────────────
async function getUnusedRewards(chatId) {
    const { rows } = await exports.pool.query(`SELECT id, kind, value, earned_at FROM earned_rewards
     WHERE chat_id = $1 AND used_at IS NULL
     ORDER BY earned_at DESC LIMIT 20`, [chatId]);
    return rows;
}
const RATE_RULES = {
    transactional: { maxPerDay: 999, minIntervalMin: 0 },
    marketing: { maxPerWeek: 1, minIntervalMin: 60 },
};
function isQuietHours() {
    // 22:00 – 09:00 по Иркутску (UTC+8)
    const utc = new Date();
    const irkHour = (utc.getUTCHours() + 8) % 24;
    return irkHour >= 22 || irkHour < 9;
}
async function canSendNotification(chatId, kind) {
    const isMarketing = kind === "marketing" || kind === "marketing_promo" || kind === "marketing_rewards";
    if (isMarketing && isQuietHours()) {
        return { ok: false, reason: "quiet_hours" };
    }
    // User-prefs check
    if (kind === "marketing_promo" || kind === "marketing_rewards") {
        const prefs = await getNotificationPrefs(chatId);
        if (kind === "marketing_promo" && !prefs.marketing_promo)
            return { ok: false, reason: "promo_disabled" };
        if (kind === "marketing_rewards" && !prefs.marketing_rewards)
            return { ok: false, reason: "rewards_disabled" };
    }
    if (isMarketing) {
        const { rows } = await exports.pool.query(`SELECT COUNT(*)::int AS cnt FROM notification_log
       WHERE chat_id = $1 AND kind LIKE 'marketing%' AND sent_at > NOW() - INTERVAL '7 days'`, [chatId]);
        if ((rows[0]?.cnt ?? 0) >= RATE_RULES.marketing.maxPerWeek) {
            return { ok: false, reason: "marketing_quota_exceeded" };
        }
    }
    // Глобальный лимит — max 5 push за сутки на юзера
    const { rows: total } = await exports.pool.query(`SELECT COUNT(*)::int AS cnt FROM notification_log
     WHERE chat_id = $1 AND sent_at > NOW() - INTERVAL '24 hours'`, [chatId]);
    if ((total[0]?.cnt ?? 0) >= 5) {
        return { ok: false, reason: "daily_quota_exceeded" };
    }
    return { ok: true };
}
async function logNotification(chatId, kind) {
    await exports.pool.query(`INSERT INTO notification_log (chat_id, kind) VALUES ($1, $2)`, [chatId, kind]);
}
async function recordReferralUse(usedByChat, code) {
    // Один юзер может ввести реф-код только один раз. Не может ввести свой код.
    const ownerChat = await getReferralOwner(code);
    if (!ownerChat)
        return { ok: false, reason: "code_not_found" };
    if (ownerChat === usedByChat)
        return { ok: false, reason: "own_code" };
    const exists = await exports.pool.query(`SELECT code FROM referral_uses WHERE used_by_chat = $1`, [usedByChat]);
    if (exists.rows.length > 0)
        return { ok: false, reason: "already_used" };
    await exports.pool.query(`INSERT INTO referral_uses (used_by_chat, code) VALUES ($1, $2)`, [usedByChat, code.toUpperCase()]);
    return { ok: true, ownerChat };
}
// Wishlist subscriptions — для уведомлений «снова в наличии»
async function wishlistSubscribe(chatId, productId) {
    await exports.pool.query(`INSERT INTO wishlist_subs (chat_id, product_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`, [chatId, productId]);
}
async function wishlistUnsubscribe(chatId, productId) {
    await exports.pool.query(`DELETE FROM wishlist_subs WHERE chat_id = $1 AND product_id = $2`, [chatId, productId]);
}
async function wishlistSync(chatId, productIds) {
    // Полная синхронизация: продукты в массиве остаются, остальное удаляется
    await exports.pool.query(`DELETE FROM wishlist_subs WHERE chat_id = $1 AND product_id <> ALL($2::int[])`, [chatId, productIds.length > 0 ? productIds : [0]]);
    if (productIds.length > 0) {
        const values = productIds.map((_, i) => `($1, $${i + 2})`).join(", ");
        await exports.pool.query(`INSERT INTO wishlist_subs (chat_id, product_id) VALUES ${values}
       ON CONFLICT DO NOTHING`, [chatId, ...productIds]);
    }
}
async function getWishlistSubsForProducts(productIds) {
    if (productIds.length === 0)
        return [];
    const { rows } = await exports.pool.query(`SELECT chat_id, product_id FROM wishlist_subs WHERE product_id = ANY($1::int[])`, [productIds]);
    return rows;
}
async function touchSubscriber(chatId, username, firstName) {
    await exports.pool.query(`INSERT INTO subscribers (chat_id, username, first_name, last_seen_at, launch_count)
     VALUES ($1, $2, $3, NOW(), 1)
     ON CONFLICT (chat_id) DO UPDATE
       SET username = COALESCE($2, subscribers.username),
           first_name = COALESCE($3, subscribers.first_name),
           last_seen_at = NOW(),
           launch_count = subscribers.launch_count + 1`, [chatId, username ?? null, firstName ?? null]);
}
async function getSubscriberInfo(chatId) {
    const { rows } = await exports.pool.query(`SELECT joined_at, last_seen_at, launch_count FROM subscribers WHERE chat_id = $1`, [chatId]);
    return rows[0] ?? null;
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

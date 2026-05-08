"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONVERSION_TIERS = exports.POINT_TTL_DAYS = exports.STAR_DAILY_CAP = exports.BONUS_REFERRAL = exports.BONUS_STREAK_30 = exports.BONUS_STREAK_7 = exports.BONUS_DAILY_LOGIN = exports.BONUS_VERIFY_PHONE = void 0;
exports.initClubSchema = initClubSchema;
exports.getBalance = getBalance;
exports.earnPoints = earnPoints;
exports.spendPoints = spendPoints;
exports.earnStars = earnStars;
exports.convertStars = convertStars;
exports.isPhoneVerified = isPhoneVerified;
exports.verifyPhone = verifyPhone;
exports.claimDailyLogin = claimDailyLogin;
exports.recordGameResult = recordGameResult;
exports.getRewardsCatalog = getRewardsCatalog;
exports.redeemReward = redeemReward;
exports.getMyRewards = getMyRewards;
exports.getHistory = getHistory;
exports.getDailyStatus = getDailyStatus;
exports.recordReferral = recordReferral;
const db_1 = require("./db");
// ─── Schema ──────────────────────────────────────────────────────────────────
async function initClubSchema() {
    await db_1.pool.query(`
    -- Add phone columns to existing subscribers table (idempotent)
    ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS phone TEXT;
    ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;

    CREATE TABLE IF NOT EXISTS user_balances (
      chat_id              BIGINT PRIMARY KEY,
      stars                INT NOT NULL DEFAULT 0,
      points               INT NOT NULL DEFAULT 0,
      total_earned_stars   INT NOT NULL DEFAULT 0,
      total_earned_points  INT NOT NULL DEFAULT 0,
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS point_transactions (
      id          BIGSERIAL PRIMARY KEY,
      chat_id     BIGINT NOT NULL,
      amount      INT NOT NULL,
      kind        TEXT NOT NULL,
      source      TEXT NOT NULL,
      meta        JSONB,
      expires_at  TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_point_tx_chat ON point_transactions (chat_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_point_tx_expires ON point_transactions (expires_at) WHERE expires_at IS NOT NULL;

    CREATE TABLE IF NOT EXISTS star_transactions (
      id         BIGSERIAL PRIMARY KEY,
      chat_id    BIGINT NOT NULL,
      amount     INT NOT NULL,
      source     TEXT NOT NULL,
      meta       JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_star_tx_chat ON star_transactions (chat_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS game_records (
      chat_id    BIGINT NOT NULL,
      game       TEXT NOT NULL,
      record     INT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (chat_id, game)
    );

    CREATE TABLE IF NOT EXISTS daily_activity (
      chat_id              BIGINT NOT NULL,
      date                 DATE NOT NULL,
      daily_login_claimed  BOOLEAN NOT NULL DEFAULT FALSE,
      games_played         INT NOT NULL DEFAULT 0,
      stars_earned_today   INT NOT NULL DEFAULT 0,
      PRIMARY KEY (chat_id, date)
    );

    CREATE TABLE IF NOT EXISTS user_streaks (
      chat_id          BIGINT PRIMARY KEY,
      current_streak   INT NOT NULL DEFAULT 0,
      longest_streak   INT NOT NULL DEFAULT 0,
      last_login_date  DATE
    );

    CREATE TABLE IF NOT EXISTS rewards_catalog (
      id              SERIAL PRIMARY KEY,
      code            TEXT UNIQUE NOT NULL,
      title           TEXT NOT NULL,
      description     TEXT,
      reward_type     TEXT NOT NULL,
      discount_value  INT,
      min_order       INT NOT NULL DEFAULT 0,
      cost_points     INT NOT NULL,
      active          BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order      INT NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS user_rewards (
      id            BIGSERIAL PRIMARY KEY,
      chat_id       BIGINT NOT NULL,
      reward_id     INT NOT NULL REFERENCES rewards_catalog(id),
      promo_code    TEXT UNIQUE NOT NULL,
      cost_paid     INT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at    TIMESTAMPTZ NOT NULL,
      used_at       TIMESTAMPTZ,
      used_order_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_user_rewards_chat ON user_rewards (chat_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS referrals (
      id              BIGSERIAL PRIMARY KEY,
      referrer_id     BIGINT NOT NULL,
      referee_id      BIGINT UNIQUE NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      first_order_at  TIMESTAMPTZ,
      bonus_paid      BOOLEAN NOT NULL DEFAULT FALSE
    );
  `);
    // Seed rewards catalog if empty
    const { rows } = await db_1.pool.query(`SELECT COUNT(*)::int AS n FROM rewards_catalog`);
    if (rows[0].n === 0) {
        await db_1.pool.query(`
      INSERT INTO rewards_catalog (code, title, description, reward_type, discount_value, min_order, cost_points, sort_order) VALUES
        ('discount_5',     'Промокод −5%',         'Скидка 5% на заказ',      'percent',   5,    500,  100, 1),
        ('discount_10',    'Промокод −10%',        'Скидка 10% на заказ',     'percent',   10,   1000, 300, 2),
        ('free_dessert',   'Бесплатный десерт',    'К торту от 2000₽',        'free_item', NULL, 2000, 600, 3),
        ('discount_500',   'Скидка 500₽ на торт',  'На торт от 3000₽',        'amount',    500,  3000, 1000, 4),
        ('discount_1500',  'Скидка 1500₽ на торт', 'На торт от 5000₽',        'amount',    1500, 5000, 2800, 5)
    `);
    }
    console.log("[CLUB] Schema ready");
}
// ─── Constants ───────────────────────────────────────────────────────────────
exports.BONUS_VERIFY_PHONE = 100;
exports.BONUS_DAILY_LOGIN = 10;
exports.BONUS_STREAK_7 = 100;
exports.BONUS_STREAK_30 = 400;
exports.BONUS_REFERRAL = 300;
exports.STAR_DAILY_CAP = 300;
exports.POINT_TTL_DAYS = 90;
async function getBalance(chatId) {
    await db_1.pool.query(`INSERT INTO user_balances (chat_id) VALUES ($1) ON CONFLICT (chat_id) DO NOTHING`, [chatId]);
    const { rows } = await db_1.pool.query(`SELECT stars, points, total_earned_stars, total_earned_points FROM user_balances WHERE chat_id = $1`, [chatId]);
    const r = rows[0];
    return {
        stars: r.stars,
        points: r.points,
        totalEarnedStars: r.total_earned_stars,
        totalEarnedPoints: r.total_earned_points,
    };
}
// ─── Points: earn/spend ──────────────────────────────────────────────────────
async function earnPoints(chatId, amount, source, meta = {}) {
    if (amount <= 0)
        return;
    const expires = `NOW() + INTERVAL '${exports.POINT_TTL_DAYS} days'`;
    await db_1.pool.query("BEGIN");
    try {
        await db_1.pool.query(`INSERT INTO user_balances (chat_id, points, total_earned_points)
       VALUES ($1, $2, $2)
       ON CONFLICT (chat_id) DO UPDATE
         SET points = user_balances.points + $2,
             total_earned_points = user_balances.total_earned_points + $2,
             updated_at = NOW()`, [chatId, amount]);
        await db_1.pool.query(`INSERT INTO point_transactions (chat_id, amount, kind, source, meta, expires_at)
       VALUES ($1, $2, 'earn', $3, $4, ${expires})`, [chatId, amount, source, JSON.stringify(meta)]);
        await db_1.pool.query("COMMIT");
    }
    catch (e) {
        await db_1.pool.query("ROLLBACK");
        throw e;
    }
}
async function spendPoints(chatId, amount, source, meta = {}) {
    if (amount <= 0)
        return { ok: false, reason: "bad_amount" };
    await db_1.pool.query("BEGIN");
    try {
        const { rows } = await db_1.pool.query(`SELECT points FROM user_balances WHERE chat_id = $1 FOR UPDATE`, [chatId]);
        const have = rows[0]?.points ?? 0;
        if (have < amount) {
            await db_1.pool.query("ROLLBACK");
            return { ok: false, reason: "insufficient" };
        }
        await db_1.pool.query(`UPDATE user_balances SET points = points - $2, updated_at = NOW() WHERE chat_id = $1`, [chatId, amount]);
        await db_1.pool.query(`INSERT INTO point_transactions (chat_id, amount, kind, source, meta)
       VALUES ($1, $2, 'spend', $3, $4)`, [chatId, -amount, source, JSON.stringify(meta)]);
        await db_1.pool.query("COMMIT");
        return { ok: true };
    }
    catch (e) {
        await db_1.pool.query("ROLLBACK");
        throw e;
    }
}
// ─── Stars: earn ─────────────────────────────────────────────────────────────
async function earnStars(chatId, amount, source, meta = {}) {
    if (amount <= 0)
        return { awarded: 0, capped: false };
    const today = new Date().toISOString().slice(0, 10);
    await db_1.pool.query("BEGIN");
    try {
        // Daily cap check
        await db_1.pool.query(`INSERT INTO daily_activity (chat_id, date) VALUES ($1, $2)
       ON CONFLICT (chat_id, date) DO NOTHING`, [chatId, today]);
        const { rows } = await db_1.pool.query(`SELECT stars_earned_today FROM daily_activity WHERE chat_id = $1 AND date = $2 FOR UPDATE`, [chatId, today]);
        const earnedToday = rows[0].stars_earned_today;
        const remaining = Math.max(0, exports.STAR_DAILY_CAP - earnedToday);
        const toAward = Math.min(amount, remaining);
        const capped = toAward < amount;
        if (toAward === 0) {
            await db_1.pool.query("COMMIT");
            return { awarded: 0, capped: true };
        }
        await db_1.pool.query(`UPDATE daily_activity SET stars_earned_today = stars_earned_today + $3
       WHERE chat_id = $1 AND date = $2`, [chatId, today, toAward]);
        await db_1.pool.query(`INSERT INTO user_balances (chat_id, stars, total_earned_stars)
       VALUES ($1, $2, $2)
       ON CONFLICT (chat_id) DO UPDATE
         SET stars = user_balances.stars + $2,
             total_earned_stars = user_balances.total_earned_stars + $2,
             updated_at = NOW()`, [chatId, toAward]);
        await db_1.pool.query(`INSERT INTO star_transactions (chat_id, amount, source, meta)
       VALUES ($1, $2, $3, $4)`, [chatId, toAward, source, JSON.stringify(meta)]);
        await db_1.pool.query("COMMIT");
        return { awarded: toAward, capped };
    }
    catch (e) {
        await db_1.pool.query("ROLLBACK");
        throw e;
    }
}
// ─── Conversion ──────────────────────────────────────────────────────────────
exports.CONVERSION_TIERS = [
    { stars: 50, points: 5 },
    { stars: 200, points: 25 },
    { stars: 500, points: 75 },
    { stars: 1000, points: 175 },
];
async function convertStars(chatId, starsToConvert) {
    const tier = exports.CONVERSION_TIERS.find((t) => t.stars === starsToConvert);
    if (!tier)
        return { ok: false, reason: "invalid_tier" };
    await db_1.pool.query("BEGIN");
    try {
        const { rows } = await db_1.pool.query(`SELECT stars FROM user_balances WHERE chat_id = $1 FOR UPDATE`, [chatId]);
        const have = rows[0]?.stars ?? 0;
        if (have < tier.stars) {
            await db_1.pool.query("ROLLBACK");
            return { ok: false, reason: "insufficient_stars" };
        }
        await db_1.pool.query(`UPDATE user_balances
         SET stars = stars - $2,
             points = points + $3,
             total_earned_points = total_earned_points + $3,
             updated_at = NOW()
       WHERE chat_id = $1`, [chatId, tier.stars, tier.points]);
        await db_1.pool.query(`INSERT INTO star_transactions (chat_id, amount, source, meta)
       VALUES ($1, $2, 'conversion', $3)`, [chatId, -tier.stars, JSON.stringify({ pointsGained: tier.points })]);
        await db_1.pool.query(`INSERT INTO point_transactions (chat_id, amount, kind, source, meta, expires_at)
       VALUES ($1, $2, 'convert', 'star_conversion', $3, NOW() + INTERVAL '${exports.POINT_TTL_DAYS} days')`, [chatId, tier.points, JSON.stringify({ starsSpent: tier.stars })]);
        await db_1.pool.query("COMMIT");
        return { ok: true, pointsGained: tier.points };
    }
    catch (e) {
        await db_1.pool.query("ROLLBACK");
        throw e;
    }
}
// ─── Phone verification ──────────────────────────────────────────────────────
async function isPhoneVerified(chatId) {
    const { rows } = await db_1.pool.query(`SELECT phone_verified_at FROM subscribers WHERE chat_id = $1`, [chatId]);
    return Boolean(rows[0]?.phone_verified_at);
}
async function verifyPhone(chatId, phone) {
    const cleanPhone = phone.replace(/[^\d+]/g, "");
    const { rows } = await db_1.pool.query(`SELECT phone_verified_at FROM subscribers WHERE chat_id = $1`, [chatId]);
    if (rows[0]?.phone_verified_at) {
        // Already verified — just update phone if changed
        await db_1.pool.query(`UPDATE subscribers SET phone = $2 WHERE chat_id = $1`, [chatId, cleanPhone]);
        return { alreadyVerified: true, bonusAwarded: 0 };
    }
    // First-time verify
    await db_1.pool.query(`INSERT INTO subscribers (chat_id, phone, phone_verified_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (chat_id) DO UPDATE
       SET phone = $2, phone_verified_at = NOW()`, [chatId, cleanPhone]);
    await earnPoints(chatId, exports.BONUS_VERIFY_PHONE, "phone_verification", { phone: cleanPhone });
    return { alreadyVerified: false, bonusAwarded: exports.BONUS_VERIFY_PHONE };
}
// ─── Daily login ─────────────────────────────────────────────────────────────
async function claimDailyLogin(chatId) {
    const today = new Date().toISOString().slice(0, 10);
    await db_1.pool.query("BEGIN");
    try {
        // Check if already claimed today
        await db_1.pool.query(`INSERT INTO daily_activity (chat_id, date) VALUES ($1, $2)
       ON CONFLICT (chat_id, date) DO NOTHING`, [chatId, today]);
        const { rows } = await db_1.pool.query(`SELECT daily_login_claimed FROM daily_activity WHERE chat_id = $1 AND date = $2 FOR UPDATE`, [chatId, today]);
        if (rows[0].daily_login_claimed) {
            await db_1.pool.query("ROLLBACK");
            return { ok: false, reason: "already_claimed_today" };
        }
        // Update streak
        const streakRes = await db_1.pool.query(`SELECT current_streak, last_login_date FROM user_streaks WHERE chat_id = $1`, [chatId]);
        let streak = 1;
        if (streakRes.rows.length > 0) {
            const last = streakRes.rows[0].last_login_date;
            const cur = streakRes.rows[0].current_streak;
            if (last) {
                const lastStr = last.toISOString().slice(0, 10);
                const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
                if (lastStr === yesterday)
                    streak = cur + 1;
                else if (lastStr === today)
                    streak = cur; // shouldn't happen given guard above
                else
                    streak = 1;
            }
        }
        await db_1.pool.query(`INSERT INTO user_streaks (chat_id, current_streak, longest_streak, last_login_date)
       VALUES ($1, $2, $2, $3)
       ON CONFLICT (chat_id) DO UPDATE
         SET current_streak = $2,
             longest_streak = GREATEST(user_streaks.longest_streak, $2),
             last_login_date = $3`, [chatId, streak, today]);
        await db_1.pool.query(`UPDATE daily_activity SET daily_login_claimed = TRUE WHERE chat_id = $1 AND date = $2`, [chatId, today]);
        await db_1.pool.query("COMMIT");
        await earnPoints(chatId, exports.BONUS_DAILY_LOGIN, "daily_login", { streak });
        let streakBonus = 0;
        if (streak === 7) {
            streakBonus = exports.BONUS_STREAK_7;
            await earnPoints(chatId, exports.BONUS_STREAK_7, "streak_7", { streak });
        }
        else if (streak === 30) {
            streakBonus = exports.BONUS_STREAK_30;
            await earnPoints(chatId, exports.BONUS_STREAK_30, "streak_30", { streak });
        }
        return {
            ok: true,
            pointsAwarded: exports.BONUS_DAILY_LOGIN,
            streakBonus,
            streakDays: streak,
        };
    }
    catch (e) {
        await db_1.pool.query("ROLLBACK");
        throw e;
    }
}
// ─── Game results ────────────────────────────────────────────────────────────
// Звёзды за игры временно отключены (по решению команды). Личные рекорды
// продолжают записываться — это самостоятельная gamification без награды.
const STAR_RATES = {
    flappy_cake: () => 0,
    memory: () => 0,
    bakery: () => 0,
};
async function recordGameResult(chatId, game, score) {
    const rateFn = STAR_RATES[game];
    if (!rateFn)
        throw new Error(`Unknown game: ${game}`);
    const baseStars = rateFn(score);
    const baseRes = await earnStars(chatId, baseStars, game, { score });
    // Check personal record
    const { rows } = await db_1.pool.query(`SELECT record FROM game_records WHERE chat_id = $1 AND game = $2`, [chatId, game]);
    const prev = rows[0]?.record ?? 0;
    let recordBonus = 0;
    let recordBeaten = false;
    if (score > prev) {
        recordBeaten = true;
        await db_1.pool.query(`INSERT INTO game_records (chat_id, game, record, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (chat_id, game) DO UPDATE SET record = $3, updated_at = NOW()`, [chatId, game, score]);
        // Бонус за рекорд тоже отключён (вместе с базовыми звёздами за игры)
        // if (prev > 0) {
        //   const bonusRes = await earnStars(chatId, 50, "record_bonus", { game, score, prev });
        //   recordBonus = bonusRes.awarded;
        // }
    }
    return {
        starsAwarded: baseRes.awarded,
        recordBeaten,
        recordBonus,
        capped: baseRes.capped,
    };
}
async function getRewardsCatalog() {
    const { rows } = await db_1.pool.query(`SELECT id, code, title, description, reward_type, discount_value, min_order, cost_points
       FROM rewards_catalog WHERE active = TRUE ORDER BY sort_order, id`);
    return rows;
}
function generatePromoCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 6; i++)
        s += chars[Math.floor(Math.random() * chars.length)];
    return `MARIA-${s}`;
}
async function redeemReward(chatId, rewardId) {
    const { rows } = await db_1.pool.query(`SELECT id, cost_points, active FROM rewards_catalog WHERE id = $1`, [rewardId]);
    if (!rows[0] || !rows[0].active)
        return { ok: false, reason: "reward_unavailable" };
    const cost = rows[0].cost_points;
    // Atomic spend
    const spend = await spendPoints(chatId, cost, "reward", { reward_id: rewardId });
    if (!spend.ok)
        return { ok: false, reason: spend.reason };
    // Generate unique promo code
    let promoCode = "";
    for (let i = 0; i < 5; i++) {
        promoCode = generatePromoCode();
        try {
            const ins = await db_1.pool.query(`INSERT INTO user_rewards (chat_id, reward_id, promo_code, cost_paid, expires_at)
         VALUES ($1, $2, $3, $4, NOW() + INTERVAL '30 days')
         RETURNING expires_at`, [chatId, rewardId, promoCode, cost]);
            return { ok: true, promoCode, expiresAt: ins.rows[0].expires_at.toISOString() };
        }
        catch (e) {
            // Unique violation → retry
            if (e.code !== "23505")
                throw e;
        }
    }
    return { ok: false, reason: "code_generation_failed" };
}
async function getMyRewards(chatId) {
    const { rows } = await db_1.pool.query(`SELECT ur.id, ur.promo_code, rc.title, rc.reward_type, rc.discount_value, rc.min_order,
            ur.expires_at, ur.used_at
       FROM user_rewards ur
       JOIN rewards_catalog rc ON rc.id = ur.reward_id
       WHERE ur.chat_id = $1 AND ur.expires_at > NOW()
       ORDER BY ur.created_at DESC`, [chatId]);
    return rows;
}
// ─── History ─────────────────────────────────────────────────────────────────
async function getHistory(chatId, limit = 30) {
    const { rows } = await db_1.pool.query(`(SELECT 'point'::text AS kind, amount, source, meta, created_at FROM point_transactions WHERE chat_id = $1)
     UNION ALL
     (SELECT 'star'::text AS kind, amount, source, meta, created_at FROM star_transactions WHERE chat_id = $1)
     ORDER BY created_at DESC
     LIMIT $2`, [chatId, limit]);
    return rows;
}
// ─── Daily status (for UI) ───────────────────────────────────────────────────
async function getDailyStatus(chatId) {
    const today = new Date().toISOString().slice(0, 10);
    const dRes = await db_1.pool.query(`SELECT daily_login_claimed, stars_earned_today FROM daily_activity WHERE chat_id = $1 AND date = $2`, [chatId, today]);
    const sRes = await db_1.pool.query(`SELECT current_streak, longest_streak FROM user_streaks WHERE chat_id = $1`, [chatId]);
    return {
        loginClaimedToday: dRes.rows[0]?.daily_login_claimed ?? false,
        starsEarnedToday: dRes.rows[0]?.stars_earned_today ?? 0,
        starCap: exports.STAR_DAILY_CAP,
        currentStreak: sRes.rows[0]?.current_streak ?? 0,
        longestStreak: sRes.rows[0]?.longest_streak ?? 0,
    };
}
// ─── Referrals ───────────────────────────────────────────────────────────────
async function recordReferral(referrerId, refereeId) {
    if (referrerId === refereeId)
        return false;
    try {
        await db_1.pool.query(`INSERT INTO referrals (referrer_id, referee_id) VALUES ($1, $2)`, [referrerId, refereeId]);
        return true;
    }
    catch (e) {
        if (e.code === "23505")
            return false; // already exists
        throw e;
    }
}

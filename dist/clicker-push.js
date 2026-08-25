"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initClickerPushSchema = initClickerPushSchema;
exports.runClickerRetentionPush = runClickerRetentionPush;
/**
 * Пуши-возвраты «Котик Комбат» (#6) — крон шлёт игроку напоминание вернуться.
 *
 * Принцип: МАКСИМУМ один игровой пуш в день на игрока (kind `marketing_game`,
 * см. canSendNotification — свой opt-out, тихие часы 22–9 Иркутск, общий кап 5/сут).
 * Крон запускается раз в день вечером (17:00 Иркутск) и для каждого «уснувшего»
 * игрока выбирает ОДИН самый ценный триггер:
 *   1) streak — серия ежедневных заходов под угрозой (claimed вчера, сегодня нет) — приоритет;
 *   2) energy — энергия восстановилась (away >16ч ⇒ точно полная), зови тапать.
 *
 * Дедуп: clicker_push_log (chat_id, trigger, day) + сам факт «1 пуш/день».
 * Кандидаты: активные 16ч…4д назад (пропустили ~день, но ещё не ушли совсем).
 */
const db_1 = require("./db");
const links_1 = require("./links");
const logger_1 = require("./logger");
const clicker_1 = require("./clicker");
const irkToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const irkYesterday = () => new Date(Date.now() + 8 * 3600 * 1000 - 86400000).toISOString().slice(0, 10);
function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11)
        return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20))
        return few;
    return many;
}
async function initClickerPushSchema() {
    await db_1.pool.query(`
    CREATE TABLE IF NOT EXISTS clicker_push_log (
      chat_id BIGINT NOT NULL,
      trigger TEXT NOT NULL,
      day     TEXT NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (chat_id, trigger, day)
    );
    CREATE INDEX IF NOT EXISTS clicker_push_log_day_idx ON clicker_push_log (day);
  `);
}
/**
 * Прогон рассылки. Возвращает счётчики по триггерам.
 * Идемпотентен в пределах дня: повторный запуск не задвоит (дедуп по дню).
 */
async function runClickerRetentionPush(push) {
    const today = irkToday(), yesterday = irkYesterday();
    // Кандидаты: «уснули» 16ч…4д назад. Тянем минимум полей.
    const { rows } = await db_1.pool.query(`SELECT chat_id, daily_date, daily_streak, energy, energy_limit_level,
            energy_carry, energy_updated_at
      FROM clicker_state
      WHERE updated_at < NOW() - INTERVAL '16 hours'
        AND updated_at > NOW() - INTERVAL '4 days'
        AND admin_blocked=FALSE`);
    let streak = 0, energy = 0, skipped = 0;
    for (const r of rows) {
        const chatId = Number(r.chat_id);
        // уже был игровой пуш сегодня? (1/день на игрока)
        const dq = await db_1.pool.query(`SELECT 1 FROM clicker_push_log WHERE chat_id=$1 AND day=$2 LIMIT 1`, [chatId, today]);
        if (dq.rowCount) {
            skipped++;
            continue;
        }
        let trigger = "", text = "";
        const streakN = Number(r.daily_streak) || 0;
        if (streakN >= 2 && r.daily_date === yesterday) {
            trigger = "streak";
            text = `🔥 *Серия ${streakN} ${plural(streakN, "день", "дня", "дней")} под угрозой!*\n\n`
                + `Зайди в «Котика Комбат» за наградой дня — иначе серия сгорит в полночь.\n\n`
                + `[Забрать награду](${(0, links_1.miniAppLink)(chatId, "click")})`;
        }
        else {
            const max = (0, clicker_1.energyMaxFor)(Number(r.energy_limit_level) || 0);
            const elapsed = Math.max(0, (Date.now() - new Date(r.energy_updated_at).getTime()) / 1000);
            const regenerated = (0, clicker_1.settleEnergyRegeneration)(Number(r.energy), max, elapsed, Number(r.energy_carry || 0));
            // Большой лимит энергии может восстанавливаться дольше 16 часов. Не обещаем
            // «полную энергию», пока серверная формула действительно не дошла до max.
            if (regenerated.energy < max) {
                skipped++;
                continue;
            }
            trigger = "energy";
            text = `⚡ *Котик отдохнул!*\n\n`
                + `Энергия восстановилась — самое время тапать и копить монеты на награды «Марии».\n\n`
                + `[Залетай в игру](${(0, links_1.miniAppLink)(chatId, "click")})`;
        }
        // VK-сендер сам снимает Markdown и сохраняет URL из [текст](url) — отдельная
        // ссылка для VK не нужна. parse_mode Markdown — для TG.
        const ok = await push.sendPushSafely(chatId, "marketing_game", text, {
            dedupeKey: `clicker-retention:${today}`,
        });
        if (ok) {
            await db_1.pool.query(`INSERT INTO clicker_push_log (chat_id, trigger, day) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [chatId, trigger, today]);
            if (trigger === "streak")
                streak++;
            else
                energy++;
        }
        else {
            skipped++;
        }
    }
    if (streak || energy)
        logger_1.log.info({ streak, energy, skipped, candidates: rows.length }, "[clicker retention push]");
    return { streak, energy, skipped };
}

/**
 * Пуши-напоминания о питомце «Василий» (Дом + кликер «Котик Комбат»).
 *
 * Два независимых триггера:
 *  1) pet_hungry  — Василия не покормили сегодня, но недавно заходили в Дом
 *     (ежедневно, крон 19:00 Иркутск — см. index.ts).
 *  2) energy_full — энергия кликера полностью восстановилась после простоя
 *     (крон каждые 30 минут — см. index.ts).
 *
 * Оба ЗА env-флагом PET_REMINDERS_ENABLED (см. index.ts): по умолчанию (env не
 * задан) флаг ВЫКЛЮЧЕН — крон зарегистрирован, но выходит рано без похода в БД
 * и без лога на каждый тик (лог «disabled» пишется один раз при старте).
 * Функции этого файла флаг НЕ проверяют — их дёргает и крон (уже проверивший
 * флаг снаружи), и admin-триггеры /api/admin/pet/remind-* для ручного теста;
 * оба пути шлют пуши по-настоящему.
 *
 * Дедуп — funnel_dedup (analytics.ts): максимум одно напоминание каждого вида
 * в сутки на игрока (tag `pet_hungry` / `energy_full`, окно 1 день).
 */
import { pool } from "./db";
import type { PushService } from "./push";
import { miniAppLink } from "./links";
import { wasFunnelSent, markFunnelSent } from "./analytics";
import { log } from "./logger";

// Сутки — по Иркутску (UTC+8), как и весь остальной проект.
const irkToday = (): string => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

// SQL-формула энергии зеркалит clicker.ts. Если экономику регена меняют там,
// эту выборку нужно обновить одновременно.
const ENERGY_BASE = 1000;       // energyMaxFor(0)
const ENERGY_PER_LEVEL = 500;   // прирост лимита за уровень
const REGEN_PER_SEC = 0.25;     // clicker.ts REGEN_PER_SEC
const HUNGER_DECAY_PER_HOUR = 6; // pet.ts DECAY.hunger
const NEED_ALERT_LEVEL = 30;

const CANDIDATE_LIMIT = 200; // защита от «прогона на всю базу» за один тик крона

/**
 * «Василий проголодался» — фактическая сытость с учётом decay ниже порога.
 * Любое другое действие тоже меняет care_date, поэтому проверка «не ухаживали
 * сегодня» давала одновременно ложные пропуски и ложные напоминания.
 */
export async function runPetHungryPush(push: PushService): Promise<{ sent: number; candidates: number }> {
  const today = irkToday();
  const { rows } = await pool.query(
    `SELECT p.chat_id FROM pet_state p
       JOIN clicker_state c ON c.chat_id=p.chat_id AND c.admin_blocked=FALSE
      WHERE p.updated_at > NOW() - INTERVAL '14 days'
        AND GREATEST(0, p.hunger - FLOOR(${HUNGER_DECAY_PER_HOUR} * EXTRACT(EPOCH FROM (NOW() - p.updated_at)) / 3600)) < ${NEED_ALERT_LEVEL}
      ORDER BY p.updated_at ASC
      LIMIT $1`,
    [CANDIDATE_LIMIT]
  );
  let sent = 0;
  for (const r of rows) {
    const chatId = Number(r.chat_id);
    if (await wasFunnelSent(chatId, "pet_hungry", 1).catch(() => true)) continue;
    const text = `🐱 *Василий проголодался и ждёт тебя в Доме!*\n\n`
      + `Покорми его — забота каждый день приносит монеты.\n\n`
      + `[Покормить Василия](${miniAppLink(chatId, "game")})`;
    const ok = await push.sendPushSafely(chatId, "marketing_game", text, {
      dedupeKey: `pet-hungry:${today}`,
    });
    if (ok) { sent++; await markFunnelSent(chatId, "pet_hungry"); }
  }
  log.info({ sent, candidates: rows.length }, "[pet hungry push]");
  return { sent, candidates: rows.length };
}

/**
 * «Энергия восстановилась» — снапшот энергии на момент последнего сохранения
 * был почти нулевым (<10% лимита), и с тех пор прошло время полного реген
 * ((energyMax-energy)/REGEN_PER_SEC, посчитано в SQL по фактическому остатку и
 * energy_limit_level каждой строки — точнее, чем ждать полный лимит от нуля).
 * updated_at > 7 дней назад — фильтр «активный игрок» (не шлём тем, кто ушёл насовсем).
 */
export async function runPetEnergyPush(push: PushService): Promise<{ sent: number; candidates: number }> {
  const today = irkToday();
  const { rows } = await pool.query(
    `SELECT chat_id FROM clicker_state
      WHERE updated_at > NOW() - INTERVAL '7 days'
        AND admin_blocked=FALSE
        AND energy < (${ENERGY_BASE} + ${ENERGY_PER_LEVEL} * energy_limit_level) * 0.1
        AND energy_updated_at < NOW() - (INTERVAL '1 second'
              * CEIL(((${ENERGY_BASE} + ${ENERGY_PER_LEVEL} * energy_limit_level) - energy)::numeric / ${REGEN_PER_SEC}))
      ORDER BY updated_at ASC
      LIMIT $1`,
    [CANDIDATE_LIMIT]
  );
  let sent = 0;
  for (const r of rows) {
    const chatId = Number(r.chat_id);
    if (await wasFunnelSent(chatId, "energy_full", 1).catch(() => true)) continue;
    const text = `⚡ *Энергия восстановилась — Василий готов тапать!*\n\n`
      + `Забеги за комбо дня.\n\n`
      + `[Играть](${miniAppLink(chatId, "game")})`;
    const ok = await push.sendPushSafely(chatId, "marketing_game", text, {
      dedupeKey: `pet-energy:${today}`,
    });
    if (ok) { sent++; await markFunnelSent(chatId, "energy_full"); }
  }
  log.info({ sent, candidates: rows.length }, "[pet energy push]");
  return { sent, candidates: rows.length };
}

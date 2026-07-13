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

// Формула энергии дублирует clicker.ts (energyMaxFor/REGEN_PER_SEC там не
// экспортированы; irkToday выше по той же причине дублируется между push-файлами —
// см. clicker-push.ts). Если формулу поменяют в clicker.ts — обновить и здесь.
const ENERGY_BASE = 1000;       // energyMaxFor(0)
const ENERGY_PER_LEVEL = 500;   // прирост лимита за уровень
const REGEN_PER_SEC = 1.5;      // clicker.ts REGEN_PER_SEC

const CANDIDATE_LIMIT = 200; // защита от «прогона на всю базу» за один тик крона

/**
 * «Василий проголодался» — care_date != сегодня (не кормили сегодня) И
 * updated_at (последний decay/уход) в пределах 14 дней (недавно был в Доме).
 */
export async function runPetHungryPush(push: PushService): Promise<{ sent: number; candidates: number }> {
  const today = irkToday();
  const { rows } = await pool.query(
    `SELECT chat_id FROM pet_state
      WHERE care_date IS DISTINCT FROM $1
        AND updated_at > NOW() - INTERVAL '14 days'
      ORDER BY updated_at ASC
      LIMIT $2`,
    [today, CANDIDATE_LIMIT]
  );
  let sent = 0;
  for (const r of rows) {
    const chatId = Number(r.chat_id);
    if (await wasFunnelSent(chatId, "pet_hungry", 1).catch(() => true)) continue;
    const text = `🐱 *Василий проголодался и ждёт тебя в Доме!*\n\n`
      + `Покорми его — забота каждый день приносит монеты.\n\n`
      + `[Покормить Василия](${miniAppLink(chatId, "game")})`;
    const ok = await push.sendPushSafely(chatId, "marketing_game", text);
    if (ok) { sent++; await markFunnelSent(chatId, "pet_hungry"); }
  }
  log.info({ sent, candidates: rows.length }, "[pet hungry push]");
  return { sent, candidates: rows.length };
}

/**
 * «Энергия восстановилась» — снапшот энергии на момент последнего сохранения
 * был почти нулевым (<10% лимита), и с тех пор прошло время полного реген
 * (energyMax/REGEN_PER_SEC, посчитано в SQL по фактическому energy_limit_level
 * каждой строки — точнее, чем брать один глобальный консервативный X).
 * updated_at > 7 дней назад — фильтр «активный игрок» (не шлём тем, кто ушёл насовсем).
 */
export async function runPetEnergyPush(push: PushService): Promise<{ sent: number; candidates: number }> {
  const { rows } = await pool.query(
    `SELECT chat_id FROM clicker_state
      WHERE updated_at > NOW() - INTERVAL '7 days'
        AND energy < (${ENERGY_BASE} + ${ENERGY_PER_LEVEL} * energy_limit_level) * 0.1
        AND updated_at < NOW() - (INTERVAL '1 second'
              * CEIL((${ENERGY_BASE} + ${ENERGY_PER_LEVEL} * energy_limit_level)::numeric / ${REGEN_PER_SEC}))
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
    const ok = await push.sendPushSafely(chatId, "marketing_game", text);
    if (ok) { sent++; await markFunnelSent(chatId, "energy_full"); }
  }
  log.info({ sent, candidates: rows.length }, "[pet energy push]");
  return { sent, candidates: rows.length };
}

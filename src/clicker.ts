/**
 * Кликер «Котик Комбат» (Hamster Kombat-стиль) — экономика + усиления.
 * Тап (с комбо/турбо), энергия, апгрейды (мультитап/энергия), бизнесы (пассив,
 * капает офлайн), бусты (турбо ×5 / полная энергия, 6/день), ежедневная награда
 * (стрик), лидерборд. Антинакрутка: энергия/пассив/турбо считаются на сервере.
 */
import crypto from "crypto";
import { pool } from "./db";
import { clickerReferralLink, miniAppLink } from "./links";
import { earnPoints, isPhoneVerified, grantRewardByCode } from "./club";
import { fetchLk } from "./lk";
import * as fs from "fs";
import * as path from "path";
import { trackEvent } from "./analytics";
import type { PushService } from "./push";
import type { PoolClient } from "pg";
import { log } from "./logger";
import { canonicalChatId } from "./account-link";

type Queryable = Pick<PoolClient, "query">;

// Подарки за достижения имеют реальную стоимость, поэтому закрыты по умолчанию
// и включаются только после отдельного согласования экономики.
export const GIFTS_ENABLED = process.env.CLICKER_GIFTS_ENABLED === "1";

// Энергия должна ограничивать длинные тап-сессии: 1000 ед. = 500 тапов,
// полный базовый запас восстанавливается примерно за 67 минут.
const REGEN_PER_SEC = 0.25;
const TAP_COST = 2;
// «Сладкий тап» (вкладка Котик, 31.07): каждый N-й lifetime-тап — крит ×MULT.
// Детерминирован от счётчика taps → клиент показывает бурст ровно на том же тапе,
// на котором сервер начисляет (батчи сходятся до монеты). Средний буст тапов ≈ +17%.
// ⚠️ Зеркало в catclick.js (SWEET_TAP_*) — менять синхронно.
export const SWEET_TAP_EVERY = 40;
export const SWEET_TAP_MULT = 8;
/** Сколько «сладких» (кратных SWEET_TAP_EVERY) тапов попало в батч (oldTaps, oldTaps+can]. */
export function sweetCritsIn(oldTaps: number, can: number): number {
  return Math.floor((oldTaps + can) / SWEET_TAP_EVERY) - Math.floor(oldTaps / SWEET_TAP_EVERY);
}
/** Серверный бонус серии: каждый 10-й lifetime-тап даёт ещё один базовый тап. */
export function comboMilestonesIn(oldTaps: number, can: number): number {
  return Math.floor((oldTaps + can) / 10) - Math.floor(oldTaps / 10);
}
/** Целая цена одного обычного тапа — точное зеркало optimistic UI. */
export function tapUnitGain(perTap: number, turbo: number, globalMult: number, bankMult: number): number {
  const raw = Number(perTap) * Number(turbo) * Number(globalMult) * Number(bankMult);
  return Math.max(1, Math.floor(Number.isFinite(raw) ? raw : 0));
}
const MAX_TAPS_PER_REQ = 600;
const MAX_TAP_FINGERS = 4;
const MAX_TAPS_PER_FINGER_PER_SEC = 10;
const MAX_TAPS_PER_SEC = MAX_TAP_FINGERS * MAX_TAPS_PER_FINGER_PER_SEC;
const TAP_BUCKET_BURST_SEC = 2;
const tapBuckets = new Map<number, { tokens: number; ts: number }>();
function takeTapAllowance(chatId: number, requested: number): number {
  const want = Math.max(0, Math.min(MAX_TAPS_PER_REQ, Math.floor(requested)));
  if (want <= 0) return 0;
  const now = Date.now();
  const cap = MAX_TAPS_PER_SEC * TAP_BUCKET_BURST_SEC;
  const prev = tapBuckets.get(chatId) || { tokens: cap, ts: now };
  const elapsed = Math.max(0, (now - prev.ts) / 1000);
  const tokens = Math.min(cap, prev.tokens + elapsed * MAX_TAPS_PER_SEC);
  const take = Math.min(want, Math.floor(tokens));
  tapBuckets.set(chatId, { tokens: tokens - take, ts: now });
  if (tapBuckets.size > 10000) {
    for (const [id, b] of tapBuckets) if (now - b.ts > 10 * 60_000) tapBuckets.delete(id);
    if (tapBuckets.size > 10000) tapBuckets.delete(tapBuckets.keys().next().value!);
  }
  return take;
}
const PASSIVE_CAP_HOURS = 3;
export interface PassiveSettlement { earned: number; carry: number }

/**
 * Начисляет целые монеты, сохраняя дробную часть между частыми refresh-вызовами.
 * Без carry активный игрок терял весь пассив на низких ставках: каждые ~1.6 с
 * доход округлялся до нуля, а отсчёт начинался заново.
 */
export function settlePassiveIncome(
  hourlyRate: number,
  elapsedSeconds: number,
  previousCarry = 0,
  capHours = PASSIVE_CAP_HOURS,
): PassiveSettlement {
  const rate = Math.max(0, Number.isFinite(hourlyRate) ? hourlyRate : 0);
  const seconds = Math.max(0, Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0);
  const carry = Number.isFinite(previousCarry) && previousCarry > 0 ? previousCarry % 1 : 0;
  const hours = Math.min(seconds / 3600, Math.max(0, capHours));
  const raw = rate * hours + carry;
  // 1e-9 компенсирует накопление двоичной погрешности на тысячах коротких интервалов
  // (например, 2250 × 1.6 с при 60/ч должно дать ровно 60, а не 59.999999…).
  const earned = Math.floor(raw + 1e-9);
  const nextCarry = raw - earned;
  return { earned, carry: nextCarry < 1e-9 ? 0 : Math.min(0.999999999, nextCarry) };
}

export interface EnergySettlement { energy: number; carry: number }
/**
 * Восстанавливает энергию без округления вверх и без потери дробной части.
 * Раньше частые запросы каждые 2 секунды могли давать по целой энергии вместо 0,5,
 * а запросы чаще двух секунд, наоборот, навсегда стирали накопленный остаток.
 */
export function settleEnergyRegeneration(
  currentEnergy: number,
  energyMax: number,
  elapsedSeconds: number,
  previousCarry = 0,
): EnergySettlement {
  const max = Math.max(0, Math.floor(Number(energyMax) || 0));
  const current = Math.min(max, Math.max(0, Math.floor(Number(currentEnergy) || 0)));
  if (current >= max) return { energy: max, carry: 0 };
  const seconds = Math.max(0, Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0);
  const carry = Number.isFinite(previousCarry) && previousCarry > 0 ? previousCarry % 1 : 0;
  const raw = current + seconds * REGEN_PER_SEC + carry;
  const energy = Math.min(max, Math.floor(raw + 1e-9));
  if (energy >= max) return { energy: max, carry: 0 };
  const nextCarry = raw - energy;
  return { energy, carry: nextCarry < 1e-9 ? 0 : Math.min(0.999999999, nextCarry) };
}
/** Максимальный уровень каждой бизнес-карты в текущем сезоне. */
export const BUSINESS_MAX_LEVEL = 20;
const TURBO_MULT = 5;
const TURBO_SEC = 20;
export const BOOST_STREAK_UNLOCK = 3;
const BASE_ENERGY_BOOSTS = 1;
const STREAK_ENERGY_BOOSTS = 2;
const STREAK_TURBO_BOOSTS = 1;
const REF_INVITEE = 2500;         // бонус приглашённому
const REF_REFERRER = 30000;       // бонус пригласившему (поднято юзером 31.07 с 5000)
const irkToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
// Экспорт для голубиной почты (pigeons.ts::sendMail — лимит 1 письмо/день по Иркутску).
// Ленивый импорт на стороне pigeons.ts (await import("./clicker")) — см. комментарий там.
export const todayIrkutsk = irkToday;
// Сезон = неделя по Иркутску (сброс в понедельник 00:00). Ключ — индекс дня-понедельника.
export function weekMonday(): number { const d = Math.floor((Date.now() + 8 * 3600 * 1000) / 86400000); return d - ((d + 3) % 7); }
export const weekKey = () => String(weekMonday());
const seasonEndsTs = () => (weekMonday() + 7) * 86400000 - 8 * 3600 * 1000; // ms UTC начала след. недели

/**
 * Часть capped-офлайн дохода, относящаяся к текущей иркутской неделе.
 * Нужна при первом refresh после понедельника: week_base должен отсечь прошлую
 * неделю, но оставить в сезоне монеты, реально заработанные уже после 00:00.
 */
export function passiveEarnedInCurrentWeek(
  hourlyRate: number,
  lastUpdateMs: number,
  nowMs = Date.now(),
  previousCarry = 0,
  capHours = PASSIVE_CAP_HOURS,
): number {
  if (!Number.isFinite(lastUpdateMs) || !Number.isFinite(nowMs) || nowMs <= lastUpdateMs) return 0;
  const irkDay = Math.floor((nowMs + 8 * 3600 * 1000) / 86400000);
  const monday = irkDay - ((irkDay + 3) % 7);
  const weekStartMs = monday * 86400000 - 8 * 3600 * 1000;
  const elapsedMs = nowMs - lastUpdateMs;
  const cappedMs = Math.min(elapsedMs, Math.max(0, capHours) * 3600000);
  // Офлайн-кап трактуем как последние N часов перед возвратом игрока.
  const creditedStartMs = nowMs - cappedMs;
  const currentWeekSeconds = Math.max(0, nowMs - Math.max(creditedStartMs, weekStartMs)) / 1000;
  // Дробный carry старой недели не переносим в очки новой недели.
  const currentCarry = lastUpdateMs >= weekStartMs ? previousCarry : 0;
  return settlePassiveIncome(hourlyRate, currentWeekSeconds, currentCarry, capHours).earned;
}

/** Очки закрываемой недели без пассива, начисленного уже после её границы. */
export function closedWeekSeasonPoints(totalEarned: number, weekBase: number, currentWeekPassive: number): number {
  return Math.max(0, Math.floor(Number(totalEarned) - Number(weekBase) - Math.max(0, Number(currentWeekPassive) || 0)));
}

// ── Престиж (#9) ─────────────────────────────────────────────────────────────
// После макс. уровня (19) игрок может «уйти в престиж»: прогресс сбрасывается, но
// даётся ПОСТОЯННЫЙ множитель к заработку (+10% за престиж, стак до x2). Чисто
// игровая прогрессия (никакой реальной стоимости) — Маша не нужна.
const PRESTIGE_MIN_LEVEL = 19;
const PRESTIGE_BONUS = 0.1;   // +10% к тапу и пассиву за каждый престиж
const PRESTIGE_MAX = 10;
const prestigeMultOf = (p: number) => 1 + Math.min(Math.max(0, p || 0), PRESTIGE_MAX) * PRESTIGE_BONUS;

// ── Ивенты (#9) ──────────────────────────────────────────────────────────────
// Временные окна с множителем монет. v1 — «Выходные ×2» (сб/вс по Иркутску). Чисто
// игровые монеты, всем поровну. Флаг — на случай быстрого выключения.
export const EVENTS_ENABLED = true;
export function eventMultiplierAt(timestampMs: number): number {
  if (!EVENTS_ENABLED || !Number.isFinite(timestampMs)) return 1;
  const wd = new Date(timestampMs + 8 * 3600 * 1000).getUTCDay();
  return wd === 6 || wd === 0 ? 2 : 1;
}
function activeEvent(): { id: string; name: string; mult: number; endsTs: number } | null {
  if (!EVENTS_ENABLED) return null;
  if (eventMultiplierAt(Date.now()) > 1) return { id: "weekend", name: "Выходные ×2", mult: 2, endsTs: seasonEndsTs() };
  return null;
}
const eventMult = () => activeEvent()?.mult ?? 1;
// Общий множитель заработка (тап + пассив): престиж × ивент.
const gainMult = (prestige: number) => prestigeMultOf(prestige) * eventMult();

/** Пассив с учётом событий внутри offline-окна, а не только в момент возврата. */
export function settlePassiveIncomeAcrossEvents(
  baseHourlyRate: number,
  lastUpdateMs: number,
  nowMs = Date.now(),
  previousCarry = 0,
  capHours = PASSIVE_CAP_HOURS,
): PassiveSettlement {
  if (!Number.isFinite(lastUpdateMs) || !Number.isFinite(nowMs) || nowMs <= lastUpdateMs) {
    return settlePassiveIncome(0, 0, previousCarry, capHours);
  }
  const cappedMs = Math.min(nowMs - lastUpdateMs, Math.max(0, capHours) * 3600000);
  let cursor = nowMs - cappedMs;
  let weightedHours = 0;
  while (cursor < nowMs) {
    const irkDay = Math.floor((cursor + 8 * 3600000) / 86400000);
    const nextIrkMidnight = (irkDay + 1) * 86400000 - 8 * 3600000;
    const end = Math.min(nowMs, nextIrkMidnight);
    weightedHours += ((end - cursor) / 3600000) * eventMultiplierAt(cursor);
    cursor = end;
  }
  return settlePassiveIncome(baseHourlyRate, weightedHours * 3600, previousCarry, Number.POSITIVE_INFINITY);
}

/** Событийно-взвешенная часть capped-пассива после начала текущей недели. */
export function passiveEarnedInCurrentWeekAcrossEvents(
  baseHourlyRate: number,
  lastUpdateMs: number,
  nowMs = Date.now(),
  previousCarry = 0,
  capHours = PASSIVE_CAP_HOURS,
): number {
  if (!Number.isFinite(lastUpdateMs) || !Number.isFinite(nowMs) || nowMs <= lastUpdateMs) return 0;
  const irkDay = Math.floor((nowMs + 8 * 3600000) / 86400000);
  const monday = irkDay - ((irkDay + 3) % 7);
  const weekStartMs = monday * 86400000 - 8 * 3600000;
  const cappedStartMs = nowMs - Math.min(nowMs - lastUpdateMs, Math.max(0, capHours) * 3600000);
  const currentStartMs = Math.max(cappedStartMs, weekStartMs);
  if (currentStartMs >= nowMs) return 0;
  const currentCarry = lastUpdateMs >= weekStartMs ? previousCarry : 0;
  return settlePassiveIncomeAcrossEvents(baseHourlyRate, currentStartMs, nowMs, currentCarry, capHours).earned;
}

// Соцссылки «Марии» для заданий-маркетинга. ⚠️ Продублировано во фронте catclick.js.
// Пустая ссылка = задание скрыто (не отправляем людей в никуда). Заполнить реальными URL.
export const SOCIAL = {
  review: "https://yandex.ru/maps/?text=Мария кондитерская Иркутск",
  vk: "",   // группы ВК у «Марии» пока нет (подтверждено 14.07.2026) — заполнить при появлении
  tg: "https://t.me/mariatortik_bot",   // канала нет — задание ведёт в бота (переток VK-аудитории)
};

// Задания. type: link (открыть ссылку → забрать) | level | balance | streak | ref (по достижению цели).
// Задания-маркетинг с пустой ссылкой автоматически отфильтровываются (скрыты до заполнения SOCIAL).
export const TASKS = [
  { id: "site",     name: "Заглянуть на сайт «Мария»", icon: "🌐", reward: 1500, type: "link", link: "https://www.maria-irk.ru/" },
  { id: "review",   name: "Оставить отзыв о «Марии»",   icon: "⭐", reward: 5000, type: "link", link: SOCIAL.review },
  { id: "vk",       name: "Подписаться на ВК «Мария»",  icon: "👍", reward: 4000, type: "link", link: SOCIAL.vk },
  { id: "invite1",  name: "Пригласить друга",          icon: "👥", reward: 10000, type: "ref",   target: 1 },
  { id: "level3",   name: "Дойти до 3 уровня", icon: "⭐", reward: 3000, type: "level",  target: 3 },
  { id: "balance10",name: "Накопить 10 000 монет",     icon: "💰", reward: 2500, type: "balance", target: 10000 },
  { id: "streak3",  name: "Заходить 3 дня подряд",      icon: "🔥", reward: 4000, type: "streak",  target: 3 },
].filter((t) => t.type !== "link" || (t as any).link);
// Достижения (claimable, разовые). type: taps | balance | level | cards | streak | ref.
// ⚠️ Продублировано во фронте catclick.js (список + иконки) — менять синхронно.
export const ACHIEVEMENTS = [
  { id: "ach_taps1k",  name: "Разминка лап",      icon: "tap",    reward: 2000,   type: "taps",    target: 1000 },
  { id: "ach_taps10k", name: "Мастер тапа",       icon: "tap",    reward: 10000,  type: "taps",    target: 10000 },
  { id: "ach_earn50k", name: "Первые полста",     icon: "wallet", reward: 5000,   type: "balance", target: 50000 },
  { id: "ach_biz5",    name: "Бизнес-империя",    icon: "shop",   reward: 8000,   type: "cards",   target: 5 },
  { id: "ach_lvl10",   name: "Высшая лига",       icon: "trophy", reward: 25000,  type: "level",   target: 10 },
  { id: "ach_lvl19",   name: "Император выпечки", icon: "star",   reward: 100000, type: "level",   target: 19 },
  { id: "ach_streak7", name: "Неделя верности",   icon: "fire",   reward: 7000,   type: "streak",  target: 7 },
  { id: "ach_ref3",    name: "Душа компании",     icon: "users",  reward: 15000,  type: "ref",     target: 3 },
  // Коллекция бизнесов: купить хотя бы один уровень каждого бизнеса категории / всех.
  { id: "col_prod",  name: "Цех в сборе",        icon: "shop",   reward: 10000,  type: "collect", target: "prod" },
  { id: "col_mkt",   name: "Маркетинг в сборе",  icon: "shop",   reward: 10000,  type: "collect", target: "mkt" },
  { id: "col_staff", name: "Команда в сборе",    icon: "shop",   reward: 10000,  type: "collect", target: "staff" },
  { id: "col_net",   name: "Сеть в сборе",       icon: "shop",   reward: 10000,  type: "collect", target: "net" },
  { id: "col_all",   name: "Бизнес-империя",     icon: "trophy", reward: 60000,  type: "collect", target: "all" },
];
const ALL_BY_ID: Record<string, any> = Object.fromEntries([...TASKS, ...ACHIEVEMENTS].map((t) => [t.id, t]));
const dailyReward = (streak: number) => 250 * Math.min(Math.max(1, streak), 10); // день1=250 … день10+=2500

/** Текущий непрерывный стрик; после пропущенных суток старое значение не показываем. */
export function effectiveDailyStreak(lastClaimDate: unknown, storedStreak: unknown, today = irkToday()): number {
  const n = Math.max(0, Math.floor(Number(storedStreak) || 0));
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(todayMs)) return 0;
  const yesterday = new Date(todayMs - 86400000).toISOString().slice(0, 10);
  return lastClaimDate === today || lastClaimDate === yesterday ? n : 0;
}

/**
 * Бесплатные бусты теперь являются наградой за возвращение в игру, а не
 * безусловным пакетом из шести зарядов. Один refill энергии остаётся страховкой
 * новичку; второй refill и единственный Turbo открываются со стрика 3 дня.
 */
export function dailyBoostLimits(
  lastClaimDate: unknown,
  storedStreak: unknown,
  today = irkToday(),
): { energy: number; turbo: number } {
  const streak = effectiveDailyStreak(lastClaimDate, storedStreak, today);
  return streak >= BOOST_STREAK_UNLOCK
    ? { energy: STREAK_ENERGY_BOOSTS, turbo: STREAK_TURBO_BOOSTS }
    : { energy: BASE_ENERGY_BOOSTS, turbo: 0 };
}

/** Остаток не бывает отрицательным после уменьшения старого дневного лимита. */
export function boostRemaining(limit: number, used: unknown, boostDate: unknown, today = irkToday()): number {
  const usedToday = boostDate === today ? Math.max(0, Math.floor(Number(used) || 0)) : 0;
  return Math.max(0, Math.floor(Number(limit) || 0) - usedToday);
}

// «Кондитерская карьера Василия» (арт-комплект 08.07.2026) — имена синхронно с
// public/js/catclick.js LEAGUES (там же поле cat); пороги need НЕ менялись.
// Пороги растянуты 15.07 (ранние уровни пролетали за минуты), а 25.08 финальная
// дуга дополнительно растянута под цель 6–8 недель для обычного игрока:
// ранний прогресс остаётся быстрым, уровни 11–19 требуют долгого реинвестирования.
// Существующие игроки защищены храповиком max_level (см. refresh) —
// уровень не откатывается. ⚠️ Продублировано в public/js/catclick.js — менять синхронно.
export const LEAGUES = [
  { level: 1,  name: "Котёнок-стажёр",     need: 0 },
  { level: 2,  name: "Помощник пекаря",    need: 2000 },
  { level: 3,  name: "Ученик",             need: 6000 },
  { level: 4,  name: "Тестомес",           need: 15000 },
  { level: 5,  name: "Пекарь",             need: 35000 },
  { level: 6,  name: "Мастер круассанов",  need: 75000 },
  { level: 7,  name: "Юный кондитер",      need: 150000 },
  { level: 8,  name: "Тортодел",           need: 320000 },
  { level: 9,  name: "Шоколатье",          need: 650000 },
  { level: 10, name: "Су-шеф",             need: 1300000 },
  { level: 11, name: "Шеф-кондитер",       need: 3000000 },
  { level: 12, name: "Художник десертов",  need: 7000000 },
  { level: 13, name: "Управляющий",        need: 15000000 },
  { level: 14, name: "Владелец кафе",      need: 30000000 },
  { level: 15, name: "Ресторатор",         need: 55000000 },
  { level: 16, name: "Магнат выпечки",     need: 100000000 },
  { level: 17, name: "Легенда",            need: 180000000 },
  { level: 18, name: "Король тортов",      need: 300000000 },
  { level: 19, name: "Император выпечки",  need: 500000000 },
];
function leagueFor(total: number) { let l = LEAGUES[0]; for (const x of LEAGUES) if (total >= x.need) l = x; return l; }
/** Уровень с учётом серверного храповика, ограниченный реальной лестницей. */
export function effectiveCareerLevel(total: number, maxLevel: number): number {
  const earnedLevel = leagueFor(Math.max(0, Number(total) || 0)).level;
  const savedLevel = Math.floor(Number(maxLevel) || 1);
  return Math.min(LEAGUES.length, Math.max(earnedLevel, savedLevel, 1));
}
/** Порог именно следующего уровня, а не первый порог выше текущей суммы. */
export function nextNeedForLevel(level: number): number | null {
  const next = LEAGUES.find((x) => x.level > Math.floor(Number(level) || 1));
  return next ? next.need : null;
}

/** MAX-бизнес уже нельзя прокачать, поэтому он автоматически закрывает слот комбо дня. */
export function comboHitsIncludingMaxed(combo: string[], recordedHits: string[], levels: Record<string, number>): string[] {
  const recorded = new Set(recordedHits);
  return combo.filter((id) => recorded.has(id) || Number(levels[id] || 0) >= BUSINESS_MAX_LEVEL);
}

// ── Реальные награды (обмен монет → скидка/бонусы). ⚠️ ВЫКЛ до согласования Маши ──
// Включение — env CLICKER_REWARDS_ENABLED=1 в bot.env + пересоздание контейнера
// (docker compose up -d --force-recreate). Числа (cost/points) — константы ниже:
// при решениях Маши правим числа и включаем env, нового кода не нужно.
export const REWARDS_ENABLED = process.env.CLICKER_REWARDS_ENABLED === "1";
export const REWARDS: { id: string; name: string; cost: number; kind: "promo" | "loyalty"; catalog?: string; points?: number; note: string }[] = [
  { id: "promo5",   name: "Промокод −5%",         cost: 100000, kind: "promo",   catalog: "discount_5",   note: "скидка на заказ" },
  { id: "promo10",  name: "Промокод −10%",        cost: 250000, kind: "promo",   catalog: "discount_10",  note: "скидка на заказ" },
  { id: "bonus300", name: "300 баллов на карту",  cost: 200000, kind: "loyalty", points: 300,             note: "клуб «Мария»" },
  { id: "dessert",  name: "Десерт в подарок",     cost: 500000, kind: "promo",   catalog: "free_dessert", note: "при заказе" },
];
const REWARD_BY_ID = Object.fromEntries(REWARDS.map((r) => [r.id, r]));
const REDEEM_PER_DAY = 1; // анти-абуз: не больше N обменов в день

// Приз топ-3 недельного сезона (#7). Награда = баллы на карту клуба «Мария»
// (earnPoints, только подтверждённый телефон). ⚠️ Суммы/факт раздачи — согласовать
// с Машей: пока WEEKLY_PRIZES_ENABLED=false → топ фиксируется и показывается в
// лидерборде, но баллы НЕ начисляются и победителям не пишем (как REWARDS).
export const WEEKLY_PRIZES_ENABLED = false;
export const WEEKLY_PRIZES = [
  { rank: 1, points: 1000, label: "1000 баллов на карту" },
  { rank: 2, points: 500,  label: "500 баллов на карту" },
  { rank: 3, points: 300,  label: "300 баллов на карту" },
];
const WEEKLY_PRIZE_BY_RANK = Object.fromEntries(WEEKLY_PRIZES.map((p) => [p.rank, p]));

// Категории Mine. ⚠️ CARDS продублированы во фронте catclick.js (+ cardIcon по id) — синхронно.
export const CARD_CATS = [
  { id: "prod", name: "Производство" }, { id: "mkt", name: "Маркетинг" }, { id: "staff", name: "Персонал" }, { id: "net", name: "Сеть" },
];
// req = требуемый уровень лиги (карта заблокирована, пока level==0 и лига < req). Старые id сохранены.
export const CARDS: { id: string; name: string; cat: string; basePrice: number; baseProfit: number; req?: number }[] = [
  // Производство
  { id: "bakery",      name: "Пекарня",            cat: "prod", basePrice: 300,   baseProfit: 30 },
  { id: "coffee",      name: "Кофемашина",         cat: "prod", basePrice: 900,   baseProfit: 85 },
  { id: "oven",        name: "Конвекционная печь", cat: "prod", basePrice: 2600,  baseProfit: 210, req: 3 },
  { id: "cakefactory", name: "Цех тортов",         cat: "prod", basePrice: 7000,  baseProfit: 520, req: 4 },
  // Маркетинг
  { id: "ads",         name: "Наружная реклама",   cat: "mkt",  basePrice: 1500,  baseProfit: 120 },
  { id: "smm",         name: "SMM-специалист",     cat: "mkt",  basePrice: 4200,  baseProfit: 320, req: 3 },
  { id: "tasting",     name: "Дегустации",         cat: "mkt",  basePrice: 12000, baseProfit: 780, req: 5 },
  { id: "loyalty",     name: "Карта лояльности",   cat: "mkt",  basePrice: 30000, baseProfit: 1900, req: 7 },
  // Персонал
  { id: "barista",     name: "Бариста",            cat: "staff", basePrice: 1100, baseProfit: 95 },
  { id: "baker",       name: "Пекарь",             cat: "staff", basePrice: 3400, baseProfit: 270, req: 3 },
  { id: "confectioner",name: "Кондитер",           cat: "staff", basePrice: 9000, baseProfit: 640, req: 5 },
  { id: "manager",     name: "Управляющий",        cat: "staff", basePrice: 24000, baseProfit: 1550, req: 6 },
  // Сеть
  { id: "delivery",    name: "Доставка",           cat: "net",  basePrice: 2500,  baseProfit: 200 },
  { id: "newshop",     name: "Новая точка",        cat: "net",  basePrice: 8000,  baseProfit: 560, req: 4 },
  { id: "franchise",   name: "Франшиза «Мария»",   cat: "net",  basePrice: 20000, baseProfit: 1500, req: 6 },
  { id: "region",      name: "Выход в регион",     cat: "net",  basePrice: 38000, baseProfit: 2300, req: 8 },
];
const CARD_BY_ID = Object.fromEntries(CARDS.map((c) => [c.id, c]));

// Команды (кланы). ⚠️ Продублировано во фронте catclick.js.
export const SQUADS = [
  { id: "choco", name: "Шоколадные" }, { id: "vanilla", name: "Ванильные" }, { id: "caramel", name: "Карамельные" }, { id: "berry", name: "Ягодные" },
];
const SQUAD_IDS = new Set(SQUADS.map((s) => s.id));

const priceMultitap = (lvl: number) => Math.round(200 * Math.pow(2, lvl));
const priceEnergy = (lvl: number) => Math.round(300 * Math.pow(2, lvl));
export const energyMaxFor = (lvl: number) => 1000 + 500 * lvl;
const perTapFor = (lvl: number) => 1 + lvl;
// Цена и доход растут вместе: раньше цена росла ×1.7 за уровень, а прибавка
// оставалась постоянной — дорогие уровни окупались сотни часов.
export const CARD_PRICE_GROWTH = 1.45;
export const CARD_PROFIT_GROWTH = 1.25;
export const cardPrice = (c: { basePrice: number }, lvl: number) => Math.round(c.basePrice * Math.pow(CARD_PRICE_GROWTH, lvl));
export const cardProfit = (c: { baseProfit: number }, lvl: number) => lvl <= 0 ? 0 : Math.round(c.baseProfit * (Math.pow(CARD_PROFIT_GROWTH, lvl) - 1) / (CARD_PROFIT_GROWTH - 1));

// ── Бонусы дня: Комбо (3 карты) + Шифр (морзе) — детерминированы от даты ─────────
// ⚠️ Алгоритм/слова/морзе продублированы во фронте public/js/catclick.js — менять синхронно.
const COMBO_REWARD = 12000;
const CIPHER_REWARD = 3000;
const CIPHER_WORDS = ["МАРИЯ", "ТОРТ", "КОТИК", "КРЕМ", "ЭКЛЕР", "МУСС", "БИСКВИТ", "ВАНИЛЬ", "ШОКОЛАД", "КАРАМЕЛЬ", "ДЕСЕРТ", "ПЕКАРНЯ"];
const MORSE: Record<string, string> = {
  А: ".-", Б: "-...", В: ".--", Г: "--.", Д: "-..", Е: ".", Ж: "...-", З: "--..", И: "..", Й: ".---",
  К: "-.-", Л: ".-..", М: "--", Н: "-.", О: "---", П: ".--.", Р: ".-.", С: "...", Т: "-", У: "..-",
  Ф: "..-.", Х: "....", Ц: "-.-.", Ч: "---.", Ш: "----", Щ: "--.-", Ь: "-..-", Ы: "-.--", Э: "..-..", Ю: "..--", Я: ".-.-",
};
function dateSeed(day: string, salt: string): number { let h = 2166136261 >>> 0; const s = day + salt; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
function todaysCombo(day: string): string[] { let h = dateSeed(day, "combo"); const pool2 = CARDS.map((c) => c.id); const pick: string[] = []; for (let i = 0; i < 3; i++) { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; pick.push(pool2.splice(h % pool2.length, 1)[0]); } return pick; }
function todaysCipher(day: string): string { return CIPHER_WORDS[dateSeed(day, "cipher") % CIPHER_WORDS.length]; }
// Анаграмма вместо морзе (аудит 30.07: азбука Морзе — барьер для аудитории кондитерской;
// слово и проверка те же, меняется только подача). Детерминированный шафл от даты —
// у всех игроков одинаковая перемешка. ⚠️ Зеркало в catclick.js — менять синхронно.
function scrambleWord(word: string, day: string): string {
  const letters = word.split("");
  let s = (dateSeed(day, "scramble") || 1) & 0x7fffffff;
  for (let i = letters.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }
  const out = letters.join("");
  return out === word ? letters.reverse().join("") : out;
}
function toMorse(w: string): string { return w.split("").map((c) => MORSE[c] || "").join(" "); }
function parseHits(s: string | null): string[] { return s ? s.split(",").filter(Boolean) : []; }

export interface ClickerState {
  /** Монотонная серверная ревизия: клиент не применяет запоздавшие ответы. */
  revision: number;
  balance: number; totalEarned: number; energy: number; energyMax: number;
  perTap: number; profitPerHour: number; passiveEarned: number; albumMult: number;
  level: number; levelName: string; nextNeed: number | null;
  multitapLevel: number; multitapPrice: number;
  energyLevel: number; energyPrice: number;
  cards: { id: string; name: string; cat: string; level: number; profit: number; currentProfit: number; profitGain: number; price: number; req: number; locked: boolean; maxed: boolean }[];
  // усиления
  dailyAvailable: boolean; dailyStreak: number; dailyNext: number;
  chestAvailable: boolean; rainAvailable: boolean; squad: string | null;
  /** ×1.25 при закрытой копилке стаи, иначе 1 (индикатор на главной). */
  bankMult: number;
  boostEnergyLeft: number; boostTurboLeft: number; turboMsLeft: number;
  boostEnergyLimit: number; boostTurboLimit: number; boostUnlockStreak: number;
  referrals: number; refCode: string; refLink: string;
  combo: { cards: string[]; hits: string[]; complete: boolean; claimed: boolean; reward: number };
  cipher: { morse: string; anagram: string; len: number; claimed: boolean; reward: number };
  taps: number; cardsOwned: number; onboarded: boolean;
  season: { points: number; endsTs: number };
  prestige: number; prestigeMult: number; prestigeReady: boolean;
  event: { active: boolean; name: string; mult: number; endsTs: number } | null;
  gamesDone?: string[];
  /** Служебные поля ответа tap: повтор не начислен, acceptedTaps — фактически принятые тапы. */
  duplicate?: boolean;
  acceptedTaps?: number;
}

export async function initClickerSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clicker_state (
      chat_id            BIGINT PRIMARY KEY,
      balance            BIGINT NOT NULL DEFAULT 0,
      total_earned       BIGINT NOT NULL DEFAULT 0,
      taps               BIGINT NOT NULL DEFAULT 0,
      energy             INT NOT NULL DEFAULT 1000,
      multitap_level     INT NOT NULL DEFAULT 0,
      energy_limit_level INT NOT NULL DEFAULT 0,
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS multitap_level INT NOT NULL DEFAULT 0;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS onboarded BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS energy_limit_level INT NOT NULL DEFAULT 0;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS daily_streak INT NOT NULL DEFAULT 0;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS daily_date TEXT;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS boost_energy_used INT NOT NULL DEFAULT 0;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS boost_turbo_used INT NOT NULL DEFAULT 0;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS boost_date TEXT;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS turbo_until TIMESTAMPTZ;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS referred_by BIGINT;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS referrals INT NOT NULL DEFAULT 0;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS combo_date TEXT;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS combo_hits TEXT;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS combo_claimed TEXT;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS cipher_date TEXT;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS week_key TEXT;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS week_base BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS bonus_at TIMESTAMPTZ;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS chest_date TEXT;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS rain_date TEXT;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS squad TEXT;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS prestige INT NOT NULL DEFAULT 0;
    -- max_level действует только внутри текущего цикла престижа. Иначе после сброса
    -- сервер помнит 19-й уровень, а сумма уже снова соответствует первому.
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS max_level SMALLINT NOT NULL DEFAULT 1;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS max_level_prestige INT NOT NULL DEFAULT 0;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS ftue_claimed INT NOT NULL DEFAULT 0;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS admin_blocked BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS admin_block_reason TEXT;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS admin_blocked_at TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS clicker_squad_idx ON clicker_state (squad);
    -- Платный кейс: суммарно потрачено/выиграно игроком (казино-баланс дом/игрок, пити).
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS case_spent BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS case_won BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS case_dry INT NOT NULL DEFAULT 0;
    -- Персональная административная прибавка к пассиву (не влияет на уровни/гонки).
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS bonus_profit_per_hour BIGINT NOT NULL DEFAULT 0;
    -- Дробная часть пассивного дохода сохраняется между частыми игровыми запросами.
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS passive_carry DOUBLE PRECISION NOT NULL DEFAULT 0;
    -- То же для регенерации энергии: без carry частые запросы округляли 0,25 энергии
    -- то вверх, то вниз и фактическая скорость зависела от частоты обновления клиента.
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS energy_carry DOUBLE PRECISION NOT NULL DEFAULT 0;
    -- Монотонный порядок снимков состояния для защиты клиента от response races.
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS state_revision BIGINT NOT NULL DEFAULT 0;
    -- Раздельные часы: игровые операции больше не сбрасывают накопленный пассив,
    -- когда им нужно лишь зафиксировать реген энергии или изменение профиля.
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS passive_updated_at TIMESTAMPTZ;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS energy_updated_at TIMESTAMPTZ;
    UPDATE clicker_state SET passive_updated_at=COALESCE(passive_updated_at, updated_at), energy_updated_at=COALESCE(energy_updated_at, updated_at)
      WHERE passive_updated_at IS NULL OR energy_updated_at IS NULL;
    ALTER TABLE clicker_state ALTER COLUMN passive_updated_at SET DEFAULT NOW();
    ALTER TABLE clicker_state ALTER COLUMN passive_updated_at SET NOT NULL;
    ALTER TABLE clicker_state ALTER COLUMN energy_updated_at SET DEFAULT NOW();
    ALTER TABLE clicker_state ALTER COLUMN energy_updated_at SET NOT NULL;
    CREATE TABLE IF NOT EXISTS clicker_case_history (
      id BIGSERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL,
      request_id TEXT NOT NULL,
      cost BIGINT NOT NULL,
      prize JSONB NOT NULL,
      balance_before BIGINT NOT NULL,
      balance_after BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (chat_id, request_id)
    );
    CREATE INDEX IF NOT EXISTS clicker_case_history_idx ON clicker_case_history (chat_id, created_at DESC);
    -- Идемпотентность пачек тапов: потерянный HTTP-ответ не должен начислять ту же
    -- пачку второй раз. Ключ создаёт клиент один раз и повторяет до получения ответа.
    CREATE TABLE IF NOT EXISTS clicker_tap_runs (
      chat_id BIGINT NOT NULL,
      request_id TEXT NOT NULL,
      accepted_taps INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (chat_id, request_id)
    );
    CREATE INDEX IF NOT EXISTS clicker_tap_runs_created_idx ON clicker_tap_runs (created_at);
    DELETE FROM clicker_tap_runs WHERE created_at < NOW() - INTERVAL '2 days';
    -- Глобальные значения игры (key→ts): гейт чемпиона «1 раз в год на всех».
    CREATE TABLE IF NOT EXISTS game_globals (key TEXT PRIMARY KEY, ts TIMESTAMPTZ, val TEXT);
    CREATE TABLE IF NOT EXISTS clicker_cards (
      chat_id BIGINT NOT NULL, card TEXT NOT NULL, level INT NOT NULL DEFAULT 0,
      PRIMARY KEY (chat_id, card)
    );
    CREATE TABLE IF NOT EXISTS clicker_tasks (
      chat_id BIGINT NOT NULL, task TEXT NOT NULL, done_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (chat_id, task)
    );
    CREATE TABLE IF NOT EXISTS clicker_redemptions (
      id BIGSERIAL PRIMARY KEY, chat_id BIGINT NOT NULL, reward_id TEXT NOT NULL,
      cost BIGINT NOT NULL, code TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE clicker_redemptions ADD COLUMN IF NOT EXISTS request_id TEXT;
    CREATE INDEX IF NOT EXISTS clicker_redeem_idx ON clicker_redemptions (chat_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS clicker_redeem_request_idx
      ON clicker_redemptions (chat_id, request_id) WHERE request_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS clicker_codes_used (
      chat_id BIGINT NOT NULL, code TEXT NOT NULL, used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (chat_id, code)
    );
    CREATE TABLE IF NOT EXISTS clicker_daily (
      chat_id BIGINT NOT NULL, game TEXT NOT NULL, day TEXT NOT NULL,
      PRIMARY KEY (chat_id, game)
    );
    CREATE TABLE IF NOT EXISTS clicker_gifts (
      chat_id BIGINT NOT NULL, achievement TEXT NOT NULL, points INT NOT NULL,
      granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (chat_id, achievement)
    );
    -- Для уже выданных наград новые флаги сначала TRUE; после миграции новые строки
    -- стартуют с FALSE и могут безопасно продолжить частично завершённую выдачу.
    ALTER TABLE clicker_gifts ADD COLUMN IF NOT EXISTS points_granted BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE clicker_gifts ADD COLUMN IF NOT EXISTS perk_granted BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE clicker_gifts ALTER COLUMN points_granted SET DEFAULT FALSE;
    ALTER TABLE clicker_gifts ALTER COLUMN perk_granted SET DEFAULT FALSE;
    ALTER TABLE clicker_gifts ADD COLUMN IF NOT EXISTS promo_code TEXT;
    ALTER TABLE clicker_gifts ADD COLUMN IF NOT EXISTS perk_title TEXT;
    ALTER TABLE clicker_gifts ADD COLUMN IF NOT EXISTS min_order INT;
    CREATE TABLE IF NOT EXISTS clicker_purchase_sync (
      chat_id BIGINT PRIMARY KEY, spent_synced BIGINT NOT NULL DEFAULT 0, last_check TIMESTAMPTZ
    );
    -- Атрибуция переходов из игры на сайт/в торговую точку. Токен не содержит
    -- Telegram ID и живёт ограниченное время; сайт может передать его обратно
    -- при оформлении заказа, чтобы связать оплату с игроком без утечки данных.
    CREATE TABLE IF NOT EXISTS clicker_commerce_clicks (
      token TEXT PRIMARY KEY,
      chat_id BIGINT NOT NULL,
      kind TEXT NOT NULL,
      task_id TEXT,
      campaign_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ,
      order_id TEXT,
      order_amount NUMERIC,
      paid_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS clicker_commerce_clicks_chat_idx ON clicker_commerce_clicks (chat_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS clicker_commerce_clicks_order_idx ON clicker_commerce_clicks (order_id) WHERE order_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS clicker_week_winners (
      week_key     TEXT NOT NULL,
      rank         INT NOT NULL,
      chat_id      BIGINT NOT NULL,
      points       BIGINT NOT NULL,
      prize_points INT NOT NULL DEFAULT 0,
      awarded      BOOLEAN NOT NULL DEFAULT FALSE,
      pushed       BOOLEAN NOT NULL DEFAULT FALSE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (week_key, rank)
    );
    -- Игрок мог открыть игру в понедельник до крона закрытия сезона. До смены
    -- week_key сохраняем его завершённые очки сюда, чтобы он не исчез из итогов.
    CREATE TABLE IF NOT EXISTS clicker_week_player_stats (
      week_key TEXT NOT NULL,
      chat_id BIGINT NOT NULL,
      squad TEXT,
      points BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (week_key, chat_id)
    );
    CREATE INDEX IF NOT EXISTS clicker_week_player_stats_week_idx ON clicker_week_player_stats (week_key, points DESC);
    CREATE INDEX IF NOT EXISTS clicker_top_idx ON clicker_state (total_earned DESC);
  `);
}

/** Полностью удаляет игровой профиль «Котик Комбат» и связанную аналитику.
 * Аккаунт Telegram/клуба «Мария» не затрагивается: это отдельные сервисы. */
export async function deleteClickerProfile(chatId: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Тот же lock, что у create/accept/cancel/decline в drag.ts: новый вызов не
    // вклинится между выборкой дуэлей и удалением игрового профиля.
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, ["pigeon-duels-mutation-v1"]);
    // При удалении адресата незавершённой дуэли чужая ставка не должна исчезнуть
    // вместе с записью. Ставки самого удаляемого игрока входят в удаляемый прогресс.
    const incomingDuels = await client.query(
      `SELECT id, from_chat, stake FROM pigeon_duels WHERE to_chat=$1 AND status='open' FOR UPDATE`,
      [chatId]);
    for (const duel of incomingDuels.rows) {
      const stake = Math.max(0, Number(duel.stake) || 0);
      if (stake > 0) {
        await client.query(
          `UPDATE clicker_state SET balance=balance+$2, state_revision=state_revision+1, updated_at=NOW() WHERE chat_id=$1`,
          [Number(duel.from_chat), stake]);
      }
    }
    await client.query(`DELETE FROM pigeon_duels WHERE from_chat=$1 OR to_chat=$1`, [chatId]);
    await client.query(`DELETE FROM pigeon_trades WHERE from_chat=$1 OR to_chat=$1`, [chatId]);
    await client.query(`DELETE FROM pigeon_mail WHERE from_chat=$1 OR to_chat=$1`, [chatId]);
    await client.query(`DELETE FROM pigeon_friends WHERE chat_a=$1 OR chat_b=$1`, [chatId]);
    // Все активные игровые мутации берут clicker_state первой (дуэли — после
    // собственной строки). Без этого удаление могло уже пройти таблицу A,
    // подождать лок в таблице B и оставить новую «призрачную» строку в A.
    await client.query(`SELECT 1 FROM clicker_state WHERE chat_id=$1 FOR UPDATE`, [chatId]);
    for (const table of [
      "pigeon_missions", "pigeon_race_entries", "pigeon_sets_claimed", "pigeon_inventory",
      "pigeon_drag_runs", "pet_items", "pet_state", "clicker_case_history", "clicker_tap_runs", "clicker_cards", "clicker_tasks",
      "clicker_redemptions", "clicker_codes_used", "clicker_daily", "clicker_gifts",
      "clicker_purchase_sync", "clicker_week_player_stats", "clicker_activity", "clicker_events", "funnel_dedup",
      "squad_requests", "clicker_push_log", "clicker_squad_bank_runs", "clicker_squad_bank"
    ]) {
      await client.query(`DELETE FROM ${table} WHERE chat_id=$1`, [chatId]);
    }
    await client.query(`UPDATE clicker_week_winners SET chat_id=0 WHERE chat_id=$1`, [chatId]);
    await client.query(`UPDATE clicker_state SET referred_by=NULL WHERE referred_by=$1`, [chatId]);
    const owned = await client.query<{ id: string }>(`SELECT id FROM squads WHERE owner_chat_id=$1`, [chatId]);
    for (const row of owned.rows) {
      await client.query(`UPDATE clicker_state SET squad=NULL WHERE squad=$1`, [row.id]);
      await client.query(`DELETE FROM squad_requests WHERE squad_id=$1`, [row.id]);
      await client.query(`DELETE FROM squad_week_stats WHERE squad=$1`, [row.id]);
      await client.query(`DELETE FROM clicker_squad_bank WHERE squad=$1`, [row.id]);
      await client.query(`DELETE FROM squads WHERE id=$1`, [row.id]);
    }
    await client.query(`DELETE FROM clicker_state WHERE chat_id=$1`, [chatId]);
    await client.query("COMMIT");
    _clearSquadBankCache();
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Сбрасывает игровой прогресс, сохраняя внешний аккаунт и историю аудита. */
export async function resetClickerProgress(chatId: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, ["pigeon-duels-mutation-v1"]);
    const state = await client.query(`SELECT 1 FROM clicker_state WHERE chat_id=$1`, [chatId]);
    if (!state.rowCount) throw new Error("not_found");
    // Закрываем незавершённые дуэли до обнуления. Свою ставку сбрасываем вместе
    // с прогрессом; ставки отправителей входящих вызовов обязаны вернуться им.
    const openDuels = await client.query(
      `SELECT id, from_chat, to_chat, stake FROM pigeon_duels
        WHERE (from_chat=$1 OR to_chat=$1) AND status='open' FOR UPDATE`, [chatId]);
    for (const duel of openDuels.rows) {
      const fromChat = Number(duel.from_chat), stake = Math.max(0, Number(duel.stake) || 0);
      if (Number(duel.to_chat) === chatId && fromChat !== chatId && stake > 0) {
        await client.query(
          `UPDATE clicker_state SET balance=balance+$2, state_revision=state_revision+1, updated_at=NOW() WHERE chat_id=$1`,
          [fromChat, stake]);
      }
      await client.query(
        `UPDATE pigeon_duels SET status=$2, closed_at=NOW() WHERE id=$1`,
        [duel.id, fromChat === chatId ? "cancelled" : "declined"]);
    }
    // Порядок локов совпадает с accept/cancel duel: сначала строка дуэли, затем
    // clicker_state. Это не даёт сбросу и принятию одной дуэли взаимно ждать друг друга.
    await client.query(`SELECT 1 FROM clicker_state WHERE chat_id=$1 FOR UPDATE`, [chatId]);
    for (const table of [
      "clicker_cards", "clicker_tasks", "clicker_daily", "clicker_gifts",
      "clicker_codes_used", "clicker_purchase_sync", "clicker_redemptions", "clicker_week_player_stats",
      "clicker_case_history", "pigeon_drag_runs", "pigeon_missions", "pigeon_race_entries",
      "pigeon_sets_claimed", "pigeon_inventory", "pet_items", "pet_state", "squad_requests",
      "clicker_squad_bank_runs", "clicker_squad_bank", "clicker_tap_runs"
    ]) {
      await client.query(`DELETE FROM ${table} WHERE chat_id=$1`, [chatId]);
    }
    await client.query(`UPDATE clicker_state SET
      balance=0, total_earned=0, taps=0, energy=1000, multitap_level=0,
      energy_limit_level=0, daily_streak=0, daily_date=NULL,
      boost_energy_used=0, boost_turbo_used=0, boost_date=NULL, turbo_until=NULL,
      referred_by=NULL, referrals=0, combo_date=NULL, combo_hits=NULL, combo_claimed=NULL,
      cipher_date=NULL, week_key=NULL, week_base=0, bonus_at=NULL, chest_date=NULL,
      rain_date=NULL, squad=NULL, prestige=0, ftue_claimed=0, case_spent=0,
      case_won=0, case_dry=0, bonus_profit_per_hour=0, max_level=1, max_level_prestige=0,
      starter_pigeon=FALSE, album_bonus=FALSE, updated_at=NOW(),
      passive_updated_at=NOW(), passive_carry=0, energy_updated_at=NOW(), energy_carry=0,
      state_revision=state_revision+1
      WHERE chat_id=$1`, [chatId]);
    await client.query("COMMIT");
    _clearSquadBankCache();
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function readCards(client: any, chatId: number): Promise<Record<string, number>> {
  const { rows } = await client.query(`SELECT card, level FROM clicker_cards WHERE chat_id=$1`, [chatId]);
  const m: Record<string, number> = {}; for (const r of rows) m[r.card] = r.level; return m;
}
export function normalizeAdminPassiveBonus(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function profitPerHour(cl: Record<string, number>, albumMult = 1, pigeonPassive = 0, bonusProfitPerHour = 0): number { let p = Math.max(0, Math.floor(Number(pigeonPassive) || 0)); for (const c of CARDS) p += cardProfit(c, cl[c.id] || 0); return p * albumMult + normalizeAdminPassiveBonus(bonusProfitPerHour); }

function buildState(r: any, cl: Record<string, number>, passiveEarned: number): ClickerState {
  // Эффективный уровень с учётом храповика: не ниже max_level (защита от отката при новых порогах).
  const effLevel = effectiveCareerLevel(Number(r.total_earned), Number(r.max_level));
  const lg = LEAGUES[effLevel - 1];
  const today = irkToday();
  const turboMs = r.turbo_until ? Math.max(0, new Date(r.turbo_until).getTime() - Date.now()) : 0;
  const visibleDailyStreak = effectiveDailyStreak(r.daily_date, r.daily_streak, today);
  const boostLimits = dailyBoostLimits(r.daily_date, r.daily_streak, today);
  const dailyAvailable = r.daily_date !== today;
  return {
    revision: Number(r.state_revision || 0),
    balance: Number(r.balance), totalEarned: Number(r.total_earned), energy: r.energy, energyMax: energyMaxFor(r.energy_limit_level),
    perTap: perTapFor(r.multitap_level), profitPerHour: profitPerHour(cl, r.__albumMult || 1, r.__pigeonPassive || 0, r.bonus_profit_per_hour), passiveEarned,
    albumMult: Number(r.__albumMult || 1),
    bankMult: Number(r.__bankMult || 1),
    level: lg.level, levelName: lg.name, nextNeed: nextNeedForLevel(lg.level),
    multitapLevel: r.multitap_level, multitapPrice: priceMultitap(r.multitap_level),
    energyLevel: r.energy_limit_level, energyPrice: priceEnergy(r.energy_limit_level),
    cards: CARDS.map((c) => { const lv = cl[c.id] || 0; const locked = lv === 0 && !!c.req && lg.level < c.req; const maxed = lv >= BUSINESS_MAX_LEVEL; const currentProfit = cardProfit(c, lv), profit = maxed ? currentProfit : cardProfit(c, lv + 1); return { id: c.id, name: c.name, cat: c.cat, level: lv, profit, currentProfit, profitGain: profit - currentProfit, price: maxed ? 0 : cardPrice(c, lv), req: c.req || 0, locked, maxed }; }),
    dailyAvailable, dailyStreak: visibleDailyStreak,
    dailyNext: dailyReward(dailyAvailable ? visibleDailyStreak + 1 : visibleDailyStreak),
    chestAvailable: r.chest_date !== today,
    rainAvailable: r.rain_date !== today,
    squad: r.squad || null,
    boostEnergyLeft: boostRemaining(boostLimits.energy, r.boost_energy_used, r.boost_date, today),
    boostTurboLeft: boostRemaining(boostLimits.turbo, r.boost_turbo_used, r.boost_date, today),
    boostEnergyLimit: boostLimits.energy, boostTurboLimit: boostLimits.turbo,
    boostUnlockStreak: BOOST_STREAK_UNLOCK, turboMsLeft: turboMs,
    referrals: r.referrals || 0, refCode: String(r.chat_id), refLink: clickerReferralLink(Number(r.chat_id)),
    combo: (() => { const cards = todaysCombo(today); const recorded = r.combo_date === today ? parseHits(r.combo_hits) : []; const hits = comboHitsIncludingMaxed(cards, recorded, cl); return { cards, hits, complete: cards.every((c) => hits.includes(c)), claimed: r.combo_claimed === today, reward: COMBO_REWARD }; })(),
    cipher: { morse: toMorse(todaysCipher(today)), anagram: scrambleWord(todaysCipher(today), today), len: todaysCipher(today).length, claimed: r.cipher_date === today, reward: CIPHER_REWARD },
    taps: Number(r.taps || 0), cardsOwned: CARDS.filter((c) => (cl[c.id] || 0) > 0).length,
    onboarded: !!r.onboarded,
    season: { points: r.week_key === weekKey() ? Math.max(0, Number(r.total_earned) - Number(r.week_base || 0)) : 0, endsTs: seasonEndsTs() },
    prestige: Number(r.prestige || 0), prestigeMult: prestigeMultOf(Number(r.prestige || 0)),
    prestigeReady: lg.level >= PRESTIGE_MIN_LEVEL && Number(r.prestige || 0) < PRESTIGE_MAX,
    event: (() => { const e = activeEvent(); return e ? { active: true, name: e.name, mult: e.mult, endsTs: e.endsTs } : null; })(),
  };
}

async function refresh(client: any, chatId: number): Promise<{ r: any; cl: Record<string, number>; passive: number }> {
  await client.query(`INSERT INTO clicker_state (chat_id) VALUES ($1) ON CONFLICT (chat_id) DO NOTHING`, [chatId]);
  const { rows } = await client.query(`SELECT * FROM clicker_state WHERE chat_id=$1 FOR UPDATE`, [chatId]);
  const r = rows[0];
  if (r.admin_blocked) throw new Error("account_blocked");
  // Стартовый голубь: при первом заходе выдаём Сизаря один раз (флаг starter_pigeon),
  // чтобы коллекция не была пустой и механика была сразу понятна. Дёшево: r уже загружен.
  if (!r.starter_pigeon) {
    const { grantPigeon } = await import("./pigeons");
    await grantPigeon(chatId, "sizar", client);
    await client.query(`UPDATE clicker_state SET starter_pigeon=TRUE WHERE chat_id=$1`, [chatId]);
    r.starter_pigeon = true;
  }
  // Храповик уровня растёт только внутри текущего цикла престижа. Для старых записей,
  // созданных до max_level_prestige, сначала восстанавливаем фактический уровень цикла.
  {
    const compLvl = leagueFor(Number(r.total_earned)).level;
    const prestige = Math.max(0, Math.floor(Number(r.prestige) || 0));
    if (Number(r.max_level_prestige || 0) !== prestige) {
      await client.query(`UPDATE clicker_state SET max_level=$2, max_level_prestige=$3 WHERE chat_id=$1`, [chatId, compLvl, prestige]);
      r.max_level = compLvl;
      r.max_level_prestige = prestige;
    } else if (compLvl > (Number(r.max_level) || 1)) {
      await client.query(`UPDATE clicker_state SET max_level=$2 WHERE chat_id=$1`, [chatId, compLvl]);
      r.max_level = compLvl;
    }
  }
  const cl = await readCards(client, chatId);
  const today = irkToday();
  if (r.boost_date !== today) { r.boost_energy_used = 0; r.boost_turbo_used = 0; r.boost_date = today; }
  const energySecs = Math.max(0, (Date.now() - new Date(r.energy_updated_at || r.updated_at).getTime()) / 1000);
  const passiveNow = Date.now();
  const passiveUpdatedMs = new Date(r.passive_updated_at || r.updated_at).getTime();
  const energySettlement = settleEnergyRegeneration(
    Number(r.energy),
    energyMaxFor(r.energy_limit_level),
    energySecs,
    Number(r.energy_carry || 0),
  );
  r.energy = energySettlement.energy;
  r.energy_carry = energySettlement.carry;
  // Перк полного альбома (+5% к пассиву): флаг кэширован на clicker_state.album_bonus
  // (выставляется в grantPigeon при 16/16 пород) — без похода в pigeon_inventory на каждый тап.
  const { ALBUM_PASSIVE_BONUS, pigeonPassiveBonus } = await import("./pigeons");
  const albumMult = r.album_bonus ? 1 + ALBUM_PASSIVE_BONUS : 1;
  const pigeonPassive = await pigeonPassiveBonus(chatId, client);
  r.__albumMult = albumMult;
  r.__pigeonPassive = pigeonPassive;
  // Копилка стаи: закрытая цель недели множит ВЕСЬ доход (пассив здесь, тапы в tapClicker)
  const bankMult = (await squadBankActive(r.squad || null, client)) ? SQUAD_BANK_MULT : 1;
  r.__bankMult = bankMult;
  // Ивент не входит в basePassiveRate: settlePassiveIncomeAcrossEvents разбивает
  // офлайн-окно по реальным границам выходных в Иркутске.
  const basePassiveRate = profitPerHour(cl, albumMult, pigeonPassive, r.bonus_profit_per_hour)
    * prestigeMultOf(r.prestige) * bankMult;
  const wk = weekKey();
  const currentWeekPassive = r.week_key !== wk
    ? passiveEarnedInCurrentWeekAcrossEvents(basePassiveRate, passiveUpdatedMs, passiveNow, Number(r.passive_carry || 0))
    : 0;
  const passiveSettlement = settlePassiveIncomeAcrossEvents(
    basePassiveRate,
    passiveUpdatedMs,
    passiveNow,
    Number(r.passive_carry || 0),
  );
  const passive = passiveSettlement.earned;
  if (passive > 0) { r.balance = Number(r.balance) + passive; r.total_earned = Number(r.total_earned) + passive; }
  // сезон: новая неделя → база = текущий total (очки сезона обнуляются)
  if (r.week_key !== wk) {
    if (r.week_key) {
      const closedPoints = closedWeekSeasonPoints(Number(r.total_earned), Number(r.week_base || 0), currentWeekPassive);
      await client.query(
        `INSERT INTO clicker_week_player_stats (week_key, chat_id, squad, points) VALUES ($1,$2,$3,$4)
         ON CONFLICT (week_key, chat_id) DO UPDATE SET
           squad=EXCLUDED.squad, points=GREATEST(clicker_week_player_stats.points, EXCLUDED.points)`,
        [String(r.week_key), chatId, r.squad || null, closedPoints]);
    }
    r.week_key = wk;
    r.week_base = Math.max(0, Number(r.total_earned) - Math.min(passive, currentWeekPassive));
  }
  const saved = await client.query(
    `UPDATE clicker_state SET balance=$2, total_earned=$3, energy=$4, boost_energy_used=$5, boost_turbo_used=$6, boost_date=$7, week_key=$8, week_base=$9, updated_at=NOW(), passive_updated_at=NOW(), passive_carry=$10, energy_updated_at=NOW(), energy_carry=$11, state_revision=state_revision+1 WHERE chat_id=$1 RETURNING state_revision`,
    [chatId, r.balance, r.total_earned, r.energy, r.boost_energy_used, r.boost_turbo_used, r.boost_date, r.week_key, r.week_base, passiveSettlement.carry, energySettlement.carry]
  );
  r.passive_carry = passiveSettlement.carry;
  r.state_revision = Number(saved.rows[0]?.state_revision || r.state_revision || 0);
  // аналитика: повышение уровня (одно событие на уровень, из любого источника дохода)
  const lvlNow = effectiveCareerLevel(Number(r.total_earned), Number(r.max_level));
  if (lvlNow > (r.notified_level || 0)) {
    if (lvlNow >= 2) trackEvent(chatId, "levelup", { level: lvlNow });
    await client.query(`UPDATE clicker_state SET notified_level=$2 WHERE chat_id=$1`, [chatId, lvlNow]);
    r.notified_level = lvlNow;
  }
  return { r, cl, passive };
}

/**
 * Зафиксировать пассив/энергию перед изменением источника дохода в соседнем модуле.
 * Вызывается внутри уже открытой транзакции ДО покупки/звезды/тюнинга голубя, чтобы
 * новая ставка дохода не применилась задним числом ко всему офлайн-интервалу.
 */
export async function settleClickerBeforeIncomeChange(client: PoolClient, chatId: number): Promise<{ balance: number; totalEarned: number }> {
  const { r } = await refresh(client, chatId);
  return { balance: Number(r.balance), totalEarned: Number(r.total_earned) };
}

// Снимок для драг-рейсинга. Важно применять полный refresh, а не только энергию:
// клиент уже показывает текущий пассивный баланс и ставка не должна ложно падать
// с «не хватает монет» из-за ещё не сохранённого офлайн-дохода.
export async function refreshEnergyFor(client: PoolClient, chatId: number): Promise<{ energy: number; balance: number; energyCarry: number }> {
  const { r } = await refresh(client, chatId);
  return { energy: Number(r.energy), balance: Number(r.balance), energyCarry: Number(r.energy_carry || 0) };
}

async function gamesDoneToday(client: any, chatId: number): Promise<string[]> {
  const { rows } = await client.query(`SELECT game FROM clicker_daily WHERE chat_id=$1 AND day=$2`, [chatId, irkToday()]);
  return rows.map((r: any) => r.game);
}

export async function getClicker(chatId: number): Promise<ClickerState> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cl, passive } = await refresh(client, chatId);
    const st = buildState(r, cl, passive);
    st.gamesDone = await gamesDoneToday(client, chatId);
    await client.query("COMMIT");
    return st;
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

export async function tapClicker(chatId: number, taps: number, _clientComboBonus = 0, requestId = ""): Promise<ClickerState> {
  const want = Math.max(0, Math.min(MAX_TAPS_PER_REQ, Math.floor(taps)));
  const rid = /^[a-zA-Z0-9_-]{8,80}$/.test(requestId) ? requestId : "";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cl } = await refresh(client, chatId);
    if (rid) {
      const previous = await client.query(
        `SELECT accepted_taps FROM clicker_tap_runs WHERE chat_id=$1 AND request_id=$2`,
        [chatId, rid]);
      if (previous.rowCount) {
        const state = buildState(r, cl, 0);
        state.duplicate = true;
        state.acceptedTaps = 0;
        await client.query("COMMIT");
        return state;
      }
    }
    const energyCan = Math.floor(r.energy / TAP_COST);
    const can = takeTapAllowance(chatId, Math.min(want, energyCan));
    const turbo = r.turbo_until && new Date(r.turbo_until).getTime() > Date.now() ? TURBO_MULT : 1;
    // «Сладкие тапы» в батче: сколько кратных SWEET_TAP_EVERY попало в (oldTaps, oldTaps+can]
    const previousTaps = Number(r.taps || 0);
    const crits = sweetCritsIn(previousTaps, can);
    // Копилка стаи: цель недели закрыта → ×SQUAD_BANK_MULT (bankMult посчитан в refresh)
    const bankMult = Number(r.__bankMult || 1);
    // Округляем цену ОДНОГО тапа, как клиент. Раньше сервер округлял весь батч,
    // и дробные множители престижа/стаи давали неожиданный скачок после синка.
    const baseTapGain = tapUnitGain(perTapFor(r.multitap_level), turbo, gainMult(r.prestige), bankMult);
    const earned = (can + crits * (SWEET_TAP_MULT - 1)) * baseTapGain;
    // Клиентский размер бонуса намеренно игнорируется: он полностью подделываем.
    const earnedCombo = comboMilestonesIn(previousTaps, can) * baseTapGain;
    r.energy -= can * TAP_COST; r.balance = Number(r.balance) + earned + earnedCombo; r.total_earned = Number(r.total_earned) + earned + earnedCombo;
    r.taps = previousTaps + can;
    await client.query(`UPDATE clicker_state SET balance=$2, total_earned=$3, taps=$4, energy=$5, updated_at=NOW() WHERE chat_id=$1`,
      [chatId, r.balance, r.total_earned, r.taps, r.energy]);
    if (rid) {
      await client.query(
        `INSERT INTO clicker_tap_runs (chat_id, request_id, accepted_taps) VALUES ($1,$2,$3)`,
        [chatId, rid, can]);
    }
    await client.query("COMMIT");
    const state = buildState(r, cl, 0);
    state.acceptedTaps = can;
    return state;
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

/**
 * Престиж (#9): доступен с макс. уровня. Сбрасывает прогресс (баланс/всего/бизнесы/
 * апгрейды), но +1 к престижу = постоянный множитель заработка. Сохраняет стрик,
 * рефералов, команду, lifetime-тапы и закрытые достижения (чтобы не фармить награды).
 */
export async function prestigeReset(chatId: number): Promise<{ ok: boolean; state?: ClickerState; prestige?: number; reason?: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r } = await refresh(client, chatId);
    const lvl = effectiveCareerLevel(Number(r.total_earned), Number(r.max_level));
    if (lvl < PRESTIGE_MIN_LEVEL) { await client.query("ROLLBACK"); return { ok: false, reason: "not_ready" }; }
    if (Number(r.prestige || 0) >= PRESTIGE_MAX) { await client.query("ROLLBACK"); return { ok: false, reason: "max" }; }
    const newPrestige = Number(r.prestige || 0) + 1;
    // Престиж сбрасывает карьерный цикл, но не участие в уже идущем недельном
    // сезоне. При total=0 отрицательная база сохраняет набранные season points.
    const seasonPoints = r.week_key === weekKey()
      ? Math.max(0, Number(r.total_earned) - Number(r.week_base || 0))
      : 0;
    await client.query(`DELETE FROM clicker_cards WHERE chat_id=$1`, [chatId]);
    await client.query(
      `UPDATE clicker_state SET balance=0, total_earned=0, energy=$2, multitap_level=0, energy_limit_level=0,
         week_base=$5, week_key=$3, notified_level=0, prestige=$4, max_level=1,
         max_level_prestige=$4, passive_carry=0, energy_carry=0,
         updated_at=NOW(), passive_updated_at=NOW(), energy_updated_at=NOW() WHERE chat_id=$1`,
      [chatId, energyMaxFor(0), weekKey(), newPrestige, -seasonPoints]
    );
    await client.query("COMMIT");
    trackEvent(chatId, "prestige", { prestige: newPrestige });
    // отражаем сброс в in-memory строке для ответа (без повторного запроса)
    r.balance = 0; r.total_earned = 0; r.energy = energyMaxFor(0); r.multitap_level = 0;
    r.energy_limit_level = 0; r.week_base = -seasonPoints; r.week_key = weekKey(); r.notified_level = 0;
    r.prestige = newPrestige; r.max_level = 1; r.max_level_prestige = newPrestige;
    r.passive_carry = 0; r.energy_carry = 0;
    return { ok: true, prestige: newPrestige, state: buildState(r, {}, 0) };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

export async function buyClicker(chatId: number, type: string, id?: string): Promise<{ ok: boolean; state?: ClickerState; reason?: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cl } = await refresh(client, chatId);
    let cost = 0;
    if (type === "multitap") cost = priceMultitap(r.multitap_level);
    else if (type === "energy") cost = priceEnergy(r.energy_limit_level);
    else if (type === "card") { const c = id && CARD_BY_ID[id]; if (!c) { await client.query("ROLLBACK"); return { ok: false, reason: "bad_card" }; } const lv = cl[id!] || 0; if (lv >= BUSINESS_MAX_LEVEL) { await client.query("ROLLBACK"); return { ok: false, reason: "max_level" }; } if (lv === 0 && c.req && effectiveCareerLevel(Number(r.total_earned), Number(r.max_level)) < c.req) { await client.query("ROLLBACK"); return { ok: false, reason: "locked" }; } cost = cardPrice(c, lv); }
    else { await client.query("ROLLBACK"); return { ok: false, reason: "bad_type" }; }
    if (Number(r.balance) < cost) { await client.query("ROLLBACK"); return { ok: false, reason: "not_enough" }; }
    r.balance = Number(r.balance) - cost;
    if (type === "multitap") r.multitap_level += 1;
    else if (type === "energy") r.energy_limit_level += 1;
    else {
      cl[id!] = (cl[id!] || 0) + 1;
      await client.query(`INSERT INTO clicker_cards (chat_id, card, level) VALUES ($1,$2,$3) ON CONFLICT (chat_id, card) DO UPDATE SET level=$3`, [chatId, id, cl[id!]]);
      // учёт комбо дня: если купленная карта входит в сегодняшнее комбо — отметить
      const today = irkToday();
      if (todaysCombo(today).includes(id!)) {
        const hits = r.combo_date === today ? parseHits(r.combo_hits) : [];
        if (!hits.includes(id!)) hits.push(id!);
        r.combo_date = today; r.combo_hits = hits.join(",");
      }
    }
    await client.query(`UPDATE clicker_state SET balance=$2, multitap_level=$3, energy_limit_level=$4, combo_date=$5, combo_hits=$6, updated_at=NOW() WHERE chat_id=$1`,
      [chatId, r.balance, r.multitap_level, r.energy_limit_level, r.combo_date, r.combo_hits]);
    await client.query("COMMIT");
    return { ok: true, state: buildState(r, cl, 0) };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

/** Ежедневная награда (стрик). */
export async function claimDaily(chatId: number): Promise<{ ok: boolean; reward?: number; state?: ClickerState; reason?: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cl } = await refresh(client, chatId);
    const today = irkToday();
    if (r.daily_date === today) { await client.query("ROLLBACK"); return { ok: false, reason: "already" }; }
    r.daily_streak = effectiveDailyStreak(r.daily_date, r.daily_streak, today) + 1;
    const reward = dailyReward(r.daily_streak);
    r.balance = Number(r.balance) + reward; r.total_earned = Number(r.total_earned) + reward; r.daily_date = today;
    await client.query(`UPDATE clicker_state SET balance=$2, total_earned=$3, daily_streak=$4, daily_date=$5, updated_at=NOW() WHERE chat_id=$1`,
      [chatId, r.balance, r.total_earned, r.daily_streak, today]);
    await client.query("COMMIT");
    return { ok: true, reward, state: buildState(r, cl, 0) };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

/** Забрать награду за Комбо дня (если все 3 карты сегодня прокачаны). */
// Дроп голубя из игровых источников. chance ∈ (0,1]; внутри чужой транзакции передавать client.
async function maybeDropPigeon(chatId: number, chance: number, client?: PoolClient):
  Promise<{ breed: string; isNew: boolean } | undefined> {
  if (Math.random() >= chance) return undefined;
  const { pickBreed, grantPigeon } = await import("./pigeons");
  const breed = pickBreed(Math.random(), Math.random(), weekKey(), !!activeEvent());
  return grantPigeon(chatId, breed, client);
}

/** Обновляет snapshot ClickerState после получения новой породы в той же транзакции. */
async function syncPigeonModifiersAfterDrop(r: any, chatId: number, drop: { isNew: boolean } | undefined, client: PoolClient): Promise<void> {
  if (!drop?.isNew) return;
  const { ALBUM_PASSIVE_BONUS, hasFullAlbum, pigeonPassiveBonus } = await import("./pigeons");
  const albumDone = await hasFullAlbum(chatId, client);
  r.album_bonus = albumDone;
  r.__albumMult = albumDone ? 1 + ALBUM_PASSIVE_BONUS : 1;
  r.__pigeonPassive = await pigeonPassiveBonus(chatId, client);
}

export async function claimCombo(chatId: number): Promise<{ ok: boolean; reward?: number; state?: ClickerState; reason?: string; pigeonDrop?: { breed: string; isNew: boolean } }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cl } = await refresh(client, chatId);
    const today = irkToday();
    if (r.combo_claimed === today) { await client.query("ROLLBACK"); return { ok: false, reason: "already" }; }
    const combo = todaysCombo(today);
    const recorded = r.combo_date === today ? parseHits(r.combo_hits) : [];
    const hits = comboHitsIncludingMaxed(combo, recorded, cl);
    if (!combo.every((c) => hits.includes(c))) { await client.query("ROLLBACK"); return { ok: false, reason: "not_ready" }; }
    r.balance = Number(r.balance) + COMBO_REWARD; r.total_earned = Number(r.total_earned) + COMBO_REWARD; r.combo_claimed = today;
    await client.query(`UPDATE clicker_state SET balance=$2, total_earned=$3, combo_claimed=$4, updated_at=NOW() WHERE chat_id=$1`, [chatId, r.balance, r.total_earned, today]);
    // Комбо дня — гарантированный дроп (chance=1): требует собрать все карточки за день, награда честная.
    const pigeonDrop = await maybeDropPigeon(chatId, 1, client);
    await syncPigeonModifiersAfterDrop(r, chatId, pigeonDrop, client);
    await client.query("COMMIT");
    return { ok: true, reward: COMBO_REWARD, state: buildState(r, cl, 0), pigeonDrop };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

/** Забрать награду за Шифр дня (морзе → слово). */
export async function claimCipher(chatId: number, guess: string): Promise<{ ok: boolean; reward?: number; state?: ClickerState; reason?: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cl } = await refresh(client, chatId);
    const today = irkToday();
    if (r.cipher_date === today) { await client.query("ROLLBACK"); return { ok: false, reason: "already" }; }
    if (String(guess || "").trim().toUpperCase().replace(/Ё/g, "Е") !== todaysCipher(today)) { await client.query("ROLLBACK"); return { ok: false, reason: "wrong" }; }
    r.balance = Number(r.balance) + CIPHER_REWARD; r.total_earned = Number(r.total_earned) + CIPHER_REWARD; r.cipher_date = today;
    await client.query(`UPDATE clicker_state SET balance=$2, total_earned=$3, cipher_date=$4, updated_at=NOW() WHERE chat_id=$1`, [chatId, r.balance, r.total_earned, today]);
    await client.query("COMMIT");
    return { ok: true, reward: CIPHER_REWARD, state: buildState(r, cl, 0) };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

/** Промокоды: коды из data/clicker-codes.json (live-read), 1 раз на игрока. */
function loadCodes(): { code: string; reward: number; active?: boolean }[] {
  try { const raw = fs.readFileSync(path.resolve("data/clicker-codes.json"), "utf8"); const arr = JSON.parse(raw); return Array.isArray(arr) ? arr : []; } catch (_) { return []; }
}
// ── FTUE «Первый день» (аудит 30.07): 5 шагов-вех первой сессии ────────────────
// Прогресс НЕ хранится отдельно — вычисляется из существующего состояния (тапы,
// пекарня, сундук, голубь, заезд); хранится только битовая маска забранных наград
// (ftue_claimed). Отдельные эндпоинты — hot path тапов не трогаем.
export const FTUE_STEPS = [
  { id: 0, name: "Разбуди котика — заработай 50 монет", reward: 500 },
  { id: 1, name: "Заведи «Пекарню» в Прокачке", reward: 1000 },
  { id: 2, name: "Открой Сундук удачи в «Призах»", reward: 1500 },
  { id: 3, name: "Получи первого голубя", reward: 2000 },
  { id: 4, name: "Проведи драг-заезд в голубятне", reward: 5000 },
];
const FTUE_ALL_MASK = (1 << FTUE_STEPS.length) - 1;

async function ftueDoneFlags(chatId: number, db: Queryable = pool): Promise<boolean[]> {
  // Последовательные запросы позволяют безопасно переиспользовать уже занятый
  // PoolClient из claimFtue, не запрашивая дополнительные соединения пула.
  const st = await db.query(`SELECT total_earned, chest_date, race_reaction_ms, prestige FROM clicker_state WHERE chat_id=$1`, [chatId]);
  const bakery = await db.query(`SELECT 1 FROM clicker_cards WHERE chat_id=$1 AND card='bakery' AND level>0`, [chatId]);
  const pigeon = await db.query(`SELECT 1 FROM pigeon_inventory WHERE chat_id=$1 AND count>0 LIMIT 1`, [chatId]);
  const r = st.rows[0] || {};
  // Prestige is only available after completing the whole first-cycle career.
  // It also resets total_earned and businesses, so without this ratchet an old,
  // unclaimed FTUE step could incorrectly become incomplete again.
  const progressedPastFtue = Number(r.prestige || 0) > 0;
  return [
    progressedPastFtue || Number(r.total_earned || 0) >= 50,
    progressedPastFtue || !!bakery.rowCount,
    progressedPastFtue || r.chest_date != null,
    progressedPastFtue || !!pigeon.rowCount,
    progressedPastFtue || r.race_reaction_ms != null,
  ];
}

export async function getFtue(chatId: number): Promise<{ steps: { id: number; name: string; reward: number; done: boolean; claimed: boolean }[]; allClaimed: boolean }> {
  const [done, mask] = await Promise.all([
    ftueDoneFlags(chatId),
    pool.query(`SELECT ftue_claimed FROM clicker_state WHERE chat_id=$1`, [chatId]).then(r => Number(r.rows[0]?.ftue_claimed || 0)),
  ]);
  const steps = FTUE_STEPS.map((s, i) => ({ ...s, done: done[i], claimed: !!(mask & (1 << i)) }));
  return { steps, allClaimed: (mask & FTUE_ALL_MASK) === FTUE_ALL_MASK };
}

export async function claimFtue(chatId: number, stepId: number): Promise<{ ok: boolean; reward?: number; newBalance?: number; revision?: number; reason?: string }> {
  const s = FTUE_STEPS.find(x => x.id === stepId);
  if (!s) return { ok: false, reason: "bad_step" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Сначала закрываем возможную прошлую неделю; затем атомарно ставим бит и
    // начисляем. Иначе FTUE-награда раннего понедельника попадала в старый сезон.
    await refresh(client, chatId);
    // Условие проверяем после блокировки профиля в этой же транзакции. Иначе
    // параллельный админ-сброс мог очистить прогресс между проверкой и выплатой.
    const done = await ftueDoneFlags(chatId, client);
    if (!done[stepId]) { await client.query("ROLLBACK"); return { ok: false, reason: "not_done" }; }
    const upd = await client.query(
      `UPDATE clicker_state SET ftue_claimed = ftue_claimed | $2, balance = balance + $3,
         total_earned = total_earned + $3, state_revision = state_revision + 1, updated_at=NOW()
        WHERE chat_id=$1 AND (ftue_claimed & $2) = 0 RETURNING balance, state_revision`,
      [chatId, 1 << stepId, s.reward]);
    if (!upd.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "already" }; }
    await client.query("COMMIT");
    return { ok: true, reward: s.reward, newBalance: Number(upd.rows[0].balance), revision: Number(upd.rows[0].state_revision || 0) };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { client.release(); }
}

export async function redeemCode(chatId: number, codeInput: string): Promise<{ ok: boolean; reward?: number; state?: ClickerState; reason?: string }> {
  const code = String(codeInput || "").trim().toUpperCase().replace(/Ё/g, "Е"); if (!code) return { ok: false, reason: "empty" };
  const def = loadCodes().find((c) => String(c.code || "").trim().toUpperCase().replace(/Ё/g, "Е") === code && c.active !== false);
  if (!def) return { ok: false, reason: "invalid" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cl } = await refresh(client, chatId);
    const used = await client.query(`SELECT 1 FROM clicker_codes_used WHERE chat_id=$1 AND code=$2`, [chatId, code]);
    if (used.rows.length) { await client.query("ROLLBACK"); return { ok: false, reason: "used" }; }
    const reward = Math.max(0, Math.floor(Number(def.reward) || 0));
    r.balance = Number(r.balance) + reward; r.total_earned = Number(r.total_earned) + reward;
    await client.query(`INSERT INTO clicker_codes_used (chat_id, code) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [chatId, code]);
    const updated = await client.query(
      `UPDATE clicker_state SET balance=$2, total_earned=$3, state_revision=state_revision+1, updated_at=NOW()
       WHERE chat_id=$1 RETURNING state_revision`,
      [chatId, r.balance, r.total_earned]);
    r.state_revision = Number(updated.rows[0]?.state_revision || r.state_revision || 0);
    await client.query("COMMIT");
    return { ok: true, reward, state: buildState(r, cl, 0) };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

/** Мини-игра «Золотой дождь»: 1/день. Награда за участие считается сервером. */
type GameAttemptKind = "rain" | keyof typeof GAME_CFG;
const GAME_ATTEMPT_TTL_MS = 10 * 60 * 1000;
const GAME_ATTEMPT_MIN_MS: Record<string, number> = {
  rain: 15_000,
  quiz_kids: 2_500,
  quiz_riddle: 2_500,
  count: 2_000,
  memory: 4_500,
  gems: 30_000,
  // В «Башне» первый промах честно возможен первым же быстрым тапом. Денежная
  // награда всё равно фиксирована раз в день, поэтому искусственная задержка не нужна.
  tower: 0,
};
// Попытка подписана стабильным серверным ключом, а не хранится в памяти процесса.
// Поэтому рестарт/холодный старт Render посреди игры больше не делает честный финиш
// «неизвестной попыткой». В preview без BOT_TOKEN ключ живёт до рестарта процесса.
const gameAttemptFallbackSecret = crypto.randomBytes(32).toString("hex");
const GAME_ATTEMPT_KEY = crypto.createHmac("sha256", "KotikKombatGameAttempt")
  .update(process.env.CLICKER_GAME_ATTEMPT_SECRET || process.env.BOT_TOKEN || gameAttemptFallbackSecret)
  .digest();
type GameAttemptPayload = { c: string; g: GameAttemptKind; t: number; n: string };
function signGameAttempt(payload: string): string {
  return crypto.createHmac("sha256", GAME_ATTEMPT_KEY).update(payload).digest("base64url");
}
export function createGameAttempt(chatId: number, game: string): { ok: boolean; token?: string; reason?: string } {
  if (game !== "rain" && !GAME_CFG[game]) return { ok: false, reason: "bad_game" };
  const body: GameAttemptPayload = { c: String(chatId), g: game as GameAttemptKind, t: Date.now(), n: crypto.randomBytes(9).toString("base64url") };
  const encoded = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
  return { ok: true, token: `${encoded}.${signGameAttempt(encoded)}` };
}
export function gameAttemptDay(timestamp: number): string {
  return new Date(timestamp + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
export function dailyClaimRejection(storedDay: unknown, attemptDay: string): "already" | "stale_attempt" | null {
  if (typeof storedDay !== "string" || !storedDay) return null;
  if (storedDay === attemptDay) return "already";
  // YYYY-MM-DD сортируется хронологически. Никогда не двигаем последний claim
  // назад: иначе старый и новый токены у полуночи позволяли чередовать даты.
  return storedDay > attemptDay ? "stale_attempt" : null;
}
function consumeGameAttempt(chatId: number, game: string, token: string): { ok: boolean; reason?: string; day?: string } {
  if (!token || typeof token !== "string") return { ok: false, reason: "missing_attempt" };
  if (token.length > 500) return { ok: false, reason: "bad_attempt" };
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "bad_attempt" };
  const expected = signGameAttempt(parts[0]);
  const gotBuf = Buffer.from(parts[1], "utf8"), expectedBuf = Buffer.from(expected, "utf8");
  if (gotBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(gotBuf, expectedBuf)) return { ok: false, reason: "bad_attempt" };
  let a: GameAttemptPayload;
  try { a = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as GameAttemptPayload; }
  catch { return { ok: false, reason: "bad_attempt" }; }
  if (a.c !== String(chatId) || a.g !== game || !Number.isFinite(a.t)) return { ok: false, reason: "bad_attempt" };
  const elapsed = Date.now() - a.t;
  if (elapsed < 0) return { ok: false, reason: "bad_attempt" };
  if (elapsed > GAME_ATTEMPT_TTL_MS) return { ok: false, reason: "expired_attempt" };
  if (elapsed < (GAME_ATTEMPT_MIN_MS[game] || 0)) return { ok: false, reason: "too_fast" };
  // Дневной лимит привязываем к дню СТАРТА подписанной попытки. Иначе токен,
  // полученный перед полуночью, можно было сначала использовать после полуночи,
  // а затем повторить ещё раз уже как попытку нового дня. Одновременно честная
  // игра, которая закончилась на границе суток, не теряет награду.
  return { ok: true, day: gameAttemptDay(a.t) };
}
export async function claimRain(chatId: number, score: number, attemptToken = ""): Promise<{ ok: boolean; reward?: number; state?: ClickerState; reason?: string }> {
  const attempt = consumeGameAttempt(chatId, "rain", attemptToken);
  if (!attempt.ok) return { ok: false, reason: attempt.reason };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cl } = await refresh(client, chatId);
    const today = attempt.day!;
    const rejected = dailyClaimRejection(r.rain_date, today);
    if (rejected) { await client.query("ROLLBACK"); return { ok: false, reason: rejected }; }
    const lvl = effectiveCareerLevel(Number(r.total_earned), Number(r.max_level));
    // score остаётся только результатом для интерфейса/аналитики. Денежную
    // награду нельзя основывать на значении, которое целиком прислал клиент.
    void score;
    const reward = Math.min(8_000, 1_500 + lvl * 500);
    r.balance = Number(r.balance) + reward; r.total_earned = Number(r.total_earned) + reward; r.rain_date = today;
    await client.query(`UPDATE clicker_state SET balance=$2, total_earned=$3, rain_date=$4, updated_at=NOW() WHERE chat_id=$1`, [chatId, r.balance, r.total_earned, today]);
    await client.query("COMMIT");
    return { ok: true, reward, state: buildState(r, cl, 0) };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

// ── Мини-игры хаба «Игры» (детские квизы + казуальные). 1 заход/день на игру ──
// Клиентский score оставляем для результата/аналитики, но денежная награда
// фиксирована за завершённую попытку. Подмена score больше не печатает монеты.
const GAME_CFG: Record<string, { reward: number }> = {
  quiz_kids:   { reward: 2_500 },
  quiz_riddle: { reward: 2_400 },
  count:       { reward: 1_200 },
  memory:      { reward: 3_000 },
  gems:        { reward: 4_500 },
  tower:       { reward: 6_000 },
};
export function gameParticipationReward(game: string): number { return GAME_CFG[game]?.reward ?? 0; }
export async function claimGame(chatId: number, game: string, score: number, attemptToken = ""): Promise<{ ok: boolean; reward?: number; game?: string; state?: ClickerState; reason?: string; pigeonDrop?: { breed: string; isNew: boolean } }> {
  const cfg = GAME_CFG[game]; if (!cfg) return { ok: false, reason: "bad_game" };
  const attempt = consumeGameAttempt(chatId, game, attemptToken);
  if (!attempt.ok) return { ok: false, reason: attempt.reason };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cl } = await refresh(client, chatId);
    const today = attempt.day!;
    const ex = await client.query(`SELECT day FROM clicker_daily WHERE chat_id=$1 AND game=$2`, [chatId, game]);
    const rejected = dailyClaimRejection(ex.rows[0]?.day, today);
    if (rejected) { await client.query("ROLLBACK"); return { ok: false, reason: rejected }; }
    // «Первый заход дня» — среди ВСЕХ игр хаба (не только текущей): считаем строки
    // clicker_daily за сегодня ДО инсёрта текущей игры. Если их 0 — это первый claim дня.
    const doneBefore = await client.query(`SELECT COUNT(*) AS n FROM clicker_daily WHERE chat_id=$1 AND day=$2`, [chatId, today]);
    const isFirstGameToday = Number(doneBefore.rows[0].n) === 0;
    void score;
    const reward = cfg.reward;
    r.balance = Number(r.balance) + reward; r.total_earned = Number(r.total_earned) + reward;
    await client.query(`INSERT INTO clicker_daily (chat_id, game, day) VALUES ($1,$2,$3) ON CONFLICT (chat_id, game) DO UPDATE SET day=$3`, [chatId, game, today]);
    const updated = await client.query(
      `UPDATE clicker_state SET balance=$2, total_earned=$3, state_revision=state_revision+1, updated_at=NOW()
       WHERE chat_id=$1 RETURNING state_revision`,
      [chatId, r.balance, r.total_earned]);
    r.state_revision = Number(updated.rows[0]?.state_revision || r.state_revision || 0);
    const pigeonDrop = isFirstGameToday ? await maybeDropPigeon(chatId, 0.25, client) : undefined;
    await syncPigeonModifiersAfterDrop(r, chatId, pigeonDrop, client);
    const st = buildState(r, cl, 0); st.gamesDone = await gamesDoneToday(client, chatId);
    await client.query("COMMIT");
    return { ok: true, reward, game, state: st, pigeonDrop };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

export type DailyChestPrize =
  | { type: "coins" | "jackpot"; amount: number }
  | { type: "turbo" | "energy" };

/** Сундук удачи: 1 открытие в день; бусты редкие (вместе 8% вместо прежних 27%). */
export function rollDailyChest(level: number, prizeRoll = Math.random(), amountRoll = Math.random()): DailyChestPrize {
  const r = Math.max(0, Math.min(0.999999999, Number(prizeRoll) || 0));
  const amountRng = Math.max(0, Math.min(1, Number(amountRoll) || 0));
  const sc = 1 + Math.max(1, Math.floor(Number(level) || 1)) * 0.25;
  if (r < 0.52) return { type: "coins", amount: Math.round((300 + amountRng * 1000) * sc) };
  if (r < 0.87) return { type: "coins", amount: Math.round((1200 + amountRng * 2500) * sc) };
  if (r < 0.90) return { type: "turbo" };
  if (r < 0.95) return { type: "energy" };
  return { type: "jackpot", amount: Math.round(5000 + amountRng * 15000) };
}
export async function openChest(chatId: number): Promise<{ ok: boolean; prize?: DailyChestPrize; state?: ClickerState; reason?: string; pigeonDrop?: { breed: string; isNew: boolean } }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cl } = await refresh(client, chatId);
    const today = irkToday();
    if (r.chest_date === today) { await client.query("ROLLBACK"); return { ok: false, reason: "already" }; }
    const prize = rollDailyChest(effectiveCareerLevel(Number(r.total_earned), Number(r.max_level)));
    if (prize.type === "coins" || prize.type === "jackpot") {
      r.balance = Number(r.balance) + prize.amount;
      r.total_earned = Number(r.total_earned) + prize.amount;
    } else if (prize.type === "turbo") {
      const activeUntil = r.turbo_until ? new Date(r.turbo_until).getTime() : 0;
      r.turbo_until = new Date(Math.max(Date.now(), activeUntil) + TURBO_SEC * 1000);
    } else {
      r.energy = energyMaxFor(r.energy_limit_level);
      r.energy_carry = 0;
    }
    r.chest_date = today;
    const updated = await client.query(
      `UPDATE clicker_state SET balance=$2, total_earned=$3, energy=$4, turbo_until=$5,
         chest_date=$6, energy_carry=$7, state_revision=state_revision+1, updated_at=NOW()
       WHERE chat_id=$1 RETURNING state_revision`,
      [chatId, r.balance, r.total_earned, r.energy, r.turbo_until || null, today, Number(r.energy_carry || 0)]);
    r.state_revision = Number(updated.rows[0]?.state_revision || r.state_revision || 0);
    const pigeonDrop = await maybeDropPigeon(chatId, 0.35, client);
    await syncPigeonModifiersAfterDrop(r, chatId, pigeonDrop, client);
    await client.query("COMMIT");
    return { ok: true, prize, state: buildState(r, cl, 0), pigeonDrop };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

// ── Платный кейс (казино-экономика, см. src/lootbox.ts) ──────────────────────
// case_dry теперь хранит серию денежных призов ниже стоимости кейса.
// Ограничение защищает экономику от бесконечной прокрутки кейса за один день.
export const CASE_DAILY_ROLL_LIMIT = Math.max(1, Number(process.env.CASE_DAILY_ROLL_LIMIT || 10));
export type CasePrizeOut = { type: string; amount?: number; rarity?: string; breed?: string; isNew?: boolean; businessId?: string; businessName?: string; marketValue?: number };
export async function openCase(chatId: number, requestId: string): Promise<{ ok: boolean; prize?: CasePrizeOut; state?: ClickerState; reason?: string; newBalance?: number; balanceBefore?: number; cost?: number; pigeonDrop?: { breed: string; isNew: boolean }; duplicate?: boolean; caseRollsToday?: number; caseDailyLimit?: number }> {
  const { CASE_COST, canGrantCaseBusinessLevel, rollCase, prizeValue, protectCaseLossStreak } = await import("./lootbox");
  const { grantPigeon, pickBreedOfRarity } = await import("./pigeons");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cl } = await refresh(client, chatId);
    const previous = await client.query(
      `SELECT prize, balance_before, balance_after FROM clicker_case_history WHERE chat_id=$1 AND request_id=$2`,
      [chatId, requestId]);
    if (previous.rowCount) {
      await client.query("COMMIT");
      return { ok: true, prize: previous.rows[0].prize as CasePrizeOut, state: buildState(r, cl, 0), newBalance: Number(previous.rows[0].balance_after), balanceBefore: Number(previous.rows[0].balance_before), cost: CASE_COST, duplicate: true };
    }
    const rollCount = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM clicker_case_history WHERE chat_id=$1 AND (created_at AT TIME ZONE 'Asia/Irkutsk')::date = $2::date`,
      [chatId, irkToday()]);
    const caseRollsToday = Number(rollCount.rows[0]?.count || 0);
    if (caseRollsToday >= CASE_DAILY_ROLL_LIMIT) { await client.query("ROLLBACK"); return { ok: false, reason: "case_limit", caseRollsToday, caseDailyLimit: CASE_DAILY_ROLL_LIMIT }; }
    if (Number(r.balance) < CASE_COST) { await client.query("ROLLBACK"); return { ok: false, reason: "not_enough_coins" }; }
    const balanceBefore = Number(r.balance);
    r.balance = Number(r.balance) - CASE_COST; // цена открытия
    const dry = Number(r.case_dry || 0);
    let prize = protectCaseLossStreak(rollCase(Math.random(), Math.random()), dry, Math.random());

    const out: CasePrizeOut = { type: prize.type };
    let pigeonDrop: { breed: string; isNew: boolean } | undefined;
    if (prize.type === "coins") { r.balance = Number(r.balance) + prize.amount; r.total_earned = Number(r.total_earned) + prize.amount; out.amount = prize.amount; }
    else if (prize.type === "turbo") {
      const activeUntil = r.turbo_until ? new Date(r.turbo_until).getTime() : 0;
      r.turbo_until = new Date(Math.max(Date.now(), activeUntil) + TURBO_SEC * 1000);
    }
    else if (prize.type === "energy") { r.energy = energyMaxFor(r.energy_limit_level); r.energy_carry = 0; }
    else if (prize.type === "pigeon") { const breed = pickBreedOfRarity(prize.rarity, Math.random()); pigeonDrop = await grantPigeon(chatId, breed, client); out.rarity = prize.rarity; out.breed = breed; out.isNew = pigeonDrop.isNew; out.marketValue = prizeValue(prize); }
    else if (prize.type === "business") {
      const card = CARD_BY_ID[prize.id];
      if (!card) throw new Error(`Unknown case business: ${prize.id}`);
      const level = Number(cl[prize.id] || 0);
      const marketValue = cardPrice(card, level);
      if (!canGrantCaseBusinessLevel(marketValue)) {
        // Иначе фиксированный кейс за 100k бесплатно выдаёт экспоненциально дорогие
        // уровни и превращается в бесконечный источник пассивного дохода.
        prize = { type: "coins", amount: CASE_COST };
        out.type = "coins"; out.amount = CASE_COST;
        r.balance = Number(r.balance) + CASE_COST;
        r.total_earned = Number(r.total_earned) + CASE_COST;
      } else {
        cl[prize.id] = level + 1;
        await client.query(`INSERT INTO clicker_cards (chat_id, card, level) VALUES ($1,$2,$3) ON CONFLICT (chat_id, card) DO UPDATE SET level=$3`, [chatId, prize.id, cl[prize.id]]);
        out.businessId = prize.id; out.businessName = card.name; out.marketValue = marketValue;
      }
    }

    const won = prize.type === "business" ? Number(out.marketValue) : prizeValue(prize);
    const newDry = won < CASE_COST ? dry + 1 : 0;
    await client.query(
      `UPDATE clicker_state SET balance=$2, total_earned=$3, energy=$4, turbo_until=$5, case_spent=case_spent+$6, case_won=case_won+$7, case_dry=$8, energy_carry=$9, updated_at=NOW() WHERE chat_id=$1`,
      [chatId, r.balance, r.total_earned, r.energy, r.turbo_until || null, CASE_COST, won, newDry, Number(r.energy_carry || 0)]);
    await client.query(
      `INSERT INTO clicker_case_history (chat_id, request_id, cost, prize, balance_before, balance_after) VALUES ($1,$2,$3,$4,$5,$6)`,
      [chatId, requestId, CASE_COST, JSON.stringify(out), balanceBefore, r.balance]);
    await syncPigeonModifiersAfterDrop(r, chatId, pigeonDrop, client);
    await client.query("COMMIT");
    return { ok: true, prize: out, state: buildState(r, cl, 0), newBalance: Number(r.balance), balanceBefore, cost: CASE_COST, pigeonDrop, caseRollsToday: caseRollsToday + 1, caseDailyLimit: CASE_DAILY_ROLL_LIMIT };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

/** «Золотой котик»: случайный летящий бонус. Кулдаун 45с (анти-чит), сумма по уровню. */
const BONUS_COOLDOWN_MS = 45000;
export async function claimBonus(chatId: number): Promise<{ ok: boolean; amount?: number; state?: ClickerState; reason?: string; pigeonDrop?: { breed: string; isNew: boolean } }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cl } = await refresh(client, chatId);
    if (r.bonus_at && Date.now() - new Date(r.bonus_at).getTime() < BONUS_COOLDOWN_MS) { await client.query("ROLLBACK"); return { ok: false, reason: "cooldown" }; }
    const lvl = effectiveCareerLevel(Number(r.total_earned), Number(r.max_level));
    const amount = Math.min(60000, Math.round(300 + Math.random() * (700 + lvl * 600)));
    r.balance = Number(r.balance) + amount; r.total_earned = Number(r.total_earned) + amount;
    await client.query(`UPDATE clicker_state SET balance=$2, total_earned=$3, bonus_at=NOW(), updated_at=NOW() WHERE chat_id=$1`, [chatId, r.balance, r.total_earned]);
    const pigeonDrop = await maybeDropPigeon(chatId, 0.05, client);
    await syncPigeonModifiersAfterDrop(r, chatId, pigeonDrop, client);
    await client.query("COMMIT");
    return { ok: true, amount, state: buildState(r, cl, 0), pigeonDrop };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

/** Буст: Turbo ×5 на 20с или полная энергия; лимит зависит от дневного стрика. */
export async function boostClicker(chatId: number, type: string): Promise<{ ok: boolean; state?: ClickerState; reason?: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cl } = await refresh(client, chatId);
    const today = irkToday();
    const limits = dailyBoostLimits(r.daily_date, r.daily_streak, today);
    if (type === "energy") {
      if (r.boost_energy_used >= limits.energy) { await client.query("ROLLBACK"); return { ok: false, reason: "no_boosts" }; }
      if (Number(r.energy) >= energyMaxFor(r.energy_limit_level)) { await client.query("ROLLBACK"); return { ok: false, reason: "full_energy" }; }
      r.energy = energyMaxFor(r.energy_limit_level); r.energy_carry = 0; r.boost_energy_used += 1;
      const updated = await client.query(
        `UPDATE clicker_state SET energy=$2, boost_energy_used=$3, boost_date=$4,
           energy_carry=0, state_revision=state_revision+1, updated_at=NOW(), energy_updated_at=NOW()
         WHERE chat_id=$1 RETURNING state_revision`,
        [chatId, r.energy, r.boost_energy_used, today]);
      r.boost_date = today;
      r.state_revision = Number(updated.rows[0]?.state_revision || r.state_revision || 0);
    } else if (type === "turbo") {
      if (limits.turbo <= 0) { await client.query("ROLLBACK"); return { ok: false, reason: "boost_locked" }; }
      if (r.boost_turbo_used >= limits.turbo) { await client.query("ROLLBACK"); return { ok: false, reason: "no_boosts" }; }
      if (r.turbo_until && new Date(r.turbo_until).getTime() > Date.now()) { await client.query("ROLLBACK"); return { ok: false, reason: "already_active" }; }
      r.turbo_until = new Date(Date.now() + TURBO_SEC * 1000); r.boost_turbo_used += 1;
      const updated = await client.query(
        `UPDATE clicker_state SET turbo_until=$2, boost_turbo_used=$3, boost_date=$4,
           state_revision=state_revision+1, updated_at=NOW()
         WHERE chat_id=$1 RETURNING state_revision`,
        [chatId, r.turbo_until, r.boost_turbo_used, today]);
      r.boost_date = today;
      r.state_revision = Number(updated.rows[0]?.state_revision || r.state_revision || 0);
    } else { await client.query("ROLLBACK"); return { ok: false, reason: "bad_type" }; }
    await client.query("COMMIT");
    return { ok: true, state: buildState(r, cl, 0) };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

/** Топ игроков за СЕЗОН (текущая неделя): очки = total_earned − week_base. Имя из subscribers. */
export async function getTop(chatId: number, limit = 30): Promise<{
  top: { name: string; total: number; me: boolean; prestige: number; showcase: { breed: string; stars: number }[]; title: string | null }[];
  myRank: number | null; seasonEndsTs: number;
  weekly: { enabled: boolean; prizes: { rank: number; points: number; label: string }[]; lastWeek: { rank: number; name: string; points: number; me: boolean }[] };
}> {
  const cur = weekKey();
  const { rows } = await pool.query(
    `SELECT c.chat_id, (c.total_earned - c.week_base) AS pts, c.prestige, c.album_bonus, s.first_name, s.username
       FROM clicker_state c LEFT JOIN subscribers s ON s.chat_id = c.chat_id
      WHERE c.week_key = $2 AND c.admin_blocked=FALSE AND (c.total_earned - c.week_base) > 0
      ORDER BY pts DESC, c.chat_id ASC LIMIT $1`, [limit, cur]
  );
  // Витрины топа — один запрос на всех (не по одному на игрока).
  const topIds = rows.map((r) => Number(r.chat_id));
  const showcaseByChat = new Map<number, { breed: string; stars: number }[]>();
  if (topIds.length) {
    const sc = await pool.query(
      `SELECT chat_id, breed, stars, showcase FROM pigeon_inventory WHERE chat_id = ANY($1) AND showcase > 0 ORDER BY showcase`,
      [topIds]
    );
    for (const s of sc.rows) {
      const cid = Number(s.chat_id);
      let list = showcaseByChat.get(cid);
      if (!list) { list = []; showcaseByChat.set(cid, list); }
      if (list.length < 3) list.push({ breed: String(s.breed), stars: Number(s.stars) });
    }
  }
  const top = rows.map((r) => ({
    name: (r.first_name || r.username || "Котовод").toString().slice(0, 24),
    total: Number(r.pts),
    me: Number(r.chat_id) === chatId,
    prestige: Number(r.prestige || 0),
    showcase: showcaseByChat.get(Number(r.chat_id)) || [],
    title: r.album_bonus ? "Голубиный барон" : null,
  }));
  const me = await pool.query(`SELECT week_key, (total_earned - week_base) AS pts FROM clicker_state WHERE chat_id=$1`, [chatId]);
  const myPts = me.rows.length && me.rows[0].week_key === cur ? Number(me.rows[0].pts) : 0;
  // При равных очках используем тот же стабильный tie-break, что и при закрытии
  // сезона. Иначе несколько игроков видели у себя ранг №1, а приз получал только один.
  const rank = await pool.query(
    `SELECT COUNT(*)::int AS n FROM clicker_state
      WHERE week_key=$2
        AND admin_blocked=FALSE
        AND ((total_earned - week_base) > $1
          OR ((total_earned - week_base) = $1 AND chat_id < $3))`,
    [myPts, cur, chatId]
  );
  // прошлая неделя — победители топ-3 (для соц-доказательства + «приз недели»)
  const lwKey = String(weekMonday() - 7);
  const lw = await pool.query(
    `SELECT w.rank, w.chat_id, w.points, s.first_name, s.username
       FROM clicker_week_winners w LEFT JOIN subscribers s ON s.chat_id = w.chat_id
      WHERE w.week_key = $1 ORDER BY w.rank`, [lwKey]
  );
  const lastWeek = lw.rows.map((r) => ({ rank: Number(r.rank), name: (r.first_name || r.username || "Котовод").toString().slice(0, 24), points: Number(r.points), me: Number(r.chat_id) === chatId }));
  return {
    top, myRank: myPts > 0 ? rank.rows[0].n + 1 : null, seasonEndsTs: seasonEndsTs(),
    weekly: { enabled: WEEKLY_PRIZES_ENABLED, prizes: WEEKLY_PRIZES, lastWeek },
  };
}

/**
 * Закрытие недельного сезона (#7) — крон в понедельник ~00:02 Иркутск. Игроки,
 * успевшие открыть игру после полуночи, уже сохранены в clicker_week_player_stats;
 * остальные всё ещё читаются из clicker_state. Фиксирует топ-3 завершившейся недели
 * и (если WEEKLY_PRIZES_ENABLED) начисляет баллы на карту подтверждённым.
 * Идемпотентно: повторный вызов за ту же неделю ничего не задвоит.
 * Пуш победителям — отдельно днём (pushWeeklyWinners), чтобы не будить ночью.
 */
export async function closeWeeklySeason(): Promise<{ week: string; recorded: number; awarded: number }> {
  const endedKey = String(weekMonday() - 7);
  // Снапшот заработка стай за закрытую неделю → адаптивная цель копилки следующей.
  // Объединяем уже переключившихся игроков со всё ещё не заходившими после полуночи.
  await pool.query(
    `WITH scores AS (
       SELECT p.chat_id, p.squad, p.points
         FROM clicker_week_player_stats p
         JOIN clicker_state c ON c.chat_id=p.chat_id AND c.admin_blocked=FALSE
        WHERE p.week_key=$1
       UNION ALL
       SELECT c.chat_id, c.squad, (c.total_earned - c.week_base) AS points
         FROM clicker_state c
        WHERE c.week_key=$1
          AND c.admin_blocked=FALSE
          AND NOT EXISTS (SELECT 1 FROM clicker_week_player_stats p WHERE p.week_key=$1 AND p.chat_id=c.chat_id)
     )
     INSERT INTO squad_week_stats (week, squad, earned)
     SELECT $1, squad, SUM(points)::bigint
       FROM scores
      WHERE squad IS NOT NULL AND points > 0
      GROUP BY squad
     ON CONFLICT (week, squad) DO NOTHING`, [endedKey]
  ).catch((e) => log.warn({ err: e }, "[weekly] squad stats snapshot"));
  // Весь топ-3 фиксируется одним SQL statement: падение процесса больше не может
  // оставить только первое место и заставить ранний return навсегда потерять 2-е/3-е.
  const prizePoints = (rank: number) => WEEKLY_PRIZES_ENABLED ? Number(WEEKLY_PRIZE_BY_RANK[rank]?.points || 0) : 0;
  const inserted = await pool.query(
    `WITH scores AS (
       SELECT p.chat_id, p.points AS pts
         FROM clicker_week_player_stats p
         JOIN clicker_state c ON c.chat_id=p.chat_id AND c.admin_blocked=FALSE
        WHERE p.week_key=$1
       UNION ALL
       SELECT c.chat_id, (c.total_earned - c.week_base) AS pts
         FROM clicker_state c
        WHERE c.week_key=$1
          AND c.admin_blocked=FALSE
          AND NOT EXISTS (SELECT 1 FROM clicker_week_player_stats p WHERE p.week_key=$1 AND p.chat_id=c.chat_id)
     ), top AS (
       SELECT chat_id, pts,
              ROW_NUMBER() OVER (ORDER BY pts DESC, chat_id ASC)::int AS rank
         FROM scores
        WHERE pts>0
        ORDER BY pts DESC, chat_id ASC
        LIMIT 3
     )
     INSERT INTO clicker_week_winners (week_key, rank, chat_id, points, prize_points, awarded)
     SELECT $1, rank, chat_id, pts,
            CASE rank WHEN 1 THEN $2 WHEN 2 THEN $3 WHEN 3 THEN $4 ELSE 0 END,
            FALSE
       FROM top
     ON CONFLICT (week_key, rank) DO NOTHING
     RETURNING rank`,
    [endedKey, prizePoints(1), prizePoints(2), prizePoints(3)]
  );
  const recorded = inserted.rowCount ?? 0;
  const awarded = WEEKLY_PRIZES_ENABLED ? await awardPendingWeeklyPrizes(endedKey) : 0;
  if (!recorded && !awarded) log.info({ endedKey }, "[weekly] no new winners or already closed");
  log.info({ endedKey, recorded, awarded, enabled: WEEKLY_PRIZES_ENABLED }, "[weekly] season closed");
  return { week: endedKey, recorded, awarded };
}

/** Продолжает частично завершённые выдачи; earnPoints дедупится постоянным ключом. */
async function awardPendingWeeklyPrizes(week: string): Promise<number> {
  if (!WEEKLY_PRIZES_ENABLED) return 0;
  const pending = await pool.query(
    `SELECT rank, chat_id, prize_points FROM clicker_week_winners
      WHERE week_key=$1 AND awarded=FALSE AND prize_points>0 ORDER BY rank`, [week]
  );
  let awarded = 0;
  for (const row of pending.rows) {
    const rank = Number(row.rank), chatId = Number(row.chat_id), points = Number(row.prize_points);
    if (!(await isPhoneVerified(chatId).catch(() => false))) continue;
    try {
      await earnPoints(chatId, points, "clicker_weekly_top", { rank, week }, `clicker-weekly:${week}:${rank}`);
      const marked = await pool.query(
        `UPDATE clicker_week_winners SET awarded=TRUE WHERE week_key=$1 AND rank=$2 AND awarded=FALSE`,
        [week, rank]
      );
      if ((marked.rowCount ?? 0) > 0) awarded++;
    } catch (e) {
      log.warn({ err: e, week, rank, chatId }, "[weekly] prize award failed; will retry");
    }
  }
  return awarded;
}

/**
 * Пуш победителям прошлой недели — крон в понедельник днём (не в тихие часы).
 * Только при включённых призах (иначе нечего обещать). Дедуп по флагу pushed.
 */
export async function pushWeeklyWinners(push: PushService): Promise<{ sent: number }> {
  if (!WEEKLY_PRIZES_ENABLED) return { sent: 0 };
  const endedKey = String(weekMonday() - 7);
  await awardPendingWeeklyPrizes(endedKey);
  const { rows } = await pool.query(
    `SELECT rank, chat_id, prize_points, awarded FROM clicker_week_winners WHERE week_key=$1 AND pushed=FALSE ORDER BY rank`,
    [endedKey]
  );
  let sent = 0;
  for (const r of rows) {
    const chatId = Number(r.chat_id), rank = Number(r.rank);
    const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉";
    const prize = WEEKLY_PRIZE_BY_RANK[rank];
    const link = miniAppLink(chatId, "click");
    const text = r.awarded
      ? `${medal} *Ты ${rank}-й в недельном топе «Котика Комбат»!*\n\nНаграда — ${prize?.label} «Марии» — уже на твоей карте. Поздравляем! 🎉\n\n[Открыть игру](${link})`
      : `${medal} *Ты ${rank}-й в недельном топе «Котика Комбат»!*\n\nПриз — ${prize?.label} — ждёт тебя. Подтверди телефон в приложении «Мария», чтобы забрать.\n\n[Открыть](${link})`;
    const ok = await push.sendPushSafely(chatId, "marketing_game", text, {
      dedupeKey: `weekly-winner:${endedKey}:${rank}`,
    });
    if (ok) {
      await pool.query(`UPDATE clicker_week_winners SET pushed=TRUE WHERE week_key=$1 AND rank=$2`, [endedKey, rank]);
      sent++;
    }
  }
  if (sent) log.info({ endedKey, sent }, "[weekly] winners notified");
  return { sent };
}

// ── Копилка стаи (соц-механика, 08.2026) ────────────────────────────────────
// Недельная общая цель команды: игроки жертвуют монеты из своего баланса
// (монеты СГОРАЮТ — это sink, не передача другому игроку → экономика цела).
// Цель достигнута → вся стая тапает с множителем до конца недели (Иркутск).
// ⚠️ Константы продублированы во фронте catclick.js (squadBlock).
export const SQUAD_BANK_MULT = 1.25;
export const SQUAD_BANK_MIN_DONATE = 100;
export const SQUAD_BANK_DAY_CAP = 50_000;       // вклад одного игрока в день
// Адаптивная цель: % от заработка стаи за ПРОШЛУЮ неделю (снапшот пишет
// closeWeeklySeason в squad_week_stats), с полом и потолком. Новые/пустые
// стаи без истории получают пол — достижимо даже втроём.
export const SQUAD_BANK_TARGET_PCT = 0.15;
export const SQUAD_BANK_TARGET_FLOOR = 20_000;
export const SQUAD_BANK_TARGET_CAP = 2_000_000;

/** Цель недели от заработка стаи за прошлую неделю — чистая, для юнит-тестов. */
export function squadBankTargetFrom(lastWeekEarned: number): number {
  const raw = Math.round(Math.max(0, lastWeekEarned) * SQUAD_BANK_TARGET_PCT);
  return Math.min(SQUAD_BANK_TARGET_CAP, Math.max(SQUAD_BANK_TARGET_FLOOR, raw));
}

/** Сколько игрок может вложить сейчас — чистая, для юнит-тестов. */
export function squadBankClamp(balance: number, donatedToday: number, want: number): number {
  const room = Math.max(0, SQUAD_BANK_DAY_CAP - Math.max(0, donatedToday));
  const amount = Math.min(Math.floor(want), Math.floor(balance), room);
  return amount >= SQUAD_BANK_MIN_DONATE ? amount : 0;
}

export async function initSquadBankSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clicker_squad_bank (
      week      TEXT   NOT NULL,
      squad     TEXT   NOT NULL,
      chat_id   BIGINT NOT NULL,
      total     BIGINT NOT NULL DEFAULT 0,
      today     BIGINT NOT NULL DEFAULT 0,
      today_key TEXT,
      PRIMARY KEY (week, squad, chat_id)
    );
    CREATE INDEX IF NOT EXISTS squad_bank_week_squad ON clicker_squad_bank (week, squad);
    CREATE TABLE IF NOT EXISTS clicker_squad_bank_runs (
      chat_id   BIGINT      NOT NULL,
      request_id TEXT       NOT NULL,
      week       TEXT       NOT NULL,
      squad      TEXT       NOT NULL,
      amount     BIGINT     NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (chat_id, request_id)
    );
    CREATE INDEX IF NOT EXISTS squad_bank_runs_created ON clicker_squad_bank_runs (created_at);
    CREATE TABLE IF NOT EXISTS squad_week_stats (
      week   TEXT NOT NULL,
      squad  TEXT NOT NULL,
      earned BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (week, squad)
    );
    DELETE FROM clicker_squad_bank_runs WHERE created_at < NOW() - INTERVAL '14 days';
  `);
}

/** Заработок стаи за прошлую (закрытую) неделю — источник адаптивной цели. */
async function lastWeekSquadEarned(squad: string, db: Queryable = pool): Promise<number> {
  const prev = String(weekMonday() - 7);
  const { rows } = await db.query(`SELECT earned FROM squad_week_stats WHERE week=$1 AND squad=$2`, [prev, squad]);
  return Number(rows[0]?.earned || 0);
}

export interface SquadBankStatus {
  target: number; sum: number; reached: boolean; mult: number;
  myTotal: number; myToday: number; dayCap: number; minDonate: number;
  topDonors: { chatId: number; name: string; total: number }[];
}

async function squadBankSum(squad: string, db: Queryable = pool): Promise<number> {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(b.total),0) AS s
       FROM clicker_squad_bank b
       JOIN clicker_state c ON c.chat_id=b.chat_id AND c.admin_blocked=FALSE
      WHERE b.week=$1 AND b.squad=$2`,
    [weekKey(), squad]);
  return Number(rows[0].s);
}

export async function squadBankStatus(squad: string, chatId?: number): Promise<SquadBankStatus> {
  const wk = weekKey();
  const [sum, lastEarned, mine, top] = await Promise.all([
    squadBankSum(squad),
    lastWeekSquadEarned(squad),
    chatId
      ? pool.query(`SELECT total, today, today_key FROM clicker_squad_bank WHERE week=$1 AND squad=$2 AND chat_id=$3`, [wk, squad, chatId])
      : Promise.resolve({ rows: [] as { total: number; today: number; today_key: string }[] }),
    // Топ-3 вкладчиков с именами — признание в UI (display-only)
    pool.query(
      `SELECT b.chat_id, b.total, COALESCE(NULLIF(sub.first_name,''), NULLIF(sub.username,''), 'Игрок') AS name
         FROM clicker_squad_bank b
         JOIN clicker_state c ON c.chat_id=b.chat_id AND c.admin_blocked=FALSE
         LEFT JOIN subscribers sub ON sub.chat_id = b.chat_id
        WHERE b.week=$1 AND b.squad=$2 ORDER BY b.total DESC LIMIT 3`, [wk, squad]),
  ]);
  const target = squadBankTargetFrom(lastEarned);
  const my = mine.rows[0];
  const myToday = my && my.today_key === todayIrkutsk() ? Number(my.today) : 0;
  return {
    target, sum, reached: sum >= target, mult: SQUAD_BANK_MULT,
    myTotal: Number(my?.total || 0), myToday, dayCap: SQUAD_BANK_DAY_CAP, minDonate: SQUAD_BANK_MIN_DONATE,
    topDonors: top.rows.map((r) => ({
      chatId: Number(r.chat_id),
      name: String(r.name || "Игрок").replace(/[<>]/g, "").slice(0, 24),
      total: Number(r.total),
    })),
  };
}

// Пуш стае «копилка полна» — сервис инжектится из index.ts при старте
// (роуты кликера не имеют доступа к боту напрямую).
let _clickerPushSvc: PushService | null = null;
export function setClickerPushService(p: PushService): void { _clickerPushSvc = p; }

async function squadDisplayName(squad: string): Promise<string> {
  const std = SQUADS.find((s) => s.id === squad);
  if (std) return std.name;
  const { rows } = await pool.query(`SELECT name FROM squads WHERE id=$1`, [squad]);
  return String(rows[0]?.name || "стая");
}

function notifySquadGoalReached(squad: string, mult: number): void {
  const push = _clickerPushSvc;
  if (!push) return;
  void (async () => {
    try {
      const name = await squadDisplayName(squad);
      const { rows } = await pool.query(`SELECT chat_id FROM clicker_state WHERE squad=$1 AND admin_blocked=FALSE`, [squad]);
      for (const row of rows) {
        await push.sendRaw(Number(row.chat_id),
          `🏆 Стая «${name}» наполнила копилку!\nВесь доход ×${mult} до конца недели — тапайте на полную 🐱`,
          { parse_mode: "Markdown", dedupeKey: `squad-bank:${weekKey()}:${squad}` }).catch(() => {});
        await new Promise((r) => setTimeout(r, 60));
      }
      log.info({ squad, members: rows.length }, "[squad-bank] goal push sent");
    } catch (e) { log.warn({ err: e, squad }, "[squad-bank] goal push"); }
  })();
}

export async function donateSquadBank(chatId: number, want: number, requestId = ""):
  Promise<{ ok: boolean; reason?: string; donated?: number; bank?: SquadBankStatus; state?: ClickerState; duplicate?: boolean }> {
  const client = await pool.connect();
  let clientReleased = false;
  try {
    await client.query("BEGIN");
    const rid = /^[a-zA-Z0-9_-]{8,80}$/.test(requestId) ? requestId : "";
    if (rid) {
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`squad-bank:${chatId}:${rid}`]);
      const previous = await client.query(
        `SELECT squad, amount FROM clicker_squad_bank_runs WHERE chat_id=$1 AND request_id=$2`,
        [chatId, rid]);
      if (previous.rowCount) {
        const squad = String(previous.rows[0].squad);
        const donated = Number(previous.rows[0].amount);
        await client.query("ROLLBACK");
        client.release(); clientReleased = true;
        const [state, bank] = await Promise.all([getClicker(chatId), squadBankStatus(squad, chatId)]);
        return { ok: true, duplicate: true, donated, bank, state };
      }
    }
    const { r, cl } = await refresh(client, chatId);
    const squad = r.squad as string | null;
    if (!squad) { await client.query("ROLLBACK"); return { ok: false, reason: "no_squad" }; }
    const wk = weekKey(), today = todayIrkutsk();
    const cur = await client.query(
      `SELECT total, today, today_key FROM clicker_squad_bank WHERE week=$1 AND squad=$2 AND chat_id=$3 FOR UPDATE`,
      [wk, squad, chatId]);
    const donatedToday = cur.rows[0] && cur.rows[0].today_key === today ? Number(cur.rows[0].today) : 0;
    const amount = squadBankClamp(Number(r.balance), donatedToday, want);
    if (!amount) { await client.query("ROLLBACK"); return { ok: false, reason: donatedToday >= SQUAD_BANK_DAY_CAP ? "day_cap" : "bad_amount" }; }
    r.balance = Number(r.balance) - amount;
    const updated = await client.query(
      `UPDATE clicker_state SET balance=$2, state_revision=state_revision+1, updated_at=NOW() WHERE chat_id=$1 RETURNING state_revision`,
      [chatId, r.balance]);
    r.state_revision = Number(updated.rows[0]?.state_revision || r.state_revision || 0);
    await client.query(
      `INSERT INTO clicker_squad_bank (week, squad, chat_id, total, today, today_key)
       VALUES ($1,$2,$3,$4,$4,$5)
       ON CONFLICT (week, squad, chat_id) DO UPDATE SET
         total = clicker_squad_bank.total + $4,
         today = CASE WHEN clicker_squad_bank.today_key = $5 THEN clicker_squad_bank.today + $4 ELSE $4 END,
         today_key = $5`,
      [wk, squad, chatId, amount, today]);
    if (rid) {
      await client.query(
        `INSERT INTO clicker_squad_bank_runs (chat_id, request_id, week, squad, amount) VALUES ($1,$2,$3,$4,$5)`,
        [chatId, rid, wk, squad, amount]);
    }
    await client.query("COMMIT");
    client.release(); clientReleased = true;
    _bankCache.delete(`${wk}:${squad}`); // бафф мог включиться прямо этим вкладом
    trackEvent(chatId, "squad_bank", { squad, amount });
    const bank = await squadBankStatus(squad, chatId);
    // Этот же вклад мог включить бафф. Ответ должен сразу отражать новый множитель,
    // иначе клиент до следующего тапа показывал и считал ×1 вместо ×1.25.
    if (bank.reached) r.__bankMult = SQUAD_BANK_MULT;
    // Именно этот вклад закрыл цель → событие для всей стаи (пуш в фоне)
    if (bank.reached && bank.sum - amount < bank.target) notifySquadGoalReached(squad, bank.mult);
    return { ok: true, donated: amount, bank, state: buildState(r, cl, 0) };
  } catch (e) {
    if (!clientReleased) await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { if (!clientReleased) client.release(); }
}

// Бафф в tapClicker дёргается на каждый батч тапов → кэш 60с на стаю.
const _bankCache = new Map<string, { reached: boolean; ts: number }>();
/** Только для e2e-тестов: сбросить кэш баффа. */
export function _clearSquadBankCache(): void { _bankCache.clear(); }
async function squadBankActive(squad: string | null, db: Queryable = pool): Promise<boolean> {
  if (!squad) return false;
  const key = `${weekKey()}:${squad}`;
  const hit = _bankCache.get(key);
  if (hit && Date.now() - hit.ts < 60_000) return hit.reached;
  let reached = false;
  try {
    // refresh() already owns a transaction connection. Reuse it here: asking the
    // pool for a second connection could starve a full pool under concurrent play.
    const sum = await squadBankSum(squad, db);
    const lastEarned = await lastWeekSquadEarned(squad, db);
    reached = sum >= squadBankTargetFrom(lastEarned);
  } catch { return false; }
  _bankCache.set(key, { reached, ts: Date.now() });
  if (_bankCache.size > 10_000) {
    const cutoff = Date.now() - 2 * 60_000;
    for (const [k, v] of _bankCache) if (v.ts < cutoff) _bankCache.delete(k);
    if (_bankCache.size > 10_000) _bankCache.delete(_bankCache.keys().next().value!);
  }
  return reached;
}

// ── Свои стаи (08.2026) ─────────────────────────────────────────────────────
// Игрок может создать СВОЮ стаю (за монеты, sink), назвать её, приглашать по
// инвайт-коду (мгновенное вступление) и принимать чужие заявки. 4 стандартные
// стаи остаются открытыми «лигами новичков» (вступление в 1 тап, без заявок).
// ⚠️ Константы продублированы во фронте catclick.js.
export const SQUAD_CREATE_COST = 25_000;
export const SQUAD_MAX_MEMBERS = 20;
export const SQUAD_NAME_MIN = 3;
export const SQUAD_NAME_MAX = 20;

// Базовый стоп-фильтр названий: корни мата/оскорблений. Название видят ВСЕ
// игроки в рейтинге команд — лучше пересолить, чем показать похабщину у бренда.
const SQUAD_NAME_STOP = /(ху[йеёи]|пизд|[еёи]б[ауеи]|бля|му[дч]ак|сук[аи]|гандон|пидор|пидар|хер|жоп|говн|дерьм|шлюх|дроч|fuck|shit|bitch|cunt|dick|porn)/i;

/**
 * Нормализация и проверка названия стаи — чистая, для юнит-тестов.
 * Возвращает нормализованное имя либо null (не прошло).
 */
export function sanitizeSquadName(raw: string): string | null {
  const name = String(raw || "").replace(/\s+/g, " ").trim();
  if (name.length < SQUAD_NAME_MIN || name.length > SQUAD_NAME_MAX) return null;
  if (!/^[а-яёА-ЯЁa-zA-Z0-9 \-_!?.«»]+$/.test(name)) return null;
  if (!/[а-яёА-ЯЁa-zA-Z0-9]/.test(name)) return null;
  if (SQUAD_NAME_STOP.test(name.toLowerCase().replace(/[^а-яёa-z]/g, ""))) return null;
  if (SQUADS.some((s) => s.name.toLowerCase() === name.toLowerCase())) return null;
  return name;
}

export async function initCustomSquadSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS squads (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      owner_chat_id BIGINT NOT NULL,
      invite_code   TEXT UNIQUE NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS squads_name_lower ON squads (LOWER(name));
    CREATE TABLE IF NOT EXISTS squad_requests (
      squad_id   TEXT NOT NULL,
      chat_id    BIGINT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (squad_id, chat_id)
    );
  `);
}

const genSquadId = () => "c" + crypto.randomBytes(4).toString("hex");
const genInviteCode = () => crypto.randomBytes(4).toString("base64url").replace(/[-_]/g, "x").slice(0, 6).toUpperCase();

async function squadMemberCount(id: string, db: any = pool): Promise<number> {
  const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM clicker_state WHERE squad=$1 AND admin_blocked=FALSE`, [id]);
  return Number(rows[0].n);
}

export async function createSquad(chatId: number, rawName: string):
  Promise<{ ok: boolean; reason?: string; squadId?: string; inviteCode?: string; state?: ClickerState }> {
  const name = sanitizeSquadName(rawName);
  if (!name) return { ok: false, reason: "bad_name" };
  const client = await pool.connect();
  let id = "", code = "";
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`squad-member:${chatId}`]);
    const { r } = await refresh(client, chatId);
    const own = await client.query(`SELECT id FROM squads WHERE owner_chat_id=$1`, [chatId]);
    if (own.rows.length > 0) { await client.query("ROLLBACK"); return { ok: false, reason: "already_owner" }; }
    if (Number(r.balance) < SQUAD_CREATE_COST) { await client.query("ROLLBACK"); return { ok: false, reason: "no_coins" }; }
    id = genSquadId(); code = genInviteCode();
    try {
      await client.query(`INSERT INTO squads (id, name, owner_chat_id, invite_code) VALUES ($1,$2,$3,$4)`, [id, name, chatId, code]);
    } catch (insertError: any) {
      await client.query("ROLLBACK");
      // Только конфликт уникального имени означает «название занято». Раньше сюда
      // ошибочно превращались обрыв БД и редкие конфликты id/invite_code.
      if (insertError?.code === "23505" && insertError?.constraint === "squads_name_lower") {
        return { ok: false, reason: "name_taken" };
      }
      throw insertError;
    }
    await client.query(`UPDATE clicker_state SET balance = balance - $2, squad = $3, updated_at = NOW() WHERE chat_id = $1`,
      [chatId, SQUAD_CREATE_COST, id]);
    await client.query(`DELETE FROM squad_requests WHERE chat_id=$1`, [chatId]);
    await client.query("COMMIT");
    trackEvent(chatId, "squad_create", { id, name });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { client.release(); }
  return { ok: true, squadId: id, inviteCode: code, state: await getClicker(chatId) };
}

export async function joinSquadByCode(chatId: number, rawCode: string):
  Promise<{ ok: boolean; reason?: string; squadName?: string; state?: ClickerState }> {
  const code = String(rawCode || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(code)) return { ok: false, reason: "bad_code" };
  const client = await pool.connect();
  let squadId = "", squadName = "";
  try {
    await client.query("BEGIN");
    // Блокировка строки стаи сериализует direct join и принятие заявок: лимит 20
    // теперь проверяется в одной транзакции с фактическим вступлением.
    const { rows } = await client.query(`SELECT id, name FROM squads WHERE invite_code=$1 FOR UPDATE`, [code]);
    if (!rows[0]) { await client.query("ROLLBACK"); return { ok: false, reason: "not_found" }; }
    squadId = rows[0].id; squadName = rows[0].name;
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`squad-member:${chatId}`]);
    const owned = await client.query(`SELECT id FROM squads WHERE owner_chat_id=$1 FOR UPDATE`, [chatId]);
    if (owned.rows[0] && owned.rows[0].id !== squadId) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "owner_locked" };
    }
    // Сначала фиксируем пассив и, если наступил понедельник, снимок прошлой недели
    // в СТАРОЙ стае. Иначе новый командный множитель применялся задним числом.
    const { r } = await refresh(client, chatId);
    if (r.squad !== squadId && (await squadMemberCount(squadId, client)) >= SQUAD_MAX_MEMBERS) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "full" };
    }
    await client.query(
      `UPDATE clicker_state SET squad=$2, state_revision=state_revision+1, updated_at=NOW() WHERE chat_id=$1`,
      [chatId, squadId]);
    await client.query(`DELETE FROM squad_requests WHERE chat_id=$1`, [chatId]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { client.release(); }
  trackEvent(chatId, "squad_join_code", { id: squadId });
  return { ok: true, squadName, state: await getClicker(chatId) };
}

export async function requestJoinSquad(chatId: number, squadId: string):
  Promise<{ ok: boolean; reason?: string; pending?: boolean; state?: ClickerState }> {
  // Стандартные стаи — открытые, вступление сразу
  if (SQUAD_IDS.has(squadId)) {
    const r = await joinSquad(chatId, squadId);
    return { ...r, pending: false };
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(`SELECT id, owner_chat_id FROM squads WHERE id=$1 FOR UPDATE`, [squadId]);
    if (!rows[0]) { await client.query("ROLLBACK"); return { ok: false, reason: "not_found" }; }
    // Все пути смены стаи используют один lock на игрока. Новая заявка заменяет
    // старую, поэтому позднее принятие устаревшей заявки уже не перебросит игрока.
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`squad-member:${chatId}`]);
    const owned = await client.query(`SELECT id FROM squads WHERE owner_chat_id=$1 FOR UPDATE`, [chatId]);
    if (owned.rows[0] && owned.rows[0].id !== squadId) { await client.query("ROLLBACK"); return { ok: false, reason: "owner_locked" }; }
    // refresh гарантирует строку профиля, фиксирует пассив/границу недели и
    // одновременно применяет административную блокировку. Прямой вызов API новым
    // аккаунтом больше не создаёт заявку без clicker_state.
    const { r: me } = await refresh(client, chatId);
    if (me.squad === squadId) { await client.query("ROLLBACK"); return { ok: false, reason: "already_in" }; }
    if ((await squadMemberCount(squadId, client)) >= SQUAD_MAX_MEMBERS) { await client.query("ROLLBACK"); return { ok: false, reason: "full" }; }
    await client.query(`DELETE FROM squad_requests WHERE chat_id=$1 AND squad_id<>$2`, [chatId, squadId]);
    await client.query(
      `INSERT INTO squad_requests (squad_id, chat_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [squadId, chatId]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { client.release(); }
  trackEvent(chatId, "squad_request", { id: squadId });
  return { ok: true, pending: true };
}

export interface SquadRequestRow { chatId: number; name: string; totalEarned: number; createdAt: string }

/** Заявки в МОЮ стаю (я — владелец). */
export async function listSquadRequests(ownerId: number): Promise<{ squadId: string | null; requests: SquadRequestRow[] }> {
  const own = await pool.query(`SELECT id FROM squads WHERE owner_chat_id=$1`, [ownerId]);
  if (!own.rows[0]) return { squadId: null, requests: [] };
  const squadId = own.rows[0].id as string;
  const { rows } = await pool.query(
    `SELECT r.chat_id, r.created_at, COALESCE(sub.first_name, sub.username, '') AS name,
            COALESCE(s.total_earned, 0) AS te
       FROM squad_requests r
       LEFT JOIN subscribers sub ON sub.chat_id = r.chat_id
       JOIN clicker_state s ON s.chat_id = r.chat_id AND s.admin_blocked=FALSE
      WHERE r.squad_id = $1 ORDER BY r.created_at LIMIT 30`, [squadId]);
  return {
    squadId,
    requests: rows.map((r) => ({
      chatId: Number(r.chat_id), name: String(r.name || "Игрок"),
      totalEarned: Number(r.te), createdAt: String(r.created_at),
    })),
  };
}

export async function decideSquadRequest(ownerId: number, applicantId: number, accept: boolean):
  Promise<{ ok: boolean; reason?: string }> {
  const client = await pool.connect();
  let squadId = "";
  try {
    await client.query("BEGIN");
    const own = await client.query(`SELECT id FROM squads WHERE owner_chat_id=$1 FOR UPDATE`, [ownerId]);
    if (!own.rows[0]) { await client.query("ROLLBACK"); return { ok: false, reason: "not_owner" }; }
    squadId = own.rows[0].id as string;
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`squad-member:${applicantId}`]);
    const request = await client.query(
      `SELECT 1 FROM squad_requests WHERE squad_id=$1 AND chat_id=$2 FOR UPDATE`,
      [squadId, applicantId]
    );
    if (!request.rows[0]) { await client.query("ROLLBACK"); return { ok: false, reason: "no_request" }; }
    if (!accept) {
      await client.query(`DELETE FROM squad_requests WHERE squad_id=$1 AND chat_id=$2`, [squadId, applicantId]);
      await client.query("COMMIT");
      return { ok: true };
    }
    const applicantOwn = await client.query(`SELECT id FROM squads WHERE owner_chat_id=$1 FOR UPDATE`, [applicantId]);
    if (applicantOwn.rows[0] && applicantOwn.rows[0].id !== squadId) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "owner_locked" };
    }
    const applicantState = await client.query(
      `SELECT admin_blocked FROM clicker_state WHERE chat_id=$1 FOR UPDATE`,
      [applicantId]
    );
    if (!applicantState.rows[0] || applicantState.rows[0].admin_blocked) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "applicant_blocked" };
    }
    // Владелец может принять игрока, пока тот офлайн. Фиксируем его доход в старой
    // стае до изменения membership, включая корректный снимок на границе недели.
    const { r } = await refresh(client, applicantId);
    if (r.squad !== squadId && (await squadMemberCount(squadId, client)) >= SQUAD_MAX_MEMBERS) {
      // Заявку сохраняем: владелец сможет принять её после освобождения места.
      await client.query("ROLLBACK");
      return { ok: false, reason: "full" };
    }
    await client.query(
      `UPDATE clicker_state SET squad=$2, state_revision=state_revision+1, updated_at=NOW() WHERE chat_id=$1`,
      [applicantId, squadId]);
    await client.query(`DELETE FROM squad_requests WHERE chat_id=$1`, [applicantId]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { client.release(); }
  trackEvent(applicantId, "squad_accepted", { id: squadId, by: ownerId });
  return { ok: true };
}

/** Команды: рейтинг по сумме намолоченного (стандартные + свои), выбор/смена. */
export async function getSquads(chatId: number): Promise<{
  squads: { id: string; name: string; points: number; members: number; custom: boolean; mine: boolean }[];
  mySquad: string | null;
  myOwn: { squadId: string; name: string; inviteCode: string; requests: number } | null;
  myPending: string | null;
}> {
  const [agg0, custom, me, own, pending] = await Promise.all([
    pool.query(`SELECT squad,
                       SUM(CASE WHEN admin_blocked=FALSE THEN total_earned ELSE 0 END)::bigint AS pts,
                       COUNT(*) FILTER (WHERE admin_blocked=FALSE)::int AS n
                  FROM clicker_state WHERE squad IS NOT NULL GROUP BY squad`),
    pool.query(`SELECT id, name, owner_chat_id, invite_code FROM squads`),
    pool.query(`SELECT squad FROM clicker_state WHERE chat_id=$1`, [chatId]),
    pool.query(`SELECT s.id, s.name, s.invite_code, (SELECT COUNT(*)::int FROM squad_requests r WHERE r.squad_id = s.id) AS req
                  FROM squads s WHERE s.owner_chat_id=$1`, [chatId]),
    pool.query(`SELECT squad_id FROM squad_requests WHERE chat_id=$1 LIMIT 1`, [chatId]),
  ]);
  const agg: Record<string, { pts: number; n: number }> = {};
  for (const r of agg0.rows) agg[r.squad] = { pts: Number(r.pts), n: r.n };
  const mySquad: string | null = (me.rows[0] && me.rows[0].squad) || null;

  const list = [
    ...SQUADS.map((s) => ({ id: s.id, name: s.name, custom: false })),
    ...custom.rows.map((s) => ({ id: String(s.id), name: String(s.name), custom: true })),
  ].map((s) => ({
    ...s,
    points: agg[s.id]?.pts || 0,
    members: agg[s.id]?.n || 0,
    mine: s.id === mySquad,
  })).sort((a, b) => (b.points - a.points) || a.id.localeCompare(b.id));

  // Топ-10 + своя стая всегда видна (даже если за пределами топа)
  const top = list.slice(0, 10);
  if (mySquad && !top.some((s) => s.id === mySquad)) {
    const mineRow = list.find((s) => s.id === mySquad);
    if (mineRow) top.push(mineRow);
  }

  return {
    squads: top,
    mySquad,
    myOwn: own.rows[0]
      ? { squadId: String(own.rows[0].id), name: String(own.rows[0].name), inviteCode: String(own.rows[0].invite_code), requests: Number(own.rows[0].req) }
      : null,
    myPending: pending.rows[0] ? String(pending.rows[0].squad_id) : null,
  };
}
/** Состав МОЕЙ стаи: имена + монеты в общий счёт (total_earned) + вклад в копилку
 *  этой недели. Приватность: только участники своей стаи. Топ-100 по монетам. */
export async function getSquadMembers(chatId: number): Promise<{
  inSquad: boolean; name: string; members: { name: string; coins: number; bank: number; me: boolean }[];
}> {
  const meRow = await pool.query(`SELECT squad FROM clicker_state WHERE chat_id=$1`, [chatId]);
  const squad: string | null = (meRow.rows[0] && meRow.rows[0].squad) || null;
  if (!squad) return { inSquad: false, name: "", members: [] };
  const wk = weekKey();
  const preset = SQUADS.find((s) => s.id === squad);
  let name = preset ? preset.name : squad;
  if (!preset) {
    const n = await pool.query(`SELECT name FROM squads WHERE id::text=$1`, [squad]);
    if (n.rows[0]) name = String(n.rows[0].name);
  }
  const rows = await pool.query(
    `SELECT cs.chat_id, cs.total_earned, s.first_name, s.username, COALESCE(b.total,0) AS bank
       FROM clicker_state cs
       LEFT JOIN subscribers s ON s.chat_id = cs.chat_id
       LEFT JOIN clicker_squad_bank b ON b.week=$2 AND b.squad=$1 AND b.chat_id=cs.chat_id
      WHERE cs.squad=$1 AND cs.admin_blocked=FALSE
      ORDER BY cs.total_earned DESC LIMIT 100`, [squad, wk]);
  const members = rows.rows.map((r: any) => ({
    name: (r.first_name || r.username || "Котовод").toString().slice(0, 24),
    coins: Number(r.total_earned),
    bank: Number(r.bank),
    me: Number(r.chat_id) === chatId,
  }));
  return { inSquad: true, name, members };
}
export async function joinSquad(chatId: number, squadId: string): Promise<{ ok: boolean; state?: ClickerState; reason?: string }> {
  if (!SQUAD_IDS.has(squadId)) return { ok: false, reason: "bad_squad" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`squad-member:${chatId}`]);
    const owned = await client.query(`SELECT id FROM squads WHERE owner_chat_id=$1 FOR UPDATE`, [chatId]);
    if (owned.rows[0]) { await client.query("ROLLBACK"); return { ok: false, reason: "owner_locked" }; }
    await refresh(client, chatId);
    await client.query(
      `UPDATE clicker_state SET squad=$2, state_revision=state_revision+1, updated_at=NOW() WHERE chat_id=$1`,
      [chatId, squadId]);
    await client.query(`DELETE FROM squad_requests WHERE chat_id=$1`, [chatId]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { client.release(); }
  return { ok: true, state: await getClicker(chatId) };
}

/** Регистрация реферала: code = chat_id пригласившего. Бонус обоим, один раз. */
export function isReferralEligibleState(totalEarned: unknown, taps: unknown, referredBy: unknown): boolean {
  const earned = Number(totalEarned);
  const tapCount = Number(taps);
  return referredBy == null && Number.isFinite(earned) && earned >= 0 && earned <= 5_000
    && Number.isFinite(tapCount) && tapCount >= 0 && tapCount <= 10;
}
export async function registerRef(chatId: number, code: string): Promise<{ ok: boolean; reward?: number; state: ClickerState }> {
  const rawRefId = Number(code);
  const noop = async () => ({ ok: false, state: await getClicker(chatId) });
  if (!Number.isSafeInteger(rawRefId) || rawRefId <= 0) return noop();
  const refId = await canonicalChatId(rawRefId);
  if (refId === chatId) return noop();
  const client = await pool.connect();
  let registered = false;
  try {
    await client.query("BEGIN");
    const referrer = await client.query(`SELECT 1 FROM clicker_state WHERE chat_id=$1`, [refId]);
    if (!referrer.rowCount) {
      await client.query("ROLLBACK");
    } else {
      // Оба кошелька фиксируем в стабильном порядке до начисления: так награды,
      // выданные сразу после полуночи понедельника, относятся к новой неделе.
      const states = new Map<number, any>();
      for (const id of [chatId, refId].sort((a, b) => a - b)) {
        states.set(id, (await refresh(client, id)).r);
      }
      const invitee = states.get(chatId);
      if (!isReferralEligibleState(invitee.total_earned, invitee.taps, invitee.referred_by)) {
        await client.query("ROLLBACK");
      } else {
        await client.query(
          `UPDATE clicker_state SET referred_by=$2, balance=balance+$3, total_earned=total_earned+$3,
             state_revision=state_revision+1, updated_at=NOW() WHERE chat_id=$1`,
          [chatId, refId, REF_INVITEE]);
        await client.query(
          `UPDATE clicker_state SET balance=balance+$2, total_earned=total_earned+$2,
             referrals=referrals+1, state_revision=state_revision+1, updated_at=NOW() WHERE chat_id=$1`,
          [refId, REF_REFERRER]);
        await client.query("COMMIT");
        registered = true;
      }
    }
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
  return registered
    ? { ok: true, reward: REF_INVITEE, state: await getClicker(chatId) }
    : noop();
}

// ─── Воронка MVP ─────────────────────────────────────────────────────────────

/** T4: приглашённые, чей первый заказ ещё не вознаграждён (для крона реф-бонуса). */
export async function getRefOrderCandidates(): Promise<{ invitee: number; referrer: number }[]> {
  const { rows } = await pool.query(
    `SELECT chat_id, referred_by FROM clicker_state
      WHERE referred_by IS NOT NULL AND ref_order_rewarded = FALSE`
  );
  return rows.map((r: any) => ({ invitee: Number(r.chat_id), referrer: Number(r.referred_by) }));
}

/** T4: пометить, что реф-бонус за первый заказ приглашённого выдан (идемпотентно). */
export async function markRefOrderRewarded(invitee: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE clicker_state SET ref_order_rewarded = TRUE
      WHERE chat_id = $1 AND ref_order_rewarded = FALSE`,
    [invitee]
  );
  return (rowCount ?? 0) > 0;
}

/** T5: показывался ли уже welcome-промокод игроку. */
export async function welcomePromoShown(chatId: number): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT welcome_promo_at FROM clicker_state WHERE chat_id = $1`,
    [chatId]
  );
  return rows.length > 0 && rows[0].welcome_promo_at != null;
}

/** T5: пометить, что welcome-промокод выдан (один раз). Возвращает true если только что пометили. */
export async function markWelcomePromoShown(chatId: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE clicker_state SET welcome_promo_at = NOW()
      WHERE chat_id = $1 AND welcome_promo_at IS NULL`,
    [chatId]
  );
  return (rowCount ?? 0) > 0;
}

/** Онбординг пройден — серверный флаг (переживает потерю localStorage в webview Mini App,
 *  из-за которой обучение показывалось при КАЖДОМ входе). Идемпотентно. */
export async function markOnboarded(chatId: number): Promise<void> {
  await pool.query(`UPDATE clicker_state SET onboarded = TRUE WHERE chat_id = $1 AND onboarded = FALSE`, [chatId]);
}

/**
 * Гостевой localStorage нельзя криптографически подтвердить: любое его поле
 * свободно меняется через DevTools. Сервер поэтому не переносит из снимка
 * монеты, тапы, уровни или бизнесы.
 */
export async function migrateGuest(chatId: number, _snap: unknown): Promise<{ ok: boolean; migrated?: number; state?: ClickerState; reason?: string }> {
  return { ok: true, migrated: 0, state: await getClicker(chatId) };
}

/** Витрина реальных наград (обмен монет). Пока enabled=false — только показ. */
export async function getRewards(chatId: number): Promise<{ enabled: boolean; balance: number; rewards: any[]; history: any[] }> {
  const s = await getClicker(chatId);
  const { rows } = await pool.query(`SELECT reward_id, cost, code, created_at FROM clicker_redemptions WHERE chat_id=$1 ORDER BY created_at DESC LIMIT 10`, [chatId]);
  return { enabled: REWARDS_ENABLED, balance: s.balance, rewards: REWARDS, history: rows };
}

/**
 * Обмен монет на реальную награду. ⚠️ Пока REWARDS_ENABLED=false → всегда отказ.
 * requestId связывает повтор HTTP-запроса с одной операцией. Выдача баллов/купона
 * также получает стабильный idempotency key, поэтому сбой между выдачей и ответом
 * не создаёт вторую реальную награду.
 * Loyalty-награды (kind:"loyalty") начисляют реальные баллы карты через earnPoints (телефон обязателен).
 */
export async function redeemReward(chatId: number, id: string, requestId = ""): Promise<{ ok: boolean; code?: string; points?: number; state?: ClickerState; reason?: string }> {
  if (!REWARDS_ENABLED) return { ok: false, reason: "disabled" };
  const rw = REWARD_BY_ID[id]; if (!rw) return { ok: false, reason: "bad_reward" };
  const reqKey = String(requestId).trim();
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(reqKey)) return { ok: false, reason: "bad_request_id" };
  if (rw.kind === "loyalty") {
    if (!rw.points) return { ok: false, reason: "bad_reward" };
    if (!(await isPhoneVerified(chatId).catch(() => false))) return { ok: false, reason: "need_phone" };
  } else if (!rw.catalog) return { ok: false, reason: "bad_reward" };
  const client = await pool.connect();
  let redemptionId = 0;
  let settledCode: string | null = null;
  try {
    await client.query("BEGIN");
    const { r } = await refresh(client, chatId);
    const previous = await client.query(
      `SELECT id, reward_id, code FROM clicker_redemptions WHERE chat_id=$1 AND request_id=$2 FOR UPDATE`,
      [chatId, reqKey]
    );
    if (previous.rows[0]) {
      if (previous.rows[0].reward_id !== id) { await client.query("ROLLBACK"); return { ok: false, reason: "request_id_conflict" }; }
      redemptionId = Number(previous.rows[0].id);
      settledCode = String(previous.rows[0].code || "PENDING");
    } else {
      const used = await client.query(
        `SELECT COUNT(*)::int AS n FROM clicker_redemptions
          WHERE chat_id=$1 AND code <> 'FAILED' AND created_at > NOW() - INTERVAL '1 day'`,
        [chatId]
      );
      if (Number(used.rows[0].n) >= REDEEM_PER_DAY) { await client.query("ROLLBACK"); return { ok: false, reason: "daily_limit" }; }
      if (Number(r.balance) < rw.cost) { await client.query("ROLLBACK"); return { ok: false, reason: "not_enough" }; }
      const inserted = await client.query(
        `INSERT INTO clicker_redemptions (chat_id, reward_id, cost, code, request_id)
         VALUES ($1,$2,$3,'PENDING',$4) RETURNING id`,
        [chatId, id, rw.cost, reqKey]
      );
      redemptionId = Number(inserted.rows[0].id);
      await client.query(`UPDATE clicker_state SET balance=balance-$2, updated_at=NOW() WHERE chat_id=$1`, [chatId, rw.cost]);
    }
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }

  if (settledCode && settledCode !== "PENDING") {
    if (settledCode === "FAILED") return { ok: false, reason: "grant_failed", state: await getClicker(chatId) };
    if (settledCode.startsWith("POINTS:")) {
      return { ok: true, points: Number(settledCode.slice(7)) || rw.points, state: await getClicker(chatId) };
    }
    return { ok: true, code: settledCode, state: await getClicker(chatId) };
  }

  const sourceKey = `clicker-redeem:${redemptionId}`;
  let finalCode = "";
  try {
    if (rw.kind === "loyalty") {
      await earnPoints(chatId, rw.points!, "clicker_redeem", { reward: id }, sourceKey);
      finalCode = `POINTS:${rw.points}`;
    } else {
      const grant = await grantRewardByCode(chatId, rw.catalog!, sourceKey);
      if (!grant.ok || !grant.promoCode) throw new Error(grant.reason || "grant_failed");
      finalCode = grant.promoCode;
    }
  } catch (e) {
    const refund = await pool.connect();
    try {
      await refund.query("BEGIN");
      const pending = await refund.query(`SELECT code FROM clicker_redemptions WHERE id=$1 AND chat_id=$2 FOR UPDATE`, [redemptionId, chatId]);
      if (pending.rows[0]?.code === "PENDING") {
        await refund.query(`UPDATE clicker_redemptions SET code='FAILED' WHERE id=$1`, [redemptionId]);
        await refund.query(`UPDATE clicker_state SET balance=balance+$2, updated_at=NOW() WHERE chat_id=$1`, [chatId, rw.cost]);
      }
      await refund.query("COMMIT");
    } catch (refundError) {
      await refund.query("ROLLBACK").catch(() => {});
      log.error({ err: refundError, redemptionId }, "[redeem refund failed]");
      throw refundError;
    } finally { refund.release(); }
    log.warn({ err: e, redemptionId }, "[redeem grant failed]");
    return { ok: false, reason: "grant_failed" };
  }
  await pool.query(`UPDATE clicker_redemptions SET code=$2 WHERE id=$1 AND code='PENDING'`, [redemptionId, finalCode]);
  const state = await getClicker(chatId);
  return rw.kind === "loyalty"
    ? { ok: true, points: rw.points, state }
    : { ok: true, code: finalCode, state };
}

/**
 * Начислить монеты в ОБЩИЙ кошелёк кликера (balance + total_earned).
 * Создаёт строку clicker_state при отсутствии (напр. игрок был только в питомце).
 * Перед начислением фиксирует пассив и недельную границу. Принимает опциональный
 * `client` — чтобы начислять ВНУТРИ существующей транзакции (атомарно с событием).
 * Идемпотентность НЕ гарантируется — вызывать один раз на событие.
 */
export async function addClickerBalance(chatId: number, coins: number, client?: PoolClient): Promise<void> {
  const MAX_SINGLE_INTERNAL_GRANT = 10_000_000;
  if (!Number.isFinite(coins) || coins <= 0) return;
  const n = Math.min(MAX_SINGLE_INTERNAL_GRANT, Math.round(coins));
  if (n <= 0) return;
  const credit = async (q: PoolClient) => {
    await refresh(q, chatId);
    await q.query(
      `UPDATE clicker_state SET balance = balance + $2, total_earned = total_earned + $2,
         state_revision = state_revision + 1, updated_at = NOW() WHERE chat_id=$1`,
      [chatId, n]
    );
  };
  if (client) { await credit(client); return; }
  const own = await pool.connect();
  try {
    await own.query("BEGIN");
    await credit(own);
    await own.query("COMMIT");
  } catch (e) {
    await own.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { own.release(); }
}

function taskClaimable(t: any, s: ClickerState): boolean {
  if (t.type === "link") return true;
  // Любой престиж возможен только после 19 уровня (180 млн за цикл), поэтому
  // сброс цикла не должен отбирать ещё не забранные награды нижних порогов.
  if (t.type === "level") return s.level >= t.target || s.prestige > 0;
  if (t.type === "balance") return s.totalEarned >= t.target || s.prestige > 0;
  if (t.type === "streak") return s.dailyStreak >= t.target;
  if (t.type === "ref") return s.referrals >= t.target;
  if (t.type === "taps") return s.taps >= t.target;
  if (t.type === "cards") return s.cardsOwned >= t.target;
  if (t.type === "collect") {
    if (t.target === "all") return s.cards.every((c) => c.level > 0);
    const inCat = s.cards.filter((c) => c.cat === t.target);
    return inCat.length > 0 && inCat.every((c) => c.level > 0);
  }
  return false;
}

export async function getAchievements(chatId: number): Promise<{ achievements: any[] }> {
  const s = await getClicker(chatId);
  const { rows } = await pool.query(`SELECT task FROM clicker_tasks WHERE chat_id=$1`, [chatId]);
  const done = new Set(rows.map((r) => r.task));
  return {
    achievements: ACHIEVEMENTS.map((a) => ({
      id: a.id, name: a.name, icon: a.icon, reward: a.reward, type: a.type, target: a.target,
      done: done.has(a.id), claimable: !done.has(a.id) && taskClaimable(a, s),
    })),
  };
}

export async function getTasks(chatId: number): Promise<{ tasks: any[] }> {
  const s = await getClicker(chatId);
  const { rows } = await pool.query(`SELECT task FROM clicker_tasks WHERE chat_id=$1`, [chatId]);
  const done = new Set(rows.map((r) => r.task));
  return {
    tasks: TASKS.map((t) => ({
      id: t.id, name: t.name, icon: t.icon, reward: t.reward, type: t.type, link: (t as any).link || null,
      done: done.has(t.id), claimable: !done.has(t.id) && taskClaimable(t, s),
    })),
  };
}

export async function claimTask(chatId: number, id: string): Promise<{ ok: boolean; reward?: number; state?: ClickerState; reason?: string }> {
  const t = ALL_BY_ID[id]; if (!t) return { ok: false, reason: "bad_task" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cl } = await refresh(client, chatId);
    const exists = await client.query(`SELECT 1 FROM clicker_tasks WHERE chat_id=$1 AND task=$2`, [chatId, id]);
    if (exists.rows.length) { await client.query("ROLLBACK"); return { ok: false, reason: "already" }; }
    const s = buildState(r, cl, 0);
    if (!taskClaimable(t, s)) { await client.query("ROLLBACK"); return { ok: false, reason: "not_ready" }; }
    r.balance = Number(r.balance) + t.reward; r.total_earned = Number(r.total_earned) + t.reward;
    await client.query(`INSERT INTO clicker_tasks (chat_id, task) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [chatId, id]);
    const updated = await client.query(
      `UPDATE clicker_state SET balance=$2, total_earned=$3, state_revision=state_revision+1, updated_at=NOW()
       WHERE chat_id=$1 RETURNING state_revision`,
      [chatId, r.balance, r.total_earned]);
    r.state_revision = Number(updated.rows[0]?.state_revision || r.state_revision || 0);
    await client.query("COMMIT");
    return { ok: true, reward: t.reward, state: buildState(r, cl, 0) };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

// ── Награды за прогресс: лестница вех. Каждая веха = реальный подарок ОДИН раз ──
// points → баллы на карту клуба (earnPoints); perk → купон с условием min_order
// (grantRewardByCode, корзина применяет промокод). Только подтверждённый телефон.
// ⚠️ Суммы/перки — согласовать с Машей (реальная ценность лояльности).
export const MILESTONES: { id: string; title: string; cond: { type: string; target: any }; points?: number; perk?: string; perkText?: string }[] = [
  { id: "ms_lvl5",     title: "Уровень 5",                cond: { type: "level", target: 5 },     points: 200 },
  { id: "ms_lvl10",    title: "Уровень 10",               cond: { type: "level", target: 10 },    points: 500 },
  { id: "ms_lvl13",    title: "Уровень 13",               cond: { type: "level", target: 13 },    perk: "discount_5",   perkText: "Промокод −5% (от 500₽)" },
  { id: "ms_lvl15",    title: "Уровень 15",               cond: { type: "level", target: 15 },    points: 1000 },
  { id: "ms_lvl17",    title: "Уровень 17",               cond: { type: "level", target: 17 },    perk: "discount_500", perkText: "Скидка 500₽ (от 3000₽)" },
  { id: "ms_lvl19",    title: "Последний уровень — Император выпечки", cond: { type: "level", target: 19 }, points: 20000, perk: "free_bento_top", perkText: "Бенто-торт в подарок (от 1000₽)" },
  { id: "ms_col_prod", title: "Все бизнесы «Производство»", cond: { type: "collect", target: "prod" },  points: 300 },
  { id: "ms_col_mkt",  title: "Все бизнесы «Маркетинг»",    cond: { type: "collect", target: "mkt" },   points: 300 },
  { id: "ms_col_staff",title: "Все бизнесы «Персонал»",     cond: { type: "collect", target: "staff" }, points: 300 },
  { id: "ms_col_net",  title: "Все бизнесы «Сеть»",         cond: { type: "collect", target: "net" },   points: 300 },
  { id: "ms_col_all",  title: "Вся коллекция бизнесов",      cond: { type: "collect", target: "all" },   perk: "free_bento",  perkText: "Бенто-торт в подарок (от 2000₽)" },
  { id: "ms_ref3",     title: "Пригласил 3 друзей",        cond: { type: "ref", target: 3 },       points: 500 },
  { id: "ms_ref10",    title: "Пригласил 10 друзей",       cond: { type: "ref", target: 10 },      perk: "discount_10", perkText: "Промокод −10% (от 1000₽)" },
];
const MS_BY_ID = Object.fromEntries(MILESTONES.map((m) => [m.id, m]));
const msReached = (m: any, s: ClickerState) =>
  taskClaimable({ type: m.cond.type, target: m.cond.target } as any, s);

export async function getMilestones(chatId: number): Promise<{ milestones: any[]; phoneVerified: boolean }> {
  const s = await getClicker(chatId);
  const gr = await pool.query(`SELECT achievement, points_granted, perk_granted FROM clicker_gifts WHERE chat_id=$1`, [chatId]);
  const grants = new Map(gr.rows.map((r) => [r.achievement, r]));
  const phoneVerified = await isPhoneVerified(chatId).catch(() => false);
  return {
    phoneVerified,
    milestones: MILESTONES.map((m) => ({
      id: m.id, title: m.title,
      kind: m.perk && m.points ? "both" : (m.perk ? "perk" : "points"),
      points: m.points || 0, perkText: m.perkText || "",
      reached: msReached(m, s),
      granted: (() => {
        const row = grants.get(m.id);
        return !!row && (!m.points || row.points_granted) && (!m.perk || row.perk_granted);
      })(),
    })),
  };
}

/** Забрать награду за веху: баллы на карту или перк-купон. 1 раз, телефон обязателен. */
export async function claimMilestone(chatId: number, id: string): Promise<{ ok: boolean; kind?: string; points?: number; promoCode?: string; perkTitle?: string; minOrder?: number; duplicate?: boolean; reason?: string }> {
  if (!GIFTS_ENABLED) return { ok: false, reason: "disabled" };
  const m: any = MS_BY_ID[id]; if (!m) return { ok: false, reason: "no_milestone" };
  const s = await getClicker(chatId);
  if (!msReached(m, s)) return { ok: false, reason: "not_ready" };
  if (!(await isPhoneVerified(chatId).catch(() => false))) return { ok: false, reason: "need_phone" };
  // Строка хранит прогресс двух внешних эффектов. Постоянные idempotency keys ниже
  // позволяют продолжить после сбоя между баллами и купоном без двойного начисления.
  const claim = await pool.query(
    `INSERT INTO clicker_gifts (chat_id, achievement, points, points_granted, perk_granted)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (chat_id, achievement) DO UPDATE SET points=clicker_gifts.points
     RETURNING points_granted, perk_granted, promo_code, perk_title, min_order`,
    [chatId, id, m.points || 0, !m.points, !m.perk]
  );
  const row = claim.rows[0];
  if (row.points_granted && row.perk_granted) {
    return {
      ok: true,
      duplicate: true,
      kind: m.perk && m.points ? "both" : (m.perk ? "perk" : "points"),
      points: m.points || undefined,
      promoCode: row.promo_code || undefined,
      perkTitle: row.perk_title || undefined,
      minOrder: row.min_order == null ? undefined : Number(row.min_order),
    };
  }

  const out: { ok: boolean; kind: string; points?: number; promoCode?: string; perkTitle?: string; minOrder?: number } = {
    ok: true, kind: m.perk && m.points ? "both" : (m.perk ? "perk" : "points"),
  };
  if (m.points) {
    if (!row.points_granted) {
      await earnPoints(chatId, m.points, "clicker_milestone", { milestone: id }, `clicker-milestone:${chatId}:${id}:points`);
      await pool.query(`UPDATE clicker_gifts SET points_granted=TRUE WHERE chat_id=$1 AND achievement=$2`, [chatId, id]);
    }
    out.points = m.points;
  }
  if (m.perk) {
    let promoCode = row.promo_code as string | undefined;
    let perkTitle = row.perk_title as string | undefined;
    let minOrder = row.min_order == null ? undefined : Number(row.min_order);
    if (!row.perk_granted) {
      const r = await grantRewardByCode(chatId, m.perk, `clicker-milestone:${chatId}:${id}:perk`);
      if (!r.ok) throw new Error("grant_failed:" + r.reason);
      promoCode = r.promoCode; perkTitle = r.title; minOrder = r.minOrder;
      await pool.query(
        `UPDATE clicker_gifts SET perk_granted=TRUE, promo_code=$3, perk_title=$4, min_order=$5 WHERE chat_id=$1 AND achievement=$2`,
        [chatId, id, promoCode || null, perkTitle || null, minOrder ?? null]
      );
    }
    out.promoCode = promoCode; out.perkTitle = perkTitle; out.minOrder = minOrder;
  }
  return out;
}

// ── Реальные покупки → игровые монеты (чем больше тратишь у «Марии», тем больше) ──
// Сигнал — year_spent из /api/lk (lk.php, уже работает). За НОВЫЕ траты с прошлой
// сверки начисляем монеты (watermark spent_synced — не задвоить). Троттлинг 1ч,
// чтобы не дёргать сайт. Первый заход начисляет за весь YTD (приветствие лояльным).
const PURCHASE_RATE = 20;            // монет за 1₽ покупок
const PURCHASE_CAP = 5_000_000;      // потолок одной сверки (защита от выбросов/данных)

// Чистая арифметика сверки — вынесена из syncPurchaseBonus ради юнит-тестов
// (tests/clicker.test.ts), поведение прежнее:
// delta — только НОВЫЕ траты сверх watermark (откат/новый год → 0),
// grant — монеты с потолком PURCHASE_CAP,
// birds — гарантированные голуби rare+ за каждые полные 1000₽ delta (кап 3 за сверку).
export function computePurchaseGrant(yearSpent: number, spentSynced: number):
  { delta: number; grant: number; birds: number } {
  const delta = Math.max(0, yearSpent - spentSynced);
  const grant = Math.min(delta * PURCHASE_RATE, PURCHASE_CAP);
  const birds = Math.min(3, Math.floor(delta / 1000));
  return { delta, grant, birds };
}
export async function syncPurchaseBonus(chatId: number): Promise<{ ok: boolean; granted: number; yearSpent?: number; state?: ClickerState; pigeonDrops?: { breed: string; isNew: boolean }[] }> {
  // Атомарно «застолбить» сверку: вставить/обновить last_check, только если прошло >1ч.
  const claim = await pool.query(
    `INSERT INTO clicker_purchase_sync (chat_id, last_check) VALUES ($1, NOW())
     ON CONFLICT (chat_id) DO UPDATE SET last_check = NOW()
       WHERE clicker_purchase_sync.last_check IS NULL OR clicker_purchase_sync.last_check < NOW() - INTERVAL '1 hour'
     RETURNING spent_synced, last_check`,
    [chatId]
  );
  if (!claim.rows.length) return { ok: true, granted: 0 }; // троттлинг — сверка была недавно

  const spentSynced = Number(claim.rows[0].spent_synced || 0);
  const claimedAt = claim.rows[0].last_check;
  // Освобождаем только СВОЙ claim. Условие по точному last_check не позволит
  // медленному старому запросу стереть более свежую успешную сверку.
  const releaseFailedClaim = async () => {
    await pool.query(
      `UPDATE clicker_purchase_sync SET last_check=NULL WHERE chat_id=$1 AND last_check=$2`,
      [chatId, claimedAt]
    );
  };
  const lk = await fetchLk(chatId).catch(() => null);
  if (!lk || !lk.ok || !lk.data) {
    // Сбой внешнего ЛК не должен маскироваться под успешную проверку и запрещать
    // повтор на час. Отсутствие подтверждённого телефона — стабильное состояние,
    // для него часовой throttle оставляем, чтобы не дёргать БД на каждом открытии.
    if (!lk || lk.reason !== "phone_not_verified") await releaseFailedClaim().catch(() => {});
    return { ok: true, granted: 0 };
  }
  if (!lk.data.configured) return { ok: true, granted: 0 };
  const yearSpent = Math.max(0, Math.floor(Number(lk.data.year_spent || 0)));
  const { grant, birds } = computePurchaseGrant(yearSpent, spentSynced);
  if (grant <= 0) {
    // Начислять нечего — двигаем watermark отдельно (потери монет тут быть не может).
    await pool.query(`UPDATE clicker_purchase_sync SET spent_synced=$2 WHERE chat_id=$1`, [chatId, yearSpent]);
    return { ok: true, granted: 0, yearSpent };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cl } = await refresh(client, chatId);
    r.balance = Number(r.balance) + grant; r.total_earned = Number(r.total_earned) + grant;
    await client.query(`UPDATE clicker_state SET balance=$2, total_earned=$3, updated_at=NOW() WHERE chat_id=$1`, [chatId, r.balance, r.total_earned]);
    // Watermark двигаем в ТОЙ ЖЕ транзакции, что и начисление: раньше он сдвигался
    // отдельным query ДО начисления → краш между ними терял бонус навсегда
    // (следующая сверка дала бы delta=0).
    await client.query(`UPDATE clicker_purchase_sync SET spent_synced=$2 WHERE chat_id=$1`, [chatId, yearSpent]);
    // Каждые полные 1000₽ новых покупок (delta) → гарантированный голубь rare+
    // (кап 3 за сверку) — birds посчитан выше в computePurchaseGrant.
    const pigeonDrops: { breed: string; isNew: boolean }[] = [];
    if (birds > 0) {
      const { pickPurchaseBreed, grantPigeon } = await import("./pigeons");
      for (let i = 0; i < birds; i++) {
        pigeonDrops.push(await grantPigeon(chatId, pickPurchaseBreed(Math.random(), Math.random(), !!activeEvent()), client));
      }
    }
    if (pigeonDrops.some(drop => drop.isNew)) await syncPigeonModifiersAfterDrop(r, chatId, { isNew: true }, client);
    const st = buildState(r, cl, 0); st.gamesDone = await gamesDoneToday(client, chatId);
    await client.query("COMMIT");
    return { ok: true, granted: grant, yearSpent, state: st, pigeonDrops };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    await releaseFailedClaim().catch(() => {});
    throw e;
  } finally { client.release(); }
}

// src/pigeons.ts — «Голубиная почта»: коллекция пород, обмены, почта, гонка.
// Спека: docs/superpowers/specs/2026-07-14-pigeon-market-design.md
import { PoolClient } from "pg";
import { pool } from "./db";
import { log } from "./logger";
import { miniAppLink } from "./links";
// Тип без рантайм-зависимости — push.ts не импортирует pigeons.ts, цикла нет.
import type { PushService } from "./push";

export type Rarity = "common" | "rare" | "epic" | "legendary";
export interface Breed { id: string; name: string; set: string; rarity: Rarity; }

// 4 сета × 4. Отдельный «Чемпион» удалён из продукта 13.08.2026.
export const PIGEON_BREEDS: Breed[] = [
  { id: "sizar",    name: "Сизарь",             set: "city",  rarity: "common" },
  { id: "belobok",  name: "Белобокий",          set: "city",  rarity: "common" },
  { id: "ryaboy",   name: "Рябой",              set: "city",  rarity: "common" },
  { id: "chubaty",  name: "Чубатый",            set: "city",  rarity: "common" },
  { id: "vanil",    name: "Ванильный",          set: "sweet", rarity: "rare" },
  { id: "shoko",    name: "Шоколадный",         set: "sweet", rarity: "rare" },
  { id: "karamel",  name: "Карамельный",        set: "sweet", rarity: "rare" },
  { id: "yagodny",  name: "Ягодный",            set: "sweet", rarity: "rare" },
  { id: "pochtar",  name: "Иркутский почтарь",  set: "post",  rarity: "epic" },
  { id: "baikal",   name: "Байкальский гонец",  set: "post",  rarity: "epic" },
  { id: "kurier",   name: "Ночной курьер",      set: "post",  rarity: "epic" },
  { id: "vozhak",   name: "Вожак стаи",         set: "post",  rarity: "epic" },
  { id: "svadebny", name: "Свадебный",          set: "fest",  rarity: "epic" },
  { id: "imeninny", name: "Именинный",          set: "fest",  rarity: "epic" },
  { id: "snezhny",  name: "Снежный",            set: "fest",  rarity: "epic" },
  { id: "zolotoy",  name: "Золотой голубь Василия", set: "fest", rarity: "legendary" },
];
export const BREED_BY_ID = new Map(PIGEON_BREEDS.map(b => [b.id, b]));

// Обёртка ключа недели по Иркутску — единственный источник истины: weekKey() в clicker.ts
// (используется closeWeeklySeason). Не дублируем реализацию здесь.
// Ленивый импорт (как addClickerBalance в claimSet): по конвенции модулей все связи
// clicker↔pigeons ленивые (await import с обеих сторон) — так исключается сама
// возможность цикла require независимо от порядка добавления импортов.
export async function currentWeekKey(): Promise<string> {
  const { weekKey } = await import("./clicker");
  return weekKey();
}

// Прошлая (только что завершившаяся) неделя — тот же паттерн, что closeWeeklySeason
// (clicker.ts:724): String(weekMonday() - 7). weekMonday() экспортирован из clicker.ts
// специально для этого; ленивый импорт по тем же причинам, что currentWeekKey выше.
export async function previousWeekKey(): Promise<string> {
  const { weekMonday } = await import("./clicker");
  return String(weekMonday() - 7);
}

// Сеты: награда монетами (v1 — только игровое). Полный альбом = 16 сетовых пород.
export const PIGEON_SETS: { id: string; name: string; reward: number }[] = [
  { id: "city",  name: "Городские",        reward: 25000 },
  { id: "sweet", name: "Кондитерские",     reward: 50000 },
  { id: "post",  name: "Почтовые легенды", reward: 75000 },
  { id: "fest",  name: "Праздничные",      reward: 100000 },
];
export const ALBUM_PASSIVE_BONUS = 0.05; // +5% к пассиву за полный альбом (16/16)

// Пассив от голубей: каждый уникальный голубь добавляет монеты/час, тюнинг и звёзды
// усиливают его вклад. Закрытые коллекции дают отдельный плоский бонус к доходу/час.
export const PIGEON_PASSIVE_BASE: Record<Rarity, number> = { common: 60, rare: 180, epic: 600, legendary: 2500 };
export const PIGEON_SET_PASSIVE_BONUS: Record<string, number> = { city: 1000, sweet: 2500, post: 5000, fest: 10000 };
export const PIGEON_ALL_PASSIVE_BONUS = 25000;

// Стикер-фразы Василия (id = индекс). Свободного текста в системе нет.
export const STICKERS: string[] = [
  "Держи, пригодится!", "Сладкого дня!", "От Василия с любовью 🐾", "Такой красавец искал тебя!",
  "За вкусную неделю!", "Пусть воркует у тебя!", "Обменяемся ещё!", "Ты в отличной стае!",
  "Спасибо за игру!", "Гур-гур! (это комплимент)",
];

export const RARITY_WEIGHTS: Record<Rarity, number> = { common: 70, rare: 20, epic: 8, legendary: 2 };
const FEST_SET = "fest";
const WEEK_BOOST = 3; // порода недели: вес породы ×3

// Детерминированная «порода недели» от ключа недели (week — строка-индекс дня вроде
// "20648", как возвращает weekKey() в clicker.ts; конкретный формат не важен, функция
// просто хэширует произвольную строку).
// Хэш — как cipher/combo в clicker.ts: простая свёртка кодов символов.
export function breedOfWeek(week: string): string {
  let h = 0;
  for (const c of week) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const droppable = PIGEON_BREEDS.filter(b => b.id !== "champion");
  return droppable[h % droppable.length].id;
}

// Выбор породы: r1/r2 ∈ [0,1) (Math.random со стороны вызывающего — чистота ради тестов).
// eventActive=false → праздничные (fest) исключаются из пула ПОЛНОСТЬЮ.
export function pickBreed(r1: number, r2: number, week: string, eventActive: boolean): string {
  const boost = breedOfWeek(week);
  const pool = PIGEON_BREEDS.filter(b =>
    b.id !== "champion" && (eventActive || b.set !== FEST_SET));
  // редкость с учётом того, какие редкости остались в пуле
  const present = [...new Set(pool.map(b => b.rarity))];
  const totalW = present.reduce((s, r) => s + RARITY_WEIGHTS[r], 0);
  let acc = 0; let rarity: Rarity = present[present.length - 1];
  for (const r of present) { acc += RARITY_WEIGHTS[r]; if (r1 * totalW < acc) { rarity = r; break; } }
  const inRarity = pool.filter(b => b.rarity === rarity);
  // порода недели ×WEEK_BOOST внутри своей редкости
  const weighted: string[] = [];
  for (const b of inRarity) for (let i = 0; i < (b.id === boost ? WEEK_BOOST : 1); i++) weighted.push(b.id);
  return weighted[Math.floor(r2 * weighted.length)];
}

// Гарантированный дроп за покупку: редкая+ (редкая 70 / эпик 25 / легенда 5), fest вне ивента исключён.
export function pickPurchaseBreed(r1: number, r2: number, eventActive: boolean): string {
  const w: [Rarity, number][] = [["rare", 70], ["epic", 25], ["legendary", 5]];
  let acc = 0; let rarity: Rarity = "rare";
  for (const [r, x] of w) { acc += x; if (r1 * 100 < acc) { rarity = r; break; } }
  let pool = PIGEON_BREEDS.filter(b => b.id !== "champion" && b.rarity === rarity && (eventActive || b.set !== FEST_SET));
  if (!pool.length) pool = PIGEON_BREEDS.filter(b => b.id !== "champion" && b.rarity === "rare"); // легенда вне ивента → фолбэк на редкую
  return pool[Math.floor(r2 * pool.length)].id;
}

// Случайная порода заданной редкости (для дропа из кейса, где редкость уже разыграна).
// champion исключён (он не «rarity-дроп», а отдельный приз). Фолбэк на common, если пусто.
export function pickBreedOfRarity(rarity: Rarity, r: number): string {
  let pool = PIGEON_BREEDS.filter(b => b.id !== "champion" && b.rarity === rarity);
  if (!pool.length) pool = PIGEON_BREEDS.filter(b => b.id !== "champion" && b.rarity === "common");
  return pool[Math.floor(r * pool.length) % pool.length].id;
}

// Звёзды: сколько дублей скормить до следующей звезды. ★1→★2 = 3, ★2→★3 = 5, ★3 = кап.
export function starTarget(stars: number): number | null {
  return stars === 1 ? 3 : stars === 2 ? 5 : null;
}

// ── Тюнинг гонщика: 3 характеристики за монеты, потолок TUNE_MAX ──────────────
export const TUNE_MAX = 10;
export const TUNE_BASE_COST = 500;
export const TUNE_COST_MULT = 1.7;
export const TUNE_STATS = ["speed", "stamina", "luck"] as const;
export type TuneStat = typeof TUNE_STATS[number];

// Цена следующего уровня характеристики (как бизнес-карты кликера). Потолок → null.
export function tuneCost(level: number): number | null {
  if (level >= TUNE_MAX) return null;
  return Math.floor(TUNE_BASE_COST * TUNE_COST_MULT ** level);
}

// ── Питомник: покупка гонщика за монеты кликера ─────────────────────────────
// Голуби в основном выпадают за игру; питомник — премиальный шорткат «за деньги».
// Цены НАРОЧНО высокие (редкое = сильнее в заезде и дороже), чтобы купить было трудно:
// легендарка ≈ недели заработка. Чемпион не продаётся (только приз Гонки стаи).
export const PIGEON_PRICE: Record<Rarity, number> = {
  common: 30_000, rare: 120_000, epic: 600_000, legendary: 2_500_000,
};
export function pigeonPassiveValue(breed: string, stars = 1, speed = 0, stamina = 0, luck = 0): number {
  const b = BREED_BY_ID.get(breed);
  if (!b) return 0;
  const base = PIGEON_PASSIVE_BASE[b.rarity] || 0;
  const safeStars = Math.min(3, Math.max(1, Math.floor(Number(stars) || 1)));
  const tune = Math.min(30, Math.max(0, Math.floor(Number(speed) || 0) + Math.floor(Number(stamina) || 0) + Math.floor(Number(luck) || 0)));
  const starMult = 1 + (safeStars - 1) * 0.25;
  const tuneMult = 1 + tune * 0.04;
  return Math.floor(base * starMult * tuneMult);
}

export interface PigeonMissionDef {
  id: string; name: string; description: string; durationSec: number; reward: number; difficulty: number; minPower: number; tier: "base" | "advanced" | "elite";
}
export const PIGEON_MISSIONS: PigeonMissionDef[] = [
  { id: "bakery", name: "Доставка в кондитерскую", description: "Отнести срочную коробку в соседнюю кондитерскую", durationSec: 15 * 60, reward: 2_500, difficulty: 18, minPower: 0, tier: "base" },
  { id: "city", name: "Посылка через город", description: "Пронести заказ через весь Иркутск", durationSec: 60 * 60, reward: 10_000, difficulty: 32, minPower: 0, tier: "base" },
  { id: "baikal", name: "Рейс над Байкалом", description: "Сложный дальний маршрут с большой наградой", durationSec: 4 * 60 * 60, reward: 45_000, difficulty: 50, minPower: 0, tier: "base" },
  { id: "express", name: "Экспресс-доставка", description: "Срочный маршрут для подготовленного гонщика", durationSec: 30 * 60, reward: 9_000, difficulty: 30, minPower: 20, tier: "advanced" },
  { id: "night", name: "Ночной курьер", description: "Дальний маршрут в сложных условиях", durationSec: 2 * 60 * 60, reward: 45_000, difficulty: 45, minPower: 35, tier: "advanced" },
  { id: "regional", name: "Региональный рейс", description: "Ответственная доставка за пределы города", durationSec: 4 * 60 * 60, reward: 120_000, difficulty: 60, minPower: 50, tier: "elite" },
  { id: "marathon", name: "Байкальский марафон", description: "Элитный маршрут для лучших голубей", durationSec: 8 * 60 * 60, reward: 300_000, difficulty: 75, minPower: 65, tier: "elite" },
];

export function pigeonMissionPower(breed: string, stars = 1, speed = 0, stamina = 0, luck = 0): number {
  const b = BREED_BY_ID.get(breed); if (!b) return 0;
  return RARITY_BASE[b.rarity] + (Math.max(1, Math.min(3, stars)) - 1) * 4
    + Math.max(0, speed) * 2 + Math.max(0, stamina) * 2 + Math.max(0, luck) * 2;
}

/** Шанс задания: редкость, звёзды и каждый вид тюнинга имеют заметный вес. */
export function pigeonMissionChance(breed: string, stars = 1, speed = 0, stamina = 0, luck = 0, difficulty = 0): number {
  const power = pigeonMissionPower(breed, stars, speed, stamina, luck); if (!power) return 0;
  return Math.max(20, Math.min(95, Math.round(65 + (power - difficulty) * 1.5)));
}

export function pigeonCollectionPassiveBonus(owned: Set<string>): number {
  let bonus = 0;
  for (const set of PIGEON_SETS) {
    const breeds = PIGEON_BREEDS.filter(b => b.set === set.id).map(b => b.id);
    if (breeds.length && breeds.every(id => owned.has(id))) bonus += PIGEON_SET_PASSIVE_BONUS[set.id] || 0;
  }
  const allSetBreeds = PIGEON_BREEDS.filter(b => b.id !== "champion" && b.set).map(b => b.id);
  if (allSetBreeds.length && allSetBreeds.every(id => owned.has(id))) bonus += PIGEON_ALL_PASSIVE_BONUS;
  return bonus;
}

export async function pigeonPassiveBonus(chatId: number, client: PoolClient | typeof pool = pool): Promise<number> {
  const { rows } = await client.query(
    `SELECT breed, stars, tune_speed, tune_stamina, tune_luck FROM pigeon_inventory WHERE chat_id=$1 AND count>0`,
    [chatId]);
  const owned = new Set<string>();
  let total = 0;
  for (const r of rows) {
    owned.add(String(r.breed));
    total += pigeonPassiveValue(String(r.breed), Number(r.stars), Number(r.tune_speed), Number(r.tune_stamina), Number(r.tune_luck));
  }
  return total + pigeonCollectionPassiveBonus(owned);
}
export function pigeonPrice(breed: string): number | null {
  const b = BREED_BY_ID.get(breed);
  if (!b || breed === "champion") return null;
  return PIGEON_PRICE[b.rarity];
}

// Покупка: атомарно списываем баланс кликера (условный UPDATE, как в upgradeTune) и в той
// же транзакции выдаём голубя. Дубль уже имеющейся породы = «запаска» под скорм на звёзды.
export async function buyPigeon(chatId: number, breed: string):
  Promise<{ ok: boolean; spent?: number; breed?: string; isNew?: boolean; newBalance?: number; reason?: string }> {
  const price = pigeonPrice(breed);
  if (price == null) return { ok: false, reason: "not_buyable" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const pay = await client.query(
      `UPDATE clicker_state SET balance = balance - $2 WHERE chat_id=$1 AND balance >= $2 RETURNING balance`,
      [chatId, price]);
    if (!pay.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "not_enough_coins" }; }
    const g = await grantPigeon(chatId, breed, client);
    await client.query("COMMIT");
    return { ok: true, spent: price, breed, isNew: g.isNew, newBalance: Number(pay.rows[0].balance) };
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}

// Гонка: почти детерминированные очки. Скорость/выносливость — плоская сила (по +6),
// удача расширяет случайный «рывок» (0..3 без удачи → 0..23 на удаче 10). Базис редкости
// второстепенен: прокачанный common может обойти непрокачанного legendary.
const RARITY_BASE: Record<Rarity, number> = { common: 10, rare: 16, epic: 22, legendary: 28 };
export function raceScore(breedId: string, stars: number, speed: number, stamina: number, luck: number, r: number): number {
  const b = BREED_BY_ID.get(breedId); if (!b) return 0;
  return RARITY_BASE[b.rarity] + (stars - 1) * 4 + 6 * speed + 6 * stamina + Math.floor(r * (3 + 2 * luck));
}

// Дивизион гонки по рейтингу силы (сумма трёх характеристик, 0..30). Новичок соревнуется
// с равными; по мере прокачки поднимаешься в лигу посильнее — естественный матчмейкинг.
export type Division = "bronze" | "silver" | "gold";
export function raceDivision(powerRating: number): Division {
  return powerRating >= 18 ? "gold" : powerRating >= 9 ? "silver" : "bronze";
}
// Призы топ-3 каждого дивизиона (v1 — игровые монеты). Чемпион — только gold место 1.
export const DIVISION_PRIZES: Record<Division, number[]> = {
  bronze: [5000, 2500, 1000],
  silver: [15000, 8000, 4000],
  gold: [50000, 25000, 10000],
};

// ── Схема ──────────────────────────────────────────────────────────────────
export async function initPigeonSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pigeon_inventory (
      chat_id BIGINT NOT NULL, breed TEXT NOT NULL,
      count INT NOT NULL DEFAULT 0, stars SMALLINT NOT NULL DEFAULT 1,
      showcase SMALLINT NOT NULL DEFAULT 0,
      first_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (chat_id, breed));
    CREATE TABLE IF NOT EXISTS pigeon_trades (
      id BIGSERIAL PRIMARY KEY, from_chat BIGINT NOT NULL, to_chat BIGINT,
      give TEXT NOT NULL, want TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), closed_at TIMESTAMPTZ, closed_by BIGINT);
    CREATE INDEX IF NOT EXISTS pigeon_trades_board ON pigeon_trades (status, created_at DESC);
    CREATE TABLE IF NOT EXISTS pigeon_mail (
      id BIGSERIAL PRIMARY KEY, from_chat BIGINT NOT NULL, to_chat BIGINT NOT NULL,
      breed TEXT NOT NULL, sticker SMALLINT NOT NULL, thanks_sticker SMALLINT,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), seen_at TIMESTAMPTZ);
    CREATE INDEX IF NOT EXISTS pigeon_mail_inbox ON pigeon_mail (to_chat, seen_at);
    CREATE TABLE IF NOT EXISTS pigeon_sets_claimed (
      chat_id BIGINT NOT NULL, set_id TEXT NOT NULL, claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (chat_id, set_id));
    CREATE TABLE IF NOT EXISTS pigeon_friends (
      chat_a BIGINT NOT NULL, chat_b BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (chat_a, chat_b));
    CREATE INDEX IF NOT EXISTS pigeon_friends_b ON pigeon_friends (chat_b);
    CREATE TABLE IF NOT EXISTS pigeon_duels (
      id BIGSERIAL PRIMARY KEY,
      from_chat BIGINT NOT NULL, to_chat BIGINT NOT NULL,
      stake BIGINT NOT NULL DEFAULT 0,
      from_breed TEXT NOT NULL, from_tap JSONB NOT NULL, from_stats JSONB NOT NULL,
      to_breed TEXT, to_tap JSONB, to_stats JSONB,
      status TEXT NOT NULL DEFAULT 'open',
      winner_chat BIGINT, result JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), closed_at TIMESTAMPTZ);
    CREATE INDEX IF NOT EXISTS pigeon_duels_to_open ON pigeon_duels (to_chat, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS pigeon_duels_from_open ON pigeon_duels (from_chat, status, created_at DESC);
    CREATE TABLE IF NOT EXISTS pigeon_race_entries (
      week TEXT NOT NULL, chat_id BIGINT NOT NULL, breed TEXT NOT NULL,
      score INT, entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (week, chat_id));
    CREATE TABLE IF NOT EXISTS pigeon_race_winners (
      week TEXT PRIMARY KEY, results JSONB NOT NULL, closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS pigeon_missions (
      id BIGSERIAL PRIMARY KEY, chat_id BIGINT NOT NULL, breed TEXT NOT NULL, mission_id TEXT NOT NULL,
      chance SMALLINT NOT NULL, reward BIGINT NOT NULL, consolation BIGINT NOT NULL,
      succeeds BOOLEAN NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completes_at TIMESTAMPTZ NOT NULL,
      claimed_at TIMESTAMPTZ);
    CREATE UNIQUE INDEX IF NOT EXISTS pigeon_missions_one_active_bird
      ON pigeon_missions (chat_id, breed) WHERE status='active';
    CREATE INDEX IF NOT EXISTS pigeon_missions_player ON pigeon_missions (chat_id, status, completes_at);
  `);
  // Кэш перка «полный альбом» (+5% к пассиву, ALBUM_PASSIVE_BONUS) на clicker_state —
  // выставляется в grantPigeon при 16/16 пород, читается в clicker.ts::refresh без
  // похода в pigeon_inventory на каждый тап. initClickerSchema() уже отработал к этому
  // моменту (index.ts: initClickerSchema() → initPigeonSchema()), таблица существует.
  await pool.query(`ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS album_bonus BOOLEAN NOT NULL DEFAULT FALSE`);
  // Тюнинг гонщика: 3 характеристики на пару (игрок, порода) + снапшот дивизиона в заявке.
  await pool.query(`ALTER TABLE pigeon_inventory ADD COLUMN IF NOT EXISTS tune_speed SMALLINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE pigeon_inventory ADD COLUMN IF NOT EXISTS tune_stamina SMALLINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE pigeon_inventory ADD COLUMN IF NOT EXISTS tune_luck SMALLINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE pigeon_race_entries ADD COLUMN IF NOT EXISTS division TEXT NOT NULL DEFAULT 'bronze'`);
  // Доплата монетами в обмене: coin_delta>0 — создатель доплачивает (монеты в эскроу при
  // создании), coin_delta<0 — создатель просит доплату (платит принимающий при приёме), 0 — чистый своп.
  await pool.query(`ALTER TABLE pigeon_trades ADD COLUMN IF NOT EXISTS coin_delta BIGINT NOT NULL DEFAULT 0`);
  // Стартовый голубь: флаг одноразовой выдачи Сизаря новому игроку (см. refresh в clicker.ts).
  await pool.query(`ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS starter_pigeon BOOLEAN NOT NULL DEFAULT FALSE`);
  // Храповик уровня (max_level не откатывается при ужесточении порогов, 15.07). Грандфазер:
  // одноразово фиксируем уровень существующих игроков по СТАРЫМ порогам, чтобы новая (более
  // крутая) кривая никого не понизила. GREATEST идемпотентен — повтор на буте безвреден.
  await pool.query(`ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS max_level SMALLINT NOT NULL DEFAULT 1`);
  // Драг-рейсинг: реакция игрока (мс) для подбора соперников (pickOpponents в drag.ts) — снапшот
  // последнего заезда; NULL для тех, кто ещё не гонял (тогда используем synthReaction).
  await pool.query(`ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS race_reaction_ms SMALLINT`);
  await pool.query(`UPDATE clicker_state SET max_level = GREATEST(max_level, CASE
      WHEN total_earned >= 1200000000 THEN 19 WHEN total_earned >= 150000000 THEN 18
      WHEN total_earned >= 30000000 THEN 17 WHEN total_earned >= 8000000 THEN 16
      WHEN total_earned >= 3500000 THEN 15 WHEN total_earned >= 2000000 THEN 14
      WHEN total_earned >= 1300000 THEN 13 WHEN total_earned >= 800000 THEN 12
      WHEN total_earned >= 500000 THEN 11 WHEN total_earned >= 320000 THEN 10
      WHEN total_earned >= 200000 THEN 9 WHEN total_earned >= 120000 THEN 8
      WHEN total_earned >= 70000 THEN 7 WHEN total_earned >= 38000 THEN 6
      WHEN total_earned >= 18000 THEN 5 WHEN total_earned >= 8000 THEN 4
      WHEN total_earned >= 3000 THEN 3 WHEN total_earned >= 1000 THEN 2 ELSE 1 END)`);
}

// ── Инвентарь ──────────────────────────────────────────────────────────────
// UPSERT +1. client обязателен, если вызывается из чужой транзакции (дропы clicker.ts).
export async function grantPigeon(chatId: number, breedId: string, client?: PoolClient):
  Promise<{ breed: string; isNew: boolean }> {
  const q = client ?? pool;
  const r = await q.query(
    `INSERT INTO pigeon_inventory (chat_id, breed, count) VALUES ($1,$2,1)
     ON CONFLICT (chat_id, breed) DO UPDATE SET count = pigeon_inventory.count + 1
     RETURNING count`, [chatId, breedId]);
  const isNew = r.rows[0].count === 1;
  // Только новая НЕ-champion порода могла сдвинуть счётчик различных пород до 16 —
  // не гонять hasFullAlbum на каждый дубль. album_bonus читается кэшем в clicker.ts::refresh.
  if (isNew && breedId !== "champion" && (await hasFullAlbum(chatId, client))) {
    await q.query(`UPDATE clicker_state SET album_bonus=TRUE WHERE chat_id=$1 AND album_bonus=FALSE`, [chatId]);
  }
  return { breed: breedId, isNew };
}

export async function hasFullAlbum(chatId: number, client?: PoolClient): Promise<boolean> {
  const q = client ?? pool;
  const r = await q.query(
    `SELECT COUNT(DISTINCT breed) AS n FROM pigeon_inventory WHERE chat_id=$1 AND count>0 AND breed<>'champion'`,
    [chatId]);
  return Number(r.rows[0].n) >= 16;
}

export async function getPigeonsOverview(chatId: number) {
  const [inv, claimed] = await Promise.all([
    pool.query(`SELECT breed, count, stars, showcase, tune_speed, tune_stamina, tune_luck FROM pigeon_inventory WHERE chat_id=$1 AND count>0`, [chatId]),
    pool.query(`SELECT set_id FROM pigeon_sets_claimed WHERE chat_id=$1`, [chatId]),
  ]);
  const owned = new Set(inv.rows.map((r: any) => r.breed));
  const claimedSet = new Set(claimed.rows.map((r: any) => r.set_id));
  const inventory = inv.rows.map((r: any) => ({
    ...r,
    passivePerHour: pigeonPassiveValue(r.breed, Number(r.stars), Number(r.tune_speed), Number(r.tune_stamina), Number(r.tune_luck)),
  }));
  const sets = PIGEON_SETS.map(s => ({
    ...s,
    owned: PIGEON_BREEDS.filter(b => b.set === s.id && owned.has(b.id)).length,
    claimed: claimedSet.has(s.id),
  }));
  return {
    inventory, sets,
    passivePerHour: inventory.reduce((sum: number, r: any) => sum + Number(r.passivePerHour), 0) + pigeonCollectionPassiveBonus(owned),
    albumDone: [...owned].filter(b => b !== "champion").length >= 16,
    unreadMail: 0,
    weekBreed: breedOfWeek(await currentWeekKey()),
  };
}

export async function getPigeonMissions(chatId: number) {
  const [inv, active] = await Promise.all([
    pool.query(`SELECT breed, stars, tune_speed, tune_stamina, tune_luck FROM pigeon_inventory WHERE chat_id=$1 AND count>0 ORDER BY breed`, [chatId]),
    pool.query(`SELECT id, breed, mission_id, chance, reward, consolation, started_at, completes_at
      FROM pigeon_missions WHERE chat_id=$1 AND status='active' ORDER BY completes_at`, [chatId]),
  ]);
  const activeByBreed = new Map(active.rows.map((r: any) => [String(r.breed), r]));
  return {
    missions: PIGEON_MISSIONS,
    pigeons: inv.rows.map((r: any) => ({
      breed: r.breed, stars: Number(r.stars), speed: Number(r.tune_speed), stamina: Number(r.tune_stamina), luck: Number(r.tune_luck),
      power: pigeonMissionPower(r.breed, Number(r.stars), Number(r.tune_speed), Number(r.tune_stamina), Number(r.tune_luck)),
      passivePerHour: pigeonPassiveValue(r.breed, Number(r.stars), Number(r.tune_speed), Number(r.tune_stamina), Number(r.tune_luck)),
      activeMissionId: activeByBreed.get(String(r.breed))?.id ?? null,
    })),
    active: active.rows,
    serverNow: new Date().toISOString(),
  };
}

export async function startPigeonMission(chatId: number, missionId: string, breed: string):
  Promise<{ ok: boolean; mission?: any; reason?: string }> {
  const def = PIGEON_MISSIONS.find(m => m.id === missionId);
  if (!def) return { ok: false, reason: "unknown_mission" };
  if (!BREED_BY_ID.has(breed)) return { ok: false, reason: "not_owned" };
  const owned = await pool.query(
    `SELECT stars, tune_speed, tune_stamina, tune_luck FROM pigeon_inventory WHERE chat_id=$1 AND breed=$2 AND count>0`,
    [chatId, breed]);
  if (!owned.rowCount) return { ok: false, reason: "not_owned" };
  const r = owned.rows[0];
  const power = pigeonMissionPower(breed, Number(r.stars), Number(r.tune_speed), Number(r.tune_stamina), Number(r.tune_luck));
  if (power < def.minPower) return { ok: false, reason: "mission_locked" };
  const chance = pigeonMissionChance(breed, Number(r.stars), Number(r.tune_speed), Number(r.tune_stamina), Number(r.tune_luck), def.difficulty);
  const succeeds = Math.random() * 100 < chance;
  const consolation = Math.max(1, Math.floor(def.reward * 0.2));
  try {
    const created = await pool.query(
      `INSERT INTO pigeon_missions (chat_id, breed, mission_id, chance, reward, consolation, succeeds, completes_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW() + $8 * INTERVAL '1 second')
       RETURNING id, breed, mission_id, chance, reward, consolation, started_at, completes_at`,
      [chatId, breed, def.id, chance, def.reward, consolation, succeeds, def.durationSec]);
    return { ok: true, mission: created.rows[0] };
  } catch (e: any) {
    if (e?.code === "23505") return { ok: false, reason: "bird_busy" };
    throw e;
  }
}

export async function claimPigeonMission(chatId: number, id: number):
  Promise<{ ok: boolean; success?: boolean; reward?: number; newBalance?: number; reason?: string }> {
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, reason: "bad_input" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT id, succeeds, reward, consolation, completes_at FROM pigeon_missions
       WHERE id=$1 AND chat_id=$2 AND status='active' FOR UPDATE`, [id, chatId]);
    if (!found.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "not_found" }; }
    const mission = found.rows[0];
    if (new Date(mission.completes_at).getTime() > Date.now()) { await client.query("ROLLBACK"); return { ok: false, reason: "not_ready" }; }
    const success = Boolean(mission.succeeds);
    const reward = Number(success ? mission.reward : mission.consolation);
    await client.query(`UPDATE pigeon_missions SET status='claimed', claimed_at=NOW() WHERE id=$1`, [id]);
    const { addClickerBalance } = await import("./clicker");
    await addClickerBalance(chatId, reward, client);
    const balance = await client.query(`SELECT balance FROM clicker_state WHERE chat_id=$1`, [chatId]);
    await client.query("COMMIT");
    return { ok: true, success, reward, newBalance: Number(balance.rows[0].balance) };
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}

// claimSet: строка-мьютекс + монеты в одной транзакции (паттерн clicker_gifts).
export async function claimSet(chatId: number, setId: string):
  Promise<{ ok: boolean; reward?: number; newBalance?: number; reason?: string }> {
  const set = PIGEON_SETS.find(s => s.id === setId);
  if (!set) return { ok: false, reason: "unknown_set" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owned = await client.query(
      `SELECT COUNT(*) AS n FROM pigeon_inventory WHERE chat_id=$1 AND count>0 AND breed = ANY($2)`,
      [chatId, PIGEON_BREEDS.filter(b => b.set === setId).map(b => b.id)]);
    if (Number(owned.rows[0].n) < 4) { await client.query("ROLLBACK"); return { ok: false, reason: "incomplete" }; }
    const mutex = await client.query(
      `INSERT INTO pigeon_sets_claimed (chat_id, set_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING 1`,
      [chatId, setId]);
    if (!mutex.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "already" }; }
    // Динамический импорт вместо статического: по конвенции модулей все связи clicker↔pigeons
    // ленивые (await import с обеих сторон) — статический импорт addClickerBalance здесь нарушил
    // бы эту конвенцию. await import(...) при module="commonjs" компилируется в Promise-обёртку
    // над require(), выполняемую лениво внутри тела функции — к этому моменту оба модуля уже
    // полностью инициализированы, цикла нет в принципе.
    const { addClickerBalance } = await import("./clicker");
    await addClickerBalance(chatId, set.reward, client);
    const bal = await client.query(`SELECT balance FROM clicker_state WHERE chat_id=$1`, [chatId]);
    await client.query("COMMIT");
    return { ok: true, reward: set.reward, newBalance: Number(bal.rows[0]?.balance ?? 0) };
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}

// feedPigeon: скормить дубли до следующей звезды целиком (starTarget штук за раз).
export async function feedPigeon(chatId: number, breedId: string):
  Promise<{ ok: boolean; stars?: number; spent?: number; reason?: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `SELECT count, stars FROM pigeon_inventory WHERE chat_id=$1 AND breed=$2 FOR UPDATE`, [chatId, breedId]);
    if (!r.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "not_owned" }; }
    const { count, stars } = r.rows[0];
    const need = starTarget(stars);
    if (need == null) { await client.query("ROLLBACK"); return { ok: false, reason: "max_stars" }; }
    if (count - 1 < need) { await client.query("ROLLBACK"); return { ok: false, reason: "not_enough_dupes" }; }
    await client.query(
      `UPDATE pigeon_inventory SET count = count - $3, stars = stars + 1 WHERE chat_id=$1 AND breed=$2`,
      [chatId, breedId, need]);
    await client.query("COMMIT");
    return { ok: true, stars: stars + 1, spent: need };
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}

export async function setShowcase(chatId: number, breeds: string[]): Promise<{ ok: boolean; reason?: string }> {
  if (!Array.isArray(breeds) || breeds.length > 3) return { ok: false, reason: "bad_input" };
  if (breeds.some(b => !BREED_BY_ID.has(b))) return { ok: false, reason: "unknown_breed" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE pigeon_inventory SET showcase=0 WHERE chat_id=$1 AND showcase>0`, [chatId]);
    for (let i = 0; i < breeds.length; i++) {
      const u = await client.query(
        `UPDATE pigeon_inventory SET showcase=$3 WHERE chat_id=$1 AND breed=$2 AND count>0`,
        [chatId, breeds[i], i + 1]);
      if (!u.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "not_owned" }; }
    }
    await client.query("COMMIT");
    return { ok: true };
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}

// ── Обмены ─────────────────────────────────────────────────────────────────
export const MAX_OPEN_TRADES = 3;
const TRADE_TTL_DAYS = 7;
export const TRADE_COIN_CAP = 100_000_000; // потолок доплаты монетами в обмене (в обе стороны)

// Нормализуем untrusted-доплату: целое в [−CAP, +CAP]. NaN/дробь/вне диапазона → null (bad).
export function normalizeCoinDelta(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (Math.abs(n) > TRADE_COIN_CAP) return null;
  return n;
}

export async function createTrade(chatId: number, give: string, want: string, to?: number, coinDelta: number = 0):
  Promise<{ ok: boolean; id?: number; reason?: string; newBalance?: number }> {
  if (!BREED_BY_ID.has(give) || !BREED_BY_ID.has(want) || give === want) return { ok: false, reason: "bad_input" };
  if (to === chatId) return { ok: false, reason: "self" };
  const coin = normalizeCoinDelta(coinDelta);
  if (coin == null) return { ok: false, reason: "bad_coins" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // сериализация createTrade на пользователя — иначе двойной тап обходит лимит 3 офферов
    await client.query(`SELECT pg_advisory_xact_lock($1)`, [chatId]);
    if (typeof to === "number") {
      const ex = await client.query("SELECT 1 FROM clicker_state WHERE chat_id=$1", [to]);
      if (!ex.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "no_player" }; }
    }
    const cnt = await client.query(
      `SELECT COUNT(*) AS n FROM pigeon_trades WHERE from_chat=$1 AND status='open'`, [chatId]);
    if (Number(cnt.rows[0].n) >= MAX_OPEN_TRADES) { await client.query("ROLLBACK"); return { ok: false, reason: "limit" }; }
    // эскроу: списать дубликат (count>1!)
    const esc = await client.query(
      `UPDATE pigeon_inventory SET count = count - 1 WHERE chat_id=$1 AND breed=$2 AND count>1 RETURNING 1`,
      [chatId, give]);
    if (!esc.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "need_duplicate" }; }
    // Доплата создателя (coin>0) уходит в эскроу сразу — как дубликат: списываем атомарно,
    // возвращаем при отмене/протухании, отдаём принимающему при приёме. coin<0 (просим доплату)
    // эскроу не требует — платит принимающий на приёме.
    let newBalance: number | undefined;
    if (coin > 0) {
      const pay = await client.query(
        `UPDATE clicker_state SET balance = balance - $2 WHERE chat_id=$1 AND balance >= $2 RETURNING balance`,
        [chatId, coin]);
      if (!pay.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "not_enough_coins" }; }
      newBalance = Number(pay.rows[0].balance);
    }
    const ins = await client.query(
      `INSERT INTO pigeon_trades (from_chat, to_chat, give, want, coin_delta) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [chatId, to ?? null, give, want, coin]);
    await client.query("COMMIT");
    return { ok: true, id: ins.rows[0].id, newBalance };
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}

export async function acceptTrade(chatId: number, tradeId: number):
  Promise<{ ok: boolean; got?: string; gave?: string; reason?: string; newBalance?: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const t = await client.query(`SELECT * FROM pigeon_trades WHERE id=$1 AND status='open' FOR UPDATE`, [tradeId]);
    if (!t.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "gone" }; }
    const tr = t.rows[0];
    if (Number(tr.from_chat) === chatId) { await client.query("ROLLBACK"); return { ok: false, reason: "own" }; }
    if (tr.to_chat != null && Number(tr.to_chat) !== chatId) { await client.query("ROLLBACK"); return { ok: false, reason: "not_addressed" }; }
    // канонический порядок блокировок инвентаря — против AB-BA дедлока встречных обменов
    await client.query(
      `SELECT 1 FROM pigeon_inventory
        WHERE (chat_id, breed) IN (($1,$2),($1,$3),($4,$5))
        ORDER BY chat_id, breed
          FOR UPDATE`,
      [chatId, tr.want, tr.give, Number(tr.from_chat), tr.want]);
    // акцептор отдаёт want (тоже только дубликат)
    const pay = await client.query(
      `UPDATE pigeon_inventory SET count = count - 1 WHERE chat_id=$1 AND breed=$2 AND count>1 RETURNING 1`,
      [chatId, tr.want]);
    if (!pay.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "need_duplicate" }; }
    // Расчёт доплаты. coin>0: создатель доплатил (монеты в эскроу) → отдаём их акцептору.
    // coin<0: создатель просил доплату → акцептор платит |coin| создателю (проверяем баланс).
    // Блокируем строки clicker_state обоих в каноническом порядке (chat_id ASC) — против дедлока.
    const coin = Number(tr.coin_delta) || 0;
    let newBalance: number | undefined;
    if (coin !== 0) {
      await client.query(
        `SELECT 1 FROM clicker_state WHERE chat_id IN ($1,$2) ORDER BY chat_id FOR UPDATE`,
        [chatId, Number(tr.from_chat)]);
      if (coin > 0) {
        const cr = await client.query(`UPDATE clicker_state SET balance = balance + $2 WHERE chat_id=$1 RETURNING balance`, [chatId, coin]);
        if (cr.rowCount) newBalance = Number(cr.rows[0].balance);
      } else {
        const owe = -coin;
        const dp = await client.query(
          `UPDATE clicker_state SET balance = balance - $2 WHERE chat_id=$1 AND balance >= $2 RETURNING balance`,
          [chatId, owe]);
        if (!dp.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "not_enough_coins" }; }
        newBalance = Number(dp.rows[0].balance);
        await client.query(`UPDATE clicker_state SET balance = balance + $2 WHERE chat_id=$1`, [Number(tr.from_chat), owe]);
      }
    }
    await grantPigeon(chatId, tr.give, client);               // акцептору — эскроу-птица
    await grantPigeon(Number(tr.from_chat), tr.want, client); // создателю — want
    await client.query(
      `UPDATE pigeon_trades SET status='done', closed_at=NOW(), closed_by=$2 WHERE id=$1`, [tradeId, chatId]);
    await client.query("COMMIT");
    return { ok: true, got: tr.give, gave: tr.want, newBalance };
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}

export async function cancelTrade(chatId: number, tradeId: number): Promise<{ ok: boolean; reason?: string; newBalance?: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const t = await client.query(
      `SELECT * FROM pigeon_trades WHERE id=$1 AND from_chat=$2 AND status='open' FOR UPDATE`, [tradeId, chatId]);
    if (!t.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "gone" }; }
    await grantPigeon(chatId, t.rows[0].give, client); // вернуть эскроу-птицу
    const backCoin = Number(t.rows[0].coin_delta) || 0;   // вернуть эскроу-монеты (только coin>0)
    let newBalance: number | undefined;
    if (backCoin > 0) {
      const r = await client.query(`UPDATE clicker_state SET balance = balance + $2 WHERE chat_id=$1 RETURNING balance`, [chatId, backCoin]);
      if (r.rowCount) newBalance = Number(r.rows[0].balance);
    }
    await client.query(`UPDATE pigeon_trades SET status='cancelled', closed_at=NOW() WHERE id=$1`, [tradeId]);
    await client.query("COMMIT");
    return { ok: true, newBalance };
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}

export async function declineTrade(chatId: number, tradeId: number): Promise<{ ok: boolean; reason?: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const t = await client.query(
      `SELECT * FROM pigeon_trades WHERE id=$1 AND to_chat=$2 AND status='open' FOR UPDATE`, [tradeId, chatId]);
    if (!t.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "gone" }; }
    const tr = t.rows[0];
    await grantPigeon(Number(tr.from_chat), tr.give, client); // вернуть эскроу-птицу создателю
    const backCoin = Number(tr.coin_delta) || 0;
    if (backCoin > 0) await client.query(`UPDATE clicker_state SET balance = balance + $2 WHERE chat_id=$1`, [Number(tr.from_chat), backCoin]);
    await client.query(`UPDATE pigeon_trades SET status='declined', closed_at=NOW(), closed_by=$2 WHERE id=$1`, [tradeId, chatId]);
    await client.query("COMMIT");
    return { ok: true };
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}
// Ленивый expiry: при каждом чтении доски возвращаем эскроу протухших. Курсивно малый объём — норм.
export async function expireTrades(): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const old = await client.query(
      `SELECT id, from_chat, give, coin_delta FROM pigeon_trades
       WHERE status='open' AND created_at < NOW() - INTERVAL '${TRADE_TTL_DAYS} days' FOR UPDATE SKIP LOCKED`);
    for (const r of old.rows) {
      await grantPigeon(Number(r.from_chat), r.give, client);
      const backCoin = Number(r.coin_delta) || 0; // вернуть эскроу-монеты создателю (coin>0)
      if (backCoin > 0) await client.query(`UPDATE clicker_state SET balance = balance + $2 WHERE chat_id=$1`, [Number(r.from_chat), backCoin]);
      await client.query(`UPDATE pigeon_trades SET status='expired', closed_at=NOW() WHERE id=$1`, [r.id]);
    }
    await client.query("COMMIT");
    return old.rowCount ?? 0;
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}

export interface TradeRow {
  id: number;
  from_chat: number;
  fromName: string;
  give: string;
  want: string;
  coinDelta: number; // >0 создатель доплачивает, <0 создатель просит доплату, 0 чистый своп
  created_at: string;
}

export async function getTradeBoard(chatId: number):
  Promise<{ open: TradeRow[]; toMe: TradeRow[]; mine: TradeRow[] }> {
  await expireTrades();
  const rows = async (where: string, params: any[]): Promise<TradeRow[]> => {
    const result = await pool.query(
      `SELECT t.id, t.from_chat, t.to_chat, t.give, t.want, t.coin_delta, t.created_at, s.first_name, s.username
       FROM pigeon_trades t LEFT JOIN subscribers s ON s.chat_id = t.from_chat
       WHERE t.status='open' AND ${where}
       ORDER BY t.created_at DESC LIMIT 50`, params);
    return result.rows.map((r: any) => ({
      id: Number(r.id),
      from_chat: Number(r.from_chat),
      fromName: (r.first_name || r.username || "Котовод").toString().slice(0, 24),
      give: r.give,
      want: r.want,
      coinDelta: Number(r.coin_delta) || 0,
      created_at: r.created_at,
    }));
  };
  return {
    open: await rows(`t.to_chat IS NULL AND t.from_chat<>$1`, [chatId]),
    toMe: await rows(`t.to_chat=$1`, [chatId]),
    mine: await rows(`t.from_chat=$1`, [chatId]),
  };
}

// ── Почта ──────────────────────────────────────────────────────────────────
// «Активен 7 дней»: clicker_state.updated_at — обновляется в clicker.ts::refresh()
// на КАЖДОМ игровом запросе (тап/дейлик/буст/…), т.е. это де-факто «последняя
// активность в игре». Отдельного updated_at-подобного поля искать не пришлось —
// это поле уже есть в схеме (initClickerSchema, clicker.ts:244) и семантически
// точно то, что нужно. Тот же сигнал уже использует clicker-push.ts:52-53 для
// «уснул 16ч…4д назад» — переиспользуем тот же критерий активности.
const MAIL_ACTIVE_WINDOW = "7 days";

// Имя юзера в Markdown-пуше — режем метасимволы (ссылки-фишинг [x](url), битый
// парсинг *_`~). Вынесено из sendMail в экспорт ради юнит-тестов
// (tests/markdown.test.ts) — поведение байт-в-байт прежнее.
export function escapePushName(name: string): string {
  return name.replace(/[\[\]()_*\x60~]/g, "");
}

export interface MailRow {
  id: number;
  from_chat: number;
  fromName: string;
  breed: string;
  sticker: number;
  thanksSticker: number | null;
  sentAt: string;
  seenAt: string | null;
}

export async function sendMail(
  chatId: number,
  breed: string,
  to: number | "random" | "squad" | "ref",
  sticker: number,
  push?: PushService,
): Promise<{ ok: boolean; toChat?: number; reason?: string }> {
  if (!BREED_BY_ID.has(breed)) return { ok: false, reason: "bad_breed" };
  if (!Number.isInteger(sticker) || sticker < 0 || sticker >= STICKERS.length) return { ok: false, reason: "bad_sticker" };
  const byPreset = to === "random" || to === "squad" || to === "ref";
  if (!byPreset && !Number.isInteger(to)) return { ok: false, reason: "bad_input" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // сериализация sendMail на пользователя — тот же класс TOCTOU, что и createTrade:
    // без лока два параллельных запроса могут оба проскочить проверку лимита 1/день
    // до того, как первый закоммитит свою запись в pigeon_mail.
    await client.query(`SELECT pg_advisory_xact_lock($1)`, [chatId]);
    // лимит 1/день по Иркутску. todayIrkutsk — ленивый импорт (см. комментарий у
    // currentWeekKey выше): по конвенции модулей все связи clicker↔pigeons ленивые.
    const { todayIrkutsk } = await import("./clicker");
    const today = todayIrkutsk();
    const sent = await client.query(
      `SELECT 1 FROM pigeon_mail WHERE from_chat=$1 AND (sent_at AT TIME ZONE 'Asia/Irkutsk')::date = $2 LIMIT 1`,
      [chatId, today]);
    if (sent.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "daily_limit" }; }

    let toChat: number;
    if (byPreset) {
      let cand;
      if (to === "random") {
        cand = await client.query(
          `SELECT chat_id FROM clicker_state WHERE chat_id<>$1 AND updated_at > NOW() - INTERVAL '${MAIL_ACTIVE_WINDOW}'
           ORDER BY random() LIMIT 1`, [chatId]);
      } else if (to === "squad") {
        const sq = await client.query(`SELECT squad FROM clicker_state WHERE chat_id=$1`, [chatId]);
        const squad = sq.rows[0]?.squad ?? null;
        if (!squad) { await client.query("ROLLBACK"); return { ok: false, reason: "no_squad" }; }
        cand = await client.query(
          `SELECT chat_id FROM clicker_state WHERE squad=$2 AND chat_id<>$1 AND updated_at > NOW() - INTERVAL '${MAIL_ACTIVE_WINDOW}'
           ORDER BY random() LIMIT 1`, [chatId, squad]);
      } else {
        // "ref" — оба направления реф-связи: мои приглашённые (referred_by = я)
        // И мой реферер (мой clicker_state.referred_by). registerRef пишет
        // referred_by = chat_id пригласившего.
        cand = await client.query(
          `SELECT chat_id FROM clicker_state
            WHERE (referred_by=$1 OR chat_id = (SELECT referred_by FROM clicker_state WHERE chat_id=$1))
              AND chat_id<>$1 AND updated_at > NOW() - INTERVAL '${MAIL_ACTIVE_WINDOW}'
            ORDER BY random() LIMIT 1`, [chatId]);
      }
      if (!cand.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "no_players" }; }
      toChat = Number(cand.rows[0].chat_id);
    } else {
      toChat = to as number;
      if (toChat === chatId) { await client.query("ROLLBACK"); return { ok: false, reason: "self" }; }
      const ex = await client.query(`SELECT 1 FROM clicker_state WHERE chat_id=$1`, [toChat]);
      if (!ex.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "no_player" }; }
    }

    // эскроу: только дубликат (count>1), как в createTrade — базовую единственную птицу не отдать
    const esc = await client.query(
      `UPDATE pigeon_inventory SET count=count-1 WHERE chat_id=$1 AND breed=$2 AND count>1 RETURNING 1`,
      [chatId, breed]);
    if (!esc.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "need_duplicate" }; }
    await grantPigeon(toChat, breed, client);
    await client.query(
      `INSERT INTO pigeon_mail (from_chat, to_chat, breed, sticker) VALUES ($1,$2,$3,$4)`,
      [chatId, toChat, breed, sticker]);
    await client.query("COMMIT");

    // Пуш получателю — неблокирующий: почта уже доставлена и закоммичена, ошибка
    // пуша не должна портить успешный ответ sendMail. Канал переиспользован из
    // clicker-push.ts/pet-push.ts: push.sendPushSafely(chatId, "marketing_game", text)
    // уже реализует дедуп/тихие часы/квоты (kind=marketing_game — тот же, что у
    // игровых пушей возврата). Своей записи дедупа здесь не нужно: sendPushSafely
    // сама режет через canSendNotification (общий кап 5/сутки, тихие часы 22–9 Иркутск).
    if (push) {
      void (async () => {
        try {
          const nameRow = await pool.query(
            `SELECT first_name, username FROM subscribers WHERE chat_id=$1`, [chatId]);
          const rawName = (nameRow.rows[0]?.first_name || nameRow.rows[0]?.username || "Котовод")
            .toString().slice(0, 24);
          // имя юзера в Markdown-пуше — режем метасимволы (ссылки-фишинг, битый парсинг)
          const safeName = escapePushName(rawName);
          const breedName = BREED_BY_ID.get(breed)!.name;
          const text = `🕊 Тебе прилетел голубь! ${safeName} отправил тебе «${breedName}» — загляни в голубятню.`
            + `\n\n[Открыть голубятню](${miniAppLink(toChat, "click")})`;
          await push.sendPushSafely(toChat, "marketing_game", text);
        } catch (e) {
          log.warn({ err: e, chatId, toChat }, "[pigeon mail push]");
        }
      })();
    }

    return { ok: true, toChat };
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}

// getInbox: последние 30 писем + автопометка прочтения ТОЛЬКО показанных строк —
// непрочитанное за пределами топ-30 остаётся unread (иначе оно стало бы навсегда
// невидимым: пометилось бы seen, не попав ни в одну выдачу). SELECT идёт ДО UPDATE,
// чтобы вернуть клиенту исходный seenAt (null → «новое») до пометки прочитанным.
export async function getInbox(chatId: number): Promise<{ mail: MailRow[] }> {
  const result = await pool.query(
    `SELECT m.id, m.from_chat, m.breed, m.sticker, m.thanks_sticker, m.sent_at, m.seen_at,
            s.first_name, s.username
       FROM pigeon_mail m LEFT JOIN subscribers s ON s.chat_id = m.from_chat
      WHERE m.to_chat=$1
      ORDER BY m.sent_at DESC LIMIT 30`, [chatId]);
  const unseenIds = result.rows.filter((r: any) => r.seen_at == null).map((r: any) => Number(r.id));
  if (unseenIds.length) {
    await pool.query(`UPDATE pigeon_mail SET seen_at=NOW() WHERE id = ANY($1) AND seen_at IS NULL`, [unseenIds]);
  }
  const mail: MailRow[] = result.rows.map((r: any) => ({
    id: Number(r.id),
    from_chat: Number(r.from_chat),
    fromName: (r.first_name || r.username || "Котовод").toString().slice(0, 24),
    breed: r.breed,
    sticker: Number(r.sticker),
    thanksSticker: r.thanks_sticker == null ? null : Number(r.thanks_sticker),
    sentAt: r.sent_at,
    seenAt: r.seen_at,
  }));
  return { mail };
}

export async function thankMail(chatId: number, mailId: number, sticker: number):
  Promise<{ ok: boolean; reason?: string }> {
  if (!Number.isInteger(sticker) || sticker < 0 || sticker >= STICKERS.length) return { ok: false, reason: "bad_sticker" };
  // Один UPDATE с условием в WHERE — атомарен сам по себе, отдельная транзакция/лок не нужны:
  // только письмо, адресованное МНЕ и ещё не поблагодарённое, может сматчиться и обновиться.
  const r = await pool.query(
    `UPDATE pigeon_mail SET thanks_sticker=$3 WHERE id=$1 AND to_chat=$2 AND thanks_sticker IS NULL RETURNING 1`,
    [mailId, chatId, sticker]);
  if (!r.rowCount) return { ok: false, reason: "not_found" };
  return { ok: true };
}

// getMailRecipients: однокомандцы (тот же squad) и рефералы — оба направления реф-связи
// (кого пригласил chatId И его собственный реферер), активные 7 дней — тот же критерий
// (updated_at), что и в sendMail(to="squad"|"ref"), чтобы список кандидатов совпадал
// с тем, кому реально можно отправить письмо.
// ── Друзья голубятни («код дружбы» ckfr_<id>, спека: почта 31.07): клик по ссылке
// = взаимное согласие, бот связывает пару. Пара хранится нормализованно (min,max).
const FRIENDS_LIMIT = 100;
export async function addFriend(chatId: number, otherId: number):
  Promise<{ ok: boolean; already?: boolean; reason?: string }> {
  if (!Number.isInteger(otherId) || otherId <= 0) return { ok: false, reason: "bad_input" };
  if (otherId === chatId) return { ok: false, reason: "self" };
  const a = Math.min(chatId, otherId), b = Math.max(chatId, otherId);
  const cnt = await pool.query(
    `SELECT COUNT(*)::int AS n FROM pigeon_friends WHERE chat_a=$1 OR chat_b=$1`, [chatId]);
  if (Number(cnt.rows[0].n) >= FRIENDS_LIMIT) return { ok: false, reason: "limit" };
  const ins = await pool.query(
    `INSERT INTO pigeon_friends (chat_a, chat_b) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING 1`, [a, b]);
  return { ok: true, already: !ins.rowCount };
}

export async function getMailRecipients(chatId: number):
  Promise<{ squad: { chat: number; name: string }[]; refs: { chat: number; name: string }[]; friends: { chat: number; name: string }[]; friendLink: string }> {
  const mapRows = (rows: any[]) => rows.map((r: any) => ({
    chat: Number(r.chat_id),
    name: (r.first_name || r.username || "Котовод").toString().slice(0, 24),
    username: r.username ? String(r.username).replace(/^@/, "").slice(0, 32) : null,
  }));
  const sq = await pool.query(`SELECT squad FROM clicker_state WHERE chat_id=$1`, [chatId]);
  const squad = sq.rows[0]?.squad ?? null;
  let squadRows: any[] = [];
  if (squad) {
    const r = await pool.query(
      `SELECT c.chat_id, s.first_name, s.username
         FROM clicker_state c LEFT JOIN subscribers s ON s.chat_id = c.chat_id
        WHERE c.squad=$1 AND c.chat_id<>$2 AND c.updated_at > NOW() - INTERVAL '${MAIL_ACTIVE_WINDOW}'
        LIMIT 20`, [squad, chatId]);
    squadRows = r.rows;
  }
  // Рефералы = оба направления связи: мои приглашённые (referred_by = я) И мой
  // реферер (мой clicker_state.referred_by) — одной группой «Рефералы» для UI.
  // Тот же критерий, что в sendMail(to="ref").
  const refR = await pool.query(
    `SELECT c.chat_id, s.first_name, s.username
       FROM clicker_state c LEFT JOIN subscribers s ON s.chat_id = c.chat_id
      WHERE (c.referred_by=$1 OR c.chat_id = (SELECT referred_by FROM clicker_state WHERE chat_id=$1))
        AND c.chat_id<>$1 AND c.updated_at > NOW() - INTERVAL '${MAIL_ACTIVE_WINDOW}'
      LIMIT 20`, [chatId]);
  // Друзья по «коду дружбы» — без окна активности (дружба явная, не протухает в списке)
  const frR = await pool.query(
    `SELECT f.other AS chat_id, s.first_name, s.username
       FROM (SELECT CASE WHEN chat_a=$1 THEN chat_b ELSE chat_a END AS other
               FROM pigeon_friends WHERE chat_a=$1 OR chat_b=$1) f
       LEFT JOIN subscribers s ON s.chat_id = f.other
      LIMIT 50`, [chatId]);
  const explicit = mapRows(frR.rows);
  // «Друзья» в UI — все реальные знакомые игроки: добавленные по ссылке, прямые
  // рефералы и активные участники своей стаи. Дедуп по chat_id, явная дружба первая.
  const friends = [...explicit, ...mapRows(refR.rows), ...mapRows(squadRows)].filter((r, i, all) =>
    all.findIndex(x => x.chat === r.chat) === i).slice(0, 100);
  const { clickerFriendLink } = await import("./links");
  return { squad: mapRows(squadRows), refs: mapRows(refR.rows), friends, friendLink: clickerFriendLink(chatId) };
}

// ── Тюнинг гонщика (операции с БД) ──────────────────────────────────────────
const STAT_COL: Record<TuneStat, string> = { speed: "tune_speed", stamina: "tune_stamina", luck: "tune_luck" };

export async function getTuning(chatId: number, breed: string): Promise<{
  owned: boolean; speed: number; stamina: number; luck: number; powerRating: number;
  division: Division; nextCost: Record<TuneStat, number | null>; balance: number; passivePerHour: number;
}> {
  const [inv, bal] = await Promise.all([
    pool.query(`SELECT stars, tune_speed, tune_stamina, tune_luck FROM pigeon_inventory WHERE chat_id=$1 AND breed=$2 AND count>0`, [chatId, breed]),
    pool.query(`SELECT balance FROM clicker_state WHERE chat_id=$1`, [chatId]),
  ]);
  const speed = inv.rows[0]?.tune_speed ?? 0, stamina = inv.rows[0]?.tune_stamina ?? 0, luck = inv.rows[0]?.tune_luck ?? 0;
  const power = speed + stamina + luck;
  return {
    owned: !!inv.rowCount, speed, stamina, luck, powerRating: power, division: raceDivision(power),
    nextCost: { speed: tuneCost(speed), stamina: tuneCost(stamina), luck: tuneCost(luck) },
    balance: bal.rows[0] ? Number(bal.rows[0].balance) : 0,
    passivePerHour: inv.rowCount ? pigeonPassiveValue(breed, Number(inv.rows[0].stars), speed, stamina, luck) : 0,
  };
}

// Прокачка одной характеристики: списание монет + инкремент уровня в одной транзакции.
export async function upgradeTune(chatId: number, breed: string, stat: string):
  Promise<{ ok: boolean; level?: number; spent?: number; reason?: string }> {
  if (!TUNE_STATS.includes(stat as TuneStat)) return { ok: false, reason: "bad_stat" };
  const col = STAT_COL[stat as TuneStat];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inv = await client.query(
      `SELECT ${col} AS lvl FROM pigeon_inventory WHERE chat_id=$1 AND breed=$2 AND count>0 FOR UPDATE`,
      [chatId, breed]);
    if (!inv.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "not_owned" }; }
    const level = inv.rows[0].lvl;
    const cost = tuneCost(level);
    if (cost == null) { await client.query("ROLLBACK"); return { ok: false, reason: "max_level" }; }
    // списываем монеты только если хватает (атомарно через условный UPDATE баланса)
    const pay = await client.query(
      `UPDATE clicker_state SET balance = balance - $2 WHERE chat_id=$1 AND balance >= $2 RETURNING 1`,
      [chatId, cost]);
    if (!pay.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "not_enough_coins" }; }
    await client.query(`UPDATE pigeon_inventory SET ${col} = ${col} + 1 WHERE chat_id=$1 AND breed=$2`, [chatId, breed]);
    await client.query("COMMIT");
    return { ok: true, level: level + 1, spent: cost };
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}

// ── Гонка стаи ────────────────────────────────────────────────────────────
// Флаг: гонка выключена по умолчанию (v1 фичи почты/обменов/сетов не зависят от неё).
export const RACE_ENABLED = process.env.PIGEON_RACE_ENABLED === "true";

// Очки за отборочный полёт при заявке (v2, спека 2026-07-30-drag-launch-mechanic-v2):
// launch-skill 0..1 → 0..12 очков. Меньше ролла удачи (0..23) и много меньше статов —
// полёт ощутим, но скриптер (+2-3 очка к честному хорошему) погоды не делает.
export const RACE_SKILL_PTS = 12;

// Текущая таблица дивизиона недели: топ-10 (breed+score, имена не светим) + моё место
// по полному списку. Отдаётся и в getRace (наблюдаемость недели), и из enterRace
// (клиент анимирует отборочный полёт против РЕАЛЬНЫХ заявок дивизиона).
async function divisionStandings(week: string, division: Division, chatId: number) {
  const [top, all] = await Promise.all([
    pool.query(
      `SELECT chat_id, breed, score FROM pigeon_race_entries WHERE week=$1 AND division=$2
       ORDER BY score DESC, entered_at ASC LIMIT 10`, [week, division]),
    pool.query(
      `SELECT chat_id, score FROM pigeon_race_entries WHERE week=$1 AND division=$2
       ORDER BY score DESC, entered_at ASC`, [week, division]),
  ]);
  const myIdx = all.rows.findIndex((r: any) => Number(r.chat_id) === chatId);
  return {
    standings: top.rows.map((r: any) => ({ breed: r.breed, score: Number(r.score), me: Number(r.chat_id) === chatId })),
    myPlace: myIdx >= 0 ? myIdx + 1 : null,
    total: all.rowCount ?? 0,
  };
}

// Конец текущей игровой недели (мс UTC) — формула weekMonday из clicker (Иркутск).
async function raceWeekEndsTs(): Promise<number> {
  const { weekMonday } = await import("./clicker");
  return (weekMonday() + 7) * 86400000 - 8 * 3600 * 1000;
}

// Заявка фиксирует очки И дивизион снапшотом (по текущим звёздам+тюнингу) — поздняя
// прокачка после заявки не перекидывает между лигами задним числом. Птица НЕ списывается,
// одна заявка на неделю (PK week,chat_id). skill01 — качество отборочного полёта (0..1),
// прилетает из клиента через launchSkill (клампы серверные, см. роут).
export async function enterRace(chatId: number, breed: string, skill01 = 0):
  Promise<{ ok: boolean; reason?: string; score?: number; division?: Division; standings?: any[]; myPlace?: number | null; total?: number; weekEndsTs?: number }> {
  if (!RACE_ENABLED) return { ok: false, reason: "disabled" };
  if (!BREED_BY_ID.has(breed)) return { ok: false, reason: "unknown_breed" };
  const inv = await pool.query(
    `SELECT stars, tune_speed, tune_stamina, tune_luck FROM pigeon_inventory WHERE chat_id=$1 AND breed=$2 AND count>0`,
    [chatId, breed]);
  if (!inv.rowCount) return { ok: false, reason: "not_owned" };
  const { stars, tune_speed, tune_stamina, tune_luck } = inv.rows[0];
  const skillPts = Math.round(Math.min(1, Math.max(0, Number(skill01) || 0)) * RACE_SKILL_PTS);
  const score = raceScore(breed, stars, tune_speed, tune_stamina, tune_luck, Math.random()) + skillPts;
  const division = raceDivision(tune_speed + tune_stamina + tune_luck);
  const week = await currentWeekKey();
  const ins = await pool.query(
    `INSERT INTO pigeon_race_entries (week, chat_id, breed, score, division) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (week, chat_id) DO NOTHING RETURNING 1`,
    [week, chatId, breed, score, division]);
  if (!ins.rowCount) return { ok: false, reason: "already" };
  const st = await divisionStandings(week, division, chatId);
  return { ok: true, score, division, ...st, weekEndsTs: await raceWeekEndsTs() };
}

export async function getRace(chatId: number) {
  const week = await currentWeekKey();
  const [mine, last, entrants] = await Promise.all([
    pool.query(`SELECT breed, division, score FROM pigeon_race_entries WHERE week=$1 AND chat_id=$2`, [week, chatId]),
    pool.query(`SELECT results FROM pigeon_race_winners ORDER BY week DESC LIMIT 1`),
    pool.query(`SELECT COUNT(*) AS n FROM pigeon_race_entries WHERE week=$1`, [week]),
  ]);
  const my = mine.rows[0];
  const st = my ? await divisionStandings(week, my.division as Division, chatId) : null;
  return {
    enabled: RACE_ENABLED, week, myBreed: my?.breed ?? null,
    myDivision: my?.division ?? null,
    myScore: my ? Number(my.score) : null,
    myPlace: st?.myPlace ?? null,
    divisionTotal: st?.total ?? null,
    standings: st?.standings ?? null,
    weekEndsTs: await raceWeekEndsTs(),
    entrants: Number(entrants.rows[0].n), lastResults: last.rows[0]?.results ?? null,
  };
}

// Закрытие прошедшей недели. Заявки группируются по дивизиону, в каждом — свой топ-3
// с призами DIVISION_PRIZES; порода «Чемпион» — только победителю Золота. Идемпотентно:
// мьютекс-строка в pigeon_race_winners (INSERT ... ON CONFLICT DO NOTHING RETURNING 1)
// гарантирует, что только один параллельный прогон крона реально начислит призы.
export async function closeRaceWeek(): Promise<{ week: string; entries: number; closed: boolean }> {
  const prevWeek = await previousWeekKey();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const mutex = await client.query(
      `INSERT INTO pigeon_race_winners (week, results) VALUES ($1,'{}'::jsonb) ON CONFLICT DO NOTHING RETURNING 1`, [prevWeek]);
    if (!mutex.rowCount) { await client.query("ROLLBACK"); return { week: prevWeek, entries: 0, closed: false }; }
    const { addClickerBalance } = await import("./clicker");
    const results: Record<Division, any[]> = { bronze: [], silver: [], gold: [] };
    let total = 0;
    for (const div of ["bronze", "silver", "gold"] as Division[]) {
      const top = await client.query(
        `SELECT chat_id, breed, score FROM pigeon_race_entries WHERE week=$1 AND division=$2
         ORDER BY score DESC, entered_at ASC LIMIT 3`, [prevWeek, div]);
      const prizes = DIVISION_PRIZES[div];
      for (let i = 0; i < top.rows.length; i++) {
        await addClickerBalance(Number(top.rows[i].chat_id), prizes[i], client);
        results[div].push({ place: i + 1, chat: Number(top.rows[i].chat_id), breed: top.rows[i].breed, score: top.rows[i].score, prize: prizes[i] });
      }
      total += top.rows.length;
    }
    await client.query(`UPDATE pigeon_race_winners SET results=$2 WHERE week=$1`, [prevWeek, JSON.stringify(results)]);
    await client.query("COMMIT");
    return { week: prevWeek, entries: total, closed: true };
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}

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

// 4 сета × 4 + «Чемпион» вне сетов (только приз гонки)
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
  { id: "champion", name: "Чемпион",            set: "",      rarity: "legendary" }, // не дропается
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
    CREATE TABLE IF NOT EXISTS pigeon_race_entries (
      week TEXT NOT NULL, chat_id BIGINT NOT NULL, breed TEXT NOT NULL,
      score INT, entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (week, chat_id));
    CREATE TABLE IF NOT EXISTS pigeon_race_winners (
      week TEXT PRIMARY KEY, results JSONB NOT NULL, closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
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
  const [inv, claimed, mail] = await Promise.all([
    pool.query(`SELECT breed, count, stars, showcase FROM pigeon_inventory WHERE chat_id=$1 AND count>0`, [chatId]),
    pool.query(`SELECT set_id FROM pigeon_sets_claimed WHERE chat_id=$1`, [chatId]),
    pool.query(`SELECT COUNT(*) AS n FROM pigeon_mail WHERE to_chat=$1 AND seen_at IS NULL`, [chatId]),
  ]);
  const owned = new Set(inv.rows.map((r: any) => r.breed));
  const claimedSet = new Set(claimed.rows.map((r: any) => r.set_id));
  const sets = PIGEON_SETS.map(s => ({
    ...s,
    owned: PIGEON_BREEDS.filter(b => b.set === s.id && owned.has(b.id)).length,
    claimed: claimedSet.has(s.id),
  }));
  return {
    inventory: inv.rows, sets,
    albumDone: [...owned].filter(b => b !== "champion").length >= 16,
    unreadMail: Number(mail.rows[0].n),
    weekBreed: breedOfWeek(await currentWeekKey()),
  };
}

// claimSet: строка-мьютекс + монеты в одной транзакции (паттерн clicker_gifts).
export async function claimSet(chatId: number, setId: string):
  Promise<{ ok: boolean; reward?: number; reason?: string }> {
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
    await client.query("COMMIT");
    return { ok: true, reward: set.reward };
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

export async function createTrade(chatId: number, give: string, want: string, to?: number):
  Promise<{ ok: boolean; id?: number; reason?: string }> {
  if (!BREED_BY_ID.has(give) || !BREED_BY_ID.has(want) || give === want) return { ok: false, reason: "bad_input" };
  if (to === chatId) return { ok: false, reason: "self" };
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
    const ins = await client.query(
      `INSERT INTO pigeon_trades (from_chat, to_chat, give, want) VALUES ($1,$2,$3,$4) RETURNING id`,
      [chatId, to ?? null, give, want]);
    await client.query("COMMIT");
    return { ok: true, id: ins.rows[0].id };
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}

export async function acceptTrade(chatId: number, tradeId: number):
  Promise<{ ok: boolean; got?: string; gave?: string; reason?: string }> {
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
    await grantPigeon(chatId, tr.give, client);               // акцептору — эскроу-птица
    await grantPigeon(Number(tr.from_chat), tr.want, client); // создателю — want
    await client.query(
      `UPDATE pigeon_trades SET status='done', closed_at=NOW(), closed_by=$2 WHERE id=$1`, [tradeId, chatId]);
    await client.query("COMMIT");
    return { ok: true, got: tr.give, gave: tr.want };
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}

export async function cancelTrade(chatId: number, tradeId: number): Promise<{ ok: boolean; reason?: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const t = await client.query(
      `SELECT * FROM pigeon_trades WHERE id=$1 AND from_chat=$2 AND status='open' FOR UPDATE`, [tradeId, chatId]);
    if (!t.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "gone" }; }
    await grantPigeon(chatId, t.rows[0].give, client); // вернуть эскроу
    await client.query(`UPDATE pigeon_trades SET status='cancelled', closed_at=NOW() WHERE id=$1`, [tradeId]);
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
      `SELECT id, from_chat, give FROM pigeon_trades
       WHERE status='open' AND created_at < NOW() - INTERVAL '${TRADE_TTL_DAYS} days' FOR UPDATE SKIP LOCKED`);
    for (const r of old.rows) {
      await grantPigeon(Number(r.from_chat), r.give, client);
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
  created_at: string;
}

export async function getTradeBoard(chatId: number):
  Promise<{ open: TradeRow[]; toMe: TradeRow[]; mine: TradeRow[] }> {
  await expireTrades();
  const rows = async (where: string, params: any[]): Promise<TradeRow[]> => {
    const result = await pool.query(
      `SELECT t.id, t.from_chat, t.to_chat, t.give, t.want, t.created_at, s.first_name, s.username
       FROM pigeon_trades t LEFT JOIN subscribers s ON s.chat_id = t.from_chat
       WHERE t.status='open' AND ${where}
       ORDER BY t.created_at DESC LIMIT 50`, params);
    return result.rows.map((r: any) => ({
      id: Number(r.id),
      from_chat: Number(r.from_chat),
      fromName: (r.first_name || r.username || "Котовод").toString().slice(0, 24),
      give: r.give,
      want: r.want,
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
export async function getMailRecipients(chatId: number):
  Promise<{ squad: { chat: number; name: string }[]; refs: { chat: number; name: string }[] }> {
  const mapRows = (rows: any[]) => rows.map((r: any) => ({
    chat: Number(r.chat_id),
    name: (r.first_name || r.username || "Котовод").toString().slice(0, 24),
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
  return { squad: mapRows(squadRows), refs: mapRows(refR.rows) };
}

// ── Тюнинг гонщика (операции с БД) ──────────────────────────────────────────
const STAT_COL: Record<TuneStat, string> = { speed: "tune_speed", stamina: "tune_stamina", luck: "tune_luck" };

export async function getTuning(chatId: number, breed: string): Promise<{
  owned: boolean; speed: number; stamina: number; luck: number; powerRating: number;
  division: Division; nextCost: Record<TuneStat, number | null>; balance: number;
}> {
  const [inv, bal] = await Promise.all([
    pool.query(`SELECT tune_speed, tune_stamina, tune_luck FROM pigeon_inventory WHERE chat_id=$1 AND breed=$2 AND count>0`, [chatId, breed]),
    pool.query(`SELECT balance FROM clicker_state WHERE chat_id=$1`, [chatId]),
  ]);
  const speed = inv.rows[0]?.tune_speed ?? 0, stamina = inv.rows[0]?.tune_stamina ?? 0, luck = inv.rows[0]?.tune_luck ?? 0;
  const power = speed + stamina + luck;
  return {
    owned: !!inv.rowCount, speed, stamina, luck, powerRating: power, division: raceDivision(power),
    nextCost: { speed: tuneCost(speed), stamina: tuneCost(stamina), luck: tuneCost(luck) },
    balance: bal.rows[0] ? Number(bal.rows[0].balance) : 0,
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

// Заявка фиксирует очки И дивизион снапшотом (по текущим звёздам+тюнингу) — поздняя
// прокачка после заявки не перекидывает между лигами задним числом. Птица НЕ списывается,
// одна заявка на неделю (PK week,chat_id).
export async function enterRace(chatId: number, breed: string): Promise<{ ok: boolean; reason?: string }> {
  if (!RACE_ENABLED) return { ok: false, reason: "disabled" };
  if (!BREED_BY_ID.has(breed)) return { ok: false, reason: "unknown_breed" };
  const inv = await pool.query(
    `SELECT stars, tune_speed, tune_stamina, tune_luck FROM pigeon_inventory WHERE chat_id=$1 AND breed=$2 AND count>0`,
    [chatId, breed]);
  if (!inv.rowCount) return { ok: false, reason: "not_owned" };
  const { stars, tune_speed, tune_stamina, tune_luck } = inv.rows[0];
  const score = raceScore(breed, stars, tune_speed, tune_stamina, tune_luck, Math.random());
  const division = raceDivision(tune_speed + tune_stamina + tune_luck);
  const week = await currentWeekKey();
  const ins = await pool.query(
    `INSERT INTO pigeon_race_entries (week, chat_id, breed, score, division) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (week, chat_id) DO NOTHING RETURNING 1`,
    [week, chatId, breed, score, division]);
  return ins.rowCount ? { ok: true } : { ok: false, reason: "already" };
}

export async function getRace(chatId: number) {
  const week = await currentWeekKey();
  const [mine, last, entrants] = await Promise.all([
    pool.query(`SELECT breed, division FROM pigeon_race_entries WHERE week=$1 AND chat_id=$2`, [week, chatId]),
    pool.query(`SELECT results FROM pigeon_race_winners ORDER BY week DESC LIMIT 1`),
    pool.query(`SELECT COUNT(*) AS n FROM pigeon_race_entries WHERE week=$1`, [week]),
  ]);
  return {
    enabled: RACE_ENABLED, week, myBreed: mine.rows[0]?.breed ?? null,
    myDivision: mine.rows[0]?.division ?? null,
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
      // Чемпион — только победителю Золота
      if (div === "gold" && top.rows.length) await grantPigeon(Number(top.rows[0].chat_id), "champion", client);
      total += top.rows.length;
    }
    await client.query(`UPDATE pigeon_race_winners SET results=$2 WHERE week=$1`, [prevWeek, JSON.stringify(results)]);
    await client.query("COMMIT");
    return { week: prevWeek, entries: total, closed: true };
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}

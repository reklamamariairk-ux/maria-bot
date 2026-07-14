// src/pigeons.ts — «Голубиная почта»: коллекция пород, обмены, почта, гонка.
// Спека: docs/superpowers/specs/2026-07-14-pigeon-market-design.md
import { PoolClient } from "pg";
import { pool } from "./db";
import { weekKey } from "./clicker";

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
export function currentWeekKey(): string { return weekKey(); }

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

// Детерминированная «порода недели» от ключа недели (week = "2026-W29" из weekKey()).
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

// Гонка: очки = базис редкости + звёзды + рандом (новичок может выиграть).
const RARITY_BASE: Record<Rarity, number> = { common: 10, rare: 16, epic: 22, legendary: 28 };
export function raceScore(breedId: string, stars: number, r: number): number {
  const b = BREED_BY_ID.get(breedId); if (!b) return 0;
  return RARITY_BASE[b.rarity] + (stars - 1) * 4 + Math.floor(r * 40);
}

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
  return { breed: breedId, isNew: r.rows[0].count === 1 };
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
    weekBreed: breedOfWeek(currentWeekKey()),
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
    // Динамический импорт вместо статического: clicker.ts (Task 3) статически импортирует
    // pickBreed/grantPigeon из pigeons.ts — статический импорт addClickerBalance здесь создал
    // бы цикл require при старте процесса. await import(...) при module="commonjs" компилируется
    // в Promise-обёртку над require(), выполняемую лениво внутри тела функции — к этому моменту
    // оба модуля уже полностью инициализированы, цикл безопасен.
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

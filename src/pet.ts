/**
 * Виртуальный питомец «Котик Марии» (тамагочи) — серверное состояние.
 *
 * Потребности (0–100) падают в реальном времени; при чтении применяем decay.
 * Уход (feed/sleep/wash/play) поднимает потребности, даёт опыт и монеты.
 * Состояние персистится в Neon per chat_id (работает для TG и VK — internalId).
 */
import { pool } from "./db";
import { addClickerBalance } from "./clicker";

export type PetNeed = "hunger" | "mood" | "energy" | "hygiene";
export type PetAction = "feed" | "sleep" | "wash" | "play" | "walk";
export type PetLocation = "kitchen" | "bedroom" | "playroom" | "yard";

export interface PetState {
  hunger: number; mood: number; energy: number; hygiene: number;
  level: number; xp: number; xpNext: number; coins: number;
  careStreak: number;
  location: PetLocation;
  items?: { owned: string[]; equipped: string | null };
}

/** Каталог магазина (источник правды по ценам). */
export const SHOP: { id: string; name: string; price: number }[] = [
  { id: "detective", name: "Шапка сыщика", price: 120 },
  { id: "pirate",    name: "Пиратская шляпа", price: 180 },
  { id: "wizard",    name: "Колпак волшебника", price: 250 },
  { id: "crown",     name: "Корона", price: 400 },
];
const SHOP_IDS = new Set(SHOP.map((s) => s.id));

// падение потребностей, очков/час
const DECAY: Record<PetNeed, number> = { hunger: 6, mood: 4, energy: 3, hygiene: 2.5 };
// сколько потребность поднимает действие
const RESTORE: Record<PetAction, Partial<Record<PetNeed, number>>> = {
  feed:  { hunger: 45, mood: 8 },
  sleep: { energy: 55, mood: 5 },
  wash:  { hygiene: 60, mood: 5 },
  play:  { mood: 35, energy: -10 },
  walk:  { mood: 18, energy: -4 },
};
const XP_PER_ACTION = 12;
const LOCATIONS: PetLocation[] = ["kitchen", "bedroom", "playroom", "yard"];

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
const xpForNext = (level: number) => level * 100; // нужно опыта до следующего уровня

// День по Иркутску (UTC+8), YYYY-MM-DD — как irkToday()/claimDaily в clicker.ts.
const irkDay = (offsetDays = 0) =>
  new Date(Date.now() + 8 * 3600 * 1000 - offsetDays * 86400000).toISOString().slice(0, 10);
// Награда за день заботы (в общий кошелёк): день1=100 … день10+=1000. Параметр экономики.
const careStreakBonus = (streak: number) => 100 * Math.min(Math.max(1, streak), 10);

export async function initPetSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pet_state (
      chat_id    BIGINT PRIMARY KEY,
      hunger     INT NOT NULL DEFAULT 80,
      mood       INT NOT NULL DEFAULT 80,
      energy     INT NOT NULL DEFAULT 80,
      hygiene    INT NOT NULL DEFAULT 80,
      level      INT NOT NULL DEFAULT 1,
      xp         INT NOT NULL DEFAULT 0,
      coins      INT NOT NULL DEFAULT 0,
      location   TEXT NOT NULL DEFAULT 'kitchen',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS pet_items (
      chat_id     BIGINT NOT NULL,
      item        TEXT NOT NULL,
      equipped    BOOLEAN NOT NULL DEFAULT FALSE,
      acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (chat_id, item)
    );
    ALTER TABLE pet_state ADD COLUMN IF NOT EXISTS care_streak      INT NOT NULL DEFAULT 0;
    ALTER TABLE pet_state ADD COLUMN IF NOT EXISTS care_date        TEXT;
    ALTER TABLE pet_state ADD COLUMN IF NOT EXISTS pet_coins_merged BOOLEAN NOT NULL DEFAULT FALSE;
  `);
}

function toState(r: any): PetState {
  return {
    hunger: r.hunger, mood: r.mood, energy: r.energy, hygiene: r.hygiene,
    level: r.level, xp: r.xp, xpNext: xpForNext(r.level), coins: r.coins,
    careStreak: r.care_streak ?? 0,
    location: LOCATIONS.includes(r.location) ? r.location : "kitchen",
  };
}

async function getItems(chatId: number): Promise<{ owned: string[]; equipped: string | null }> {
  const { rows } = await pool.query(`SELECT item, equipped FROM pet_items WHERE chat_id=$1`, [chatId]);
  return {
    owned: rows.map((r) => r.item),
    equipped: (rows.find((r) => r.equipped) || {}).item ?? null,
  };
}

/** Чтение состояния с применением decay (и его персистом). Создаёт питомца при первом обращении. */
export async function getPet(chatId: number): Promise<PetState> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO pet_state (chat_id) VALUES ($1) ON CONFLICT (chat_id) DO NOTHING`, [chatId]);
    // строка кошелька кликера обязана существовать (для миграции и чтения баланса)
    await client.query(`INSERT INTO clicker_state (chat_id) VALUES ($1) ON CONFLICT (chat_id) DO NOTHING`, [chatId]);
    const { rows } = await client.query(`SELECT * FROM pet_state WHERE chat_id = $1 FOR UPDATE`, [chatId]);
    const r = rows[0];
    const hrs = Math.max(0, (Date.now() - new Date(r.updated_at).getTime()) / 3600000);
    if (hrs > 0.001) {
      r.hunger = clamp(r.hunger - DECAY.hunger * hrs);
      r.mood = clamp(r.mood - DECAY.mood * hrs);
      r.energy = clamp(r.energy - DECAY.energy * hrs);
      r.hygiene = clamp(r.hygiene - DECAY.hygiene * hrs);
      await client.query(
        `UPDATE pet_state SET hunger=$2, mood=$3, energy=$4, hygiene=$5, updated_at=NOW() WHERE chat_id=$1`,
        [chatId, r.hunger, r.mood, r.energy, r.hygiene]
      );
    }
    // одноразовая миграция старых pet_state.coins в общий кошелёк (атомарно, в этой же транзакции)
    if (!r.pet_coins_merged) {
      await addClickerBalance(chatId, r.coins, client); // no-op если coins<=0
      await client.query(`UPDATE pet_state SET coins = 0, pet_coins_merged = TRUE, updated_at=NOW() WHERE chat_id=$1`, [chatId]);
      r.coins = 0; r.pet_coins_merged = true;
    }
    const balRow = await client.query(`SELECT balance FROM clicker_state WHERE chat_id=$1`, [chatId]);
    await client.query("COMMIT");
    const state = toState(r);
    state.coins = Number(balRow.rows[0]?.balance ?? 0); // единый баланс
    state.items = await getItems(chatId);
    return state;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Купить предмет за монеты. */
export async function buyPetItem(chatId: number, id: string): Promise<{ ok: boolean; state?: PetState; reason?: string }> {
  const shopItem = SHOP.find((s) => s.id === id);
  if (!shopItem) return { ok: false, reason: "bad_item" };
  await getPet(chatId); // decay + миграция + строки
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const bal = await client.query(`SELECT balance FROM clicker_state WHERE chat_id=$1 FOR UPDATE`, [chatId]);
    const owned = await client.query(`SELECT 1 FROM pet_items WHERE chat_id=$1 AND item=$2`, [chatId, id]);
    if (owned.rows.length) { await client.query("ROLLBACK"); return { ok: false, reason: "already_owned" }; }
    if (Number(bal.rows[0]?.balance ?? 0) < shopItem.price) { await client.query("ROLLBACK"); return { ok: false, reason: "not_enough_coins" }; }
    await client.query(`UPDATE clicker_state SET balance = balance - $2, updated_at=NOW() WHERE chat_id=$1`, [chatId, shopItem.price]);
    await client.query(`INSERT INTO pet_items (chat_id, item, equipped) VALUES ($1,$2,FALSE) ON CONFLICT DO NOTHING`, [chatId, id]);
    await client.query("COMMIT");
    return { ok: true, state: await getPet(chatId) };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Надеть/снять предмет (только один надет одновременно; передать "" чтобы снять). */
export async function equipPetItem(chatId: number, id: string): Promise<{ ok: boolean; state?: PetState; reason?: string }> {
  if (id && !SHOP_IDS.has(id)) return { ok: false, reason: "bad_item" };
  if (id) {
    const owned = await pool.query(`SELECT 1 FROM pet_items WHERE chat_id=$1 AND item=$2`, [chatId, id]);
    if (!owned.rows.length) return { ok: false, reason: "not_owned" };
  }
  await pool.query(`UPDATE pet_items SET equipped = (item = $2) WHERE chat_id=$1`, [chatId, id || "__none__"]);
  return { ok: true, state: await getPet(chatId) };
}

/** Действие ухода: поднимает потребности, начисляет опыт, считает уровень и стрик заботы. */
export async function doPetAction(
  chatId: number, action: PetAction
): Promise<{ ok: boolean; state?: PetState; reason?: string; streakBonus?: number; careStreak?: number }> {
  if (!RESTORE[action]) return { ok: false, reason: "unknown_action" };
  await getPet(chatId); // применить decay + гарантировать миграцию/строки
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(`SELECT * FROM pet_state WHERE chat_id=$1 FOR UPDATE`, [chatId]);
    const r = rows[0];
    const delta = RESTORE[action];
    if (delta.hunger) r.hunger = clamp(r.hunger + delta.hunger);
    if (delta.mood) r.mood = clamp(r.mood + delta.mood);
    if (delta.energy) r.energy = clamp(r.energy + delta.energy);
    if (delta.hygiene) r.hygiene = clamp(r.hygiene + delta.hygiene);
    r.xp += XP_PER_ACTION;
    while (r.xp >= xpForNext(r.level)) { r.xp -= xpForNext(r.level); r.level += 1; }
    // стрик заботы: засчитываем 1 раз в сутки (первое действие ухода за день)
    const today = irkDay(0), yest = irkDay(1);
    let streakBonus = 0;
    if (r.care_date !== today) {
      r.care_streak = (r.care_date === yest) ? r.care_streak + 1 : 1;
      r.care_date = today;
      streakBonus = careStreakBonus(r.care_streak);
    }
    await client.query(
      `UPDATE pet_state SET hunger=$2,mood=$3,energy=$4,hygiene=$5,xp=$6,level=$7,
         care_streak=$8,care_date=$9,updated_at=NOW() WHERE chat_id=$1`,
      [chatId, r.hunger, r.mood, r.energy, r.hygiene, r.xp, r.level, r.care_streak, r.care_date]
    );
    await addClickerBalance(chatId, streakBonus, client); // no-op если streakBonus<=0; атомарно в этой транзакции
    const balRow = await client.query(`SELECT balance FROM clicker_state WHERE chat_id=$1`, [chatId]);
    await client.query("COMMIT");
    const state = toState(r);
    state.coins = Number(balRow.rows[0]?.balance ?? 0);
    state.items = await getItems(chatId);
    return { ok: true, state, streakBonus, careStreak: r.care_streak };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function setPetLocation(chatId: number, location: string): Promise<PetState> {
  const loc = (LOCATIONS as string[]).includes(location) ? location : "kitchen";
  await getPet(chatId);
  await pool.query(`UPDATE pet_state SET location=$2, updated_at=NOW() WHERE chat_id=$1`, [chatId, loc]);
  return getPet(chatId);
}

/** Начислить монеты (из мини-игр). */
export async function addPetCoins(chatId: number, coins: number): Promise<void> {
  if (coins <= 0) return;
  await pool.query(
    `INSERT INTO pet_state (chat_id, coins) VALUES ($1,$2)
     ON CONFLICT (chat_id) DO UPDATE SET coins = pet_state.coins + $2`,
    [chatId, Math.round(coins)]
  );
}

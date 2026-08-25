/**
 * Виртуальный питомец «Котик Марии» (тамагочи) — серверное состояние.
 *
 * Потребности (0–100) падают в реальном времени; при чтении применяем decay.
 * Уход (feed/sleep/wash/play) поднимает потребности, даёт опыт и монеты.
 * Состояние персистится в Neon per chat_id (работает для TG и VK — internalId).
 */
import type { PoolClient } from "pg";
import { pool } from "./db";
import { addClickerBalance, settleClickerBeforeIncomeChange } from "./clicker";

export type PetNeed = "hunger" | "mood" | "energy" | "hygiene";
export type PetAction = "feed" | "sleep" | "wash" | "play" | "walk";
export type PetLocation = "kitchen" | "bedroom" | "playroom" | "yard";

export interface PetState {
  hunger: number; mood: number; energy: number; hygiene: number;
  level: number; xp: number; xpNext: number; coins: number;
  revision?: number;
  careStreak: number;
  careStreakBest: number;
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
export function isPetLocation(value: unknown): value is PetLocation {
  return typeof value === "string" && (LOCATIONS as string[]).includes(value);
}

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
const xpForNext = (level: number) => level * 100; // нужно опыта до следующего уровня

export interface PetNeedSettlement { value: number; carry: number }
/** Накапливает дробный decay между чтениями, чтобы частые GET не замораживали потребность. */
export function settlePetNeed(current: number, decayPerHour: number, elapsedHours: number, previousCarry = 0): PetNeedSettlement {
  const value = clamp(Number(current) || 0);
  const rate = Math.max(0, Number.isFinite(decayPerHour) ? decayPerHour : 0);
  const hours = Math.max(0, Number.isFinite(elapsedHours) ? elapsedHours : 0);
  const carry = Number.isFinite(previousCarry) && previousCarry > 0 ? previousCarry % 1 : 0;
  const rawLoss = rate * hours + carry;
  const wholeLoss = Math.floor(rawLoss + 1e-9);
  const nextValue = Math.max(0, value - wholeLoss);
  if (nextValue <= 0) return { value: 0, carry: 0 };
  const nextCarry = rawLoss - wholeLoss;
  return { value: nextValue, carry: nextCarry < 1e-9 ? 0 : Math.min(0.999999999, nextCarry) };
}

// День по Иркутску (UTC+8), YYYY-MM-DD — как irkToday()/claimDaily в clicker.ts.
const irkDay = (offsetDays = 0) =>
  new Date(Date.now() + 8 * 3600 * 1000 - offsetDays * 86400000).toISOString().slice(0, 10);
/** Текущая серия для показа: пропущенный день обнуляет её ещё до нового действия. */
export function effectiveCareStreak(lastCareDate: unknown, storedStreak: unknown, today = irkDay()): number {
  const n = Math.max(0, Math.floor(Number(storedStreak) || 0));
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(todayMs)) return 0;
  const yesterday = new Date(todayMs - 86400000).toISOString().slice(0, 10);
  return lastCareDate === today || lastCareDate === yesterday ? n : 0;
}
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
    ALTER TABLE pet_state ADD COLUMN IF NOT EXISTS care_streak_best INT NOT NULL DEFAULT 0;
    ALTER TABLE pet_state ADD COLUMN IF NOT EXISTS hunger_carry DOUBLE PRECISION NOT NULL DEFAULT 0;
    ALTER TABLE pet_state ADD COLUMN IF NOT EXISTS mood_carry DOUBLE PRECISION NOT NULL DEFAULT 0;
    ALTER TABLE pet_state ADD COLUMN IF NOT EXISTS energy_carry DOUBLE PRECISION NOT NULL DEFAULT 0;
    ALTER TABLE pet_state ADD COLUMN IF NOT EXISTS hygiene_carry DOUBLE PRECISION NOT NULL DEFAULT 0;
  `);
  // backfill рекорда из текущего стрика (идемпотентно: только если рекорд отстал)
  await pool.query(`UPDATE pet_state SET care_streak_best = care_streak WHERE care_streak > care_streak_best`);
}

function toState(r: any): PetState {
  return {
    hunger: r.hunger, mood: r.mood, energy: r.energy, hygiene: r.hygiene,
    level: r.level, xp: r.xp, xpNext: xpForNext(r.level), coins: r.coins,
    careStreak: effectiveCareStreak(r.care_date, r.care_streak),
    careStreakBest: r.care_streak_best ?? 0,
    location: LOCATIONS.includes(r.location) ? r.location : "kitchen",
  };
}

async function getItems(chatId: number, db: Pick<PoolClient, "query"> = pool): Promise<{ owned: string[]; equipped: string | null }> {
  const { rows } = await db.query(`SELECT item, equipped FROM pet_items WHERE chat_id=$1`, [chatId]);
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
    // Общий кошелёк фиксируем первым: Дом должен показывать тот же баланс, включая
    // накопленный пассив, что и главный экран. Порядок clicker → pet единый для локов.
    await client.query(`INSERT INTO clicker_state (chat_id) VALUES ($1) ON CONFLICT (chat_id) DO NOTHING`, [chatId]);
    await settleClickerBeforeIncomeChange(client, chatId);
    await client.query(`INSERT INTO pet_state (chat_id) VALUES ($1) ON CONFLICT (chat_id) DO NOTHING`, [chatId]);
    const { rows } = await client.query(`SELECT * FROM pet_state WHERE chat_id = $1 FOR UPDATE`, [chatId]);
    const r = rows[0];
    const hrs = Math.max(0, (Date.now() - new Date(r.updated_at).getTime()) / 3600000);
    if (hrs > 0.001) {
      for (const need of ["hunger", "mood", "energy", "hygiene"] as PetNeed[]) {
        const settled = settlePetNeed(r[need], DECAY[need], hrs, r[`${need}_carry`]);
        r[need] = settled.value;
        r[`${need}_carry`] = settled.carry;
      }
      await client.query(
        `UPDATE pet_state SET hunger=$2, mood=$3, energy=$4, hygiene=$5,
           hunger_carry=$6, mood_carry=$7, energy_carry=$8, hygiene_carry=$9,
           updated_at=NOW() WHERE chat_id=$1`,
        [chatId, r.hunger, r.mood, r.energy, r.hygiene,
          r.hunger_carry, r.mood_carry, r.energy_carry, r.hygiene_carry]
      );
    }
    // одноразовая миграция старых pet_state.coins в общий кошелёк (атомарно, в этой же транзакции)
    if (!r.pet_coins_merged) {
      await addClickerBalance(chatId, r.coins, client); // no-op если coins<=0
      await client.query(`UPDATE pet_state SET coins = 0, pet_coins_merged = TRUE, updated_at=NOW() WHERE chat_id=$1`, [chatId]);
      r.coins = 0; r.pet_coins_merged = true;
    }
    const balRow = await client.query(`SELECT balance, state_revision FROM clicker_state WHERE chat_id=$1`, [chatId]);
    await client.query("COMMIT");
    const state = toState(r);
    state.coins = Number(balRow.rows[0]?.balance ?? 0); // единый баланс
    state.revision = Number(balRow.rows[0]?.state_revision ?? 0);
    // Читаем предметы тем же соединением. Вызов pool.query() до release() мог
    // исчерпать пул при десяти параллельных GET /api/pet.
    state.items = await getItems(chatId, client);
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
    await settleClickerBeforeIncomeChange(client, chatId);
    const bal = await client.query(`SELECT balance FROM clicker_state WHERE chat_id=$1 FOR UPDATE`, [chatId]);
    const owned = await client.query(`SELECT 1 FROM pet_items WHERE chat_id=$1 AND item=$2`, [chatId, id]);
    if (owned.rows.length) { await client.query("ROLLBACK"); return { ok: false, reason: "already_owned" }; }
    if (Number(bal.rows[0]?.balance ?? 0) < shopItem.price) { await client.query("ROLLBACK"); return { ok: false, reason: "not_enough_coins" }; }
    await client.query(`UPDATE clicker_state SET balance = balance - $2, state_revision=state_revision+1, updated_at=NOW() WHERE chat_id=$1`, [chatId, shopItem.price]);
    await client.query(`INSERT INTO pet_items (chat_id, item, equipped) VALUES ($1,$2,FALSE) ON CONFLICT DO NOTHING`, [chatId, id]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  // getPet открывает своё соединение, поэтому вызываем его только после finally/release.
  return { ok: true, state: await getPet(chatId) };
}

/** Надеть/снять предмет (только один надет одновременно; передать "" чтобы снять). */
export async function equipPetItem(chatId: number, id: string): Promise<{ ok: boolean; state?: PetState; reason?: string }> {
  if (id && !SHOP_IDS.has(id)) return { ok: false, reason: "bad_item" };
  await getPet(chatId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Один порядок со сбросом профиля: clicker_state → pet_items. Проверка
    // владения и экипировка больше не расходятся между двумя запросами.
    await settleClickerBeforeIncomeChange(client, chatId);
    if (id) {
      const owned = await client.query(
        `SELECT 1 FROM pet_items WHERE chat_id=$1 AND item=$2 FOR UPDATE`,
        [chatId, id]
      );
      if (!owned.rows.length) { await client.query("ROLLBACK"); return { ok: false, reason: "not_owned" }; }
    }
    await client.query(`UPDATE pet_items SET equipped = (item = $2) WHERE chat_id=$1`, [chatId, id || "__none__"]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
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
    // Тот же порядок локов, что в getPet: clicker_state → pet_state.
    await settleClickerBeforeIncomeChange(client, chatId);
    const { rows } = await client.query(`SELECT * FROM pet_state WHERE chat_id=$1 FOR UPDATE`, [chatId]);
    const r = rows[0];
    const delta = RESTORE[action];
    for (const need of ["hunger", "mood", "energy", "hygiene"] as PetNeed[]) {
      const amount = delta[need];
      if (!amount) continue;
      r[need] = clamp(r[need] + amount);
      // На границе шкалы старый дробный долг уже поглощён cap/floor.
      if (r[need] === 0 || r[need] === 100) r[`${need}_carry`] = 0;
    }
    r.xp += XP_PER_ACTION;
    while (r.xp >= xpForNext(r.level)) { r.xp -= xpForNext(r.level); r.level += 1; }
    // стрик заботы: засчитываем 1 раз в сутки (первое действие ухода за день)
    const today = irkDay(0), yest = irkDay(1);
    let streakBonus = 0;
    if (r.care_date !== today) {
      r.care_streak = (r.care_date === yest) ? r.care_streak + 1 : 1;
      r.care_streak_best = Math.max(Number(r.care_streak_best || 0), r.care_streak);
      r.care_date = today;
      streakBonus = careStreakBonus(r.care_streak);
    }
    await client.query(
      `UPDATE pet_state SET hunger=$2,mood=$3,energy=$4,hygiene=$5,xp=$6,level=$7,
         care_streak=$8,care_date=$9,care_streak_best=$10,
         hunger_carry=$11,mood_carry=$12,energy_carry=$13,hygiene_carry=$14,
         updated_at=NOW() WHERE chat_id=$1`,
      [chatId, r.hunger, r.mood, r.energy, r.hygiene, r.xp, r.level, r.care_streak, r.care_date, r.care_streak_best,
        r.hunger_carry, r.mood_carry, r.energy_carry, r.hygiene_carry]
    );
    await addClickerBalance(chatId, streakBonus, client); // no-op если streakBonus<=0; атомарно в этой транзакции
    const balRow = await client.query(`SELECT balance, state_revision FROM clicker_state WHERE chat_id=$1`, [chatId]);
    await client.query("COMMIT");
    const state = toState(r);
    state.coins = Number(balRow.rows[0]?.balance ?? 0);
    state.revision = Number(balRow.rows[0]?.state_revision ?? 0);
    state.items = await getItems(chatId, client);
    return { ok: true, state, streakBonus, careStreak: r.care_streak };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function setPetLocation(chatId: number, location: string): Promise<{ ok: boolean; state?: PetState; reason?: string }> {
  if (!isPetLocation(location)) return { ok: false, reason: "bad_location" };
  const loc = location;
  await getPet(chatId);
  // updated_at — база decay потребностей. Смена комнаты не должна сдвигать её:
  // иначе быстрые переходы между комнатами могли бесконечно замораживать голод/энергию.
  await pool.query(`UPDATE pet_state SET location=$2 WHERE chat_id=$1`, [chatId, loc]);
  return { ok: true, state: await getPet(chatId) };
}


/**
 * Виртуальный питомец «Котик Марии» (тамагочи) — серверное состояние.
 *
 * Потребности (0–100) падают в реальном времени; при чтении применяем decay.
 * Уход (feed/sleep/wash/play) поднимает потребности, даёт опыт и монеты.
 * Состояние персистится в Neon per chat_id (работает для TG и VK — internalId).
 */
import { pool } from "./db";

export type PetNeed = "hunger" | "mood" | "energy" | "hygiene";
export type PetAction = "feed" | "sleep" | "wash" | "play" | "walk";
export type PetLocation = "kitchen" | "bedroom" | "playroom" | "yard";

export interface PetState {
  hunger: number; mood: number; energy: number; hygiene: number;
  level: number; xp: number; xpNext: number; coins: number;
  location: PetLocation;
}

// падение потребностей, очков/час
const DECAY: Record<PetNeed, number> = { hunger: 12, mood: 8, energy: 6, hygiene: 5 };
// сколько потребность поднимает действие
const RESTORE: Record<PetAction, Partial<Record<PetNeed, number>>> = {
  feed:  { hunger: 45, mood: 8 },
  sleep: { energy: 55, mood: 5 },
  wash:  { hygiene: 60, mood: 5 },
  play:  { mood: 35, energy: -10 },
  walk:  { mood: 18, energy: -4 },
};
const XP_PER_ACTION = 12;
const COINS_PER_ACTION = 3;
const LOCATIONS: PetLocation[] = ["kitchen", "bedroom", "playroom", "yard"];

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
const xpForNext = (level: number) => level * 100; // нужно опыта до следующего уровня

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
  `);
}

function toState(r: any): PetState {
  return {
    hunger: r.hunger, mood: r.mood, energy: r.energy, hygiene: r.hygiene,
    level: r.level, xp: r.xp, xpNext: xpForNext(r.level), coins: r.coins,
    location: LOCATIONS.includes(r.location) ? r.location : "kitchen",
  };
}

/** Чтение состояния с применением decay (и его персистом). Создаёт питомца при первом обращении. */
export async function getPet(chatId: number): Promise<PetState> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO pet_state (chat_id) VALUES ($1) ON CONFLICT (chat_id) DO NOTHING`,
      [chatId]
    );
    const { rows } = await client.query(
      `SELECT * FROM pet_state WHERE chat_id = $1 FOR UPDATE`,
      [chatId]
    );
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
    await client.query("COMMIT");
    return toState(r);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Действие ухода: поднимает потребности, начисляет опыт/монеты, считает уровень. */
export async function doPetAction(chatId: number, action: PetAction): Promise<{ ok: boolean; state?: PetState; reason?: string }> {
  if (!RESTORE[action]) return { ok: false, reason: "unknown_action" };
  await getPet(chatId); // применить decay
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
    // опыт + уровень
    r.xp += XP_PER_ACTION;
    r.coins += COINS_PER_ACTION;
    while (r.xp >= xpForNext(r.level)) { r.xp -= xpForNext(r.level); r.level += 1; }
    await client.query(
      `UPDATE pet_state SET hunger=$2,mood=$3,energy=$4,hygiene=$5,xp=$6,level=$7,coins=$8,updated_at=NOW() WHERE chat_id=$1`,
      [chatId, r.hunger, r.mood, r.energy, r.hygiene, r.xp, r.level, r.coins]
    );
    await client.query("COMMIT");
    return { ok: true, state: toState(r) };
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

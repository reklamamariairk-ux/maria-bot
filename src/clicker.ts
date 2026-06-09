/**
 * Кликер «Котик Комбат» (в духе Hamster Kombat) — серверное состояние.
 * Тап = монеты, энергия тратится и восстанавливается во времени, уровни по
 * накопленному балансу (на каждом — новый костюм кота на фронте).
 * Антинакрутка: монеты начисляются только в пределах доступной энергии (она
 * растёт строго по времени на сервере).
 */
import { pool } from "./db";

const REGEN_PER_SEC = 3;          // восстановление энергии
const TAP_COST = 1;               // энергии за тап
const MAX_TAPS_PER_REQ = 600;     // защита от абсурдных батчей

// Уровни: порог по total_earned, имя, монет за тап.
export const LEVELS = [
  { level: 1, name: "Уличный котик", need: 0,      perTap: 1, energyMax: 1000 },
  { level: 2, name: "Котик-сыщик",   need: 300,    perTap: 2, energyMax: 1200 },
  { level: 3, name: "Котик-пират",   need: 1500,   perTap: 3, energyMax: 1500 },
  { level: 4, name: "Котик-волшебник", need: 6000, perTap: 5, energyMax: 2000 },
  { level: 5, name: "Котик-король",  need: 20000,  perTap: 8, energyMax: 2500 },
];
function levelFor(total: number) {
  let l = LEVELS[0];
  for (const x of LEVELS) if (total >= x.need) l = x;
  return l;
}
function nextNeed(total: number): number | null {
  const next = LEVELS.find((x) => x.need > total);
  return next ? next.need : null;
}

export interface ClickerState {
  balance: number; totalEarned: number; energy: number; energyMax: number;
  level: number; levelName: string; perTap: number; nextNeed: number | null;
}

export async function initClickerSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clicker_state (
      chat_id      BIGINT PRIMARY KEY,
      balance      BIGINT NOT NULL DEFAULT 0,
      total_earned BIGINT NOT NULL DEFAULT 0,
      taps         BIGINT NOT NULL DEFAULT 0,
      energy       INT NOT NULL DEFAULT 1000,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

function build(r: any): ClickerState {
  const lv = levelFor(Number(r.total_earned));
  return {
    balance: Number(r.balance), totalEarned: Number(r.total_earned),
    energy: r.energy, energyMax: lv.energyMax,
    level: lv.level, levelName: lv.name, perTap: lv.perTap, nextNeed: nextNeed(Number(r.total_earned)),
  };
}

export async function getClicker(chatId: number): Promise<ClickerState> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO clicker_state (chat_id) VALUES ($1) ON CONFLICT (chat_id) DO NOTHING`, [chatId]);
    const { rows } = await client.query(`SELECT * FROM clicker_state WHERE chat_id=$1 FOR UPDATE`, [chatId]);
    const r = rows[0];
    const lv = levelFor(Number(r.total_earned));
    const secs = Math.max(0, (Date.now() - new Date(r.updated_at).getTime()) / 1000);
    r.energy = Math.min(lv.energyMax, Math.round(r.energy + secs * REGEN_PER_SEC));
    await client.query(`UPDATE clicker_state SET energy=$2, updated_at=NOW() WHERE chat_id=$1`, [chatId, r.energy]);
    await client.query("COMMIT");
    return build(r);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Засчитать пачку тапов (в пределах доступной энергии). */
export async function tapClicker(chatId: number, taps: number): Promise<ClickerState> {
  const want = Math.max(0, Math.min(MAX_TAPS_PER_REQ, Math.floor(taps)));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO clicker_state (chat_id) VALUES ($1) ON CONFLICT (chat_id) DO NOTHING`, [chatId]);
    const { rows } = await client.query(`SELECT * FROM clicker_state WHERE chat_id=$1 FOR UPDATE`, [chatId]);
    const r = rows[0];
    let lv = levelFor(Number(r.total_earned));
    const secs = Math.max(0, (Date.now() - new Date(r.updated_at).getTime()) / 1000);
    let energy = Math.min(lv.energyMax, Math.round(r.energy + secs * REGEN_PER_SEC));
    const can = Math.min(want, Math.floor(energy / TAP_COST));
    const earned = can * lv.perTap;
    energy -= can * TAP_COST;
    const newBalance = Number(r.balance) + earned;
    const newTotal = Number(r.total_earned) + earned;
    await client.query(
      `UPDATE clicker_state SET balance=$2, total_earned=$3, taps=taps+$4, energy=$5, updated_at=NOW() WHERE chat_id=$1`,
      [chatId, newBalance, newTotal, can, energy]
    );
    await client.query("COMMIT");
    return build({ ...r, balance: newBalance, total_earned: newTotal, energy });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

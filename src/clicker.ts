/**
 * Кликер «Котик Комбат» (в духе Hamster Kombat) — полная экономика.
 * Тап = монеты, энергия (регенит во времени). Апгрейды: мультитап (+за тап),
 * лимит энергии. Карточки-бизнесы дают пассивный доход (монеты/час), который
 * капает даже офлайн (с потолком). Уровни (лиги) по накоплению → костюм кота.
 * Антинакрутка: энергия и пассив считаются строго по времени на сервере.
 */
import { pool } from "./db";

const REGEN_PER_SEC = 3;
const TAP_COST = 1;
const MAX_TAPS_PER_REQ = 600;
const PASSIVE_CAP_HOURS = 3;      // потолок офлайн-дохода

// Лиги (костюм кота по total_earned — маппинг арта на фронте)
export const LEAGUES = [
  { level: 1, name: "Уличный котик", need: 0 },
  { level: 2, name: "Котик-сыщик", need: 300 },
  { level: 3, name: "Котик-пират", need: 1500 },
  { level: 4, name: "Котик-волшебник", need: 6000 },
  { level: 5, name: "Котик-король", need: 20000 },
];
function leagueFor(total: number) { let l = LEAGUES[0]; for (const x of LEAGUES) if (total >= x.need) l = x; return l; }
function nextNeed(total: number): number | null { const n = LEAGUES.find((x) => x.need > total); return n ? n.need : null; }

// Карточки-бизнесы (пассивный доход)
export const CARDS = [
  { id: "bakery",      name: "Пекарня",          icon: "🍞", basePrice: 300,   baseProfit: 30 },
  { id: "coffee",      name: "Кофемашина",       icon: "☕", basePrice: 900,   baseProfit: 85 },
  { id: "delivery",    name: "Доставка",         icon: "🛵", basePrice: 2500,  baseProfit: 200 },
  { id: "cakefactory", name: "Фабрика тортов",   icon: "🎂", basePrice: 7000,  baseProfit: 520 },
  { id: "franchise",   name: "Франшиза «Мария»", icon: "🏪", basePrice: 20000, baseProfit: 1500 },
];
const CARD_BY_ID = Object.fromEntries(CARDS.map((c) => [c.id, c]));

const priceMultitap = (lvl: number) => Math.round(200 * Math.pow(2, lvl));       // lvl = текущий уровень мультитапа (с 0)
const priceEnergy = (lvl: number) => Math.round(300 * Math.pow(2, lvl));
const energyMaxFor = (lvl: number) => 1000 + 500 * lvl;
const perTapFor = (multitapLvl: number) => 1 + multitapLvl;
const cardPrice = (card: { basePrice: number }, lvl: number) => Math.round(card.basePrice * Math.pow(1.6, lvl)); // lvl = текущий уровень карты (с 0)
const cardProfit = (card: { baseProfit: number }, lvl: number) => card.baseProfit * lvl;

export interface ClickerState {
  balance: number; totalEarned: number; energy: number; energyMax: number;
  perTap: number; profitPerHour: number; passiveEarned: number;
  level: number; levelName: string; nextNeed: number | null;
  multitapLevel: number; multitapPrice: number;
  energyLevel: number; energyPrice: number;
  cards: { id: string; name: string; icon: string; level: number; profit: number; price: number }[];
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
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS energy_limit_level INT NOT NULL DEFAULT 0;
    CREATE TABLE IF NOT EXISTS clicker_cards (
      chat_id BIGINT NOT NULL,
      card    TEXT NOT NULL,
      level   INT NOT NULL DEFAULT 0,
      PRIMARY KEY (chat_id, card)
    );
  `);
}

async function readCards(client: any, chatId: number): Promise<Record<string, number>> {
  const { rows } = await client.query(`SELECT card, level FROM clicker_cards WHERE chat_id=$1`, [chatId]);
  const m: Record<string, number> = {};
  for (const r of rows) m[r.card] = r.level;
  return m;
}
function profitPerHour(cardLevels: Record<string, number>): number {
  let p = 0;
  for (const c of CARDS) p += cardProfit(c, cardLevels[c.id] || 0);
  return p;
}
function buildState(r: any, cardLevels: Record<string, number>, passiveEarned: number): ClickerState {
  const lg = leagueFor(Number(r.total_earned));
  return {
    balance: Number(r.balance), totalEarned: Number(r.total_earned),
    energy: r.energy, energyMax: energyMaxFor(r.energy_limit_level),
    perTap: perTapFor(r.multitap_level), profitPerHour: profitPerHour(cardLevels), passiveEarned,
    level: lg.level, levelName: lg.name, nextNeed: nextNeed(Number(r.total_earned)),
    multitapLevel: r.multitap_level, multitapPrice: priceMultitap(r.multitap_level),
    energyLevel: r.energy_limit_level, energyPrice: priceEnergy(r.energy_limit_level),
    cards: CARDS.map((c) => ({ id: c.id, name: c.name, icon: c.icon, level: cardLevels[c.id] || 0, profit: cardProfit(c, (cardLevels[c.id] || 0) + 1), price: cardPrice(c, cardLevels[c.id] || 0) })),
  };
}

/** Применяет регенерацию энергии и пассивный доход (с потолком), персистит. */
async function refresh(client: any, chatId: number): Promise<{ r: any; cards: Record<string, number>; passive: number }> {
  await client.query(`INSERT INTO clicker_state (chat_id) VALUES ($1) ON CONFLICT (chat_id) DO NOTHING`, [chatId]);
  const { rows } = await client.query(`SELECT * FROM clicker_state WHERE chat_id=$1 FOR UPDATE`, [chatId]);
  const r = rows[0];
  const cards = await readCards(client, chatId);
  const secs = Math.max(0, (Date.now() - new Date(r.updated_at).getTime()) / 1000);
  // энергия
  r.energy = Math.min(energyMaxFor(r.energy_limit_level), Math.round(r.energy + secs * REGEN_PER_SEC));
  // пассивный доход (потолок PASSIVE_CAP_HOURS)
  const pph = profitPerHour(cards);
  const passive = Math.floor(pph * Math.min(secs / 3600, PASSIVE_CAP_HOURS));
  if (passive > 0) { r.balance = Number(r.balance) + passive; r.total_earned = Number(r.total_earned) + passive; }
  await client.query(
    `UPDATE clicker_state SET balance=$2, total_earned=$3, energy=$4, updated_at=NOW() WHERE chat_id=$1`,
    [chatId, r.balance, r.total_earned, r.energy]
  );
  return { r, cards, passive };
}

export async function getClicker(chatId: number): Promise<ClickerState> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cards, passive } = await refresh(client, chatId);
    await client.query("COMMIT");
    return buildState(r, cards, passive);
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

export async function tapClicker(chatId: number, taps: number): Promise<ClickerState> {
  const want = Math.max(0, Math.min(MAX_TAPS_PER_REQ, Math.floor(taps)));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cards } = await refresh(client, chatId);
    const can = Math.min(want, Math.floor(r.energy / TAP_COST));
    const earned = can * perTapFor(r.multitap_level);
    r.energy -= can * TAP_COST; r.balance = Number(r.balance) + earned; r.total_earned = Number(r.total_earned) + earned;
    await client.query(`UPDATE clicker_state SET balance=$2, total_earned=$3, taps=taps+$4, energy=$5, updated_at=NOW() WHERE chat_id=$1`,
      [chatId, r.balance, r.total_earned, can, r.energy]);
    await client.query("COMMIT");
    return buildState(r, cards, 0);
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

export async function buyClicker(chatId: number, type: string, id?: string): Promise<{ ok: boolean; state?: ClickerState; reason?: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cards } = await refresh(client, chatId);
    let cost = 0;
    if (type === "multitap") cost = priceMultitap(r.multitap_level);
    else if (type === "energy") cost = priceEnergy(r.energy_limit_level);
    else if (type === "card") { const c = id && CARD_BY_ID[id]; if (!c) { await client.query("ROLLBACK"); return { ok: false, reason: "bad_card" }; } cost = cardPrice(c, cards[id!] || 0); }
    else { await client.query("ROLLBACK"); return { ok: false, reason: "bad_type" }; }

    if (Number(r.balance) < cost) { await client.query("ROLLBACK"); return { ok: false, reason: "not_enough" }; }
    r.balance = Number(r.balance) - cost;
    if (type === "multitap") r.multitap_level += 1;
    else if (type === "energy") r.energy_limit_level += 1;
    else { const lvl = (cards[id!] || 0) + 1; cards[id!] = lvl; await client.query(`INSERT INTO clicker_cards (chat_id, card, level) VALUES ($1,$2,$3) ON CONFLICT (chat_id, card) DO UPDATE SET level=$3`, [chatId, id, lvl]); }
    await client.query(`UPDATE clicker_state SET balance=$2, multitap_level=$3, energy_limit_level=$4, updated_at=NOW() WHERE chat_id=$1`,
      [chatId, r.balance, r.multitap_level, r.energy_limit_level]);
    await client.query("COMMIT");
    return { ok: true, state: buildState(r, cards, 0) };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

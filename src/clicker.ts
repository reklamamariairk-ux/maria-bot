/**
 * Кликер «Котик Комбат» (Hamster Kombat-стиль) — экономика + усиления.
 * Тап (с комбо/турбо), энергия, апгрейды (мультитап/энергия), бизнесы (пассив,
 * капает офлайн), бусты (турбо ×5 / полная энергия, 6/день), ежедневная награда
 * (стрик), лидерборд. Антинакрутка: энергия/пассив/турбо считаются на сервере.
 */
import { pool } from "./db";

const REGEN_PER_SEC = 3;
const TAP_COST = 1;
const MAX_TAPS_PER_REQ = 600;
const PASSIVE_CAP_HOURS = 3;
const TURBO_MULT = 5;
const TURBO_SEC = 20;
const DAILY_BOOSTS = 6;           // бесплатных бустов каждого типа в день
const REF_INVITEE = 2500;         // бонус приглашённому
const REF_REFERRER = 5000;        // бонус пригласившему
const irkToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

// Задания. type: link (открыть ссылку → забрать) | level | balance | streak | ref (по достижению цели).
export const TASKS = [
  { id: "site",     name: "Заглянуть на сайт «Мария»", icon: "🌐", reward: 1500, type: "link", link: "https://www.maria-irk.ru/" },
  { id: "invite1",  name: "Пригласить друга",          icon: "👥", reward: 10000, type: "ref",   target: 1 },
  { id: "level3",   name: "Дойти до 3 уровня", icon: "⭐", reward: 3000, type: "level",  target: 3 },
  { id: "balance10",name: "Накопить 10 000 монет",     icon: "💰", reward: 2500, type: "balance", target: 10000 },
  { id: "streak3",  name: "Заходить 3 дня подряд",      icon: "🔥", reward: 4000, type: "streak",  target: 3 },
];
const TASK_BY_ID = Object.fromEntries(TASKS.map((t) => [t.id, t]));
const dailyReward = (streak: number) => 500 * Math.min(Math.max(1, streak), 10); // день1=500 … день10+=5000

// ⚠️ Лестница продублирована во фронте public/js/catclick.js (там же поле cat) — менять синхронно.
export const LEAGUES = [
  { level: 1,  name: "Тощий котик",        need: 0 },
  { level: 2,  name: "Обычный котик",      need: 200 },
  { level: 3,  name: "Сытый котик",        need: 600 },
  { level: 4,  name: "Толстый котик",      need: 1500 },
  { level: 5,  name: "Котик на спорте",    need: 3500 },
  { level: 6,  name: "Подкачанный котик",  need: 7000 },
  { level: 7,  name: "Котик в тонусе",     need: 13000 },
  { level: 8,  name: "Котик-бодибилдер",   need: 24000 },
  { level: 9,  name: "Котик-силач",        need: 42000 },
  { level: 10, name: "Котик-рэпер",        need: 70000 },
  { level: 11, name: "Котик при деньгах",  need: 110000 },
  { level: 12, name: "Котик-делец",        need: 170000 },
  { level: 13, name: "Котик-бизнесмен",    need: 260000 },
  { level: 14, name: "Котик-босс",         need: 400000 },
  { level: 15, name: "Котик-магнат",       need: 600000 },
  { level: 16, name: "Котик-воротила",     need: 880000 },
  { level: 17, name: "Котик-олигарх",      need: 1250000 },
  { level: 18, name: "Котик-дон",          need: 1750000 },
  { level: 19, name: "Повелитель котов",   need: 2500000 },
];
function leagueFor(total: number) { let l = LEAGUES[0]; for (const x of LEAGUES) if (total >= x.need) l = x; return l; }
function nextNeed(total: number): number | null { const n = LEAGUES.find((x) => x.need > total); return n ? n.need : null; }

export const CARDS = [
  { id: "bakery", name: "Пекарня", icon: "🍞", basePrice: 300, baseProfit: 30 },
  { id: "coffee", name: "Кофемашина", icon: "☕", basePrice: 900, baseProfit: 85 },
  { id: "delivery", name: "Доставка", icon: "🛵", basePrice: 2500, baseProfit: 200 },
  { id: "cakefactory", name: "Фабрика тортов", icon: "🎂", basePrice: 7000, baseProfit: 520 },
  { id: "franchise", name: "Франшиза «Мария»", icon: "🏪", basePrice: 20000, baseProfit: 1500 },
];
const CARD_BY_ID = Object.fromEntries(CARDS.map((c) => [c.id, c]));

const priceMultitap = (lvl: number) => Math.round(200 * Math.pow(2, lvl));
const priceEnergy = (lvl: number) => Math.round(300 * Math.pow(2, lvl));
const energyMaxFor = (lvl: number) => 1000 + 500 * lvl;
const perTapFor = (lvl: number) => 1 + lvl;
const cardPrice = (c: { basePrice: number }, lvl: number) => Math.round(c.basePrice * Math.pow(1.6, lvl));
const cardProfit = (c: { baseProfit: number }, lvl: number) => c.baseProfit * lvl;

// ── Бонусы дня: Комбо (3 карты) + Шифр (морзе) — детерминированы от даты ─────────
// ⚠️ Алгоритм/слова/морзе продублированы во фронте public/js/catclick.js — менять синхронно.
const COMBO_REWARD = 50000;
const CIPHER_REWARD = 8000;
const CIPHER_WORDS = ["МАРИЯ", "ТОРТ", "КОТИК", "КРЕМ", "ЭКЛЕР", "МУСС", "БИСКВИТ", "ВАНИЛЬ", "ШОКОЛАД", "КАРАМЕЛЬ", "ДЕСЕРТ", "ПЕКАРНЯ"];
const MORSE: Record<string, string> = {
  А: ".-", Б: "-...", В: ".--", Г: "--.", Д: "-..", Е: ".", Ж: "...-", З: "--..", И: "..", Й: ".---",
  К: "-.-", Л: ".-..", М: "--", Н: "-.", О: "---", П: ".--.", Р: ".-.", С: "...", Т: "-", У: "..-",
  Ф: "..-.", Х: "....", Ц: "-.-.", Ч: "---.", Ш: "----", Щ: "--.-", Ь: "-..-", Ы: "-.--", Э: "..-..", Ю: "..--", Я: ".-.-",
};
function dateSeed(day: string, salt: string): number { let h = 2166136261 >>> 0; const s = day + salt; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
function todaysCombo(day: string): string[] { let h = dateSeed(day, "combo"); const pool2 = CARDS.map((c) => c.id); const pick: string[] = []; for (let i = 0; i < 3; i++) { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; pick.push(pool2.splice(h % pool2.length, 1)[0]); } return pick; }
function todaysCipher(day: string): string { return CIPHER_WORDS[dateSeed(day, "cipher") % CIPHER_WORDS.length]; }
function toMorse(w: string): string { return w.split("").map((c) => MORSE[c] || "").join(" "); }
function parseHits(s: string | null): string[] { return s ? s.split(",").filter(Boolean) : []; }

export interface ClickerState {
  balance: number; totalEarned: number; energy: number; energyMax: number;
  perTap: number; profitPerHour: number; passiveEarned: number;
  level: number; levelName: string; nextNeed: number | null;
  multitapLevel: number; multitapPrice: number;
  energyLevel: number; energyPrice: number;
  cards: { id: string; name: string; icon: string; level: number; profit: number; price: number }[];
  // усиления
  dailyAvailable: boolean; dailyStreak: number; dailyNext: number;
  boostEnergyLeft: number; boostTurboLeft: number; turboMsLeft: number;
  referrals: number; refCode: string;
  combo: { cards: string[]; hits: string[]; complete: boolean; claimed: boolean; reward: number };
  cipher: { morse: string; len: number; claimed: boolean; reward: number };
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
    CREATE TABLE IF NOT EXISTS clicker_cards (
      chat_id BIGINT NOT NULL, card TEXT NOT NULL, level INT NOT NULL DEFAULT 0,
      PRIMARY KEY (chat_id, card)
    );
    CREATE TABLE IF NOT EXISTS clicker_tasks (
      chat_id BIGINT NOT NULL, task TEXT NOT NULL, done_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (chat_id, task)
    );
    CREATE INDEX IF NOT EXISTS clicker_top_idx ON clicker_state (total_earned DESC);
  `);
}

async function readCards(client: any, chatId: number): Promise<Record<string, number>> {
  const { rows } = await client.query(`SELECT card, level FROM clicker_cards WHERE chat_id=$1`, [chatId]);
  const m: Record<string, number> = {}; for (const r of rows) m[r.card] = r.level; return m;
}
function profitPerHour(cl: Record<string, number>): number { let p = 0; for (const c of CARDS) p += cardProfit(c, cl[c.id] || 0); return p; }

function buildState(r: any, cl: Record<string, number>, passiveEarned: number): ClickerState {
  const lg = leagueFor(Number(r.total_earned));
  const today = irkToday();
  const turboMs = r.turbo_until ? Math.max(0, new Date(r.turbo_until).getTime() - Date.now()) : 0;
  const bUsedE = r.boost_date === today ? r.boost_energy_used : 0;
  const bUsedT = r.boost_date === today ? r.boost_turbo_used : 0;
  return {
    balance: Number(r.balance), totalEarned: Number(r.total_earned), energy: r.energy, energyMax: energyMaxFor(r.energy_limit_level),
    perTap: perTapFor(r.multitap_level), profitPerHour: profitPerHour(cl), passiveEarned,
    level: lg.level, levelName: lg.name, nextNeed: nextNeed(Number(r.total_earned)),
    multitapLevel: r.multitap_level, multitapPrice: priceMultitap(r.multitap_level),
    energyLevel: r.energy_limit_level, energyPrice: priceEnergy(r.energy_limit_level),
    cards: CARDS.map((c) => ({ id: c.id, name: c.name, icon: c.icon, level: cl[c.id] || 0, profit: cardProfit(c, (cl[c.id] || 0) + 1), price: cardPrice(c, cl[c.id] || 0) })),
    dailyAvailable: r.daily_date !== today, dailyStreak: r.daily_streak, dailyNext: dailyReward((r.daily_date === today ? r.daily_streak : r.daily_streak + 1)),
    boostEnergyLeft: DAILY_BOOSTS - bUsedE, boostTurboLeft: DAILY_BOOSTS - bUsedT, turboMsLeft: turboMs,
    referrals: r.referrals || 0, refCode: String(r.chat_id),
    combo: (() => { const cards = todaysCombo(today); const hits = r.combo_date === today ? parseHits(r.combo_hits) : []; return { cards, hits, complete: cards.every((c) => hits.includes(c)), claimed: r.combo_claimed === today, reward: COMBO_REWARD }; })(),
    cipher: { morse: toMorse(todaysCipher(today)), len: todaysCipher(today).length, claimed: r.cipher_date === today, reward: CIPHER_REWARD },
  };
}

async function refresh(client: any, chatId: number): Promise<{ r: any; cl: Record<string, number>; passive: number }> {
  await client.query(`INSERT INTO clicker_state (chat_id) VALUES ($1) ON CONFLICT (chat_id) DO NOTHING`, [chatId]);
  const { rows } = await client.query(`SELECT * FROM clicker_state WHERE chat_id=$1 FOR UPDATE`, [chatId]);
  const r = rows[0];
  const cl = await readCards(client, chatId);
  const today = irkToday();
  if (r.boost_date !== today) { r.boost_energy_used = 0; r.boost_turbo_used = 0; r.boost_date = today; }
  const secs = Math.max(0, (Date.now() - new Date(r.updated_at).getTime()) / 1000);
  r.energy = Math.min(energyMaxFor(r.energy_limit_level), Math.round(r.energy + secs * REGEN_PER_SEC));
  const passive = Math.floor(profitPerHour(cl) * Math.min(secs / 3600, PASSIVE_CAP_HOURS));
  if (passive > 0) { r.balance = Number(r.balance) + passive; r.total_earned = Number(r.total_earned) + passive; }
  await client.query(
    `UPDATE clicker_state SET balance=$2, total_earned=$3, energy=$4, boost_energy_used=$5, boost_turbo_used=$6, boost_date=$7, updated_at=NOW() WHERE chat_id=$1`,
    [chatId, r.balance, r.total_earned, r.energy, r.boost_energy_used, r.boost_turbo_used, r.boost_date]
  );
  return { r, cl, passive };
}

export async function getClicker(chatId: number): Promise<ClickerState> {
  const client = await pool.connect();
  try { await client.query("BEGIN"); const { r, cl, passive } = await refresh(client, chatId); await client.query("COMMIT"); return buildState(r, cl, passive); }
  catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

export async function tapClicker(chatId: number, taps: number): Promise<ClickerState> {
  const want = Math.max(0, Math.min(MAX_TAPS_PER_REQ, Math.floor(taps)));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cl } = await refresh(client, chatId);
    const can = Math.min(want, Math.floor(r.energy / TAP_COST));
    const turbo = r.turbo_until && new Date(r.turbo_until).getTime() > Date.now() ? TURBO_MULT : 1;
    const earned = can * perTapFor(r.multitap_level) * turbo;
    r.energy -= can * TAP_COST; r.balance = Number(r.balance) + earned; r.total_earned = Number(r.total_earned) + earned;
    await client.query(`UPDATE clicker_state SET balance=$2, total_earned=$3, taps=taps+$4, energy=$5, updated_at=NOW() WHERE chat_id=$1`,
      [chatId, r.balance, r.total_earned, can, r.energy]);
    await client.query("COMMIT");
    return buildState(r, cl, 0);
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
    else if (type === "card") { const c = id && CARD_BY_ID[id]; if (!c) { await client.query("ROLLBACK"); return { ok: false, reason: "bad_card" }; } cost = cardPrice(c, cl[id!] || 0); }
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
    const yest = new Date(Date.now() + 8 * 3600 * 1000 - 86400000).toISOString().slice(0, 10);
    r.daily_streak = r.daily_date === yest ? r.daily_streak + 1 : 1;
    const reward = dailyReward(r.daily_streak);
    r.balance = Number(r.balance) + reward; r.total_earned = Number(r.total_earned) + reward; r.daily_date = today;
    await client.query(`UPDATE clicker_state SET balance=$2, total_earned=$3, daily_streak=$4, daily_date=$5, updated_at=NOW() WHERE chat_id=$1`,
      [chatId, r.balance, r.total_earned, r.daily_streak, today]);
    await client.query("COMMIT");
    return { ok: true, reward, state: buildState(r, cl, 0) };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

/** Забрать награду за Комбо дня (если все 3 карты сегодня прокачаны). */
export async function claimCombo(chatId: number): Promise<{ ok: boolean; reward?: number; state?: ClickerState; reason?: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cl } = await refresh(client, chatId);
    const today = irkToday();
    if (r.combo_claimed === today) { await client.query("ROLLBACK"); return { ok: false, reason: "already" }; }
    const combo = todaysCombo(today);
    const hits = r.combo_date === today ? parseHits(r.combo_hits) : [];
    if (!combo.every((c) => hits.includes(c))) { await client.query("ROLLBACK"); return { ok: false, reason: "not_ready" }; }
    r.balance = Number(r.balance) + COMBO_REWARD; r.total_earned = Number(r.total_earned) + COMBO_REWARD; r.combo_claimed = today;
    await client.query(`UPDATE clicker_state SET balance=$2, total_earned=$3, combo_claimed=$4, updated_at=NOW() WHERE chat_id=$1`, [chatId, r.balance, r.total_earned, today]);
    await client.query("COMMIT");
    return { ok: true, reward: COMBO_REWARD, state: buildState(r, cl, 0) };
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

/** Буст: turbo (×5 на 20с) или energy (полная энергия). 6/день каждого. */
export async function boostClicker(chatId: number, type: string): Promise<{ ok: boolean; state?: ClickerState; reason?: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cl } = await refresh(client, chatId);
    if (type === "energy") {
      if (r.boost_energy_used >= DAILY_BOOSTS) { await client.query("ROLLBACK"); return { ok: false, reason: "no_boosts" }; }
      r.energy = energyMaxFor(r.energy_limit_level); r.boost_energy_used += 1;
      await client.query(`UPDATE clicker_state SET energy=$2, boost_energy_used=$3, updated_at=NOW() WHERE chat_id=$1`, [chatId, r.energy, r.boost_energy_used]);
    } else if (type === "turbo") {
      if (r.boost_turbo_used >= DAILY_BOOSTS) { await client.query("ROLLBACK"); return { ok: false, reason: "no_boosts" }; }
      r.turbo_until = new Date(Date.now() + TURBO_SEC * 1000); r.boost_turbo_used += 1;
      await client.query(`UPDATE clicker_state SET turbo_until=$2, boost_turbo_used=$3, updated_at=NOW() WHERE chat_id=$1`, [chatId, r.turbo_until, r.boost_turbo_used]);
    } else { await client.query("ROLLBACK"); return { ok: false, reason: "bad_type" }; }
    await client.query("COMMIT");
    return { ok: true, state: buildState(r, cl, 0) };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

/** Топ игроков по накоплению (имя из subscribers). */
export async function getTop(chatId: number, limit = 30): Promise<{ top: { name: string; total: number; me: boolean }[]; myRank: number | null }> {
  const { rows } = await pool.query(
    `SELECT c.chat_id, c.total_earned, s.first_name, s.username
       FROM clicker_state c LEFT JOIN subscribers s ON s.chat_id = c.chat_id
      WHERE c.total_earned > 0 ORDER BY c.total_earned DESC LIMIT $1`, [limit]
  );
  const top = rows.map((r) => ({ name: (r.first_name || r.username || "Котовод").toString().slice(0, 24), total: Number(r.total_earned), me: Number(r.chat_id) === chatId }));
  const rank = await pool.query(`SELECT COUNT(*)::int AS n FROM clicker_state WHERE total_earned > (SELECT total_earned FROM clicker_state WHERE chat_id=$1)`, [chatId]);
  return { top, myRank: rows.length ? (rank.rows[0].n + 1) : null };
}

/** Регистрация реферала: code = chat_id пригласившего. Бонус обоим, один раз. */
export async function registerRef(chatId: number, code: string): Promise<{ ok: boolean; reward?: number; state: ClickerState }> {
  const refId = Number(code);
  const noop = async () => ({ ok: false, state: await getClicker(chatId) });
  if (!Number.isFinite(refId) || refId === chatId) return noop();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO clicker_state (chat_id) VALUES ($1) ON CONFLICT (chat_id) DO NOTHING`, [chatId]);
    const { rows } = await client.query(`SELECT referred_by FROM clicker_state WHERE chat_id=$1 FOR UPDATE`, [chatId]);
    if (rows[0].referred_by != null) { await client.query("ROLLBACK"); return noop(); }
    await client.query(`UPDATE clicker_state SET referred_by=$2, balance=balance+$3, total_earned=total_earned+$3 WHERE chat_id=$1`, [chatId, refId, REF_INVITEE]);
    await client.query(`INSERT INTO clicker_state (chat_id, balance, total_earned, referrals) VALUES ($1,$2,$2,1)
                        ON CONFLICT (chat_id) DO UPDATE SET balance=clicker_state.balance+$2, total_earned=clicker_state.total_earned+$2, referrals=clicker_state.referrals+1`, [refId, REF_REFERRER]);
    await client.query("COMMIT");
    return { ok: true, reward: REF_INVITEE, state: await getClicker(chatId) };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

function taskClaimable(t: any, s: ClickerState): boolean {
  if (t.type === "link") return true;
  if (t.type === "level") return s.level >= t.target;
  if (t.type === "balance") return s.totalEarned >= t.target;
  if (t.type === "streak") return s.dailyStreak >= t.target;
  if (t.type === "ref") return s.referrals >= t.target;
  return false;
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
  const t = TASK_BY_ID[id]; if (!t) return { ok: false, reason: "bad_task" };
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
    await client.query(`UPDATE clicker_state SET balance=$2, total_earned=$3, updated_at=NOW() WHERE chat_id=$1`, [chatId, r.balance, r.total_earned]);
    await client.query("COMMIT");
    return { ok: true, reward: t.reward, state: buildState(r, cl, 0) };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

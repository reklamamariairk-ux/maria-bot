/**
 * Кликер «Котик Комбат» (Hamster Kombat-стиль) — экономика + усиления.
 * Тап (с комбо/турбо), энергия, апгрейды (мультитап/энергия), бизнесы (пассив,
 * капает офлайн), бусты (турбо ×5 / полная энергия, 6/день), ежедневная награда
 * (стрик), лидерборд. Антинакрутка: энергия/пассив/турбо считаются на сервере.
 */
import { pool } from "./db";
import { clickerReferralLink, miniAppLink } from "./links";
import { earnPoints, isPhoneVerified, grantRewardByCode } from "./club";
import { fetchLk } from "./lk";
import * as fs from "fs";
import * as path from "path";
import { trackEvent } from "./analytics";
import type { PushService } from "./push";
import { log } from "./logger";

// Подарки за достижения → реальные баллы на карту клуба «Мария» (earnPoints).
// Выдаются ОДИН раз, только игроку с подтверждённым телефоном. Суммы — в gift у
// достижения ниже. ⚠️ Реальная ценность (баллы клуба) — согласовать суммы с Машей.
export const GIFTS_ENABLED = true;

const REGEN_PER_SEC = 1.5;
const TAP_COST = 1;
const MAX_TAPS_PER_REQ = 600;
const PASSIVE_CAP_HOURS = 3;
const TURBO_MULT = 5;
const TURBO_SEC = 20;
const DAILY_BOOSTS = 6;           // бесплатных бустов каждого типа в день
const REF_INVITEE = 2500;         // бонус приглашённому
const REF_REFERRER = 5000;        // бонус пригласившему
const irkToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
// Сезон = неделя по Иркутску (сброс в понедельник 00:00). Ключ — индекс дня-понедельника.
function weekMonday(): number { const d = Math.floor((Date.now() + 8 * 3600 * 1000) / 86400000); return d - ((d + 3) % 7); }
const weekKey = () => String(weekMonday());
const seasonEndsTs = () => (weekMonday() + 7) * 86400000 - 8 * 3600 * 1000; // ms UTC начала след. недели

// Соцссылки «Марии» для заданий-маркетинга. ⚠️ Продублировано во фронте catclick.js.
// Пустая ссылка = задание скрыто (не отправляем людей в никуда). Заполнить реальными URL.
export const SOCIAL = {
  review: "https://yandex.ru/maps/?text=Мария кондитерская Иркутск",
  vk: "",   // напр. https://vk.com/maria_irk — заполнить
  tg: "",   // напр. https://t.me/maria_irk — заполнить
};

// Задания. type: link (открыть ссылку → забрать) | level | balance | streak | ref (по достижению цели).
// Задания-маркетинг с пустой ссылкой автоматически отфильтровываются (скрыты до заполнения SOCIAL).
export const TASKS = [
  { id: "site",     name: "Заглянуть на сайт «Мария»", icon: "🌐", reward: 1500, type: "link", link: "https://www.maria-irk.ru/" },
  { id: "review",   name: "Оставить отзыв о «Марии»",   icon: "⭐", reward: 5000, type: "link", link: SOCIAL.review },
  { id: "vk",       name: "Подписаться на ВК «Мария»",  icon: "👍", reward: 4000, type: "link", link: SOCIAL.vk },
  { id: "tg",       name: "Подписаться на Telegram «Мария»", icon: "📣", reward: 4000, type: "link", link: SOCIAL.tg },
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
  { id: "ach_lvl19",   name: "Повелитель котов",  icon: "star",   reward: 100000, type: "level",   target: 19 },
  { id: "ach_streak7", name: "Неделя верности",   icon: "fire",   reward: 7000,   type: "streak",  target: 7 },
  { id: "ach_ref3",    name: "Душа компании",     icon: "users",  reward: 15000,  type: "ref",     target: 3 },
  // Коллекция голубей: собрать всех в категории / всех вообще (level>0 у бизнесов категории)
  { id: "col_prod",  name: "Цех в сборе",       icon: "dove",   reward: 10000,  type: "collect", target: "prod" },
  { id: "col_mkt",   name: "Маркетинг в сборе", icon: "dove",   reward: 10000,  type: "collect", target: "mkt" },
  { id: "col_staff", name: "Команда в сборе",   icon: "dove",   reward: 10000,  type: "collect", target: "staff" },
  { id: "col_net",   name: "Сеть в сборе",      icon: "dove",   reward: 10000,  type: "collect", target: "net" },
  { id: "col_all",   name: "Повелитель голубей", icon: "trophy", reward: 60000,  type: "collect", target: "all" },
];
const TASK_BY_ID = Object.fromEntries(TASKS.map((t) => [t.id, t]));
const ALL_BY_ID: Record<string, any> = Object.fromEntries([...TASKS, ...ACHIEVEMENTS].map((t) => [t.id, t]));
const dailyReward = (streak: number) => 250 * Math.min(Math.max(1, streak), 10); // день1=250 … день10+=2500

// ⚠️ Лестница продублирована во фронте public/js/catclick.js (там же поле cat) — менять синхронно.
export const LEAGUES = [
  { level: 1,  name: "Тощий котик",        need: 0 },
  { level: 2,  name: "Обычный котик",      need: 1000 },
  { level: 3,  name: "Сытый котик",        need: 3000 },
  { level: 4,  name: "Толстый котик",      need: 8000 },
  { level: 5,  name: "Котик на спорте",    need: 18000 },
  { level: 6,  name: "Подкачанный котик",  need: 38000 },
  { level: 7,  name: "Котик в тонусе",     need: 70000 },
  { level: 8,  name: "Котик-бодибилдер",   need: 120000 },
  { level: 9,  name: "Котик-силач",        need: 200000 },
  { level: 10, name: "Котик-рэпер",        need: 320000 },
  { level: 11, name: "Котик при деньгах",  need: 500000 },
  { level: 12, name: "Котик-делец",        need: 800000 },
  { level: 13, name: "Котик-бизнесмен",    need: 1300000 },
  { level: 14, name: "Котик-босс",         need: 2000000 },
  { level: 15, name: "Котик-магнат",       need: 3500000 },
  { level: 16, name: "Котик-воротила",     need: 8000000 },
  { level: 17, name: "Котик-олигарх",      need: 30000000 },
  { level: 18, name: "Котик-дон",          need: 150000000 },
  { level: 19, name: "Повелитель котов",   need: 1200000000 },
];
function leagueFor(total: number) { let l = LEAGUES[0]; for (const x of LEAGUES) if (total >= x.need) l = x; return l; }
function nextNeed(total: number): number | null { const n = LEAGUES.find((x) => x.need > total); return n ? n.need : null; }

// ── Реальные награды (обмен монет → скидка/бонусы). ⚠️ ВЫКЛ до согласования Маши ──
// Когда Маша утвердит: курс монет, что выдаём (промокод/бонусы на карту), лимиты —
// поставить REWARDS_ENABLED=true, заполнить реальные cost/выдачу, подключить выдачу кода/бонусов.
export const REWARDS_ENABLED = false;
export const REWARDS = [
  { id: "promo5",   name: "Промокод −5%",        cost: 100000, kind: "promo",   note: "скидка на заказ" },
  { id: "promo10",  name: "Промокод −10%",       cost: 250000, kind: "promo",   note: "скидка на заказ" },
  { id: "bonus300", name: "300 бонусов на карту", cost: 200000, kind: "loyalty", note: "клуб «Мария»" },
  { id: "dessert",  name: "Десерт в подарок",     cost: 500000, kind: "promo",   note: "при заказе" },
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
const energyMaxFor = (lvl: number) => 1000 + 500 * lvl;
const perTapFor = (lvl: number) => 1 + lvl;
const cardPrice = (c: { basePrice: number }, lvl: number) => Math.round(c.basePrice * Math.pow(1.7, lvl));
const cardProfit = (c: { baseProfit: number }, lvl: number) => c.baseProfit * lvl;

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
function toMorse(w: string): string { return w.split("").map((c) => MORSE[c] || "").join(" "); }
function parseHits(s: string | null): string[] { return s ? s.split(",").filter(Boolean) : []; }

export interface ClickerState {
  balance: number; totalEarned: number; energy: number; energyMax: number;
  perTap: number; profitPerHour: number; passiveEarned: number;
  level: number; levelName: string; nextNeed: number | null;
  multitapLevel: number; multitapPrice: number;
  energyLevel: number; energyPrice: number;
  cards: { id: string; name: string; cat: string; level: number; profit: number; price: number; req: number; locked: boolean }[];
  // усиления
  dailyAvailable: boolean; dailyStreak: number; dailyNext: number;
  chestAvailable: boolean; rainAvailable: boolean; squad: string | null;
  boostEnergyLeft: number; boostTurboLeft: number; turboMsLeft: number;
  referrals: number; refCode: string; refLink: string;
  combo: { cards: string[]; hits: string[]; complete: boolean; claimed: boolean; reward: number };
  cipher: { morse: string; len: number; claimed: boolean; reward: number };
  taps: number; cardsOwned: number;
  season: { points: number; endsTs: number };
  gamesDone?: string[];
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
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS week_key TEXT;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS week_base BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS bonus_at TIMESTAMPTZ;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS chest_date TEXT;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS rain_date TEXT;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS squad TEXT;
    CREATE INDEX IF NOT EXISTS clicker_squad_idx ON clicker_state (squad);
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
    CREATE INDEX IF NOT EXISTS clicker_redeem_idx ON clicker_redemptions (chat_id, created_at DESC);
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
    CREATE TABLE IF NOT EXISTS clicker_purchase_sync (
      chat_id BIGINT PRIMARY KEY, spent_synced BIGINT NOT NULL DEFAULT 0, last_check TIMESTAMPTZ
    );
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
    cards: CARDS.map((c) => { const lv = cl[c.id] || 0; const locked = lv === 0 && !!c.req && lg.level < c.req; return { id: c.id, name: c.name, cat: c.cat, level: lv, profit: cardProfit(c, lv + 1), price: cardPrice(c, lv), req: c.req || 0, locked }; }),
    dailyAvailable: r.daily_date !== today, dailyStreak: r.daily_streak, dailyNext: dailyReward((r.daily_date === today ? r.daily_streak : r.daily_streak + 1)),
    chestAvailable: r.chest_date !== today,
    rainAvailable: r.rain_date !== today,
    squad: r.squad || null,
    boostEnergyLeft: DAILY_BOOSTS - bUsedE, boostTurboLeft: DAILY_BOOSTS - bUsedT, turboMsLeft: turboMs,
    referrals: r.referrals || 0, refCode: String(r.chat_id), refLink: clickerReferralLink(Number(r.chat_id)),
    combo: (() => { const cards = todaysCombo(today); const hits = r.combo_date === today ? parseHits(r.combo_hits) : []; return { cards, hits, complete: cards.every((c) => hits.includes(c)), claimed: r.combo_claimed === today, reward: COMBO_REWARD }; })(),
    cipher: { morse: toMorse(todaysCipher(today)), len: todaysCipher(today).length, claimed: r.cipher_date === today, reward: CIPHER_REWARD },
    taps: Number(r.taps || 0), cardsOwned: CARDS.filter((c) => (cl[c.id] || 0) > 0).length,
    season: { points: r.week_key === weekKey() ? Math.max(0, Number(r.total_earned) - Number(r.week_base || 0)) : 0, endsTs: seasonEndsTs() },
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
  // сезон: новая неделя → база = текущий total (очки сезона обнуляются)
  const wk = weekKey();
  if (r.week_key !== wk) { r.week_key = wk; r.week_base = Number(r.total_earned); }
  await client.query(
    `UPDATE clicker_state SET balance=$2, total_earned=$3, energy=$4, boost_energy_used=$5, boost_turbo_used=$6, boost_date=$7, week_key=$8, week_base=$9, updated_at=NOW() WHERE chat_id=$1`,
    [chatId, r.balance, r.total_earned, r.energy, r.boost_energy_used, r.boost_turbo_used, r.boost_date, r.week_key, r.week_base]
  );
  // аналитика: повышение уровня (одно событие на уровень, из любого источника дохода)
  const lvlNow = leagueFor(Number(r.total_earned)).level;
  if (lvlNow > (r.notified_level || 0)) {
    if (lvlNow >= 2) trackEvent(chatId, "levelup", { level: lvlNow });
    await client.query(`UPDATE clicker_state SET notified_level=$2 WHERE chat_id=$1`, [chatId, lvlNow]);
    r.notified_level = lvlNow;
  }
  return { r, cl, passive };
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
    else if (type === "card") { const c = id && CARD_BY_ID[id]; if (!c) { await client.query("ROLLBACK"); return { ok: false, reason: "bad_card" }; } const lv = cl[id!] || 0; if (lv === 0 && c.req && leagueFor(Number(r.total_earned)).level < c.req) { await client.query("ROLLBACK"); return { ok: false, reason: "locked" }; } cost = cardPrice(c, lv); }
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

/** Промокоды: коды из data/clicker-codes.json (live-read), 1 раз на игрока. */
function loadCodes(): { code: string; reward: number; active?: boolean }[] {
  try { const raw = fs.readFileSync(path.resolve("data/clicker-codes.json"), "utf8"); const arr = JSON.parse(raw); return Array.isArray(arr) ? arr : []; } catch (_) { return []; }
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
    await client.query(`UPDATE clicker_state SET balance=$2, total_earned=$3, updated_at=NOW() WHERE chat_id=$1`, [chatId, r.balance, r.total_earned]);
    await client.query("COMMIT");
    return { ok: true, reward, state: buildState(r, cl, 0) };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

/** Мини-игра «Золотой дождь»: 1/день. Очки клиента клампятся (анти-чит) → монеты. */
const RAIN_SCORE_CAP = 120;
export async function claimRain(chatId: number, score: number): Promise<{ ok: boolean; reward?: number; state?: ClickerState; reason?: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cl } = await refresh(client, chatId);
    const today = irkToday();
    if (r.rain_date === today) { await client.query("ROLLBACK"); return { ok: false, reason: "already" }; }
    const sc = Math.max(0, Math.min(RAIN_SCORE_CAP, Math.floor(Number(score) || 0)));
    const lvl = leagueFor(Number(r.total_earned)).level;
    const reward = Math.min(80000, sc * (60 + lvl * 20));
    r.balance = Number(r.balance) + reward; r.total_earned = Number(r.total_earned) + reward; r.rain_date = today;
    await client.query(`UPDATE clicker_state SET balance=$2, total_earned=$3, rain_date=$4, updated_at=NOW() WHERE chat_id=$1`, [chatId, r.balance, r.total_earned, today]);
    await client.query("COMMIT");
    return { ok: true, reward, state: buildState(r, cl, 0) };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

// ── Мини-игры хаба «Игры» (детские квизы + казуальные). 1 заход/день на игру ──
// Доверяем клампнутому клиентскому счёту (как «Золотой дождь»): cap = макс. очков,
// per = монет за очко. Банк вопросов/контент — целиком во фронте catclick.js.
const GAME_CFG: Record<string, { cap: number; per: number }> = {
  quiz_kids:   { cap: 5,   per: 1000 }, // Котовикторина: 5 вопросов × 1000
  quiz_riddle: { cap: 4,   per: 1200 }, // Загадки: 4 × 1200
  count:       { cap: 6,   per: 400  }, // Счёт конфет: 6 × 400
  memory:      { cap: 100, per: 60   }, // «Собери торт»: очки 0..100
  gems:        { cap: 200, per: 45   }, // «Сладкий ряд» (match-3): собрано конфет
  tower:       { cap: 200, per: 60   }, // «Башня тортов»: коржей в башне
};
export async function claimGame(chatId: number, game: string, score: number): Promise<{ ok: boolean; reward?: number; game?: string; state?: ClickerState; reason?: string }> {
  const cfg = GAME_CFG[game]; if (!cfg) return { ok: false, reason: "bad_game" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cl } = await refresh(client, chatId);
    const today = irkToday();
    const ex = await client.query(`SELECT day FROM clicker_daily WHERE chat_id=$1 AND game=$2`, [chatId, game]);
    if (ex.rows.length && ex.rows[0].day === today) { await client.query("ROLLBACK"); return { ok: false, reason: "already" }; }
    const sc = Math.max(0, Math.min(cfg.cap, Math.floor(Number(score) || 0)));
    const reward = sc * cfg.per;
    r.balance = Number(r.balance) + reward; r.total_earned = Number(r.total_earned) + reward;
    await client.query(`INSERT INTO clicker_daily (chat_id, game, day) VALUES ($1,$2,$3) ON CONFLICT (chat_id, game) DO UPDATE SET day=$3`, [chatId, game, today]);
    await client.query(`UPDATE clicker_state SET balance=$2, total_earned=$3, updated_at=NOW() WHERE chat_id=$1`, [chatId, r.balance, r.total_earned]);
    const st = buildState(r, cl, 0); st.gamesDone = await gamesDoneToday(client, chatId);
    await client.query("COMMIT");
    return { ok: true, reward, game, state: st };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

/** Сундук удачи: 1 открытие в день, взвешенный приз (решается на сервере). */
function rollChest(level: number): { type: string; amount?: number } {
  const r = Math.random(); const sc = 1 + level * 0.25;
  if (r < 0.42) return { type: "coins", amount: Math.round((300 + Math.random() * 1000) * sc) };
  if (r < 0.68) return { type: "coins", amount: Math.round((1200 + Math.random() * 2500) * sc) };
  if (r < 0.82) return { type: "turbo" };
  if (r < 0.95) return { type: "energy" };
  return { type: "jackpot", amount: Math.round(5000 + Math.random() * 15000) };
}
export async function openChest(chatId: number): Promise<{ ok: boolean; prize?: { type: string; amount?: number }; state?: ClickerState; reason?: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cl } = await refresh(client, chatId);
    const today = irkToday();
    if (r.chest_date === today) { await client.query("ROLLBACK"); return { ok: false, reason: "already" }; }
    const prize = rollChest(leagueFor(Number(r.total_earned)).level);
    if (prize.type === "coins" || prize.type === "jackpot") { r.balance = Number(r.balance) + (prize.amount || 0); r.total_earned = Number(r.total_earned) + (prize.amount || 0); }
    else if (prize.type === "turbo") { r.turbo_until = new Date(Date.now() + TURBO_SEC * 1000); }
    else if (prize.type === "energy") { r.energy = energyMaxFor(r.energy_limit_level); }
    r.chest_date = today;
    await client.query(`UPDATE clicker_state SET balance=$2, total_earned=$3, energy=$4, turbo_until=$5, chest_date=$6, updated_at=NOW() WHERE chat_id=$1`,
      [chatId, r.balance, r.total_earned, r.energy, r.turbo_until || null, today]);
    await client.query("COMMIT");
    return { ok: true, prize, state: buildState(r, cl, 0) };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

/** «Золотой котик»: случайный летящий бонус. Кулдаун 45с (анти-чит), сумма по уровню. */
const BONUS_COOLDOWN_MS = 45000;
export async function claimBonus(chatId: number): Promise<{ ok: boolean; amount?: number; state?: ClickerState; reason?: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cl } = await refresh(client, chatId);
    if (r.bonus_at && Date.now() - new Date(r.bonus_at).getTime() < BONUS_COOLDOWN_MS) { await client.query("ROLLBACK"); return { ok: false, reason: "cooldown" }; }
    const lvl = leagueFor(Number(r.total_earned)).level;
    const amount = Math.min(60000, Math.round(300 + Math.random() * (700 + lvl * 600)));
    r.balance = Number(r.balance) + amount; r.total_earned = Number(r.total_earned) + amount;
    await client.query(`UPDATE clicker_state SET balance=$2, total_earned=$3, bonus_at=NOW(), updated_at=NOW() WHERE chat_id=$1`, [chatId, r.balance, r.total_earned]);
    await client.query("COMMIT");
    return { ok: true, amount, state: buildState(r, cl, 0) };
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

/** Топ игроков за СЕЗОН (текущая неделя): очки = total_earned − week_base. Имя из subscribers. */
export async function getTop(chatId: number, limit = 30): Promise<{
  top: { name: string; total: number; me: boolean }[]; myRank: number | null; seasonEndsTs: number;
  weekly: { enabled: boolean; prizes: { rank: number; points: number; label: string }[]; lastWeek: { rank: number; name: string; points: number; me: boolean }[] };
}> {
  const cur = weekKey();
  const { rows } = await pool.query(
    `SELECT c.chat_id, (c.total_earned - c.week_base) AS pts, s.first_name, s.username
       FROM clicker_state c LEFT JOIN subscribers s ON s.chat_id = c.chat_id
      WHERE c.week_key = $2 AND (c.total_earned - c.week_base) > 0
      ORDER BY pts DESC LIMIT $1`, [limit, cur]
  );
  const top = rows.map((r) => ({ name: (r.first_name || r.username || "Котовод").toString().slice(0, 24), total: Number(r.pts), me: Number(r.chat_id) === chatId }));
  const me = await pool.query(`SELECT week_key, (total_earned - week_base) AS pts FROM clicker_state WHERE chat_id=$1`, [chatId]);
  const myPts = me.rows.length && me.rows[0].week_key === cur ? Number(me.rows[0].pts) : 0;
  const rank = await pool.query(`SELECT COUNT(*)::int AS n FROM clicker_state WHERE week_key=$2 AND (total_earned - week_base) > $1`, [myPts, cur]);
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
 * Закрытие недельного сезона (#7) — крон в понедельник ~00:02 Иркутск, ДО того как
 * активные игроки обнулят свой week_base в новой неделе. Фиксирует топ-3 завершившейся
 * недели и (если WEEKLY_PRIZES_ENABLED) начисляет баллы на карту подтверждённым.
 * Идемпотентно: повторный вызов за ту же неделю ничего не задвоит.
 * Пуш победителям — отдельно днём (pushWeeklyWinners), чтобы не будить ночью.
 */
export async function closeWeeklySeason(): Promise<{ week: string; recorded: number; awarded: number }> {
  const endedKey = String(weekMonday() - 7);
  const exist = await pool.query(`SELECT 1 FROM clicker_week_winners WHERE week_key=$1 LIMIT 1`, [endedKey]);
  if (exist.rowCount) { log.info({ endedKey }, "[weekly] already closed"); return { week: endedKey, recorded: 0, awarded: 0 }; }
  const { rows } = await pool.query(
    `SELECT chat_id, (total_earned - week_base) AS pts
       FROM clicker_state
      WHERE week_key = $1 AND (total_earned - week_base) > 0
      ORDER BY pts DESC LIMIT 3`, [endedKey]
  );
  if (!rows.length) { log.info({ endedKey }, "[weekly] no participants"); return { week: endedKey, recorded: 0, awarded: 0 }; }
  let recorded = 0, awarded = 0;
  for (let i = 0; i < rows.length; i++) {
    const rank = i + 1, chatId = Number(rows[i].chat_id), pts = Number(rows[i].pts);
    const prize = WEEKLY_PRIZE_BY_RANK[rank];
    let prizePoints = 0, didAward = false;
    if (WEEKLY_PRIZES_ENABLED && prize) {
      const verified = await isPhoneVerified(chatId).catch(() => false);
      if (verified) {
        await earnPoints(chatId, prize.points, "clicker_weekly_top", { rank, week: endedKey }).catch(() => {});
        prizePoints = prize.points; didAward = true; awarded++;
      }
    }
    await pool.query(
      `INSERT INTO clicker_week_winners (week_key, rank, chat_id, points, prize_points, awarded)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (week_key, rank) DO NOTHING`,
      [endedKey, rank, chatId, pts, prizePoints, didAward]
    );
    recorded++;
  }
  log.info({ endedKey, recorded, awarded, enabled: WEEKLY_PRIZES_ENABLED }, "[weekly] season closed");
  return { week: endedKey, recorded, awarded };
}

/**
 * Пуш победителям прошлой недели — крон в понедельник днём (не в тихие часы).
 * Только при включённых призах (иначе нечего обещать). Дедуп по флагу pushed.
 */
export async function pushWeeklyWinners(push: PushService): Promise<{ sent: number }> {
  if (!WEEKLY_PRIZES_ENABLED) return { sent: 0 };
  const endedKey = String(weekMonday() - 7);
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
    const ok = await push.sendPushSafely(chatId, "marketing_game", text);
    if (ok) {
      await pool.query(`UPDATE clicker_week_winners SET pushed=TRUE WHERE week_key=$1 AND rank=$2`, [endedKey, rank]);
      sent++;
    }
  }
  if (sent) log.info({ endedKey, sent }, "[weekly] winners notified");
  return { sent };
}

/** Команды: рейтинг по сумме намолоченного, выбор/смена команды. */
export async function getSquads(chatId: number): Promise<{ squads: { id: string; name: string; points: number; members: number }[]; mySquad: string | null }> {
  const { rows } = await pool.query(`SELECT squad, SUM(total_earned)::bigint AS pts, COUNT(*)::int AS n FROM clicker_state WHERE squad IS NOT NULL GROUP BY squad`);
  const agg: Record<string, { pts: number; n: number }> = {}; for (const r of rows) agg[r.squad] = { pts: Number(r.pts), n: r.n };
  const me = await pool.query(`SELECT squad FROM clicker_state WHERE chat_id=$1`, [chatId]);
  const squads = SQUADS.map((s) => ({ id: s.id, name: s.name, points: agg[s.id]?.pts || 0, members: agg[s.id]?.n || 0 })).sort((a, b) => b.points - a.points);
  return { squads, mySquad: (me.rows[0] && me.rows[0].squad) || null };
}
export async function joinSquad(chatId: number, squadId: string): Promise<{ ok: boolean; state?: ClickerState; reason?: string }> {
  if (!SQUAD_IDS.has(squadId)) return { ok: false, reason: "bad_squad" };
  await pool.query(`INSERT INTO clicker_state (chat_id, squad) VALUES ($1,$2) ON CONFLICT (chat_id) DO UPDATE SET squad=$2`, [chatId, squadId]);
  return { ok: true, state: await getClicker(chatId) };
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

/**
 * Перенос прогресса гостя (localStorage) на серверный аккаунт при первом входе.
 * ТОЛЬКО в свежий аккаунт (total=0, нет карт, нет тапов) — чтобы не затереть
 * реальный прогресс. Данные гостя самозаявленные → анти-чит кэпы (MIGRATE_CAP,
 * лимиты уровней). Идемпотентно: на не-свежий аккаунт вернёт not_fresh.
 */
const MIGRATE_CAP = 300000;          // потолок переносимых монет (хватает на ранний гейм)
const MIGRATE_CARD_MAX = 10;         // потолок уровня бизнеса
const MIGRATE_UP_MAX = 20;           // потолок уровня мультитапа/энергии
export async function migrateGuest(chatId: number, snap: any): Promise<{ ok: boolean; migrated?: number; state?: ClickerState; reason?: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cl } = await refresh(client, chatId);
    if (Number(r.total_earned) > 0 || Object.keys(cl).length > 0 || Number(r.taps) > 0) { await client.query("ROLLBACK"); return { ok: false, reason: "not_fresh" }; }
    const capCoins = (v: any) => Math.max(0, Math.min(MIGRATE_CAP, Math.floor(Number(v) || 0)));
    const total = capCoins(snap && snap.totalEarned);
    const bal = Math.min(total, capCoins(snap && snap.balance));
    const mt = Math.max(0, Math.min(MIGRATE_UP_MAX, Math.floor(Number(snap && snap.multitapLevel) || 0)));
    const en = Math.max(0, Math.min(MIGRATE_UP_MAX, Math.floor(Number(snap && snap.energyLevel) || 0)));
    const taps = Math.max(0, Math.min(100000, Math.floor(Number(snap && snap.taps) || 0)));
    r.balance = bal; r.total_earned = total; r.multitap_level = mt; r.energy_limit_level = en;
    await client.query(`UPDATE clicker_state SET balance=$2, total_earned=$3, multitap_level=$4, energy_limit_level=$5, taps=$6, updated_at=NOW() WHERE chat_id=$1`, [chatId, bal, total, mt, en, taps]);
    if (snap && snap.cards && typeof snap.cards === "object") {
      for (const c of CARDS) {
        const lv = Math.max(0, Math.min(MIGRATE_CARD_MAX, Math.floor(Number(snap.cards[c.id]) || 0)));
        if (lv > 0) { cl[c.id] = lv; await client.query(`INSERT INTO clicker_cards (chat_id, card, level) VALUES ($1,$2,$3) ON CONFLICT (chat_id, card) DO UPDATE SET level=$3`, [chatId, c.id, lv]); }
      }
    }
    const st = buildState(r, cl, 0); st.gamesDone = await gamesDoneToday(client, chatId);
    await client.query("COMMIT");
    return { ok: true, migrated: total, state: st };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

/** Витрина реальных наград (обмен монет). Пока enabled=false — только показ. */
export async function getRewards(chatId: number): Promise<{ enabled: boolean; balance: number; rewards: any[]; history: any[] }> {
  const s = await getClicker(chatId);
  const { rows } = await pool.query(`SELECT reward_id, cost, code, created_at FROM clicker_redemptions WHERE chat_id=$1 ORDER BY created_at DESC LIMIT 10`, [chatId]);
  return { enabled: REWARDS_ENABLED, balance: s.balance, rewards: REWARDS, history: rows };
}

/**
 * Обмен монет на реальную награду. ⚠️ Пока REWARDS_ENABLED=false → всегда отказ.
 * Когда включат: атомарно списывает монеты, пишет в clicker_redemptions, лимит REDEEM_PER_DAY/день.
 * TODO выдача: промокод (генерация/Bitrix promo) или бонусы на карту (loyalty API) — по решению Маши.
 */
export async function redeemReward(chatId: number, id: string): Promise<{ ok: boolean; code?: string; state?: ClickerState; reason?: string }> {
  if (!REWARDS_ENABLED) return { ok: false, reason: "disabled" };
  const rw = REWARD_BY_ID[id]; if (!rw) return { ok: false, reason: "bad_reward" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cl } = await refresh(client, chatId);
    const used = await client.query(`SELECT COUNT(*)::int AS n FROM clicker_redemptions WHERE chat_id=$1 AND created_at > NOW() - INTERVAL '1 day'`, [chatId]);
    if (used.rows[0].n >= REDEEM_PER_DAY) { await client.query("ROLLBACK"); return { ok: false, reason: "daily_limit" }; }
    if (Number(r.balance) < rw.cost) { await client.query("ROLLBACK"); return { ok: false, reason: "not_enough" }; }
    r.balance = Number(r.balance) - rw.cost; // total_earned НЕ трогаем (уровень/сезон сохраняются)
    const code = "MARIA-" + String(Math.abs(chatId)).slice(-4) + "-" + id.toUpperCase(); // TODO: реальная генерация
    await client.query(`INSERT INTO clicker_redemptions (chat_id, reward_id, cost, code) VALUES ($1,$2,$3,$4)`, [chatId, id, rw.cost, code]);
    await client.query(`UPDATE clicker_state SET balance=$2, updated_at=NOW() WHERE chat_id=$1`, [chatId, r.balance]);
    await client.query("COMMIT");
    return { ok: true, code, state: buildState(r, cl, 0) };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

function taskClaimable(t: any, s: ClickerState): boolean {
  if (t.type === "link") return true;
  if (t.type === "level") return s.level >= t.target;
  if (t.type === "balance") return s.totalEarned >= t.target;
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
    await client.query(`UPDATE clicker_state SET balance=$2, total_earned=$3, updated_at=NOW() WHERE chat_id=$1`, [chatId, r.balance, r.total_earned]);
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
  { id: "ms_lvl19",    title: "Последний уровень — Повелитель котов", cond: { type: "level", target: 19 }, points: 20000, perk: "free_bento_top", perkText: "Бенто-торт в подарок (от 1000₽)" },
  { id: "ms_col_prod", title: "Все голуби «Производство»", cond: { type: "collect", target: "prod" },  points: 300 },
  { id: "ms_col_mkt",  title: "Все голуби «Маркетинг»",    cond: { type: "collect", target: "mkt" },   points: 300 },
  { id: "ms_col_staff",title: "Все голуби «Персонал»",     cond: { type: "collect", target: "staff" }, points: 300 },
  { id: "ms_col_net",  title: "Все голуби «Сеть»",         cond: { type: "collect", target: "net" },   points: 300 },
  { id: "ms_col_all",  title: "Вся коллекция голубей",     cond: { type: "collect", target: "all" },   perk: "free_bento",  perkText: "Бенто-торт в подарок (от 2000₽)" },
  { id: "ms_ref3",     title: "Пригласил 3 друзей",        cond: { type: "ref", target: 3 },       points: 500 },
  { id: "ms_ref10",    title: "Пригласил 10 друзей",       cond: { type: "ref", target: 10 },      perk: "discount_10", perkText: "Промокод −10% (от 1000₽)" },
];
const MS_BY_ID = Object.fromEntries(MILESTONES.map((m) => [m.id, m]));
const msReached = (m: any, s: ClickerState) => taskClaimable({ type: m.cond.type, target: m.cond.target } as any, s);

export async function getMilestones(chatId: number): Promise<{ milestones: any[]; phoneVerified: boolean }> {
  const s = await getClicker(chatId);
  const gr = await pool.query(`SELECT achievement FROM clicker_gifts WHERE chat_id=$1`, [chatId]);
  const granted = new Set(gr.rows.map((r) => r.achievement));
  const phoneVerified = await isPhoneVerified(chatId).catch(() => false);
  return {
    phoneVerified,
    milestones: MILESTONES.map((m) => ({
      id: m.id, title: m.title,
      kind: m.perk && m.points ? "both" : (m.perk ? "perk" : "points"),
      points: m.points || 0, perkText: m.perkText || "",
      reached: msReached(m, s), granted: granted.has(m.id),
    })),
  };
}

/** Забрать награду за веху: баллы на карту или перк-купон. 1 раз, телефон обязателен. */
export async function claimMilestone(chatId: number, id: string): Promise<{ ok: boolean; kind?: string; points?: number; promoCode?: string; perkTitle?: string; minOrder?: number; reason?: string }> {
  if (!GIFTS_ENABLED) return { ok: false, reason: "disabled" };
  const m: any = MS_BY_ID[id]; if (!m) return { ok: false, reason: "no_milestone" };
  const s = await getClicker(chatId);
  if (!msReached(m, s)) return { ok: false, reason: "not_ready" };
  if (!(await isPhoneVerified(chatId).catch(() => false))) return { ok: false, reason: "need_phone" };
  // Бронируем выдачу (PK clicker_gifts) — защита от двойной выдачи.
  const ins = await pool.query(
    `INSERT INTO clicker_gifts (chat_id, achievement, points) VALUES ($1,$2,$3)
     ON CONFLICT (chat_id, achievement) DO NOTHING RETURNING achievement`,
    [chatId, id, m.points || 0]
  );
  if (!ins.rows.length) return { ok: false, reason: "already" };
  try {
    const out: { ok: boolean; kind: string; points?: number; promoCode?: string; perkTitle?: string; minOrder?: number } = {
      ok: true, kind: m.perk && m.points ? "both" : (m.perk ? "perk" : "points"),
    };
    if (m.points) { await earnPoints(chatId, m.points, "clicker_milestone", { milestone: id }); out.points = m.points; }
    if (m.perk) {
      const r = await grantRewardByCode(chatId, m.perk);
      if (!r.ok) throw new Error("grant_failed:" + r.reason);
      out.promoCode = r.promoCode; out.perkTitle = r.title; out.minOrder = r.minOrder;
    }
    return out;
  } catch (e) {
    await pool.query(`DELETE FROM clicker_gifts WHERE chat_id=$1 AND achievement=$2`, [chatId, id]).catch(() => {});
    throw e;
  }
}

// ── Реальные покупки → игровые монеты (чем больше тратишь у «Марии», тем больше) ──
// Сигнал — year_spent из /api/lk (lk.php, уже работает). За НОВЫЕ траты с прошлой
// сверки начисляем монеты (watermark spent_synced — не задвоить). Троттлинг 1ч,
// чтобы не дёргать сайт. Первый заход начисляет за весь YTD (приветствие лояльным).
const PURCHASE_RATE = 20;            // монет за 1₽ покупок
const PURCHASE_CAP = 5_000_000;      // потолок одной сверки (защита от выбросов/данных)
export async function syncPurchaseBonus(chatId: number): Promise<{ ok: boolean; granted: number; yearSpent?: number; state?: ClickerState }> {
  // Атомарно «застолбить» сверку: вставить/обновить last_check, только если прошло >1ч.
  const claim = await pool.query(
    `INSERT INTO clicker_purchase_sync (chat_id, last_check) VALUES ($1, NOW())
     ON CONFLICT (chat_id) DO UPDATE SET last_check = NOW()
       WHERE clicker_purchase_sync.last_check IS NULL OR clicker_purchase_sync.last_check < NOW() - INTERVAL '1 hour'
     RETURNING spent_synced`,
    [chatId]
  );
  if (!claim.rows.length) return { ok: true, granted: 0 }; // троттлинг — сверка была недавно

  const spentSynced = Number(claim.rows[0].spent_synced || 0);
  const lk = await fetchLk(chatId).catch(() => null);
  if (!lk || !lk.ok || !lk.data || !lk.data.configured) return { ok: true, granted: 0 };
  const yearSpent = Math.max(0, Math.floor(Number(lk.data.year_spent || 0)));
  const delta = Math.max(0, yearSpent - spentSynced); // откат/новый год → 0, watermark подвинем
  // Двигаем watermark всегда (в т.ч. при rollover вниз), чтобы не копить ложный delta.
  await pool.query(`UPDATE clicker_purchase_sync SET spent_synced=$2 WHERE chat_id=$1`, [chatId, yearSpent]);
  const grant = Math.min(delta * PURCHASE_RATE, PURCHASE_CAP);
  if (grant <= 0) return { ok: true, granted: 0, yearSpent };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cl } = await refresh(client, chatId);
    r.balance = Number(r.balance) + grant; r.total_earned = Number(r.total_earned) + grant;
    await client.query(`UPDATE clicker_state SET balance=$2, total_earned=$3, updated_at=NOW() WHERE chat_id=$1`, [chatId, r.balance, r.total_earned]);
    const st = buildState(r, cl, 0); st.gamesDone = await gamesDoneToday(client, chatId);
    await client.query("COMMIT");
    return { ok: true, granted: grant, yearSpent, state: st };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

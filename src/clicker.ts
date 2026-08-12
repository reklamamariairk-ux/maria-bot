/**
 * Кликер «Котик Комбат» (Hamster Kombat-стиль) — экономика + усиления.
 * Тап (с комбо/турбо), энергия, апгрейды (мультитап/энергия), бизнесы (пассив,
 * капает офлайн), бусты (турбо ×5 / полная энергия, 6/день), ежедневная награда
 * (стрик), лидерборд. Антинакрутка: энергия/пассив/турбо считаются на сервере.
 */
import crypto from "crypto";
import { pool } from "./db";
import { clickerReferralLink, miniAppLink } from "./links";
import { earnPoints, isPhoneVerified, grantRewardByCode } from "./club";
import { fetchLk } from "./lk";
import * as fs from "fs";
import * as path from "path";
import { trackEvent } from "./analytics";
import type { PushService } from "./push";
import type { PoolClient } from "pg";
import { log } from "./logger";

// Подарки за достижения → реальные баллы на карту клуба «Мария» (earnPoints).
// Выдаются ОДИН раз, только игроку с подтверждённым телефоном. Суммы — в gift у
// достижения ниже. ⚠️ Реальная ценность (баллы клуба) — согласовать суммы с Машей.
export const GIFTS_ENABLED = true;

const REGEN_PER_SEC = 1.5;
const TAP_COST = 1;
// «Сладкий тап» (вкладка Котик, 31.07): каждый N-й lifetime-тап — крит ×MULT.
// Детерминирован от счётчика taps → клиент показывает бурст ровно на том же тапе,
// на котором сервер начисляет (батчи сходятся до монеты). Средний буст тапов ≈ +17%.
// ⚠️ Зеркало в catclick.js (SWEET_TAP_*) — менять синхронно.
export const SWEET_TAP_EVERY = 40;
export const SWEET_TAP_MULT = 8;
/** Сколько «сладких» (кратных SWEET_TAP_EVERY) тапов попало в батч (oldTaps, oldTaps+can]. */
export function sweetCritsIn(oldTaps: number, can: number): number {
  return Math.floor((oldTaps + can) / SWEET_TAP_EVERY) - Math.floor(oldTaps / SWEET_TAP_EVERY);
}
const MAX_TAPS_PER_REQ = 600;
const MAX_TAP_FINGERS = 4;
const MAX_TAPS_PER_FINGER_PER_SEC = 10;
const MAX_TAPS_PER_SEC = MAX_TAP_FINGERS * MAX_TAPS_PER_FINGER_PER_SEC;
const TAP_BUCKET_BURST_SEC = 2;
const tapBuckets = new Map<number, { tokens: number; ts: number }>();
function takeTapAllowance(chatId: number, requested: number): number {
  const want = Math.max(0, Math.min(MAX_TAPS_PER_REQ, Math.floor(requested)));
  if (want <= 0) return 0;
  const now = Date.now();
  const cap = MAX_TAPS_PER_SEC * TAP_BUCKET_BURST_SEC;
  const prev = tapBuckets.get(chatId) || { tokens: cap, ts: now };
  const elapsed = Math.max(0, (now - prev.ts) / 1000);
  const tokens = Math.min(cap, prev.tokens + elapsed * MAX_TAPS_PER_SEC);
  const take = Math.min(want, Math.floor(tokens));
  tapBuckets.set(chatId, { tokens: tokens - take, ts: now });
  if (tapBuckets.size > 10000) {
    for (const [id, b] of tapBuckets) if (now - b.ts > 10 * 60_000) tapBuckets.delete(id);
  }
  return take;
}
const PASSIVE_CAP_HOURS = 3;
const TURBO_MULT = 5;
const TURBO_SEC = 20;
const DAILY_BOOSTS = 6;           // бесплатных бустов каждого типа в день
const REF_INVITEE = 2500;         // бонус приглашённому
const REF_REFERRER = 30000;       // бонус пригласившему (поднято юзером 31.07 с 5000)
const irkToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
// Экспорт для голубиной почты (pigeons.ts::sendMail — лимит 1 письмо/день по Иркутску).
// Ленивый импорт на стороне pigeons.ts (await import("./clicker")) — см. комментарий там.
export const todayIrkutsk = irkToday;
// Сезон = неделя по Иркутску (сброс в понедельник 00:00). Ключ — индекс дня-понедельника.
export function weekMonday(): number { const d = Math.floor((Date.now() + 8 * 3600 * 1000) / 86400000); return d - ((d + 3) % 7); }
export const weekKey = () => String(weekMonday());
const seasonEndsTs = () => (weekMonday() + 7) * 86400000 - 8 * 3600 * 1000; // ms UTC начала след. недели

// ── Престиж (#9) ─────────────────────────────────────────────────────────────
// После макс. уровня (19) игрок может «уйти в престиж»: прогресс сбрасывается, но
// даётся ПОСТОЯННЫЙ множитель к заработку (+10% за престиж, стак до x2). Чисто
// игровая прогрессия (никакой реальной стоимости) — Маша не нужна.
const PRESTIGE_MIN_LEVEL = 19;
const PRESTIGE_BONUS = 0.1;   // +10% к тапу и пассиву за каждый престиж
const PRESTIGE_MAX = 10;
const prestigeMultOf = (p: number) => 1 + Math.min(Math.max(0, p || 0), PRESTIGE_MAX) * PRESTIGE_BONUS;

// ── Ивенты (#9) ──────────────────────────────────────────────────────────────
// Временные окна с множителем монет. v1 — «Выходные ×2» (сб/вс по Иркутску). Чисто
// игровые монеты, всем поровну. Флаг — на случай быстрого выключения.
export const EVENTS_ENABLED = true;
function activeEvent(): { id: string; name: string; mult: number; endsTs: number } | null {
  if (!EVENTS_ENABLED) return null;
  const wd = new Date(Date.now() + 8 * 3600 * 1000).getUTCDay(); // 0=вс … 6=сб (Иркутск)
  if (wd === 6 || wd === 0) return { id: "weekend", name: "Выходные ×2", mult: 2, endsTs: seasonEndsTs() };
  return null;
}
const eventMult = () => activeEvent()?.mult ?? 1;
// Общий множитель заработка (тап + пассив): престиж × ивент.
const gainMult = (prestige: number) => prestigeMultOf(prestige) * eventMult();

// Соцссылки «Марии» для заданий-маркетинга. ⚠️ Продублировано во фронте catclick.js.
// Пустая ссылка = задание скрыто (не отправляем людей в никуда). Заполнить реальными URL.
export const SOCIAL = {
  review: "https://yandex.ru/maps/?text=Мария кондитерская Иркутск",
  vk: "",   // группы ВК у «Марии» пока нет (подтверждено 14.07.2026) — заполнить при появлении
  tg: "https://t.me/mariatortik_bot",   // канала нет — задание ведёт в бота (переток VK-аудитории)
};

// Задания. type: link (открыть ссылку → забрать) | level | balance | streak | ref (по достижению цели).
// Задания-маркетинг с пустой ссылкой автоматически отфильтровываются (скрыты до заполнения SOCIAL).
export const TASKS = [
  { id: "site",     name: "Заглянуть на сайт «Мария»", icon: "🌐", reward: 1500, type: "link", link: "https://www.maria-irk.ru/" },
  { id: "review",   name: "Оставить отзыв о «Марии»",   icon: "⭐", reward: 5000, type: "link", link: SOCIAL.review },
  { id: "vk",       name: "Подписаться на ВК «Мария»",  icon: "👍", reward: 4000, type: "link", link: SOCIAL.vk },
  { id: "tg",       name: "Открыть Telegram-бот «Марии»", icon: "📣", reward: 4000, type: "link", link: SOCIAL.tg },
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
  { id: "ach_lvl19",   name: "Император выпечки", icon: "star",   reward: 100000, type: "level",   target: 19 },
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

// «Кондитерская карьера Василия» (арт-комплект 08.07.2026) — имена синхронно с
// public/js/catclick.js LEAGUES (там же поле cat); пороги need НЕ менялись.
// Пороги растянуты 15.07 (ранние уровни пролетали за минуты): плавная ~2.1× геометрия,
// финал далеко. Существующие игроки защищены храповиком max_level (см. refresh) —
// уровень не откатывается. ⚠️ Продублировано в public/js/catclick.js — менять синхронно.
export const LEAGUES = [
  { level: 1,  name: "Котёнок-стажёр",     need: 0 },
  { level: 2,  name: "Помощник пекаря",    need: 2000 },
  { level: 3,  name: "Ученик",             need: 6000 },
  { level: 4,  name: "Тестомес",           need: 15000 },
  { level: 5,  name: "Пекарь",             need: 35000 },
  { level: 6,  name: "Мастер круассанов",  need: 75000 },
  { level: 7,  name: "Юный кондитер",      need: 150000 },
  { level: 8,  name: "Тортодел",           need: 320000 },
  { level: 9,  name: "Шоколатье",          need: 650000 },
  { level: 10, name: "Су-шеф",             need: 1300000 },
  { level: 11, name: "Шеф-кондитер",       need: 2600000 },
  { level: 12, name: "Художник десертов",  need: 5200000 },
  { level: 13, name: "Управляющий",        need: 10000000 },
  { level: 14, name: "Владелец кафе",      need: 18000000 },
  { level: 15, name: "Ресторатор",         need: 30000000 },
  { level: 16, name: "Магнат выпечки",     need: 50000000 },
  { level: 17, name: "Легенда",            need: 80000000 },
  { level: 18, name: "Король тортов",      need: 120000000 },
  { level: 19, name: "Император выпечки",  need: 180000000 },
];
function leagueFor(total: number) { let l = LEAGUES[0]; for (const x of LEAGUES) if (total >= x.need) l = x; return l; }
function nextNeed(total: number): number | null { const n = LEAGUES.find((x) => x.need > total); return n ? n.need : null; }

// ── Реальные награды (обмен монет → скидка/бонусы). ⚠️ ВЫКЛ до согласования Маши ──
// Включение — env CLICKER_REWARDS_ENABLED=1 в bot.env + пересоздание контейнера
// (docker compose up -d --force-recreate). Числа (cost/points) — константы ниже:
// при решениях Маши правим числа и включаем env, нового кода не нужно.
export const REWARDS_ENABLED = process.env.CLICKER_REWARDS_ENABLED === "1";
export const REWARDS: { id: string; name: string; cost: number; kind: "promo" | "loyalty"; catalog?: string; points?: number; note: string }[] = [
  { id: "promo5",   name: "Промокод −5%",         cost: 100000, kind: "promo",   catalog: "discount_5",   note: "скидка на заказ" },
  { id: "promo10",  name: "Промокод −10%",        cost: 250000, kind: "promo",   catalog: "discount_10",  note: "скидка на заказ" },
  { id: "bonus300", name: "300 баллов на карту",  cost: 200000, kind: "loyalty", points: 300,             note: "клуб «Мария»" },
  { id: "dessert",  name: "Десерт в подарок",     cost: 500000, kind: "promo",   catalog: "free_dessert", note: "при заказе" },
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
// Анаграмма вместо морзе (аудит 30.07: азбука Морзе — барьер для аудитории кондитерской;
// слово и проверка те же, меняется только подача). Детерминированный шафл от даты —
// у всех игроков одинаковая перемешка. ⚠️ Зеркало в catclick.js — менять синхронно.
function scrambleWord(word: string, day: string): string {
  const letters = word.split("");
  let s = (dateSeed(day, "scramble") || 1) & 0x7fffffff;
  for (let i = letters.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }
  const out = letters.join("");
  return out === word ? letters.reverse().join("") : out;
}
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
  /** ×1.25 при закрытой копилке стаи, иначе 1 (индикатор на главной). */
  bankMult: number;
  boostEnergyLeft: number; boostTurboLeft: number; turboMsLeft: number;
  referrals: number; refCode: string; refLink: string;
  combo: { cards: string[]; hits: string[]; complete: boolean; claimed: boolean; reward: number };
  cipher: { morse: string; anagram: string; len: number; claimed: boolean; reward: number };
  taps: number; cardsOwned: number; onboarded: boolean;
  season: { points: number; endsTs: number };
  prestige: number; prestigeMult: number; prestigeReady: boolean;
  event: { active: boolean; name: string; mult: number; endsTs: number } | null;
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
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS onboarded BOOLEAN NOT NULL DEFAULT FALSE;
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
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS prestige INT NOT NULL DEFAULT 0;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS ftue_claimed INT NOT NULL DEFAULT 0;
    CREATE INDEX IF NOT EXISTS clicker_squad_idx ON clicker_state (squad);
    -- Платный кейс: суммарно потрачено/выиграно игроком (казино-баланс дом/игрок, пити).
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS case_spent BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS case_won BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS case_dry INT NOT NULL DEFAULT 0;
    -- Глобальные значения игры (key→ts): гейт чемпиона «1 раз в год на всех».
    CREATE TABLE IF NOT EXISTS game_globals (key TEXT PRIMARY KEY, ts TIMESTAMPTZ, val TEXT);
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
function profitPerHour(cl: Record<string, number>, albumMult = 1): number { let p = 0; for (const c of CARDS) p += cardProfit(c, cl[c.id] || 0); return p * albumMult; }

function buildState(r: any, cl: Record<string, number>, passiveEarned: number): ClickerState {
  // Эффективный уровень с учётом храповика: не ниже max_level (защита от отката при новых порогах).
  const effLevel = Math.max(leagueFor(Number(r.total_earned)).level, Number(r.max_level) || 1);
  const lg = LEAGUES[effLevel - 1];
  const today = irkToday();
  const turboMs = r.turbo_until ? Math.max(0, new Date(r.turbo_until).getTime() - Date.now()) : 0;
  const bUsedE = r.boost_date === today ? r.boost_energy_used : 0;
  const bUsedT = r.boost_date === today ? r.boost_turbo_used : 0;
  return {
    balance: Number(r.balance), totalEarned: Number(r.total_earned), energy: r.energy, energyMax: energyMaxFor(r.energy_limit_level),
    perTap: perTapFor(r.multitap_level), profitPerHour: profitPerHour(cl, r.__albumMult || 1), passiveEarned,
    bankMult: Number(r.__bankMult || 1),
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
    cipher: { morse: toMorse(todaysCipher(today)), anagram: scrambleWord(todaysCipher(today), today), len: todaysCipher(today).length, claimed: r.cipher_date === today, reward: CIPHER_REWARD },
    taps: Number(r.taps || 0), cardsOwned: CARDS.filter((c) => (cl[c.id] || 0) > 0).length,
    onboarded: !!r.onboarded,
    season: { points: r.week_key === weekKey() ? Math.max(0, Number(r.total_earned) - Number(r.week_base || 0)) : 0, endsTs: seasonEndsTs() },
    prestige: Number(r.prestige || 0), prestigeMult: prestigeMultOf(Number(r.prestige || 0)), prestigeReady: lg.level >= PRESTIGE_MIN_LEVEL,
    event: (() => { const e = activeEvent(); return e ? { active: true, name: e.name, mult: e.mult, endsTs: e.endsTs } : null; })(),
  };
}

async function refresh(client: any, chatId: number): Promise<{ r: any; cl: Record<string, number>; passive: number }> {
  await client.query(`INSERT INTO clicker_state (chat_id) VALUES ($1) ON CONFLICT (chat_id) DO NOTHING`, [chatId]);
  const { rows } = await client.query(`SELECT * FROM clicker_state WHERE chat_id=$1 FOR UPDATE`, [chatId]);
  const r = rows[0];
  // Стартовый голубь: при первом заходе выдаём Сизаря один раз (флаг starter_pigeon),
  // чтобы коллекция не была пустой и механика была сразу понятна. Дёшево: r уже загружен.
  if (!r.starter_pigeon) {
    const { grantPigeon } = await import("./pigeons");
    await grantPigeon(chatId, "sizar", client);
    await client.query(`UPDATE clicker_state SET starter_pigeon=TRUE WHERE chat_id=$1`, [chatId]);
    r.starter_pigeon = true;
  }
  // Храповик уровня: max_level только растёт. Если игрок перешагнул порог по новой кривой —
  // подтягиваем max_level; buildState показывает max(вычисленный, max_level), откат исключён.
  {
    const compLvl = leagueFor(Number(r.total_earned)).level;
    if (compLvl > (Number(r.max_level) || 1)) {
      await client.query(`UPDATE clicker_state SET max_level=$2 WHERE chat_id=$1`, [chatId, compLvl]);
      r.max_level = compLvl;
    }
  }
  const cl = await readCards(client, chatId);
  const today = irkToday();
  if (r.boost_date !== today) { r.boost_energy_used = 0; r.boost_turbo_used = 0; r.boost_date = today; }
  const secs = Math.max(0, (Date.now() - new Date(r.updated_at).getTime()) / 1000);
  r.energy = Math.min(energyMaxFor(r.energy_limit_level), Math.round(r.energy + secs * REGEN_PER_SEC));
  // Перк полного альбома (+5% к пассиву): флаг кэширован на clicker_state.album_bonus
  // (выставляется в grantPigeon при 16/16 пород) — без похода в pigeon_inventory на каждый тап.
  const { ALBUM_PASSIVE_BONUS } = await import("./pigeons");
  const albumMult = r.album_bonus ? 1 + ALBUM_PASSIVE_BONUS : 1;
  r.__albumMult = albumMult;
  // Копилка стаи: закрытая цель недели множит ВЕСЬ доход (пассив здесь, тапы в tapClicker)
  const bankMult = (await squadBankActive(r.squad || null)) ? SQUAD_BANK_MULT : 1;
  r.__bankMult = bankMult;
  const passive = Math.floor(profitPerHour(cl, albumMult) * Math.min(secs / 3600, PASSIVE_CAP_HOURS) * gainMult(r.prestige) * bankMult);
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

// Тонкий вариант refresh() для драг-рейсинга (src/drag.ts::runRace): применяет только
// реген энергии (без пассива/стартового голубя/сезона — не нужны в контексте заезда) под
// FOR UPDATE, возвращает {energy, balance}. Вызывающая сторона сама пишет итоговый UPDATE
// (энергия/баланс/race_reaction_ms) в рамках своей транзакции — здесь мы не коммитим строку,
// чтобы не сбрасывать updated_at раньше времени и не гонять два UPDATE подряд.
export async function refreshEnergyFor(client: PoolClient, chatId: number): Promise<{ energy: number; balance: number }> {
  await client.query(`INSERT INTO clicker_state (chat_id) VALUES ($1) ON CONFLICT (chat_id) DO NOTHING`, [chatId]);
  const { rows } = await client.query(`SELECT energy, energy_limit_level, balance, updated_at FROM clicker_state WHERE chat_id=$1 FOR UPDATE`, [chatId]);
  const r = rows[0];
  const secs = Math.max(0, (Date.now() - new Date(r.updated_at).getTime()) / 1000);
  const energy = Math.min(energyMaxFor(r.energy_limit_level), Math.round(r.energy + secs * REGEN_PER_SEC));
  return { energy, balance: Number(r.balance) };
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
    const energyCan = Math.floor(r.energy / TAP_COST);
    const can = takeTapAllowance(chatId, Math.min(want, energyCan));
    const turbo = r.turbo_until && new Date(r.turbo_until).getTime() > Date.now() ? TURBO_MULT : 1;
    // «Сладкие тапы» в батче: сколько кратных SWEET_TAP_EVERY попало в (oldTaps, oldTaps+can]
    const crits = sweetCritsIn(Number(r.taps || 0), can);
    // Копилка стаи: цель недели закрыта → ×SQUAD_BANK_MULT (bankMult посчитан в refresh)
    const bankMult = Number(r.__bankMult || 1);
    const earned = Math.floor((can + crits * (SWEET_TAP_MULT - 1)) * perTapFor(r.multitap_level) * turbo * gainMult(r.prestige) * bankMult);
    r.energy -= can * TAP_COST; r.balance = Number(r.balance) + earned; r.total_earned = Number(r.total_earned) + earned;
    await client.query(`UPDATE clicker_state SET balance=$2, total_earned=$3, taps=taps+$4, energy=$5, updated_at=NOW() WHERE chat_id=$1`,
      [chatId, r.balance, r.total_earned, can, r.energy]);
    await client.query("COMMIT");
    return buildState(r, cl, 0);
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

/**
 * Престиж (#9): доступен с макс. уровня. Сбрасывает прогресс (баланс/всего/бизнесы/
 * апгрейды), но +1 к престижу = постоянный множитель заработка. Сохраняет стрик,
 * рефералов, команду, lifetime-тапы и закрытые достижения (чтобы не фармить награды).
 */
export async function prestigeReset(chatId: number): Promise<{ ok: boolean; state?: ClickerState; prestige?: number; reason?: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r } = await refresh(client, chatId);
    const lvl = leagueFor(Number(r.total_earned)).level;
    if (lvl < PRESTIGE_MIN_LEVEL) { await client.query("ROLLBACK"); return { ok: false, reason: "not_ready" }; }
    if (Number(r.prestige || 0) >= PRESTIGE_MAX) { await client.query("ROLLBACK"); return { ok: false, reason: "max" }; }
    const newPrestige = Number(r.prestige || 0) + 1;
    await client.query(`DELETE FROM clicker_cards WHERE chat_id=$1`, [chatId]);
    await client.query(
      `UPDATE clicker_state SET balance=0, total_earned=0, energy=$2, multitap_level=0, energy_limit_level=0,
         week_base=0, week_key=$3, notified_level=0, prestige=$4, updated_at=NOW() WHERE chat_id=$1`,
      [chatId, energyMaxFor(0), weekKey(), newPrestige]
    );
    await client.query("COMMIT");
    trackEvent(chatId, "prestige", { prestige: newPrestige });
    // отражаем сброс в in-memory строке для ответа (без повторного запроса)
    r.balance = 0; r.total_earned = 0; r.energy = energyMaxFor(0); r.multitap_level = 0;
    r.energy_limit_level = 0; r.week_base = 0; r.week_key = weekKey(); r.notified_level = 0; r.prestige = newPrestige;
    return { ok: true, prestige: newPrestige, state: buildState(r, {}, 0) };
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
// Дроп голубя из игровых источников. chance ∈ (0,1]; внутри чужой транзакции передавать client.
async function maybeDropPigeon(chatId: number, chance: number, client?: PoolClient):
  Promise<{ breed: string; isNew: boolean } | undefined> {
  if (Math.random() >= chance) return undefined;
  const { pickBreed, grantPigeon } = await import("./pigeons");
  const breed = pickBreed(Math.random(), Math.random(), weekKey(), !!activeEvent());
  return grantPigeon(chatId, breed, client);
}

export async function claimCombo(chatId: number): Promise<{ ok: boolean; reward?: number; state?: ClickerState; reason?: string; pigeonDrop?: { breed: string; isNew: boolean } }> {
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
    // Комбо дня — гарантированный дроп (chance=1): требует собрать все карточки за день, награда честная.
    const pigeonDrop = await maybeDropPigeon(chatId, 1, client);
    await client.query("COMMIT");
    return { ok: true, reward: COMBO_REWARD, state: buildState(r, cl, 0), pigeonDrop };
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
// ── FTUE «Первый день» (аудит 30.07): 5 шагов-вех первой сессии ────────────────
// Прогресс НЕ хранится отдельно — вычисляется из существующего состояния (тапы,
// пекарня, сундук, голубь, заезд); хранится только битовая маска забранных наград
// (ftue_claimed). Отдельные эндпоинты — hot path тапов не трогаем.
export const FTUE_STEPS = [
  { id: 0, name: "Разбуди котика — заработай 50 монет", reward: 500 },
  { id: 1, name: "Заведи «Пекарню» в Прокачке", reward: 1000 },
  { id: 2, name: "Открой Сундук удачи в «Призах»", reward: 1500 },
  { id: 3, name: "Получи первого голубя", reward: 2000 },
  { id: 4, name: "Проведи драг-заезд в голубятне", reward: 5000 },
];
const FTUE_ALL_MASK = (1 << FTUE_STEPS.length) - 1;

async function ftueDoneFlags(chatId: number): Promise<boolean[]> {
  const [st, bakery, pigeon] = await Promise.all([
    pool.query(`SELECT total_earned, chest_date, race_reaction_ms FROM clicker_state WHERE chat_id=$1`, [chatId]),
    pool.query(`SELECT 1 FROM clicker_cards WHERE chat_id=$1 AND card='bakery' AND level>0`, [chatId]),
    pool.query(`SELECT 1 FROM pigeon_inventory WHERE chat_id=$1 AND count>0 LIMIT 1`, [chatId]),
  ]);
  const r = st.rows[0] || {};
  return [
    Number(r.total_earned || 0) >= 50,
    !!bakery.rowCount,
    r.chest_date != null,
    !!pigeon.rowCount,
    r.race_reaction_ms != null,
  ];
}

export async function getFtue(chatId: number): Promise<{ steps: { id: number; name: string; reward: number; done: boolean; claimed: boolean }[]; allClaimed: boolean }> {
  const [done, mask] = await Promise.all([
    ftueDoneFlags(chatId),
    pool.query(`SELECT ftue_claimed FROM clicker_state WHERE chat_id=$1`, [chatId]).then(r => Number(r.rows[0]?.ftue_claimed || 0)),
  ]);
  const steps = FTUE_STEPS.map((s, i) => ({ ...s, done: done[i], claimed: !!(mask & (1 << i)) }));
  return { steps, allClaimed: (mask & FTUE_ALL_MASK) === FTUE_ALL_MASK };
}

export async function claimFtue(chatId: number, stepId: number): Promise<{ ok: boolean; reward?: number; newBalance?: number; reason?: string }> {
  const s = FTUE_STEPS.find(x => x.id === stepId);
  if (!s) return { ok: false, reason: "bad_step" };
  const done = await ftueDoneFlags(chatId);
  if (!done[stepId]) return { ok: false, reason: "not_done" };
  // атомарно: бит ещё не стоит → ставим и начисляем (двойной клейм невозможен)
  const upd = await pool.query(
    `UPDATE clicker_state SET ftue_claimed = ftue_claimed | $2, balance = balance + $3, total_earned = total_earned + $3
      WHERE chat_id=$1 AND (ftue_claimed & $2) = 0 RETURNING balance`,
    [chatId, 1 << stepId, s.reward]);
  if (!upd.rowCount) return { ok: false, reason: "already" };
  return { ok: true, reward: s.reward, newBalance: Number(upd.rows[0].balance) };
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
type GameAttemptKind = "rain" | keyof typeof GAME_CFG;
type GameAttempt = { chatId: number; game: GameAttemptKind; token: string; startedAt: number };
const GAME_ATTEMPT_TTL_MS = 10 * 60 * 1000;
const GAME_ATTEMPT_MIN_MS: Record<string, number> = {
  rain: 15_000,
  quiz_kids: 2_500,
  quiz_riddle: 2_500,
  count: 2_000,
  memory: 4_500,
  gems: 30_000,
  tower: 500,
};
const gameAttempts = new Map<string, GameAttempt>();
function attemptKey(chatId: number, game: string, token: string): string { return `${chatId}:${game}:${token}`; }
function sweepGameAttempts(now = Date.now()): void {
  for (const [key, a] of gameAttempts) {
    if (now - a.startedAt > GAME_ATTEMPT_TTL_MS) gameAttempts.delete(key);
  }
}
export function createGameAttempt(chatId: number, game: string): { ok: boolean; token?: string; reason?: string } {
  if (game !== "rain" && !GAME_CFG[game]) return { ok: false, reason: "bad_game" };
  sweepGameAttempts();
  const token = crypto.randomUUID();
  gameAttempts.set(attemptKey(chatId, game, token), { chatId, game: game as GameAttemptKind, token, startedAt: Date.now() });
  return { ok: true, token };
}
function consumeGameAttempt(chatId: number, game: string, token: string): { ok: boolean; reason?: string } {
  if (!token || typeof token !== "string") return { ok: false, reason: "missing_attempt" };
  const key = attemptKey(chatId, game, token);
  const a = gameAttempts.get(key);
  gameAttempts.delete(key);
  if (!a) return { ok: false, reason: "bad_attempt" };
  const elapsed = Date.now() - a.startedAt;
  if (elapsed > GAME_ATTEMPT_TTL_MS) return { ok: false, reason: "expired_attempt" };
  if (elapsed < (GAME_ATTEMPT_MIN_MS[game] || 0)) return { ok: false, reason: "too_fast" };
  return { ok: true };
}
export async function claimRain(chatId: number, score: number, attemptToken = ""): Promise<{ ok: boolean; reward?: number; state?: ClickerState; reason?: string }> {
  const attempt = consumeGameAttempt(chatId, "rain", attemptToken);
  if (!attempt.ok) return { ok: false, reason: attempt.reason };
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
export async function claimGame(chatId: number, game: string, score: number, attemptToken = ""): Promise<{ ok: boolean; reward?: number; game?: string; state?: ClickerState; reason?: string; pigeonDrop?: { breed: string; isNew: boolean } }> {
  const cfg = GAME_CFG[game]; if (!cfg) return { ok: false, reason: "bad_game" };
  const attempt = consumeGameAttempt(chatId, game, attemptToken);
  if (!attempt.ok) return { ok: false, reason: attempt.reason };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cl } = await refresh(client, chatId);
    const today = irkToday();
    const ex = await client.query(`SELECT day FROM clicker_daily WHERE chat_id=$1 AND game=$2`, [chatId, game]);
    if (ex.rows.length && ex.rows[0].day === today) { await client.query("ROLLBACK"); return { ok: false, reason: "already" }; }
    // «Первый заход дня» — среди ВСЕХ игр хаба (не только текущей): считаем строки
    // clicker_daily за сегодня ДО инсёрта текущей игры. Если их 0 — это первый claim дня.
    const doneBefore = await client.query(`SELECT COUNT(*) AS n FROM clicker_daily WHERE chat_id=$1 AND day=$2`, [chatId, today]);
    const isFirstGameToday = Number(doneBefore.rows[0].n) === 0;
    const sc = Math.max(0, Math.min(cfg.cap, Math.floor(Number(score) || 0)));
    const reward = sc * cfg.per;
    r.balance = Number(r.balance) + reward; r.total_earned = Number(r.total_earned) + reward;
    await client.query(`INSERT INTO clicker_daily (chat_id, game, day) VALUES ($1,$2,$3) ON CONFLICT (chat_id, game) DO UPDATE SET day=$3`, [chatId, game, today]);
    await client.query(`UPDATE clicker_state SET balance=$2, total_earned=$3, updated_at=NOW() WHERE chat_id=$1`, [chatId, r.balance, r.total_earned]);
    const pigeonDrop = isFirstGameToday ? await maybeDropPigeon(chatId, 0.25, client) : undefined;
    const st = buildState(r, cl, 0); st.gamesDone = await gamesDoneToday(client, chatId);
    await client.query("COMMIT");
    return { ok: true, reward, game, state: st, pigeonDrop };
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
export async function openChest(chatId: number): Promise<{ ok: boolean; prize?: { type: string; amount?: number }; state?: ClickerState; reason?: string; pigeonDrop?: { breed: string; isNew: boolean } }> {
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
    const pigeonDrop = await maybeDropPigeon(chatId, 0.35, client);
    await client.query("COMMIT");
    return { ok: true, prize, state: buildState(r, cl, 0), pigeonDrop };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

// ── Платный кейс (казино-экономика, см. src/lootbox.ts) ──────────────────────
// Пити: после PITY_DRY открытий подряд без голубя — следующий гарантированно даёт
// голубя (награда за «наигранность»/потраченное; эдж всё равно у дома на дистанции).
const PITY_DRY = 30;
export type CasePrizeOut = { type: string; amount?: number; rarity?: string; breed?: string; isNew?: boolean };
export async function openCase(chatId: number): Promise<{ ok: boolean; prize?: CasePrizeOut; state?: ClickerState; reason?: string; newBalance?: number; cost?: number; pigeonDrop?: { breed: string; isNew: boolean } }> {
  const { CASE_COST, CHAMPION_COOLDOWN_DAYS, rollCase, prizeValue } = await import("./lootbox");
  const { grantPigeon, pickBreedOfRarity, pickBreed, BREED_BY_ID } = await import("./pigeons");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cl } = await refresh(client, chatId);
    if (Number(r.balance) < CASE_COST) { await client.query("ROLLBACK"); return { ok: false, reason: "not_enough_coins" }; }
    r.balance = Number(r.balance) - CASE_COST; // цена открытия
    // Гейт чемпиона: одна глобальная строка под FOR UPDATE — не чаще 1 раза в год на всех.
    await client.query(`INSERT INTO game_globals(key, ts) VALUES('champion_granted_at', NULL) ON CONFLICT (key) DO NOTHING`);
    const g = await client.query(`SELECT ts FROM game_globals WHERE key='champion_granted_at' FOR UPDATE`);
    const lastTs = g.rows[0] && g.rows[0].ts ? new Date(g.rows[0].ts).getTime() : 0;
    const championAllowed = (Date.now() - lastTs) >= CHAMPION_COOLDOWN_DAYS * 86400000;

    const dry = Number(r.case_dry || 0);
    let prize = rollCase(Math.random(), Math.random(), championAllowed);
    // Пити: «сухая серия» дошла до порога, а выпали не-голубь → форсим голубя (по базовым
    // весам редкости). Чемпион пити НЕ выдаёт (только настоящий гейт-ролл).
    if (dry + 1 >= PITY_DRY && prize.type !== "pigeon" && prize.type !== "champion") {
      const b = BREED_BY_ID.get(pickBreed(Math.random(), Math.random(), weekKey(), !!activeEvent()));
      prize = { type: "pigeon", rarity: b ? b.rarity : "common" };
    }

    const out: CasePrizeOut = { type: prize.type };
    let pigeonDrop: { breed: string; isNew: boolean } | undefined;
    if (prize.type === "coins") { r.balance = Number(r.balance) + prize.amount; r.total_earned = Number(r.total_earned) + prize.amount; out.amount = prize.amount; }
    else if (prize.type === "turbo") { r.turbo_until = new Date(Date.now() + TURBO_SEC * 1000); }
    else if (prize.type === "energy") { r.energy = energyMaxFor(r.energy_limit_level); }
    else if (prize.type === "pigeon") { const breed = pickBreedOfRarity(prize.rarity, Math.random()); pigeonDrop = await grantPigeon(chatId, breed, client); out.rarity = prize.rarity; out.breed = breed; out.isNew = pigeonDrop.isNew; }
    else if (prize.type === "champion") { pigeonDrop = await grantPigeon(chatId, "champion", client); out.breed = "champion"; out.isNew = pigeonDrop.isNew; await client.query(`UPDATE game_globals SET ts=NOW() WHERE key='champion_granted_at'`); }

    const isPigeon = prize.type === "pigeon" || prize.type === "champion";
    const won = prizeValue(prize);
    const newDry = isPigeon ? 0 : dry + 1;
    await client.query(
      `UPDATE clicker_state SET balance=$2, total_earned=$3, energy=$4, turbo_until=$5, case_spent=case_spent+$6, case_won=case_won+$7, case_dry=$8, updated_at=NOW() WHERE chat_id=$1`,
      [chatId, r.balance, r.total_earned, r.energy, r.turbo_until || null, CASE_COST, won, newDry]);
    await client.query("COMMIT");
    return { ok: true, prize: out, state: buildState(r, cl, 0), newBalance: Number(r.balance), cost: CASE_COST, pigeonDrop };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

/** «Золотой котик»: случайный летящий бонус. Кулдаун 45с (анти-чит), сумма по уровню. */
const BONUS_COOLDOWN_MS = 45000;
export async function claimBonus(chatId: number): Promise<{ ok: boolean; amount?: number; state?: ClickerState; reason?: string; pigeonDrop?: { breed: string; isNew: boolean } }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cl } = await refresh(client, chatId);
    if (r.bonus_at && Date.now() - new Date(r.bonus_at).getTime() < BONUS_COOLDOWN_MS) { await client.query("ROLLBACK"); return { ok: false, reason: "cooldown" }; }
    const lvl = leagueFor(Number(r.total_earned)).level;
    const amount = Math.min(60000, Math.round(300 + Math.random() * (700 + lvl * 600)));
    r.balance = Number(r.balance) + amount; r.total_earned = Number(r.total_earned) + amount;
    await client.query(`UPDATE clicker_state SET balance=$2, total_earned=$3, bonus_at=NOW(), updated_at=NOW() WHERE chat_id=$1`, [chatId, r.balance, r.total_earned]);
    const pigeonDrop = await maybeDropPigeon(chatId, 0.05, client);
    await client.query("COMMIT");
    return { ok: true, amount, state: buildState(r, cl, 0), pigeonDrop };
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
  top: { name: string; total: number; me: boolean; prestige: number; showcase: { breed: string; stars: number }[]; title: string | null }[];
  myRank: number | null; seasonEndsTs: number;
  weekly: { enabled: boolean; prizes: { rank: number; points: number; label: string }[]; lastWeek: { rank: number; name: string; points: number; me: boolean }[] };
}> {
  const cur = weekKey();
  const { rows } = await pool.query(
    `SELECT c.chat_id, (c.total_earned - c.week_base) AS pts, c.prestige, c.album_bonus, s.first_name, s.username
       FROM clicker_state c LEFT JOIN subscribers s ON s.chat_id = c.chat_id
      WHERE c.week_key = $2 AND (c.total_earned - c.week_base) > 0
      ORDER BY pts DESC LIMIT $1`, [limit, cur]
  );
  // Витрины топа — один запрос на всех (не по одному на игрока).
  const topIds = rows.map((r) => Number(r.chat_id));
  const showcaseByChat = new Map<number, { breed: string; stars: number }[]>();
  if (topIds.length) {
    const sc = await pool.query(
      `SELECT chat_id, breed, stars, showcase FROM pigeon_inventory WHERE chat_id = ANY($1) AND showcase > 0 ORDER BY showcase`,
      [topIds]
    );
    for (const s of sc.rows) {
      const cid = Number(s.chat_id);
      let list = showcaseByChat.get(cid);
      if (!list) { list = []; showcaseByChat.set(cid, list); }
      if (list.length < 3) list.push({ breed: String(s.breed), stars: Number(s.stars) });
    }
  }
  const top = rows.map((r) => ({
    name: (r.first_name || r.username || "Котовод").toString().slice(0, 24),
    total: Number(r.pts),
    me: Number(r.chat_id) === chatId,
    prestige: Number(r.prestige || 0),
    showcase: showcaseByChat.get(Number(r.chat_id)) || [],
    title: r.album_bonus ? "Голубиный барон" : null,
  }));
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
  // Снапшот заработка стай за закрытую неделю → адаптивная цель копилки следующей.
  // Тот же критерий week_key=endedKey, что и у победителей (до refresh'а игроков).
  await pool.query(
    `INSERT INTO squad_week_stats (week, squad, earned)
     SELECT $1, squad, SUM(total_earned - week_base)::bigint
       FROM clicker_state
      WHERE week_key = $1 AND squad IS NOT NULL AND (total_earned - week_base) > 0
      GROUP BY squad
     ON CONFLICT (week, squad) DO NOTHING`, [endedKey]
  ).catch((e) => log.warn({ err: e }, "[weekly] squad stats snapshot"));
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
      if (verified) { prizePoints = prize.points; didAward = true; }
    }
    // INSERT строки-победителя = мьютекс дедупа. Раньше earnPoints вызывался ДО
    // вставки → два параллельных прогона крона начисляли реальные баллы дважды
    // (ON CONFLICT дедупил только строку, не начисление). Теперь баллы получает
    // только прогон, реально вставивший строку.
    const ins = await pool.query(
      `INSERT INTO clicker_week_winners (week_key, rank, chat_id, points, prize_points, awarded)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (week_key, rank) DO NOTHING
       RETURNING rank`,
      [endedKey, rank, chatId, pts, prizePoints, didAward]
    );
    if ((ins.rowCount ?? 0) === 0) continue; // строку уже записал другой прогон
    recorded++;
    if (didAward) {
      await earnPoints(chatId, prize!.points, "clicker_weekly_top", { rank, week: endedKey }).catch(() => {});
      awarded++;
    }
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

// ── Копилка стаи (соц-механика, 08.2026) ────────────────────────────────────
// Недельная общая цель команды: игроки жертвуют монеты из своего баланса
// (монеты СГОРАЮТ — это sink, не передача другому игроку → экономика цела).
// Цель достигнута → вся стая тапает с множителем до конца недели (Иркутск).
// ⚠️ Константы продублированы во фронте catclick.js (squadBlock).
export const SQUAD_BANK_MULT = 1.25;
export const SQUAD_BANK_MIN_DONATE = 100;
export const SQUAD_BANK_DAY_CAP = 50_000;       // вклад одного игрока в день
// Адаптивная цель: % от заработка стаи за ПРОШЛУЮ неделю (снапшот пишет
// closeWeeklySeason в squad_week_stats), с полом и потолком. Новые/пустые
// стаи без истории получают пол — достижимо даже втроём.
export const SQUAD_BANK_TARGET_PCT = 0.15;
export const SQUAD_BANK_TARGET_FLOOR = 20_000;
export const SQUAD_BANK_TARGET_CAP = 2_000_000;

/** Цель недели от заработка стаи за прошлую неделю — чистая, для юнит-тестов. */
export function squadBankTargetFrom(lastWeekEarned: number): number {
  const raw = Math.round(Math.max(0, lastWeekEarned) * SQUAD_BANK_TARGET_PCT);
  return Math.min(SQUAD_BANK_TARGET_CAP, Math.max(SQUAD_BANK_TARGET_FLOOR, raw));
}

/** Сколько игрок может вложить сейчас — чистая, для юнит-тестов. */
export function squadBankClamp(balance: number, donatedToday: number, want: number): number {
  const room = Math.max(0, SQUAD_BANK_DAY_CAP - Math.max(0, donatedToday));
  const amount = Math.min(Math.floor(want), Math.floor(balance), room);
  return amount >= SQUAD_BANK_MIN_DONATE ? amount : 0;
}

export async function initSquadBankSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clicker_squad_bank (
      week      TEXT   NOT NULL,
      squad     TEXT   NOT NULL,
      chat_id   BIGINT NOT NULL,
      total     BIGINT NOT NULL DEFAULT 0,
      today     BIGINT NOT NULL DEFAULT 0,
      today_key TEXT,
      PRIMARY KEY (week, squad, chat_id)
    );
    CREATE INDEX IF NOT EXISTS squad_bank_week_squad ON clicker_squad_bank (week, squad);
    CREATE TABLE IF NOT EXISTS squad_week_stats (
      week   TEXT NOT NULL,
      squad  TEXT NOT NULL,
      earned BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (week, squad)
    );
  `);
}

/** Заработок стаи за прошлую (закрытую) неделю — источник адаптивной цели. */
async function lastWeekSquadEarned(squad: string): Promise<number> {
  const prev = String(weekMonday() - 7);
  const { rows } = await pool.query(`SELECT earned FROM squad_week_stats WHERE week=$1 AND squad=$2`, [prev, squad]);
  return Number(rows[0]?.earned || 0);
}

export interface SquadBankStatus {
  target: number; sum: number; reached: boolean; mult: number;
  myTotal: number; myToday: number; dayCap: number; minDonate: number;
  topDonors: { chatId: number; name: string; total: number }[];
}

async function squadBankSum(squad: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(total),0) AS s FROM clicker_squad_bank WHERE week=$1 AND squad=$2`,
    [weekKey(), squad]);
  return Number(rows[0].s);
}

export async function squadBankStatus(squad: string, chatId?: number): Promise<SquadBankStatus> {
  const wk = weekKey();
  const [sum, lastEarned, mine, top] = await Promise.all([
    squadBankSum(squad),
    lastWeekSquadEarned(squad),
    chatId
      ? pool.query(`SELECT total, today, today_key FROM clicker_squad_bank WHERE week=$1 AND squad=$2 AND chat_id=$3`, [wk, squad, chatId])
      : Promise.resolve({ rows: [] as { total: number; today: number; today_key: string }[] }),
    // Топ-3 вкладчиков с именами — признание в UI (display-only)
    pool.query(
      `SELECT b.chat_id, b.total, COALESCE(NULLIF(sub.first_name,''), NULLIF(sub.username,''), 'Игрок') AS name
         FROM clicker_squad_bank b LEFT JOIN subscribers sub ON sub.chat_id = b.chat_id
        WHERE b.week=$1 AND b.squad=$2 ORDER BY b.total DESC LIMIT 3`, [wk, squad]),
  ]);
  const target = squadBankTargetFrom(lastEarned);
  const my = mine.rows[0];
  const myToday = my && my.today_key === todayIrkutsk() ? Number(my.today) : 0;
  return {
    target, sum, reached: sum >= target, mult: SQUAD_BANK_MULT,
    myTotal: Number(my?.total || 0), myToday, dayCap: SQUAD_BANK_DAY_CAP, minDonate: SQUAD_BANK_MIN_DONATE,
    topDonors: top.rows.map((r) => ({
      chatId: Number(r.chat_id),
      name: String(r.name || "Игрок").replace(/[<>]/g, "").slice(0, 24),
      total: Number(r.total),
    })),
  };
}

// Пуш стае «копилка полна» — сервис инжектится из index.ts при старте
// (роуты кликера не имеют доступа к боту напрямую).
let _clickerPushSvc: PushService | null = null;
export function setClickerPushService(p: PushService): void { _clickerPushSvc = p; }

async function squadDisplayName(squad: string): Promise<string> {
  const std = SQUADS.find((s) => s.id === squad);
  if (std) return std.name;
  const { rows } = await pool.query(`SELECT name FROM squads WHERE id=$1`, [squad]);
  return String(rows[0]?.name || "стая");
}

function notifySquadGoalReached(squad: string, mult: number): void {
  const push = _clickerPushSvc;
  if (!push) return;
  void (async () => {
    try {
      const name = await squadDisplayName(squad);
      const { rows } = await pool.query(`SELECT chat_id FROM clicker_state WHERE squad=$1`, [squad]);
      for (const row of rows) {
        await push.sendRaw(Number(row.chat_id),
          `🏆 Стая «${name}» наполнила копилку!\nВесь доход ×${mult} до конца недели — тапайте на полную 🐱`,
          { parse_mode: "Markdown" }).catch(() => {});
        await new Promise((r) => setTimeout(r, 60));
      }
      log.info({ squad, members: rows.length }, "[squad-bank] goal push sent");
    } catch (e) { log.warn({ err: e, squad }, "[squad-bank] goal push"); }
  })();
}

export async function donateSquadBank(chatId: number, want: number):
  Promise<{ ok: boolean; reason?: string; donated?: number; bank?: SquadBankStatus; state?: ClickerState }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cl } = await refresh(client, chatId);
    const squad = r.squad as string | null;
    if (!squad) { await client.query("ROLLBACK"); return { ok: false, reason: "no_squad" }; }
    const wk = weekKey(), today = todayIrkutsk();
    const cur = await client.query(
      `SELECT total, today, today_key FROM clicker_squad_bank WHERE week=$1 AND squad=$2 AND chat_id=$3 FOR UPDATE`,
      [wk, squad, chatId]);
    const donatedToday = cur.rows[0] && cur.rows[0].today_key === today ? Number(cur.rows[0].today) : 0;
    const amount = squadBankClamp(Number(r.balance), donatedToday, want);
    if (!amount) { await client.query("ROLLBACK"); return { ok: false, reason: donatedToday >= SQUAD_BANK_DAY_CAP ? "day_cap" : "bad_amount" }; }
    r.balance = Number(r.balance) - amount;
    await client.query(`UPDATE clicker_state SET balance=$2, updated_at=NOW() WHERE chat_id=$1`, [chatId, r.balance]);
    await client.query(
      `INSERT INTO clicker_squad_bank (week, squad, chat_id, total, today, today_key)
       VALUES ($1,$2,$3,$4,$4,$5)
       ON CONFLICT (week, squad, chat_id) DO UPDATE SET
         total = clicker_squad_bank.total + $4,
         today = CASE WHEN clicker_squad_bank.today_key = $5 THEN clicker_squad_bank.today + $4 ELSE $4 END,
         today_key = $5`,
      [wk, squad, chatId, amount, today]);
    await client.query("COMMIT");
    _bankCache.delete(squad); // бафф мог включиться прямо этим вкладом
    trackEvent(chatId, "squad_bank", { squad, amount });
    const bank = await squadBankStatus(squad, chatId);
    // Именно этот вклад закрыл цель → событие для всей стаи (пуш в фоне)
    if (bank.reached && bank.sum - amount < bank.target) notifySquadGoalReached(squad, bank.mult);
    return { ok: true, donated: amount, bank, state: buildState(r, cl, 0) };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { client.release(); }
}

// Бафф в tapClicker дёргается на каждый батч тапов → кэш 60с на стаю.
const _bankCache = new Map<string, { reached: boolean; ts: number }>();
/** Только для e2e-тестов: сбросить кэш баффа. */
export function _clearSquadBankCache(): void { _bankCache.clear(); }
async function squadBankActive(squad: string | null): Promise<boolean> {
  if (!squad) return false;
  const hit = _bankCache.get(squad);
  if (hit && Date.now() - hit.ts < 60_000) return hit.reached;
  let reached = false;
  try {
    const [sum, lastEarned] = await Promise.all([squadBankSum(squad), lastWeekSquadEarned(squad)]);
    reached = sum >= squadBankTargetFrom(lastEarned);
  } catch { return false; }
  _bankCache.set(squad, { reached, ts: Date.now() });
  return reached;
}

// ── Свои стаи (08.2026) ─────────────────────────────────────────────────────
// Игрок может создать СВОЮ стаю (за монеты, sink), назвать её, приглашать по
// инвайт-коду (мгновенное вступление) и принимать чужие заявки. 4 стандартные
// стаи остаются открытыми «лигами новичков» (вступление в 1 тап, без заявок).
// ⚠️ Константы продублированы во фронте catclick.js.
export const SQUAD_CREATE_COST = 25_000;
export const SQUAD_MAX_MEMBERS = 20;
export const SQUAD_NAME_MIN = 3;
export const SQUAD_NAME_MAX = 20;

// Базовый стоп-фильтр названий: корни мата/оскорблений. Название видят ВСЕ
// игроки в рейтинге команд — лучше пересолить, чем показать похабщину у бренда.
const SQUAD_NAME_STOP = /(ху[йеёи]|пизд|[еёи]б[ауеи]|бля|му[дч]ак|сук[аи]|гандон|пидор|пидар|хер|жоп|говн|дерьм|шлюх|дроч|fuck|shit|bitch|cunt|dick|porn)/i;

/**
 * Нормализация и проверка названия стаи — чистая, для юнит-тестов.
 * Возвращает нормализованное имя либо null (не прошло).
 */
export function sanitizeSquadName(raw: string): string | null {
  const name = String(raw || "").replace(/\s+/g, " ").trim();
  if (name.length < SQUAD_NAME_MIN || name.length > SQUAD_NAME_MAX) return null;
  if (!/^[а-яёА-ЯЁa-zA-Z0-9 \-_!?.«»]+$/.test(name)) return null;
  if (!/[а-яёА-ЯЁa-zA-Z0-9]/.test(name)) return null;
  if (SQUAD_NAME_STOP.test(name.toLowerCase().replace(/[^а-яёa-z]/g, ""))) return null;
  if (SQUADS.some((s) => s.name.toLowerCase() === name.toLowerCase())) return null;
  return name;
}

export async function initCustomSquadSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS squads (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      owner_chat_id BIGINT NOT NULL,
      invite_code   TEXT UNIQUE NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS squads_name_lower ON squads (LOWER(name));
    CREATE TABLE IF NOT EXISTS squad_requests (
      squad_id   TEXT NOT NULL,
      chat_id    BIGINT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (squad_id, chat_id)
    );
  `);
}

const genSquadId = () => "c" + crypto.randomBytes(4).toString("hex");
const genInviteCode = () => crypto.randomBytes(4).toString("base64url").replace(/[-_]/g, "x").slice(0, 6).toUpperCase();

/** Стая существует? (стандартная или своя) */
async function squadExists(id: string): Promise<boolean> {
  if (SQUAD_IDS.has(id)) return true;
  const { rows } = await pool.query(`SELECT 1 FROM squads WHERE id=$1`, [id]);
  return rows.length > 0;
}

async function squadMemberCount(id: string): Promise<number> {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM clicker_state WHERE squad=$1`, [id]);
  return Number(rows[0].n);
}

export async function createSquad(chatId: number, rawName: string):
  Promise<{ ok: boolean; reason?: string; squadId?: string; inviteCode?: string; state?: ClickerState }> {
  const name = sanitizeSquadName(rawName);
  if (!name) return { ok: false, reason: "bad_name" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r } = await refresh(client, chatId);
    const own = await client.query(`SELECT id FROM squads WHERE owner_chat_id=$1`, [chatId]);
    if (own.rows.length > 0) { await client.query("ROLLBACK"); return { ok: false, reason: "already_owner" }; }
    if (Number(r.balance) < SQUAD_CREATE_COST) { await client.query("ROLLBACK"); return { ok: false, reason: "no_coins" }; }
    const id = genSquadId(), code = genInviteCode();
    try {
      await client.query(`INSERT INTO squads (id, name, owner_chat_id, invite_code) VALUES ($1,$2,$3,$4)`, [id, name, chatId, code]);
    } catch {
      await client.query("ROLLBACK");
      return { ok: false, reason: "name_taken" }; // уникальный индекс LOWER(name)
    }
    await client.query(`UPDATE clicker_state SET balance = balance - $2, squad = $3, updated_at = NOW() WHERE chat_id = $1`,
      [chatId, SQUAD_CREATE_COST, id]);
    await client.query("COMMIT");
    trackEvent(chatId, "squad_create", { id, name });
    return { ok: true, squadId: id, inviteCode: code, state: await getClicker(chatId) };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { client.release(); }
}

export async function joinSquadByCode(chatId: number, rawCode: string):
  Promise<{ ok: boolean; reason?: string; squadName?: string; state?: ClickerState }> {
  const code = String(rawCode || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(code)) return { ok: false, reason: "bad_code" };
  const { rows } = await pool.query(`SELECT id, name FROM squads WHERE invite_code=$1`, [code]);
  if (!rows[0]) return { ok: false, reason: "not_found" };
  if ((await squadMemberCount(rows[0].id)) >= SQUAD_MAX_MEMBERS) return { ok: false, reason: "full" };
  await pool.query(`INSERT INTO clicker_state (chat_id, squad) VALUES ($1,$2) ON CONFLICT (chat_id) DO UPDATE SET squad=$2`, [chatId, rows[0].id]);
  await pool.query(`DELETE FROM squad_requests WHERE chat_id=$1`, [chatId]);
  trackEvent(chatId, "squad_join_code", { id: rows[0].id });
  return { ok: true, squadName: rows[0].name, state: await getClicker(chatId) };
}

export async function requestJoinSquad(chatId: number, squadId: string):
  Promise<{ ok: boolean; reason?: string; pending?: boolean; state?: ClickerState }> {
  // Стандартные стаи — открытые, вступление сразу
  if (SQUAD_IDS.has(squadId)) {
    const r = await joinSquad(chatId, squadId);
    return { ...r, pending: false };
  }
  const { rows } = await pool.query(`SELECT id, owner_chat_id FROM squads WHERE id=$1`, [squadId]);
  if (!rows[0]) return { ok: false, reason: "not_found" };
  const me = await pool.query(`SELECT squad FROM clicker_state WHERE chat_id=$1`, [chatId]);
  if (me.rows[0]?.squad === squadId) return { ok: false, reason: "already_in" };
  if ((await squadMemberCount(squadId)) >= SQUAD_MAX_MEMBERS) return { ok: false, reason: "full" };
  await pool.query(
    `INSERT INTO squad_requests (squad_id, chat_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [squadId, chatId]);
  trackEvent(chatId, "squad_request", { id: squadId });
  return { ok: true, pending: true };
}

export interface SquadRequestRow { chatId: number; name: string; totalEarned: number; createdAt: string }

/** Заявки в МОЮ стаю (я — владелец). */
export async function listSquadRequests(ownerId: number): Promise<{ squadId: string | null; requests: SquadRequestRow[] }> {
  const own = await pool.query(`SELECT id FROM squads WHERE owner_chat_id=$1`, [ownerId]);
  if (!own.rows[0]) return { squadId: null, requests: [] };
  const squadId = own.rows[0].id as string;
  const { rows } = await pool.query(
    `SELECT r.chat_id, r.created_at, COALESCE(sub.first_name, sub.username, '') AS name,
            COALESCE(s.total_earned, 0) AS te
       FROM squad_requests r
       LEFT JOIN subscribers sub ON sub.chat_id = r.chat_id
       LEFT JOIN clicker_state s ON s.chat_id = r.chat_id
      WHERE r.squad_id = $1 ORDER BY r.created_at LIMIT 30`, [squadId]);
  return {
    squadId,
    requests: rows.map((r) => ({
      chatId: Number(r.chat_id), name: String(r.name || "Игрок"),
      totalEarned: Number(r.te), createdAt: String(r.created_at),
    })),
  };
}

export async function decideSquadRequest(ownerId: number, applicantId: number, accept: boolean):
  Promise<{ ok: boolean; reason?: string }> {
  const own = await pool.query(`SELECT id FROM squads WHERE owner_chat_id=$1`, [ownerId]);
  if (!own.rows[0]) return { ok: false, reason: "not_owner" };
  const squadId = own.rows[0].id as string;
  const del = await pool.query(`DELETE FROM squad_requests WHERE squad_id=$1 AND chat_id=$2 RETURNING chat_id`, [squadId, applicantId]);
  if (!del.rows[0]) return { ok: false, reason: "no_request" };
  if (!accept) return { ok: true };
  if ((await squadMemberCount(squadId)) >= SQUAD_MAX_MEMBERS) return { ok: false, reason: "full" };
  await pool.query(`INSERT INTO clicker_state (chat_id, squad) VALUES ($1,$2) ON CONFLICT (chat_id) DO UPDATE SET squad=$2`, [applicantId, squadId]);
  trackEvent(applicantId, "squad_accepted", { id: squadId, by: ownerId });
  return { ok: true };
}

/** Команды: рейтинг по сумме намолоченного (стандартные + свои), выбор/смена. */
export async function getSquads(chatId: number): Promise<{
  squads: { id: string; name: string; points: number; members: number; custom: boolean; mine: boolean }[];
  mySquad: string | null;
  myOwn: { squadId: string; name: string; inviteCode: string; requests: number } | null;
  myPending: string | null;
}> {
  const [agg0, custom, me, own, pending] = await Promise.all([
    pool.query(`SELECT squad, SUM(total_earned)::bigint AS pts, COUNT(*)::int AS n FROM clicker_state WHERE squad IS NOT NULL GROUP BY squad`),
    pool.query(`SELECT id, name, owner_chat_id, invite_code FROM squads`),
    pool.query(`SELECT squad FROM clicker_state WHERE chat_id=$1`, [chatId]),
    pool.query(`SELECT s.id, s.name, s.invite_code, (SELECT COUNT(*)::int FROM squad_requests r WHERE r.squad_id = s.id) AS req
                  FROM squads s WHERE s.owner_chat_id=$1`, [chatId]),
    pool.query(`SELECT squad_id FROM squad_requests WHERE chat_id=$1 LIMIT 1`, [chatId]),
  ]);
  const agg: Record<string, { pts: number; n: number }> = {};
  for (const r of agg0.rows) agg[r.squad] = { pts: Number(r.pts), n: r.n };
  const mySquad: string | null = (me.rows[0] && me.rows[0].squad) || null;

  const list = [
    ...SQUADS.map((s) => ({ id: s.id, name: s.name, custom: false })),
    ...custom.rows.map((s) => ({ id: String(s.id), name: String(s.name), custom: true })),
  ].map((s) => ({
    ...s,
    points: agg[s.id]?.pts || 0,
    members: agg[s.id]?.n || 0,
    mine: s.id === mySquad,
  })).sort((a, b) => b.points - a.points);

  // Топ-10 + своя стая всегда видна (даже если за пределами топа)
  const top = list.slice(0, 10);
  if (mySquad && !top.some((s) => s.id === mySquad)) {
    const mineRow = list.find((s) => s.id === mySquad);
    if (mineRow) top.push(mineRow);
  }

  return {
    squads: top,
    mySquad,
    myOwn: own.rows[0]
      ? { squadId: String(own.rows[0].id), name: String(own.rows[0].name), inviteCode: String(own.rows[0].invite_code), requests: Number(own.rows[0].req) }
      : null,
    myPending: pending.rows[0] ? String(pending.rows[0].squad_id) : null,
  };
}
/** Состав МОЕЙ стаи: имена + монеты в общий счёт (total_earned) + вклад в копилку
 *  этой недели. Приватность: только участники своей стаи. Топ-100 по монетам. */
export async function getSquadMembers(chatId: number): Promise<{
  inSquad: boolean; name: string; members: { name: string; coins: number; bank: number; me: boolean }[];
}> {
  const meRow = await pool.query(`SELECT squad FROM clicker_state WHERE chat_id=$1`, [chatId]);
  const squad: string | null = (meRow.rows[0] && meRow.rows[0].squad) || null;
  if (!squad) return { inSquad: false, name: "", members: [] };
  const wk = weekKey();
  const preset = SQUADS.find((s) => s.id === squad);
  let name = preset ? preset.name : squad;
  if (!preset) {
    const n = await pool.query(`SELECT name FROM squads WHERE id::text=$1`, [squad]);
    if (n.rows[0]) name = String(n.rows[0].name);
  }
  const rows = await pool.query(
    `SELECT cs.chat_id, cs.total_earned, s.first_name, s.username, COALESCE(b.total,0) AS bank
       FROM clicker_state cs
       LEFT JOIN subscribers s ON s.chat_id = cs.chat_id
       LEFT JOIN clicker_squad_bank b ON b.week=$2 AND b.squad=$1 AND b.chat_id=cs.chat_id
      WHERE cs.squad=$1
      ORDER BY cs.total_earned DESC LIMIT 100`, [squad, wk]);
  const members = rows.rows.map((r: any) => ({
    name: (r.first_name || r.username || "Котовод").toString().slice(0, 24),
    coins: Number(r.total_earned),
    bank: Number(r.bank),
    me: Number(r.chat_id) === chatId,
  }));
  return { inSquad: true, name, members };
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

// ─── Воронка MVP ─────────────────────────────────────────────────────────────

/** T4: приглашённые, чей первый заказ ещё не вознаграждён (для крона реф-бонуса). */
export async function getRefOrderCandidates(): Promise<{ invitee: number; referrer: number }[]> {
  const { rows } = await pool.query(
    `SELECT chat_id, referred_by FROM clicker_state
      WHERE referred_by IS NOT NULL AND ref_order_rewarded = FALSE`
  );
  return rows.map((r: any) => ({ invitee: Number(r.chat_id), referrer: Number(r.referred_by) }));
}

/** T4: пометить, что реф-бонус за первый заказ приглашённого выдан (идемпотентно). */
export async function markRefOrderRewarded(invitee: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE clicker_state SET ref_order_rewarded = TRUE
      WHERE chat_id = $1 AND ref_order_rewarded = FALSE`,
    [invitee]
  );
  return (rowCount ?? 0) > 0;
}

/** T5: показывался ли уже welcome-промокод игроку. */
export async function welcomePromoShown(chatId: number): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT welcome_promo_at FROM clicker_state WHERE chat_id = $1`,
    [chatId]
  );
  return rows.length > 0 && rows[0].welcome_promo_at != null;
}

/** T5: пометить, что welcome-промокод выдан (один раз). Возвращает true если только что пометили. */
export async function markWelcomePromoShown(chatId: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE clicker_state SET welcome_promo_at = NOW()
      WHERE chat_id = $1 AND welcome_promo_at IS NULL`,
    [chatId]
  );
  return (rowCount ?? 0) > 0;
}

/** Онбординг пройден — серверный флаг (переживает потерю localStorage в webview Mini App,
 *  из-за которой обучение показывалось при КАЖДОМ входе). Идемпотентно. */
export async function markOnboarded(chatId: number): Promise<void> {
  await pool.query(`UPDATE clicker_state SET onboarded = TRUE WHERE chat_id = $1 AND onboarded = FALSE`, [chatId]);
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
 * Когда включат: атомарно списывает монеты + пишет PENDING-redemption, затем вне tx
 * вызывает grantRewardByCode (club.ts) → реальный промокод в user_rewards.
 * При сбое выдачи — компенсация: монеты возвращаются, PENDING-запись удаляется.
 * Loyalty-награды (kind:"loyalty") начисляют реальные баллы карты через earnPoints (телефон обязателен).
 */
export async function redeemReward(chatId: number, id: string): Promise<{ ok: boolean; code?: string; points?: number; state?: ClickerState; reason?: string }> {
  if (!REWARDS_ENABLED) return { ok: false, reason: "disabled" };
  const rw = REWARD_BY_ID[id]; if (!rw) return { ok: false, reason: "bad_reward" };
  if (rw.kind === "loyalty") {
    if (!rw.points) return { ok: false, reason: "bad_reward" };
    if (!(await isPhoneVerified(chatId).catch(() => false))) return { ok: false, reason: "need_phone" };
  } else if (!rw.catalog) return { ok: false, reason: "bad_reward" };
  const client = await pool.connect();
  let r!: any, cl!: Record<string, number>;
  try {
    await client.query("BEGIN");
    ({ r, cl } = await refresh(client, chatId));
    const used = await client.query(`SELECT COUNT(*)::int AS n FROM clicker_redemptions WHERE chat_id=$1 AND created_at > NOW() - INTERVAL '1 day'`, [chatId]);
    if (used.rows[0].n >= REDEEM_PER_DAY) { await client.query("ROLLBACK"); return { ok: false, reason: "daily_limit" }; }
    if (Number(r.balance) < rw.cost) { await client.query("ROLLBACK"); return { ok: false, reason: "not_enough" }; }
    r.balance = Number(r.balance) - rw.cost; // total_earned НЕ трогаем (уровень/сезон сохраняются)
    await client.query(`INSERT INTO clicker_redemptions (chat_id, reward_id, cost, code) VALUES ($1,$2,$3,$4)`, [chatId, id, rw.cost, "PENDING"]);
    await client.query(`UPDATE clicker_state SET balance=$2, updated_at=NOW() WHERE chat_id=$1`, [chatId, r.balance]);
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
  // loyalty: начислить реальные баллы карты (вне tx). При сбое — компенсация монет.
  if (rw.kind === "loyalty") {
    try {
      await earnPoints(chatId, rw.points!, "clicker_redeem", { reward: id });
    } catch (e) {
      await pool.query(`UPDATE clicker_state SET balance=balance+$2 WHERE chat_id=$1`, [chatId, rw.cost]).catch((err) => console.error("[redeem] refund failed", err));
      await pool.query(`DELETE FROM clicker_redemptions WHERE chat_id=$1 AND code='PENDING' AND reward_id=$2 AND created_at > NOW()-INTERVAL '1 minute'`, [chatId, id]).catch((err) => console.error("[redeem] pending cleanup failed", err));
      console.error("[redeem] earnPoints threw", e);
      return { ok: false, reason: "grant_failed" };
    }
    await pool.query(`UPDATE clicker_redemptions SET code=$3 WHERE chat_id=$1 AND reward_id=$2 AND code='PENDING' AND created_at > NOW()-INTERVAL '1 minute'`, [chatId, id, `POINTS:${rw.points}`]).catch((err) => console.error("[redeem] code stamp failed", err));
    return { ok: true, points: rw.points, state: buildState(r, cl, 0) };
  }
  // выдать реальный код (вне tx). При сбое — вернуть монеты (компенсация).
  let grant;
  try {
    grant = await grantRewardByCode(chatId, rw.catalog!);
  } catch (e) {
    await pool.query(`UPDATE clicker_state SET balance=balance+$2 WHERE chat_id=$1`, [chatId, rw.cost]).catch((err) => console.error("[redeem] refund failed", err));
    await pool.query(`DELETE FROM clicker_redemptions WHERE chat_id=$1 AND code='PENDING' AND reward_id=$2 AND created_at > NOW()-INTERVAL '1 minute'`, [chatId, id]).catch((err) => console.error("[redeem] pending cleanup failed", err));
    console.error("[redeem] grantRewardByCode threw", e);
    return { ok: false, reason: "grant_failed" };
  }
  if (!grant.ok || !grant.promoCode) {
    await pool.query(`UPDATE clicker_state SET balance=balance+$2 WHERE chat_id=$1`, [chatId, rw.cost]).catch((err) => console.error("[redeem] refund failed", err));
    await pool.query(`DELETE FROM clicker_redemptions WHERE chat_id=$1 AND code='PENDING' AND reward_id=$2 AND created_at > NOW()-INTERVAL '1 minute'`, [chatId, id]).catch((err) => console.error("[redeem] pending cleanup failed", err));
    return { ok: false, reason: "grant_failed" };
  }
  await pool.query(`UPDATE clicker_redemptions SET code=$3 WHERE chat_id=$1 AND reward_id=$2 AND code='PENDING' AND created_at > NOW()-INTERVAL '1 minute'`, [chatId, id, grant.promoCode]).catch((err) => console.error("[redeem] code stamp failed", err));
  return { ok: true, code: grant.promoCode, state: buildState(r, cl, 0) };
}

/**
 * Начислить монеты в ОБЩИЙ кошелёк кликера (balance + total_earned).
 * Создаёт строку clicker_state при отсутствии (напр. игрок был только в питомце).
 * Принимает опциональный `client` — чтобы начислять ВНУТРИ существующей транзакции
 * (атомарно с обновлением питомца). Без client — своим запросом через pool.
 * Идемпотентность НЕ гарантируется — вызывать один раз на событие.
 */
export async function addClickerBalance(chatId: number, coins: number, client?: PoolClient): Promise<void> {
  if (!coins || coins <= 0) return;
  const n = Math.round(coins);
  const q = client ?? pool;
  await q.query(
    `INSERT INTO clicker_state (chat_id, balance, total_earned) VALUES ($1,$2,$2)
     ON CONFLICT (chat_id) DO UPDATE SET balance = clicker_state.balance + $2,
       total_earned = clicker_state.total_earned + $2, updated_at = NOW()`,
    [chatId, n]
  );
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
  { id: "ms_lvl19",    title: "Последний уровень — Император выпечки", cond: { type: "level", target: 19 }, points: 20000, perk: "free_bento_top", perkText: "Бенто-торт в подарок (от 1000₽)" },
  { id: "ms_col_prod", title: "Все голуби «Производство»", cond: { type: "collect", target: "prod" },  points: 300 },
  { id: "ms_col_mkt",  title: "Все голуби «Маркетинг»",    cond: { type: "collect", target: "mkt" },   points: 300 },
  { id: "ms_col_staff",title: "Все голуби «Персонал»",     cond: { type: "collect", target: "staff" }, points: 300 },
  { id: "ms_col_net",  title: "Все голуби «Сеть»",         cond: { type: "collect", target: "net" },   points: 300 },
  { id: "ms_col_all",  title: "Вся коллекция голубей",     cond: { type: "collect", target: "all" },   perk: "free_bento",  perkText: "Бенто-торт в подарок (от 2000₽)" },
  { id: "ms_ref3",     title: "Пригласил 3 друзей",        cond: { type: "ref", target: 3 },       points: 500 },
  { id: "ms_ref10",    title: "Пригласил 10 друзей",       cond: { type: "ref", target: 10 },      perk: "discount_10", perkText: "Промокод −10% (от 1000₽)" },
  // Вехи заботы о Василии («Дом кота»). Условие — по РЕКОРДУ стрика (pet_state.care_streak_best):
  // сброс текущего стрика не отбирает заслуженную веху. Числа — спека Фазы 2 (скромные, в духе лестницы).
  { id: "ms_care7",   title: "Забота о Василии: 7 дней",   cond: { type: "care_streak", target: 7 },   points: 200 },
  { id: "ms_care14",  title: "Забота о Василии: 14 дней",  cond: { type: "care_streak", target: 14 },  perk: "discount_5",   perkText: "Промокод −5% (от 500₽)" },
  { id: "ms_care30",  title: "Забота о Василии: 30 дней",  cond: { type: "care_streak", target: 30 },  points: 500 },
  { id: "ms_care60",  title: "Забота о Василии: 60 дней",  cond: { type: "care_streak", target: 60 },  perk: "free_dessert", perkText: "Бесплатный десерт (к торту от 2000₽)" },
  { id: "ms_care100", title: "Забота о Василии: 100 дней", cond: { type: "care_streak", target: 100 }, points: 1000 },
];
const MS_BY_ID = Object.fromEntries(MILESTONES.map((m) => [m.id, m]));
// care_streak_best читаем прямым SQL (импорт pet.ts → цикл: pet.ts импортирует addClickerBalance отсюда)
async function getCareStreakBest(chatId: number): Promise<number> {
  const { rows } = await pool.query(`SELECT care_streak_best FROM pet_state WHERE chat_id=$1`, [chatId]);
  return Number(rows[0]?.care_streak_best ?? 0);
}
const msReached = (m: any, s: ClickerState, careBest = 0) =>
  m.cond.type === "care_streak" ? careBest >= m.cond.target
    : taskClaimable({ type: m.cond.type, target: m.cond.target } as any, s);

export async function getMilestones(chatId: number): Promise<{ milestones: any[]; phoneVerified: boolean }> {
  const s = await getClicker(chatId);
  const careBest = await getCareStreakBest(chatId).catch(() => 0);
  const gr = await pool.query(`SELECT achievement FROM clicker_gifts WHERE chat_id=$1`, [chatId]);
  const granted = new Set(gr.rows.map((r) => r.achievement));
  const phoneVerified = await isPhoneVerified(chatId).catch(() => false);
  return {
    phoneVerified,
    milestones: MILESTONES.map((m) => ({
      id: m.id, title: m.title,
      kind: m.perk && m.points ? "both" : (m.perk ? "perk" : "points"),
      points: m.points || 0, perkText: m.perkText || "",
      reached: msReached(m, s, careBest), granted: granted.has(m.id),
    })),
  };
}

/** Забрать награду за веху: баллы на карту или перк-купон. 1 раз, телефон обязателен. */
export async function claimMilestone(chatId: number, id: string): Promise<{ ok: boolean; kind?: string; points?: number; promoCode?: string; perkTitle?: string; minOrder?: number; reason?: string }> {
  if (!GIFTS_ENABLED) return { ok: false, reason: "disabled" };
  const m: any = MS_BY_ID[id]; if (!m) return { ok: false, reason: "no_milestone" };
  const s = await getClicker(chatId);
  const careBest = m.cond.type === "care_streak" ? await getCareStreakBest(chatId).catch(() => 0) : 0;
  if (!msReached(m, s, careBest)) return { ok: false, reason: "not_ready" };
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

// Чистая арифметика сверки — вынесена из syncPurchaseBonus ради юнит-тестов
// (tests/clicker.test.ts), поведение прежнее:
// delta — только НОВЫЕ траты сверх watermark (откат/новый год → 0),
// grant — монеты с потолком PURCHASE_CAP,
// birds — гарантированные голуби rare+ за каждые полные 1000₽ delta (кап 3 за сверку).
export function computePurchaseGrant(yearSpent: number, spentSynced: number):
  { delta: number; grant: number; birds: number } {
  const delta = Math.max(0, yearSpent - spentSynced);
  const grant = Math.min(delta * PURCHASE_RATE, PURCHASE_CAP);
  const birds = Math.min(3, Math.floor(delta / 1000));
  return { delta, grant, birds };
}
export async function syncPurchaseBonus(chatId: number): Promise<{ ok: boolean; granted: number; yearSpent?: number; state?: ClickerState; pigeonDrops?: { breed: string; isNew: boolean }[] }> {
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
  const { grant, birds } = computePurchaseGrant(yearSpent, spentSynced);
  if (grant <= 0) {
    // Начислять нечего — двигаем watermark отдельно (потери монет тут быть не может).
    await pool.query(`UPDATE clicker_purchase_sync SET spent_synced=$2 WHERE chat_id=$1`, [chatId, yearSpent]);
    return { ok: true, granted: 0, yearSpent };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { r, cl } = await refresh(client, chatId);
    r.balance = Number(r.balance) + grant; r.total_earned = Number(r.total_earned) + grant;
    await client.query(`UPDATE clicker_state SET balance=$2, total_earned=$3, updated_at=NOW() WHERE chat_id=$1`, [chatId, r.balance, r.total_earned]);
    // Watermark двигаем в ТОЙ ЖЕ транзакции, что и начисление: раньше он сдвигался
    // отдельным query ДО начисления → краш между ними терял бонус навсегда
    // (следующая сверка дала бы delta=0).
    await client.query(`UPDATE clicker_purchase_sync SET spent_synced=$2 WHERE chat_id=$1`, [chatId, yearSpent]);
    // Каждые полные 1000₽ новых покупок (delta) → гарантированный голубь rare+
    // (кап 3 за сверку) — birds посчитан выше в computePurchaseGrant.
    const pigeonDrops: { breed: string; isNew: boolean }[] = [];
    if (birds > 0) {
      const { pickPurchaseBreed, grantPigeon } = await import("./pigeons");
      for (let i = 0; i < birds; i++) {
        pigeonDrops.push(await grantPigeon(chatId, pickPurchaseBreed(Math.random(), Math.random(), !!activeEvent()), client));
      }
    }
    const st = buildState(r, cl, 0); st.gamesDone = await gamesDoneToday(client, chatId);
    await client.query("COMMIT");
    return { ok: true, granted: grant, yearSpent, state: st, pigeonDrops };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

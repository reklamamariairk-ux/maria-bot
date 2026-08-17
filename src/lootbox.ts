// ── Платный сундук-кейс (как кейсы CS2) ──────────────────────────────────────
// Игрок платит монетами за открытие, выпадает приз: монеты / буст / голубь по
// редкости (лучше голубь = реже) / чемпион (1 раз в год на всех, глобальный гейт).
// Экономика «как в казино»: средняя ценность приза (EV) НИЖЕ цены открытия — на
// дистанции дом (мы) в плюсе, изредка игроку падает крупный приз. Розыгрыш —
// чистая детерминированная функция от rng (тестируется, EV считается юнит-тестом).
import type { Rarity } from "./pigeons";
import { PIGEON_PRICE } from "./pigeons";

export const CASE_COST = 100_000;           // цена открытия кейса, монеты
export const CASE_BUSINESS_LEVEL_VALUE_CAP = 300_000;
export const canGrantCaseBusinessLevel = (marketValue: number): boolean =>
  Number.isFinite(marketValue) && marketValue >= 0 && marketValue <= CASE_BUSINESS_LEVEL_VALUE_CAP;

export type CasePrize =
  | { type: "coins"; amount: number }
  | { type: "turbo" }
  | { type: "energy" }
  | { type: "pigeon"; rarity: Rarity }
  | { type: "business"; id: string };

// Условная ценность бустов в монетах — только для расчёта EV/эджа (буст = разовый).
const TURBO_VALUE = 1500, ENERGY_VALUE = 1200;
// Ценность чемпиона для EV — «бесценный», но гейт 1/год делает его вклад в EV ~0.

// Слот таблицы дропа. weight — вес (из суммы всех). lo/hi — диапазон суммы для монет.
// value(prize) — ценность в монетах для EV. roll(r) — розыгрыш конкретного значения.
type Slot = {
  key: string;
  weight: number;
  roll: (r: number) => CasePrize;
  evValue: number; // средняя ценность слота в монетах (для EV/эджа)
};

const coinsSlot = (key: string, weight: number, lo: number, hi: number): Slot => ({
  key, weight,
  roll: (r) => ({ type: "coins", amount: Math.round(lo + r * (hi - lo)) }),
  evValue: (lo + hi) / 2,
});
const pigeonSlot = (rarity: Rarity, weight: number): Slot => ({
  key: "pigeon_" + rarity, weight,
  roll: () => ({ type: "pigeon", rarity }),
  evValue: PIGEON_PRICE[rarity],
});
const businessSlot = (id: string, weight: number, value: number): Slot => ({
  key: "business_" + id, weight,
  roll: () => ({ type: "business", id }),
  evValue: value,
});

// CS2-подобная таблица: частые дешёвые результаты, редкие игровые предметы и
// сверхприз 10 млн. Веса суммируются до 10000 (0.01% на единицу).
export const CASE_SLOTS: Slot[] = [
  coinsSlot("coins_zero", 1745, 0, 0),
  coinsSlot("coins_loss", 3000, 10_000, 50_000),
  coinsSlot("coins_slight_under", 2000, 60_000, 90_000),
  coinsSlot("coins_equal", 800, 100_000, 100_000),
  coinsSlot("coins_plus", 700, 110_000, 160_000),
  coinsSlot("coins_big", 600, 200_000, 400_000),
  coinsSlot("coins_jackpot", 50, 500_000, 1_500_000),
  coinsSlot("coins_super_jackpot", 5, 10_000_000, 10_000_000),
  pigeonSlot("common", 500),
  pigeonSlot("rare", 300),
  pigeonSlot("epic", 50),
  businessSlot("region", 100, 100_000),
  businessSlot("loyalty", 80, 100_000),
  businessSlot("manager", 40, 100_000),
  businessSlot("franchise", 30, 100_000),
];
export const CASE_TOTAL_WEIGHT = CASE_SLOTS.reduce((s, x) => s + x.weight, 0);

// После пяти призов рыночной ценностью ниже ставки следующая попытка как минимум
// окупается. Защита останавливает плохую серию, но не создаёт гарантированную прибыль.
export const CASE_LOSS_PITY = 5;
export function protectCaseLossStreak(prize: CasePrize, lossStreak: number, r: number): CasePrize {
  if (lossStreak < CASE_LOSS_PITY || prizeValue(prize) >= CASE_COST) return prize;
  return { type: "coins", amount: Math.round(CASE_COST + Math.max(0, Math.min(1, r)) * 40_000) };
}

// Средняя ценность приза (EV) и домовый эдж — без учёта гейта чемпиона (его вклад
// в реальности ~0, т.к. падает ≤1 раза в год; для «сырого» EV считаем как есть,
// но есть и evNoChampion — реалистичный EV на дистанции).
export function caseEV(): { ev: number; evNoChampion: number; edge: number; edgeNoChampion: number } {
  const w = CASE_TOTAL_WEIGHT;
  let ev = 0, evNoChamp = 0;
  for (const s of CASE_SLOTS) {
    ev += (s.weight / w) * s.evValue;
    evNoChamp += (s.weight / w) * s.evValue;
  }
  return { ev, evNoChampion: evNoChamp, edge: 1 - ev / CASE_COST, edgeNoChampion: 1 - evNoChamp / CASE_COST };
}

// Розыгрыш приза. r1 ∈ [0,1) выбирает слот по весам, r2 ∈ [0,1) — значение внутри слота.
export function rollCase(r1: number, r2: number, _championAllowed = false): CasePrize {
  const target = r1 * CASE_TOTAL_WEIGHT;
  let acc = 0;
  for (const s of CASE_SLOTS) {
    acc += s.weight;
    if (target < acc) {
      return s.roll(r2);
    }
  }
  // страховка от накопленной погрешности — последний слот
  return { type: "coins", amount: Math.round(40_000 + r2 * 30_000) };
}

// Ценность приза в монетах (для учёта case_won игрока — «казино»-баланс дом/игрок).
export function prizeValue(prize: CasePrize): number {
  switch (prize.type) {
    case "coins": return prize.amount;
    case "turbo": return TURBO_VALUE;
    case "energy": return ENERGY_VALUE;
    case "pigeon": return PIGEON_PRICE[prize.rarity];
    case "business": return 100_000; // фактическая цена уровня уточняется при выдаче
  }
}

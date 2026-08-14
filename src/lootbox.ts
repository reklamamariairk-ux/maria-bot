// ── Платный сундук-кейс (как кейсы CS2) ──────────────────────────────────────
// Игрок платит монетами за открытие, выпадает приз: монеты / буст / голубь по
// редкости (лучше голубь = реже) / чемпион (1 раз в год на всех, глобальный гейт).
// Экономика «как в казино»: средняя ценность приза (EV) НИЖЕ цены открытия — на
// дистанции дом (мы) в плюсе, изредка игроку падает крупный приз. Розыгрыш —
// чистая детерминированная функция от rng (тестируется, EV считается юнит-тестом).
import type { Rarity } from "./pigeons";
import { PIGEON_PRICE } from "./pigeons";

export const CASE_COST = 100_000;           // цена открытия кейса, монеты

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
// денежный джекпот до 15 цен кейса. Веса суммируются до 1000 (0.1% на единицу).
export const CASE_SLOTS: Slot[] = [
  coinsSlot("coins_zero", 100, 0, 0),
  coinsSlot("coins_loss", 300, 10_000, 70_000),
  coinsSlot("coins_slight_under", 200, 70_000, 99_000),
  coinsSlot("coins_equal", 120, 100_000, 100_000),
  coinsSlot("coins_plus", 100, 110_000, 160_000),
  coinsSlot("coins_big", 60, 200_000, 400_000),
  coinsSlot("coins_jackpot", 10, 500_000, 1_500_000),
  pigeonSlot("common", 50),
  pigeonSlot("rare", 30),
  pigeonSlot("epic", 5),
  businessSlot("region", 10, 100_000),
  businessSlot("loyalty", 8, 100_000),
  businessSlot("manager", 4, 100_000),
  businessSlot("franchise", 3, 100_000),
];
export const CASE_TOTAL_WEIGHT = CASE_SLOTS.reduce((s, x) => s + x.weight, 0);

// После пяти призов рыночной ценностью ниже ставки следующий денежный результат
// защищён. Серия учитывает и предметы по их игровой рыночной цене.
export const CASE_LOSS_PITY = 5;
export function protectCaseLossStreak(prize: CasePrize, lossStreak: number, r: number): CasePrize {
  if (lossStreak < CASE_LOSS_PITY || prizeValue(prize) >= 220_000) return prize;
  return { type: "coins", amount: Math.round(220_000 + Math.max(0, Math.min(1, r)) * 80_000) };
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

// ── Платный сундук-кейс (как кейсы CS2) ──────────────────────────────────────
// Игрок платит монетами за открытие, выпадает приз: монеты / буст / голубь по
// редкости (лучше голубь = реже) / чемпион (1 раз в год на всех, глобальный гейт).
// Экономика «как в казино»: средняя ценность приза (EV) НИЖЕ цены открытия — на
// дистанции дом (мы) в плюсе, изредка игроку падает крупный приз. Розыгрыш —
// чистая детерминированная функция от rng (тестируется, EV считается юнит-тестом).
import type { Rarity } from "./pigeons";
import { PIGEON_PRICE } from "./pigeons";

export const CASE_COST = 100_000;           // цена открытия кейса, монеты
export const CHAMPION_COOLDOWN_DAYS = 365;  // чемпион — не чаще 1 раза в год на всех

export type CasePrize =
  | { type: "coins"; amount: number }
  | { type: "turbo" }
  | { type: "energy" }
  | { type: "pigeon"; rarity: Rarity }
  | { type: "champion" };

// Условная ценность бустов в монетах — только для расчёта EV/эджа (буст = разовый).
const TURBO_VALUE = 1500, ENERGY_VALUE = 1200;
// Ценность чемпиона для EV — «бесценный», но гейт 1/год делает его вклад в EV ~0.
const CHAMPION_VALUE = 5_000_000;

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

// Таблица по новой продуктовой логике: кейс чаще возвращает ощутимые монеты.
// Веса суммируются до 1000 = проценты с точностью 0.1%:
// При цене 100k: 10% заметный минус, 60% возврат ниже цены, 20% шанс получить
// до 150k, 9% крупный плюс 150-250k, 1% джекпот до 1M.
export const CASE_SLOTS: Slot[] = [
  coinsSlot("coins_loss", 100, 5_000, 25_000),
  coinsSlot("coins_equal", 500, 50_000, 50_000),
  coinsSlot("coins_slight_under", 100, 35_000, 49_000),
  coinsSlot("coins_plus", 200, 60_000, 150_000),
  coinsSlot("coins_big", 90, 150_000, 250_000),
  coinsSlot("coins_jackpot", 10, 250_000, 1_000_000),
];
export const CASE_TOTAL_WEIGHT = CASE_SLOTS.reduce((s, x) => s + x.weight, 0);

// Средняя ценность приза (EV) и домовый эдж — без учёта гейта чемпиона (его вклад
// в реальности ~0, т.к. падает ≤1 раза в год; для «сырого» EV считаем как есть,
// но есть и evNoChampion — реалистичный EV на дистанции).
export function caseEV(): { ev: number; evNoChampion: number; edge: number; edgeNoChampion: number } {
  const w = CASE_TOTAL_WEIGHT;
  let ev = 0, evNoChamp = 0;
  for (const s of CASE_SLOTS) {
    ev += (s.weight / w) * s.evValue;
    if (s.key !== "champion") evNoChamp += (s.weight / w) * s.evValue;
  }
  return { ev, evNoChampion: evNoChamp, edge: 1 - ev / CASE_COST, edgeNoChampion: 1 - evNoChamp / CASE_COST };
}

// Розыгрыш приза. r1 ∈ [0,1) выбирает слот по весам, r2 ∈ [0,1) — значение внутри слота.
// championAllowed=false (глобальный гейт закрыт) → выпавший чемпион заменяется на
// consolation (coins_small), т.к. чемпион отдаётся не чаще 1 раза в год на всех.
export function rollCase(r1: number, r2: number, championAllowed: boolean): CasePrize {
  const target = r1 * CASE_TOTAL_WEIGHT;
  let acc = 0;
  for (const s of CASE_SLOTS) {
    acc += s.weight;
    if (target < acc) {
      const prize = s.roll(r2);
      if (prize.type === "champion" && !championAllowed) {
        // гейт закрыт — отдаём consolation вместо чемпиона
        return { type: "coins", amount: Math.round(8_000 + r2 * 12_000) };
      }
      return prize;
    }
  }
  // страховка от накопленной погрешности — последний слот
  return { type: "coins", amount: Math.round(8_000 + r2 * 12_000) };
}

// Ценность приза в монетах (для учёта case_won игрока — «казино»-баланс дом/игрок).
export function prizeValue(prize: CasePrize): number {
  switch (prize.type) {
    case "coins": return prize.amount;
    case "turbo": return TURBO_VALUE;
    case "energy": return ENERGY_VALUE;
    case "pigeon": return PIGEON_PRICE[prize.rarity];
    case "champion": return CHAMPION_VALUE;
  }
}

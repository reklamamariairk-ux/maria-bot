import { describe, it, expect } from "vitest";
import { CASE_COST, CASE_SLOTS, CASE_TOTAL_WEIGHT, caseEV, rollCase, prizeValue, type CasePrize } from "../src/lootbox";

describe("экономика кейса — новая таблица призов", () => {
  it("веса соответствуют заданным процентам", () => {
    expect(CASE_TOTAL_WEIGHT).toBe(1000);
    const byKey = Object.fromEntries(CASE_SLOTS.map(s => [s.key, s.weight]));
    expect(byKey.coins_loss).toBe(100);
    expect(byKey.coins_equal).toBe(500);
    expect(byKey.coins_slight_under).toBe(100);
    expect(byKey.coins_plus).toBe(200);
    expect(byKey.coins_big).toBe(90);
    expect(byKey.coins_jackpot).toBe(10);
  });

  it("при цене 100k средняя ценность остаётся ниже цены кейса", () => {
    const { ev, evNoChampion } = caseEV();
    console.log(`CASE: cost=${CASE_COST} EV=${Math.round(ev)} return=${(ev / CASE_COST * 100).toFixed(1)}%`);
    expect(CASE_COST).toBe(100_000);
    expect(ev).toBeLessThan(CASE_COST);
    expect(evNoChampion).toBe(ev);
  });
});

describe("rollCase — диапазоны призов", () => {
  it("все призы — валидные монеты в заданных границах", () => {
    for (let i = 0; i < 5000; i++) {
      const p: CasePrize = rollCase(Math.random(), Math.random(), true);
      expect(p.type).toBe("coins");
      if (p.type === "coins") {
        expect(p.amount).toBeGreaterThanOrEqual(5_000);
        expect(p.amount).toBeLessThanOrEqual(1_000_000);
        expect(prizeValue(p)).toBe(p.amount);
      }
    }
  });

  it("проверяет границы каждой вероятностной группы", () => {
    const samples = [
      [0.05, 0.5, 5_000, 25_000],
      [0.35, 0.5, 50_000, 50_000],
      [0.65, 0.5, 35_000, 49_000],
      [0.80, 0.5, 60_000, 150_000],
      [0.945, 0.5, 150_000, 250_000],
      [0.995, 0.5, 250_000, 1_000_000],
    ] as const;
    for (const [r1, r2, lo, hi] of samples) {
      const p = rollCase(r1, r2, false);
      expect(p.type).toBe("coins");
      if (p.type === "coins") {
        expect(p.amount).toBeGreaterThanOrEqual(lo);
        expect(p.amount).toBeLessThanOrEqual(hi);
      }
    }
  });
});

import { describe, it, expect } from "vitest";
import { CASE_COST, CASE_SLOTS, CASE_TOTAL_WEIGHT, caseEV, protectCaseLossStreak, rollCase, prizeValue, type CasePrize } from "../src/lootbox";

describe("экономика кейса — новая таблица призов", () => {
  it("веса соответствуют заданным процентам", () => {
    expect(CASE_TOTAL_WEIGHT).toBe(1000);
    const byKey = Object.fromEntries(CASE_SLOTS.map(s => [s.key, s.weight]));
    expect(byKey.coins_loss).toBe(150);
    expect(byKey.coins_slight_under).toBe(250);
    expect(byKey.coins_equal).toBe(300);
    expect(byKey.coins_plus).toBe(200);
    expect(byKey.coins_big).toBe(90);
    expect(byKey.coins_jackpot).toBe(10);
  });

  it("при цене 100k средняя отдача выше ставки, а 60% веса не дают проигрыш", () => {
    const { ev, evNoChampion } = caseEV();
    console.log(`CASE: cost=${CASE_COST} EV=${Math.round(ev)} return=${(ev / CASE_COST * 100).toFixed(1)}%`);
    expect(CASE_COST).toBe(100_000);
    expect(ev).toBeGreaterThan(CASE_COST);
    expect(ev).toBeCloseTo(111_000, -2);
    expect(evNoChampion).toBe(ev);
    const nonLossWeight = CASE_SLOTS.filter(s => ["coins_equal", "coins_plus", "coins_big", "coins_jackpot"].includes(s.key)).reduce((sum, s) => sum + s.weight, 0);
    expect(nonLossWeight).toBe(600);
  });
});

describe("rollCase — диапазоны призов", () => {
  it("после двух проигрышей гарантирует 220–300k и перекрывает худшую тройку", () => {
    const low: CasePrize = { type: "coins", amount: 40_000 };
    expect(protectCaseLossStreak(low, 1, 0)).toEqual(low);
    expect(protectCaseLossStreak(low, 2, 0)).toEqual({ type: "coins", amount: 220_000 });
    expect(protectCaseLossStreak(low, 2, 1)).toEqual({ type: "coins", amount: 300_000 });
    expect(40_000 + 40_000 + 220_000).toBe(3 * CASE_COST);
  });
  it("все призы — валидные монеты в заданных границах", () => {
    for (let i = 0; i < 5000; i++) {
      const p: CasePrize = rollCase(Math.random(), Math.random(), true);
      expect(p.type).toBe("coins");
      if (p.type === "coins") {
        expect(p.amount).toBeGreaterThanOrEqual(40_000);
        expect(p.amount).toBeLessThanOrEqual(1_000_000);
        expect(prizeValue(p)).toBe(p.amount);
      }
    }
  });

  it("проверяет границы каждой вероятностной группы", () => {
    const samples = [
      [0.075, 0.5, 40_000, 70_000],
      [0.275, 0.5, 75_000, 99_000],
      [0.55, 0.5, 100_000, 100_000],
      [0.80, 0.5, 105_000, 150_000],
      [0.945, 0.5, 150_000, 250_000],
      [0.995, 0.5, 500_000, 1_000_000],
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

import { describe, it, expect } from "vitest";
import { CASE_COST, CASE_SLOTS, CASE_TOTAL_WEIGHT, caseEV, protectCaseLossStreak, rollCase, prizeValue, type CasePrize } from "../src/lootbox";

describe("экономика кейса — новая таблица призов", () => {
  it("веса соответствуют заданным процентам", () => {
    expect(CASE_TOTAL_WEIGHT).toBe(10000);
    const byKey = Object.fromEntries(CASE_SLOTS.map(s => [s.key, s.weight]));
    expect(byKey.coins_zero).toBe(984);
    expect(byKey.coins_loss).toBe(3000);
    expect(byKey.coins_slight_under).toBe(2000);
    expect(byKey.coins_equal).toBe(1200);
    expect(byKey.coins_plus).toBe(1000);
    expect(byKey.coins_big).toBe(600);
    expect(byKey.coins_jackpot).toBe(100);
    expect(byKey.coins_super_jackpot).toBe(16);
    expect(byKey.pigeon_common).toBe(500);
    expect(byKey.pigeon_rare).toBe(300);
    expect(byKey.pigeon_epic).toBe(50);
    expect(byKey.business_region + byKey.business_loyalty + byKey.business_manager + byKey.business_franchise).toBe(250);
  });

  it("при цене 100k базовая средняя отдача близка к ставке", () => {
    const { ev, evNoChampion } = caseEV();
    console.log(`CASE: cost=${CASE_COST} EV=${Math.round(ev)} return=${(ev / CASE_COST * 100).toFixed(1)}%`);
    expect(CASE_COST).toBe(100_000);
    expect(ev).toBeCloseTo(109_000, -2);
    expect(evNoChampion).toBe(ev);
  });
});

describe("rollCase — диапазоны призов", () => {
  it("после пяти проигрышей гарантирует приз 220–300k", () => {
    const low: CasePrize = { type: "coins", amount: 0 };
    expect(protectCaseLossStreak(low, 4, 0)).toEqual(low);
    expect(protectCaseLossStreak(low, 5, 0)).toEqual({ type: "coins", amount: 220_000 });
    expect(protectCaseLossStreak({ type: "pigeon", rarity: "common" }, 5, 1)).toEqual({ type: "coins", amount: 300_000 });
    const epic: CasePrize = { type: "pigeon", rarity: "epic" };
    expect(protectCaseLossStreak(epic, 5, 0)).toEqual(epic);
  });
  it("все призы принадлежат допустимым типам", () => {
    for (let i = 0; i < 5000; i++) {
      const p: CasePrize = rollCase(Math.random(), Math.random(), true);
      expect(["coins", "pigeon", "business"]).toContain(p.type);
      if (p.type === "coins") {
        expect(p.amount).toBeGreaterThanOrEqual(0);
        expect(p.amount).toBeLessThanOrEqual(10_000_000);
        expect(prizeValue(p)).toBe(p.amount);
      }
    }
  });

  it("проверяет границы каждой вероятностной группы", () => {
    const samples = [
      [0.05, 0.5, 0, 0],
      [0.25, 0.5, 10_000, 70_000],
      [0.50, 0.5, 70_000, 99_000],
      [0.66, 0.5, 100_000, 100_000],
      [0.77, 0.5, 110_000, 160_000],
      [0.85, 0.5, 200_000, 400_000],
      [0.885, 0.5, 500_000, 1_500_000],
      [0.889, 0.5, 10_000_000, 10_000_000],
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

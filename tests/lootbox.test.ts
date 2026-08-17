import { describe, it, expect } from "vitest";
import { CASE_COST, CASE_BUSINESS_LEVEL_VALUE_CAP, CASE_SLOTS, CASE_TOTAL_WEIGHT, canGrantCaseBusinessLevel, caseEV, protectCaseLossStreak, rollCase, prizeValue, type CasePrize } from "../src/lootbox";

describe("экономика кейса — новая таблица призов", () => {
  it("веса соответствуют заданным процентам", () => {
    expect(CASE_TOTAL_WEIGHT).toBe(10000);
    const byKey = Object.fromEntries(CASE_SLOTS.map(s => [s.key, s.weight]));
    expect(byKey.coins_zero).toBe(1745);
    expect(byKey.coins_loss).toBe(3000);
    expect(byKey.coins_slight_under).toBe(2000);
    expect(byKey.coins_equal).toBe(800);
    expect(byKey.coins_plus).toBe(700);
    expect(byKey.coins_big).toBe(600);
    expect(byKey.coins_jackpot).toBe(50);
    expect(byKey.coins_super_jackpot).toBe(5);
    expect(byKey.pigeon_common).toBe(500);
    expect(byKey.pigeon_rare).toBe(300);
    expect(byKey.pigeon_epic).toBe(50);
    expect(byKey.business_region + byKey.business_loyalty + byKey.business_manager + byKey.business_franchise).toBe(250);
  });

  it("базовая средняя отдача около 80% и ниже стоимости кейса", () => {
    const { ev, evNoChampion } = caseEV();
    console.log(`CASE: cost=${CASE_COST} EV=${Math.round(ev)} return=${(ev / CASE_COST * 100).toFixed(1)}%`);
    expect(CASE_COST).toBe(100_000);
    expect(ev).toBeCloseTo(80_050, -2);
    expect(ev).toBeLessThan(CASE_COST * 0.82);
    expect(evNoChampion).toBe(ev);
  });
});

describe("rollCase — диапазоны призов", () => {
  it("после пяти проигрышей гарантирует окупаемость, но не крупную прибыль", () => {
    const low: CasePrize = { type: "coins", amount: 0 };
    expect(protectCaseLossStreak(low, 4, 0)).toEqual(low);
    expect(protectCaseLossStreak(low, 5, 0)).toEqual({ type: "coins", amount: 100_000 });
    expect(protectCaseLossStreak({ type: "pigeon", rarity: "common" }, 5, 1)).toEqual({ type: "coins", amount: 140_000 });
    const epic: CasePrize = { type: "pigeon", rarity: "epic" };
    expect(protectCaseLossStreak(epic, 5, 0)).toEqual(epic);
  });
  it("дорогие уровни бизнеса не могут выдаваться кейсом", () => {
    expect(CASE_BUSINESS_LEVEL_VALUE_CAP).toBe(300_000);
    expect(canGrantCaseBusinessLevel(300_000)).toBe(true);
    expect(canGrantCaseBusinessLevel(300_001)).toBe(false);
    expect(canGrantCaseBusinessLevel(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("защита серии не превращает кейс в прибыль на дистанции", () => {
    let seed = 0x12345678;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    let dry = 0;
    let value = 0;
    const count = 200_000;
    for (let i = 0; i < count; i++) {
      const prize = protectCaseLossStreak(rollCase(rnd(), rnd()), dry, rnd());
      const won = prizeValue(prize);
      value += won;
      dry = won < CASE_COST ? dry + 1 : 0;
    }
    expect(value / count).toBeGreaterThan(82_000);
    expect(value / count).toBeLessThan(87_000);
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
      [0.69, 0.5, 100_000, 100_000],
      [0.78, 0.5, 110_000, 160_000],
      [0.85, 0.5, 200_000, 400_000],
      [0.887, 0.5, 500_000, 1_500_000],
      [0.8897, 0.5, 10_000_000, 10_000_000],
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

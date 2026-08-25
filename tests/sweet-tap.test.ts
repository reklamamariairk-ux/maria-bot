import { describe, it, expect } from "vitest";
import { sweetCritsIn, SWEET_TAP_EVERY, SWEET_TAP_MULT, tapUnitGain } from "../src/clicker";

describe("«Сладкий тап» — криты в батче детерминированы от lifetime-счётчика", () => {
  it("округляет цену одного тапа до батча, точно как клиент", () => {
    expect(tapUnitGain(1, 1, 1.1, 1.25)).toBe(1);
    expect(tapUnitGain(3, 5, 1.2, 1.25)).toBe(22);
  });
  it(`каждый ${SWEET_TAP_EVERY}-й тап — ровно один крит, независимо от нарезки батчей`, () => {
    expect(sweetCritsIn(0, SWEET_TAP_EVERY)).toBe(1);
    expect(sweetCritsIn(SWEET_TAP_EVERY - 1, 1)).toBe(1);   // крит последним тапом батча
    expect(sweetCritsIn(SWEET_TAP_EVERY, 1)).toBe(0);       // сразу после крита
    expect(sweetCritsIn(0, SWEET_TAP_EVERY - 1)).toBe(0);
  });
  it("сумма критов не зависит от того, как тапы разбиты на батчи", () => {
    const total = 1000;
    const whole = sweetCritsIn(0, total);
    let split = 0, at = 0;
    for (const n of [7, 40, 1, 333, 619]) { split += sweetCritsIn(at, n); at += n; }
    expect(at).toBe(total);
    expect(split).toBe(whole);
    expect(whole).toBe(total / SWEET_TAP_EVERY);
  });
  it("экономика: средний буст тапов ≈ +(MULT−1)/EVERY, не больше 20%", () => {
    const boost = (SWEET_TAP_MULT - 1) / SWEET_TAP_EVERY;
    expect(boost).toBeGreaterThan(0.1);
    expect(boost).toBeLessThanOrEqual(0.2);
  });
});

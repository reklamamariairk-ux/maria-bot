import { describe, expect, it } from "vitest";
import { effectiveCareStreak, isPetLocation, settlePetNeed } from "../src/pet";

describe("потребности питомца не зависят от частоты чтения", () => {
  it("накапливает дробный голод между частыми GET", () => {
    let value = 80;
    let carry = 0;
    for (let i = 0; i < 600; i++) {
      const settled = settlePetNeed(value, 6, 6 / 3600, carry);
      value = settled.value;
      carry = settled.carry;
    }
    expect(value).toBe(74);
    expect(carry).toBeCloseTo(0, 8);
  });

  it("не переносит дробный долг после достижения нуля", () => {
    expect(settlePetNeed(1, 6, 1)).toEqual({ value: 0, carry: 0 });
  });
});

describe("серия заботы", () => {
  it("сохраняется после вчерашней заботы", () => {
    expect(effectiveCareStreak("2026-08-19", 12, "2026-08-20")).toBe(12);
  });

  it("на экране сразу сбрасывается после пропущенного дня", () => {
    expect(effectiveCareStreak("2026-08-18", 12, "2026-08-20")).toBe(0);
  });
});

describe("комнаты питомца", () => {
  it("принимает только известные серверу комнаты", () => {
    expect(isPetLocation("kitchen")).toBe(true);
    expect(isPetLocation("yard")).toBe(true);
    expect(isPetLocation("basement")).toBe(false);
    expect(isPetLocation(1)).toBe(false);
  });
});

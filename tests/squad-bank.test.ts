/**
 * Копилка стаи — чистая арифметика адаптивной цели и клампа вклада.
 * Сама транзакция вклада и бафф гоняются e2e в контейнере (bank-e2e.mjs).
 */
import { describe, it, expect } from "vitest";
import {
  squadBankTargetFrom, squadBankClamp,
  SQUAD_BANK_TARGET_PCT, SQUAD_BANK_TARGET_FLOOR, SQUAD_BANK_TARGET_CAP,
  SQUAD_BANK_DAY_CAP, SQUAD_BANK_MIN_DONATE,
} from "../src/clicker";

describe("squadBankTargetFrom — адаптивная цель от заработка прошлой недели", () => {
  it("нет истории (новая стая) → пол, достижимо даже втроём", () => {
    expect(squadBankTargetFrom(0)).toBe(SQUAD_BANK_TARGET_FLOOR);
    expect(squadBankTargetFrom(50_000)).toBe(SQUAD_BANK_TARGET_FLOOR); // 15% = 7.5к < пола
  });
  it("середина: ровно процент от заработка", () => {
    expect(squadBankTargetFrom(1_000_000)).toBe(Math.round(1_000_000 * SQUAD_BANK_TARGET_PCT));
    expect(squadBankTargetFrom(200_000)).toBe(30_000);
  });
  it("потолок: богатая стая не получает недостижимую цель", () => {
    expect(squadBankTargetFrom(1e9)).toBe(SQUAD_BANK_TARGET_CAP);
  });
  it("отрицательный вход не ломает", () => {
    expect(squadBankTargetFrom(-100)).toBe(SQUAD_BANK_TARGET_FLOOR);
  });
});

describe("squadBankClamp — сколько реально можно вложить", () => {
  it("режется балансом", () => {
    expect(squadBankClamp(700, 0, 5000)).toBe(700);
  });
  it("режется дневным лимитом", () => {
    expect(squadBankClamp(1e9, SQUAD_BANK_DAY_CAP - 300, 5000)).toBe(300);
    expect(squadBankClamp(1e9, SQUAD_BANK_DAY_CAP, 5000)).toBe(0);
  });
  it("меньше минимума → 0 (не создаём пыль)", () => {
    expect(squadBankClamp(1e9, 0, SQUAD_BANK_MIN_DONATE - 1)).toBe(0);
    expect(squadBankClamp(50, 0, 5000)).toBe(0);
  });
  it("дробное/отрицательное не проходит", () => {
    expect(squadBankClamp(1e9, 0, -100)).toBe(0);
    expect(squadBankClamp(1e9, 0, 999.9)).toBe(999);
  });
  it("нормальный вклад проходит как есть", () => {
    expect(squadBankClamp(100000, 0, 5000)).toBe(5000);
  });
});

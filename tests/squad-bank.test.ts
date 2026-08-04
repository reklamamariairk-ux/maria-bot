/**
 * Копилка стаи — чистая арифметика цели и клампа вклада.
 * Сама транзакция вклада и бафф гоняются e2e в контейнере (bank-e2e.mjs).
 */
import { describe, it, expect } from "vitest";
import {
  squadBankTarget, squadBankClamp,
  SQUAD_BANK_BASE_TARGET, SQUAD_BANK_PER_MEMBER, SQUAD_BANK_DAY_CAP, SQUAD_BANK_MIN_DONATE,
} from "../src/clicker";

describe("squadBankTarget — цель недели от числа активных", () => {
  it("маленькая стая (≤5 активных) → базовая цель", () => {
    expect(squadBankTarget(0)).toBe(SQUAD_BANK_BASE_TARGET);
    expect(squadBankTarget(3)).toBe(SQUAD_BANK_BASE_TARGET);
    expect(squadBankTarget(5)).toBe(SQUAD_BANK_BASE_TARGET);
  });
  it("растёт на PER_MEMBER за каждого сверх 5", () => {
    expect(squadBankTarget(6)).toBe(SQUAD_BANK_BASE_TARGET + SQUAD_BANK_PER_MEMBER);
    expect(squadBankTarget(25)).toBe(SQUAD_BANK_BASE_TARGET + 20 * SQUAD_BANK_PER_MEMBER);
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

/**
 * Свои стаи — фильтр названий (то, что увидят ВСЕ игроки в рейтинге).
 * Транзакции создания/заявок гоняются e2e (squads-e2e.mjs).
 */
import { describe, it, expect } from "vitest";
import { sanitizeSquadName, SQUAD_NAME_MAX } from "../src/clicker";

describe("sanitizeSquadName", () => {
  it("нормальные названия проходят и нормализуются", () => {
    expect(sanitizeSquadName("Сладкая банда")).toBe("Сладкая банда");
    expect(sanitizeSquadName("  Иркутск   77  ")).toBe("Иркутск 77");
    expect(sanitizeSquadName("Cake Masters!")).toBe("Cake Masters!");
    expect(sanitizeSquadName("«Пекари»")).toBe("«Пекари»");
  });
  it("длина: короче 3 и длиннее 20 — отказ", () => {
    expect(sanitizeSquadName("ab")).toBe(null);
    expect(sanitizeSquadName("а".repeat(SQUAD_NAME_MAX + 1))).toBe(null);
    expect(sanitizeSquadName("абв")).toBe("абв");
  });
  it("html/markdown-инъекции и мусорные символы — отказ", () => {
    expect(sanitizeSquadName("<script>alert(1)</script>")).toBe(null);
    expect(sanitizeSquadName("стая*_`жир`_*")).toBe(null);
    expect(sanitizeSquadName("!!! ??? ...")).toBe(null); // ни буквы, ни цифры
  });
  it("мат и обходы с разделителями — отказ", () => {
    expect(sanitizeSquadName("Пиздатые")).toBe(null);
    expect(sanitizeSquadName("х у й ня")).toBe(null);
    expect(sanitizeSquadName("Fuck cakes")).toBe(null);
  });
  it("имена стандартных стай занять нельзя", () => {
    expect(sanitizeSquadName("Шоколадные")).toBe(null);
    expect(sanitizeSquadName("ягодные")).toBe(null);
  });
});

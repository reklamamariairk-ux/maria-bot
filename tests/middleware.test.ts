/**
 * safeEq — constant-time сравнение секретов (токены админки, ORDER_TOKEN,
 * VK callback secret, DELIVERY_TOKEN). Самая горячая секьюрити-функция:
 * false-негатив = запертая админка, false-позитив = открытая.
 */
import { describe, it, expect } from "vitest";
import { safeEq } from "../src/middleware";

describe("safeEq — constant-time сравнение токенов", () => {
  it("одинаковые строки → true", () => {
    expect(safeEq("secret-token-123", "secret-token-123")).toBe(true);
  });

  it("разные строки одной длины → false", () => {
    expect(safeEq("aaaaaaaa", "aaaaaaab")).toBe(false);
  });

  it("разная длина → false (и не бросает, хотя timingSafeEqual требует равные буферы)", () => {
    expect(() => safeEq("short", "much-longer-token")).not.toThrow();
    expect(safeEq("short", "much-longer-token")).toBe(false);
  });

  it("пустые строки → false (пустой токен никогда не «подходит»)", () => {
    expect(safeEq("", "")).toBe(false);
    expect(safeEq("", "token")).toBe(false);
    expect(safeEq("token", "")).toBe(false);
  });

  it("null/undefined → false без исключений", () => {
    expect(safeEq(null, "token")).toBe(false);
    expect(safeEq("token", null)).toBe(false);
    expect(safeEq(undefined, undefined)).toBe(false);
    expect(safeEq(null, null)).toBe(false);
  });

  it("кириллица/мультибайт: равные → true, разные → false", () => {
    expect(safeEq("пароль-🐱", "пароль-🐱")).toBe(true);
    expect(safeEq("пароль", "парОль")).toBe(false);
  });

  it("одинаковая длина в символах, разная в байтах → false без исключений", () => {
    // "ёё" = 4 байта UTF-8, "ab" = 2 байта — guard по длине буфера должен отработать
    expect(safeEq("ёё", "ab")).toBe(false);
  });

  it("префикс токена → false (частичное совпадение не проходит)", () => {
    expect(safeEq("admin-token", "admin-token-full")).toBe(false);
  });
});

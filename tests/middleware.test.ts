/**
 * safeEq — constant-time сравнение секретов (токены админки, ORDER_TOKEN,
 * VK callback secret, DELIVERY_TOKEN). Самая горячая секьюрити-функция:
 * false-негатив = запертая админка, false-позитив = открытая.
 */
import { describe, it, expect, vi } from "vitest";
import { rateLimit, safeEq } from "../src/middleware";

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

describe("rateLimit — независимые лимиты методов", () => {
  it("GET не расходует лимит POST на том же пути", () => {
    const getLimit = rateLimit(2);
    const postLimit = rateLimit(2);
    const nextGet = vi.fn();
    const nextPost = vi.fn();
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const response = { status, json } as any;
    const base = { path: "/__test_rate_limit_methods", ip: "127.0.0.1", socket: {} };

    getLimit({ ...base, method: "GET" } as any, response, nextGet);
    getLimit({ ...base, method: "GET" } as any, response, nextGet);
    postLimit({ ...base, method: "POST" } as any, response, nextPost);

    expect(nextGet).toHaveBeenCalledTimes(2);
    expect(nextPost).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });
});

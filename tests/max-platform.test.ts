/**
 * МАКС как третья платформа: диапазоны internalId и верификация initData.
 */
import { describe, it, expect, beforeAll } from "vitest";
import crypto from "crypto";
import {
  toInternalId, toPlatformId, platformOf, isVkId, isMaxId,
  VK_ID_OFFSET, MAX_ID_OFFSET, platformLabel,
} from "../src/platform";

const FAKE_TOKEN = "max-test-token-123";
process.env.MAX_BOT_TOKEN = FAKE_TOKEN;

/** Собирает валидную initData-строку по алгоритму МАКС (= алгоритм TG WebApp). */
function buildInitData(user: object, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    user: JSON.stringify(user),
    auth_date: String(Math.floor(Date.now() / 1000)),
    ...extra,
  });
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(FAKE_TOKEN).digest();
  const hash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

describe("platform.ts: диапазоны трёх платформ", () => {
  it("toInternalId/toPlatformId — взаимно обратны для всех платформ", () => {
    expect(toInternalId("tg", 8421659311)).toBe(8421659311);
    expect(toInternalId("vk", 123456)).toBe(VK_ID_OFFSET + 123456);
    expect(toInternalId("max", 987654)).toBe(MAX_ID_OFFSET + 987654);
    for (const p of ["tg", "vk", "max"] as const) {
      expect(toPlatformId(toInternalId(p, 42))).toBe(42);
      expect(platformOf(toInternalId(p, 42))).toBe(p);
    }
  });

  it("isVkId — строго диапазон [2e12, 4e12), не ловит МАКС", () => {
    expect(isVkId(VK_ID_OFFSET + 1)).toBe(true);
    expect(isVkId(MAX_ID_OFFSET + 1)).toBe(false);
    expect(isMaxId(MAX_ID_OFFSET + 1)).toBe(true);
    expect(isVkId(8421659311)).toBe(false);
  });

  it("platformLabel различает все три", () => {
    expect(platformLabel(1)).toContain("Telegram");
    expect(platformLabel(VK_ID_OFFSET + 1)).toContain("VK");
    expect(platformLabel(MAX_ID_OFFSET + 1)).toContain("МАКС");
  });
});

describe("auth-max.ts: verifyMaxInitData", () => {
  let verifyMaxInitData: (s: string) => { id: number } | null;
  beforeAll(async () => {
    ({ verifyMaxInitData } = await import("../src/auth-max"));
  });

  it("валидная подпись → юзер", () => {
    const initData = buildInitData({ id: 555, first_name: "Вася" });
    const u = verifyMaxInitData(initData);
    expect(u?.id).toBe(555);
  });

  it("битая подпись → null", () => {
    const initData = buildInitData({ id: 555 }).replace(/hash=\w{6}/, "hash=000000");
    expect(verifyMaxInitData(initData)).toBe(null);
  });

  it("подмена user после подписи → null", () => {
    const initData = buildInitData({ id: 555 });
    const p = new URLSearchParams(initData);
    p.set("user", JSON.stringify({ id: 666 }));
    expect(verifyMaxInitData(p.toString())).toBe(null);
  });

  it("протухший auth_date (>24ч) → null", () => {
    const initData = buildInitData({ id: 555 }, { auth_date: String(Math.floor(Date.now() / 1000) - 90000) });
    // buildInitData перезапишет auth_date из extra ПОСЛЕ дефолта — проверим что подпись честная
    expect(verifyMaxInitData(initData)).toBe(null);
  });

  it("пустая строка → null", () => {
    expect(verifyMaxInitData("")).toBe(null);
  });
});

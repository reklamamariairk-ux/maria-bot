import { afterEach, describe, expect, it } from "vitest";
import { isValidDayMonth, isValidIsoDate, normalizeDeliveryDate } from "../src/date-utils";
import { advanceVisitStreak } from "../src/db";
import { orderTrackingToken } from "../src/routes/order-location";
import { orderListHasId } from "../src/routes/order-rating";
import { isAllowedConceptImageUrl } from "../src/routes/cake-concept";
import { hasUniqueQueryKeys, isFreshAuthTimestamp, isValidPlatformId } from "../src/auth-validation";
import { dailyClaimRejection, gameAttemptDay } from "../src/clicker";

describe("строгая проверка календарных дат", () => {
  it("не принимает нормализуемые JavaScript даты", () => {
    expect(isValidIsoDate("2026-02-31")).toBe(false);
    expect(isValidIsoDate("2025-02-29")).toBe(false);
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidDayMonth(31, 4)).toBe(false);
    expect(isValidDayMonth(29, 2)).toBe(true);
    expect(normalizeDeliveryDate("2026-08-21")).toBe("21.08.2026");
    expect(normalizeDeliveryDate("31.02.2026")).toBeNull();
  });
});

describe("семидневный streak", () => {
  it("сохраняет рекорд 7 до сброса нового цикла", () => {
    expect(advanceVisitStreak(6, 6, true)).toEqual({
      current: 0,
      longest: 7,
      reachedReward: true,
    });
  });
});

describe("доступ к данным заказа", () => {
  const previousTrackingSecret = process.env.ORDER_TRACKING_SECRET;
  afterEach(() => {
    if (previousTrackingSecret == null) delete process.env.ORDER_TRACKING_SECRET;
    else process.env.ORDER_TRACKING_SECRET = previousTrackingSecret;
  });

  it("выдаёт разные HMAC-токены разным заказам", () => {
    process.env.ORDER_TRACKING_SECRET = "test-secret-with-enough-entropy";
    const first = orderTrackingToken(1001);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(orderTrackingToken(1002)).not.toBe(first);
  });

  it("разрешает оценивать только заказ из списка владельца", () => {
    const orders = [{ id: 42 }] as Parameters<typeof orderListHasId>[0];
    expect(orderListHasId(orders, "42")).toBe(true);
    expect(orderListHasId(orders, "43")).toBe(false);
  });
});

describe("allowlist AI-изображений", () => {
  it("проверяет hostname, а не строковый префикс", () => {
    expect(isAllowedConceptImageUrl("https://image.pollinations.ai/prompt/cake")).toBe(true);
    expect(isAllowedConceptImageUrl("https://image.pollinations.ai.evil.example/prompt/cake")).toBe(false);
    expect(isAllowedConceptImageUrl("https://image.pollinations.ai@evil.example/prompt/cake")).toBe(false);
  });
});

describe("подписанные launch-параметры", () => {
  it("отклоняет протухшие и далеко будущие timestamp", () => {
    const now = 2_000_000_000;
    expect(isFreshAuthTimestamp(now, now)).toBe(true);
    expect(isFreshAuthTimestamp(now - 86_400, now)).toBe(true);
    expect(isFreshAuthTimestamp(now - 86_401, now)).toBe(false);
    expect(isFreshAuthTimestamp(now + 300, now)).toBe(true);
    expect(isFreshAuthTimestamp(now + 301, now)).toBe(false);
  });

  it("отклоняет дубли параметров и неточные platform ID", () => {
    expect(hasUniqueQueryKeys(new URLSearchParams("user=1&auth_date=2&hash=3"))).toBe(true);
    expect(hasUniqueQueryKeys(new URLSearchParams("user=1&user=2&hash=3"))).toBe(false);
    expect(isValidPlatformId(123)).toBe(true);
    expect(isValidPlatformId(-1)).toBe(false);
    expect(isValidPlatformId(1.5)).toBe(false);
    expect(isValidPlatformId(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
  });
});

describe("суточная граница мини-игр", () => {
  it("привязывает попытку к дню старта по Иркутску", () => {
    expect(gameAttemptDay(Date.parse("2026-08-20T15:59:59Z"))).toBe("2026-08-20");
    expect(gameAttemptDay(Date.parse("2026-08-20T16:00:00Z"))).toBe("2026-08-21");
  });

  it("не позволяет старому жетону откатить уже записанный новый день", () => {
    expect(dailyClaimRejection(null, "2026-08-21")).toBe(null);
    expect(dailyClaimRejection("2026-08-20", "2026-08-21")).toBe(null);
    expect(dailyClaimRejection("2026-08-21", "2026-08-21")).toBe("already");
    expect(dailyClaimRejection("2026-08-21", "2026-08-20")).toBe("stale_attempt");
  });
});

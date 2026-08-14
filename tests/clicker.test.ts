/**
 * Кликер «Котик Комбат» — денежная арифметика сверки покупок
 * (computePurchaseGrant: watermark, кап монет, кап голубей) и границы
 * иркутских суток/недели (todayIrkutsk/weekMonday/weekKey) — от них зависят
 * дневные лимиты (1 письмо/день) и закрытие недельных сезонов.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { CARDS, cardPrice, cardProfit, computePurchaseGrant, todayIrkutsk, weekMonday, weekKey } from "../src/clicker";

describe("экономика прокачки бизнеса", () => {
  it("дорогой следующий уровень увеличивает и саму прибавку дохода", () => {
    const franchise = CARDS.find((c) => c.id === "franchise")!;
    const gain1 = cardProfit(franchise, 1) - cardProfit(franchise, 0);
    const gain7 = cardProfit(franchise, 7) - cardProfit(franchise, 6);
    expect(gain1).toBe(franchise.baseProfit);
    expect(gain7).toBeGreaterThan(gain1 * 3);
  });

  it("цена уровня растёт мягче прежнего коэффициента 1.7", () => {
    const region = CARDS.find((c) => c.id === "region")!;
    expect(cardPrice(region, 5)).toBeLessThan(Math.round(region.basePrice * Math.pow(1.7, 5)));
    const gain = cardProfit(region, 6) - cardProfit(region, 5);
    expect(cardPrice(region, 5) / gain).toBeLessThan(40);
  });
});

describe("computePurchaseGrant — покупки → монеты (watermark, капы)", () => {
  it("нет новых трат → ничего не начисляем", () => {
    expect(computePurchaseGrant(0, 0)).toEqual({ delta: 0, grant: 0, birds: 0 });
    expect(computePurchaseGrant(5000, 5000)).toEqual({ delta: 0, grant: 0, birds: 0 });
  });

  it("откат/новый год (year_spent < watermark) → delta 0, а не отрицательное начисление", () => {
    expect(computePurchaseGrant(3000, 8000)).toEqual({ delta: 0, grant: 0, birds: 0 });
  });

  it("начисляется только дельта сверх watermark, 20 монет за 1₽", () => {
    expect(computePurchaseGrant(5000, 3000)).toEqual({ delta: 2000, grant: 40000, birds: 2 });
  });

  it("голуби: за каждые ПОЛНЫЕ 1000₽ дельты, кап 3 за сверку", () => {
    expect(computePurchaseGrant(999, 0).birds).toBe(0);
    expect(computePurchaseGrant(1000, 0).birds).toBe(1);
    expect(computePurchaseGrant(2999, 0).birds).toBe(2);
    expect(computePurchaseGrant(3000, 0).birds).toBe(3);
    expect(computePurchaseGrant(999_999, 0).birds).toBe(3); // кап
  });

  it("кап монет 5 000 000 за сверку (защита от выбросов данных ЛК)", () => {
    expect(computePurchaseGrant(250_000, 0).grant).toBe(5_000_000);  // ровно кап
    expect(computePurchaseGrant(9_999_999, 0).grant).toBe(5_000_000); // выброс срезан
  });
});

describe("иркутские сутки и неделя (UTC+8)", () => {
  afterEach(() => vi.useRealTimers());

  it("todayIrkutsk переключается в иркутскую полночь (16:00 UTC), а не в UTC-полночь", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-12T15:59:59Z")); // вс 23:59:59 по Иркутску
    expect(todayIrkutsk()).toBe("2026-07-12");
    vi.setSystemTime(new Date("2026-07-12T16:00:00Z")); // пн 00:00:00 по Иркутску
    expect(todayIrkutsk()).toBe("2026-07-13");
  });

  it("weekKey меняется ровно в иркутский понедельник 00:00 и сдвигается на 7 дней", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-12T15:59:59Z"));
    const prev = weekKey();
    vi.setSystemTime(new Date("2026-07-12T16:00:00Z"));
    const next = weekKey();
    expect(Number(next) - Number(prev)).toBe(7);
    // 2026-07-13 — понедельник: weekMonday в этот день указывает на него самого
    expect(weekMonday()).toBe(Date.UTC(2026, 6, 13) / 86400000);
  });

  it("внутри недели ключ стабилен (вт == вс той же недели)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T04:00:00Z")); // вт по Иркутску
    const tue = weekKey();
    vi.setSystemTime(new Date("2026-07-19T15:59:59Z")); // вс 23:59:59 по Иркутску
    expect(weekKey()).toBe(tue);
  });
});

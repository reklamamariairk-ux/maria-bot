/**
 * Кликер «Котик Комбат» — денежная арифметика сверки покупок
 * (computePurchaseGrant: watermark, кап монет, кап голубей) и границы
 * иркутских суток/недели (todayIrkutsk/weekMonday/weekKey) — от них зависят
 * дневные лимиты (1 письмо/день) и закрытие недельных сезонов.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { BUSINESS_MAX_LEVEL, CARDS, cardPrice, cardProfit, closedWeekSeasonPoints, comboHitsIncludingMaxed, comboMilestonesIn, computePurchaseGrant, effectiveCareerLevel, effectiveDailyStreak, gameParticipationReward, nextNeedForLevel, passiveEarnedInCurrentWeek, settleEnergyRegeneration, settlePassiveIncome, settlePassiveIncomeAcrossEvents, todayIrkutsk, weekMonday, weekKey } from "../src/clicker";

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

describe("карьерный уровень и комбо MAX-бизнесов", () => {
  it("не предлагает уровень 2 игроку с сохранённым 19-м уровнем", () => {
    const level = effectiveCareerLevel(0, 19);
    expect(level).toBe(19);
    expect(nextNeedForLevel(level)).toBeNull();
  });

  it("ограничивает повреждённый сохранённый уровень реальным максимумом", () => {
    expect(effectiveCareerLevel(0, 999)).toBe(19);
  });

  it("автоматически засчитывает MAX-бизнес в комбо дня", () => {
    const combo = ["oven", "ads", "barista"];
    expect(comboHitsIncludingMaxed(combo, ["ads"], { oven: BUSINESS_MAX_LEVEL, barista: BUSINESS_MAX_LEVEL - 1 }))
      .toEqual(["oven", "ads"]);
  });
});

describe("серия ежедневных наград", () => {
  it("сохраняет серию после вчерашнего получения", () => {
    expect(effectiveDailyStreak("2026-08-19", 7, "2026-08-20")).toBe(7);
  });

  it("сбрасывает показываемую серию после пропущенного дня", () => {
    expect(effectiveDailyStreak("2026-08-18", 7, "2026-08-20")).toBe(0);
  });
});

describe("пассивный доход без потери дробной части", () => {
  it("сохраняет доход при частых refresh на низкой ставке", () => {
    let carry = 0;
    let earned = 0;
    for (let i = 0; i < 2250; i++) {
      const settled = settlePassiveIncome(60, 1.6, carry);
      earned += settled.earned;
      carry = settled.carry;
    }
    expect(earned).toBe(60);
    expect(carry).toBeCloseTo(0, 8);
  });

  it("ограничивает один офлайн-период тремя часами", () => {
    expect(settlePassiveIncome(100_000, 10 * 3600)).toEqual({ earned: 300_000, carry: 0 });
  });

  it("переносит дробный остаток в следующее начисление", () => {
    const first = settlePassiveIncome(1, 1800);
    expect(first).toEqual({ earned: 0, carry: 0.5 });
    expect(settlePassiveIncome(1, 1800, first.carry)).toEqual({ earned: 1, carry: 0 });
  });

  it("после недельного сброса оставляет в новом сезоне доход после понедельника", () => {
    const monday0030 = new Date("2026-07-12T16:30:00Z").getTime(); // пн 00:30 Иркутск
    const sunday2330 = new Date("2026-07-12T15:30:00Z").getTime();
    expect(passiveEarnedInCurrentWeek(600, sunday2330, monday0030)).toBe(300);
  });

  it("при длинном офлайне считает кап как последние три часа текущей недели", () => {
    const monday1000 = new Date("2026-07-13T02:00:00Z").getTime(); // пн 10:00 Иркутск
    const sunday2000 = new Date("2026-07-12T12:00:00Z").getTime();
    expect(passiveEarnedInCurrentWeek(100, sunday2000, monday1000)).toBe(300);
  });

  it("снимок старой недели исключает уже понедельничный пассив", () => {
    expect(closedWeekSeasonPoints(12_300, 10_000, 300)).toBe(2000);
    expect(closedWeekSeasonPoints(10_100, 10_000, 300)).toBe(0);
  });

  it("делит офлайн-доход точно по началу и концу события выходных", () => {
    const fri2330 = new Date("2026-07-10T15:30:00Z").getTime();
    const sat0030 = new Date("2026-07-10T16:30:00Z").getTime();
    expect(settlePassiveIncomeAcrossEvents(600, fri2330, sat0030).earned).toBe(900); // 300 + 600

    const sun2330 = new Date("2026-07-12T15:30:00Z").getTime();
    const mon0030 = new Date("2026-07-12T16:30:00Z").getTime();
    expect(settlePassiveIncomeAcrossEvents(600, sun2330, mon0030).earned).toBe(900); // 600 + 300
  });
});

describe("регенерация энергии без зависимости от частоты запросов", () => {
  it("накапливает дробные четверти энергии между частыми refresh", () => {
    let energy = 0;
    let carry = 0;
    for (let i = 0; i < 10; i++) {
      const settled = settleEnergyRegeneration(energy, 100, 1.6, carry);
      energy = settled.energy;
      carry = settled.carry;
    }
    expect(energy).toBe(4);
    expect(carry).toBeCloseTo(0, 8);
  });

  it("не округляет неполную энергию вверх и очищает carry на максимуме", () => {
    expect(settleEnergyRegeneration(0, 100, 2)).toEqual({ energy: 0, carry: 0.5 });
    expect(settleEnergyRegeneration(99, 100, 8, 0.75)).toEqual({ energy: 100, carry: 0 });
  });
});

describe("серверные награды не зависят от присланной суммы", () => {
  it("считает бонус только по проверяемым lifetime-тапам", () => {
    expect(comboMilestonesIn(0, 9)).toBe(0);
    expect(comboMilestonesIn(9, 1)).toBe(1);
    expect(comboMilestonesIn(8, 25)).toBe(3); // 10, 20, 30
  });

  it("за завершение каждой игры задана фиксированная награда", () => {
    expect(gameParticipationReward("quiz_kids")).toBe(2500);
    expect(gameParticipationReward("tower")).toBe(6000);
    expect(gameParticipationReward("unknown")).toBe(0);
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

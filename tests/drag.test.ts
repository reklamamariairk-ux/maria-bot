import { describe, it, expect } from "vitest";
import {
  dragPower, dragFinishTime, resolveRace, PAYOUT, REACT_MIN,
  COMP_REACT_LO, COMP_REACT_HI, competitiveReaction, hardenBetField, makeBot,
  revAccuracy, reactAccuracy, launchSkill, dragFinishTimeV2, resolveRaceV2,
  competitiveSkill, hardenBetFieldV2, REV_HALF, COMP_SKILL_LO, COMP_SKILL_HI,
} from "../src/drag";

describe("dragPower — мощность голубя для заезда", () => {
  it("растёт со скоростью/выносливостью и редкостью, детерминированна", () => {
    expect(dragPower("legendary", 3, 10, 10)).toBeGreaterThan(dragPower("common", 1, 0, 0));
    expect(dragPower("common", 1, 5, 0)).toBeGreaterThan(dragPower("common", 1, 0, 0));
    expect(dragPower("common", 1, 0, 0)).toBe(dragPower("common", 1, 0, 0)); // без рандома
  });
});

describe("dragFinishTime — финишное время (меньше = быстрее)", () => {
  it("мощнее голубь финиширует раньше (при равной реакции/рандоме)", () => {
    const strong = dragFinishTime(150, 300, 0.5);
    const weak = dragFinishTime(20, 300, 0.5);
    expect(strong).toBeLessThan(weak);
  });
  it("быстрее реакция → раньше финиш (при равной мощности)", () => {
    expect(dragFinishTime(80, 150, 0.5)).toBeLessThan(dragFinishTime(80, 900, 0.5));
  });
  it(`реакция зажимается: <${REACT_MIN}мс не даёт преимущества (анти-скрипт floor)`, () => {
    expect(REACT_MIN).toBe(200); // человечески честный минимум; 120мс = предугадывание/скрипт
    expect(dragFinishTime(80, 0, 0.5)).toBe(dragFinishTime(80, REACT_MIN, 0.5));
    expect(dragFinishTime(80, 120, 0.5)).toBe(dragFinishTime(80, REACT_MIN, 0.5));
    expect(dragFinishTime(80, 5000, 0.5)).toBe(dragFinishTime(80, 3000, 0.5));
  });
});

describe("resolveRace — места по возрастанию finishT + доминирование мощности", () => {
  it("МОЩНОСТЬ ГЛАВНЕЕ: сильный голубь с плохой реакцией обходит слабого с идеальной", () => {
    // сильный (power 150, реакция 900) vs слабый (power 20, реакция 120)
    const places = resolveRace([{ power: 150, reactionMs: 900, r: 0.5 }, { power: 20, reactionMs: 120, r: 0.5 }]);
    expect(places[0]).toBe(1); // сильный выиграл несмотря на худшую реакцию
    expect(places[1]).toBe(2);
  });
  it("при РАВНОЙ мощности решает реакция", () => {
    const places = resolveRace([{ power: 80, reactionMs: 700, r: 0.5 }, { power: 80, reactionMs: 200, r: 0.5 }]);
    expect(places[1]).toBe(1); // у кого реакция лучше — тот первый
  });
  it("реакция решает генуинно близкую дуэль (малый разрыв мощности)", () => {
    // gap всего 6 power: у кого реакция сильно лучше — тот и выигрывает
    const places = resolveRace([{ power: 80, reactionMs: 900, r: 0.5 }, { power: 74, reactionMs: 150, r: 0.5 }]);
    expect(places[1]).toBe(1); // чуть слабее, но реакция сильно лучше → первый
  });
  it("места уникальны и покрывают 1..N", () => {
    const places = resolveRace([{ power: 100, reactionMs: 300, r: 0.1 }, { power: 90, reactionMs: 300, r: 0.5 }, { power: 110, reactionMs: 300, r: 0.9 }]);
    expect([...places].sort()).toEqual([1, 2, 3]);
  });
});

// ── Экономика ставки: EV читера ≤ 0 (fast-follow от 15.07, спека 2026-07-30) ──
// Симулируем боевой пайплайн ставки: реакции соперников раздаёт СЕРВЕР
// (competitiveReaction), игрок присылает свою. EV в долях ставки: P1·(+1)+P2·0−P3−P4.
function betEV(myReactionMs: number, N: number): number {
  let sum = 0;
  for (let k = 0; k < N; k++) {
    const field = [
      { power: 50, reactionMs: myReactionMs, r: Math.random() },
      { power: 50, reactionMs: competitiveReaction(), r: Math.random() },
      { power: 50, reactionMs: competitiveReaction(), r: Math.random() },
      { power: 50, reactionMs: competitiveReaction(), r: Math.random() },
    ];
    sum += (PAYOUT[resolveRace(field)[0]] ?? 0) - 1;
  }
  return sum / N;
}

describe("экономика ставки — Монте-Карло против конкурентного поля равной мощности", () => {
  it("идеальный скрипт (реакция 0мс → кламп) в минусе: казна не кормит читера", () => {
    expect(betEV(0, 200_000)).toBeLessThan(-0.01); // истинный EV ≈ −0.037
  });
  it("медленная реакция сильно наказывается", () => {
    expect(betEV(600, 100_000)).toBeLessThan(-0.5); // истинный EV ≈ −0.92
  });
  it("реакция остаётся навыком: быстрый честный существенно лучше медленного", () => {
    expect(betEV(250, 100_000) - betEV(600, 100_000)).toBeGreaterThan(0.3);
  });
});

describe("hardenBetField — серверное поле режима «Ставка»", () => {
  const target = 80;
  const opps = [
    { breed: "sizar", power: target - 25, reactionMs: 1500, bot: false },   // слишком слабый → замена ботом
    { breed: "ryaboy", power: target - 5, reactionMs: 900, bot: false },    // в допуске → остаётся
    { breed: "zolotoy", power: target + 10, reactionMs: 120, bot: false },  // сильнее → остаётся
  ];
  it("реакции ВСЕХ соперников — серверные, в конкурентном диапазоне", () => {
    for (let i = 0; i < 50; i++) {
      for (const r of hardenBetField(opps.map(o => ({ ...o })), target)) {
        expect(r.reactionMs).toBeGreaterThanOrEqual(COMP_REACT_LO);
        expect(r.reactionMs).toBeLessThanOrEqual(COMP_REACT_HI);
      }
    }
  });
  it("соперник слабее target−10 заменяется ботом ≈target (нет поля «все слабее меня»)", () => {
    const field = hardenBetField(opps.map(o => ({ ...o })), target);
    expect(field).toHaveLength(3);
    for (const r of field) expect(r.power).toBeGreaterThanOrEqual(target - 10);
    expect(field.filter(r => r.bot)).toHaveLength(1); // заменён ровно слабый
  });
  it("соперники в допуске сохраняют породу и мощность (реальный флейвор)", () => {
    const field = hardenBetField(opps.map(o => ({ ...o })), target);
    expect(field.some(r => r.breed === "ryaboy" && r.power === target - 5)).toBe(true);
    expect(field.some(r => r.breed === "zolotoy" && r.power === target + 10)).toBe(true);
  });
});

// ── Механика v2 «Идеальный запуск» (спека 2026-07-30-drag-launch-mechanic-v2) ──

describe("v2 accuracy — клампы навыковых инпутов", () => {
  it("revAccuracy: центр зоны = 1, край окна = 0, дальше не уходит в минус", () => {
    expect(revAccuracy(0)).toBe(1);
    expect(revAccuracy(REV_HALF)).toBe(0);
    expect(revAccuracy(-REV_HALF)).toBe(0);
    expect(revAccuracy(99999)).toBe(0);
    expect(revAccuracy(REV_HALF / 2)).toBeCloseTo(0.5, 5);
  });
  it("reactAccuracy: 200мс = 1.0, ≥800мс = 0, скрипт <200мс не лучше 200", () => {
    expect(reactAccuracy(200)).toBe(1);
    expect(reactAccuracy(0)).toBe(1);       // кламп к REACT_MIN — предугадывание не награждается
    expect(reactAccuracy(800)).toBe(0);
    expect(reactAccuracy(3000)).toBe(0);
    expect(reactAccuracy(500)).toBeCloseTo(0.5, 5);
  });
  it("launchSkill ∈ [0,1], идеальный запуск = 1, полностью мимо = 0", () => {
    expect(launchSkill({ rev1: 0, rev2: 0, reactionMs: 200 })).toBe(1);
    expect(launchSkill({ rev1: 9999, rev2: -9999, reactionMs: 3000 })).toBe(0);
    const mid = launchSkill({ rev1: 150, rev2: 150, reactionMs: 500 });
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.8);
  });
});

describe("v2 resolveRaceV2 — мощность главнее, при равной решает запуск", () => {
  it("при равной мощности выше skill → первый (без люка)", () => {
    const places = resolveRaceV2([{ power: 80, skill: 0.4, r: 0.5 }, { power: 80, skill: 0.9, r: 0.5 }]);
    expect(places[1]).toBe(1);
  });
  it("большой разрыв мощности (25+) не перебивается идеальным запуском", () => {
    const places = resolveRaceV2([{ power: 80, skill: 0, r: 0.5 }, { power: 50, skill: 1, r: 0.5 }]);
    expect(places[0]).toBe(1);
  });
  it("места уникальны 1..N", () => {
    const places = resolveRaceV2([{ power: 80, skill: 0.5, r: 0.1 }, { power: 80, skill: 0.5, r: 0.9 }, { power: 82, skill: 0.5, r: 0.5 }]);
    expect([...places].sort()).toEqual([1, 2, 3]);
  });
});

// EV ставки v2: поле равной мощности, skill соперников раздаёт сервер.
function betEVv2(mySkill: number, N: number): number {
  let sum = 0;
  for (let k = 0; k < N; k++) {
    const field = [
      { power: 50, skill: mySkill, r: Math.random() },
      { power: 50, skill: competitiveSkill(), r: Math.random() },
      { power: 50, skill: competitiveSkill(), r: Math.random() },
      { power: 50, skill: competitiveSkill(), r: Math.random() },
    ];
    sum += (PAYOUT[resolveRaceV2(field)[0]] ?? 0) - 1;
  }
  return sum / N;
}

describe("v2 экономика ставки — Монте-Карло", () => {
  it("идеальный скрипт (skill=1.0) в минусе: казна не кормит читера", () => {
    expect(betEVv2(1.0, 200_000)).toBeLessThan(-0.01);
  });
  it("честный хороший запуск (~0.8) — умеренный минус, не грабёж", () => {
    const ev = betEVv2(0.8, 200_000);
    expect(ev).toBeLessThan(-0.05);
    expect(ev).toBeGreaterThan(-0.45);
  });
  it("навык значим: разрыв EV между 0.85 и 0.4 больше 0.3 ставки", () => {
    expect(betEVv2(0.85, 100_000) - betEVv2(0.4, 100_000)).toBeGreaterThan(0.3);
  });
});

describe("v2 hardenBetFieldV2 — серверное поле «Ставки»", () => {
  const target = 80;
  const opps = [
    { breed: "sizar", power: target - 25, reactionMs: 1500, bot: false },
    { breed: "ryaboy", power: target - 5, reactionMs: 900, bot: false },
    { breed: "zolotoy", power: target + 10, reactionMs: 120, bot: false },
  ];
  it("skill всех соперников — серверный, в конкурентном диапазоне", () => {
    for (let i = 0; i < 50; i++) {
      for (const r of hardenBetFieldV2(opps.map(o => ({ ...o })), target)) {
        expect(r.skill).toBeGreaterThanOrEqual(COMP_SKILL_LO);
        expect(r.skill).toBeLessThanOrEqual(COMP_SKILL_HI);
      }
    }
  });
  it("слабее target−10 заменяется ботом ≈target (как v1)", () => {
    const field = hardenBetFieldV2(opps.map(o => ({ ...o })), target);
    for (const r of field) expect(r.power).toBeGreaterThanOrEqual(target - 10);
    expect(field.filter(r => r.bot)).toHaveLength(1);
  });
});

describe("makeBot — бот достижим на всей лестнице мощности", () => {
  it("дотягивается до максимума игрока (легендарка ★3 + тюнинг 10/10 = 156)", () => {
    for (let i = 0; i < 20; i++) expect(Math.abs(makeBot(156, i).power - 156)).toBeLessThanOrEqual(3);
  });
  it("низкий target тоже ок (без отрицательного тюнинга)", () => {
    for (let i = 0; i < 20; i++) {
      const b = makeBot(12, i);
      expect(b.power).toBeGreaterThanOrEqual(10);
      expect(b.power).toBeLessThanOrEqual(25);
    }
  });
});

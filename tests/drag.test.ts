import { describe, it, expect } from "vitest";
import {
  dragPower, dragFinishTime, resolveRace, PAYOUT, REACT_MIN,
  COMP_REACT_LO, COMP_REACT_HI, competitiveReaction, hardenBetField, makeBot,
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

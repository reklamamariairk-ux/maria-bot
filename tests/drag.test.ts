import { describe, it, expect } from "vitest";
import { dragPower, dragFinishTime, resolveRace, DRAG_ENERGY_COST } from "../src/drag";

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
  it("реакция зажимается: <120мс не даёт преимущества сверх 120", () => {
    expect(dragFinishTime(80, 0, 0.5)).toBe(dragFinishTime(80, 120, 0.5));
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
  it("места уникальны и покрывают 1..N", () => {
    const places = resolveRace([{ power: 100, reactionMs: 300, r: 0.1 }, { power: 90, reactionMs: 300, r: 0.5 }, { power: 110, reactionMs: 300, r: 0.9 }]);
    expect([...places].sort()).toEqual([1, 2, 3]);
  });
});

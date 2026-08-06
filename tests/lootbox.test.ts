import { describe, it, expect } from "vitest";
import { CASE_COST, CASE_SLOTS, CASE_TOTAL_WEIGHT, caseEV, rollCase, prizeValue, type CasePrize } from "../src/lootbox";

describe("экономика кейса — дом в плюсе (EV < цены)", () => {
  it("средняя ценность приза ниже цены открытия — домовый эдж положительный", () => {
    const { ev, evNoChampion, edge, edgeNoChampion } = caseEV();
    // Печатаем для наглядности при тюнинге.
    console.log(`CASE: cost=${CASE_COST} EV=${Math.round(ev)} edge=${(edge * 100).toFixed(1)}% | EV(без чемпиона)=${Math.round(evNoChampion)} edge=${(edgeNoChampion * 100).toFixed(1)}%`);
    // Реалистичный EV (чемпион падает ≤1/год, его вклад в дистанции ~0) должен быть заметно ниже цены.
    expect(evNoChampion).toBeLessThan(CASE_COST);
    expect(edgeNoChampion).toBeGreaterThan(0.2);   // дом забирает ≥20%
    expect(edgeNoChampion).toBeLessThan(0.5);       // но не грабёж (≤50%)
  });
  it("веса положительны и слоты покрывают весь диапазон", () => {
    expect(CASE_TOTAL_WEIGHT).toBeGreaterThan(0);
    for (const s of CASE_SLOTS) expect(s.weight).toBeGreaterThan(0);
  });
});

describe("rollCase — розыгрыш и гейт чемпиона", () => {
  it("чемпион НЕ выпадает, когда гейт закрыт (championAllowed=false)", () => {
    let champ = 0;
    for (let i = 0; i < 20000; i++) {
      const p = rollCase(Math.random(), Math.random(), false);
      if (p.type === "champion") champ++;
    }
    expect(champ).toBe(0);
  });
  it("чемпион МОЖЕТ выпасть, когда гейт открыт (championAllowed=true)", () => {
    let champ = 0;
    for (let i = 0; i < 200000; i++) {
      const p = rollCase(Math.random(), Math.random(), true);
      if (p.type === "champion") champ++;
    }
    expect(champ).toBeGreaterThan(0); // при весе ~0.1% на 200k бросков появится
  });
  it("все призы — валидного типа, монеты в разумных границах", () => {
    for (let i = 0; i < 5000; i++) {
      const p: CasePrize = rollCase(Math.random(), Math.random(), true);
      expect(["coins", "turbo", "energy", "pigeon", "champion"]).toContain(p.type);
      if (p.type === "coins") { expect(p.amount).toBeGreaterThan(0); expect(prizeValue(p)).toBe(p.amount); }
    }
  });
  it("на дистанции дом в плюсе: сумма выигрышей < сумма ставок (Монте-Карло, гейт закрыт)", () => {
    let staked = 0, won = 0;
    for (let i = 0; i < 100000; i++) {
      staked += CASE_COST;
      won += prizeValue(rollCase(Math.random(), Math.random(), false));
    }
    expect(won).toBeLessThan(staked); // дом не уходит в минус на дистанции
    console.log(`Монте-Карло 100k: возврат игроку ${(won / staked * 100).toFixed(1)}%`);
  });
});

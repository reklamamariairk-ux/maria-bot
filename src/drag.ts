// src/drag.ts — драг-рейсинг: физика заезда (чистые функции) + подбор соперников + резолв.
// Спека: docs/superpowers/specs/2026-07-15-drag-race-design.md
import type { Rarity } from "./pigeons";

export const DRAG_ENERGY_COST = 250;
export const TRACK_LEN = 2000;
export const BASE_SPEED = 220;
export const SPEED_PER_POWER = 5;      // мощность доминирует: разрыв power перевешивает реакцию
export const REACT_MIN = 120, REACT_MAX = 3000;
export const REACT_WEIGHT = 0.4;       // сек за секунду задержки — мал относительно разрыва мощности
export const LUCK_SPREAD = 0.15;       // маленький рандом (сек)
export const POWER_BAND = 25;          // коридор подбора соперников по мощности
export const STAKE_PRESETS = [500, 2000, 10000];
export const PAYOUT: Record<number, number> = { 1: 2, 2: 1, 3: 0, 4: 0 }; // множитель к ставке (2=+ставка, 1=возврат, 0=потеря)

const RARITY_BASE: Record<Rarity, number> = { common: 10, rare: 16, epic: 22, legendary: 28 };

export function dragPower(rarity: Rarity, stars: number, speed: number, stamina: number): number {
  return RARITY_BASE[rarity] + (stars - 1) * 4 + 6 * speed + 6 * stamina;
}

const clampReact = (ms: number) => Math.min(REACT_MAX, Math.max(REACT_MIN, ms));

export function dragFinishTime(power: number, reactionMs: number, r: number): number {
  const speed = BASE_SPEED + power * SPEED_PER_POWER;
  const reactDelay = (clampReact(reactionMs) / 1000) * REACT_WEIGHT;
  return TRACK_LEN / speed + reactDelay + r * LUCK_SPREAD;
}

// Места по возрастанию finishT (1 = победа). Тай-брейк по индексу (стабильно).
export function resolveRace(racers: { power: number; reactionMs: number; r: number }[]): number[] {
  const times = racers.map((x, i) => ({ i, t: dragFinishTime(x.power, x.reactionMs, x.r) }));
  times.sort((a, b) => a.t - b.t || a.i - b.i);
  const places = new Array(racers.length);
  times.forEach((x, rank) => { places[x.i] = rank + 1; });
  return places;
}

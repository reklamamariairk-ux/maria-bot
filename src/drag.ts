// src/drag.ts — драг-рейсинг: физика заезда (чистые функции) + подбор соперников + резолв.
// Спека: docs/superpowers/specs/2026-07-15-drag-race-design.md
import type { Rarity } from "./pigeons";
import { pool } from "./db";
import { PIGEON_BREEDS, BREED_BY_ID, TUNE_MAX } from "./pigeons";

export const DRAG_ENERGY_COST = 250;
export const TRACK_LEN = 2000;
export const BASE_SPEED = 220;
export const SPEED_PER_POWER = 5;      // мощность доминирует: разрыв power перевешивает реакцию
export const REACT_MIN = 120, REACT_MAX = 3000;
export const REACT_WEIGHT = 0.25;      // реакция решает близкие дуэли (≲15 power), но не перебивает большой разрыв мощности
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

// ── Подбор соперников ──────────────────────────────────────────────────────

export type Racer = { breed: string; power: number; reactionMs: number; bot: boolean; name?: string };

// Детерминированная «правдоподобная» реакция без Math.random — используется как фолбэк,
// когда у игрока ещё нет своего race_reaction_ms (новичок) и для базовой реакции бота.
function synthReaction(target: number): number {
  return clampReact(250 + Math.round((target % 7) * 40));
}

// Синтетический соперник-бот под целевую мощность target: не-чемпионская порода нужной
// редкости (чемпион — только приз, не гоняется как соперник), tune_speed/tune_stamina
// подобраны так, чтобы dragPower ≈ target. Редкость выбираем под target: у common база
// всего 10, и потолка тюнинга (2×TUNE_MAX=20 → +120 power) не хватает дотянуть до высоких
// таргетов — поэтому чем выше target, тем выше стартовая редкость (её RARITY_BASE даёт
// нижнюю границу), дальше 6 очков power за пункт тюнинга, поровну speed/stamina, кламп 0..TUNE_MAX.
function makeBot(target: number, seed: number): Racer {
  const wantRarity: Rarity = target >= 130 ? "legendary" : target >= 90 ? "epic" : target >= 45 ? "rare" : "common";
  let candidates = PIGEON_BREEDS.filter(b => b.id !== "champion" && b.rarity === wantRarity);
  if (!candidates.length) candidates = PIGEON_BREEDS.filter(b => b.id !== "champion");
  const b = candidates[Math.floor(Math.random() * candidates.length)];
  const stars = 1;
  const base = dragPower(b.rarity, stars, 0, 0);
  const totalPoints = Math.min(2 * TUNE_MAX, Math.max(0, Math.round((target - base) / 6)));
  const speed = Math.min(TUNE_MAX, Math.ceil(totalPoints / 2));
  const stamina = Math.min(TUNE_MAX, totalPoints - speed);
  const power = dragPower(b.rarity, stars, speed, stamina);
  const reactionMs = clampReact(synthReaction(target) + ((seed % 5) - 2) * 15 + Math.round((Math.random() - 0.5) * 60));
  return { breed: b.id, power, reactionMs, bot: true, name: "Соперник" };
}

// n соперников для игрока chatId под целевую мощность targetPower: сперва реальные голуби
// других игроков в коридоре ±POWER_BAND (ближайшие по |power-target|), при нехватке —
// добивка синтетическими ботами под target.
export async function pickOpponents(chatId: number, targetPower: number, n: number): Promise<Racer[]> {
  const rows = (await pool.query(
    `SELECT pi.breed, pi.stars, pi.tune_speed, pi.tune_stamina, cs.race_reaction_ms
       FROM pigeon_inventory pi JOIN clicker_state cs ON cs.chat_id = pi.chat_id
      WHERE pi.chat_id <> $1 AND pi.count > 0`, [chatId])).rows;
  const real: Racer[] = rows.map((r: any) => {
    const b = BREED_BY_ID.get(r.breed)!;
    const power = dragPower(b.rarity, r.stars, r.tune_speed, r.tune_stamina);
    return { breed: r.breed, power, reactionMs: r.race_reaction_ms ?? synthReaction(targetPower), bot: false };
  }).filter(x => Math.abs(x.power - targetPower) <= POWER_BAND)
    .sort((a, b) => Math.abs(a.power - targetPower) - Math.abs(b.power - targetPower))
    .slice(0, n);
  while (real.length < n) real.push(makeBot(targetPower, real.length));
  return real;
}

// src/drag.ts — драг-рейсинг: физика заезда (чистые функции) + подбор соперников + резолв.
// Спека: docs/superpowers/specs/2026-07-15-drag-race-design.md
import type { Rarity } from "./pigeons";
import { pool } from "./db";
import { PIGEON_BREEDS, BREED_BY_ID, TUNE_MAX } from "./pigeons";

export const DRAG_ENERGY_COST = 250;
export const TRACK_LEN = 2000;
export const BASE_SPEED = 220;
export const SPEED_PER_POWER = 5;      // мощность доминирует: разрыв power перевешивает реакцию
export const REACT_MIN = 200, REACT_MAX = 3000; // floor 200мс: быстрее — предугадывание/скрипт, преимущества не даёт
export const REACT_WEIGHT = 0.25;      // реакция решает близкие дуэли (≲15 power), но не перебивает большой разрыв мощности
// Конкурентный диапазон реакций поля в режиме «Ставка» (раздаёт сервер, см. hardenBetField).
// Подобран Монте-Карло (спека 2026-07-30-drag-bet-ev-fix): EV идеального скрипта ≈ −3.7%,
// честного быстрого ≈ −20%, при этом реакция остаётся значимым навыком.
export const COMP_REACT_LO = 205, COMP_REACT_HI = 325;
export const BET_POWER_GAP = 10;       // «Ставка»: соперник слабее target−GAP заменяется ботом ≈target
export const LUCK_SPREAD = 0.15;       // маленький рандом (сек)
export const POWER_BAND = 25;          // коридор подбора соперников по мощности
export const STAKE_PRESETS = [500, 2000, 10000];
export const PAYOUT: Record<number, number> = { 1: 2, 2: 1, 3: 0, 4: 0 }; // множитель к ставке (2=+ставка, 1=возврат, 0=потеря)

// ── Механика v2 «Идеальный запуск» (спека 2026-07-30-drag-launch-mechanic-v2) ──
// Три навыковых инпута до старта: прогрев + форсаж (отступ стрелки от центра золотой
// зоны, мс) и реакция на зелёный. Константы подобраны Монте-Карло (tests/drag.test.ts):
// дом-эдж поля из 4 равных = −25%; перфект-скрипт получает лишь лёгкий буст (EV < 0).
export const REV_HALF = 300;            // окно точности свипа: |отступ| ≥ 300мс → 0
export const REACT_SPAN = 600;          // реакция 200мс → 1.0, ≥800мс → 0
export const SKILL_SPREAD = 0.14;       // сек штрафа между запуском 1.0 и 0.0
export const LUCK_SPREAD_V2 = 0.15;     // сек случайного разброса (правит близкие дуэли)
export const COMP_SKILL_LO = 0.75, COMP_SKILL_HI = 1.0;   // поле «Ставки»
export const TRAIN_SKILL_LO = 0.45, TRAIN_SKILL_HI = 0.95; // поле «Тренировки»

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export type LaunchInput = { rev1: number; rev2: number; reactionMs: number };

export function revAccuracy(offsetMs: number): number {
  const off = Math.abs(Number(offsetMs));
  if (!Number.isFinite(off)) return 0;
  return clamp01(1 - off / REV_HALF);
}
export function reactAccuracy(ms: number): number {
  return clamp01(1 - (clampReact(ms) - REACT_MIN) / REACT_SPAN);
}
export function launchSkill(inp: LaunchInput): number {
  return 0.3 * revAccuracy(inp.rev1) + 0.3 * revAccuracy(inp.rev2) + 0.4 * reactAccuracy(inp.reactionMs);
}
export function dragFinishTimeV2(power: number, skill: number, r: number): number {
  const speed = BASE_SPEED + power * SPEED_PER_POWER;
  return TRACK_LEN / speed + (1 - clamp01(skill)) * SKILL_SPREAD + r * LUCK_SPREAD_V2;
}
export function resolveRaceV2(racers: { power: number; skill: number; r: number }[]): number[] {
  const times = racers.map((x, i) => ({ i, t: dragFinishTimeV2(x.power, x.skill, x.r) }));
  times.sort((a, b) => a.t - b.t || a.i - b.i);
  const places = new Array(racers.length);
  times.forEach((x, rank) => { places[x.i] = rank + 1; });
  return places;
}
export function competitiveSkill(lo = COMP_SKILL_LO, hi = COMP_SKILL_HI, rng: () => number = Math.random): number {
  return lo + rng() * (hi - lo);
}

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

// Реакция соперника в режиме «Ставка»: раздаёт СЕРВЕР из конкурентного диапазона —
// сохранённые (протухшие/медленные) реакции реальных игроков и предсказуемые реакции
// ботов не должны превращать поле в кормушку для скриптера с константной реакцией.
export function competitiveReaction(rng: () => number = Math.random): number {
  return clampReact(Math.round(COMP_REACT_LO + rng() * (COMP_REACT_HI - COMP_REACT_LO)));
}

// Синтетический соперник-бот под целевую мощность target: не-чемпионская порода нужной
// редкости (чемпион — только приз, не гоняется как соперник), tune_speed/tune_stamina
// подобраны так, чтобы dragPower ≈ target. Редкость выбираем под target: у common база
// всего 10, и потолка тюнинга (2×TUNE_MAX=20 → +120 power) не хватает дотянуть до высоких
// таргетов — поэтому чем выше target, тем выше стартовая редкость (её RARITY_BASE даёт
// нижнюю границу), дальше 6 очков power за пункт тюнинга, поровну speed/stamina, кламп 0..TUNE_MAX.
// Если и максимальной редкости со stars=1 не хватает (эндгейм: игрок 156 > потолок бота 148),
// поднимаем звёзды до 3 — бот достижим на всей лестнице, гарантированных побед «по мощности» нет.
export function makeBot(target: number, seed: number): Racer {
  const wantRarity: Rarity = target >= 130 ? "legendary" : target >= 90 ? "epic" : target >= 45 ? "rare" : "common";
  let candidates = PIGEON_BREEDS.filter(b => b.id !== "champion" && b.rarity === wantRarity);
  if (!candidates.length) candidates = PIGEON_BREEDS.filter(b => b.id !== "champion");
  const b = candidates[Math.floor(Math.random() * candidates.length)];
  let stars = 1;
  while (stars < 3 && Math.round((target - dragPower(b.rarity, stars, 0, 0)) / 6) > 2 * TUNE_MAX) stars++;
  const base = dragPower(b.rarity, stars, 0, 0);
  const totalPoints = Math.min(2 * TUNE_MAX, Math.max(0, Math.round((target - base) / 6)));
  const speed = Math.min(TUNE_MAX, Math.ceil(totalPoints / 2));
  const stamina = Math.min(TUNE_MAX, totalPoints - speed);
  const power = dragPower(b.rarity, stars, speed, stamina);
  const reactionMs = clampReact(synthReaction(target) + ((seed % 5) - 2) * 15 + Math.round((Math.random() - 0.5) * 60));
  return { breed: b.id, power, reactionMs, bot: true, name: "Соперник" };
}

// v2: то же ужесточение поля «Ставки» по мощности, но вместо реакций сервер раздаёт
// сопернику launch-skill из конкурентного диапазона. Для «Тренировки» — диапазон шире
// и добрее (казуальное поле), см. assignFieldSkill.
export type RacerV2 = Racer & { skill: number };
export function hardenBetFieldV2(opps: Racer[], target: number, rng: () => number = Math.random): RacerV2[] {
  return opps.map((o, i) => {
    const r = o.power < target - BET_POWER_GAP ? makeBot(target, i) : o;
    return { ...r, skill: competitiveSkill(COMP_SKILL_LO, COMP_SKILL_HI, rng) };
  });
}
export function assignFieldSkill(opps: Racer[], mode: "training" | "bet", target: number): RacerV2[] {
  if (mode === "bet") return hardenBetFieldV2(opps, target);
  return opps.map(o => ({ ...o, skill: competitiveSkill(TRAIN_SKILL_LO, TRAIN_SKILL_HI) }));
}

// Ужесточение поля для режима «Ставка» (спека 2026-07-30-drag-bet-ev-fix):
// 1) соперник слабее target−BET_POWER_GAP → замена ботом ≈target (иначе игрок на вершине
//    лестницы получает поле строго слабее себя = гарантированная победа);
// 2) реакции ВСЕХ соперников — серверная конкурентная выборка на этот заезд.
// Порода/мощность реальных соперников в допуске сохраняются (флейвор «гоняюсь с живыми»).
export function hardenBetField(opps: Racer[], target: number): Racer[] {
  return opps.map((o, i) => {
    const r = o.power < target - BET_POWER_GAP ? makeBot(target, i) : o;
    return { ...r, reactionMs: competitiveReaction() };
  });
}

// n соперников для игрока chatId под целевую мощность targetPower: сперва реальные голуби
// других игроков в коридоре ±POWER_BAND (ближайшие по |power-target|), при нехватке —
// добивка синтетическими ботами под target.
export async function pickOpponents(chatId: number, targetPower: number, n: number): Promise<Racer[]> {
  // LIMIT 200 + random(): не полный скан таблицы на каждый заезд (масштабируемость);
  // .filter(BREED_BY_ID.has) — не роняем роут 500-й, если в чужом инвентаре осталась
  // переименованная/удалённая порода (как guard в dragTargetPower).
  const rows = (await pool.query(
    `SELECT pi.breed, pi.stars, pi.tune_speed, pi.tune_stamina, cs.race_reaction_ms
       FROM pigeon_inventory pi JOIN clicker_state cs ON cs.chat_id = pi.chat_id
      WHERE pi.chat_id <> $1 AND pi.count > 0
      ORDER BY random() LIMIT 200`, [chatId])).rows;
  const real: Racer[] = rows.filter((r: any) => BREED_BY_ID.has(r.breed)).map((r: any) => {
    const b = BREED_BY_ID.get(r.breed)!;
    const power = dragPower(b.rarity, r.stars, r.tune_speed, r.tune_stamina);
    return { breed: r.breed, power, reactionMs: r.race_reaction_ms ?? synthReaction(targetPower), bot: false };
  }).filter(x => Math.abs(x.power - targetPower) <= POWER_BAND)
    .sort((a, b) => Math.abs(a.power - targetPower) - Math.abs(b.power - targetPower))
    .slice(0, n);
  while (real.length < n) real.push(makeBot(targetPower, real.length));
  return real;
}

// ── Мощность игрока для породы ─────────────────────────────────────────────
// Возвращает мощность голубя в инвентаре или null если не владеет.
export async function dragTargetPower(chatId: number, breed: string): Promise<number | null> {
  const row = (await pool.query(
    `SELECT stars, tune_speed, tune_stamina FROM pigeon_inventory WHERE chat_id=$1 AND breed=$2 AND count>0`,
    [chatId, breed]
  )).rows[0];
  if (!row) return null;
  const b = BREED_BY_ID.get(breed);
  if (!b) return null;
  return dragPower(b.rarity, row.stars, row.tune_speed, row.tune_stamina);
}

// ── Резолв заезда в транзакции ──────────────────────────────────────────────
// Всё под FOR UPDATE clicker_state (внутри refreshEnergyFor): реген энергии → проверки
// (владение породой/энергия/ставка) → подбор соперников → резолв мест → списание энергии
// + расчёт/начисление ставки → фиксация race_reaction_ms (для будущего pickOpponents).
export async function runRace(chatId: number, breed: string, mode: "training" | "bet", stake: number, reactionMs: number, launch?: LaunchInput | null):
  Promise<{ ok: boolean; racers?: any[]; myPlace?: number; reward?: number; newBalance?: number; newEnergy?: number; mySkill?: any; reason?: string }> {
  if (!BREED_BY_ID.has(breed)) return { ok: false, reason: "not_owned" };
  if (mode !== "training" && mode !== "bet") return { ok: false, reason: "bad_mode" };
  if (mode === "bet" && !STAKE_PRESETS.includes(stake)) return { ok: false, reason: "bad_stake" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Энергия/баланс с регеном — та же строка clicker_state, что и в кликере, взятая
    // FOR UPDATE в этой же транзакции, чтобы не словить гонку с параллельным тапом/заездом.
    const { refreshEnergyFor } = await import("./clicker");
    const st = await refreshEnergyFor(client, chatId);
    const inv = await client.query(`SELECT stars, tune_speed, tune_stamina FROM pigeon_inventory WHERE chat_id=$1 AND breed=$2 AND count>0`, [chatId, breed]);
    if (!inv.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "not_owned" }; }
    if (st.energy < DRAG_ENERGY_COST) { await client.query("ROLLBACK"); return { ok: false, reason: "no_energy" }; }
    if (mode === "bet" && st.balance < stake) { await client.query("ROLLBACK"); return { ok: false, reason: "not_enough_coins" }; }
    const b = BREED_BY_ID.get(breed)!;
    const myPower = dragPower(b.rarity, inv.rows[0].stars, inv.rows[0].tune_speed, inv.rows[0].tune_stamina);
    const picked = await pickOpponents(chatId, myPower, 3);
    const react = Math.min(REACT_MAX, Math.max(REACT_MIN, Math.round(launch ? launch.reactionMs : reactionMs)));
    // Один рандомный «luck»-ролл на гонщика, зафиксированный ДО резолва — места и finishT
    // ниже должны использовать один и тот же r по индексу, иначе места и показанное
    // время анимации разъедутся (клиент анимирует по finishT).
    let racersUnsorted: any[]; let places: number[]; let mySkillOut: any = undefined;
    if (launch) {
      // v2 «Идеальный запуск»: мой skill из трёх инпутов, соперникам skill раздаёт сервер
      // (bet — конкурентный диапазон + гард мощности, training — шире и добрее).
      const opps = assignFieldSkill(picked, mode, myPower);
      const mySkill = launchSkill(launch);
      const field = [
        { breed, power: myPower, skill: mySkill, bot: false, me: true },
        ...opps.map(o => ({ breed: o.breed, power: o.power, skill: o.skill, bot: o.bot, me: false })),
      ];
      const rolls = field.map(() => Math.random());
      places = resolveRaceV2(field.map((f, i) => ({ power: f.power, skill: f.skill, r: rolls[i] })));
      racersUnsorted = field.map((f, i) => ({
        breed: f.breed, power: f.power,
        finishT: dragFinishTimeV2(f.power, f.skill, rolls[i]),
        place: places[i], me: f.me, bot: f.bot,
      }));
      mySkillOut = {
        rev1: revAccuracy(launch.rev1), rev2: revAccuracy(launch.rev2),
        react: reactAccuracy(launch.reactionMs), reactionMs: react, total: mySkill,
      };
    } else {
      // Легаси-путь v1 (кэшированные клиенты catdrag ≤4 шлют только reactionMs).
      const opps = mode === "bet" ? hardenBetField(picked, myPower) : picked;
      const field = [
        { breed, power: myPower, reactionMs: react, bot: false, me: true },
        ...opps.map(o => ({ breed: o.breed, power: o.power, reactionMs: o.reactionMs, bot: o.bot, me: false })),
      ];
      const rolls = field.map(() => Math.random());
      places = resolveRace(field.map((f, i) => ({ power: f.power, reactionMs: f.reactionMs, r: rolls[i] })));
      racersUnsorted = field.map((f, i) => ({
        breed: f.breed, power: f.power,
        finishT: dragFinishTime(f.power, f.reactionMs, rolls[i]),
        place: places[i], me: f.me, bot: f.bot,
      }));
    }
    const racers = racersUnsorted.sort((a, b) => a.place - b.place);
    const myPlace = places[0];
    // Списания/выплата: энергия списывается всегда (training тоже тратит попытку); ставка —
    // только в режиме bet, и только после проверки balance>=stake выше, так что баланс не
    // может уйти в минус даже при полном проигрыше (reward = -stake).
    const energyLeft = st.energy - DRAG_ENERGY_COST;
    let balance = st.balance, reward = 0;
    if (mode === "bet") {
      const mult = PAYOUT[myPlace] ?? 0; // 2=+ставка net, 1=возврат (net 0), 0/undefined=потеря
      reward = stake * mult - stake;
      balance += reward;
    }
    // updated_at=NOW() сбрасывает базу регена — иначе следующий refresh() в кликере досчитает
    // энергию ещё раз за те же секунды, что уже учёл refreshEnergyFor выше (двойной реген).
    await client.query(
      `UPDATE clicker_state SET energy=$2, balance=$3, race_reaction_ms=$4, updated_at=NOW() WHERE chat_id=$1`,
      [chatId, energyLeft, balance, react]
    );
    await client.query("COMMIT");
    return { ok: true, racers, myPlace, reward, newBalance: balance, newEnergy: energyLeft, mySkill: mySkillOut };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

# «Голубиная почта» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Коллекция пород голубей с редкостью + P2P-обмен 1-на-1 + голубиная почта со стикерами Василия + звёзды/витрина + Гонка стаи (за флагом), по спеке `docs/superpowers/specs/2026-07-14-pigeon-market-design.md`.

**Architecture:** Новый серверный модуль `src/pigeons.ts` (данные пород + инвентарь + обмены + почта + гонка) с таблицами, создаваемыми в собственном `initPigeonSchema()`. Дроп встраивается в существующие функции `clicker.ts` (сундук/комбо/мини-игры/золотой котик/purchase-sync). HTTP — новый `src/routes/pigeons.ts`. Клиент — новый модуль `public/js/catdove.js`, монтируется в существующую вкладку `dove` кликера.

**Tech Stack:** Node 20 + TypeScript + Express + node-postgres (pool), клиент — vanilla JS модуль в стиле catpet.js. Тестов-фреймворка в репо нет — контроль: `npx tsc --noEmit` после каждой задачи + `node scripts/test-pigeons.mjs` (чистые функции, plain assert) + приёмка по спеке после деплоя.

## Global Constraints

- Ключ игрока везде `chat_id BIGINT` (VK через сдвиг 2e12 — код платформа-агностичен).
- Транзакции ТОЛЬКО `pool.connect()` + BEGIN/COMMIT/ROLLBACK + `client.release()` в `finally`. НИКОГДА `pool.query("BEGIN")`.
- Сутки/недели — по Иркутску: использовать существующие `todayIrkutsk()` и `isoWeekIrkutsk()`-паттерн из clicker.ts (`weekKey()` там уже есть — переиспользовать).
- Выдачи один-раз — вставкой строки-мьютекса (паттерн `clicker_gifts`).
- Отдавать (обмен/почта/скармливание) можно ТОЛЬКО дубликаты: `count > 1`.
- Голуби НЕ покупаются/продаются за монеты — нигде не писать таких путей.
- Никакого свободного текста от игроков — только id стикеров (SMALLINT).
- Все новые роуты: `requireTgUser` + `rateLimit(n)` из существующей middleware.
- Комментарии/строки UI — русский; идентификаторы — английский; стиль комментариев как в clicker.ts.
- После каждой задачи: `npx tsc --noEmit` чистый → commit. Не пушить до финальной задачи.

---

### Task 1: Данные пород и чистые функции (`src/pigeons.ts` + тест-скрипт)

**Files:**
- Create: `src/pigeons.ts`
- Create: `scripts/test-pigeons.mjs`

**Interfaces:**
- Produces: `PIGEON_BREEDS: Breed[]`, `PIGEON_SETS`, `STICKERS`, `RARITY_WEIGHTS`,
  `breedOfWeek(week: string): string`, `pickBreed(r1: number, r2: number, week: string, eventActive: boolean): string`,
  `starTarget(stars: number): number | null`, `raceScore(breed: string, stars: number, r: number): number`,
  `type Rarity = "common" | "rare" | "epic" | "legendary"`.

- [ ] **Step 1: Создать `src/pigeons.ts` с данными и чистыми функциями**

```ts
// src/pigeons.ts — «Голубиная почта»: коллекция пород, обмены, почта, гонка.
// Спека: docs/superpowers/specs/2026-07-14-pigeon-market-design.md
import { Pool, PoolClient } from "pg";

export type Rarity = "common" | "rare" | "epic" | "legendary";
export interface Breed { id: string; name: string; set: string; rarity: Rarity; }

// 4 сета × 4 + «Чемпион» вне сетов (только приз гонки)
export const PIGEON_BREEDS: Breed[] = [
  { id: "sizar",    name: "Сизарь",             set: "city",  rarity: "common" },
  { id: "belobok",  name: "Белобокий",          set: "city",  rarity: "common" },
  { id: "ryaboy",   name: "Рябой",              set: "city",  rarity: "common" },
  { id: "chubaty",  name: "Чубатый",            set: "city",  rarity: "common" },
  { id: "vanil",    name: "Ванильный",          set: "sweet", rarity: "rare" },
  { id: "shoko",    name: "Шоколадный",         set: "sweet", rarity: "rare" },
  { id: "karamel",  name: "Карамельный",        set: "sweet", rarity: "rare" },
  { id: "yagodny",  name: "Ягодный",            set: "sweet", rarity: "rare" },
  { id: "pochtar",  name: "Иркутский почтарь",  set: "post",  rarity: "epic" },
  { id: "baikal",   name: "Байкальский гонец",  set: "post",  rarity: "epic" },
  { id: "kurier",   name: "Ночной курьер",      set: "post",  rarity: "epic" },
  { id: "vozhak",   name: "Вожак стаи",         set: "post",  rarity: "epic" },
  { id: "svadebny", name: "Свадебный",          set: "fest",  rarity: "epic" },
  { id: "imeninny", name: "Именинный",          set: "fest",  rarity: "epic" },
  { id: "snezhny",  name: "Снежный",            set: "fest",  rarity: "epic" },
  { id: "zolotoy",  name: "Золотой голубь Василия", set: "fest", rarity: "legendary" },
  { id: "champion", name: "Чемпион",            set: "",      rarity: "legendary" }, // не дропается
];
export const BREED_BY_ID = new Map(PIGEON_BREEDS.map(b => [b.id, b]));

// Сеты: награда монетами (v1 — только игровое). Полный альбом = 16 сетовых пород.
export const PIGEON_SETS: { id: string; name: string; reward: number }[] = [
  { id: "city",  name: "Городские",        reward: 25000 },
  { id: "sweet", name: "Кондитерские",     reward: 50000 },
  { id: "post",  name: "Почтовые легенды", reward: 75000 },
  { id: "fest",  name: "Праздничные",      reward: 100000 },
];
export const ALBUM_PASSIVE_BONUS = 0.05; // +5% к пассиву за полный альбом (16/16)

// Стикер-фразы Василия (id = индекс). Свободного текста в системе нет.
export const STICKERS: string[] = [
  "Держи, пригодится!", "Сладкого дня!", "От Василия с любовью 🐾", "Такой красавец искал тебя!",
  "За вкусную неделю!", "Пусть воркует у тебя!", "Обменяемся ещё!", "Ты в отличной стае!",
  "Спасибо за игру!", "Гур-гур! (это комплимент)",
];

export const RARITY_WEIGHTS: Record<Rarity, number> = { common: 70, rare: 20, epic: 8, legendary: 2 };
const FEST_SET = "fest";
const WEEK_BOOST = 3; // порода недели: вес породы ×3

// Детерминированная «порода недели» от ключа недели (week = "2026-W29" из weekKey()).
// Хэш — как cipher/combo в clicker.ts: простая свёртка кодов символов.
export function breedOfWeek(week: string): string {
  let h = 0;
  for (const c of week) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const droppable = PIGEON_BREEDS.filter(b => b.id !== "champion");
  return droppable[h % droppable.length].id;
}

// Выбор породы: r1/r2 ∈ [0,1) (Math.random со стороны вызывающего — чистота ради тестов).
// eventActive=false → праздничные (fest) исключаются из пула ПОЛНОСТЬЮ.
export function pickBreed(r1: number, r2: number, week: string, eventActive: boolean): string {
  const boost = breedOfWeek(week);
  const pool = PIGEON_BREEDS.filter(b =>
    b.id !== "champion" && (eventActive || b.set !== FEST_SET));
  // редкость с учётом того, какие редкости остались в пуле
  const present = [...new Set(pool.map(b => b.rarity))];
  const totalW = present.reduce((s, r) => s + RARITY_WEIGHTS[r], 0);
  let acc = 0; let rarity: Rarity = present[present.length - 1];
  for (const r of present) { acc += RARITY_WEIGHTS[r]; if (r1 * totalW < acc) { rarity = r; break; } }
  const inRarity = pool.filter(b => b.rarity === rarity);
  // порода недели ×WEEK_BOOST внутри своей редкости
  const weighted: string[] = [];
  for (const b of inRarity) for (let i = 0; i < (b.id === boost ? WEEK_BOOST : 1); i++) weighted.push(b.id);
  return weighted[Math.floor(r2 * weighted.length)];
}

// Гарантированный дроп за покупку: редкая+ (редкая 70 / эпик 25 / легенда 5), fest вне ивента исключён.
export function pickPurchaseBreed(r1: number, r2: number, eventActive: boolean): string {
  const w: [Rarity, number][] = [["rare", 70], ["epic", 25], ["legendary", 5]];
  let acc = 0; let rarity: Rarity = "rare";
  for (const [r, x] of w) { acc += x; if (r1 * 100 < acc) { rarity = r; break; } }
  let pool = PIGEON_BREEDS.filter(b => b.id !== "champion" && b.rarity === rarity && (eventActive || b.set !== FEST_SET));
  if (!pool.length) pool = PIGEON_BREEDS.filter(b => b.id !== "champion" && b.rarity === "rare"); // легенда вне ивента → фолбэк на редкую
  return pool[Math.floor(r2 * pool.length)].id;
}

// Звёзды: сколько дублей скормить до следующей звезды. ★1→★2 = 3, ★2→★3 = 5, ★3 = кап.
export function starTarget(stars: number): number | null {
  return stars === 1 ? 3 : stars === 2 ? 5 : null;
}

// Гонка: очки = базис редкости + звёзды + рандом (новичок может выиграть).
const RARITY_BASE: Record<Rarity, number> = { common: 10, rare: 16, epic: 22, legendary: 28 };
export function raceScore(breedId: string, stars: number, r: number): number {
  const b = BREED_BY_ID.get(breedId); if (!b) return 0;
  return RARITY_BASE[b.rarity] + (stars - 1) * 4 + Math.floor(r * 40);
}
```

- [ ] **Step 2: Написать тест-скрипт `scripts/test-pigeons.mjs`** (гоняется по собранному dist)

```js
// scripts/test-pigeons.mjs — тесты чистых функций голубей. Запуск: npm run build && node scripts/test-pigeons.mjs
import assert from "node:assert/strict";
import { PIGEON_BREEDS, PIGEON_SETS, breedOfWeek, pickBreed, pickPurchaseBreed, starTarget, raceScore, BREED_BY_ID } from "../dist/pigeons.js";

assert.equal(PIGEON_BREEDS.length, 17);
assert.equal(PIGEON_SETS.length, 4);
for (const s of PIGEON_SETS) assert.equal(PIGEON_BREEDS.filter(b => b.set === s.id).length, 4);

// breedOfWeek детерминирован и не «champion»
assert.equal(breedOfWeek("2026-W29"), breedOfWeek("2026-W29"));
assert.notEqual(breedOfWeek("2026-W29"), "champion");

// вне ивента fest не дропается никогда; champion — никогда вообще
for (let i = 0; i < 5000; i++) {
  const id = pickBreed(Math.random(), Math.random(), "2026-W29", false);
  const b = BREED_BY_ID.get(id);
  assert.ok(b && b.set !== "fest" && id !== "champion", `bad drop ${id}`);
}
// в ивент fest дропается (статистически: 5000 бросков хватит)
let fest = 0;
for (let i = 0; i < 5000; i++) if (BREED_BY_ID.get(pickBreed(Math.random(), Math.random(), "2026-W29", true)).set === "fest") fest++;
assert.ok(fest > 0, "fest must drop during events");

// порода недели реально бустится: частота boost-породы > средней по её редкости
const week = "2026-W30"; const boost = breedOfWeek(week);
const boostRarity = BREED_BY_ID.get(boost).rarity;
const peers = PIGEON_BREEDS.filter(b => b.rarity === boostRarity && b.set !== "fest" && b.id !== "champion");
const cnt = Object.fromEntries(peers.map(p => [p.id, 0]));
for (let i = 0; i < 20000; i++) { const id = pickBreed(Math.random(), Math.random(), week, false); if (id in cnt) cnt[id]++; }
if (peers.length > 1 && boost in cnt) {
  const others = peers.filter(p => p.id !== boost).map(p => cnt[p.id]);
  const avg = others.reduce((a, b) => a + b, 0) / others.length;
  assert.ok(cnt[boost] > avg * 1.8, `week boost weak: ${cnt[boost]} vs avg ${avg}`);
}

// покупка: только rare+; вне ивента без fest
for (let i = 0; i < 5000; i++) {
  const b = BREED_BY_ID.get(pickPurchaseBreed(Math.random(), Math.random(), false));
  assert.ok(b.rarity !== "common" && b.set !== "fest" && b.id !== "champion");
}

assert.equal(starTarget(1), 3); assert.equal(starTarget(2), 5); assert.equal(starTarget(3), null);
assert.ok(raceScore("zolotoy", 3, 0) > raceScore("sizar", 1, 0));
assert.ok(raceScore("sizar", 1, 0.999) > raceScore("zolotoy", 3, 0)); // новичок МОЖЕТ выиграть
console.log("test-pigeons: OK");
```

- [ ] **Step 3: Проверить**

Run: `npx tsc --noEmit && npm run build && node scripts/test-pigeons.mjs`
Expected: `test-pigeons: OK` (упавший assert = чинить pickBreed, не тест).
Примечание: `weekKey()` из clicker.ts здесь ещё не нужен — неделя передаётся строкой.

- [ ] **Step 4: Commit**

```bash
git add src/pigeons.ts scripts/test-pigeons.mjs
git commit -m "feat(pigeons): породы, сеты, стикеры и чистые функции дропа/звёзд/гонки"
```

---

### Task 2: Схема БД + инвентарь/сеты/звёзды/витрина (серверные операции)

**Files:**
- Modify: `src/pigeons.ts` (добавить в конец)

**Interfaces:**
- Consumes: `pool` — импортировать так же, как clicker.ts (`import { pool } from "./db"` — проверить точное имя экспорта в src/db.ts и повторить импорт clicker.ts).
- Consumes: `addClickerBalance(chatId, coins, client?)` из `./clicker` (`clicker.ts:949`).
- Produces:
  - `initPigeonSchema(): Promise<void>`
  - `grantPigeon(chatId: number, breedId: string, client?: PoolClient): Promise<{ breed: string; isNew: boolean }>`
  - `getPigeonsOverview(chatId: number): Promise<{ inventory: {breed,count,stars,showcase}[]; sets: {id,name,reward,owned,claimed}[]; albumDone: boolean; unreadMail: number; weekBreed: string }>`
  - `claimSet(chatId: number, setId: string): Promise<{ ok: boolean; reward?: number; reason?: string }>`
  - `feedPigeon(chatId: number, breedId: string): Promise<{ ok: boolean; stars?: number; spent?: number; reason?: string }>`
  - `setShowcase(chatId: number, breeds: string[]): Promise<{ ok: boolean; reason?: string }>`
  - `hasFullAlbum(chatId: number, client?: PoolClient): Promise<boolean>` — для перка пассива.

- [ ] **Step 1: Дописать в `src/pigeons.ts` схему и операции**

```ts
// ── Схема ──────────────────────────────────────────────────────────────────
export async function initPigeonSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pigeon_inventory (
      chat_id BIGINT NOT NULL, breed TEXT NOT NULL,
      count INT NOT NULL DEFAULT 0, stars SMALLINT NOT NULL DEFAULT 1,
      showcase SMALLINT NOT NULL DEFAULT 0,
      first_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (chat_id, breed));
    CREATE TABLE IF NOT EXISTS pigeon_trades (
      id BIGSERIAL PRIMARY KEY, from_chat BIGINT NOT NULL, to_chat BIGINT,
      give TEXT NOT NULL, want TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), closed_at TIMESTAMPTZ, closed_by BIGINT);
    CREATE INDEX IF NOT EXISTS pigeon_trades_board ON pigeon_trades (status, created_at DESC);
    CREATE TABLE IF NOT EXISTS pigeon_mail (
      id BIGSERIAL PRIMARY KEY, from_chat BIGINT NOT NULL, to_chat BIGINT NOT NULL,
      breed TEXT NOT NULL, sticker SMALLINT NOT NULL, thanks_sticker SMALLINT,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), seen_at TIMESTAMPTZ);
    CREATE INDEX IF NOT EXISTS pigeon_mail_inbox ON pigeon_mail (to_chat, seen_at);
    CREATE TABLE IF NOT EXISTS pigeon_sets_claimed (
      chat_id BIGINT NOT NULL, set_id TEXT NOT NULL, claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (chat_id, set_id));
    CREATE TABLE IF NOT EXISTS pigeon_race_entries (
      week TEXT NOT NULL, chat_id BIGINT NOT NULL, breed TEXT NOT NULL,
      score INT, entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (week, chat_id));
    CREATE TABLE IF NOT EXISTS pigeon_race_winners (
      week TEXT PRIMARY KEY, results JSONB NOT NULL, closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
}

// ── Инвентарь ──────────────────────────────────────────────────────────────
// UPSERT +1. client обязателен, если вызывается из чужой транзакции (дропы clicker.ts).
export async function grantPigeon(chatId: number, breedId: string, client?: PoolClient):
  Promise<{ breed: string; isNew: boolean }> {
  const q = client ?? pool;
  const r = await q.query(
    `INSERT INTO pigeon_inventory (chat_id, breed, count) VALUES ($1,$2,1)
     ON CONFLICT (chat_id, breed) DO UPDATE SET count = pigeon_inventory.count + 1
     RETURNING count`, [chatId, breedId]);
  return { breed: breedId, isNew: r.rows[0].count === 1 };
}

export async function hasFullAlbum(chatId: number, client?: PoolClient): Promise<boolean> {
  const q = client ?? pool;
  const r = await q.query(
    `SELECT COUNT(DISTINCT breed) AS n FROM pigeon_inventory WHERE chat_id=$1 AND count>0 AND breed<>'champion'`,
    [chatId]);
  return Number(r.rows[0].n) >= 16;
}

export async function getPigeonsOverview(chatId: number) {
  const [inv, claimed, mail] = await Promise.all([
    pool.query(`SELECT breed, count, stars, showcase FROM pigeon_inventory WHERE chat_id=$1 AND count>0`, [chatId]),
    pool.query(`SELECT set_id FROM pigeon_sets_claimed WHERE chat_id=$1`, [chatId]),
    pool.query(`SELECT COUNT(*) AS n FROM pigeon_mail WHERE to_chat=$1 AND seen_at IS NULL`, [chatId]),
  ]);
  const owned = new Set(inv.rows.map((r: any) => r.breed));
  const claimedSet = new Set(claimed.rows.map((r: any) => r.set_id));
  const sets = PIGEON_SETS.map(s => ({
    ...s,
    owned: PIGEON_BREEDS.filter(b => b.set === s.id && owned.has(b.id)).length,
    claimed: claimedSet.has(s.id),
  }));
  return {
    inventory: inv.rows, sets,
    albumDone: [...owned].filter(b => b !== "champion").length >= 16,
    unreadMail: Number(mail.rows[0].n),
    weekBreed: breedOfWeek(currentWeekKey()),
  };
}

// claimSet: строка-мьютекс + монеты в одной транзакции (паттерн clicker_gifts).
export async function claimSet(chatId: number, setId: string):
  Promise<{ ok: boolean; reward?: number; reason?: string }> {
  const set = PIGEON_SETS.find(s => s.id === setId);
  if (!set) return { ok: false, reason: "unknown_set" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owned = await client.query(
      `SELECT COUNT(*) AS n FROM pigeon_inventory WHERE chat_id=$1 AND count>0 AND breed = ANY($2)`,
      [chatId, PIGEON_BREEDS.filter(b => b.set === setId).map(b => b.id)]);
    if (Number(owned.rows[0].n) < 4) { await client.query("ROLLBACK"); return { ok: false, reason: "incomplete" }; }
    const mutex = await client.query(
      `INSERT INTO pigeon_sets_claimed (chat_id, set_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING 1`,
      [chatId, setId]);
    if (!mutex.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "already" }; }
    await addClickerBalance(chatId, set.reward, client);
    await client.query("COMMIT");
    return { ok: true, reward: set.reward };
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}

// feedPigeon: скормить дубли до следующей звезды целиком (starTarget штук за раз).
export async function feedPigeon(chatId: number, breedId: string):
  Promise<{ ok: boolean; stars?: number; spent?: number; reason?: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `SELECT count, stars FROM pigeon_inventory WHERE chat_id=$1 AND breed=$2 FOR UPDATE`, [chatId, breedId]);
    if (!r.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "not_owned" }; }
    const { count, stars } = r.rows[0];
    const need = starTarget(stars);
    if (need == null) { await client.query("ROLLBACK"); return { ok: false, reason: "max_stars" }; }
    if (count - 1 < need) { await client.query("ROLLBACK"); return { ok: false, reason: "not_enough_dupes" }; }
    await client.query(
      `UPDATE pigeon_inventory SET count = count - $3, stars = stars + 1 WHERE chat_id=$1 AND breed=$2`,
      [chatId, breedId, need]);
    await client.query("COMMIT");
    return { ok: true, stars: stars + 1, spent: need };
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}

export async function setShowcase(chatId: number, breeds: string[]): Promise<{ ok: boolean; reason?: string }> {
  if (!Array.isArray(breeds) || breeds.length > 3) return { ok: false, reason: "bad_input" };
  if (breeds.some(b => !BREED_BY_ID.has(b))) return { ok: false, reason: "unknown_breed" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE pigeon_inventory SET showcase=0 WHERE chat_id=$1 AND showcase>0`, [chatId]);
    for (let i = 0; i < breeds.length; i++) {
      const u = await client.query(
        `UPDATE pigeon_inventory SET showcase=$3 WHERE chat_id=$1 AND breed=$2 AND count>0`,
        [chatId, breeds[i], i + 1]);
      if (!u.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "not_owned" }; }
    }
    await client.query("COMMIT");
    return { ok: true };
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}
```

Вверху файла добавить `currentWeekKey()` — обёртка недели по Иркутску: найти в clicker.ts функцию ключа недели (`weekKey`, используется в `closeWeeklySeason` `clicker.ts:697`) — если она не экспортирована, экспортировать её из clicker.ts и импортировать здесь (НЕ копировать реализацию).

- [ ] **Step 2: Подключить `initPigeonSchema()`** — в `src/index.ts` рядом с вызовом `initClickerSchema()` (найти по имени) добавить `await initPigeonSchema();` и импорт.

- [ ] **Step 3: Проверить**

Run: `npx tsc --noEmit`
Expected: чисто. (Циклический импорт clicker↔pigeons недопустим: pigeons импортирует из clicker `addClickerBalance` и `weekKey`; clicker в Task 3 импортирует из pigeons `pickBreed`/`grantPigeon` — это цикл. Разрешение: `addClickerBalance` НЕ импортировать статически — принять `client` и написать `UPDATE clicker_state SET balance = balance + $2 ...` напрямую? НЕТ. Правильное разрешение: вынести `weekKey()` в `src/pigeons.ts` невозможно — она clicker-ская. Решение: в claimSet вместо импорта `addClickerBalance` использовать динамический `const { addClickerBalance } = await import("./clicker");` внутри функции — Node ESM/CJS цикл ломается лениво. Так уже делают? Если в репо есть паттерн ленивого импорта — повторить его; если нет — использовать `await import`, TS его поддерживает при `module: commonjs` (проверить tsconfig). Задокументировать выбор комментарием.)

- [ ] **Step 4: Commit**

```bash
git add src/pigeons.ts src/index.ts
git commit -m "feat(pigeons): схема БД, инвентарь, сеты, звёзды, витрина"
```

---

### Task 3: Дроп в существующих механиках clicker.ts

**Files:**
- Modify: `src/clicker.ts` — `openChest` (:604), `claimCombo` (:489), `claimGame` (:575), `claimBonus` (:625), `syncPurchaseBonus` (:1110), пассив-перк в `refresh` (найти расчёт `profitPerHour`).

**Interfaces:**
- Consumes: `pickBreed`, `pickPurchaseBreed`, `grantPigeon`, `hasFullAlbum`, `ALBUM_PASSIVE_BONUS` из `./pigeons` (ленивый `await import` при цикле — см. Task 2 Step 3).
- Produces: во всех перечисленных ответах — опциональное поле `pigeonDrop?: { breed: string; isNew: boolean }`.

- [ ] **Step 1: Общий хелпер дропа в clicker.ts**

```ts
// Дроп голубя из игровых источников. chance ∈ (0,1]; внутри чужой транзакции передавать client.
async function maybeDropPigeon(chatId: number, chance: number, client?: PoolClient):
  Promise<{ breed: string; isNew: boolean } | undefined> {
  if (Math.random() >= chance) return undefined;
  const { pickBreed, grantPigeon } = await import("./pigeons");
  const breed = pickBreed(Math.random(), Math.random(), weekKey(), !!activeEvent());
  return grantPigeon(chatId, breed, client);
}
```

Точные имена `weekKey()`/`activeEvent()` сверить по clicker.ts:47-57 и :697 — использовать те, что есть (activeEvent возвращает объект ивента или null — привести к boolean).

- [ ] **Step 2: Вшить дроп в 4 механики** (шансы из спеки):
  - `openChest` — после успешного приза: `const pigeonDrop = await maybeDropPigeon(chatId, 0.35, client)` (если openChest работает в транзакции — передать client, иначе без), добавить `pigeonDrop` в возвращаемый объект.
  - `claimCombo` — гарантия: `chance = 1`.
  - `claimGame` — только если это ПЕРВЫЙ claim за день (функция уже знает день — дроп только на первом успешном claim среди всех игр; если текущая реализация не различает первый/не первый — добавить проверку `SELECT COUNT(*) FROM clicker_daily`-аналога по паттерну существующего дневного учёта игр, там есть учёт «1 заход/день на игру»): `chance = 0.25`.
  - `claimBonus` — `chance = 0.05`.

- [ ] **Step 3: Покупки → голуби в `syncPurchaseBonus`** (clicker.ts:1110). После существующего начисления монет, в ТОЙ ЖЕ транзакции (watermark там уже атомарен):

```ts
// Каждые полные 1000₽ новых покупок → гарантированный голубь rare+ (кап 3 за сверку).
const birds = Math.min(3, Math.floor(newSpent / 1000)); // newSpent = дельта с прошлого watermark, уже есть в функции
const pigeonDrops: { breed: string; isNew: boolean }[] = [];
if (birds > 0) {
  const { pickPurchaseBreed, grantPigeon } = await import("./pigeons");
  for (let i = 0; i < birds; i++) {
    pigeonDrops.push(await grantPigeon(chatId, pickPurchaseBreed(Math.random(), Math.random(), !!activeEvent()), client));
  }
}
```
Добавить `pigeonDrops` в ответ функции. Точное имя переменной дельты посмотреть в реализации (:1110-1147).

- [ ] **Step 4: Перк альбома +5% к пассиву.** В месте расчёта пассива (`gainMult`/`profitPerHour`, см. `refresh()`/`cardProfit`) добавить множитель `1 + ALBUM_PASSIVE_BONUS` если `await hasFullAlbum(chatId)` — НО не дёргать БД на каждый тап: кэшировать флаг в `clicker_state` колонкой `album_bonus BOOLEAN NOT NULL DEFAULT FALSE` (ALTER в initPigeonSchema: `ALTER TABLE clicker_state ADD COLUMN IF NOT EXISTS album_bonus BOOLEAN NOT NULL DEFAULT FALSE`), выставлять её в `grantPigeon` когда счёт различных пород достигает 16 (одним UPDATE после INSERT). В расчёте пассива читать колонку из уже загруженного state.

- [ ] **Step 5: Проверить + Commit**

Run: `npx tsc --noEmit` → чисто.
```bash
git add src/clicker.ts src/pigeons.ts
git commit -m "feat(pigeons): дроп из сундука/комбо/игр/котика, покупки→голуби, перк альбома"
```

---

### Task 4: Обмены (эскроу + атомарный своп + доска)

**Files:**
- Modify: `src/pigeons.ts` (добавить)

**Interfaces:**
- Produces:
  - `createTrade(chatId, give: string, want: string, to?: number): Promise<{ ok, id?, reason? }>`
  - `acceptTrade(chatId, tradeId: number): Promise<{ ok, got?: string, gave?: string, reason? }>`
  - `cancelTrade(chatId, tradeId: number): Promise<{ ok, reason? }>`
  - `getTradeBoard(chatId): Promise<{ open: TradeRow[]; toMe: TradeRow[]; mine: TradeRow[] }>` где TradeRow = `{ id, from_chat, fromName, give, want, created_at }` (fromName — как в лидерборде `getTop` :661, переиспользовать источник имён).
- Константы: `MAX_OPEN_TRADES = 3`, `TRADE_TTL_DAYS = 7`.

- [ ] **Step 1: Реализация** (эскроу: give списывается при создании; только дубликаты; лимит 3; ленивый expiry)

```ts
export const MAX_OPEN_TRADES = 3;
const TRADE_TTL_DAYS = 7;

export async function createTrade(chatId: number, give: string, want: string, to?: number):
  Promise<{ ok: boolean; id?: number; reason?: string }> {
  if (!BREED_BY_ID.has(give) || !BREED_BY_ID.has(want) || give === want) return { ok: false, reason: "bad_input" };
  if (to === chatId) return { ok: false, reason: "self" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cnt = await client.query(
      `SELECT COUNT(*) AS n FROM pigeon_trades WHERE from_chat=$1 AND status='open'`, [chatId]);
    if (Number(cnt.rows[0].n) >= MAX_OPEN_TRADES) { await client.query("ROLLBACK"); return { ok: false, reason: "limit" }; }
    // эскроу: списать дубликат (count>1!)
    const esc = await client.query(
      `UPDATE pigeon_inventory SET count = count - 1 WHERE chat_id=$1 AND breed=$2 AND count>1 RETURNING 1`,
      [chatId, give]);
    if (!esc.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "need_duplicate" }; }
    const ins = await client.query(
      `INSERT INTO pigeon_trades (from_chat, to_chat, give, want) VALUES ($1,$2,$3,$4) RETURNING id`,
      [chatId, to ?? null, give, want]);
    await client.query("COMMIT");
    return { ok: true, id: ins.rows[0].id };
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}

export async function acceptTrade(chatId: number, tradeId: number):
  Promise<{ ok: boolean; got?: string; gave?: string; reason?: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const t = await client.query(`SELECT * FROM pigeon_trades WHERE id=$1 AND status='open' FOR UPDATE`, [tradeId]);
    if (!t.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "gone" }; }
    const tr = t.rows[0];
    if (Number(tr.from_chat) === chatId) { await client.query("ROLLBACK"); return { ok: false, reason: "own" }; }
    if (tr.to_chat != null && Number(tr.to_chat) !== chatId) { await client.query("ROLLBACK"); return { ok: false, reason: "not_addressed" }; }
    // акцептор отдаёт want (тоже только дубликат)
    const pay = await client.query(
      `UPDATE pigeon_inventory SET count = count - 1 WHERE chat_id=$1 AND breed=$2 AND count>1 RETURNING 1`,
      [chatId, tr.want]);
    if (!pay.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "need_duplicate" }; }
    await grantPigeon(chatId, tr.give, client);               // акцептору — эскроу-птица
    await grantPigeon(Number(tr.from_chat), tr.want, client); // создателю — want
    await client.query(
      `UPDATE pigeon_trades SET status='done', closed_at=NOW(), closed_by=$2 WHERE id=$1`, [tradeId, chatId]);
    await client.query("COMMIT");
    return { ok: true, got: tr.give, gave: tr.want };
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}

export async function cancelTrade(chatId: number, tradeId: number): Promise<{ ok: boolean; reason?: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const t = await client.query(
      `SELECT * FROM pigeon_trades WHERE id=$1 AND from_chat=$2 AND status='open' FOR UPDATE`, [tradeId, chatId]);
    if (!t.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "gone" }; }
    await grantPigeon(chatId, t.rows[0].give, client); // вернуть эскроу
    await client.query(`UPDATE pigeon_trades SET status='cancelled', closed_at=NOW() WHERE id=$1`, [tradeId]);
    await client.query("COMMIT");
    return { ok: true };
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}

// Ленивый expiry: при каждом чтении доски возвращаем эскроу протухших. Курсивно малый объём — норм.
export async function expireTrades(): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const old = await client.query(
      `SELECT id, from_chat, give FROM pigeon_trades
       WHERE status='open' AND created_at < NOW() - INTERVAL '${TRADE_TTL_DAYS} days' FOR UPDATE SKIP LOCKED`);
    for (const r of old.rows) {
      await grantPigeon(Number(r.from_chat), r.give, client);
      await client.query(`UPDATE pigeon_trades SET status='expired', closed_at=NOW() WHERE id=$1`, [r.id]);
    }
    await client.query("COMMIT");
    return old.rowCount ?? 0;
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}

export async function getTradeBoard(chatId: number) {
  await expireTrades();
  const names = `LEFT JOIN clicker_state cs ON cs.chat_id = t.from_chat`; // имя как в getTop: поле имени в clicker_state — сверить (:661) и использовать то же (display_name/first_name)
  const rows = async (where: string, params: any[]) => (await pool.query(
    `SELECT t.id, t.from_chat, t.to_chat, t.give, t.want, t.created_at, cs.name AS from_name
     FROM pigeon_trades t ${names} WHERE t.status='open' AND ${where}
     ORDER BY t.created_at DESC LIMIT 50`, params)).rows;
  return {
    open: await rows(`t.to_chat IS NULL AND t.from_chat<>$1`, [chatId]),
    toMe: await rows(`t.to_chat=$1`, [chatId]),
    mine: await rows(`t.from_chat=$1`, [chatId]),
  };
}
```
Поле имени игрока в `clicker_state` сверить с `getTop` (clicker.ts:661) и подставить реальное — плейсхолдер `cs.name` заменить.

- [ ] **Step 2: Проверить + Commit**

Run: `npx tsc --noEmit` → чисто.
```bash
git add src/pigeons.ts
git commit -m "feat(pigeons): обмены — эскроу, атомарный своп, доска, TTL"
```

---

### Task 5: Голубиная почта + пуш

**Files:**
- Modify: `src/pigeons.ts`; Modify: `src/clicker-push.ts` (или место, где шлются игровые пуши — сверить экспортируемый интерфейс отправки).

**Interfaces:**
- Produces:
  - `sendMail(chatId, breed: string, to: number | "random" | "squad" | "ref", sticker: number): Promise<{ ok, toChat?, reason? }>`
  - `getInbox(chatId): Promise<{ mail: MailRow[] }>` (последние 30, попутно `UPDATE ... SET seen_at=NOW() WHERE seen_at IS NULL`)
  - `thankMail(chatId, mailId: number, sticker: number): Promise<{ ok, reason? }>`
  - `getMailRecipients(chatId): Promise<{ squad: {chat,name}[]; refs: {chat,name}[] }>` — однокомандцы и рефералы, активные 7 дней.

- [ ] **Step 1: Реализация**

```ts
export async function sendMail(chatId: number, breed: string, to: number | "random", sticker: number):
  Promise<{ ok: boolean; toChat?: number; reason?: string }> {
  if (!BREED_BY_ID.has(breed)) return { ok: false, reason: "bad_breed" };
  if (!Number.isInteger(sticker) || sticker < 0 || sticker >= STICKERS.length) return { ok: false, reason: "bad_sticker" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // лимит 1/день по Иркутску
    const { todayIrkutsk } = await import("./clicker"); // если не экспортирован — экспортировать
    const sent = await client.query(
      `SELECT 1 FROM pigeon_mail WHERE from_chat=$1 AND (sent_at AT TIME ZONE 'Asia/Irkutsk')::date = $2 LIMIT 1`,
      [chatId, todayIrkutsk()]);
    if (sent.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "daily_limit" }; }
    let toChat: number;
    if (to === "random") {
      const r = await client.query(
        `SELECT chat_id FROM clicker_state WHERE chat_id<>$1 AND updated_at > NOW() - INTERVAL '7 days'
         ORDER BY random() LIMIT 1`, [chatId]);   // поле последней активности сверить со схемой clicker_state (:236)
      if (!r.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "no_players" }; }
      toChat = Number(r.rows[0].chat_id);
    } else {
      toChat = to;
      if (toChat === chatId) { await client.query("ROLLBACK"); return { ok: false, reason: "self" }; }
      const ex = await client.query(`SELECT 1 FROM clicker_state WHERE chat_id=$1`, [toChat]);
      if (!ex.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "no_player" }; }
    }
    const esc = await client.query(
      `UPDATE pigeon_inventory SET count=count-1 WHERE chat_id=$1 AND breed=$2 AND count>1 RETURNING 1`,
      [chatId, breed]);
    if (!esc.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "need_duplicate" }; }
    await grantPigeon(toChat, breed, client);
    await client.query(
      `INSERT INTO pigeon_mail (from_chat, to_chat, breed, sticker) VALUES ($1,$2,$3,$4)`,
      [chatId, toChat, breed, sticker]);
    await client.query("COMMIT");
    return { ok: true, toChat };
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}
```
`getInbox`/`thankMail` — прямолинейные (SELECT последних 30 c JOIN имени отправителя + UPDATE seen; UPDATE thanks_sticker с проверкой `to_chat=$me AND thanks_sticker IS NULL`). `getMailRecipients` — однокомандцы: `SELECT chat_id, name FROM clicker_state WHERE squad = (SELECT squad FROM clicker_state WHERE chat_id=$1) AND chat_id<>$1 AND <активен 7 дней> LIMIT 20`; рефералы — по полю реферала в clicker_state (сверить имя колонки, `registerRef` :783).

- [ ] **Step 2: Пуш получателю.** В `sendMail` после COMMIT — неблокирующий вызов существующего пуш-канала: посмотреть `src/clicker-push.ts` как шлются streak-пуши (там лимит 1 игровой пуш/день + тихие часы уже реализованы) и отправить тем же путём текст: `🕊 Тебе прилетел голубь! {имя} отправил тебе «{порода}» — загляни в голубятню.` Если механизм требует крон-очереди, а не мгновенной отправки — добавить в существующую очередь тем же паттерном. Ошибку пуша глотать (`catch → log.warn`), почта уже доставлена.

- [ ] **Step 3: Проверить + Commit**

Run: `npx tsc --noEmit` → чисто.
```bash
git add src/pigeons.ts src/clicker-push.ts
git commit -m "feat(pigeons): голубиная почта — отправка, входящие, благодарность, пуш"
```

---

### Task 6: HTTP-роуты

**Files:**
- Create: `src/routes/pigeons.ts`
- Modify: `src/index.ts` (mount)

**Interfaces:**
- Consumes: всё из Task 2/4/5; `requireTgUser`, `rateLimit` — импорт как в `src/routes/clicker.ts:1-16` (скопировать стиль).
- Produces: маршруты из спеки (таблица «API»), все ответы `res.json(result)` как в routes/clicker.ts.

- [ ] **Step 1: Роутер** — по образцу `src/routes/clicker.ts` (каждый хендлер: `const chatId = (req as any).tgUser.chatId`-паттерн — сверить точное извлечение юзера там и повторить):

| Метод/путь | вызов | rateLimit |
|---|---|---|
| GET `/api/pigeons` | `getPigeonsOverview` | 60 |
| POST `/api/pigeons/set-claim` | `claimSet(chatId, body.set)` | 20 |
| GET `/api/pigeons/trades` | `getTradeBoard` | 60 |
| POST `/api/pigeons/trade` | `createTrade(chatId, body.give, body.want, body.to)` | 20 |
| POST `/api/pigeons/trade/accept` | `acceptTrade(chatId, Number(body.id))` | 20 |
| POST `/api/pigeons/trade/cancel` | `cancelTrade(chatId, Number(body.id))` | 20 |
| POST `/api/pigeons/mail` | `sendMail(chatId, body.breed, body.to, Number(body.sticker))` | 10 |
| POST `/api/pigeons/mail/thanks` | `thankMail(chatId, Number(body.id), Number(body.sticker))` | 20 |
| GET `/api/pigeons/mail` | `getInbox` | 60 |
| GET `/api/pigeons/recipients` | `getMailRecipients` | 60 |
| POST `/api/pigeons/feed` | `feedPigeon(chatId, body.breed)` | 20 |
| POST `/api/pigeons/showcase` | `setShowcase(chatId, body.breeds)` | 20 |
| POST `/api/pigeons/race/enter` | `enterRace(chatId, body.breed)` (Task 7) | 20 |
| GET `/api/pigeons/race` | `getRace(chatId)` (Task 7) | 60 |

Валидация входа: строки/числа проверяются в самих функциях (reason-коды) — роутер только приводит типы и ловит исключения `try/catch → res.status(500)` как в routes/clicker.ts.

- [ ] **Step 2: Mount в index.ts** — рядом с `clubRouter` (index.ts:15): `import pigeonsRouter from "./routes/pigeons";` + `app.use(pigeonsRouter);` (по образцу существующих).

- [ ] **Step 3: Проверить + Commit** — `npx tsc --noEmit` чисто; для race-роутов до Task 7 поставить временные заглушки НЕЛЬЗЯ — просто перенести добавление этих двух строк роутера в Task 7.

```bash
git add src/routes/pigeons.ts src/index.ts
git commit -m "feat(pigeons): HTTP-роуты голубятни"
```

---

### Task 7: Гонка стаи (за флагом `PIGEON_RACE_ENABLED`)

**Files:**
- Modify: `src/pigeons.ts`, `src/routes/pigeons.ts` (2 race-роута), `src/index.ts` (крон).

**Interfaces:**
- Produces: `RACE_ENABLED` (env `PIGEON_RACE_ENABLED === "true"`), `enterRace(chatId, breed)`, `getRace(chatId)`, `closeRaceWeek(): Promise<{week, entries, closed}>`.
- Призы: топ-10 монетами `[50000,25000,10000,5000,5000,2500,2500,2500,2500,2500]`, победителю дополнительно порода `champion`.

- [ ] **Step 1: Реализация**

```ts
export const RACE_ENABLED = process.env.PIGEON_RACE_ENABLED === "true";
const RACE_PRIZES = [50000, 25000, 10000, 5000, 5000, 2500, 2500, 2500, 2500, 2500];

export async function enterRace(chatId: number, breed: string): Promise<{ ok: boolean; reason?: string }> {
  if (!RACE_ENABLED) return { ok: false, reason: "disabled" };
  const inv = await pool.query(
    `SELECT stars FROM pigeon_inventory WHERE chat_id=$1 AND breed=$2 AND count>0`, [chatId, breed]);
  if (!inv.rowCount) return { ok: false, reason: "not_owned" };
  // очки фиксируются при заявке — птица НЕ списывается (гонка не сжигает коллекцию)
  const score = raceScore(breed, inv.rows[0].stars, Math.random());
  const ins = await pool.query(
    `INSERT INTO pigeon_race_entries (week, chat_id, breed, score) VALUES ($1,$2,$3,$4)
     ON CONFLICT (week, chat_id) DO NOTHING RETURNING 1`,
    [currentWeekKey(), chatId, breed, score]);
  return ins.rowCount ? { ok: true } : { ok: false, reason: "already" };
}

export async function getRace(chatId: number) {
  const week = currentWeekKey();
  const mine = await pool.query(`SELECT breed FROM pigeon_race_entries WHERE week=$1 AND chat_id=$2`, [week, chatId]);
  const last = await pool.query(`SELECT results FROM pigeon_race_winners ORDER BY week DESC LIMIT 1`);
  const entrants = await pool.query(`SELECT COUNT(*) AS n FROM pigeon_race_entries WHERE week=$1`, [week]);
  return { enabled: RACE_ENABLED, week, myBreed: mine.rows[0]?.breed ?? null,
           entrants: Number(entrants.rows[0].n), lastResults: last.rows[0]?.results ?? null };
}

// Закрытие прошедшей недели. Идемпотентно: мьютекс-строка в pigeon_race_winners.
export async function closeRaceWeek(): Promise<{ week: string; entries: number; closed: boolean }> {
  const prevWeek = previousWeekKey(); // реализовать рядом с currentWeekKey по паттерну closeWeeklySeason (:697) — там прошлая неделя уже вычисляется
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const mutex = await client.query(
      `INSERT INTO pigeon_race_winners (week, results) VALUES ($1,'[]'::jsonb) ON CONFLICT DO NOTHING RETURNING 1`, [prevWeek]);
    if (!mutex.rowCount) { await client.query("ROLLBACK"); return { week: prevWeek, entries: 0, closed: false }; }
    const top = await client.query(
      `SELECT chat_id, breed, score FROM pigeon_race_entries WHERE week=$1 ORDER BY score DESC, entered_at ASC LIMIT 10`, [prevWeek]);
    for (let i = 0; i < top.rows.length; i++) {
      const { addClickerBalance } = await import("./clicker");
      await addClickerBalance(Number(top.rows[i].chat_id), RACE_PRIZES[i], client);
    }
    if (top.rows.length) await grantPigeon(Number(top.rows[0].chat_id), "champion", client);
    await client.query(`UPDATE pigeon_race_winners SET results=$2 WHERE week=$1`,
      [prevWeek, JSON.stringify(top.rows.map((r, i) => ({ place: i + 1, chat: Number(r.chat_id), breed: r.breed, score: r.score, prize: RACE_PRIZES[i] })))]);
    await client.query("COMMIT");
    return { week: prevWeek, entries: top.rows.length, closed: true };
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}
```

- [ ] **Step 2: Крон.** В index.ts рядом с вызовом `closeWeeklySeason` (найти существующий еженедельный крон пн 00:02) добавить `if (RACE_ENABLED) closeRaceWeek()` — гонка финиширует в то же закрытие недели (спека: «финиш вс», закрытие пн 00:02 = сразу после). Роуты race добавить в routes/pigeons.ts.

- [ ] **Step 3: Проверить + Commit** — `npx tsc --noEmit`.

```bash
git add src/pigeons.ts src/routes/pigeons.ts src/index.ts
git commit -m "feat(pigeons): Гонка стаи за флагом PIGEON_RACE_ENABLED"
```

---

### Task 8: Витрина в лидерборде (бэкенд)

**Files:**
- Modify: `src/clicker.ts` — `getTop` (:661).

**Interfaces:**
- Produces: каждый элемент топа дополняется `showcase: { breed: string; stars: number }[]` (0–3 шт) и `title: "Голубиный барон" | null` (если `album_bonus`).

- [ ] **Step 1:** В `getTop` после выборки топа одним запросом дотянуть витрины:
`SELECT chat_id, breed, stars, showcase FROM pigeon_inventory WHERE chat_id = ANY($ids) AND showcase>0 ORDER BY showcase` и смёржить в ответ; `title` — из `album_bonus` колонки clicker_state (уже в выборке топа или добавить в SELECT).

- [ ] **Step 2: Проверить + Commit** — `npx tsc --noEmit`.

```bash
git add src/clicker.ts
git commit -m "feat(pigeons): витрина и титул в лидерборде"
```

---

### Task 9: Клиент — альбом, сеты, звёзды, витрина (`public/js/catdove.js`)

**Files:**
- Create: `public/js/catdove.js`
- Modify: `public/js/catclick.js` — вкладка `dove` (:931, рендер вкладки — найти ветку `setTab('dove')`/рендер голубей-помощников), `public/game.html`:18-48, `public/index.html`:1306-1308.

**Interfaces:**
- Produces: `window.CatDove = { mount(container, api), refreshBadge() }` — `mount` рисует секцию «Коллекция» внутри вкладки dove; `api(path, opts)` — переиспользовать fetch-хелпер catclick (сверить его имя, там есть общий помощник запросов с initData-заголовками; если он локален — экспортировать через `window.ckApi` из catclick.js).
- Consumes: GET `/api/pigeons`, POST `/api/pigeons/set-claim|feed|showcase` (Task 6).

- [ ] **Step 1: Переключатель секций во вкладке dove.** В рендере вкладки dove в catclick.js добавить сверху два сегмент-таба: «Помощники» (существующий контент, по умолчанию) и «Коллекция» (пустой `<div id="ck-dove-col">`, при первом открытии — `window.CatDove.mount(el, ckApi)`). Бейдж непрочитанной почты на кнопке навбара `data-tab="dove"` (:931): красная точка, число из `unreadMail` ответа `/api/pigeons` (грузится при `setTab('dove')` и при старте один раз).

- [ ] **Step 2: `catdove.js` — альбом.** Сетка 4×4 карточек (+ Чемпион отдельной строкой если есть): рамка по редкости (common серый / rare бронза / epic фиолет / legendary золото — взять токены бренда из существующих CSS-переменных catclick, `--gold-*` есть), счётчик `×N`, звёзды ★, бейдж «порода недели» (`weekBreed`), непринадлежащие — силуэт (CSS `filter: brightness(0) opacity(.15)` на арте). Прогресс сетов: строка на сет `3/4` + кнопка «Забрать N монет» когда 4/4 и не claimed → POST set-claim → попап награды в стиле catclick (переиспользовать его попап-функцию — найти как показываются награды сундука и вызвать её же через `window.ck*`-мост или скопировать разметку). Арт: `/img/pigeons/{id}.webp?v=1` с `onerror` → SVG dove из ICON (плейсхолдер до готовности арта).

- [ ] **Step 3: Звёзды и витрина.** Лонг-тап/кнопка на карточке → шит действий: «Скормить дубли (3) → ★2» (активна если `count-1 >= starTarget(stars)`) → POST feed; «На витрину» → локальный выбор до 3 → POST showcase. Ответ-ошибки показывать тост-хелпером catclick (reason-коды: `not_enough_dupes` → «Нужно 3 запасных», `max_stars` → «Максимум звёзд»).

- [ ] **Step 4: Подключение.** В `game.html` и `index.html` добавить `<script src="/js/catdove.js?v=1" defer></script>` рядом с catpet (:47), preload — по образцу :18.版本ы catclick поднять v114→v115 в обоих файлах.

- [ ] **Step 5: Проверить + Commit.** `npx tsc --noEmit` (клиент не под tsc — просто убедиться что сервер цел) + открыть игру локально нельзя (нет БД) — проверка синтаксиса `node --check public/js/catdove.js && node --check public/js/catclick.js`.

```bash
git add public/js/catdove.js public/js/catclick.js public/game.html public/index.html
git commit -m "feat(pigeons): клиент — альбом, сеты, звёзды, витрина"
```

---

### Task 10: Клиент — обмены, почта, дроп-анимация, гонка

**Files:**
- Modify: `public/js/catdove.js`, `public/js/catclick.js`.

**Interfaces:**
- Consumes: GET/POST trades/mail/recipients/race (Task 6/7); поля `pigeonDrop`/`pigeonDrops` в ответах tap-механик (Task 3).

- [ ] **Step 1: Доска обменов** (внутри «Коллекции», кнопка «Обмены»): три списка — «Мне» (адресные, кнопка Принять), «Доска» (открытые чужие, Принять), «Мои» (Отменить). Создание: из карточки породы с `count>1` → «Предложить обмен» → выбор want из сетки → опционально адресат из recipients → POST trade. Reason-коды в тосты: `need_duplicate` → «Отдать можно только запасного», `limit` → «Не больше 3 офферов», `gone` → «Оффер уже разобрали».

- [ ] **Step 2: Почта**: кнопка «Почта» (бейдж unread) → входящие (карточка: птица + стикер-фраза + от кого + кнопка «Поблагодарить» → выбор из STICKERS → POST thanks); «Отправить голубя» → выбор дубликата → адресат (Мои однокомандцы / Рефералы / Случайному игроку) → выбор стикера → POST mail. `daily_limit` → «Голубь уже улетел сегодня — приходи завтра».

- [ ] **Step 3: Дроп-анимация в catclick.js.** Во всех местах обработки ответов сундука/комбо/игры/золотого котика/purchase-sync: если в ответе `pigeonDrop` (или массив `pigeonDrops`) — показать попап «🕊 Прилетел голубь! {name} {isNew ? '— новый в альбоме!' : '(дубликат ×N)'}» тем же стилем, что попапы наград, с рамкой редкости.

- [ ] **Step 4: Гонка** (рисуется только если `getRace().enabled`): секция «Гонка стаи» — заявка (выбор птицы), счётчик участников, топ прошлой недели из `lastResults` с именами не тянем (results хранит chat) — показываем «место/порода/очки/приз», своё место подсвечиваем.

- [ ] **Step 5: Проверить + Commit.** `node --check` обоих файлов.

```bash
git add public/js/catdove.js public/js/catclick.js
git commit -m "feat(pigeons): клиент — обмены, почта, дроп-анимация, гонка"
```

---

### Task 11: Витрина в лидерборде (клиент) + финальная проверка

**Files:**
- Modify: `public/js/catclick.js` (рендер вкладки `top`).

- [ ] **Step 1:** В строке топа выводить до 3 мини-иконок витрины (12px, рамка редкости) + титул «Голубиный барон» бейджем у имени, из полей Task 8.

- [ ] **Step 2: Полная проверка**

Run: `npx tsc --noEmit && npm run build && node scripts/test-pigeons.mjs && node --check public/js/catdove.js && node --check public/js/catclick.js && npm run lint`
Expected: всё чисто, `test-pigeons: OK`.

- [ ] **Step 3: Commit + push**

```bash
git add -A && git commit -m "feat(pigeons): витрина в топе + финальная полировка «Голубиной почты»"
git push origin master
```

- [ ] **Step 4: Деплой и приёмка.** Деплой на VPS (ssh требует запуска юзером — выдать команду `! ssh -i ~/.ssh/maria_prod root@145.223.121.47 "cd /opt/maria && git -C maria-bot pull && docker compose up -d --build maria-bot"`). После деплоя прогнать приёмку из спеки (раздел «Приёмка», пункты 1–13): дроп из сундука, сет-клейм, обмен между двумя тест-аккаунтами (TG+VK), почта случайному, лимиты, звёзды, витрина в топе. Гонку не включать (`PIGEON_RACE_ENABLED` не ставить) до обкатки ядра.

---

## Отложено сознательно (вне плана)

- Арт 17 пород (`/img/pigeons/*.webp`) — отдельная задача генерации (Nano Banana, стиль голубей-помощников v6); до него живут SVG-плейсхолдеры.
- Включение `PIGEON_RACE_ENABLED` — после обкатки ядра.
- Реальные награды за сеты — после ответов Маши (переключение сет-награды на веху).

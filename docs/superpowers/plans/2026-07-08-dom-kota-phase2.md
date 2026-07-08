# «Дом кота» Фаза 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Замкнуть петлю «забота о Василии → реальная ценность»: вехи заботы с реальными подарками (живые сразу), обмен монет на баллы карты (за env-флагом), фундамент — мёрж готовой ветки `flow2-monetization`.

**Architecture:** Всё на существующей рельсе `user_rewards`+`rewards_catalog` (flow2 научил чекаут её гасить). Обмен монет→баллы = новая ветка `kind:"loyalty"` в `clicker.redeemReward` через `earnPoints` с компенсацией монет при сбое. Вехи заботы = 5 записей в существующей лестнице `MILESTONES` с новым типом условия `care_streak`, считаются по рекорду `pet_state.care_streak_best` (не по текущему стрику). Витрина = общая лестница «Награды за прогресс» + виджет-тизер в «Доме кота».

**Tech Stack:** TypeScript (tsc), Express, Neon Postgres (node-postgres), Vanilla JS фронт.

**Spec:** `docs/superpowers/specs/2026-07-08-dom-kota-phase2-design.md`

## ⚠️ Модель верификации (репо БЕЗ unit-фреймворка)

Гейт каждой задачи — **только `npx tsc --noEmit` (exit 0)** для TS и **`node --check <file>` (exit 0)** для фронт-JS. Eslint в проекте не работает — НЕ ставить, НЕ гонять. Локальной БД нет; DB-поведение НЕ проверяем локально (стейдж сидит на ПРОДОВОЙ Neon-БД — мутирующие смоуки только с тестовыми отрицательными `chat_id` + самоочистка, и только по явной команде оркестратора).

## Global Constraints

- **Рабочая папка — ТОЛЬКО worktree `C:/Users/user/maria-bot-phase2`** (ветка `dom-kota-phase2`). Основной чекаут `C:/Users/user/maria-bot` НЕ трогать (грязный, другая ветка).
- **Только реальные данные**: никаких выдуманных скидок/цен; награды реально honored (CLAUDE.md).
- **ID**: в БД internal `chat_id`; наружу только `toPlatformId()`. Значение ≥2e12 вне БД = баг.
- **БД-транзакции** ТОЛЬКО `pool.connect()`+client+BEGIN/COMMIT/ROLLBACK+`client.release()` в `finally`. `pool.query("BEGIN")` НЕ работает.
- **Сутки — Иркутск (UTC+8)**: `new Date(Date.now() + 8*3600*1000).toISOString().slice(0,10)`.
- **Иконки фронта**: рисованные SVG (`ICON.*` в catclick, `PIC.*` в catpet). Эмодзи в UI запрещены.
- **Миграции БД** — только additive (`ALTER ... ADD COLUMN IF NOT EXISTS`), идемпотентные.
- **Зеркала фронт/бэк** (`MILESTONES`, `REWARDS`, пороги care-вех) менять синхронно — в задачах ниже это заложено.
- **Числа наград** (7/14/30/60/100 → 200б/−5%/500б/free_dessert/1000б; bonus300 = 300 баллов за 200000 монет) — из спеки, менять нельзя.
- **`dist/` не коммитить** (Docker сам гоняет tsc); `git add` только конкретные файлы.
- Коммит-сообщения — на русском, в стиле репо (`feat(...)`, `fix(...)`).

---

### Task 1: Мёрж `flow2-monetization` (фундамент)

**Files:**
- Modify: рабочее дерево worktree (merge затронет `src/db.ts`, `src/routes/promo.ts`, `src/clicker.ts`, `public/js/catclick.js`, `docs/superpowers/plans/2026-07-07-kotik-kombat-flow2-monetization.md`)

**Interfaces:**
- Produces (появляются в ветке после мёржа, используются задачами 2-6):
  - `db.ts`: `findUserReward(chatId: number, code: string)`, `markUserRewardUsed(code: string, chatId: number, orderId: string | null)`
  - `clicker.ts`: `redeemReward(chatId, id)` с реальной выдачей через `grantRewardByCode` + компенсацией; `REWARDS` (3 promo-элемента с полем `catalog`)
  - `routes/promo.ts`: `/api/promo/validate` и `/api/promo/use` гасят `user_rewards`
  - `catclick.js`: `codePopup(code)` с кнопкой «Скопировать»

- [ ] **Step 1: установить зависимости (worktree свежий)**

Run: `cd C:/Users/user/maria-bot-phase2 && npm ci`
Expected: exit 0 (появится `node_modules/`).

- [ ] **Step 2: мёрж**

Run: `cd C:/Users/user/maria-bot-phase2 && git merge flow2-monetization -m "merge: flow2-monetization (чекаут гасит user_rewards, монеты→реальный купон) в Фазу 2"`
Expected: мёрж без конфликтов (проверено `git merge-tree` заранее). Если конфликт всё же возник — СТОП, доложить оркестратору, ничего не резолвить самостоятельно.

- [ ] **Step 3: проверка сборки**

Run: `npx tsc --noEmit`
Expected: exit 0, пустой вывод.

Run: `node --check public/js/catclick.js && node --check public/js/catpet.js`
Expected: exit 0.

- [ ] **Step 4: убедиться, что коммит-мёрж создан**

Run: `git log --oneline -3`
Expected: сверху merge-коммит, под ним `f91f433 docs(dom-kota): спека Фазы 2...`.

---

### Task 2: env-флаг `CLICKER_REWARDS_ENABLED` (бэк)

**Files:**
- Modify: `src/clicker.ts` (строки ~127-130 — блок `REWARDS_ENABLED`)

**Interfaces:**
- Produces: `REWARDS_ENABLED: boolean` — то же имя, но значение из env. Все существующие потребители (`getRewards`, `redeemReward`) продолжают работать без правок.

- [ ] **Step 1: заменить константу на чтение env**

В `src/clicker.ts` найти:

```ts
// ── Реальные награды (обмен монет → скидка/бонусы). ⚠️ ВЫКЛ до согласования Маши ──
// Когда Маша утвердит: курс монет, что выдаём (промокод/бонусы на карту), лимиты —
// поставить REWARDS_ENABLED=true, заполнить реальные cost/выдачу, подключить выдачу кода/бонусов.
export const REWARDS_ENABLED = false;
```

Заменить на:

```ts
// ── Реальные награды (обмен монет → скидка/бонусы). ⚠️ ВЫКЛ до согласования Маши ──
// Включение — env CLICKER_REWARDS_ENABLED=1 в bot.env + пересоздание контейнера
// (docker compose up -d --force-recreate). Числа (cost/points) — константы ниже:
// при решениях Маши правим числа и включаем env, нового кода не нужно.
export const REWARDS_ENABLED = process.env.CLICKER_REWARDS_ENABLED === "1";
```

- [ ] **Step 2: проверка сборки**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/clicker.ts
git commit -m "feat(clicker): REWARDS_ENABLED из env CLICKER_REWARDS_ENABLED (дефолт выкл)"
```

---

### Task 3: обмен монет → баллы карты (бэк, путь loyalty)

**Files:**
- Modify: `src/clicker.ts` (`REWARDS`, `redeemReward`)
- Modify: `src/routes/clicker.ts` (ответ `/api/clicker/redeem` — добавить `points`)

**Interfaces:**
- Consumes: `earnPoints(chatId: number, points: number, reason: string, meta?: object)` из `src/club.ts` (уже импортирован в clicker.ts); `isPhoneVerified(chatId)` из club.ts (уже импортирован).
- Produces: `redeemReward` возвращает `{ ok: boolean; code?: string; points?: number; state?: ClickerState; reason?: string }` — при loyalty-обмене поле `points` вместо `code`. Роут отдаёт `{ code?, points?, ...state }`. Фронт (Task 6) различает по наличию `code`/`points`.

- [ ] **Step 1: вернуть `bonus300` в `REWARDS` с типизацией**

В `src/clicker.ts` найти (состояние после мёржа flow2):

```ts
export const REWARDS = [
  { id: "promo5",   name: "Промокод −5%",         cost: 100000, kind: "promo",   catalog: "discount_5",   note: "скидка на заказ" },
  { id: "promo10",  name: "Промокод −10%",        cost: 250000, kind: "promo",   catalog: "discount_10",  note: "скидка на заказ" },
  { id: "dessert",  name: "Десерт в подарок",     cost: 500000, kind: "promo",   catalog: "free_dessert", note: "при заказе" },
];
```

Заменить на (явный тип обязателен — иначе TS не даст обращаться к необщим полям `catalog`/`points`):

```ts
export const REWARDS: { id: string; name: string; cost: number; kind: "promo" | "loyalty"; catalog?: string; points?: number; note: string }[] = [
  { id: "promo5",   name: "Промокод −5%",         cost: 100000, kind: "promo",   catalog: "discount_5",   note: "скидка на заказ" },
  { id: "promo10",  name: "Промокод −10%",        cost: 250000, kind: "promo",   catalog: "discount_10",  note: "скидка на заказ" },
  { id: "bonus300", name: "300 баллов на карту",  cost: 200000, kind: "loyalty", points: 300,             note: "клуб «Мария»" },
  { id: "dessert",  name: "Десерт в подарок",     cost: 500000, kind: "promo",   catalog: "free_dessert", note: "при заказе" },
];
```

- [ ] **Step 2: ветка loyalty в `redeemReward`**

Сигнатуру функции дополнить `points?`:

```ts
export async function redeemReward(chatId: number, id: string): Promise<{ ok: boolean; code?: string; points?: number; state?: ClickerState; reason?: string }> {
```

Сразу после существующих строк

```ts
  if (!REWARDS_ENABLED) return { ok: false, reason: "disabled" };
  const rw = REWARD_BY_ID[id]; if (!rw) return { ok: false, reason: "bad_reward" };
  if (!rw.catalog) return { ok: false, reason: "bad_reward" };
```

заменить третью строку (`if (!rw.catalog)...`) на проверки по kind (баллы падают на РЕАЛЬНУЮ карту → телефон проверяем ДО списания монет):

```ts
  if (rw.kind === "loyalty") {
    if (!rw.points) return { ok: false, reason: "bad_reward" };
    if (!(await isPhoneVerified(chatId).catch(() => false))) return { ok: false, reason: "need_phone" };
  } else if (!rw.catalog) return { ok: false, reason: "bad_reward" };
```

Транзакция списания монет (BEGIN…COMMIT с PENDING-записью) остаётся ОБЩЕЙ без изменений. После блока `catch/finally` транзакции и ПЕРЕД существующим `// выдать реальный код (вне tx)...` вставить loyalty-выдачу:

```ts
  // loyalty: начислить реальные баллы карты (вне tx). При сбое — компенсация монет.
  if (rw.kind === "loyalty") {
    try {
      await earnPoints(chatId, rw.points!, "clicker_redeem", { reward: id });
    } catch (e) {
      await pool.query(`UPDATE clicker_state SET balance=balance+$2 WHERE chat_id=$1`, [chatId, rw.cost]).catch((err) => console.error("[redeem] refund failed", err));
      await pool.query(`DELETE FROM clicker_redemptions WHERE chat_id=$1 AND code='PENDING' AND reward_id=$2 AND created_at > NOW()-INTERVAL '1 minute'`, [chatId, id]).catch((err) => console.error("[redeem] pending cleanup failed", err));
      console.error("[redeem] earnPoints threw", e);
      return { ok: false, reason: "grant_failed" };
    }
    await pool.query(`UPDATE clicker_redemptions SET code=$3 WHERE chat_id=$1 AND reward_id=$2 AND code='PENDING' AND created_at > NOW()-INTERVAL '1 minute'`, [chatId, id, `POINTS:${rw.points}`]).catch((err) => console.error("[redeem] code stamp failed", err));
    return { ok: true, points: rw.points, state: buildState(r, cl, 0) };
  }
```

Существующий promo-путь (`grantRewardByCode` + компенсации) ниже — НЕ трогать. Внутри promo-пути обращения `rw.catalog` теперь типизированы как `string | undefined` — в вызове `grantRewardByCode(chatId, rw.catalog)` заменить на `grantRewardByCode(chatId, rw.catalog!)` (мы уже проверили `!rw.catalog` выше).

- [ ] **Step 3: роут отдаёт `points`**

В `src/routes/clicker.ts` найти (POST `/api/clicker/redeem`):

```ts
  try { const r = await redeemReward(u.id, id); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json({ code: r.code, ...r.state }); trackEvent(u.id, "redeem", { id }); }
```

Заменить `res.json({ code: r.code, ...r.state });` на `res.json({ code: r.code, points: r.points, ...r.state });`.

- [ ] **Step 4: проверка сборки**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/clicker.ts src/routes/clicker.ts
git commit -m "feat(clicker): обмен монет на реальные баллы карты (bonus300 через earnPoints, компенсация при сбое)"
```

---

### Task 4: `care_streak_best` — рекорд стрика заботы (бэк, pet.ts)

**Files:**
- Modify: `src/pet.ts` (`initPetSchema`, интерфейс `PetState`, `toState`, `doPetAction`)

**Interfaces:**
- Produces: колонка `pet_state.care_streak_best INT NOT NULL DEFAULT 0` (монотонно растёт); поле `careStreakBest: number` в `PetState` (ответ `GET /api/pet` и `/api/pet/action`). Task 5 читает колонку SQL-ом, Task 7 читает поле из API.

- [ ] **Step 1: миграция схемы + backfill**

В `src/pet.ts`, в `initPetSchema`, после строки

```ts
    ALTER TABLE pet_state ADD COLUMN IF NOT EXISTS pet_coins_merged BOOLEAN NOT NULL DEFAULT FALSE;
```

добавить внутри того же SQL-литерала:

```ts
    ALTER TABLE pet_state ADD COLUMN IF NOT EXISTS care_streak_best INT NOT NULL DEFAULT 0;
```

И после закрытия этого `await pool.query(\`...\`);` добавить отдельный идемпотентный backfill (самовосстанавливающийся — чинит и будущие рассинхроны):

```ts
  // backfill рекорда из текущего стрика (идемпотентно: только если рекорд отстал)
  await pool.query(`UPDATE pet_state SET care_streak_best = care_streak WHERE care_streak > care_streak_best`);
```

- [ ] **Step 2: интерфейс и `toState`**

В интерфейсе `PetState` (верх файла, рядом с `careStreak: number;`) добавить:

```ts
  careStreakBest: number;
```

В `toState` после строки `careStreak: r.care_streak ?? 0,` добавить:

```ts
    careStreakBest: r.care_streak_best ?? 0,
```

- [ ] **Step 3: обновление рекорда в `doPetAction`**

В `doPetAction` найти блок зачёта стрика:

```ts
    if (r.care_date !== today) {
      r.care_streak = (r.care_date === yest) ? r.care_streak + 1 : 1;
      r.care_date = today;
      streakBonus = careStreakBonus(r.care_streak);
    }
```

Дополнить обновлением рекорда (внутри if, после `r.care_streak = ...`):

```ts
    if (r.care_date !== today) {
      r.care_streak = (r.care_date === yest) ? r.care_streak + 1 : 1;
      r.care_streak_best = Math.max(Number(r.care_streak_best || 0), r.care_streak);
      r.care_date = today;
      streakBonus = careStreakBonus(r.care_streak);
    }
```

И в UPDATE ниже добавить колонку (было `care_streak=$8,care_date=$9`):

```ts
    await client.query(
      `UPDATE pet_state SET hunger=$2,mood=$3,energy=$4,hygiene=$5,xp=$6,level=$7,
         care_streak=$8,care_date=$9,care_streak_best=$10,updated_at=NOW() WHERE chat_id=$1`,
      [chatId, r.hunger, r.mood, r.energy, r.hygiene, r.xp, r.level, r.care_streak, r.care_date, r.care_streak_best]
    );
```

- [ ] **Step 4: проверка сборки**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/pet.ts
git commit -m "feat(pet): care_streak_best — рекорд стрика заботы (additive-миграция + backfill), поле careStreakBest в API"
```

---

### Task 5: вехи заботы в лестнице MILESTONES (бэк, clicker.ts)

**Files:**
- Modify: `src/clicker.ts` (`MILESTONES`, `msReached`, `getMilestones`, `claimMilestone`)

**Interfaces:**
- Consumes: колонка `pet_state.care_streak_best` (Task 4) — читается прямым SQL (импорт из pet.ts создал бы цикл: pet.ts уже импортирует `addClickerBalance` из clicker.ts).
- Produces: 5 вех `ms_care7|14|30|60|100` в `GET /api/clicker/milestones` (поля как у остальных: `id,title,kind,points,perkText,reached,granted`) и клейм через существующий `POST /api/clicker/milestone`. Фронт-зеркало — Task 6.

- [ ] **Step 1: добавить вехи в `MILESTONES`**

В `src/clicker.ts` в конец массива `MILESTONES` (после `ms_ref10`) добавить:

```ts
  // Вехи заботы о Василии («Дом кота»). Условие — по РЕКОРДУ стрика (pet_state.care_streak_best):
  // сброс текущего стрика не отбирает заслуженную веху. Числа — спека Фазы 2 (скромные, в духе лестницы).
  { id: "ms_care7",   title: "Забота о Василии: 7 дней",   cond: { type: "care_streak", target: 7 },   points: 200 },
  { id: "ms_care14",  title: "Забота о Василии: 14 дней",  cond: { type: "care_streak", target: 14 },  perk: "discount_5",   perkText: "Промокод −5% (от 500₽)" },
  { id: "ms_care30",  title: "Забота о Василии: 30 дней",  cond: { type: "care_streak", target: 30 },  points: 500 },
  { id: "ms_care60",  title: "Забота о Василии: 60 дней",  cond: { type: "care_streak", target: 60 },  perk: "free_dessert", perkText: "Бесплатный десерт (к торту от 2000₽)" },
  { id: "ms_care100", title: "Забота о Василии: 100 дней", cond: { type: "care_streak", target: 100 }, points: 1000 },
```

- [ ] **Step 2: чтение рекорда + расширение `msReached`**

Найти:

```ts
const MS_BY_ID = Object.fromEntries(MILESTONES.map((m) => [m.id, m]));
const msReached = (m: any, s: ClickerState) => taskClaimable({ type: m.cond.type, target: m.cond.target } as any, s);
```

Заменить на:

```ts
const MS_BY_ID = Object.fromEntries(MILESTONES.map((m) => [m.id, m]));
// care_streak_best читаем прямым SQL (импорт pet.ts → цикл: pet.ts импортирует addClickerBalance отсюда)
async function getCareStreakBest(chatId: number): Promise<number> {
  const { rows } = await pool.query(`SELECT care_streak_best FROM pet_state WHERE chat_id=$1`, [chatId]);
  return Number(rows[0]?.care_streak_best ?? 0);
}
const msReached = (m: any, s: ClickerState, careBest = 0) =>
  m.cond.type === "care_streak" ? careBest >= m.cond.target
    : taskClaimable({ type: m.cond.type, target: m.cond.target } as any, s);
```

- [ ] **Step 3: прокинуть рекорд в `getMilestones` и `claimMilestone`**

В `getMilestones` после строки `const s = await getClicker(chatId);` добавить:

```ts
  const careBest = await getCareStreakBest(chatId).catch(() => 0);
```

и в маппинге заменить `reached: msReached(m, s),` на `reached: msReached(m, s, careBest),`.

В `claimMilestone` найти:

```ts
  const s = await getClicker(chatId);
  if (!msReached(m, s)) return { ok: false, reason: "not_ready" };
```

Заменить на:

```ts
  const s = await getClicker(chatId);
  const careBest = m.cond.type === "care_streak" ? await getCareStreakBest(chatId).catch(() => 0) : 0;
  if (!msReached(m, s, careBest)) return { ok: false, reason: "not_ready" };
```

- [ ] **Step 4: проверка сборки**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/clicker.ts
git commit -m "feat(clicker): 5 вех заботы о Василии (7/14/30/60/100 дней, по рекорду care_streak_best)"
```

---

### Task 6: фронт кликера — зеркало вех, динамический флаг обмена, попап баллов (catclick.js)

**Files:**
- Modify: `public/js/catclick.js` (`MILESTONES`-зеркало, `condMet`, блок `REWARDS_ENABLED`, `rewardsBlock`, `redeem`, `open`, глобальные экспорты)

**Interfaces:**
- Consumes: `GET /api/clicker/rewards` → `{ enabled: boolean, ... }` (бэк уже отдаёт); `POST /api/clicker/redeem` → `{ code?, points?, ...state }` (Task 3); вехи `ms_care*` из `/api/clicker/milestones` (Task 5); гостевой стрик в `localStorage['maria_pet_v1'].care_streak` (пишет catpet.js).
- Produces: `window.ckSetTab(tab)` — глобальный доступ к переключению вкладок кликера (нужен виджету Task 7).

- [ ] **Step 1: зеркало care-вех в `MILESTONES`**

В `public/js/catclick.js` в конец массива-зеркала `MILESTONES` (после `ms_ref10`) добавить:

```js
    { id: 'ms_care7', title: 'Забота о Василии: 7 дней', cond: { type: 'care_streak', target: 7 }, kind: 'points', points: 200 },
    { id: 'ms_care14', title: 'Забота о Василии: 14 дней', cond: { type: 'care_streak', target: 14 }, kind: 'perk', perkText: 'Промокод −5% (от 500₽)' },
    { id: 'ms_care30', title: 'Забота о Василии: 30 дней', cond: { type: 'care_streak', target: 30 }, kind: 'points', points: 500 },
    { id: 'ms_care60', title: 'Забота о Василии: 60 дней', cond: { type: 'care_streak', target: 60 }, kind: 'perk', perkText: 'Бесплатный десерт (к торту от 2000₽)' },
    { id: 'ms_care100', title: 'Забота о Василии: 100 дней', cond: { type: 'care_streak', target: 100 }, kind: 'points', points: 1000 },
```

- [ ] **Step 2: `condMet` — тип `care_streak` (гостевой фолбэк)**

В функцию `condMet(t, s)` перед `return false;` добавить ветку (для авторизованных достигнутость приходит с бэка; это только фолбэк гостя/сбоя сети — читаем локальный стрик питомца):

```js
    if (t.type === 'care_streak') { let ps = null; try { ps = JSON.parse(localStorage.getItem('maria_pet_v1')); } catch (_) {} return Number((ps && ps.care_streak) || 0) >= t.target; }
```

- [ ] **Step 3: динамический флаг обмена вместо константы**

Найти:

```js
  // ── Реальные награды (витрина). ⚠️ redeem ВЫКЛ до согласования Маши (зеркало clicker.ts) ──
  const REWARDS_ENABLED = false;
```

Заменить на:

```js
  // ── Реальные награды (витрина). Флаг приходит с бэка (/api/clicker/rewards ← env
  // CLICKER_REWARDS_ENABLED); до включения Машей и для гостей — false («Скоро»). ──
  let rewardsEnabled = false;
```

Все использования `REWARDS_ENABLED` в файле (в `rewardsBlock` — 2 места, в `redeem` — 1 место) заменить на `rewardsEnabled`. Массив-зеркало `REWARDS` (4 карточки, включая `bonus300`) — НЕ трогать.

- [ ] **Step 4: подтянуть флаг с бэка при открытии**

В `async function open()` (около строки 1582), после строки `setTab('cat'); renderAll(); ...` добавить:

```js
    if (authed()) api('/api/clicker/rewards').then(d => { if (d && typeof d.enabled === 'boolean' && d.enabled !== rewardsEnabled) { rewardsEnabled = d.enabled; if (tab === 'up') renderUpgrades(); } }).catch(() => {});
```

- [ ] **Step 5: `redeem` — обработка баллов + попап**

Найти функцию `redeem(id)` и заменить целиком на:

```js
  function redeem(id) {
    if (!rewardsEnabled) { flashMsg('Скоро откроем'); return; }
    if (!authed()) { flashMsg('Войди через приложение «Мария»'); return; }
    api('/api/clicker/redeem', { method: 'POST', body: JSON.stringify({ id }) }).then(d => {
      if (d && !d.error && (d.code || d.points)) { st = d; sfxLevel(); window.haptic && window.haptic('success'); if (d.code) codePopup(d.code); else pointsPopup(d.points); renderAll(); renderUpgrades(); }
      else flashMsg(d && d.error === 'daily_limit' ? 'Лимит на сегодня' : d && d.error === 'need_phone' ? 'Сначала подтверди телефон в профиле' : d && d.error === 'disabled' ? 'Скоро откроем' : 'Не хватает монет');
    }).catch(() => flashMsg('Ошибка'));
  }
```

Сразу после существующей `codePopup(code)` добавить:

```js
  function pointsPopup(points) { const pop = ov.querySelector('#ck-pop'); pop.innerHTML = `<h3>${ICON.gift(20)} Баллы на карте!</h3><div class="v" style="font-size:22px">+${fmt(points)}</div><div style="color:var(--muted);font-size:13px">Реальные баллы клуба «Мария» — спишутся при заказе</div><button id="ck-pop-ok" style="margin-top:10px">Класс!</button>`; pop.classList.add('on'); pop.querySelector('#ck-pop-ok').onclick = () => pop.classList.remove('on'); }
```

- [ ] **Step 6: экспорт `ckSetTab`**

Найти строку (около 1839):

```js
  window.catClickOpen = open; window.catClickClose = close; window.catClickBonusNow = () => { if (ov && ov.classList.contains('on')) showFlyingBonus(); }; // превью/тест золотого бонуса
```

Дополнить экспортом (в ту же строку или следующей строкой):

```js
  window.ckSetTab = setTab; // для виджета «Дома кота»: открыть лестницу вех (setTab('tasks'))
```

- [ ] **Step 7: проверка синтаксиса**

Run: `node --check public/js/catclick.js`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add public/js/catclick.js
git commit -m "feat(catclick): care-вехи в лестнице, флаг обмена с бэка, попап реальных баллов, экспорт ckSetTab"
```

---

### Task 7: виджет «До подарка» в «Доме кота» (catpet.js)

**Files:**
- Modify: `public/js/catpet.js` (иконка `PIC.gift`, разметка, CSS, рендер, переход в лестницу)

**Interfaces:**
- Consumes: `state.careStreakBest`/`state.careStreak` из `/api/pet` (Task 4) или локального стейта (`care_streak` гостя); `GET /api/clicker/milestones` (какие care-вехи уже забраны, Task 5); `window.ckSetTab('tasks')` (Task 6); существующие `window.catClickOpen`, `close()`, `api()`, `authed()`, `ov`.
- Produces: виджет `#pet-gift` (тизер ближайшей незабранной care-вехи), тап ведёт в лестницу вех кликера.

- [ ] **Step 1: иконка подарка в `PIC`**

В объект `const PIC = {` (строка ~11) добавить рядом с остальными:

```js
    gift:    (s) => SVG('<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/>', s), // подарок
```

- [ ] **Step 2: зеркало порогов care-вех**

После объявления `const PIC = {...};` (вне объекта) добавить:

```js
  // Пороги care-вех — зеркало src/clicker.ts MILESTONES ms_care* (менять синхронно)
  const CARE_MILESTONES = [
    { d: 7,   label: '200 баллов' },
    { d: 14,  label: 'промокод −5%' },
    { d: 30,  label: '500 баллов' },
    { d: 60,  label: 'десерт в подарок' },
    { d: 100, label: '1000 баллов' },
  ];
```

- [ ] **Step 3: разметка + CSS**

В HTML-шаблоне оверлея найти строку:

```js
      <div class="pet-streak" id="pet-streak"></div>
```

Сразу после неё добавить:

```js
      <button class="pet-gift" id="pet-gift" style="display:none" type="button"></button>
```

В CSS-блок (рядом с правилом `.pet-streak{...}`) добавить:

```css
      .pet-gift{position:absolute;left:50%;transform:translateX(-50%);bottom:118px;z-index:6;display:flex;align-items:center;gap:7px;border:0;cursor:pointer;font:inherit;font-weight:800;font-size:13px;color:#7a5a13;background:rgba(255,248,231,.92);border-radius:14px;padding:7px 12px;box-shadow:0 2px 10px rgba(0,0,0,.12)}
      .pet-gift.ready{color:#fff;background:linear-gradient(120deg,#e0a93c,#c2882a);animation:petgift 1.6s ease-in-out infinite}
      @keyframes petgift{0%,100%{transform:translateX(-50%) scale(1)}50%{transform:translateX(-50%) scale(1.05)}}
      @media (prefers-reduced-motion: reduce){.pet-gift.ready{animation:none}}
```

(⚠️ значение `bottom` подобрать при реализации так, чтобы виджет не перекрывал кнопку действия и комнаты-навигацию — проверить на превью; якорная логика важнее пикселей.)

- [ ] **Step 4: данные о забранных вехах + рендер**

Рядом с `renderNeeds` добавить:

```js
  let careGranted = null; // Set id забранных care-вех (authed); null = ещё не загружено
  async function loadCareGranted() {
    if (!authed()) { careGranted = new Set(); return; }
    try {
      const d = await api('/api/clicker/milestones');
      careGranted = new Set((d && d.milestones || []).filter(m => m.granted && m.id.indexOf('ms_care') === 0).map(m => m.id));
    } catch (_) { careGranted = new Set(); }
  }
  function renderGift(state) {
    const el = ov.querySelector('#pet-gift'); if (!el || !state) return;
    const best = Math.max(Number(state.careStreakBest || 0), Number(state.careStreak || 0), Number(state.care_streak || 0));
    const granted = careGranted || new Set();
    const next = CARE_MILESTONES.find(m => !granted.has('ms_care' + m.d));
    if (!next) { el.style.display = 'none'; return; }
    el.style.display = '';
    if (best >= next.d) { el.classList.add('ready'); el.innerHTML = PIC.gift(15) + ' Тебя ждёт подарок: ' + next.label + '!'; }
    else { el.classList.remove('ready'); el.innerHTML = PIC.gift(15) + ' До подарка «' + next.label + '»: ещё ' + (next.d - best) + ' дн. заботы'; }
  }
```

- [ ] **Step 5: переход в лестницу вех**

Там же добавить:

```js
  function openGiftLadder() {
    close();
    try {
      const ck = document.querySelector('.ck-ov');
      if (ck && ck.classList.contains('on')) { window.ckSetTab && window.ckSetTab('tasks'); }
      else if (window.catClickOpen) { Promise.resolve(window.catClickOpen()).then(() => { window.ckSetTab && window.ckSetTab('tasks'); }); }
    } catch (_) {}
  }
```

В `build()` (где вешаются обработчики на элементы оверлея) добавить:

```js
    ov.querySelector('#pet-gift').onclick = openGiftLadder;
```

- [ ] **Step 6: вызовы рендера**

В `async function open()` после строки `renderNeeds(); renderLoc(); renderHat();` добавить:

```js
    renderGift(state); loadCareGranted().then(() => renderGift(state));
```

В конце обработчика успешного действия ухода (там, где после `/api/pet/action`/локального действия обновляется стейт и зовётся `renderNeeds`) добавить вызов `renderGift(state);` — чтобы «ещё N дней» обновлялось сразу после зачёта дня.

- [ ] **Step 7: проверка синтаксиса**

Run: `node --check public/js/catpet.js`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add public/js/catpet.js
git commit -m "feat(catpet): виджет «До подарка» — ближайшая care-веха, переход в лестницу вех кликера"
```

---

### Task 8: кэш-бастеры + финальная сборка

**Files:**
- Modify: `public/index.html` (версии подключения `catclick.js` и `catpet.js`)

**Interfaces:**
- Consumes: текущие строки подключения скриптов в `index.html`.

- [ ] **Step 1: бампнуть версии**

В `public/index.html` найти строки подключения:

```html
<script src="/js/catpet.js" defer></script>
```
(или `catpet.js?v=N` — взять текущее значение и увеличить; после Фазы 1 было `?v=2`)

```html
<script src="/js/catclick.js?v=91" defer></script>
```
(91 — значение на момент написания плана; взять фактическое из файла и увеличить на 1)

Заменить на следующую версию: `catpet.js?v=<N+1>`, `catclick.js?v=<M+1>`.

- [ ] **Step 2: финальная проверка всего**

Run: `npx tsc --noEmit && node --check public/js/catclick.js && node --check public/js/catpet.js`
Expected: exit 0, пустой вывод.

Run: `git status --short`
Expected: чисто после коммита (без untracked `dist/*` — если появились, `git clean -fd dist/` и НЕ коммитить).

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "chore(front): кэш-бастеры catclick/catpet после Фазы 2"
```

---

## После плана (вне задач — оркестратор, после ревью)

1. Whole-branch ревью (как в Фазе 1) → фиксы → re-review.
2. Push: `git push origin dom-kota-phase2:master` (broad authorization действует).
3. Деплой: `ssh root@145.223.121.47 'cd /opt/maria/maria-bot && git pull && cd .. && docker compose up -d --build maria-bot'`.
4. Прод-проверка через ssh с VPS (локальный curl к sslip из РФ даёт 000): `/health`, `catclick.js?v=<new>` отдаётся, `GET /api/clicker/milestones` содержит `ms_care7`.
5. Env `CLICKER_REWARDS_ENABLED` НЕ ставить (обмен выключен до решений Маши); в `bot.env` добавить строку-комментарий `# CLICKER_REWARDS_ENABLED=1 — включение обмена монет (решение Маши)`.
6. Память: обновить session_log + мемо проекта.

## Self-Review

**Покрытие спеки:** мёрж flow2 (T1) ✓; env-флаг `CLICKER_REWARDS_ENABLED`, дефолт выкл, гейтит оба обмена (T2; T3 использует тот же `REWARDS_ENABLED`) ✓; монеты→баллы с телефоном, компенсацией, `REDEEM_PER_DAY` (общая tx в T3) ✓; `care_streak_best` additive+backfill, монотонность через `Math.max`/`GREATEST`-паттерн (T4) ✓; 5 вех 7/14/30/60/100 с точными наградами из спеки, по рекорду, без цикла импортов (T5) ✓; фронт-зеркала лестницы+обмена, попап баллов, error-маппинг `need_phone` (T6) ✓; виджет ближайшей незабранной вехи, «Тебя ждёт подарок», переход `setTab('tasks')` без заморозки кликера, гость от локального стрика (T7) ✓; кэш-бастеры (T8) ✓; деплой/включение — раздел «После плана» ✓.

**Плейсхолдеры:** каждый код-шаг несёт полный код; допущены две точки сверки по месту («bottom подобрать на превью» T7 Step 3 — визуальный параметр; «взять фактическое v и +1» T8 — значение зависит от момента исполнения) — это реальные проверки, не заглушки.

**Консистентность типов:** `redeemReward → {ok, code?, points?, state?, reason?}` (T3) = роут `{code, points, ...state}` (T3 Step 3) = фронт `d.code || d.points` (T6 Step 5). `careStreakBest` в `PetState` (T4) = чтение в виджете (T7 Step 4, с фолбэками на гостевые `careStreak`/`care_streak`). `ms_care*`-id (T5) = зеркало фронта (T6 Step 1) = `'ms_care' + m.d` виджета (T7). `window.ckSetTab` (T6 Step 6) = потребление (T7 Step 5). `getCareStreakBest` определён и использован только в clicker.ts (T5).

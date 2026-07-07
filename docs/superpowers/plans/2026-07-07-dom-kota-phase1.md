# «Дом кота» Фаза 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Оживить уже написанный тамагочи «Дом кота» как вкладку внутри «Котик Комбат», добавить стрик заботы, объединить кошельки питомца и кликера в один, ребрендинг под «Марию» — без новых денежных обязательств (Витрина подарков/обмен в баллы — Фаза 2).

**Architecture:** Сервер питомца (`src/pet.ts` + `src/routes/pet.ts`, таблицы `pet_state`/`pet_items`) уже смонтирован в `src/index.ts` и работает; фронт `public/js/catpet.js` (полноэкранный оверлей `.pet-ov`) не подключён ко входу. Делаем: (1) единый кошелёк — забота и покупки нарядов читают/пишут `clicker_state.balance` вместо `pet_state.coins`, со одноразовой ленивой миграцией старых `pet_state.coins`; (2) стрик заботы в `pet_state` (зеркалит `daily_streak` кликера); (3) вход — вкладка «Дом» в навбаре кликера, зовущая `window.catPetOpen()`; (4) ребрендинг эмодзи→рисованные SVG, светлая тема; (5) смягчение decay.

**Tech Stack:** TypeScript (backend, `tsc`), Vanilla JS (frontend IIFE), Express, Neon PostgreSQL (`pg` pool), grammY. Без тест-фреймворка — верификация через `npx tsc --noEmit`, `node --check`, и деплой на staging-контейнер `maria-bot-stage` с проверкой API/БД/браузером.

## Global Constraints

- **Мультиплатформа TG+VK:** все таблицы по `chat_id BIGINT` (internalId; VK = 2e12+vk_id). Наружу ≥2e12 не отдавать. Работа с балансом — только по internalId.
- **БД-транзакции:** только `pool.connect()` + `client` + `BEGIN/COMMIT/ROLLBACK` + `client.release()` в `finally`. `pool.query("BEGIN")` НЕ работает.
- **Сутки — по Иркутску (UTC+8):** день = `new Date(Date.now() + 8*3600*1000).toISOString().slice(0,10)` (как `irkToday()`/`claimDaily` в `src/clicker.ts`).
- **Только реальные данные из 1С/каталога** — Фаза 1 не выдаёт скидок/баллов, существующий redeem монеты→купоны не трогаем.
- **Тема всегда светлая** (бренд-решение); эмодзи — только в пушах/маркетинге, не в UI (иконки — рисованные SVG).
- **Миграции additive:** `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. `pet_state.coins` НЕ дропаем (делаем вестигиальным).
- **Деплой:** worktree от `origin/master` → commit → push master → VPS `git pull && docker compose up -d --build`. **Сначала staging (`maria-bot-stage`), потом прод.**
- **Кот = Василий** (общий IP). Тексты тёплые, детские. Кот не «умирает» и не наказывает.

---

## File Structure

- `src/pet.ts` — **Modify.** Схема (+3 колонки), `getPet` (ленивая миграция кошелька + возврат единого баланса + careStreak), `doPetAction` (стрик заботы + начисление в общий кошелёк вместо `pet_state.coins`), `buyPetItem` (списание из общего кошелька), смягчение `DECAY`. Единственная ответственность: серверная модель питомца + мост к кошельку кликера.
- `src/clicker.ts` — **Modify.** Новый экспорт-хелпер `addClickerBalance(chatId, coins)` (начислить в общий кошелёк, создать строку при отсутствии). Больше ничего.
- `src/pet.ts` импортирует `addClickerBalance` из `./clicker`. (Проверить отсутствие циклической зависимости на этапе typecheck; `clicker.ts` не импортирует `pet.ts`.)
- `src/routes/pet.ts` — **Modify.** `/api/pet/action` и `/api/pet/buy` прокидывают в ответ `careStreak` и `streakBonus` (из обновлённых функций pet.ts).
- `public/js/catpet.js` — **Modify.** Ребрендинг (эмодзи→SVG, светлая тема, Василий), локальный decay в тон серверному, UI стрика заботы + попап бонуса, единый лейбл «монеты», локальный стрик для гостя.
- `public/js/catclick.js` — **Modify.** Вкладка «Дом» в навбаре (`build()` + `setTab()` + wiring), зовёт `window.catPetOpen()`.
- `public/index.html` — **Modify.** Развязка входа (домашняя карточка) + кэш-бустеры версий `catclick.js`/`catpet.js`.

---

## Task 1: Схема — стрик заботы и маркер миграции кошелька

**Files:**
- Modify: `src/pet.ts` (функция `initPetSchema`, ~строки 47-70)

**Interfaces:**
- Produces: колонки `pet_state.care_streak INT`, `pet_state.care_date TEXT`, `pet_state.pet_coins_merged BOOLEAN` — используются в Task 3/4.

- [ ] **Step 1: Добавить additive-миграции в `initPetSchema`**

В `src/pet.ts`, внутри `initPetSchema`, после `CREATE TABLE ... pet_items (...)` и перед закрывающим `` ` ``); добавить:

```ts
  await pool.query(`
    ALTER TABLE pet_state ADD COLUMN IF NOT EXISTS care_streak      INT NOT NULL DEFAULT 0;
    ALTER TABLE pet_state ADD COLUMN IF NOT EXISTS care_date        TEXT;
    ALTER TABLE pet_state ADD COLUMN IF NOT EXISTS pet_coins_merged BOOLEAN NOT NULL DEFAULT FALSE;
  `);
```

(`care_date` — TEXT формата `YYYY-MM-DD`, чтобы зеркалить `clicker_state.daily_date` и сравнение строками без TZ-сюрпризов.)

- [ ] **Step 2: Проверить сборку**

Run: `npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 3: Commit**

```bash
git add src/pet.ts
git commit -m "feat(pet): схема — care_streak/care_date/pet_coins_merged (стрик заботы + маркер миграции кошелька)"
```

---

## Task 2: Хелпер единого кошелька в кликере

**Files:**
- Modify: `src/clicker.ts` (добавить экспорт-функцию рядом с прочими, напр. после `redeemReward`)

**Interfaces:**
- Produces: `export async function addClickerBalance(chatId: number, coins: number): Promise<void>` — начисляет `coins` в `clicker_state.balance` и `total_earned`, создаёт строку при отсутствии. Потребляется в Task 3/4 (`src/pet.ts`).

- [ ] **Step 1: Добавить `addClickerBalance` в `src/clicker.ts`**

```ts
import type { PoolClient } from "pg"; // добавить к импортам clicker.ts, если ещё нет

/**
 * Начислить монеты в ОБЩИЙ кошелёк кликера (balance + total_earned).
 * Создаёт строку clicker_state при отсутствии (напр. игрок был только в питомце).
 * Принимает опциональный `client` — чтобы начислять ВНУТРИ существующей транзакции
 * (атомарно с обновлением питомца). Без client — своим запросом через pool.
 * Идемпотентность НЕ гарантируется — вызывать один раз на событие.
 */
export async function addClickerBalance(chatId: number, coins: number, client?: PoolClient): Promise<void> {
  if (!coins || coins <= 0) return;
  const n = Math.round(coins);
  const q = client ?? pool;
  await q.query(
    `INSERT INTO clicker_state (chat_id, balance, total_earned) VALUES ($1,$2,$2)
     ON CONFLICT (chat_id) DO UPDATE SET balance = clicker_state.balance + $2,
       total_earned = clicker_state.total_earned + $2, updated_at = NOW()`,
    [chatId, n]
  );
}
```

- [ ] **Step 2: Проверить сборку**

Run: `npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 3: Commit**

```bash
git add src/clicker.ts
git commit -m "feat(clicker): addClickerBalance — начисление в общий кошелёк (для заботы о коте)"
```

---

## Task 3: `getPet` — ленивая миграция кошелька + единый баланс + careStreak

**Files:**
- Modify: `src/pet.ts` (интерфейс `PetState`, `toState`, `getPet`, импорт)

**Interfaces:**
- Consumes: `addClickerBalance(chatId, coins, client)` (Task 2) — вызывается с транзакционным `client` для атомарного зачисления мигрируемых монет.
- Produces: `PetState` теперь содержит `careStreak: number`, а `coins` = актуальный `clicker_state.balance`. Потребляется фронтом (`catpet.js`) и Task 4.

- [ ] **Step 1: Расширить тип `PetState` и импорт**

В `src/pet.ts` в начале файла добавить импорт:

```ts
import { addClickerBalance } from "./clicker";
```

В интерфейс `PetState` добавить поле:

```ts
export interface PetState {
  hunger: number; mood: number; energy: number; hygiene: number;
  level: number; xp: number; xpNext: number; coins: number;
  careStreak: number;
  location: PetLocation;
  items?: { owned: string[]; equipped: string | null };
}
```

Добавить рядом с `xpForNext` день-хелпер и формулу бонуса стрика:

```ts
// День по Иркутску (UTC+8), YYYY-MM-DD — как irkToday()/claimDaily в clicker.ts.
const irkDay = (offsetDays = 0) =>
  new Date(Date.now() + 8 * 3600 * 1000 - offsetDays * 86400000).toISOString().slice(0, 10);
// Награда за день заботы (в общий кошелёк): день1=100 … день10+=1000. Параметр экономики.
const careStreakBonus = (streak: number) => 100 * Math.min(Math.max(1, streak), 10);
```

- [ ] **Step 2: Обновить `toState` (careStreak, coins остаётся из строки — переопределим в getPet)**

Заменить `toState`:

```ts
function toState(r: any): PetState {
  return {
    hunger: r.hunger, mood: r.mood, energy: r.energy, hygiene: r.hygiene,
    level: r.level, xp: r.xp, xpNext: xpForNext(r.level), coins: r.coins,
    careStreak: r.care_streak ?? 0,
    location: LOCATIONS.includes(r.location) ? r.location : "kitchen",
  };
}
```

- [ ] **Step 3: Переписать `getPet` — ensure clicker-строки, ленивая миграция, единый баланс**

Заменить тело `getPet` (внутри try/BEGIN..COMMIT) так:

```ts
export async function getPet(chatId: number): Promise<PetState> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO pet_state (chat_id) VALUES ($1) ON CONFLICT (chat_id) DO NOTHING`, [chatId]);
    // строка кошелька кликера обязана существовать (для миграции и чтения баланса)
    await client.query(`INSERT INTO clicker_state (chat_id) VALUES ($1) ON CONFLICT (chat_id) DO NOTHING`, [chatId]);
    const { rows } = await client.query(`SELECT * FROM pet_state WHERE chat_id = $1 FOR UPDATE`, [chatId]);
    const r = rows[0];
    const hrs = Math.max(0, (Date.now() - new Date(r.updated_at).getTime()) / 3600000);
    if (hrs > 0.001) {
      r.hunger = clamp(r.hunger - DECAY.hunger * hrs);
      r.mood = clamp(r.mood - DECAY.mood * hrs);
      r.energy = clamp(r.energy - DECAY.energy * hrs);
      r.hygiene = clamp(r.hygiene - DECAY.hygiene * hrs);
      await client.query(
        `UPDATE pet_state SET hunger=$2, mood=$3, energy=$4, hygiene=$5, updated_at=NOW() WHERE chat_id=$1`,
        [chatId, r.hunger, r.mood, r.energy, r.hygiene]
      );
    }
    // одноразовая миграция старых pet_state.coins в общий кошелёк (атомарно, в этой же транзакции)
    if (!r.pet_coins_merged) {
      await addClickerBalance(chatId, r.coins, client); // no-op если coins<=0
      await client.query(`UPDATE pet_state SET coins = 0, pet_coins_merged = TRUE, updated_at=NOW() WHERE chat_id=$1`, [chatId]);
      r.coins = 0; r.pet_coins_merged = true;
    }
    const balRow = await client.query(`SELECT balance FROM clicker_state WHERE chat_id=$1`, [chatId]);
    await client.query("COMMIT");
    const state = toState(r);
    state.coins = Number(balRow.rows[0]?.balance ?? 0); // единый баланс
    state.items = await getItems(chatId);
    return state;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: Проверить сборку (в т.ч. отсутствие циклической зависимости)**

Run: `npx tsc --noEmit`
Expected: без ошибок. (Если `import { addClickerBalance } from "./clicker"` вызовет предупреждение о цикле — убедиться, что `clicker.ts` не импортирует `pet.ts`; сейчас не импортирует.)

- [ ] **Step 5: Commit**

```bash
git add src/pet.ts
git commit -m "feat(pet): getPet возвращает единый баланс кликера + ленивая миграция pet.coins + careStreak"
```

---

## Task 4: `doPetAction` (стрик заботы + начисление в общий кошелёк) и `buyPetItem` (списание из общего кошелька)

**Files:**
- Modify: `src/pet.ts` (`doPetAction`, `buyPetItem`)

**Interfaces:**
- Consumes: `addClickerBalance` (Task 2), `irkDay`/`careStreakBonus` (Task 3).
- Produces: `doPetAction` возвращает `{ ok, state?, reason?, streakBonus?, careStreak? }`; `buyPetItem` возвращает `{ ok, state?, reason? }` (списание из общего кошелька). Потребляется Task 5 (routes).

- [ ] **Step 1: Переписать `doPetAction` — начисление только через дневной стрик (анти-фарм)**

Заменить тело `doPetAction`. Ключевые изменения: убрать `r.coins += COINS_PER_ACTION` (анти-фарм — за каждое действие монеты больше НЕ капают); монеты приходят только как бонус за ПЕРВОЕ действие ухода в сутки; бонус начисляется в общий кошелёк.

```ts
export async function doPetAction(
  chatId: number, action: PetAction
): Promise<{ ok: boolean; state?: PetState; reason?: string; streakBonus?: number; careStreak?: number }> {
  if (!RESTORE[action]) return { ok: false, reason: "unknown_action" };
  await getPet(chatId); // применить decay + гарантировать миграцию/строки
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(`SELECT * FROM pet_state WHERE chat_id=$1 FOR UPDATE`, [chatId]);
    const r = rows[0];
    const delta = RESTORE[action];
    if (delta.hunger) r.hunger = clamp(r.hunger + delta.hunger);
    if (delta.mood) r.mood = clamp(r.mood + delta.mood);
    if (delta.energy) r.energy = clamp(r.energy + delta.energy);
    if (delta.hygiene) r.hygiene = clamp(r.hygiene + delta.hygiene);
    r.xp += XP_PER_ACTION;
    while (r.xp >= xpForNext(r.level)) { r.xp -= xpForNext(r.level); r.level += 1; }
    // стрик заботы: засчитываем 1 раз в сутки (первое действие ухода за день)
    const today = irkDay(0), yest = irkDay(1);
    let streakBonus = 0;
    if (r.care_date !== today) {
      r.care_streak = (r.care_date === yest) ? r.care_streak + 1 : 1;
      r.care_date = today;
      streakBonus = careStreakBonus(r.care_streak);
    }
    await client.query(
      `UPDATE pet_state SET hunger=$2,mood=$3,energy=$4,hygiene=$5,xp=$6,level=$7,
         care_streak=$8,care_date=$9,updated_at=NOW() WHERE chat_id=$1`,
      [chatId, r.hunger, r.mood, r.energy, r.hygiene, r.xp, r.level, r.care_streak, r.care_date]
    );
    await addClickerBalance(chatId, streakBonus, client); // no-op если streakBonus<=0; атомарно в этой транзакции
    const balRow = await client.query(`SELECT balance FROM clicker_state WHERE chat_id=$1`, [chatId]);
    await client.query("COMMIT");
    const state = toState(r);
    state.coins = Number(balRow.rows[0]?.balance ?? 0);
    state.items = await getItems(chatId);
    return { ok: true, state, streakBonus, careStreak: r.care_streak };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
```

(Константа `COINS_PER_ACTION` становится неиспользуемой — удалить её объявление, чтобы `lint`/`tsc` не ругались на unused, либо оставить, если lint не строгий. Проверить в Step 3.)

- [ ] **Step 2: Переписать `buyPetItem` — списание из общего кошелька**

Заменить тело `buyPetItem` так, чтобы цена списывалась из `clicker_state.balance`, а не из `pet_state.coins`:

```ts
export async function buyPetItem(chatId: number, id: string): Promise<{ ok: boolean; state?: PetState; reason?: string }> {
  const shopItem = SHOP.find((s) => s.id === id);
  if (!shopItem) return { ok: false, reason: "bad_item" };
  await getPet(chatId); // decay + миграция + строки
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const bal = await client.query(`SELECT balance FROM clicker_state WHERE chat_id=$1 FOR UPDATE`, [chatId]);
    const owned = await client.query(`SELECT 1 FROM pet_items WHERE chat_id=$1 AND item=$2`, [chatId, id]);
    if (owned.rows.length) { await client.query("ROLLBACK"); return { ok: false, reason: "already_owned" }; }
    if (Number(bal.rows[0]?.balance ?? 0) < shopItem.price) { await client.query("ROLLBACK"); return { ok: false, reason: "not_enough_coins" }; }
    await client.query(`UPDATE clicker_state SET balance = balance - $2, updated_at=NOW() WHERE chat_id=$1`, [chatId, shopItem.price]);
    await client.query(`INSERT INTO pet_items (chat_id, item, equipped) VALUES ($1,$2,FALSE) ON CONFLICT DO NOTHING`, [chatId, id]);
    await client.query("COMMIT");
    return { ok: true, state: await getPet(chatId) };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 3: Проверить сборку/линт**

Run: `npx tsc --noEmit && npm run lint`
Expected: без ошибок. Если lint падает на неиспользуемой `COINS_PER_ACTION` — удалить её объявление (строка `const COINS_PER_ACTION = 3;`). `addPetCoins` (тоже пишет в вестигиальный `pet_state.coins`) — проверить отсутствие вызовов: `grep -rn "addPetCoins" src/` → если пусто, оставить как есть (мёртвая, мини-игры удалены); коммит-сообщение это отметит.

- [ ] **Step 4: Commit**

```bash
git add src/pet.ts
git commit -m "feat(pet): стрик заботы (раз/сутки, бонус в общий кошелёк) + покупка нарядов из общего баланса; убран per-action фарм монет"
```

---

## Task 5: Роуты — прокинуть careStreak/streakBonus в ответ

**Files:**
- Modify: `src/routes/pet.ts` (`/api/pet/action`)

**Interfaces:**
- Consumes: `doPetAction` (Task 4) — теперь возвращает `streakBonus`, `careStreak`.
- Produces: ответ `POST /api/pet/action` = `{ ...state, streakBonus, careStreak }` (фронт читает для попапа).

- [ ] **Step 1: Обновить обработчик `/api/pet/action`**

Заменить тело роута (строки ~25-36) так, чтобы отдать бонус вместе со стейтом:

```ts
router.post("/api/pet/action", requireTgUser, rateLimit(60), async (req, res) => {
  const u = getTgUser(req)!;
  const action = String((req.body as { action?: string }).action || "") as PetAction;
  try {
    const r = await doPetAction(u.id, action);
    if (!r.ok) { res.status(400).json({ error: r.reason }); return; }
    res.json({ ...r.state, streakBonus: r.streakBonus ?? 0, careStreak: r.careStreak ?? r.state?.careStreak ?? 0 });
  } catch (e) {
    log.error({ err: e, chatId: u.id, action }, "[POST /api/pet/action]");
    res.status(500).json({ error: "internal" });
  }
});
```

- [ ] **Step 2: Проверить сборку**

Run: `npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 3: Commit**

```bash
git add src/routes/pet.ts
git commit -m "feat(pet): /api/pet/action отдаёт streakBonus + careStreak"
```

---

## Task 6: Смягчить decay (кот грустит, не «умирает»)

**Files:**
- Modify: `src/pet.ts` (константа `DECAY`)
- Modify: `public/js/catpet.js` (гостевой decay — привести в тон)

**Interfaces:**
- Consumes/Produces: только числовые константы. Поведение: при заходе «раз в сутки» кот заметно грустит, но потребности не в нуле; уход быстро возвращает радость.

- [ ] **Step 1: Замедлить серверный decay**

В `src/pet.ts` заменить:

```ts
const DECAY: Record<PetNeed, number> = { hunger: 12, mood: 8, energy: 6, hygiene: 5 };
```

на (примерно вдвое медленнее — за ~24ч без ухода потребности падают до «грустно», но не в 0):

```ts
const DECAY: Record<PetNeed, number> = { hunger: 6, mood: 4, energy: 3, hygiene: 2.5 };
```

- [ ] **Step 2: Привести гостевой decay в `catpet.js`**

Найти в `public/js/catpet.js` гостевой decay (функция вокруг строки ~44, объект `dec`) и заменить коэффициенты на те же `{ hunger: 6, mood: 4, energy: 3, hygiene: 2.5 }` (grep: `grep -n "hunger: 12" public/js/catpet.js`). Если формат иной — привести к тем же значениям в час.

- [ ] **Step 3: Проверить сборку и синтаксис фронта**

Run: `npx tsc --noEmit && node --check public/js/catpet.js`
Expected: без ошибок.

- [ ] **Step 4: Commit**

```bash
git add src/pet.ts public/js/catpet.js
git commit -m "feat(pet): смягчить decay — кот грустит, но не в ноль (детская дружелюбность)"
```

---

## Task 7: Вход — вкладка «Дом» в навбаре кликера

**Files:**
- Modify: `public/js/catclick.js` (`build()` навбар + `setTab()`)
- Modify: `public/index.html` (домашняя карточка: честный лейбл)

**Interfaces:**
- Consumes: глобал `window.catPetOpen` (уже экспортирован в `catpet.js`).
- Produces: кнопка навбара `data-tab="home"`; в `setTab('home')` вызывается `window.catPetOpen()`.

- [ ] **Step 1: Добавить кнопку «Дом» в навбар**

В `public/js/catclick.js`, в `build()`, в блоке `<div class="ck-nav">…` (после кнопки `data-tab="up"` Прокачка) добавить:

```js
        <button class="ck-nav__b" data-tab="home">${ICON.paw(21)}Дом</button>
```

(Иконка: `ICON.paw` уже есть в catclick.js. Если предпочтительнее домик — можно добавить `home:` в объект `ICON` по SVG из `icons.js:10`; но для минимализма берём `paw`.)

- [ ] **Step 2: Обработать вкладку в `setTab` — открыть оверлей питомца, не переключая экран**

В `setTab(t)` (после строки `tab = t;`) добавить раннюю ветку, чтобы «Дом» открывал оверлей питомца, а активной вкладкой оставался предыдущий экран кликера:

```js
    if (t === 'home') {
      window.haptic && window.haptic('light');
      try { window.catPetOpen && window.catPetOpen(); } catch (_) {}
      // не меняем активный экран/подсветку кликера: питомец — оверлей сверху
      ov.querySelectorAll('.ck-nav__b').forEach(b => b.classList.remove('on'));
      ov.querySelector('.ck-nav__b[data-tab="home"]').classList.add('on');
      return;
    }
```

(Когда оверлей питомца закрывается кнопкой внутри `catpet.js`, пользователь снова видит кликер на прежней вкладке. Подсветку «Дом» вернём на предыдущую при следующем `setTab`.)

- [ ] **Step 3: Починить домашнюю карточку (честный лейбл)**

В `public/index.html` карточка на строке ~173 (`onclick="catClickOpen()"`) подписана «Котик Марии — виртуальный питомец», но открывает КЛИКЕР. Привести подпись в соответствие: заменить текст карточки на «Котик Комбат — игра» (кот-питомец теперь доступен вкладкой «Дом» внутри). Найти: `grep -n "виртуальный питомец" public/index.html`. Отредактировать видимый заголовок/подзаголовок карточки, `onclick` оставить `catClickOpen()`.

- [ ] **Step 4: Синтаксис-проверка фронта**

Run: `node --check public/js/catclick.js`
Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add public/js/catclick.js public/index.html
git commit -m "feat(clicker): вкладка «Дом» открывает Дом кота (catPetOpen); честный лейбл домашней карточки"
```

---

## Task 8: Ребрендинг «Дома кота» под «Марию» (эмодзи→SVG, светлая тема, Василий)

**Files:**
- Modify: `public/js/catpet.js` (LOC/NEEDS иконки-эмодзи, тема оверлея, тексты)

**Interfaces:**
- Consumes: ничего внешнего.
- Produces: набор inline-SVG иконок в `catpet.js` (по образцу `ICON` в catclick.js); светлая палитра `.pet-ov`.

- [ ] **Step 1: Добавить набор рисованных иконок в начало IIFE `catpet.js`**

После `const A = (s) => ...` добавить мини-набор SVG (Lucide-stroke, `currentColor`), покрывающий смыслы кухни/сна/игры/поглаживания/потребностей:

```js
  const SVG = (p, s = 18) => `<svg class="pet-i" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const PIC = {
    feed:    (s) => SVG('<path d="M4 20h16"/><path d="M6 20V9a6 6 0 0 1 12 0v11"/><path d="M12 3v3"/>', s),   // кекс/еда
    sleep:   (s) => SVG('<path d="M3 12h6l-6 6h6"/><path d="M14 5h7l-7 7h7"/>', s),                            // Zzz
    play:    (s) => SVG('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18"/><path d="M3 12h18"/>', s), // клубок/мяч
    pet:     (s) => SVG('<path d="M12 21s-7-4.6-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.4-7 10-7 10z"/>', s),  // сердечко
    hunger:  (s) => SVG('<path d="M4 20h16"/><path d="M6 20V9a6 6 0 0 1 12 0v11"/>', s),
    mood:    (s) => SVG('<circle cx="12" cy="12" r="9"/><path d="M8 14a4 4 0 0 0 8 0"/><path d="M9 9h.01M15 9h.01"/>', s), // улыбка
    energy:  (s) => SVG('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>', s),                                          // молния
    hygiene: (s) => SVG('<path d="M12 3c3 4 5 6 5 9a5 5 0 0 1-10 0c0-3 2-5 5-9z"/>', s),                       // капля
  };
```

- [ ] **Step 2: Заменить эмодзи в `LOC` на SVG-лейблы и убрать эмодзи из иконок локаций**

Заменить объект `LOC` (строки ~11-16), убрав эмодзи из `icon`/`label`:

```js
  const LOC = {
    kitchen:  { bg: 'bakery-bg.jpg',  name: 'Кухня',   action: 'feed',  label: PIC.feed(18) + ' Покормить',   need: 'hunger' },
    bedroom:  { bg: 'bg-bedroom.jpg', name: 'Спальня', action: 'sleep', label: PIC.sleep(18) + ' Уложить спать', need: 'energy' },
    playroom: { bg: 'bg-playroom.jpg',name: 'Игровая', action: 'play',  label: PIC.play(18) + ' Поиграть',     need: 'mood' },
    yard:     { bg: 'bg-yard.jpg',    name: 'Двор',    action: 'walk',  label: PIC.pet(18) + ' Погладить',     need: 'mood' },
  };
```

(Если `LOC` где-то использует `.icon` для рендера — найти `grep -n "\.icon" public/js/catpet.js` и заменить на `PIC[<need>]` или удалить.)

- [ ] **Step 3: Заменить эмодзи-иконки в `NEEDS`**

Заменить объект `NEEDS` (строки ~18-22): вместо эмодзи `icon` — функция SVG:

```js
  const NEEDS = [
    { k: 'hunger', ic: PIC.hunger, name: 'Сытость' },
    { k: 'mood',   ic: PIC.mood,   name: 'Настроение' },
    { k: 'energy', ic: PIC.energy, name: 'Энергия' },
    { k: 'hygiene',ic: PIC.hygiene,name: 'Чистота' },
  ];
```

И в рендере потребностей (строка ~176, `NEEDS.map(...)`) заменить `${n.icon}` на `${n.ic(15)}` — найти точное место `grep -n "pet-need__i" public/js/catpet.js`.

- [ ] **Step 4: Убрать эмодзи из шапки магазина**

Строка ~153: `<span>🎩 Магазин · <span id="pet-shop-coins">0</span> 🪙</span>` → заменить на рисованное:

```js
        <div class="pet-shop__h"><span>Наряды Василия · <span id="pet-shop-coins">0</span> монет</span><button id="pet-shop-close">Готово</button></div>
```

- [ ] **Step 5: Светлая тема оверлея + «пилюля» иконок**

В `<style>` внутри `catpet.js` заменить тёмный фон оверлея `.pet-ov{...background:#f3e2cf...}` на светлую бренд-подложку (кремовый/ганаш-акцент, как в Mini App — сверить с `public/css/style.css` переменными). Добавить стиль иконки:

```css
      .pet-i{display:inline-block;vertical-align:-.18em}
```

Оставить фоны комнат (`bg`) как есть — они и есть арт-сцена. Кнопку действия `.pet-action__btn` перекрасить в бренд-акцент вместо `#ff7a2d` при желании (не блокер).

- [ ] **Step 6: Тексты — кот = Василий**

Пройтись по видимым строкам `catpet.js` (`grep -niE "котик|кот[^а-я]|питом" public/js/catpet.js`) и там, где обращаемся к коту по имени, использовать «Василий». Заголовок оверлея — «Дом Василия».

- [ ] **Step 7: Синтаксис-проверка**

Run: `node --check public/js/catpet.js`
Expected: OK. Открыть в браузере (staging, Task 9) и глазами проверить: нет эмодзи-иконок, светлая тема, иконки рисованные.

- [ ] **Step 8: Commit**

```bash
git add public/js/catpet.js
git commit -m "feat(pet): ребрендинг Дома кота — рисованные SVG вместо эмодзи, светлая тема, кот=Василий"
```

---

## Task 9: UI стрика заботы + единый лейбл монет (catpet.js)

**Files:**
- Modify: `public/js/catpet.js` (рендер стрика, попап бонуса, чтение `careStreak`/`streakBonus` из ответа, локальный гостевой стрик)

**Interfaces:**
- Consumes: `GET /api/pet` → `{ ...coins, careStreak }`; `POST /api/pet/action` → `{ ...coins, careStreak, streakBonus }` (Task 3/5).
- Produces: видимый счётчик «N дней подряд» и попап «+бонус монет» при первом уходе за день.

- [ ] **Step 1: Показать счётчик стрика в шапке «Дома»**

В разметке оверлея (там же, где `#pet-needs`/шапка) добавить элемент:

```js
        <div class="pet-streak" id="pet-streak"></div>
```

И CSS:

```css
      .pet-streak{position:absolute;top:10px;right:12px;z-index:6;font-weight:800;font-size:13px;color:#c2882a;background:rgba(255,255,255,.7);border-radius:12px;padding:5px 10px}
```

В функции рендера состояния (где обновляются полоски потребностей) добавить:

```js
    const ps = ov.querySelector('#pet-streak');
    if (ps) ps.innerHTML = (state.careStreak > 0)
      ? PIC.pet(14) + ' Забота: ' + state.careStreak + (state.careStreak >= 5 ? ' дней 🔥' : ' дн.')
      : 'Погладь Василия!';
```

(🔥 — исключение только как акцент-эмодзи в тексте награды/стрика; если хотим строго без эмодзи — убрать. Уточнить визуально на staging.)

- [ ] **Step 2: Попап бонуса за день заботы**

В `doAction(action)` (строка ~70), после получения `state` от сервера, показать попап, если пришёл `streakBonus > 0`:

```js
  async function doAction(action) {
    let bonus = 0;
    if (authed()) {
      try {
        const resp = await api('/api/pet/action', { method: 'POST', body: JSON.stringify({ action }) });
        state = resp; bonus = Number(resp.streakBonus || 0);
      } catch (_) {}
    } else {
      state = localAction(action);
      bonus = Number(state._streakBonus || 0);
    }
    render();
    if (bonus > 0) showCareBonus(bonus, state.careStreak);
  }
```

Добавить функцию `showCareBonus` (лёгкий тост поверх оверлея):

```js
  function showCareBonus(bonus, streak) {
    let t = ov.querySelector('#pet-toast');
    if (!t) { t = document.createElement('div'); t.id = 'pet-toast'; t.className = 'pet-toast'; ov.appendChild(t); }
    t.innerHTML = 'Василий рад! Забота ' + streak + ' дн. подряд · +' + bonus + ' монет';
    t.classList.add('on');
    clearTimeout(t._tm); t._tm = setTimeout(() => t.classList.remove('on'), 2600);
  }
```

CSS:

```css
      .pet-toast{position:absolute;left:50%;top:54px;transform:translateX(-50%);z-index:8;max-width:88%;text-align:center;background:linear-gradient(180deg,#ffe7a6,#eebf52);color:#5a2028;font-weight:800;font-size:13px;border-radius:14px;padding:9px 14px;opacity:0;transition:opacity .3s;pointer-events:none}
      .pet-toast.on{opacity:1}
```

- [ ] **Step 3: Локальный гостевой стрик (localStorage)**

В `localDefault()` (строка ~38) добавить поля `care_streak: 0, care_date: null`. В `localAction(action)` (строка ~58) перед возвратом посчитать стрик тем же правилом и положить временное `_streakBonus`:

```js
    const dayKey = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const yKey = new Date(Date.now() + 8 * 3600 * 1000 - 86400000).toISOString().slice(0, 10);
    let sb = 0;
    if (s.care_date !== dayKey) {
      s.care_streak = (s.care_date === yKey) ? (s.care_streak || 0) + 1 : 1;
      s.care_date = dayKey;
      sb = 100 * Math.min(Math.max(1, s.care_streak), 10);
      s.coins += sb;               // у гостя монеты локальные
    }
    s.careStreak = s.care_streak;  // для единообразия с сервером
    s._streakBonus = sb;
```

(Убедиться, что `localAction` больше не даёт монеты «за действие» помимо стрика — привести к анти-фарм логике сервера: убрать `s.coins += 3`, оставить только стрик-бонус.)

- [ ] **Step 4: Единый лейбл монет**

Проверить, что все места показа монет в `catpet.js` (`#pet-shop-coins` и др.) берут `state.coins` (теперь = баланс кликера). Найти: `grep -n "coins" public/js/catpet.js`. Подпись — «монет» (не «🪙»).

- [ ] **Step 5: Синтаксис-проверка**

Run: `node --check public/js/catpet.js`
Expected: OK.

- [ ] **Step 6: Commit**

```bash
git add public/js/catpet.js
git commit -m "feat(pet): UI стрика заботы + попап бонуса + локальный гостевой стрик + единый лейбл монет"
```

---

## Task 10: Кэш-бустеры, staging-деплой и верификация, затем прод

**Files:**
- Modify: `public/index.html` (версии `catclick.js`/`catpet.js`)

**Interfaces:** —

- [ ] **Step 1: Бампнуть версии ассетов**

В `public/index.html` увеличить `?v=` у `catclick.js` (текущая v90 → v91). Если `catpet.js` подключён с версией — тоже бампнуть; если без версии — добавить `?v=1`. Найти: `grep -nE "catclick.js\?v=|catpet.js" public/index.html`.

- [ ] **Step 2: Собрать и проверить**

Run: `npx tsc --noEmit && node --check public/js/catpet.js && node --check public/js/catclick.js`
Expected: без ошибок.

- [ ] **Step 3: Commit + деплой на STAGING**

```bash
git add public/index.html
git commit -m "chore(pet): кэш-бустеры Дома кота + вкладки"
```

Задеплоить на staging-контейнер (НЕ прод):
```bash
ssh -i ~/.ssh/maria_prod root@145.223.121.47 'cd /opt/maria/maria-bot && git fetch && git checkout <branch> && git pull && cd /opt/maria && docker compose up -d --build maria-bot-stage'
```
(Уточнить точную процедуру staging из `references/infra.md`; ключ — выкатить именно `maria-bot-stage`, а не `maria-bot`.)

- [ ] **Step 4: Верификация на staging (миграция кошелька — критично)**

На staging проверить (через ssh + `docker exec ... psql`/API):
1. **Миграция:** у тест-пользователя с `pet_state.coins > 0` и `pet_coins_merged=false` — после `GET /api/pet`: `pet_state.coins=0`, `pet_coins_merged=true`, `clicker_state.balance` вырос ровно на прежние pet-coins (не задвоился при повторном GET — идемпотентность).
2. **Случай «pet есть, clicker нет»:** удалить `clicker_state` тест-строку, оставить `pet_state` → `GET /api/pet` создаёт clicker-строку и корректно вливает.
3. **Стрик:** `POST /api/pet/action` первый раз за день → `careStreak` растёт, `streakBonus>0`, баланс вырос; повтор в тот же день → `streakBonus=0`, баланс не растёт; эмуляция «вчера» (подставить `care_date`) → +1 к стрику.
4. **Покупка наряда:** `POST /api/pet/buy` списывает из общего баланса; при нехватке — `not_enough_coins`.
5. **Браузер:** вкладка «Дом» в кликере открывает Дом кота; светлая тема; нет эмодзи-иконок; счётчик стрика виден; попап бонуса появляется.

Зафиксировать результаты проверки текстом (что прошло/не прошло).

- [ ] **Step 5: Прод-деплой (после зелёного staging)**

Слить ветку в master и выкатить прод как обычно:
```bash
# push master → VPS
ssh -i ~/.ssh/maria_prod root@145.223.121.47 'cd /opt/maria/maria-bot && git checkout master && git pull && cd /opt/maria && docker compose up -d --build maria-bot'
```
Проверить health и версии ассетов с самого VPS (локальный curl из РФ даёт 000): `curl https://bot.145-223-121-47.sslip.io/health` == 200; `catclick.js?v=91`, вкладка «Дом» отдаётся.

- [ ] **Step 6: Финальный коммит-маркер (если нужен) + запись в память**

Обновить `session_log.md`: Фаза 1 «Дом кота» в проде, что проверено на staging (особенно миграция кошелька), что осталось на Фазу 2.

---

## Self-Review (проверка плана против спеки)

**Spec coverage:**
- §5.1 Точка входа → Task 7. ✅
- §5.2 Стрик заботы (модель, хранение, зачёт, награда, анти-накрутка) → Task 1 (схема) + Task 4 (логика) + Task 9 (UI/гость). ✅
- §5.3 Единая копилка + миграция (+ случай «pet есть, clicker нет») → Task 2 (хелпер) + Task 3 (getPet/миграция) + Task 4 (buy/earn) + Task 10 Step 4 (верификация). ✅
- §5.4 Ребрендинг (эмодзи→SVG, светлая тема, Василий) → Task 8. ✅
- §5.5 Смягчение decay → Task 6. ✅
- §6 Схема additive → Task 1. ✅
- §8 Платформа/авторизация (TG-сервер + гость-локально) → сохранено (роуты остаются `requireTgUser`; гостевой путь в Task 9 Step 3). ✅
- §9 Тестирование → Task 10 Step 4 (адаптировано под отсутствие тест-фреймворка: typecheck + staging + API/DB/браузер). ✅
- §11 Развёртывание (сначала staging) → Task 10. ✅

**Placeholder scan:** Явных TBD/TODO нет. Осталось два места «уточнить на staging/из infra.md» — это точечные оперативные уточнения (точная процедура staging, финальное решение по 🔥-акценту в тексте), не пробелы в требованиях; отмечены явно.

**Type consistency:** `addClickerBalance(chatId, coins, client?)` — определён Task 2 (принимает опциональный транзакционный `client`), используется в Task 3 (миграция) и Task 4 (стрик-бонус) внутри их транзакций — DRY, атомарно, без unused-import. `PetState.careStreak` — добавлен в Task 3, читается в Task 9. `doPetAction` возврат `{ streakBonus, careStreak }` — Task 4, потребляется Task 5 (routes) и Task 9 (front). `irkDay`/`careStreakBonus` — Task 3, используются Task 4. Имена согласованы.

**Открытый риск:** миграция двух кошельков — обязательная проверка идемпотентности и случая отсутствия clicker-строки на staging (Task 10 Step 4) до прод.

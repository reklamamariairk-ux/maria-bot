# Поток-2: монетизационный мост — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Замкнуть «прогресс в игре → реальная скидка на заказе»: научить чекаут гасить персональные коды из `user_rewards` (keystone) и провести монето-сторону через реальную выдачу кода.

**Architecture:** Единая рельса `user_rewards` (подход A). Points-сторона уже построена (`club.ts redeemReward` + `/api/rewards/*`) — она пишет персональные коды, но **чекаут (`routes/promo.ts`) их не валидирует** (только `promo-codes.json`). Закрываем этот разрыв и подключаем монето-сторону (`clicker.ts redeemReward` сейчас выдаёт код-заглушку) к настоящей выдаче через `grantRewardByCode`.

**Tech Stack:** TypeScript (tsc), Express, Neon Postgres. Vanilla JS фронт.

## ⚠️ Модель верификации (репо БЕЗ unit-фреймворка)
Гейт каждой задачи — **только `npm run build` (tsc, exit 0)**. Eslint в проекте не работает — НЕ ставить, НЕ гонять lint. Smoke-скрипты создаём как артефакт, но НЕ гоняем против прод-БД (локальной БД нет) — DB-проверка на `maria-bot-stage`. `scripts/` в gitignore — smoke не коммитим.

## Global Constraints
- **Только реальные данные** — скидки реальные (honored на чекауте), никаких выдуманных (`CLAUDE.md`).
- **ID:** в БД internal `chat_id`; наружу `toPlatformId()`.
- **БД-транзакции** ТОЛЬКО через `pool.connect()`+client+BEGIN/COMMIT/ROLLBACK+release в finally. `pool.query("BEGIN")` НЕ работает.
- **Сутки — Иркутск (UTC+8):** сравнение `expires_at` с «сегодня Иркутск» = `new Date(Date.now()+8*3600_000).toISOString().slice(0,10)` (как в `promo.ts`).
- **Скоуп-стоп:** не переписываем оформление заказа/корзину — только `/api/promo/validate` + `/api/promo/use`. Не генерим Bitrix-купоны. `promo-codes.json` (общие коды) не трогаем.
- **Анти-коллизия имён:** персональные коды генерятся `generatePromoCode()` → `MARIA-<...>`; при валидации сначала проверяем `promo-codes.json`, потом `user_rewards` (общий код имеет приоритет).
- **Включение (`REWARDS_ENABLED`, наполнение `rewards_catalog` монето-наградами, суммы) — решения Маши, НЕ в этом плане.** План строит рабочий путь; флаг остаётся как есть до решений.

## Существующие интерфейсы (проверено по коду)
- `src/club.ts`: `redeemReward(chatId, rewardId): Promise<{ok, reason?, promoCode?, expiresAt?}>` (points-сторона, полная); `grantRewardByCode(chatId, code): Promise<{ok, reason?, promoCode?, title?, minOrder?, expiresAt?}>` (бесплатная выдача по коду каталога, пишет `user_rewards` cost_paid=0); `generatePromoCode()` → `MARIA-<s>`.
- `user_rewards(id, chat_id, reward_id→rewards_catalog(id), promo_code UNIQUE, cost_paid, created_at, expires_at, used_at, used_order_id)`.
- `rewards_catalog(id, code, title, reward_type['percent'|'amount'], discount_value, min_order, cost_points, active)`; засеян (discount_5, discount_10, …).
- `src/promo.ts`: `validatePromoSync({code, cart_total})`, `findPromo(code)` (только `promo-codes.json`). `src/routes/promo.ts`: `/api/promo/validate` (использует `tryGetTgUser(req)`, `hasUserUsedPromo`, `countPromoUses`), `/api/promo/use` (`recordPromoUse`). Фронт вызывает validate → создаёт заказ → use.
- `src/clicker.ts`: `redeemReward(chatId, id)` (монеты; `REWARDS_ENABLED` gate; код-заглушка `MARIA-<id4>-<reward>` — TODO реальная генерация); `REWARDS` (coin-cost список); `clicker_redemptions`.

---

### Task 1 (keystone): чекаут валидирует и гасит персональные коды `user_rewards`

**Files:**
- Modify: `src/db.ts` — добавить `findUserReward` + `markUserRewardUsed`
- Modify: `src/routes/promo.ts` — ветка `user_rewards` в `/validate` и `/use`
- Create: `scripts/smoke-userreward.js` (не гонять/не коммитить)

**Interfaces:**
- Produces:
  - `findUserReward(chatId: number, code: string): Promise<{ reward_type: 'percent'|'amount'; discount_value: number; min_order: number; expires_at: Date; used_at: Date|null } | null>` — джойн `user_rewards`→`rewards_catalog` по `promo_code=code AND chat_id`.
  - `markUserRewardUsed(code: string, chatId: number, orderId: string|null): Promise<void>` — `UPDATE user_rewards SET used_at=NOW(), used_order_id=$3 WHERE promo_code=$1 AND chat_id=$2 AND used_at IS NULL`.

- [ ] **Step 1: `src/db.ts` — helpers**

```ts
export async function findUserReward(chatId: number, code: string): Promise<
  { reward_type: string; discount_value: number; min_order: number; expires_at: Date; used_at: Date | null } | null> {
  const { rows } = await pool.query(
    `SELECT rc.reward_type, rc.discount_value, rc.min_order, ur.expires_at, ur.used_at
       FROM user_rewards ur JOIN rewards_catalog rc ON rc.id = ur.reward_id
      WHERE ur.promo_code = $1 AND ur.chat_id = $2`,
    [String(code).toUpperCase(), chatId]
  );
  return rows[0] ?? null;
}
export async function markUserRewardUsed(code: string, chatId: number, orderId: string | null): Promise<void> {
  await pool.query(
    `UPDATE user_rewards SET used_at = NOW(), used_order_id = $3
      WHERE promo_code = $1 AND chat_id = $2 AND used_at IS NULL`,
    [String(code).toUpperCase(), chatId, orderId]
  );
}
```

- [ ] **Step 2: `src/routes/promo.ts` — ветка user_rewards в `/api/promo/validate`**

После неуспешной проверки `promo-codes.json` (когда `sync.result.reason === "not_found"`) и при наличии `tgUser` — искать персональный код:
```ts
import { findUserReward, markUserRewardUsed } from "../db";
// ... внутри /api/promo/validate, там где sync.result.reason === "not_found":
const tgUser2 = tryGetTgUser(req);
if (tgUser2) {
  const ur = await findUserReward(tgUser2.id, code);
  if (ur) {
    const todayIrk = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
    if (ur.used_at) { res.json({ ok: false, reason: "already_used", message: "Награда уже использована" }); return; }
    if (ur.expires_at.toISOString().slice(0, 10) < todayIrk) { res.json({ ok: false, reason: "expired", message: "Срок действия истёк" }); return; }
    if (ur.min_order && cartTotal < ur.min_order) {
      res.json({ ok: false, reason: "min_order_not_met", min_order: ur.min_order, message: `Минимальная сумма заказа: ${ur.min_order.toLocaleString("ru-RU")} ₽` }); return;
    }
    const discount = ur.reward_type === "percent" ? Math.floor(cartTotal * (ur.discount_value / 100)) : Math.min(ur.discount_value, cartTotal);
    res.json({ ok: true, code: code.toUpperCase(), type: ur.reward_type, value: ur.discount_value, discount, description: "Награда «Марии»" });
    return;
  }
}
```
(Поместить перед возвратом «not_found» из общей ветки, чтобы персональный код не отдавал «Промокод не найден».)

- [ ] **Step 3: `src/routes/promo.ts` — ветка user_rewards в `/api/promo/use`**

Сейчас `/use` требует `findPromo(code)` (общий) и падает 404 на персональный. Расширить: если общий не найден, но у юзера есть персональный — пометить его использованным.
```ts
// в /api/promo/use, вместо жёсткого 404 при !findPromo(code):
const tgUser = tryGetTgUser(req);
if (!findPromo(code)) {
  if (tgUser) {
    const ur = await findUserReward(tgUser.id, code);
    if (ur) { await markUserRewardUsed(code, tgUser.id, orderId); res.json({ ok: true }); return; }
  }
  res.status(404).json({ error: "code_not_found" }); return;
}
// ... дальше существующая ветка recordPromoUse для общих кодов
```

- [ ] **Step 4: BUILD** — `npm run build` → exit 0.

- [ ] **Step 5: SMOKE (не гонять локально)** — `scripts/smoke-userreward.js`: выдать тест-юзеру награду (`grantRewardByCode(t, 'discount_10')`), проверить `findUserReward` возвращает percent/10/min_order; `markUserRewardUsed` ставит used_at; повторный `findUserReward` показывает used_at; чужой chat_id → null. (Запускать на stage.)

- [ ] **Step 6: Commit**

```bash
git add src/db.ts src/routes/promo.ts
git commit -m "feat(promo): чекаут валидирует и гасит персональные коды user_rewards (keystone Потока-2)"
```

---

### Task 2: монето-сторона выдаёт реальный код (через grantRewardByCode)

**Files:**
- Modify: `src/clicker.ts` — `REWARDS` привязать к кодам каталога; `redeemReward` — реальная выдача
- Create: `scripts/smoke-coinredeem.js` (не гонять/не коммитить)

**Interfaces:**
- Consumes: `grantRewardByCode(chatId, code)` (club.ts).
- Produces: обновлённый `clicker.redeemReward` — возвращает реальный `code` из `user_rewards`.

- [ ] **Step 1: привязать `REWARDS` к каталогу** (`src/clicker.ts`)

Добавить каждому элементу `REWARDS` поле `catalog` — код из `rewards_catalog`:
```ts
export const REWARDS = [
  { id: "promo5",   name: "Промокод −5%",         cost: 100000, kind: "promo",   catalog: "discount_5",  note: "скидка на заказ" },
  { id: "promo10",  name: "Промокод −10%",        cost: 250000, kind: "promo",   catalog: "discount_10", note: "скидка на заказ" },
  { id: "dessert",  name: "Десерт в подарок",     cost: 500000, kind: "promo",   catalog: "free_dessert", note: "при заказе" },
];
```
(`bonus300`/loyalty-тип — отдельный путь через `earnPoints`, вне этой задачи; оставить только promo-типы с `catalog`. ⚠️ Коды каталога `free_dessert` и т.п. — наполнение `rewards_catalog` = решение Маши; путь строим на существующих `discount_5/10`.)

- [ ] **Step 2: `redeemReward` — реальная выдача** (`src/clicker.ts`)

Заменить строку-заглушку `const code = "MARIA-"+...` на выдачу через каталог. Порядок: списать монеты в tx (как сейчас) и записать `clicker_redemptions`, затем — вне монетной tx — `grantRewardByCode`; при сбое выдачи откатить списание монет (компенсация), т.к. `grantRewardByCode` открывает свой pool-запрос.
```ts
import { earnPoints, isPhoneVerified, grantRewardByCode } from "./club"; // grantRewardByCode уже импортирован
// ... в redeemReward, после проверок и ПЕРЕД списанием:
if (!rw.catalog) { await client.query("ROLLBACK"); return { ok: false, reason: "bad_reward" }; }
// списать монеты + записать redemption (без code пока)
r.balance = Number(r.balance) - rw.cost;
await client.query(`INSERT INTO clicker_redemptions (chat_id, reward_id, cost, code) VALUES ($1,$2,$3,$4)`, [chatId, id, rw.cost, "PENDING"]);
await client.query(`UPDATE clicker_state SET balance=$2, updated_at=NOW() WHERE chat_id=$1`, [chatId, r.balance]);
await client.query("COMMIT");
// выдать реальный код (вне tx). При сбое — вернуть монеты (компенсация).
const grant = await grantRewardByCode(chatId, rw.catalog);
if (!grant.ok || !grant.promoCode) {
  await pool.query(`UPDATE clicker_state SET balance=balance+$2 WHERE chat_id=$1`, [chatId, rw.cost]).catch(() => {});
  await pool.query(`DELETE FROM clicker_redemptions WHERE chat_id=$1 AND code='PENDING' AND reward_id=$2 AND created_at > NOW()-INTERVAL '1 minute'`, [chatId, id]).catch(() => {});
  return { ok: false, reason: "grant_failed" };
}
await pool.query(`UPDATE clicker_redemptions SET code=$3 WHERE chat_id=$1 AND reward_id=$2 AND code='PENDING'`, [chatId, id, grant.promoCode]).catch(() => {});
return { ok: true, code: grant.promoCode, state: buildState(r, cl, 0) };
```
(Сохранить существующие проверки `REWARDS_ENABLED`, `REDEEM_PER_DAY`, `not_enough`.)

- [ ] **Step 3: BUILD** — `npm run build` → exit 0.

- [ ] **Step 4: SMOKE (не гонять локально)** — `scripts/smoke-coinredeem.js`: с временно включённым `REWARDS_ENABLED`, у тест-юзера с достаточным балансом — `redeemReward` списывает монеты и возвращает реальный код; `findUserReward` находит его; при неверном `catalog` — откат монет. (На stage.)

- [ ] **Step 5: Commit**

```bash
git add src/clicker.ts
git commit -m "feat(clicker): монето-редемпшн выдаёт реальный код через grantRewardByCode (не заглушку)"
```

---

### Task 3: связность фронта + включение (проверка, минимум кода)

**Files:**
- Modify (если нужно): `public/js/catclick.js` / `public/js/club.js` / `public/js/profile.js` — показать выданный код с «Скопировать» и подсказкой «применить в корзине».

- [ ] **Step 1: ПРОВЕРИТЬ фронт** — где показывается результат `redeemReward`/`/api/rewards/redeem` и `/api/rewards/mine`; убедиться, что выданный `code` виден юзеру и что поле промокода в корзине шлёт его в `/api/promo/validate`. Если код показывается и корзина шлёт в validate — код-изменений нет (Task 1 уже связал бэкенд).
- [ ] **Step 2:** если код не показывается — добавить минимальный UI-вывод кода + «Скопировать» (следовать существующим паттернам вывода наград).
- [ ] **Step 3: BUILD** (если менялся TS — n/a для чистого JS-фронта; проверить, что фронт не сломан) и Commit при изменениях.

**Не в коде (решения Маши для реального включения):** `REWARDS_ENABLED=true`; наполнить `rewards_catalog` (welcome/входной SKU/free_dessert); монето-цены; потолок списания баллов 20%; суммы GIFTS.

---

## Self-Review

**Покрытие спеки:** grantUserReward-рельса → переиспользуем существующие `redeemReward`(points)/`grantRewardByCode` (T2 использует grantRewardByCode) ✓; расширение чекаута `validate`/`use` (T1) ✓ — keystone; монето-сторона реальный код (T2) ✓; маржа/капы — существующие (`REDEEM_PER_DAY`, `min_order`, expiry, points-редемпшн уже списывает) ✓; атомарность (T2 компенсация; T1 read-only + mark) ✓; анти-коллизия кодов (validate: JSON→user_rewards) ✓; «только реальные данные» (реальные скидки, honored) ✓. Потолок списания 20% и наполнение каталога — помечены как решения Маши (вне кода). Поток 3/UGC — вне скоупа (отдельные под-проекты) ✓.

**Плейсхолдеры:** каждый шаг несёт полный код; «ПРОВЕРИТЬ фронт» (T3) — реальная точка сверки, не заглушка (front-состояние не читалось в этой сессии).

**Консистентность типов:** `findUserReward(chatId, code)`→`{reward_type, discount_value, min_order, expires_at, used_at}` и `markUserRewardUsed(code, chatId, orderId)` — использованы одинаково в T1 (db.ts определяет, routes/promo.ts потребляет). `grantRewardByCode(chatId, code)→{ok, promoCode?}` — реальная сигнатура club.ts, потребляется в T2. `REWARDS[].catalog` — введено в T2 Step1, использовано в Step2.

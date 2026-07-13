# Game-first маркетинг (welcome бота + вкладка «Призы») — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Обновить встречающие сообщения бота под game-first и вернуть в чистую игру одну витрину «Призы» (бывшие «Задания») с промокодами, баллами и заданиями; обмен монет остаётся скрыт.

**Architecture:** Только тексты бота (src/index.ts) + снятие части pure-гейтов во фронте (catclick.js/catpet.js) + переименование вкладки. Серверная механика наград не меняется — она уже работает. Спека: `docs/superpowers/specs/2026-07-13-game-first-marketing-funnels-design.md` — прочитать перед работой.

**Tech Stack:** grammY-тексты, vanilla JS, playwright-смоук `scripts/game-page-smoke.js`.

## Global Constraints

- Прод = master, чекаут `C:/Users/user/maria-bot`, коммитим туда; НЕ пушить (пуш/деплой делает контроллер).
- Витрина обмена монет ОСТАЁТСЯ скрытой в pure: строку `let h = PURE ? '' : rewardsBlock();` (catclick ~1420) НЕ трогать.
- Крестик: pure-поведение (App.close / скрыт у гостя, catclick ~896-903 блок xBtn) НЕ трогать.
- Гостевые CTA «Открой игру в Telegram» (catclick ~1490, ~1522) НЕ трогать.
- Тексты бота — эмодзи можно; тексты игры — без эмодзи; ничего не обещать, чего нет (welcome-промо активен, вехи работают).
- Изменил catclick/catpet → бамп `?v=` в ОБОИХ html (сейчас catclick `?v=110`, catpet `?v=16`; в game.html есть preload-строки с версиями).
- Line-номера ниже — ориентиры; искать по приведённым строкам кода.

---

### Task 1: Тексты бота (WELCOME + QR_WELCOME)

**Files:**
- Modify: `src/index.ts` (константы `WELCOME` ~строка 478, `QR_WELCOME` ~530)

**Interfaces:**
- Consumes: `webAppButton` (существующая кнопка Mini App), Markdown parse_mode — как сейчас.
- Produces: новые тексты; сигнатуры/логика хендлеров НЕ меняются.

- [ ] **Step 1: Заменить WELCOME**

Найти:
```ts
const WELCOME = `
👋 Добро пожаловать в кондитерскую *«Мария»*!

Здесь вы можете:
🎮 Поиграть в наши сладкие игры
🤖 Поговорить с ИИ-кондитером
🛒 Узнать об акциях и заказать сладости

Нажмите кнопку ниже, чтобы открыть Mini App 👇
`.trim();
```
Заменить на:
```ts
const WELCOME = `
🐱 Это *«Котик Комбат»* — игра кондитерской *«Мария»*!

Расти кота Василия от Котёнка-стажёра до Императора выпечки:
👆 Тапай — зарабатывай монеты и открывай 19 образов
🏪 Заводи бизнесы — монеты капают даже офлайн
🏠 Ухаживай за Василием в его Доме

🎁 За уровни и заботу — настоящие призы: промокоды и баллы на карту «Марии». Всё — на вкладке «Призы».

Жми «Играть» 👇
`.trim();
```

- [ ] **Step 2: Заменить QR_WELCOME**

Найти:
```ts
const QR_WELCOME = `
👋 Добро пожаловать в «Марию»!

Вы отсканировали наш QR — теперь всё сладкое здесь:
🎁 *100 баллов* сразу за подтверждение номера в приложении
🎂 Акции и торт месяца — раньше всех
🎮 Игра «Котик Комбат» с призами-купонами
`.trim();
```
(конец блока — строка «Жмите кнопку и заходите 👇», взять фактический текст целиком) и заменить на:
```ts
const QR_WELCOME = `
👋 Вы отсканировали QR «Марии» — добро пожаловать!

Вас ждёт игра *«Котик Комбат»*: растите кота Василия и получайте настоящие призы:
🎁 Welcome-промокод за первую победу — сразу в игре
💎 *100 баллов* на карту за подтверждение номера
🎂 Промокоды и баллы за уровни и заботу о коте

Жмите «Играть» 👇
`.trim();
```

- [ ] **Step 3: Проверка типов**

Run: `npx tsc --noEmit`
Expected: exit 0, пустой вывод.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat(bot): игровое встречающее сообщение (/start и QR) под game-first"
```

---

### Task 2: catclick.js — вкладка «Призы» возвращается в pure

**Files:**
- Modify: `public/js/catclick.js`
- Modify: `public/index.html`, `public/game.html` (бамп `catclick.js?v=110` → `?v=111`, в game.html и preload-строка)

**Interfaces:**
- Consumes: существующие PURE-гейты (см. точные строки ниже).
- Produces: вкладка tasks видима и называется «Призы» в обоих режимах; welcome-промо/purchase-бонус/баннер призов недели/призовые тексты живут и в pure.

- [ ] **Step 1: Снять гейты вкладки**

1. ~903: удалить строку
```js
    if (PURE) { const tb = ov.querySelector('.ck-nav__b[data-tab="tasks"]'); if (tb) tb.style.display = 'none'; }
```
2. ~952: удалить строку
```js
    if (PURE && t === 'tasks') t = 'cat';
```

- [ ] **Step 2: Переименовать вкладку**

~893: `>${ICON.list(21)}Задания<` → `>${ICON.gift(21)}Призы<` (иконка подарка уместнее; если `ICON.gift` в навбаре смотрится чужеродно — оставить `ICON.list`, решает исполнитель по скрину).

- [ ] **Step 3: Вернуть коммерс-поверхности в pure**

1. ~476 (`maybeWelcomePromo`): удалить `if (PURE) return;`
2. ~1578 (`maybePurchaseBonus`): удалить `if (PURE) return;`
3. ~1495: `const wk = PURE ? '' : weeklyPrizeCard(d && d.weekly);` → `const wk = weeklyPrizeCard(d && d.weekly);`
4. ~1776 (туториал, подзаголовок): тернарий → всегда полный текст `Помоги котику дорасти от подвала до тронного зала — 19 уровней и реальные награды «Марии».`
5. ~1779 (туториал, шаг 3): тернарий → всегда `Награды, комбо дня и баллы на карту «Марии»`
6. ~1466 (хинт «Голубей»): тернарий → всегда `награды за комплект — в «Призах» → Достижения`

- [ ] **Step 4: Гайд — разделы для всех + переименование**

~932: `if (!PURE) { s.push(...«Задания»...); s.push(...«Награды «Марии»»...); }` → убрать условие (разделы всегда); в текстах разделов «Задания»/«вкладке «Задания»» → «Призы»/«вкладке «Призы»». Затем `grep -n "Задани" public/js/catclick.js` — все оставшиеся UI-упоминания вкладки перевести на «Призы» (заголовок экрана вкладки, если есть; коуч-хинты; тексты пустых состояний). НЕ трогать: комментарии кода можно оставить.

- [ ] **Step 5: Проверка + бамп + коммит**

- `node --check public/js/catclick.js` → exit 0.
- В `public/index.html` и `public/game.html`: `catclick.js?v=110` → `?v=111` (game.html — 2 места: script + preload).
```bash
git add public/js/catclick.js public/index.html public/game.html
git commit -m "feat(game): вкладка «Призы» видна в pure — welcome-промо, вехи, задания; обмен монет остаётся скрыт"
```

---

### Task 3: catpet.js — виджет «До подарка» возвращается

**Files:**
- Modify: `public/js/catpet.js`
- Modify: `public/index.html`, `public/game.html` (бамп `catpet.js?v=16` → `?v=17`, в game.html и preload)

**Interfaces:**
- Consumes: `window.ckSetTab('tasks')` — переход из виджета на вкладку (редирект в 'cat' удалён в Task 2 — переход снова работает).
- Produces: `#pet-gift` виден в pure, `openGiftLadder` открывается.

- [ ] **Step 1: Снять гейты**

1. ~350 (в функции обновления виджета): удалить строку
```js
    if (PURE) { const el0 = ov.querySelector('#pet-gift'); if (el0) el0.style.display = 'none'; return; }
```
2. ~360 (`openGiftLadder`): удалить `if (PURE) return;`

- [ ] **Step 2: Проверка + бамп + коммит**

- `node --check public/js/catpet.js` → exit 0; в обоих html `catpet.js?v=16` → `?v=17`.
```bash
git add public/js/catpet.js public/index.html public/game.html
git commit -m "feat(pet): виджет «До подарка» и лестница вех снова видны в pure"
```

---

### Task 4: Смоук-инверсия + прогон

**Files:**
- Modify: `scripts/game-page-smoke.js`

**Interfaces:**
- Consumes: изменённое поведение pure (вкладка видна).

- [ ] **Step 1: Обновить ассерты смоука**

В `scripts/game-page-smoke.js`:
- ассерт `вкладка Задания скрыта` (isHidden) → инвертировать: `.ck-nav__b[data-tab="tasks"]` ВИДИМА в pure, текст кнопки содержит «Призы»;
- ассерт про `#pet-gift` скрыт → инвертировать (видим после открытия Дома);
- ассерты ОСТАВИТЬ: `.ck-reward` отсутствует (витрина обмена по-прежнему скрыта), крестик `#ck-x` скрыт у гостя, сплеш, регресс index.html (там вкладка теперь тоже «Призы» — если ассерт проверял текст «Задания», поправить на «Призы»).

- [ ] **Step 2: Прогнать**

Run: `node scripts/game-page-smoke.js`
Expected: все PASS, `SMOKE OK` (playwright: `npm i --no-save playwright` при необходимости).

- [ ] **Step 3: Commit**

```bash
git add -f scripts/game-page-smoke.js
git commit -m "test: смоук под вкладку «Призы» в pure"
```

Деплой и смену текстов в проде выполняет контроллер после финального ревью (git push + VPS pull + rebuild; env не меняется).

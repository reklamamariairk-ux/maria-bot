# Котик Комбат отдельным приложением (game.html + ck-pure) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Главный вход Mini App @mariatortik_bot становится чистой игрой «Котик Комбат» — новая страница `public/game.html`, магазин не грузится, коммерция скрыта режимом `ck-pure`.

**Architecture:** Бэкенд не меняется вообще (тот же BOT_TOKEN/auth/API/БД). Новая страница-обёртка `game.html` грузит только игровые скрипты и ставит html-классы `ck-gamefirst` (авто-открытие) + `ck-pure` (скрыть коммерцию). Флаг `PURE` читают `catclick.js` и `catpet.js`. `index.html` (магазин, нужен VK) не трогаем, кроме бампа `?v=` у изменённых скриптов.

**Tech Stack:** Vanilla JS Mini App, playwright-смоуки (`scripts/*.js`, паттерн `vk_port_smoke.js`), деплой Hostinger VPS (docker compose).

**Спека:** `docs/superpowers/specs/2026-07-13-kotik-standalone-game-design.md` — прочитать перед работой.

## Global Constraints

- Прод = ветка `master`; рабочий чекаут `C:/Users/user/maria-bot` на master, коммитим туда.
- `index.html`/магазин функционально НЕ менять — только бамп `?v=` (VK-версия живёт на нём).
- Бэкенд (`src/**`) в этом плане НЕ трогается совсем.
- Изменил `catclick.js` → бамп `?v=` в **обоих** html (index: сейчас `?v=101`; catpet: `?v=9`).
- Вне TG/VK (`App.platform === 'guest'`) всё должно работать как раньше (гостевой режим — путь тестирования).
- Никаких эмодзи как арт; тексты игры — без выдуманных цифр/акций (real-data правило).
- Каждая задача = отдельный коммит. Пушить на origin только в финальной задаче деплоя.

---

### Task 1: `App.close()` в tg-bridge.js

**Files:**
- Modify: `public/js/tg-bridge.js` (объект `App`, рядом с `main:`/`back:` ~строка 379)

**Interfaces:**
- Produces: `App.close(): void` — закрывает Mini App (TG `WebApp.close()`, VK `VKWebAppClose`); в госте no-op. Использует Task 3.

- [ ] **Step 1: Добавить метод в объект App**

В `public/js/tg-bridge.js` найти хвост объекта `App`:

```js
    main: window.tgMain,
    back: window.tgBack,
  };
```

и вставить ПЕРЕД `main:`:

```js
    /** Закрыть Mini App (используется pure-режимом game.html). Гость — no-op. */
    close() {
      if (PLATFORM === 'tg' && tg?.close) { try { tg.close(); return; } catch {} }
      if (PLATFORM === 'vk' && _vkBridge) { try { _vkBridge.send('VKWebAppClose', { status: 'success' }); } catch {} }
    },

```

Также дописать строку в JSDoc-шапку файла (после `App.main / App.back        = tgMain / tgBack`):

```
     App.close()                закрыть Mini App (TG close / VK VKWebAppClose; guest no-op)
```

- [ ] **Step 2: Синтаксис-проверка**

Run: `node --check public/js/tg-bridge.js`
Expected: тишина (exit 0).

- [ ] **Step 3: Commit**

```bash
git add public/js/tg-bridge.js
git commit -m "feat(bridge): App.close() — закрытие Mini App для pure-режима игры"
```

---

### Task 2: Страница `public/game.html`

**Files:**
- Create: `public/game.html`

**Interfaces:**
- Consumes: игровые скрипты как есть; классы `ck-pure`/`ck-gamefirst` начнут действовать после Task 3/4 (до того страница просто открывает игру в обычном виде — это ок для промежуточного коммита).
- Produces: URL `/game.html` — вход «чистой игры» (его потом руками ставят в BotFather).

- [ ] **Step 1: Создать `public/game.html`**

Точное содержимое (сплеш и его CSS — копия из index.html, статичные классы на `<html>`, только игровые скрипты; `sweet-prizes.js`, `icons*.js`, `style.css`, `app.js` и прочий магазин НЕ подключаются; версии скриптов сразу целевые — `catclick.js?v=102`, `catpet.js?v=10`, бамп самих файлов будет в Task 3/4):

```html
<!DOCTYPE html>
<html lang="ru" class="ck-gamefirst ck-pure">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"/>
  <meta name="theme-color" content="#0e0a09"/>
  <title>Котик Комбат — Мария</title>
  <meta name="description" content="Котик Комбат: помоги коту Василию дорасти от котёнка-стажёра до Императора выпечки. 19 уровней."/>
  <link rel="apple-touch-icon" href="/logo.png"/>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Onest:wght@400..800&family=Playfair+Display:wght@600;700;800&family=JetBrains+Mono:wght@500;600&family=Nunito:wght@400;600;700;800;900&display=swap" rel="stylesheet"/>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <script src="/js/utils.js"></script>
  <script src="/js/tg-bridge.js"></script>
  <style>
    html,body{margin:0;padding:0;background:#0e0a09}
    #ck-splash{position:fixed;inset:0;z-index:9998;display:none;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:radial-gradient(130% 100% at 50% -10%,#2c2320 0%,#1a1413 52%,#0e0a09 100%);font-family:'Nunito','Onest',system-ui,sans-serif}
    html.ck-gamefirst #ck-splash{display:flex}
    #ck-splash .r{width:46px;height:46px;border-radius:50%;border:4px solid rgba(240,194,78,.22);border-top-color:#f0c24e;animation:cksp .8s linear infinite}
    #ck-splash .t{color:#eee7dd;font-weight:800;font-size:15px;letter-spacing:.2px}
    @keyframes cksp{to{transform:rotate(360deg)}}
  </style>
</head>
<body>
<div id="ck-splash"><div class="r"></div><div class="t">Котик Комбат загружается…</div></div>
<script src="/js/catgame.js" defer></script>
<script src="/js/catfeed.js" defer></script>
<script src="/js/catpet.js?v=10" defer></script>
<script src="/js/catclick.js?v=102" defer></script>
</body>
</html>
```

Пояснения (для ревьюера): `catgame.js`/`catfeed.js` нужны кнопкам «поиграть» в Доме кота (`window.catFeedOpen?.()` / `window.catGameOpen?.()` из catpet.js); `game.js` (колесо/стрик клуба) и `catlive.js` (тест) НЕ подключаем. `catclick.js` сам открывает игру: его `clickAutoOpen()` срабатывает на класс `ck-gamefirst` и снимает сплеш в `open()`.

- [ ] **Step 2: Быстрая проверка руками**

```bash
cd C:/Users/user/maria-bot/public && npx --yes http-server -p 8799 --silent &
```

Открыть `http://localhost:8799/game.html` (или headless-скрином): игра открывается сразу, сплеш исчез. Пока БЕЗ pure-скрытий — это норма до Task 3.

- [ ] **Step 3: Commit**

```bash
git add public/game.html
git commit -m "feat: game.html — отдельный вход чистой игры (Котик Комбат без магазина)"
```

---

### Task 3: Режим `ck-pure` в catclick.js

**Files:**
- Modify: `public/js/catclick.js`
- Modify: `public/index.html` (только бамп `catclick.js?v=101` → `?v=102`)

**Interfaces:**
- Consumes: `App.close()` (Task 1), `App.platform` (`'tg' | 'vk' | 'guest'`).
- Produces: поведение `ck-pure` в игре; `const PURE` — локальная константа модуля.

- [ ] **Step 1: Флаг PURE**

В `catclick.js` рядом с константами верха модуля (после строки с `const SOCIAL = ...`):

```js
  // Режим «чистой игры» (game.html): вся коммерция скрыта. См. спеку 2026-07-13.
  const PURE = document.documentElement.classList.contains('ck-pure');
```

- [ ] **Step 2: Гейты коммерции (5 точек)**

1. `async function maybeWelcomePromo() {` — первой строкой тела: `if (PURE) return;`
2. `async function maybePurchaseBonus() {` — первой строкой тела: `if (PURE) return;`
3. В рендере прокачки найти `let h = rewardsBlock();` → заменить на `let h = PURE ? '' : rewardsBlock();`
4. Вкладка «Задания» (там только коммерция: промокоды, задания «Марии», вехи с реальными баллами) — скрыть кнопку. В `build()` после строки `ov.querySelector('#ck-x').onclick = close;` добавить:

```js
    if (PURE) { const tb = ov.querySelector('.ck-nav__b[data-tab="tasks"]'); if (tb) tb.style.display = 'none'; }
```

5. Страховка от программных переходов (`window.ckSetTab('tasks')` зовёт виджет Дома кота): в начале `function setTab(` добавить:

```js
    if (PURE && t === 'tasks') t = 'cat';
```

- [ ] **Step 3: Крестик закрытия**

В `build()` строку:

```js
    ov.querySelector('#ck-x').onclick = close;
```

заменить на:

```js
    const xBtn = ov.querySelector('#ck-x');
    if (PURE) {
      // Выходить «в магазин» некуда: в Mini App крестик закрывает приложение, в госте скрыт.
      if (window.App && App.platform !== 'guest') xBtn.onclick = () => { try { App.close(); } catch (_) {} };
      else xBtn.style.display = 'none';
    } else xBtn.onclick = close;
```

(Добавка из Step 2 п.4 идёт после этого блока — якорь тот же, следить за порядком.)

- [ ] **Step 4: Туториал без «баллов на карту»**

В `showTutorial()` строку шага 3:

```js
      <div class="ck-tut__step"><div class="si">${ICON.gift(20)}</div><div><div class="st">Заходи каждый день</div><div class="sd">Награды, комбо дня и баллы на карту «Марии»</div></div></div>
```

заменить на:

```js
      <div class="ck-tut__step"><div class="si">${ICON.gift(20)}</div><div><div class="st">Заходи каждый день</div><div class="sd">${PURE ? 'Ежедневные награды, комбо дня и шифр' : 'Награды, комбо дня и баллы на карту «Марии»'}</div></div></div>
```

- [ ] **Step 5: Бамп версии**

- `node --check public/js/catclick.js` → exit 0.
- В `public/index.html`: `catclick.js?v=101` → `catclick.js?v=102`.

- [ ] **Step 6: Commit**

```bash
git add public/js/catclick.js public/index.html
git commit -m "feat(clicker): режим ck-pure — игра без коммерции для game.html"
```

---

### Task 4: Режим `ck-pure` в catpet.js (Дом кота)

**Files:**
- Modify: `public/js/catpet.js`
- Modify: `public/index.html` (только бамп `catpet.js?v=9` → `?v=10`)

**Interfaces:**
- Consumes: класс `ck-pure` на `<html>`.
- Produces: в pure-режиме виджет «До подарка» (`#pet-gift`) не показывается, лестница вех не открывается.

- [ ] **Step 1: Флаг и гейты**

В `catpet.js` рядом с `const CARE_MILESTONES = [` (верх модуля) добавить:

```js
  const PURE = document.documentElement.classList.contains('ck-pure'); // чистая игра: без реальных призов
```

Найти функцию, обновляющую виджет (внутри неё строка `const el = ov.querySelector('#pet-gift'); if (!el || !state) return;`) — первой строкой тела:

```js
    if (PURE) { const el0 = ov.querySelector('#pet-gift'); if (el0) el0.style.display = 'none'; return; }
```

Найти `function openGiftLadder` (обработчик `#pet-gift`) — первой строкой тела: `if (PURE) return;`

- [ ] **Step 2: Проверка + бамп**

- `node --check public/js/catpet.js` → exit 0.
- В `public/index.html`: `catpet.js?v=9` → `catpet.js?v=10`.

- [ ] **Step 3: Commit**

```bash
git add public/js/catpet.js public/index.html
git commit -m "feat(catpet): ck-pure — Дом кота без виджета реальных призов"
```

---

### Task 5: Смоук-скрипт, регресс, деплой

**Files:**
- Create: `scripts/game-page-smoke.js`
- Modify: — (только прогон и деплой)

**Interfaces:**
- Consumes: `game.html` (Task 2), pure-гейты (Task 3–4).

- [ ] **Step 1: Написать смоук `scripts/game-page-smoke.js`**

Playwright уже в devDeps (используется `scripts/vk_port_smoke.js`). Скрипт: статик-сервер на public/ + два прогона (game.html pure / index.html регресс), критерии в asserts:

```js
/* Смоук game.html (pure) + регресс index.html (гость). Запуск: node scripts/game-page-smoke.js */
const http = require('http');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const PUB = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };

function serve() {
  return new Promise((res) => {
    const s = http.createServer((req, rsp) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      let f = path.join(PUB, u === '/' ? 'index.html' : u);
      if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rsp);
    }).listen(0, () => res(s));
  });
}

(async () => {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  const br = await chromium.launch();
  const errors = [];
  const fails = [];
  const ok = (cond, name) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name); if (!cond) fails.push(name); };

  // ── 1. game.html: pure-режим ──
  let pg = await br.newPage();
  pg.on('pageerror', (e) => errors.push('game.html: ' + e.message));
  await pg.goto(base + '/game.html');
  await pg.waitForSelector('.ck-ov.on', { timeout: 15000 });
  ok(true, 'game.html: игра автооткрылась');
  ok(await pg.locator('#ck-splash').isHidden(), 'game.html: сплеш снят');
  ok(await pg.locator('.ck-nav__b[data-tab="tasks"]').isHidden(), 'pure: вкладка Задания скрыта');
  ok(await pg.locator('#ck-x').isHidden(), 'pure: крестик скрыт у гостя');
  ok((await pg.locator('text=Награды «Марии»').count()) === 0, 'pure: витрины наград нет');
  // Дом кота: виджет «До подарка» скрыт
  await pg.locator('.ck-nav__b[data-tab="home"]').click();
  await pg.waitForTimeout(1500);
  ok(await pg.locator('#pet-gift').isHidden().catch(() => true), 'pure: #pet-gift скрыт');
  await pg.close();

  // ── 2. index.html: регресс (магазин + игра с коммерцией) ──
  pg = await br.newPage();
  pg.on('pageerror', (e) => errors.push('index.html: ' + e.message));
  await pg.goto(base + '/index.html');
  await pg.waitForTimeout(2500);
  await pg.evaluate(() => window.catClickOpen());
  await pg.waitForSelector('.ck-ov.on', { timeout: 15000 });
  ok(await pg.locator('.ck-nav__b[data-tab="tasks"]').isVisible(), 'регресс: вкладка Задания на месте');
  ok(await pg.locator('#ck-x').isVisible(), 'регресс: крестик на месте');
  await pg.close();

  await br.close();
  srv.close();
  if (errors.length) { console.error('PAGEERRORS:', errors); process.exit(1); }
  if (fails.length) { console.error('FAILED:', fails); process.exit(1); }
  console.log('SMOKE OK');
})().catch((e) => { console.error(e); process.exit(1); });
```

Примечание: если селектор `.ck-ov.on` в текущем коде другой (проверить `ov.className = 'ck-ov'` + `classList.add('on')`) — поправить скрипт, не игру.

- [ ] **Step 2: Прогнать смоук**

Run: `node scripts/game-page-smoke.js`
Expected: все PASS, `SMOKE OK`, exit 0. Если FAIL — чинить гейты (Task 3/4), не критерии.

Дополнительно VK-регресс (index.html для VK не должен был измениться поведением):

Run: `node scripts/vk_port_smoke.js`
Expected: как до правок (скрипт ловит pageerror в guest+vk-режимах). Если скрипт требует недоступного окружения (stage/env) — зафиксировать это в отчёте задачи и ограничиться game-page-smoke, index.html функционально не менялся (только `?v=`).

- [ ] **Step 3: Коммит смоука**

```bash
git add -f scripts/game-page-smoke.js
git commit -m "test: смоук game.html (pure) + регресс index.html"
```

(`git add -f` — `scripts/` в .gitignore, паттерн репо.)

- [ ] **Step 4: Деплой**

```bash
git push origin master
ssh root@145.223.121.47 'cd /opt/maria/maria-bot && git pull && cd .. && docker compose up -d --build maria-bot'
curl -sk https://bot.145-223-121-47.sslip.io/health          # ожидаем 200/ok
curl -sk https://bot.145-223-121-47.sslip.io/game.html | head -5   # ожидаем <!DOCTYPE html> с ck-pure
```

- [ ] **Step 5: Ручной шаг юзера (сообщить, сам сделать не могу)**

В BotFather: `/mybots → @mariatortik_bot → Bot Settings → Configure Mini App → Edit Main Mini App URL` → `https://bot.145-223-121-47.sslip.io/game.html`. Если настроена кнопка меню (Menu Button) — обновить и её. Откат = вернуть старый URL, без деплоя.

После смены URL — смоук в Telegram: открыть бота, игра сразу; прогресс серверный подтянулся; крестик сворачивает Mini App; коммерс-блоков нет.

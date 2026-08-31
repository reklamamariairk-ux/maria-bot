/* Смоук game.html (pure) + регресс index.html (гость). Запуск: node scripts/game-page-smoke.js */
/* Зависимость не в package.json (не тащим в прод-образ): перед запуском `npm i --no-save playwright` + `npx playwright install chromium`. */
const http = require('http');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const PUB = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
const VK_ALIASES = {
  '/js/tg-bridge-vk.js': '/js/tg-bridge.js',
  '/js/catclick-vk.js': '/js/catclick.js',
};

function serve() {
  return new Promise((res) => {
    const s = http.createServer((req, rsp) => {
      const requested = decodeURIComponent(req.url.split('?')[0]);
      const u = VK_ALIASES[requested] || requested;
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
  // domcontentloaded, не 'load': страница тянет внешние Google Fonts/telegram-web-app.js,
  // а 'load' ждёт их все — на нестабильной сети даёт ложный таймаут не по вине игры.
  await pg.goto(base + '/game.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pg.waitForSelector('.ck-ov.on', { timeout: 15000 });
  ok(true, 'game.html: игра автооткрылась');
  ok(await pg.locator('#ck-splash').isHidden(), 'game.html: сплеш снят');
  ok(await pg.locator('.ck-nav__b[data-tab="tasks"]').isVisible(), 'pure: вкладка Призы видима');
  ok(((await pg.locator('.ck-nav__b[data-tab="tasks"]').textContent()) || '').includes('Призы'), 'pure: вкладка называется «Призы»');
  ok(await pg.locator('#ck-x').isHidden(), 'pure: крестик скрыт у гостя');
  // .ck-reward — карточки витрины наград (не текстовый матч: во вступлении тьюториала
  // тоже упоминается фраза «награды «Марии»» как флейвор-текст, это не витрина)
  ok((await pg.locator('.ck-reward').count()) === 0, 'pure: витрины наград нет');
  // Первый визит показывает тьюториал поверх оверлея — реальный юзер тапнет «Поехали!»
  const tutGo = pg.locator('#ck-tut-go');
  if (await tutGo.isVisible().catch(() => false)) { await tutGo.click(); await pg.waitForTimeout(300); }
  ok(((await pg.locator('#ck-bt-energy-n').textContent()) || '').includes('1'), 'бусты: новичку доступна одна Энергия');
  ok(((await pg.locator('#ck-bt-turbo-n').textContent()) || '').includes('стрик 3 дня'), 'бусты: Турбо закрыто до стрика 3 дня');
  ok(await pg.locator('#ck-bt-turbo').isDisabled(), 'бусты: закрытое Турбо нельзя активировать');
  // «Дом Василия» и связанные мини-игры больше не входят в игровой бандл.
  await pg.locator('.ck-nav__b[data-tab="hub"]').click();
  await pg.waitForTimeout(400);
  ok((await pg.locator('.ck-row2[data-goto="home"]').count()) === 0, 'pure: раздел Дом удалён');
  ok(await pg.evaluate(() => typeof window.catPetOpen === 'undefined'), 'pure: модуль Дома не загружен');
  ok(await pg.evaluate(() => !Array.from(document.scripts).some(s => /cat(?:pet|feed|game)\.js/.test(s.src))), 'pure: скрипты Дома и мини-игр не загружены');
  const tapPerf = await pg.evaluate(async () => {
    window.ckSetTab('cat');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const prof = document.querySelector('#ck-prof');
    const cat = document.querySelector('#ck-catwrap');
    let mutations = 0;
    const observer = new MutationObserver((records) => { mutations += records.length; });
    observer.observe(prof, { childList: true, characterData: true, subtree: true });
    const rect = cat.getBoundingClientRect();
    const started = performance.now();
    for (let i = 0; i < 60; i++) {
      const pointerId = i + 1;
      const common = { bubbles: true, pointerId, pointerType: 'touch', clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
      cat.dispatchEvent(new PointerEvent('pointerdown', common));
      cat.dispatchEvent(new PointerEvent('pointerup', common));
    }
    await new Promise(resolve => setTimeout(resolve, 120));
    observer.disconnect();
    return { mutations, duration: performance.now() - started };
  });
  ok(tapPerf.mutations <= 3, `perf: серия тапов не перестраивает HUD (${tapPerf.mutations} мутаций)`);
  ok(tapPerf.duration < 500, `perf: 60 тапов обрабатываются без длинной блокировки (${Math.round(tapPerf.duration)} мс)`);
  await pg.close();

  // ── 2. index.html: регресс (магазин + игра с коммерцией) ──
  pg = await br.newPage();
  pg.on('pageerror', (e) => errors.push('index.html: ' + e.message));
  await pg.goto(base + '/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pg.waitForTimeout(2500);
  await pg.evaluate(() => window.catClickOpen());
  await pg.waitForSelector('.ck-ov.on', { timeout: 15000 });
  ok(await pg.locator('.ck-nav__b[data-tab="tasks"]').isVisible(), 'регресс: вкладка Призы на месте');
  ok(((await pg.locator('.ck-nav__b[data-tab="tasks"]').textContent()) || '').includes('Призы'), 'регресс: вкладка называется «Призы»');
  ok(await pg.locator('#ck-x').isVisible(), 'регресс: крестик на месте');
  const indexTutGo = pg.locator('#ck-tut-go');
  if (await indexTutGo.isVisible().catch(() => false)) { await indexTutGo.click(); await pg.waitForTimeout(300); }
  await pg.locator('.ck-nav__b[data-tab="hub"]').click();
  await pg.waitForTimeout(300);
  ok((await pg.locator('.ck-row2[data-goto="home"]').count()) === 0, 'регресс: раздел Дом удалён');
  ok(await pg.evaluate(() => typeof window.catPetOpen === 'undefined'), 'регресс: модуль Дома не загружен');
  await pg.close();

  // ── 3. Явная связка VK ↔ Telegram: карточка и следующий шаг ──
  pg = await br.newPage({ viewport: { width: 390, height: 844 } });
  pg.on('pageerror', (e) => errors.push('account-link: ' + e.message));
  await pg.route('**/api/account-link/status', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ currentPlatform: 'vk', phoneVerified: false, linked: false, platforms: { vk: false, tg: false } }) }));
  await pg.route('**/api/clicker/tasks-overview', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ done: [], purchaseTasks: [], purchaseClaims: [], phoneVerified: false, accountLink: { currentPlatform: 'vk', phoneVerified: false, linked: false, platforms: { vk: false, tg: false } } }) }));
  await pg.route('**/api/clicker/tasks', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) }));
  await pg.route('**/api/clicker/purchase-tasks', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [], claims: [], phoneVerified: false }) }));
  await pg.route('**/api/clicker/achievements', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ achievements: [] }) }));
  await pg.goto(base + '/game.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pg.waitForSelector('.ck-ov.on', { timeout: 15000 });
  await pg.evaluate(() => {
    document.querySelector('.ck-tut')?.remove();
    localStorage.setItem('ck_tour3_tasks', 'done');
  });
  await pg.evaluate(() => { App.platform = 'vk'; App.isAuthed = () => true; window.ckSetTab('tasks'); });
  await pg.waitForSelector('.ck-account', { timeout: 10000 });
  await pg.waitForTimeout(500);
  ok(((await pg.locator('.ck-account__title').textContent()) || '').includes('Один аккаунт в VK и Telegram'), 'связка: назначение карточки понятно');
  ok(((await pg.locator('.ck-account__copy').textContent()) || '').includes('один и тот же номер'), 'связка: объяснены оба шага');
  ok(((await pg.locator('#ck-account-link-action').textContent()) || '').includes('Подтвердить номер в VK'), 'связка: показано конкретное следующее действие');
  ok((await pg.locator('.ck-account__step').count()) === 2, 'связка: статусы VK и Telegram разделены');
  if (process.env.SMOKE_SCREENSHOT) await pg.screenshot({ path: process.env.SMOKE_SCREENSHOT, fullPage: true });
  await pg.close();

  await br.close();
  srv.close();
  if (errors.length) { console.error('PAGEERRORS:', errors); process.exit(1); }
  if (fails.length) { console.error('FAILED:', fails); process.exit(1); }
  console.log('SMOKE OK');
})().catch((e) => { console.error(e); process.exit(1); });

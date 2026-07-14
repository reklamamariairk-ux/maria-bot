/* Смоук game.html (pure) + регресс index.html (гость). Запуск: node scripts/game-page-smoke.js */
/* Зависимость не в package.json (не тащим в прод-образ): перед запуском `npm i --no-save playwright` + `npx playwright install chromium`. */
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
  // Дом кота: виджет «До подарка» снова виден (game-first: вехи заботы — витрина призов)
  await pg.locator('.ck-nav__b[data-tab="home"]').click();
  await pg.waitForTimeout(1500);
  ok(await pg.locator('#pet-gift').isVisible().catch(() => false), 'pure: #pet-gift виден');
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
  await pg.close();

  await br.close();
  srv.close();
  if (errors.length) { console.error('PAGEERRORS:', errors); process.exit(1); }
  if (fails.length) { console.error('FAILED:', fails); process.exit(1); }
  console.log('SMOKE OK');
})().catch((e) => { console.error(e); process.exit(1); });

const { chromium } = require('playwright');

(async () => {
  const base = process.argv[2] || 'https://bot-stage.145-223-121-47.sslip.io';
  const browser = await chromium.launch();
  const errors = [];

  async function checkMode(label, url) {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
    // Смоук гоняет guest и vk с ФЕЙКОВОЙ подписью (sign=fake) — 401 от authed-эндпоинтов
    // и производный лог профиля ОЖИДАЕМЫ, тест про JS-краши, а не про авторизацию.
    const expectedNoise = [
      /Failed to load resource: the server responded with a status of 40[13]/,
      /\[profile\] load: .*fetch \/api\/me failed/,
    ];
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      if (expectedNoise.some((re) => re.test(text))) return;
      errors.push(`[${label}] console: ${text.slice(0,200)}`);
    });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => errors.push(`[${label}] goto: ${e.message}`));
    await page.waitForTimeout(2500);
    const platform = await page.evaluate(() => window.App?.platform).catch(() => 'NO_APP');
    const hasNav = await page.evaluate(() => Boolean(document.querySelector('.bnav'))).catch(() => false);
    for (const tab of ['menu', 'club', 'profile', 'home']) {
      await page.evaluate((t) => window.switchTab?.(t), tab).catch(() => {});
      await page.waitForTimeout(700);
    }
    await page.screenshot({ path: `scripts/_vk_smoke_${label}.png` });
    console.log(`[${label}] App.platform=${platform} bnav=${hasNav}`);
    await ctx.close();
  }

  await checkMode('guest', base + '/');
  await checkMode('vk', base + '/?vk_app_id=123456&vk_user_id=11223344&vk_ts=1&sign=fake');

  console.log(errors.length ? '\n❌ JS-ошибки:\n' + errors.join('\n') : '\n✅ Без JS-ошибок');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();

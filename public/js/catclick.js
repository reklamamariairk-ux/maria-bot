/* ── «Котик Комбат» — кликер (Hamster Kombat-стиль), усиленная версия ──────────
 * Тап (комбо+монетопад, турбо ×5), энергия, апгрейды, бизнесы (пассив+офлайн),
 * бусты (🚀 турбо / ⚡ полная энергия, 6/день), ежедневная награда (стрик),
 * лидерборд. Сервер /api/clicker* для авторизованных, localStorage у гостей.
 * ───────────────────────────────────────────────────────────────────────────── */
(function () {
  // Диагностика (startapp=debug / 7 тапов по бейджу уровня) — копим последние ошибки страницы.
  const ckDiagErrors = [];
  window.addEventListener('error', (e) => { if (ckDiagErrors.length < 5) ckDiagErrors.push(String((e && e.message) || e)); });
  const A = (s) => `/assets/images/cat/${s}?v=25`;  // v25: анатомия — 4 лапы у всех (реген 2/6/8/10/14/15/17/18), кулон вместо «М»-медальона
  const LS = 'maria_click_v2';
  const REGEN = 0.25, TAP_COST = 2, PASSIVE_CAP_H = 3, TURBO_MULT = 5, TURBO_SEC = 20, DAILY_BOOSTS = 6;
  // ⚠️ Зеркало CARDS/CARD_CATS из src/clicker.ts — менять синхронно (+ cardIcon по id).
  const CARD_CATS = [{ id: 'prod', name: 'Производство' }, { id: 'mkt', name: 'Маркетинг' }, { id: 'staff', name: 'Персонал' }, { id: 'net', name: 'Сеть' }];
  const SQUADS = [{ id: 'choco', name: 'Шоколадные' }, { id: 'vanilla', name: 'Ванильные' }, { id: 'caramel', name: 'Карамельные' }, { id: 'berry', name: 'Ягодные' }];
  const SQUAD_CREATE_COST = 25000; // зеркало src/clicker.ts
  const CARDS = [
    { id: 'bakery', name: 'Пекарня', cat: 'prod', basePrice: 300, baseProfit: 30 },
    { id: 'coffee', name: 'Кофемашина', cat: 'prod', basePrice: 900, baseProfit: 85 },
    { id: 'oven', name: 'Конвекционная печь', cat: 'prod', basePrice: 2600, baseProfit: 210, req: 3 },
    { id: 'cakefactory', name: 'Цех тортов', cat: 'prod', basePrice: 7000, baseProfit: 520, req: 4 },
    { id: 'ads', name: 'Наружная реклама', cat: 'mkt', basePrice: 1500, baseProfit: 120 },
    { id: 'smm', name: 'SMM-специалист', cat: 'mkt', basePrice: 4200, baseProfit: 320, req: 3 },
    { id: 'tasting', name: 'Дегустации', cat: 'mkt', basePrice: 12000, baseProfit: 780, req: 5 },
    { id: 'loyalty', name: 'Карта лояльности', cat: 'mkt', basePrice: 30000, baseProfit: 1900, req: 7 },
    { id: 'barista', name: 'Бариста', cat: 'staff', basePrice: 1100, baseProfit: 95 },
    { id: 'baker', name: 'Пекарь', cat: 'staff', basePrice: 3400, baseProfit: 270, req: 3 },
    { id: 'confectioner', name: 'Кондитер', cat: 'staff', basePrice: 9000, baseProfit: 640, req: 5 },
    { id: 'manager', name: 'Управляющий', cat: 'staff', basePrice: 24000, baseProfit: 1550, req: 6 },
    { id: 'delivery', name: 'Доставка', cat: 'net', basePrice: 2500, baseProfit: 200 },
    { id: 'newshop', name: 'Новая точка', cat: 'net', basePrice: 8000, baseProfit: 560, req: 4 },
    { id: 'franchise', name: 'Франшиза «Мария»', cat: 'net', basePrice: 20000, baseProfit: 1500, req: 6 },
    { id: 'region', name: 'Выход в регион', cat: 'net', basePrice: 38000, baseProfit: 2300, req: 8 },
  ];
  const LEAGUES = [
    // cat = картинка кота на уровне (эволюция «глоу-ап»: тощий уличный → кот-император)
    // 19 уровней «Кондитерская карьера Василия» (арт-комплект 08.07.2026, спека
    // docs/superpowers/specs/2026-07-08-vasily-art-set-design.md). Кот ОДИН и тот же,
    // прогрессия — одеждой/аксессуарами/фоном. Пороги need меняются только вперёд;
    // серверный храповик сохраняет уже достигнутый уровень.
    // ⚠️ Лестница продублирована в src/clicker.ts (name) — менять синхронно.
    // Пороги растянуты 15.07 и дополнительно 25.08 для цели 6–8 недель — синхронно с src/clicker.ts.
    // Костюмы кота (cat) НЕ меняются. Уровень игрока не откатывается (храповик max_level на сервере).
    { level: 1,  name: 'Котёнок-стажёр',     need: 0,        cat: 'vasily-stage1.webp' },
    { level: 2,  name: 'Помощник пекаря',    need: 2000,     cat: 'vasily-stage2.webp' },
    { level: 3,  name: 'Ученик',             need: 6000,     cat: 'vasily-stage3.webp' },
    { level: 4,  name: 'Тестомес',           need: 15000,    cat: 'vasily-stage4.webp' },
    { level: 5,  name: 'Пекарь',             need: 35000,    cat: 'vasily-stage5.webp' },
    { level: 6,  name: 'Мастер круассанов',  need: 75000,    cat: 'vasily-stage6.webp' },
    { level: 7,  name: 'Юный кондитер',      need: 150000,   cat: 'vasily-stage7.webp' },
    { level: 8,  name: 'Тортодел',           need: 320000,   cat: 'vasily-stage8.webp' },
    { level: 9,  name: 'Шоколатье',          need: 650000,   cat: 'vasily-stage9.webp' },
    { level: 10, name: 'Су-шеф',             need: 1300000,  cat: 'vasily-stage10.webp' },
    { level: 11, name: 'Шеф-кондитер',       need: 3000000,   cat: 'vasily-stage11.webp' },
    { level: 12, name: 'Художник десертов',  need: 7000000,   cat: 'vasily-stage12.webp' },
    { level: 13, name: 'Управляющий',        need: 15000000,  cat: 'vasily-stage13.webp' },
    { level: 14, name: 'Владелец кафе',      need: 30000000,  cat: 'vasily-stage14.webp' },
    { level: 15, name: 'Ресторатор',         need: 55000000,  cat: 'vasily-stage15.webp' },
    { level: 16, name: 'Магнат выпечки',     need: 100000000, cat: 'vasily-stage16.webp' },
    { level: 17, name: 'Легенда',            need: 180000000, cat: 'vasily-stage17.webp' },
    { level: 18, name: 'Король тортов',      need: 300000000, cat: 'vasily-stage18.webp' },
    { level: 19, name: 'Император выпечки',  need: 500000000, cat: 'vasily-stage19.webp' },
  ];
  const BUSINESS_MAX_LEVEL = 20;
  const REF_REFERRER = 30000, REF_INVITEE = 2500, BOT = 'mariatortik_bot'; // зеркало src/clicker.ts
  // Соцссылки «Марии» — зеркало SOCIAL в src/clicker.ts (менять синхронно). Пустая = задание скрыто.
  const SOCIAL = { review: 'https://yandex.ru/maps/?text=Мария кондитерская Иркутск', vk: '', tg: 'https://t.me/mariatortik_bot' };
  // Режим «чистой игры» (game.html): вся коммерция скрыта. См. спеку 2026-07-13.
  const PURE = document.documentElement.classList.contains('ck-pure');
  const TASKS = [
    { id: 'site', name: 'Заглянуть на сайт «Мария»', icon: '🌐', reward: 1500, type: 'link', link: 'https://www.maria-irk.ru/' },
    { id: 'review', name: 'Оставить отзыв о «Марии»', icon: '⭐', reward: 5000, type: 'link', link: SOCIAL.review },
    { id: 'vk', name: 'Подписаться на ВК «Мария»', icon: '👍', reward: 4000, type: 'link', link: SOCIAL.vk },
    { id: 'invite1', name: 'Пригласить друга', icon: '👥', reward: 10000, type: 'ref', target: 1 },
    { id: 'level3', name: 'Дойти до 3 уровня', icon: '⭐', reward: 3000, type: 'level', target: 3 },
    { id: 'balance10', name: 'Накопить 10 000 монет', icon: '💰', reward: 2500, type: 'balance', target: 10000 },
    { id: 'streak3', name: 'Заходить 3 дня подряд', icon: '🔥', reward: 4000, type: 'streak', target: 3 },
  ].filter(t => t.type !== 'link' || t.link);
  const leagueFor = (t) => { let l = LEAGUES[0]; for (const x of LEAGUES) if (t >= x.need) l = x; return l; };
  const leagueForLevel = (level) => LEAGUES[Math.min(LEAGUES.length, Math.max(1, Math.floor(Number(level) || 1))) - 1];
  const nextNeedForLevel = (level) => { const n = LEAGUES.find(x => x.level > level); return n ? n.need : null; };
  const comboHitsIncludingMaxed = (cards, recorded, levels) => {
    const hits = new Set(recorded || []);
    return cards.filter(id => hits.has(id) || Number(levels[id] || 0) >= BUSINESS_MAX_LEVEL);
  };
  // Размер-прогрессия по уровням ОТМЕНЕНА (решение юзера 08.07: разница читалась
  // слишком резко). Кот всегда крупный, эволюция — обликом (19 образов) и фоном
  // (тиры). Жёсткая высота вместо contain-бокса: широкие кадры (шар/дон) не проседают.
  function applyCatSize(catEl) {
    catEl.style.height = '102%';
    catEl.style.width = 'auto';
    catEl.style.maxWidth = '100%';  // страховка для очень широких кадров на узких экранах
    catEl.style.maxHeight = 'none';
  }
  // ── Ретрай при сетевом сбое («кот не прогружается») — до 2 повторов с бэкофом 1с/3с ──
  function attachCatRetry(el) {
    if (el._retryBound) return; el._retryBound = true;
    let attempts = 0, curSrc = '';
    el.addEventListener('load', () => { attempts = 0; });
    el.addEventListener('error', () => {
      if (el.src !== curSrc) { curSrc = el.src; attempts = 0; }
      if (attempts >= 2) return;
      attempts++;
      const failedSrc = el.src;
      setTimeout(() => { if (el.src === failedSrc) { el.removeAttribute('src'); el.src = failedSrc; } }, attempts === 1 ? 1000 : 3000); // сброс атрибута — иначе одинаковый src не перезапускает загрузку
    });
  }
  const fmt = (n) => Math.floor(n).toLocaleString('ru-RU');
  const irkToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  // Русские склонения: plu(2,'монета','монеты','монет') → «монеты»
  const plu = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return (a > 10 && a < 20) ? many : (b > 1 && b < 5) ? few : (b === 1) ? one : many; };
  // Сколько осталось до нового дня по Иркутску (UTC+8) — «через 5 ч 12 мин»
  const untilNewDay = () => {
    const secLeft = 86400 - Math.floor((Date.now() / 1000 + 8 * 3600) % 86400);
    const totalMinutes = Math.max(1, Math.ceil(secLeft / 60));
    const h = Math.floor(totalMinutes / 60), m = totalMinutes % 60;
    return h > 0 ? `через ${h} ч${m ? ` ${m} мин` : ''}` : `через ${m} мин`;
  };
  const priceMultitap = (l) => Math.round(200 * Math.pow(2, l));
  const priceEnergy = (l) => Math.round(300 * Math.pow(2, l));
  const energyMaxFor = (l) => 1000 + 500 * l;
  const perTapFor = (l) => 1 + l;
  const CARD_PRICE_GROWTH = 1.45, CARD_PROFIT_GROWTH = 1.25; // зеркало src/clicker.ts
  const cardPrice = (c, l) => Math.round(c.basePrice * Math.pow(CARD_PRICE_GROWTH, l));
  const cardProfit = (c, l) => l <= 0 ? 0 : Math.round(c.baseProfit * (Math.pow(CARD_PROFIT_GROWTH, l) - 1) / (CARD_PROFIT_GROWTH - 1));
  const dailyReward = (streak) => 250 * Math.min(Math.max(1, streak), 10);

  // ── Иконки: единый набор (золото/крем) + брендовая монета ─────────────────────
  const COIN_SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    <radialGradient id="ckCoinGr" cx="36%" cy="30%" r="82%">
      <stop offset="0" stop-color="#F2FFCE"/><stop offset=".5" stop-color="#C0FF33"/><stop offset="1" stop-color="#8DBF20"/>
    </radialGradient>
    <symbol id="ckSymCoin" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="11" fill="url(#ckCoinGr)" stroke="#5E7B1E" stroke-width="1"/>
      <circle cx="12" cy="12" r="8.4" fill="none" stroke="#EAFFB8" stroke-width="1" opacity=".5"/>
      <path d="M8 16.2V7.8l4 4.7 4-4.7v8.4" fill="none" stroke="#16210A" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
    </symbol></defs></svg>`;
  const COIN = (s) => `<svg class="ck-coin-i" width="${s}" height="${s}" viewBox="0 0 24 24"><use href="#ckSymCoin"/></svg>`;
  const SVG = (p, s) => `<svg class="ck-i" width="${s || 24}" height="${s || 24}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const ICON = {
    home: (s) => SVG('<path d="M4 11.2 12 4.5l8 6.7"/><path d="M6 9.8V19h12V9.8"/><path d="M10 19v-4.6h4V19"/>', s),
    cupcake: (s) => SVG('<path d="M5 11h14l-1.4 8.2a1 1 0 0 1-1 .8H7.4a1 1 0 0 1-1-.8L5 11Z"/><path d="M7.2 11a3 3 0 0 1 .2-5.7A3.2 3.2 0 0 1 12 3.4a3.2 3.2 0 0 1 4.6 1.9 3 3 0 0 1-.2 5.7"/>', s),
    coffee: (s) => SVG('<path d="M4 9h12v4.5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9Z"/><path d="M16 10.2h2.2a2.2 2.2 0 0 1 0 4.4H16"/><path d="M7.5 5.2c.5.5.5 1.1 0 1.8M10.5 5.2c.5.5.5 1.1 0 1.8"/>', s),
    scooter: (s) => SVG('<circle cx="6" cy="17" r="2.3"/><circle cx="18" cy="17" r="2.3"/><path d="M8.3 17h7.4M18 14.7V8.5h-2.4M3.5 8h2.7l3.3 7.2"/><path d="M12.5 8H16l1.6 6.2"/>', s),
    cake: (s) => SVG('<path d="M4 20h16M5.5 20v-6.5h13V20M6.5 13.5c0-1.8 11-1.8 11 0M12 4v3.2M9.6 5.2v2M14.4 5.2v2"/>', s),
    shop: (s) => SVG('<path d="M4.5 9.5 5.5 5h13l1 4.5M5 9.5V19h14V9.5M9.5 19v-4.5h5V19"/><path d="M4.5 9.5a1.9 1.9 0 0 0 3.7 0 1.9 1.9 0 0 0 3.8 0 1.9 1.9 0 0 0 3.8 0 1.9 1.9 0 0 0 3.7 0"/>', s),
    rocket: (s) => SVG('<path d="M12 3.2c2.9 1.6 4.8 5 4.8 9L14.4 14.6h-4.8L7.2 12.2c0-4 1.9-7.4 4.8-9Z"/><circle cx="12" cy="9.6" r="1.5"/><path d="M9.6 14.6c-1.6.4-2.6 2.3-2.6 4.2 1.6 0 3.4-.7 4-2.2M14.4 14.6c1.6.4 2.6 2.3 2.6 4.2-1.6 0-3.4-.7-4-2.2"/>', s),
    bolt: (s) => SVG('<path d="M13 2.5 5.5 13H10l-1 8.5L18 11h-5l1-8.5Z"/>', s),
    paw: (s) => SVG('<ellipse cx="12" cy="15.6" rx="4.2" ry="3.3"/><ellipse cx="6.6" cy="11.2" rx="1.7" ry="2"/><ellipse cx="17.4" cy="11.2" rx="1.7" ry="2"/><ellipse cx="9.6" cy="7.6" rx="1.6" ry="1.9"/><ellipse cx="14.4" cy="7.6" rx="1.6" ry="1.9"/>', s),
    list: (s) => SVG('<rect x="5" y="4" width="14" height="17" rx="2.2"/><path d="M8.2 4v-.4A1.6 1.6 0 0 1 9.8 2h4.4a1.6 1.6 0 0 1 1.6 1.6V4M8.5 11l1.4 1.4 2.8-2.8M8.5 16.4l1.4 1.4 2.8-2.8"/>', s),
    trophy: (s) => SVG('<path d="M7 4h10v3.5a5 5 0 0 1-10 0V4Z"/><path d="M7 5.8H4.6a2.4 2.4 0 0 0 2.5 3M17 5.8h2.4a2.4 2.4 0 0 1-2.5 3M10.2 13h3.6l-.5 3.4h-2.6L10.2 13ZM8.2 21h7.6M9.6 17h4.8"/>', s),
    globe: (s) => SVG('<circle cx="12" cy="12" r="8.4"/><path d="M3.6 12h16.8M12 3.6c2.3 2.2 2.3 14.6 0 16.8M12 3.6c-2.3 2.2-2.3 14.6 0 16.8"/>', s),
    users: (s) => SVG('<circle cx="9" cy="8" r="2.9"/><path d="M3.6 19a5.4 5.4 0 0 1 10.8 0M16 5.3a3 3 0 0 1 0 5.9M16.6 14.4a5.4 5.4 0 0 1 3.8 4.6"/>', s),
    star: (s) => SVG('<path d="m12 3.2 2.6 5.2 5.8.9-4.2 4 1 5.7L12 16.6 6 18.2l1-5.7-4.2-4 5.8-.9L12 3.2Z"/>', s),
    wallet: (s) => SVG('<path d="M4 7.2a2 2 0 0 1 2-2h10.5v3.6M4 7.2V17a2 2 0 0 0 2 2h13V8.8H6a2 2 0 0 1-2-1.6Z"/><circle cx="16.5" cy="13.9" r="1.2" fill="currentColor" stroke="none"/>', s),
    fire: (s) => SVG('<path d="M12 3c1 2.9-1.4 4.4-1.4 6.8A2.4 2.4 0 0 0 13 11.6c.5-1.4 0-2 .5-2.9 1.9 1.5 2.9 3.7 2.9 5.8a6.3 6.3 0 0 1-12.6.5C3.2 11.2 8 9.8 8 6c1.4 1 1.9 2.4 1.9 3.8C10.8 8.4 11.3 6 12 3Z"/>', s),
    gift: (s) => SVG('<rect x="4.2" y="9.2" width="15.6" height="10.6" rx="1.6"/><path d="M4.2 12.4h15.6M12 9.2v10.6M12 9.2C10.2 9.2 8 8.7 8 6.6 8 5.4 8.9 5 9.8 5.3 11.2 5.8 12 9.2 12 9.2s.8-3.4 2.2-3.9c.9-.3 1.8.1 1.8 1.3 0 2.1-2.2 2.6-4 2.6Z"/>', s),
    medal: (s) => SVG('<circle cx="12" cy="14" r="5"/><path d="M8.5 9 6.5 3.5M15.5 9l2-5.5M10.3 14l1.7-1.6 1.7 1.6-.6 2.3h-2.2l-.6-2.3Z"/>', s),
    send: (s) => SVG('<path d="M20.5 3.5 9.8 14.2M20.5 3.5 13.7 20.5l-3.9-6.3-6.3-3.9 17-6.8Z"/>', s),
    tap: (s) => SVG('<path d="M9 11V5.5a1.7 1.7 0 0 1 3.4 0V11M12.4 11V9.4a1.5 1.5 0 0 1 3 0V11M15.4 11v-.6a1.5 1.5 0 0 1 3 0V15a5 5 0 0 1-5 5h-1.6a4 4 0 0 1-3-1.4L6 15.4a1.6 1.6 0 0 1 2.4-2L9 14"/>', s),
    battery: (s) => SVG('<rect x="3" y="8" width="15" height="8" rx="2"/><path d="M20 11v2"/><path d="M9.5 9.5 7.5 12.4h2.6L8 15"/>', s),
    chest: (s) => SVG('<path d="M4 10.5 6 6h12l2 4.5M4 10.5V19h16v-8.5M4 10.5h16M10 10.5v3h4v-3"/>', s),
    game: (s) => SVG('<rect x="2.5" y="8.5" width="19" height="9" rx="4.2"/><path d="M7 11.9v3M5.5 13.4h3M15.4 12.9h.01M17.6 14.1h.01M16.5 11.8h.01"/>', s),
    quiz: (s) => SVG('<path d="M4 5.5h16A1.5 1.5 0 0 1 21.5 7v8a1.5 1.5 0 0 1-1.5 1.5H9l-4 3v-3H4A1.5 1.5 0 0 1 2.5 15V7A1.5 1.5 0 0 1 4 5.5Z"/><path d="M9.9 9.6a2.2 2.2 0 0 1 3.3 1.8c0 1.4-1.9 1.6-1.9 2.9M11.3 16.1h.01"/>', s),
    gem: (s) => SVG('<path d="M6 3h12l3 5-9 13L3 8l3-5Z"/><path d="M3 8h18M9 3 7.5 8 12 21M15 3l1.5 5L12 21"/>', s),
    rain: (s) => SVG('<path d="M7.5 13.5A3.5 3.5 0 0 1 8 6.6a5 5 0 0 1 9.4 1.3A3.3 3.3 0 0 1 16.8 13.5M8 17l-1 2.5M12 17l-1 2.5M16 17l-1 2.5"/>', s),
    oven: (s) => SVG('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M7 6.6h.01M10 6.6h.01M7.5 13a4.5 4.5 0 0 1 9 0"/>', s),
    megaphone: (s) => SVG('<path d="M4 10v4l10 4.5V5.5L4 10ZM4 10H3.2A1.2 1.2 0 0 0 2 11.2v1.6A1.2 1.2 0 0 0 3.2 14H4M14 8.5a3.5 3.5 0 0 1 0 7M7 15v3.5"/>', s),
    chef: (s) => SVG('<path d="M7 13.5h10V19a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-5.5ZM7 13.5a3.6 3.6 0 0 1-.8-7A3.4 3.4 0 0 1 12 4.6a3.4 3.4 0 0 1 5.8 1.9 3.6 3.6 0 0 1-.8 7M7 16.5h10"/>', s),
    lock: (s) => SVG('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', s),
    dove: (s) => SVG('<path d="M21 7c-1.2.8-2.2.9-3 .4-1.6-1-4-.6-5.5 1.2C11 10.4 8.6 11.4 5 11.4c1.3 1.8 3.6 2.7 6 2.2-.9 2.2-2.7 3.6-5 4 2.3 1.4 5.5 1.4 8-.6 2-1.6 3-4 3-6.6 0-.9.4-1.7 1.2-2.2M8.5 18 7 21M12.5 17.5 12 21"/>', s),
  };
  const cardIcon = (id, s = 26) => ({ bakery: ICON.cupcake, coffee: ICON.coffee, oven: ICON.oven, cakefactory: ICON.cake, ads: ICON.megaphone, smm: ICON.send, tasting: ICON.star, loyalty: ICON.wallet, barista: ICON.coffee, baker: ICON.chef, confectioner: ICON.cupcake, manager: ICON.users, delivery: ICON.scooter, newshop: ICON.shop, franchise: ICON.gift, region: ICON.globe }[id] || ICON.cupcake)(s);
  // арт-плитка бизнеса: иллюстрация-PNG если есть (BIZ_ART_V>0), иначе SVG-иконка
  const BIZ_ART_V = 6; // голуби-помощники v6 — единый нейроарт-набор (Nano Banana, бренд-фартук)
  const cardArt = (id) => BIZ_ART_V ? `<img src="/assets/images/biz/${id}.png?v=${BIZ_ART_V}" alt="" loading="lazy">` : cardIcon(id, 30);
  const taskIcon = (id) => ({ site: ICON.globe, review: ICON.star, vk: ICON.users, tg: ICON.send, invite1: ICON.users, level3: ICON.star, balance10: ICON.wallet, streak3: ICON.fire }[id] || ICON.star)(26);

  // ── Бонусы дня (зеркало src/clicker.ts — алгоритм/слова/морзе менять синхронно) ──
  const COMBO_REWARD = 12000, CIPHER_REWARD = 3000;
  const CASE_COST = 100000; // цена открытия платного кейса — зеркало src/lootbox.ts::CASE_COST
  const CIPHER_WORDS = ['МАРИЯ', 'ТОРТ', 'КОТИК', 'КРЕМ', 'ЭКЛЕР', 'МУСС', 'БИСКВИТ', 'ВАНИЛЬ', 'ШОКОЛАД', 'КАРАМЕЛЬ', 'ДЕСЕРТ', 'ПЕКАРНЯ'];
  const MORSE = { А: '.-', Б: '-...', В: '.--', Г: '--.', Д: '-..', Е: '.', Ж: '...-', З: '--..', И: '..', Й: '.---', К: '-.-', Л: '.-..', М: '--', Н: '-.', О: '---', П: '.--.', Р: '.-.', С: '...', Т: '-', У: '..-', Ф: '..-.', Х: '....', Ц: '-.-.', Ч: '---.', Ш: '----', Щ: '--.-', Ь: '-..-', Ы: '-.--', Э: '..-..', Ю: '..--', Я: '.-.-' };
  function dateSeed(day, salt) { let h = 2166136261 >>> 0; const s = day + salt; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
  function todaysCombo(day) { let h = dateSeed(day, 'combo'); const pool2 = CARDS.map(c => c.id); const pick = []; for (let i = 0; i < 3; i++) { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; pick.push(pool2.splice(h % pool2.length, 1)[0]); } return pick; }

  // ── Хаб «Игры»: детские квизы + казуальные. Контент тут (гость играет офлайн) ──
  // {q: вопрос, a: верный ответ, w: [неверные]}. Движок строит 4 варианта и тасует.
  const QUIZ_KIDS = [
    { q: 'Сколько ног у паука?', a: '8', w: ['6', '4', '10'] },
    { q: 'Какое животное даёт нам молоко?', a: 'Корова', w: ['Курица', 'Свинья', 'Лошадь'] },
    { q: 'Какого цвета спелый банан?', a: 'Жёлтый', w: ['Синий', 'Красный', 'Зелёный'] },
    { q: 'Где живут рыбы?', a: 'В воде', w: ['На дереве', 'В небе', 'В норе'] },
    { q: 'Сколько дней в неделе?', a: '7', w: ['5', '10', '12'] },
    { q: 'Как называется наша планета?', a: 'Земля', w: ['Марс', 'Луна', 'Солнце'] },
    { q: 'Кто делает мёд?', a: 'Пчела', w: ['Муравей', 'Бабочка', 'Комар'] },
    { q: 'Какое время года самое холодное?', a: 'Зима', w: ['Лето', 'Весна', 'Осень'] },
    { q: 'Что нужно растению, чтобы расти?', a: 'Солнце и вода', w: ['Конфеты', 'Снег', 'Темнота'] },
    { q: 'Сколько цветов у радуги?', a: '7', w: ['5', '3', '10'] },
    { q: 'Какой первый месяц года?', a: 'Январь', w: ['Декабрь', 'Март', 'Июнь'] },
    { q: 'Кто из них умеет летать?', a: 'Орёл', w: ['Кит', 'Слон', 'Черепаха'] },
    { q: 'Что делают из молока?', a: 'Сыр', w: ['Хлеб', 'Сок', 'Бумагу'] },
    { q: 'Какой формы колесо?', a: 'Круглое', w: ['Квадратное', 'Треугольное', 'Как звезда'] },
    { q: 'Сколько пальцев на одной руке?', a: '5', w: ['4', '6', '10'] },
    { q: 'Кто говорит «мяу»?', a: 'Кошка', w: ['Собака', 'Корова', 'Утка'] },
    { q: 'Что светит на небе ночью?', a: 'Луна', w: ['Солнце', 'Радуга', 'Облако'] },
    { q: 'Самое большое животное на Земле?', a: 'Синий кит', w: ['Слон', 'Жираф', 'Медведь'] },
    { q: 'Из чего пекут хлеб?', a: 'Из муки', w: ['Из песка', 'Из травы', 'Из камней'] },
    { q: 'Сколько будет 2 + 2?', a: '4', w: ['3', '5', '22'] },
    { q: 'Какого цвета трава летом?', a: 'Зелёная', w: ['Синяя', 'Розовая', 'Чёрная'] },
    { q: 'Сколько месяцев в году?', a: '12', w: ['7', '10', '24'] },
    { q: 'Кто живёт в улье?', a: 'Пчёлы', w: ['Муравьи', 'Птицы', 'Рыбы'] },
    { q: 'Что падает зимой с неба?', a: 'Снег', w: ['Песок', 'Листья', 'Конфеты'] },
    { q: 'Какое животное самое быстрое на суше?', a: 'Гепард', w: ['Черепаха', 'Улитка', 'Слон'] },
    { q: 'Сколько глаз у человека?', a: '2', w: ['1', '3', '4'] },
    { q: 'Кто из них насекомое?', a: 'Бабочка', w: ['Кошка', 'Воробей', 'Лягушка'] },
    { q: 'Что растёт на дубе?', a: 'Жёлуди', w: ['Яблоки', 'Бананы', 'Шишки'] },
    { q: 'Какой день после понедельника?', a: 'Вторник', w: ['Среда', 'Пятница', 'Воскресенье'] },
    { q: 'Из чего делают масло?', a: 'Из молока', w: ['Из песка', 'Из воды', 'Из камня'] },
    { q: 'Кто плетёт паутину?', a: 'Паук', w: ['Муравей', 'Жук', 'Оса'] },
    { q: 'Какого цвета снег?', a: 'Белый', w: ['Зелёный', 'Синий', 'Красный'] },
    { q: 'Где растут яблоки?', a: 'На дереве', w: ['Под землёй', 'В море', 'На траве'] },
    { q: 'Сколько лап у кошки?', a: '4', w: ['2', '6', '8'] },
    { q: 'Что делает корова?', a: 'Мычит', w: ['Лает', 'Каркает', 'Квакает'] },
    { q: 'Какое время суток самое тёмное?', a: 'Ночь', w: ['Утро', 'День', 'Полдень'] },
    { q: 'Какая птица не умеет летать?', a: 'Пингвин', w: ['Орёл', 'Воробей', 'Голубь'] },
    { q: 'Что нужно, чтобы видеть в темноте?', a: 'Свет', w: ['Вода', 'Холод', 'Шум'] },
    { q: 'Сколько будет 3 + 1?', a: '4', w: ['5', '2', '31'] },
    { q: 'Какого цвета солнце днём?', a: 'Жёлтое', w: ['Синее', 'Чёрное', 'Зелёное'] },
    { q: 'Кто живёт в будке и сторожит дом?', a: 'Собака', w: ['Кошка', 'Корова', 'Коза'] },
    { q: 'Из чего птицы вьют гнездо?', a: 'Из веточек', w: ['Из конфет', 'Из стекла', 'Из железа'] },
  ];
  const QUIZ_RIDDLE = [
    { q: 'Мягкие лапки, а в лапках — царапки. Кто это?', a: 'Кот', w: ['Пёс', 'Заяц', 'Ёж'] },
    { q: 'Голову кивает, по площади гуляет, «гур-гур» воркует. Кто это?', a: 'Голубь', w: ['Ворона', 'Воробей', 'Сорока'] },
    { q: 'Сладкий, пышный, со свечками в день рождения. Что это?', a: 'Торт', w: ['Суп', 'Хлеб', 'Каша'] },
    { q: 'Усатый, полосатый, днём спит, ночью охотится. Кто?', a: 'Кот', w: ['Петух', 'Гусь', 'Конь'] },
    { q: 'Носит письма на лапке, домой дорогу знает. Какая птица?', a: 'Почтовый голубь', w: ['Курица', 'Индюк', 'Пингвин'] },
    { q: 'Белое, холодное, сладкое, тает во рту. Что это?', a: 'Мороженое', w: ['Лёд', 'Снег', 'Мел'] },
    { q: 'Мурлычет, когда доволен, шипит, когда сердит. Кто?', a: 'Кот', w: ['Чайник', 'Змея', 'Ветер'] },
    { q: 'Круглые, шоколадные, тают в руках — что любит котик?', a: 'Конфеты', w: ['Камни', 'Шишки', 'Жёлуди'] },
    { q: 'Воркует на крыше, кружит над городом, любит зёрнышки. Кто?', a: 'Голубь', w: ['Летучая мышь', 'Бабочка', 'Пчела'] },
    { q: 'Хвостик крючком, глазки горят, молочко лакает. Кто?', a: 'Котёнок', w: ['Цыплёнок', 'Поросёнок', 'Утёнок'] },
    { q: 'Воздушное, кремовое, с вишенкой наверху. Что это?', a: 'Пирожное', w: ['Котлета', 'Огурец', 'Сухарь'] },
    { q: 'Два крыла, рук нет, а письмо доставит. Кто?', a: 'Голубь', w: ['Робот', 'Почтальон', 'Самолётик'] },
    { q: 'Зимой и летом одним цветом. Что это?', a: 'Ёлка', w: ['Берёза', 'Куст', 'Трава'] },
    { q: 'Не лает, не кусает, а в дом не пускает. Что это?', a: 'Замок', w: ['Кот', 'Забор', 'Окно'] },
    { q: 'Пёстрая, ест зелёное, даёт белое. Кто?', a: 'Корова', w: ['Коза', 'Кошка', 'Курица'] },
    { q: 'Пушистая шубка, на лапках подушки, а внутри царапки. Кто?', a: 'Кот', w: ['Заяц', 'Белка', 'Лиса'] },
    { q: 'Гнездо на карнизе, крошки клюёт у окна, воркует. Кто?', a: 'Голубь', w: ['Снегирь', 'Дятел', 'Сова'] },
    { q: 'Сладкая, тянется, в фантике живёт. Что это?', a: 'Конфета', w: ['Печенье', 'Сухарь', 'Орех'] },
    { q: 'Круглый бок, румяный, от бабушки укатился. Кто?', a: 'Колобок', w: ['Блин', 'Бублик', 'Пирог'] },
    { q: 'Белый, сладкий, узором на торте лежит. Что это?', a: 'Крем', w: ['Соль', 'Мука', 'Снег'] },
    { q: 'Перья сизые, грудка отливает, символ мира. Кто?', a: 'Голубь', w: ['Орёл', 'Павлин', 'Аист'] },
    { q: 'Тёплый, румяный, из печки, с хрустящей корочкой. Что это?', a: 'Хлеб', w: ['Лёд', 'Камень', 'Мяч'] },
    { q: 'Лапками умывается, на солнышке греется, мышей ловит. Кто?', a: 'Кот', w: ['Ёж', 'Крот', 'Бобр'] },
    { q: 'Воздушный шарик из теста, внутри дырка. Что это?', a: 'Бублик', w: ['Торт', 'Каша', 'Котлета'] },
  ];
  const GAME_META = {
    quiz_kids:   { name: 'Котовикторина', icon: () => ICON.quiz(20) },
    quiz_riddle: { name: 'Загадки',       icon: () => ICON.paw(20) },
    count:       { name: 'Счёт конфет',   icon: () => ICON.cupcake(20) },
  };
  // детерминированная тасовка (LCG от seed) — стабильно в течение дня
  function shuffleSeed(arr, seedNum) { const a = arr.slice(); let h = seedNum >>> 0; for (let i = a.length - 1; i > 0; i--) { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; const j = h % (i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function pickDaily(bank, n, salt) { const ord = shuffleSeed(bank.map((_, i) => i), dateSeed(irkToday(), salt)); return ord.slice(0, n).map(i => bank[i]); }
  function quizQuestions(deck) {
    if (deck === 'count') return genCount(6);
    const bank = deck === 'quiz_riddle' ? QUIZ_RIDDLE : QUIZ_KIDS, n = deck === 'quiz_riddle' ? 4 : 5;
    return pickDaily(bank, n, deck).map((q, i) => ({ q: q.q, opts: shuffleSeed([q.a, ...q.w], dateSeed(irkToday(), deck + 'o' + i)), a: q.a }));
  }
  const CANDY = `<svg width="26" height="26" viewBox="0 0 32 32" style="vertical-align:-.32em;margin:0 1px"><g stroke="#d8487f" stroke-width="1.8" stroke-linejoin="round"><path d="M7 16 1.5 11.5v9z" fill="#ff9ec4"/><path d="M25 16 30.5 11.5v9z" fill="#ff9ec4"/><ellipse cx="16" cy="16" rx="8" ry="7" fill="#ff7aae"/></g><path d="M12.5 13.5c2 1.8 5 1.8 7 0" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round" opacity=".7"/></svg>`;
  function genCount(n) {
    const out = []; let h = dateSeed(irkToday(), 'count');
    for (let i = 0; i < n; i++) {
      h = (Math.imul(h, 1664525) + 1013904223) >>> 0; const x = 1 + (h >>> 3) % 5;
      h = (Math.imul(h, 1664525) + 1013904223) >>> 0; const y = 1 + (h >>> 5) % 5; const sum = x + y;
      const opts = []; [sum, sum + 1, Math.max(1, sum - 1), sum + 2].forEach(v => { if (opts.indexOf(String(v)) < 0) opts.push(String(v)); });
      out.push({ q: CANDY.repeat(x) + ' + ' + CANDY.repeat(y) + ' = ?', opts: shuffleSeed(opts.slice(0, 4), dateSeed(irkToday(), 'co' + i)), a: String(sum) });
    }
    return out;
  }
  function todaysCipher(day) { return CIPHER_WORDS[dateSeed(day, 'cipher') % CIPHER_WORDS.length]; }
  // Анаграмма вместо морзе — зеркало src/clicker.ts::scrambleWord (менять синхронно)
  function scrambleWord(word, day) {
    const letters = word.split('');
    let s = (dateSeed(day, 'scramble') || 1) & 0x7fffffff;
    for (let i = letters.length - 1; i > 0; i--) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const j = s % (i + 1);
      const t = letters[i]; letters[i] = letters[j]; letters[j] = t;
    }
    const out = letters.join('');
    return out === word ? letters.reverse().join('') : out;
  }
  function toMorse(w) { return w.split('').map(c => MORSE[c] || '').join(' '); }
  const cardName = (id) => (CARDS.find(c => c.id === id) || {}).name || id;

  // ── Сезон (неделя) + Достижения (зеркало src/clicker.ts — менять синхронно) ──────
  const weekMonday = () => { const d = Math.floor((Date.now() + 8 * 3600e3) / 86400000); return d - ((d + 3) % 7); };
  const seasonEndsTs = () => (weekMonday() + 7) * 86400000 - 8 * 3600e3;
  // Ивент-зеркало src/clicker.ts (#9): «Выходные ×2» сб/вс по Иркутску. Менять синхронно.
  function ckEventMultAt(ts) { const wd = new Date(ts + 8 * 3600e3).getUTCDay(); return (wd === 6 || wd === 0) ? 2 : 1; }
  function ckEvent() { if (ckEventMultAt(Date.now()) > 1) return { active: true, name: 'Выходные ×2', mult: 2, endsTs: seasonEndsTs() }; return null; }
  const ACHIEVEMENTS = [
    { id: 'ach_taps1k', name: 'Разминка лап', icon: 'tap', reward: 2000, type: 'taps', target: 1000 },
    { id: 'ach_taps10k', name: 'Мастер тапа', icon: 'tap', reward: 10000, type: 'taps', target: 10000 },
    { id: 'ach_earn50k', name: 'Первые полста', icon: 'wallet', reward: 5000, type: 'balance', target: 50000 },
    { id: 'ach_biz5', name: 'Бизнес-империя', icon: 'shop', reward: 8000, type: 'cards', target: 5 },
    { id: 'ach_lvl10', name: 'Высшая лига', icon: 'trophy', reward: 25000, type: 'level', target: 10 },
    { id: 'ach_lvl19', name: 'Император выпечки', icon: 'star', reward: 100000, type: 'level', target: 19 },
    { id: 'ach_streak7', name: 'Неделя верности', icon: 'fire', reward: 7000, type: 'streak', target: 7 },
    { id: 'ach_ref3', name: 'Душа компании', icon: 'users', reward: 15000, type: 'ref', target: 3 },
    { id: 'col_prod', name: 'Цех в сборе', icon: 'shop', reward: 10000, type: 'collect', target: 'prod' },
    { id: 'col_mkt', name: 'Маркетинг в сборе', icon: 'shop', reward: 10000, type: 'collect', target: 'mkt' },
    { id: 'col_staff', name: 'Команда в сборе', icon: 'shop', reward: 10000, type: 'collect', target: 'staff' },
    { id: 'col_net', name: 'Сеть в сборе', icon: 'shop', reward: 10000, type: 'collect', target: 'net' },
    { id: 'col_all', name: 'Бизнес-империя', icon: 'trophy', reward: 60000, type: 'collect', target: 'all' },
  ];
  const achIcon = (key) => ({ tap: ICON.tap, wallet: ICON.wallet, shop: ICON.shop, trophy: ICON.trophy, star: ICON.star, fire: ICON.fire, users: ICON.users, dove: ICON.dove }[key] || ICON.star)(26);
  // Лестница «Награды за прогресс» (зеркало src/clicker.ts MILESTONES — синхронно).
  // points → баллы на карту клуба; perk → купон с условием. Выдача серверная.
  const MILESTONES = [
    { id: 'ms_lvl5', title: 'Уровень 5', cond: { type: 'level', target: 5 }, kind: 'points', points: 200 },
    { id: 'ms_lvl10', title: 'Уровень 10', cond: { type: 'level', target: 10 }, kind: 'points', points: 500 },
    { id: 'ms_lvl13', title: 'Уровень 13', cond: { type: 'level', target: 13 }, kind: 'perk', perkText: 'Промокод −5% (от 500₽)' },
    { id: 'ms_lvl15', title: 'Уровень 15', cond: { type: 'level', target: 15 }, kind: 'points', points: 1000 },
    { id: 'ms_lvl17', title: 'Уровень 17', cond: { type: 'level', target: 17 }, kind: 'perk', perkText: 'Скидка 500₽ (от 3000₽)' },
    { id: 'ms_lvl19', title: 'Последний уровень — Император выпечки', cond: { type: 'level', target: 19 }, kind: 'both', points: 20000, perkText: 'Бенто-торт в подарок (от 1000₽)' },
    { id: 'ms_col_prod', title: 'Все бизнесы «Производство»', cond: { type: 'collect', target: 'prod' }, kind: 'points', points: 300 },
    { id: 'ms_col_mkt', title: 'Все бизнесы «Маркетинг»', cond: { type: 'collect', target: 'mkt' }, kind: 'points', points: 300 },
    { id: 'ms_col_staff', title: 'Все бизнесы «Персонал»', cond: { type: 'collect', target: 'staff' }, kind: 'points', points: 300 },
    { id: 'ms_col_net', title: 'Все бизнесы «Сеть»', cond: { type: 'collect', target: 'net' }, kind: 'points', points: 300 },
    { id: 'ms_col_all', title: 'Вся коллекция бизнесов', cond: { type: 'collect', target: 'all' }, kind: 'perk', perkText: 'Бенто-торт в подарок (от 2000₽)' },
    { id: 'ms_ref3', title: 'Пригласил 3 друзей', cond: { type: 'ref', target: 3 }, kind: 'points', points: 500 },
    { id: 'ms_ref10', title: 'Пригласил 10 друзей', cond: { type: 'ref', target: 10 }, kind: 'perk', perkText: 'Промокод −10% (от 1000₽)' },
  ];
  function condMet(t, s) {
    if (t.type === 'link') return !!linkOpened[t.id];
    if (t.type === 'level') return s.level >= t.target || Number(s.prestige || 0) > 0;
    if (t.type === 'balance') return s.totalEarned >= t.target || Number(s.prestige || 0) > 0;
    if (t.type === 'streak') return s.dailyStreak >= t.target;
    if (t.type === 'ref') return (s.referrals || 0) >= t.target;
    if (t.type === 'taps') return (s.taps || 0) >= t.target;
    if (t.type === 'cards') return (s.cardsOwned || 0) >= t.target;
    if (t.type === 'collect') { const cs = s.cards || []; if (t.target === 'all') return cs.length > 0 && cs.every(c => c.level > 0); const ic = cs.filter(c => c.cat === t.target); return ic.length > 0 && ic.every(c => c.level > 0); }
    return false;
  }
  function fmtDur(ms) { const h = Math.max(0, Math.floor(ms / 3600e3)); const d = Math.floor(h / 24); return d > 0 ? `${d}д ${h % 24}ч` : `${h}ч`; }

  // Витрина обмена монет→реальные награды вычищена из UI 30.07.2026 (решение юзера:
  // не обещать неработающее). Бэк (/api/clicker/redeem, CLICKER_REWARDS_ENABLED) жив —
  // при включении Машей вернуть витрину из git-истории (catclick v122).

  let ov, audio, raf, lastTs = 0, pending = 0, pendingComboBonus = 0, pendingTapGain = 0, pendingTapEnergy = 0, tapsInflight = 0, tapsInflightAccount = '', tapAccount = '', tapFlushPromise = null, tapRetryBatch = null, syncT = 0, curLevel = 1, tab = 'cat';
  // Меняется при каждом реальном открытии/закрытии. Асинхронный ответ от уже
  // закрытого экземпляра не должен показывать попап в следующей сессии.
  let overlaySession = 0;
  function overlaySessionActive(session) { return session === overlaySession && !!ov && ov.classList.contains('on'); }
  let uiDay = irkToday(), dayCheckAt = 0, dayRetryAt = 0;
  const MAX_TAP_POINTERS = 4;
  const activeTapPointers = new Set();
  // «Сладкий тап» — зеркало src/clicker.ts::SWEET_TAP_* (менять синхронно)
  const SWEET_TAP_EVERY = 40, SWEET_TAP_MULT = 8;
  let renderAcc = 0; // копилка dt для 30fps-капа главного цикла (тап-обработка вне цикла — не влияет)
  const LOOP_FRAME_BUDGET = 1 / 30;
  const MG_MIN_FRAME_MS = 15; // кап рендера экшен-мини-игр ~60fps: на 120–144 Гц не жжём батарею лишними кадрами (геймплей на dt, скорость не меняется)
  let st = null, turboUntil = 0, combo = 0, comboT = 0, bonusTimer = 0, rainState = null, rainRAF = 0, upCat = 'prod', lastBought = null;
  // Пока сервер сохраняет результат, новую мини-игру запускать нельзя: иначе
  // старый ответ способен закрыть/перерисовать уже начатую следующую игру.
  const gameSubmissions = new Set();
  // profitPerHour уже включает альбом; здесь остаются динамические множители,
  // которыми сервер умножает итоговую часовую ставку.
  function passiveIncomeMult() {
    if (!st) return 1;
    const prestige = Number(st.prestigeMult) || 1;
    const event = st.event && st.event.active && (!st.event.endsTs || Number(st.event.endsTs) > Date.now()) ? (Number(st.event.mult) || 1) : 1;
    const bank = Number(st.bankMult) > 1 ? Number(st.bankMult) : 1;
    return prestige * event * bank;
  }
  let sessionTapCount = 0, energyHintFired = false, boostsHintFired = false, bizCoachPending = false, lastTapFxAt = 0;
  let lastTapHapticAt = 0, tapRenderFrame = 0, catTapTimer = 0;

  function authed() { return !!(window.App && App.isAuthed && App.isAuthed()); }

  // ── Коуч-хинты новичку: одноразовые тултипы по механикам, БЕЗ коммерции (работают
  // одинаково в PURE и полной игре). Показ строго один раз — ключ ck_coach_<id> в
  // localStorage; если storage сломан — держим показанные в памяти на сессию. Не
  // больше одного бабла разом; очередь не нужна — следующий покажется при своём триггере.
  const COACH = {
    tap:    { icon: 'tap',     t: 'Тапай Василия — каждый тап приносит монеты. Быстрая серия даёт комбо-бонус' },
    level:  { icon: 'star',    t: 'Копи монеты — на новом уровне Василий сменит образ, а сцена — интерьер' },
    up:     { icon: 'bolt',    t: 'Бусты усиливают тап, а бизнесы приносят монеты сами — офлайн копится до 3 часов' },
    dove:   { icon: 'dove',    t: 'Голуби-помощники открываются, когда заводишь бизнесы в Прокачке' },
    top:    { icon: 'trophy',  t: 'Рейтинг недели: очки копятся с понедельника. Зови друзей — вместе веселее' },
    energy: { icon: 'battery', t: 'Энергия кончилась? Она восстанавливается сама — возвращайся чуть позже' },
    combo:    { icon: 'fire',   t: 'Это комбо: тапай без пауз — каждые 10 тапов дают бонус' },
    bizFirst: { icon: 'shop',   t: 'Бизнес работает сам; после выхода доход копится до 3 часов. Строка +N/час показывает точную прибавку от покупки нового уровня' },
    boosts:   { icon: 'rocket', t: 'Турбо и Энергия — бесплатные бусты, обновляются каждый день' },
  };
  const coachSeenMem = new Set();
  function coachSeen(id) { try { return !!localStorage.getItem('ck_coach_' + id); } catch (_) { return coachSeenMem.has(id); } }
  function coachMarkSeen(id) { try { localStorage.setItem('ck_coach_' + id, '1'); } catch (_) { coachSeenMem.add(id); } }
  let coachBubbleEl = null, coachAnchorEl = null, coachActiveId = null;
  function closeActiveCoach() {
    if (coachBubbleEl) { coachBubbleEl.remove(); coachBubbleEl = null; }
    if (coachAnchorEl) { coachAnchorEl.classList.remove('ck-coach-glow'); coachAnchorEl = null; }
    coachActiveId = null;
  }
  // Анкор может быть высоким (напр. весь список) — прижимаем «точку прицела» к его верху,
  // чтобы бабл не улетал к самому низу списка.
  function positionCoach(bubble, anchor, arrowEl) {
    const rr = anchor.getBoundingClientRect();
    const r = { top: rr.top, bottom: rr.top + Math.min(rr.height, 120), left: rr.left, right: rr.right, width: rr.width };
    const margin = 10, bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    const below = r.top < window.innerHeight / 2;
    let top = below ? r.bottom + margin : r.top - bh - margin;
    top = Math.max(8, Math.min(window.innerHeight - bh - 8, top));
    let left = r.left + r.width / 2 - bw / 2;
    left = Math.max(8, Math.min(window.innerWidth - bw - 8, left));
    bubble.style.top = top + 'px'; bubble.style.left = left + 'px';
    arrowEl.classList.toggle('top', below); arrowEl.classList.toggle('bottom', !below);
    arrowEl.style.left = Math.max(14, Math.min(bw - 14, r.left + r.width / 2 - left)) + 'px';
  }
  // Одноразовый тултип-бабл у anchorSel. opts: {icon, root} — root по умолчанию текущий оверлей игры.
  function coach(id, html, anchorSel, opts) {
    opts = opts || {};
    if (tourActive) return; // во время тура Василия коучи молчат (не наслаиваемся)
    if (coachActiveId || coachSeen(id)) return;
    const root = opts.root || ov;
    if (!root) return;
    const anchor = typeof anchorSel === 'string' ? root.querySelector(anchorSel) : anchorSel;
    if (!anchor || !anchor.offsetParent) return; // якорь скрыт (чужая вкладка/оверлей) — не показывать и не «сжигать» показ
    styles();
    coachMarkSeen(id);
    coachActiveId = id;
    const bubble = document.createElement('div'); bubble.className = 'ck-coach';
    bubble.innerHTML = `<div class="ck-coach__arr"></div><div class="ck-coach__row"><div class="ck-coach__ic">${opts.icon || ''}</div><div class="ck-coach__t">${html}</div></div><button class="ck-coach__ok" type="button">Понятно</button>`;
    root.appendChild(bubble);
    anchor.classList.add('ck-coach-glow');
    coachBubbleEl = bubble; coachAnchorEl = anchor;
    positionCoach(bubble, anchor, bubble.querySelector('.ck-coach__arr'));
    bubble.querySelector('.ck-coach__ok').onclick = () => { window.haptic && window.haptic('light'); closeActiveCoach(); };
  }
  // ── Звук: мастер-шина с ревером + богатый синтез (без файлов) ─────────────────
  let bus, comboFx;
  function ac() {
    if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {} if (audio) buildBus(); }
    if (audio && audio.state === 'suspended') audio.resume().catch(() => {});
    return audio;
  }
  function buildBus() {
    const a = audio; bus = a.createGain(); bus.gain.value = 0.85;
    const comp = a.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
    const rev = a.createConvolver(); const len = Math.floor(a.sampleRate * 0.8); const imp = a.createBuffer(2, len, a.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = imp.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    rev.buffer = imp; const wet = a.createGain(); wet.gain.value = 0.16; const dry = a.createGain(); dry.gain.value = 1;
    bus.connect(dry); dry.connect(comp); bus.connect(rev); rev.connect(wet); wet.connect(comp); comp.connect(a.destination);
  }
  // одна нота → мастер-шина (ADSR-конверт, опц. глайд)
  function note(f, dur, type, gain, slideTo, when) {
    const a = ac(); if (!a || !bus) return; const t = a.currentTime + (when || 0);
    const o = a.createOscillator(), g = a.createGain(); o.type = type || 'triangle'; o.frequency.setValueAtTime(f, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur * 0.9);
    const pk = gain || 0.12; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(pk, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.02);
  }
  function beep(f, t, g, slide) { note(f, 0.12, t === 'square' ? 'square' : 'triangle', g || 0.08, slide); }
  function chord(arr, g) { arr.forEach((f, i) => note(f, 0.3, 'triangle', g || 0.1, null, i * 0.08)); }
  // Короткий монетный акцент. Два генератора вместо трёх: на длинной серии это
  // заметно разгружает AudioContext в мобильных WebView, не делая тап беззвучным.
  function sfxTap(combo) {
    const k = 1 + Math.min(combo || 0, 24) * 0.014; const base = 740 * k;
    note(base, 0.13, 'triangle', 0.085, base * 1.45); note(base * 2, 0.075, 'sine', 0.035);
  }
  function sfxBuy() { note(523, 0.14, 'triangle', 0.11, 660); note(784, 0.18, 'triangle', 0.1, null, 0.08); note(1318, 0.1, 'sine', 0.05, null, 0.12); }
  function sfxLevel() { [523, 659, 784, 1047, 1319].forEach((f, i) => note(f, 0.5, 'triangle', 0.12, null, i * 0.09)); note(2093, 0.5, 'sine', 0.04, null, 0.4); }
  function sfxTurbo() { note(180, 0.45, 'sawtooth', 0.1, 920); note(360, 0.4, 'triangle', 0.06, 1400, 0.04); note(1568, 0.18, 'sine', 0.05, null, 0.3); }
  function sfxReward() { [1568, 1318, 1047, 1568].forEach((f, i) => note(f, 0.22, 'triangle', 0.1, null, i * 0.07)); }
  function sfxError() { note(220, 0.18, 'sine', 0.08, 160); }
  function coinSfx() { sfxTap(0); }

  // ── Гость (localStorage) ─────────────────────────────────────────────────────
  function rawDefault() { return { balance: 0, totalEarned: 0, energy: 1000, energyCarry: 0, multitapLevel: 0, energyLevel: 0, cards: {}, taps: 0, dailyStreak: 0, dailyDate: null, bE: 0, bT: 0, bDate: null, turboUntil: 0, tasksDone: {}, comboDate: null, comboHits: [], comboClaimed: null, cipherDate: null, bonusAt: 0, chestDate: null, rainDate: null, gamesDone: {}, passiveCarry: 0, _ts: Date.now() }; }
  let memRaw = null; // in-memory фолбэк: заблокированный localStorage не должен ронять тап (setItem кидает в приватных webview)
  let guestTapRaw = null, guestTapSaveTimer = 0;
  function rawGet() { let s; try { s = JSON.parse(localStorage.getItem(LS)); } catch (_) {} if (memRaw && (!s || (memRaw._ts || 0) >= (s._ts || 0))) s = memRaw; if (!s) s = rawDefault(); if (!s.cards) s.cards = {}; return s; }
  function rawSave(s) { s._ts = Date.now(); memRaw = s; try { localStorage.setItem(LS, JSON.stringify(s)); } catch (_) {} }
  function flushGuestTapSave() {
    clearTimeout(guestTapSaveTimer); guestTapSaveTimer = 0;
    if (!guestTapRaw) return;
    // _ts уже соответствует моменту последнего синка st → raw. Не сдвигаем его
    // здесь ещё раз: иначе потерялись бы доли пассивного дохода за время таймера.
    memRaw = guestTapRaw;
    try { localStorage.setItem(LS, JSON.stringify(guestTapRaw)); } catch (_) {}
  }
  function stageGuestTapState(incrementTap) {
    const s = guestTapRaw || rawGet(); guestTapRaw = s;
    if (incrementTap) s.taps = (Number(s.taps) || 0) + 1;
    // st уже содержит реген и пассивный доход текущего кадра; зеркалим его целиком,
    // чтобы пакетная запись не меняла игровую экономику и ничего не теряла.
    s.energy = Number(st.energy) || 0; s.energyCarry = 0;
    s.balance = Number(st.balance) || 0; s.totalEarned = Number(st.totalEarned) || 0;
    s._ts = Date.now(); memRaw = s;
    if (!guestTapSaveTimer) guestTapSaveTimer = setTimeout(flushGuestTapSave, 220);
    return s;
  }
  function profitOf(c) { let p = 0; for (const x of CARDS) p += cardProfit(x, c[x.id] || 0); return p; }
  function guestDerive() {
    const s = rawGet(); const today = irkToday();
    if (s.bDate !== today) { s.bE = 0; s.bT = 0; s.bDate = today; }
    const secs = Math.max(0, (Date.now() - (s._ts || Date.now())) / 1000);
    const energyMax = energyMaxFor(s.energyLevel);
    const rawEnergy = Number(s.energy || 0) + secs * REGEN + Number(s.energyCarry || 0);
    s.energy = Math.min(energyMax, Math.floor(rawEnergy + 1e-9));
    s.energyCarry = s.energy >= energyMax ? 0 : Math.max(0, Math.min(0.999999999, rawEnergy - s.energy));
    const now = Date.now();
    const cappedMs = Math.min(Math.max(0, now - (s._ts || now)), PASSIVE_CAP_H * 3600e3);
    let cursor = now - cappedMs, weightedHours = 0;
    while (cursor < now) {
      const irkDay = Math.floor((cursor + 8 * 3600e3) / 86400e3);
      const nextMidnight = (irkDay + 1) * 86400e3 - 8 * 3600e3;
      const end = Math.min(now, nextMidnight);
      weightedHours += (end - cursor) / 3600e3 * ckEventMultAt(cursor);
      cursor = end;
    }
    const rawPassive = profitOf(s.cards) * weightedHours + Number(s.passiveCarry || 0);
    const passive = Math.floor(rawPassive + 1e-9);
    const nextCarry = rawPassive - passive;
    s.passiveCarry = nextCarry < 1e-9 ? 0 : Math.min(0.999999999, nextCarry);
    if (passive > 0) { s.balance += passive; s.totalEarned += passive; }
    rawSave(s); return guestState(s, passive);
  }
  function guestState(s, passive) {
    const today = irkToday();
    const yesterday = new Date(Date.now() + 8 * 3600 * 1000 - 86400000).toISOString().slice(0, 10);
    const visibleDailyStreak = (s.dailyDate === today || s.dailyDate === yesterday) ? Math.max(0, Number(s.dailyStreak) || 0) : 0;
    const dailyAvailable = s.dailyDate !== today;
    const lg = leagueFor(s.totalEarned);
    const comboCards = todaysCombo(today);
    const comboRecorded = s.comboDate === today ? (s.comboHits || []) : [];
    const comboHits = comboHitsIncludingMaxed(comboCards, comboRecorded, s.cards);
    return {
      balance: s.balance, totalEarned: s.totalEarned, energy: s.energy, energyMax: energyMaxFor(s.energyLevel),
      perTap: perTapFor(s.multitapLevel), profitPerHour: profitOf(s.cards), passiveEarned: passive || 0, albumMult: 1,
      level: lg.level, levelName: lg.name, nextNeed: nextNeedForLevel(lg.level),
      multitapLevel: s.multitapLevel, multitapPrice: priceMultitap(s.multitapLevel),
      energyLevel: s.energyLevel, energyPrice: priceEnergy(s.energyLevel),
      cards: CARDS.map(c => { const lv = s.cards[c.id] || 0; const locked = lv === 0 && !!c.req && lg.level < c.req; const maxed = lv >= BUSINESS_MAX_LEVEL; const currentProfit = cardProfit(c, lv), profit = maxed ? currentProfit : cardProfit(c, lv + 1); return { id: c.id, name: c.name, cat: c.cat, level: lv, profit, currentProfit, profitGain: profit - currentProfit, price: maxed ? 0 : cardPrice(c, lv), req: c.req || 0, locked, maxed }; }),
      dailyAvailable, dailyStreak: visibleDailyStreak, dailyNext: dailyReward(dailyAvailable ? visibleDailyStreak + 1 : visibleDailyStreak),
      chestAvailable: s.chestDate !== today,
      rainAvailable: s.rainDate !== today,
      boostEnergyLeft: DAILY_BOOSTS - s.bE, boostTurboLeft: DAILY_BOOSTS - s.bT, turboMsLeft: Math.max(0, (s.turboUntil || 0) - Date.now()),
      combo: { cards: comboCards, hits: comboHits, complete: comboCards.every(c => comboHits.includes(c)), claimed: s.comboClaimed === today, reward: COMBO_REWARD },
      cipher: { morse: toMorse(todaysCipher(today)), anagram: scrambleWord(todaysCipher(today), today), len: todaysCipher(today).length, claimed: s.cipherDate === today, reward: CIPHER_REWARD },
      taps: s.taps || 0, cardsOwned: CARDS.filter(c => (s.cards[c.id] || 0) > 0).length,
      season: { points: 0, endsTs: seasonEndsTs() },
      prestige: 0, prestigeMult: 1, prestigeReady: false, event: ckEvent(),
    };
  }

  async function api(path, opts) { const sig = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(10000) : undefined; const r = await fetch(path, { signal: sig, ...opts, headers: { 'Content-Type': 'application/json', ...(App.authHeader ? App.authHeader() : {}) } }); return r.json(); }
  async function copyText(value) {
    const text = String(value || '');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; }
    } catch (_) {}
    // Старые Telegram WebView могут не иметь Clipboard API, но поддерживают
    // копирование выделенного textarea через execCommand.
    try {
      const input = document.createElement('textarea');
      input.value = text; input.setAttribute('readonly', '');
      input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(input); input.select();
      const ok = !!document.execCommand && document.execCommand('copy');
      input.remove(); return ok;
    } catch (_) { return false; }
  }
  function clientRequestId() {
    return (window.crypto && typeof window.crypto.randomUUID === 'function')
      ? window.crypto.randomUUID().replace(/-/g, '')
      : (Date.now().toString(36) + '_' + Math.random().toString(36).slice(2));
  }
  function accountStorageKey(base) {
    let account = 'unknown';
    try {
      const u = window.App && App.user && App.user();
      if (u && Number.isFinite(Number(u.id))) account = String(App.platform || 'app') + '_' + String(Math.floor(Number(u.id)));
    } catch (_) {}
    return base + '_' + account;
  }
  // Все запросы, возвращающие ClickerState, идут последовательно. Серверная revision
  // дополнительно отсекает запоздавшие ответы при смене версии клиента/повторе сети.
  let stateMutationTail = Promise.resolve(), appliedStateRevision = -1;
  function stateApi(path, opts) {
    const run = () => api(path, opts);
    const request = stateMutationTail.then(run, run);
    stateMutationTail = request.then(() => undefined, () => undefined);
    return request;
  }
  // Любая соседняя механика, которая меняет общий баланс/энергию, обязана сначала
  // дождаться отправки оптимистичных тапов. Иначе, например, старые тапы могли уйти
  // уже ПОСЛЕ престижа или включения турбо и попасть не в тот цикл/множитель.
  async function settlePendingTaps() {
    if (!authed()) return true;
    const account = accountStorageKey('ck_state_context');
    if (tapRetryBatch && tapRetryBatch.account && tapRetryBatch.account !== account) tapRetryBatch = null;
    if (tapAccount && tapAccount !== account) {
      pending = 0; pendingComboBonus = 0; pendingTapGain = 0; pendingTapEnergy = 0;
      tapAccount = account;
    }
    // Сначала завершаем потерянную пачку с тем же requestId, затем хвост тапов,
    // набранный пока она была в полёте. Обычно достаточно одного прохода.
    for (let i = 0; i < 3 && (tapFlushPromise || tapRetryBatch || pending > 0); i++) {
      if (tapFlushPromise) await tapFlushPromise;
      else await flush();
    }
    return pending <= 0 && !tapRetryBatch && !tapFlushPromise;
  }
  async function mutationApi(path, opts) {
    if (!(await settlePendingTaps())) throw new Error('tap_sync_failed');
    return stateApi(path, opts);
  }
  function applyServerState(next) {
    // HTTP-ошибки наш fetch-хелпер тоже разбирает как JSON. Такой объект нельзя
    // принимать за ClickerState: иначе временный 500 превращал весь `st` в {error}.
    if (!next || typeof next !== 'object' || next.error) return false;
    const revision = Number(next.revision);
    if (Number.isFinite(revision)) {
      if (revision < appliedStateRevision) return false;
      appliedStateRevision = revision;
    }
    st = next;
    // Сервер ещё не знает о тапах, набранных после запуска текущего запроса.
    const currentAccount = accountStorageKey('ck_state_context');
    const pendingCurrent = !tapAccount || tapAccount === currentAccount;
    const pendingGain = pendingCurrent ? Number(pendingTapGain || 0) : 0;
    const pendingEnergy = pendingCurrent ? Number(pendingTapEnergy || 0) : 0;
    const retryCurrent = !tapRetryBatch || !tapRetryBatch.account || tapRetryBatch.account === currentAccount;
    const retryGain = retryCurrent ? Number(tapRetryBatch && tapRetryBatch.gain || 0) : 0;
    const retryEnergy = retryCurrent ? Number(tapRetryBatch && tapRetryBatch.energy || 0) : 0;
    if (authed() && (pendingGain > 0 || retryGain > 0)) {
      st.balance = Number(st.balance) + pendingGain + retryGain;
      st.totalEarned = Number(st.totalEarned) + pendingGain + retryGain;
      st.energy = Math.max(0, Number(st.energy) - pendingEnergy - retryEnergy);
    }
    return true;
  }
  // Анти-даблтап: пока летит запрос операции этого типа — повторные тапы игнорируются
  const inflight = new Set();
  async function withLock(key, fn) { if (inflight.has(key)) return; inflight.add(key); try { return await fn(); } finally { inflight.delete(key); } }
  let loadNetFail = false, loadFailureReason = '', loadedStateAccount = '';
  function cachedServerState(account) {
    try {
      const saved = JSON.parse(localStorage.getItem(accountStorageKey('ck_server_state_v1')) || 'null');
      return saved && saved.account === account && saved.state && !saved.state.error ? saved.state : null;
    } catch (_) { return null; }
  }
  function cacheServerState(account, state) {
    try { localStorage.setItem(accountStorageKey('ck_server_state_v1'), JSON.stringify({ account, state, savedAt: Date.now() })); } catch (_) {}
  }
  async function load() {
    let q = '';
    try { const sp = (window.App && App.startParam && App.startParam()) || ''; const m = /^src[_-]([a-zA-Z0-9_-]{1,32})/.exec(sp); if (m) q = '?source=' + encodeURIComponent(m[1]); } catch (_) {}
    loadNetFail = false; loadFailureReason = '';
    const account = accountStorageKey('ck_state_context');
    if (loadedStateAccount && loadedStateAccount !== account) {
      // revision монотонна только внутри одного профиля. Без сброса пользователь с
      // меньшей revision мог вообще не загрузиться после смены аккаунта в WebView.
      appliedStateRevision = -1;
      st = null;
      pending = 0; pendingComboBonus = 0; pendingTapGain = 0; pendingTapEnergy = 0;
      tapRetryBatch = null; tapAccount = account;
    }
    let loaded = null;
    if (authed()) {
      loaded = await api('/api/clicker' + q).then((d) => {
        if (!d || d.error) { loadFailureReason = String(d && d.error || 'bad_state'); return null; }
        return d;
      }).catch(() => null);
      if (!loaded) {
        loadNetFail = true;
        // Административную блокировку нельзя обходить последним локальным снимком.
        if (loadFailureReason === 'account_blocked') return false;
        loaded = loadedStateAccount === account && st ? st : cachedServerState(account);
        if (!loaded) return false;
      } else cacheServerState(account, loaded);
    } else loaded = guestDerive();
    if (!applyServerState(loaded)) return false;
    loadedStateAccount = account;
    uiDay = irkToday(); turboUntil = Date.now() + (st.turboMsLeft || 0);
    return true;
  }
  function showLoadFailure() {
    const pop = ov && ov.querySelector('#ck-pop'); if (!pop) return;
    const blocked = loadFailureReason === 'account_blocked';
    pop.innerHTML = blocked
      ? `<h3>${ICON.bolt(20)} Доступ ограничен</h3><div style="color:var(--muted);font-size:13px">Доступ к «Котик Комбат» временно ограничен администрацией.</div><button id="ck-pop-ok" style="background:rgba(255,255,255,.07);color:var(--ink);border-color:var(--line)">Закрыть</button>`
      : `<h3>${ICON.bolt(20)} Не удалось загрузить игру</h3><div style="color:var(--muted);font-size:13px">Серверный прогресс не получен. Мы не подставляем вместо него гостевые данные, поэтому монеты и уровень останутся в безопасности.</div><button id="ck-load-retry">Повторить</button><button id="ck-pop-ok" style="background:rgba(255,255,255,.07);color:var(--ink);border-color:var(--line)">Закрыть</button>`;
    pop.classList.add('on');
    const retry = pop.querySelector('#ck-load-retry'); if (retry) retry.onclick = () => { pop.classList.remove('on'); close(); setTimeout(open, 0); };
    pop.querySelector('#ck-pop-ok').onclick = close;
  }

  // ── FTUE «Первый день»: чип на главной + попап-чеклист (аудит 30.07) ─────────
  let ftueData = null, ftueLoadGeneration = 0, ftueAccountKey = '';
  async function loadFtue() {
    const account = accountStorageKey('ck_ftue_context');
    if (ftueAccountKey !== account) {
      ftueAccountKey = account;
      ftueData = null;
      renderFtueChip();
    }
    if (!authed()) return;
    const generation = ++ftueLoadGeneration;
    const session = overlaySession;
    const next = await api('/api/clicker/ftue').catch(() => null);
    if (generation !== ftueLoadGeneration || account !== accountStorageKey('ck_ftue_context') || !overlaySessionActive(session)) return;
    ftueData = next && !next.error ? next : null;
    renderFtueChip();
  }
  function renderFtueChip() {
    const btn = ov && ov.querySelector('#ck-ftue');
    if (!btn) return;
    if (!ftueData || !Array.isArray(ftueData.steps) || ftueData.allClaimed) { btn.hidden = true; return; }
    const doneN = ftueData.steps.filter(s => s.claimed).length;
    const pending = ftueData.steps.filter(s => s.done && !s.claimed).reduce((m, s) => m + s.reward, 0);
    btn.hidden = false;
    btn.innerHTML = `${ICON.star(14)} Первый день · ${doneN}/${ftueData.steps.length}${pending > 0 ? ` · <b>забери +${fmt(pending)}</b>` : ''}`;
    btn.onclick = openFtuePopup;
  }
  function openFtuePopup() {
    const pop = ov && ov.querySelector('#ck-pop');
    if (!pop || !ftueData || !ov.classList.contains('on')) return;
    window.haptic && window.haptic('light');
    const rows = ftueData.steps.map(s => `
      <div class="ck-ftue-row ${s.claimed ? 'done dim' : s.done ? 'done' : 'dim'}">
        <span class="st">${(s.done || s.claimed) ? '✓' : s.id + 1}</span>
        <span class="t">${s.name}</span>
        ${s.claimed ? `<span style="font-size:11px;color:var(--muted);flex:none">✓</span>`
          : s.done ? `<button class="ck-card__buy" data-ftue="${s.id}" style="justify-content:center;flex:none">+${fmt(s.reward)}</button>`
          : `<span style="font-size:11px;color:var(--muted);flex:none">${COIN(11)} ${fmt(s.reward)}</span>`}
      </div>`).join('');
    pop.innerHTML = `<h3>${ICON.star(20)} Первый день</h3>
      <div style="color:var(--muted);font-size:12.5px;margin-bottom:6px">Пять шагов — и ты в игре. Награда за каждый.</div>
      <div style="text-align:left">${rows}</div>
      <button id="ck-pop-ok">Закрыть</button>`;
    pop.classList.add('on');
    pop.querySelector('#ck-pop-ok').onclick = () => pop.classList.remove('on');
    pop.querySelectorAll('[data-ftue]').forEach(b => {
      b.onclick = async () => {
        b.disabled = true;
        const actionSession = overlaySession;
        const body = JSON.stringify({ step: Number(b.dataset.ftue) });
        let r = await mutationApi('/api/clicker/ftue/claim', { method: 'POST', body }).catch(() => null);
        let recovered = false;
        if (!r || r.error === 'internal') {
          r = await mutationApi('/api/clicker/ftue/claim', { method: 'POST', body }).catch(() => null);
          recovered = !!(r && r.error === 'already');
        }
        if (!overlaySessionActive(actionSession)) {
          if ((r && r.ok) || recovered) void window.ckRefreshState();
          return;
        }
        if (r && r.ok) {
          window.haptic && window.haptic('success'); sfxReward(); coinShower();
          if (st) {
            st.balance = r.newBalance;
            st.totalEarned += r.reward;
            if (Number.isFinite(Number(r.revision))) appliedStateRevision = Math.max(appliedStateRevision, Number(r.revision));
            renderAll(); bumpBalance();
          }
          await loadFtue();
          openFtuePopup(); // перерисовать чеклист поверх
        } else if (recovered) {
          await window.ckRefreshState();
          await loadFtue();
          flashMsg('Награда уже зачислена — баланс обновлён', 'light');
          openFtuePopup();
        } else {
          flashMsg(!r || r.error === 'internal' ? 'Нет связи — попробуй ещё раз' : r.error === 'already' ? 'Уже забрано' : 'Шаг ещё не выполнен');
          b.disabled = false;
        }
      };
    });
  }
  // T5: welcome-промокод новичку (первая победа). Показ 1 раз; сервер решает eligibility.
  async function maybeWelcomePromo() {
    if (!authed()) return;
    const session = overlaySession;
    try {
      const d = await api('/api/clicker/welcome').catch(() => null);
      if (!overlaySessionActive(session) || !d || !d.promo) return;
      const pop = ov.querySelector('#ck-pop');
      pop.innerHTML = `<h3>${ICON.gift(20)} Подарок новичку!</h3><div class="v" style="font-size:22px">${d.promo}</div><div style="color:var(--muted);font-size:13px;max-width:240px">${(d.desc || '').replace(/</g, '&lt;')}</div><div style="display:flex;gap:8px;justify-content:center;margin-top:12px"><button class="ck-card__buy" id="ck-wc-copy" style="justify-content:center">Скопировать</button><button class="ck-card__buy" id="ck-wc-order" style="justify-content:center">Заказать</button></div><button id="ck-pop-ok" style="margin-top:10px">Закрыть</button>`;
      pop.classList.add('on');
      const done = () => { pop.classList.remove('on'); api('/api/clicker/welcome/seen', { method: 'POST', body: '{}' }).catch(() => {}); };
      const cp = pop.querySelector('#ck-wc-copy'); if (cp) cp.onclick = async () => { cp.textContent = await copyText(d.promo) ? 'Скопировано' : 'Выдели код выше'; };
      const wo = pop.querySelector('#ck-wc-order'); if (wo) wo.onclick = () => { if (window.App && App.openExternal) App.openExternal('https://maria-irk.ru/'); else window.open('https://maria-irk.ru/', '_blank'); }; // внешние ссылки — через бридж (правило проекта)
      pop.querySelector('#ck-pop-ok').onclick = done;
    } catch (_) {}
  }
  async function flush() {
    if ((!tapRetryBatch && pending <= 0) || !authed()) return;
    if (tapFlushPromise) return tapFlushPromise;
    tapFlushPromise = (async () => {
      // Даём присвоить сам Promise до возможного раннего выхода ниже.
      await Promise.resolve();
      const account = accountStorageKey('ck_state_context');
      if (tapRetryBatch && tapRetryBatch.account && tapRetryBatch.account !== account) tapRetryBatch = null;
      if (!tapRetryBatch && tapAccount && tapAccount !== account) {
        pending = 0; pendingComboBonus = 0; pendingTapGain = 0; pendingTapEnergy = 0;
        tapAccount = account;
        tapFlushPromise = null;
        return;
      }
      const isRetry = !!tapRetryBatch;
      const batch = tapRetryBatch || {
        n: pending,
        comboBonus: pendingComboBonus,
        gain: pendingTapGain,
        energy: pendingTapEnergy,
        requestId: clientRequestId(),
        account,
      };
      tapRetryBatch = null;
      if (!isRetry) { pending = 0; pendingComboBonus = 0; pendingTapGain = 0; pendingTapEnergy = 0; }
      const n = batch.n;
      tapsInflight += n; tapsInflightAccount = batch.account || account;
      try {
        const d = await stateApi('/api/clicker/tap', { method: 'POST', body: JSON.stringify({ taps: n, requestId: batch.requestId }), keepalive: true });
        if (!d || d.error) throw new Error('tap_sync_failed');
        if ((batch.account || account) !== accountStorageKey('ck_state_context')) return;
        // Пока запрос был в пути, игрок мог продолжить тапать. Ответ сервера уже
        // содержит отправленный батч, а ещё не отправленные тапы возвращаем поверх
        // него, иначе баланс визуально «откатывается» каждые 1,6 секунды.
        applyServerState(d);
      } catch (_) {
        // Не смешиваем неизвестную пачку с новыми тапами: повтор обязан уйти с тем
        // же количеством и requestId, иначе сервер не сможет отличить хвост от дубля.
        if ((batch.account || account) === accountStorageKey('ck_state_context')) tapRetryBatch = batch;
      } finally {
        tapsInflight = Math.max(0, tapsInflight - n);
        if (!tapsInflight) tapsInflightAccount = '';
        tapFlushPromise = null;
      }
    })();
    return tapFlushPromise;
  }
  async function flushForPageExit() {
    // Если один батч уже летит, flush() сам вернёт его Promise и не захватит тапы,
    // набранные позже. После него делаем ещё одну попытку для оставшегося хвоста.
    const wasInflight = !!tapFlushPromise;
    await flush();
    if (wasInflight && (tapRetryBatch || pending > 0)) await flush();
  }

  async function buy(type, id) {
    return withLock('buy', async () => {
      const actionSession = overlaySession;
      const wasNoBiz = type === 'card' && !!st && !st.cardsOwned; // до покупки бизнесов не было — для коуч-хинта bizFirst
      const beforeLevel = type === 'multitap' ? Number(st && st.multitapLevel) : type === 'energy' ? Number(st && st.energyLevel) : Number((st && st.cards || []).find(c => c.id === id)?.level || 0);
      let ok = false, netfail = false, reason = '';
      if (authed()) {
        try { const d = await mutationApi('/api/clicker/buy', { method: 'POST', body: JSON.stringify({ type, id }) }); if (!d.error) { applyServerState(d); ok = true; } else if (d.error === 'internal') throw new Error('internal'); else reason = d.error; }
        catch (_) {
          // Покупка уровня не идемпотентна: повтор мог бы купить уже СЛЕДУЮЩИЙ
          // уровень. Сначала проверяем, успел ли первый запрос закоммититься.
          const fresh = await stateApi('/api/clicker').catch(() => null);
          if (fresh && !fresh.error) {
            const currentLevel = type === 'multitap' ? Number(fresh.multitapLevel) : type === 'energy' ? Number(fresh.energyLevel) : Number((fresh.cards || []).find(c => c.id === id)?.level || 0);
            applyServerState(fresh);
            if (currentLevel > beforeLevel) ok = true; else netfail = true;
          } else netfail = true;
        }
      }
      else { const s = guestBuyRaw(type, id); if (s) { applyServerState(guestDerive()); ok = true; } }
      if (!overlaySessionActive(actionSession)) return;
      if (ok) { lastBought = type === 'card' ? id : null; bizCoachPending = type === 'card' && wasNoBiz; sfxBuy(); window.haptic && window.haptic('medium'); renderAll(); renderUpgrades(); }
      else { sfxError(); flashMsg(netfail ? 'Нет связи — попробуй ещё раз' : reason === 'max_level' ? 'Уже максимальный уровень' : reason === 'locked' ? 'Бизнес пока закрыт по уровню' : 'Не хватает монет'); }
    });
  }
  function guestBuyRaw(type, id) {
    guestDerive(); const s = rawGet(); let cost = 0;
    if (type === 'multitap') cost = priceMultitap(s.multitapLevel); else if (type === 'energy') cost = priceEnergy(s.energyLevel);
    else { const c = CARDS.find(x => x.id === id); if (!c) return null; const lv = s.cards[id] || 0; if (lv >= BUSINESS_MAX_LEVEL || (lv === 0 && c.req && leagueFor(s.totalEarned).level < c.req)) return null; cost = cardPrice(c, lv); }
    if (s.balance < cost) return null; s.balance -= cost;
    if (type === 'multitap') s.multitapLevel++; else if (type === 'energy') s.energyLevel++; else {
      s.cards[id] = (s.cards[id] || 0) + 1;
      const today = irkToday();
      if (todaysCombo(today).includes(id)) { if (s.comboDate !== today) { s.comboHits = []; s.comboDate = today; } if (!s.comboHits.includes(id)) s.comboHits.push(id); }
    }
    rawSave(s); return s;
  }
  async function claimDaily() {
    return withLock('daily', async () => {
      const actionSession = overlaySession;
      let r, netfail = false;
      if (authed()) {
        const expected = Number(st && st.dailyNext || 0);
        r = await mutationApi('/api/clicker/daily', { method: 'POST', body: '{}' }).catch(() => null);
        if (r && !r.error) applyServerState(r);
        else if (!r || r.error === 'internal') {
          const fresh = await stateApi('/api/clicker').catch(() => null);
          if (fresh && !fresh.error && fresh.dailyAvailable === false) { applyServerState(fresh); r = { reward: expected, recovered: true }; }
          else netfail = true;
        }
      }
      else { const g = guestClaimDaily(); if (g) { r = { reward: g }; applyServerState(guestDerive()); } }
      if (!overlaySessionActive(actionSession)) return;
      if (r && r.reward) { sfxReward(); window.haptic && window.haptic('success'); dailyPopup(r.reward, st.dailyStreak); renderAll(); bumpBalance(); }
      else if (netfail) { sfxError(); flashMsg('Нет связи — попробуй ещё раз'); }
      else if (r && r.error) { sfxError(); flashMsg(r.error === 'already' ? 'Награда за сегодня уже получена' : 'Не получилось — попробуй ещё раз'); }
    });
  }
  function guestClaimDaily() {
    guestDerive(); const s = rawGet(); const today = irkToday(); if (s.dailyDate === today) return 0;
    const yest = new Date(Date.now() + 8 * 3600 * 1000 - 86400000).toISOString().slice(0, 10);
    s.dailyStreak = s.dailyDate === yest ? s.dailyStreak + 1 : 1; const rew = dailyReward(s.dailyStreak);
    s.balance += rew; s.totalEarned += rew; s.dailyDate = today; rawSave(s); return rew;
  }
  async function claimCombo() {
    return withLock('combo', async () => {
      const actionSession = overlaySession;
      let r, netfail = false;
      if (authed()) {
        r = await mutationApi('/api/clicker/combo', { method: 'POST', body: '{}' }).catch(() => null);
        if (r && !r.error) applyServerState(r);
        else if (!r || r.error === 'internal') {
          const fresh = await stateApi('/api/clicker').catch(() => null);
          if (fresh && !fresh.error && fresh.combo && fresh.combo.claimed) { applyServerState(fresh); r = { reward: COMBO_REWARD, recovered: true }; }
          else netfail = true;
        }
      }
      else { const g = guestClaimComboRaw(); if (g) { r = { reward: COMBO_REWARD }; applyServerState(guestDerive()); } }
      if (!overlaySessionActive(actionSession)) return;
      if (r && r.reward) { sfxLevel(); window.haptic && window.haptic('success'); coinShower(); confettiBurst(); queueDoveDrop(r.pigeonDrop); dailyPopupRaw(ICON.star(20) + ' Комбо дня собрано!', r.reward); renderAll(); renderTasks(); bumpBalance(); }
      else flashMsg(netfail ? 'Нет связи — попробуй ещё раз' : !authed() || r && r.error === 'not_ready' ? 'Комбо ещё не собрано' : r && r.error === 'already' ? 'Комбо уже забрано сегодня' : 'Не получилось — попробуй ещё раз');
    });
  }
  function guestClaimComboRaw() {
    guestDerive(); const s = rawGet(); const today = irkToday();
    if (s.comboClaimed === today) return false;
    const combo = todaysCombo(today); const recorded = s.comboDate === today ? (s.comboHits || []) : [];
    const hits = comboHitsIncludingMaxed(combo, recorded, s.cards);
    if (!combo.every(c => hits.includes(c))) return false;
    s.balance += COMBO_REWARD; s.totalEarned += COMBO_REWARD; s.comboClaimed = today; rawSave(s); return true;
  }
  async function claimCipher(guess) {
    return withLock('cipher', async () => {
      const actionSession = overlaySession;
      let r;
      if (authed()) {
        r = await mutationApi('/api/clicker/cipher', { method: 'POST', body: JSON.stringify({ guess }) }).catch(() => null);
        if (r && !r.error) applyServerState(r);
        else if (!r || r.error === 'internal') {
          const fresh = await stateApi('/api/clicker').catch(() => null);
          if (fresh && !fresh.error && fresh.cipher && fresh.cipher.claimed) { applyServerState(fresh); r = { reward: CIPHER_REWARD, recovered: true }; }
          else { if (overlaySessionActive(actionSession)) flashMsg('Нет связи — попробуй ещё раз'); return; }
        } else { if (overlaySessionActive(actionSession)) flashMsg(r.error === 'internal' ? 'Нет связи — попробуй ещё раз' : r.error === 'already' ? 'Уже разгадан сегодня' : 'Неверно, попробуй ещё'); return; }
      }
      else { const g = guestClaimCipherRaw(guess); if (!g) { if (overlaySessionActive(actionSession)) flashMsg('Неверно, попробуй ещё'); return; } applyServerState(guestDerive()); r = { reward: CIPHER_REWARD }; }
      if (!overlaySessionActive(actionSession)) return;
      if (r && r.reward) { sfxReward(); window.haptic && window.haptic('success'); coinShower(); dailyPopupRaw(ICON.bolt(20) + ' Шифр разгадан!', r.reward); renderAll(); renderTasks(); bumpBalance(); }
    });
  }
  function guestClaimCipherRaw(guess) {
    guestDerive(); const s = rawGet(); const today = irkToday();
    if (s.cipherDate === today) return false;
    if (String(guess || '').trim().toUpperCase().replace(/Ё/g, 'Е') !== todaysCipher(today)) return false;
    s.balance += CIPHER_REWARD; s.totalEarned += CIPHER_REWARD; s.cipherDate = today; rawSave(s); return true;
  }
  async function boost(type) {
    if (type === 'turbo' && turboOn()) { flashMsg('Турбо уже активно', 'light'); return; } // не сжигать заряд на переустановку тех же 20с
    if (type === 'energy' && st && st.energy >= st.energyMax) { flashMsg('Энергия уже полная', 'light'); return; }
    return withLock('boost', async () => {
      const actionSession = overlaySession;
      let ok = false, netfail = false, reason = '';
      const beforeLeft = type === 'turbo' ? Number(st && st.boostTurboLeft) : Number(st && st.boostEnergyLeft);
      if (authed()) {
        try { const d = await mutationApi('/api/clicker/boost', { method: 'POST', body: JSON.stringify({ type }) }); if (!d.error) { applyServerState(d); ok = true; } else if (d.error === 'internal') throw new Error('internal'); else reason = d.error; }
        catch (_) {
          const fresh = await stateApi('/api/clicker').catch(() => null);
          if (fresh && !fresh.error) {
            const currentLeft = type === 'turbo' ? Number(fresh.boostTurboLeft) : Number(fresh.boostEnergyLeft);
            applyServerState(fresh); ok = currentLeft < beforeLeft; netfail = !ok;
          } else netfail = true;
        }
      }
      else { ok = guestBoost(type); if (ok) applyServerState(guestDerive()); }
      if (!overlaySessionActive(actionSession)) return;
      if (!ok) { flashMsg(netfail ? 'Нет связи — попробуй ещё раз' : reason === 'full_energy' ? 'Энергия уже полная' : reason === 'already_active' ? 'Турбо уже активно' : 'Бусты на сегодня кончились'); return; }
      if (type === 'turbo') { turboUntil = Date.now() + Math.max(0, Number(st && st.turboMsLeft) || TURBO_SEC * 1000); sfxTurbo(); }
      else { chord([520, 780], 0.14); }
      window.haptic && window.haptic('medium'); renderAll();
    });
  }
  function guestBoost(type) {
    guestDerive(); const s = rawGet();
    if (type === 'energy') { if (s.bE >= DAILY_BOOSTS || s.energy >= energyMaxFor(s.energyLevel)) return false; s.energy = energyMaxFor(s.energyLevel); s.energyCarry = 0; s.bE++; }
    else { if (s.bT >= DAILY_BOOSTS || Number(s.turboUntil || 0) > Date.now()) return false; s.turboUntil = Date.now() + TURBO_SEC * 1000; s.bT++; }
    rawSave(s); return true;
  }
  async function loadTop() {
    if (!authed()) return null;
    return api('/api/clicker/top').catch(() => null);
  }

  // ── стили ─────────────────────────────────────────────────────────────────────
  function styles() {
    if (document.getElementById('catclick-css')) return;
    const s = document.createElement('style'); s.id = 'catclick-css';
    s.textContent = `
      .ck-ov{--gold:#C0FF33;--gold-l:#D8FF7A;--gold-d:#8DBF20;--grape:#9B5CFF;--grape-l:#B79BFF;--magenta:#FF2E7E;--cream:#F3F1FB;--ink:#EFEDF7;--muted:#928DA6;--panel:rgba(255,255,255,.05);--line:rgba(255,255,255,.09);
        position:fixed;inset:0;z-index:9999;display:none;flex-direction:column;align-items:center;
        background:radial-gradient(95% 60% at 50% -8%,rgba(155,92,255,.30),transparent 58%),radial-gradient(75% 45% at 82% 110%,rgba(192,255,51,.12),transparent 58%),linear-gradient(180deg,#0E0A1A,#0B0814);
        overflow:hidden;overscroll-behavior:none;touch-action:manipulation;user-select:none;-webkit-user-select:none;color:var(--ink);font-family:'Nunito','Inter',system-ui,sans-serif}
      .ck-ov::after{content:'';position:absolute;inset:0;pointer-events:none;z-index:0;background:radial-gradient(125% 75% at 50% 118%,rgba(0,0,0,.5),transparent 60%)}
      .ck-ov.on{display:flex}.ck-ov.turbo{background:radial-gradient(95% 60% at 50% -8%,rgba(192,255,51,.30),transparent 55%),linear-gradient(180deg,#12140A,#0B0C06)}
      .ck-screen{position:relative;z-index:1;flex:1;display:none;flex-direction:column;align-items:center;overflow:hidden;width:100%;max-width:480px}.ck-screen.on{display:flex}
      /* Telegram Desktop/широкое окно: игра держится телефонной колонкой по центру, иначе
         кот (max-width:62% от ширины окна) раздувался и вылезал за экран, бусты уезжали.
         На телефоне (≤480px) width:100% и так меньше кэпа — layout не меняется. */
      .ck-nav{width:100%;max-width:480px}
      #ck-catwrap{touch-action:none;overscroll-behavior:none}
      .ck-x{position:absolute;top:12px;right:max(12px,calc(50% - 228px));z-index:9;width:34px;height:34px;border:1px solid var(--line);border-radius:50%;background:rgba(0,0,0,.28);color:var(--cream);font-size:17px;cursor:pointer}
      /* Pressed-отклик на все кнопки игры + расширенные хит-зоны мелких крестиков (визуально 34px, тап 48px) */
      .ck-ov button:not(:disabled):active{transform:scale(.96)}
      .ck-nav__b:not(:disabled):active{transform:none;opacity:.72}
      .ck-x::after,.ck-quiz__hd .x::after,.ck-rain__hud .x::after{content:'';position:absolute;inset:-8px;border-radius:50%}
      .ck-quiz__hd .x,.ck-rain__hud .x{position:relative}
      .ck-cat-chip:disabled{opacity:.45}
      .ck-i{display:inline-block;vertical-align:-.16em}.ck-coin-i{display:inline-block;vertical-align:-.18em;filter:drop-shadow(0 1px 1px rgba(0,0,0,.4))}
      .ck-daily{margin-top:13px;display:inline-flex;align-items:center;gap:7px;min-height:44px;box-sizing:border-box;background:linear-gradient(180deg,#D4FF6A,#A8F51E);color:#12210A;font-weight:800;border:1px solid rgba(216,255,122,.7);border-radius:14px;padding:9px 18px;font-size:13px;cursor:pointer;box-shadow:0 6px 18px rgba(168,245,30,.42),inset 0 1px 0 rgba(255,255,255,.4)}
      .ck-lvl{margin-top:13px;color:var(--gold-l);font-family:'Nunito',sans-serif;font-weight:700;font-size:17px;letter-spacing:.2px}
      .ck-bal{display:flex;align-items:center;justify-content:center;gap:9px;margin-top:4px;font-family:'Nunito',sans-serif;font-weight:700;font-size:40px;font-variant-numeric:tabular-nums;color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.45)}
      .ck-prof{margin-top:6px;display:inline-flex;align-items:center;gap:6px;background:var(--panel);border:1px solid var(--line);padding:4px 13px;border-radius:20px;font-weight:700;font-size:12px;color:var(--gold);font-variant-numeric:tabular-nums}
      .ck-prog{width:80%;max-width:330px;margin-top:10px}.ck-prog__bar{height:8px;border-radius:6px;background:rgba(0,0,0,.34);box-shadow:inset 0 1px 2px rgba(0,0,0,.45);overflow:hidden}.ck-prog__fill{height:100%;border-radius:6px;background:linear-gradient(90deg,#8DFF2E,#C0FF33);box-shadow:0 0 9px rgba(192,255,51,.6);transition:width .3s}.ck-prog__t{color:var(--muted);font-size:10.5px;text-align:center;margin-top:4px;font-weight:600;font-variant-numeric:tabular-nums}
      .ck-catwrap{position:relative;flex:1;min-height:0;width:100%;display:flex;align-items:center;justify-content:center}
      .ck-catwrap::before{content:'';position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(84vw,340px);height:min(84vw,340px);border-radius:50%;background:radial-gradient(circle at 50% 46%,rgba(192,255,51,.42) 0%,rgba(155,92,255,.4) 46%,rgba(155,92,255,0) 71%);box-shadow:inset 0 0 0 2px rgba(192,255,51,.4),0 0 95px rgba(155,92,255,.4);filter:blur(1.5px);pointer-events:none;z-index:0;animation:ckGlowPulse 4.2s ease-in-out infinite}
      .ck-catwrap::after{content:'';position:absolute;left:50%;bottom:5%;transform:translateX(-50%);width:44%;height:22px;border-radius:50%;background:radial-gradient(ellipse at center,rgba(0,0,0,.5),transparent 72%);filter:blur(3px);pointer-events:none;z-index:0;animation:ckShadowPulse 3.6s ease-in-out infinite}
      .ck-cat{position:relative;z-index:1;max-width:62%;max-height:94%;width:auto;height:auto;object-fit:contain;cursor:pointer;transform-origin:bottom center;-webkit-tap-highlight-color:transparent;animation:ckBreathe 3.8s ease-in-out infinite} /* тень уже запечена в vasily-stage*.webp — filter:drop-shadow тут перерастеризовывал кота на мобильном GPU каждый кадр (жалоба «тормозит») */
      .ck-cat.tap{animation:ckBreathe 3.8s ease-in-out infinite,ckTapSq .26s ease-out}.ck-cat.turbo{filter:drop-shadow(0 0 30px #C0FF33)}
      @keyframes ckBreathe{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-5px) scale(1.016)}}
      @keyframes ckTapSq{0%{transform:scale(1,1)}30%{transform:scale(1.07,.9)}62%{transform:scale(.97,1.05)}100%{transform:scale(1,1)}}
      @keyframes ckGlowPulse{0%,100%{opacity:.88;transform:translate(-50%,-50%) scale(1)}50%{opacity:1;transform:translate(-50%,-50%) scale(1.09)}}
      @keyframes ckShadowPulse{0%,100%{opacity:1;width:44%}50%{opacity:.8;width:40%}}
      .ck-ripple{position:absolute;width:0;height:0;border:2px solid var(--gold-l);border-radius:50%;pointer-events:none;z-index:6;transform:translate(-50%,-50%);animation:ckRip .5s ease-out forwards}
      @keyframes ckRip{0%{width:8px;height:8px;opacity:.7}100%{width:130px;height:130px;opacity:0}}
      .ck-flyc{position:absolute;left:0;top:0;z-index:7;pointer-events:none;will-change:transform,opacity;contain:layout style paint}
      .ck-balpop{display:inline-block;animation:ckBalPop .24s ease-out}
      @keyframes ckBalPop{0%{transform:scale(1)}45%{transform:scale(1.08)}100%{transform:scale(1)}}
      .ck-spark{position:absolute;width:7px;height:7px;border-radius:50%;background:radial-gradient(circle,rgba(216,255,122,.95),transparent 70%);pointer-events:none;z-index:0;opacity:0;animation:ckSpark linear infinite}
      @keyframes ckSpark{0%{transform:translateY(20px) scale(.6);opacity:0}25%{opacity:.7}100%{transform:translateY(-130px) scale(1);opacity:0}}
      .ck-flash{position:absolute;inset:0;z-index:7;pointer-events:none;background:radial-gradient(circle at 50% 46%,rgba(230,255,180,.85),rgba(192,255,51,.35) 30%,transparent 62%);opacity:0;animation:ckFlash .7s ease-out forwards}
      @keyframes ckFlash{0%{opacity:0;transform:scale(.5)}28%{opacity:1}100%{opacity:0;transform:scale(1.5)}}
      .ck-ghost{position:absolute;pointer-events:none;z-index:3;object-fit:contain;transition:opacity .6s ease-out,transform .6s ease-out}
      .ck-conf{position:absolute;z-index:7;pointer-events:none;border-radius:1px;will-change:transform,opacity}
      .ck-greet{display:none;margin-top:8px;align-items:center;gap:6px;background:var(--panel);border:1px solid var(--line);color:var(--gold-l);padding:4px 13px;border-radius:20px;font-weight:700;font-size:12px}
      .ck-greet.on{display:inline-flex}
      /* Платный кейс: CS2-рил (горизонтальная лента, стоп на призе) */
      .ck-case{position:absolute;inset:0;z-index:13;display:none;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(135% 100% at 50% -8%,#1B0F26,#0B0814);touch-action:none}
      .ck-case.on{display:flex}
      .ck-case__hd{position:absolute;top:18px;left:0;right:0;text-align:center;font-family:'Nunito',sans-serif;font-weight:900;font-size:16px;color:var(--cream);display:flex;align-items:center;justify-content:center;gap:7px}
      .ck-case__x{position:absolute;top:13px;right:13px;width:34px;height:34px;border:1px solid var(--line);border-radius:50%;background:rgba(0,0,0,.3);color:var(--cream);font-size:17px;cursor:pointer;z-index:3}
      .ck-case__reel{position:relative;width:100%;height:132px;overflow:hidden;background:rgba(255,255,255,.035);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
      .ck-case__reel:before,.ck-case__reel:after{content:"";position:absolute;top:0;bottom:0;width:15%;z-index:1;pointer-events:none}
      .ck-case__reel:before{left:0;background:linear-gradient(90deg,#0B0814,transparent)}
      .ck-case__reel:after{right:0;background:linear-gradient(270deg,#0B0814,transparent)}
      .ck-case__mark{position:absolute;top:-4px;bottom:-4px;left:50%;width:3px;background:linear-gradient(180deg,#D8FF7A,#8DBF20);box-shadow:0 0 14px rgba(192,255,51,.9);transform:translateX(-50%);z-index:2;border-radius:2px}
      .ck-case__track{position:absolute;top:50%;left:0;display:flex;gap:10px;transform:translate3d(0,-50%,0);will-change:transform}
      .ck-caset{width:96px;height:112px;flex:none;border-radius:14px;background:var(--panel);border:2px solid var(--line);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;box-sizing:border-box;padding:5px}
      .ck-caset[data-r="common"]{border-color:rgba(141,146,156,.5)}
      .ck-caset[data-r="rare"]{border-color:#C0FF33}
      .ck-caset[data-r="epic"]{border-color:#9B5CFF}
      .ck-caset[data-r="legendary"]{border-color:#FF2E7E;box-shadow:0 0 13px rgba(255,46,126,.45)}
      .ck-caset__pic{width:76px;height:76px;display:flex;align-items:center;justify-content:center;overflow:visible;flex:none}
      .ck-caset__pic img{display:block;width:auto;height:auto;max-width:100%;max-height:100%;object-fit:contain;object-position:center}
      .ck-caset__t{font-size:10px;font-weight:800;color:var(--muted);text-align:center;line-height:1.1;font-variant-numeric:tabular-nums}
      .ck-case__res{position:absolute;bottom:44px;left:0;right:0;text-align:center;opacity:0;transition:opacity .3s}
      .ck-case__res.on{opacity:1}
      .ck-case__res .rt{font-family:'Nunito',sans-serif;font-weight:900;font-size:22px;color:var(--gold-l);display:inline-flex;align-items:center;gap:8px}
      .ck-case__res .rs{color:var(--muted);font-size:13px;margin-top:4px}
      .ck-case__res button{margin-top:14px;border:1px solid #DFFF8F;border-radius:14px;padding:12px 30px;font-weight:800;background:linear-gradient(180deg,#D4FF6A,#A8F51E 56%,#8DBF20);color:#12210A;cursor:pointer}
      .ck-case__actions{display:flex;justify-content:center;gap:8px;flex-wrap:wrap;padding:0 12px}.ck-case__actions button{padding:11px 18px}.ck-case__actions button:disabled{opacity:.45;cursor:default}.ck-case__actions .secondary{background:rgba(255,255,255,.07);border-color:var(--line);color:var(--cream)}
      .ck-rain{position:absolute;inset:0;z-index:11;display:none;flex-direction:column;background:radial-gradient(135% 100% at 50% -8%,#1B0F26,#120D1C);touch-action:none}
      .ck-rain.on{display:flex}
      .ck-rain__hud{display:flex;align-items:center;gap:14px;padding:14px 16px;font-weight:800;font-size:15px;color:var(--cream);font-variant-numeric:tabular-nums}
      .ck-rain__hud .t{display:inline-flex;align-items:center;gap:6px}.ck-rain__hud .s{display:inline-flex;align-items:center;gap:6px;color:var(--gold-l)}.ck-rain__hud .sp{flex:1}
      .ck-rain__hud .x{width:32px;height:32px;border:1px solid var(--line);border-radius:50%;background:rgba(0,0,0,.3);color:var(--cream);font-size:16px;cursor:pointer}
      .ck-rain canvas{flex:1;width:100%;display:block;touch-action:none;cursor:pointer}
      .ck-rain__cfm{position:absolute;inset:0;z-index:3;display:flex;align-items:center;justify-content:center;background:rgba(10,6,8,.62)}
      .ck-rain__cfm .b{background:linear-gradient(180deg,#1B1526,#120D1C);border:1px solid var(--line);border-radius:18px;padding:20px;max-width:80%;text-align:center}
      .ck-rain__cfm .t{font-weight:800;font-size:18px;color:var(--cream)}
      .ck-rain__cfm .s{color:var(--muted);font-size:13px;margin:8px 0 14px;display:flex;align-items:center;justify-content:center;gap:4px;flex-wrap:wrap}
      .ck-rain__cfm .r{display:flex;gap:10px;justify-content:center}
      .ck-rain__cfm button{border:none;border-radius:13px;padding:12px 20px;font-weight:800;cursor:pointer;min-height:44px}
      .ck-rain__cfm .stay{background:linear-gradient(180deg,#D4FF6A,#A8F51E 56%,#8DBF20);color:#12210A;border:1px solid #DFFF8F}
      .ck-rain__cfm .quit{background:rgba(255,255,255,.08);color:var(--cream);border:1px solid var(--line)}
      .ck-rain__hint{position:absolute;left:0;right:0;top:48%;text-align:center;color:var(--muted);font-size:13px;pointer-events:none}
      .ck-quiz,.ck-mem,.ck-tower,.ck-gems{position:absolute;inset:0;z-index:12;display:none;flex-direction:column;background:radial-gradient(135% 100% at 50% -8%,#1B1526,#0B0814);padding:0 16px 26px;overflow:hidden;-webkit-overflow-scrolling:touch}
      .ck-quiz,.ck-mem,.ck-gems{overflow-y:auto}
      .ck-quiz.on,.ck-mem.on,.ck-tower.on,.ck-gems.on{display:flex}
      .ck-gems__grid{display:grid;gap:5px;max-width:360px;width:100%;margin:10px auto 0;padding:8px;background:rgba(0,0,0,.22);border:1px solid var(--line);border-radius:18px;box-shadow:inset 0 2px 14px rgba(0,0,0,.4)}
      .ck-gems__c{aspect-ratio:1;display:flex;align-items:center;justify-content:center;border:none;border-radius:12px;background:rgba(255,255,255,.03);cursor:pointer;padding:0;transition:transform .1s,box-shadow .15s}
      .ck-gems__c:active{transform:scale(.9)}
      .ck-gems__c.sel{background:rgba(238,191,82,.16);box-shadow:0 0 0 2px var(--gold),0 0 14px var(--gold);transform:scale(1.04)}
      .ck-gems__c .cd{width:80%;height:80%;border-radius:46% 46% 50% 50%/50%;position:relative;box-shadow:inset 0 -4px 7px rgba(0,0,0,.32),inset 0 3px 5px rgba(255,255,255,.25),0 2px 4px rgba(0,0,0,.35)}
      .ck-gems__c .cd::after{content:'';position:absolute;top:13%;left:20%;width:32%;height:24%;border-radius:50%;background:rgba(255,255,255,.6);filter:blur(.5px)}
      .cd0{background:radial-gradient(circle at 38% 30%,#ff9db4,#d11d54)}
      .cd1{background:radial-gradient(circle at 38% 30%,#ffe39a,#cf9320)}
      .cd2{background:radial-gradient(circle at 38% 30%,#c79877,#5e3a25)}
      .cd3{background:radial-gradient(circle at 38% 30%,#bdee9f,#4f9b3e)}
      .cd4{background:radial-gradient(circle at 38% 30%,#aeb8ff,#4350c0)}
      .ck-gems__c.clr{animation:ckGemPop .24s ease-out forwards}
      @keyframes ckGemPop{0%{transform:scale(1)}45%{transform:scale(1.35);filter:brightness(1.8)}100%{transform:scale(.15);opacity:0}}
      .ck-tower__score{position:absolute;left:0;right:0;top:84px;z-index:2;text-align:center;font-size:40px;font-weight:900;color:var(--gold-l);text-shadow:0 2px 14px rgba(0,0,0,.6);pointer-events:none;font-variant-numeric:tabular-nums}
      #ck-tower-cv{flex:1;width:100%;display:block;touch-action:none;cursor:pointer}
      .ck-quiz__hd{display:flex;align-items:center;gap:10px;padding:16px 0 6px;font-weight:800;font-size:16px;color:var(--cream)}
      .ck-quiz__hd .t{flex:1;display:flex;align-items:center;gap:8px;color:var(--gold-l)}
      .ck-quiz__hd .x{width:34px;height:34px;border:1px solid var(--line);border-radius:50%;background:rgba(0,0,0,.3);color:var(--cream);font-size:18px;cursor:pointer;flex:none}
      .ck-quiz__dots{display:flex;gap:6px;justify-content:center;margin:8px 0 2px}
      .ck-quiz__dots i{width:9px;height:9px;border-radius:50%;background:rgba(255,255,255,.16);transition:background .2s}
      .ck-quiz__dots i.d{background:var(--gold)}.ck-quiz__dots i.c{background:var(--gold-l);box-shadow:0 0 8px var(--gold)}
      .ck-quiz__q{margin:20px 4px;font-size:21px;font-weight:800;color:var(--ink);text-align:center;line-height:1.3;min-height:58px;display:flex;align-items:center;justify-content:center}
      .ck-quiz__opts{display:flex;flex-direction:column;gap:11px;max-width:440px;width:100%;margin:0 auto}
      .ck-quiz__o{padding:16px 18px;border-radius:15px;border:1.5px solid var(--line);background:var(--panel);color:var(--ink);font-size:17px;font-weight:700;cursor:pointer;text-align:left;transition:transform .08s,background .2s,border-color .2s}
      .ck-quiz__o:active{transform:scale(.98)}
      .ck-quiz__o.ok{background:rgba(72,187,120,.22);border-color:#48bb78;color:#c6f6d5}
      .ck-quiz__o.bad{background:rgba(229,62,62,.2);border-color:#e53e3e;color:#feb2b2}
      .ck-mem__sub{text-align:center;color:var(--muted);font-size:13px;margin:6px 0 16px;font-variant-numeric:tabular-nums}
      .ck-mem__grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;max-width:380px;width:100%;margin:0 auto}
      .ck-mem__c{position:relative;aspect-ratio:1;border:none;background:none;cursor:pointer;padding:0}
      .ck-mem__c .f,.ck-mem__c .b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;border-radius:14px;backface-visibility:hidden;-webkit-backface-visibility:hidden;transition:transform .35s;font-size:30px}
      .ck-mem__c .f{background:linear-gradient(160deg,#241830,#1B1526);border:1.5px solid var(--line);color:var(--gold-l);font-weight:800;font-size:22px}
      .ck-mem__c .b{background:var(--panel);border:1.5px solid var(--gold);transform:rotateY(180deg)}
      .ck-mem__c.show .f{transform:rotateY(180deg)}.ck-mem__c.show .b{transform:rotateY(0)}
      .ck-mem__c.match .b{border-color:#48bb78;box-shadow:0 0 12px rgba(72,187,120,.5)}
      .ck-bonus-fly{position:absolute;z-index:8;pointer-events:auto;cursor:pointer;filter:drop-shadow(0 0 13px rgba(255,212,90,.95));animation:ckBonusSpin 1.1s linear infinite}
      @keyframes ckBonusSpin{to{transform:rotate(360deg)}}
      .ck-season{position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden}
      .ck-fl{position:absolute;top:-24px;will-change:transform,opacity;animation:ckFall linear infinite}
      .ck-snow{width:7px;height:7px;border-radius:50%;background:radial-gradient(circle,#fff,rgba(255,255,255,.35) 70%);box-shadow:0 0 5px rgba(255,255,255,.55)}
      @keyframes ckFall{0%{transform:translateY(-24px) translateX(0) rotate(0);opacity:0}12%{opacity:.92}100%{transform:translateY(112vh) translateX(var(--sx,20px)) rotate(var(--rz,180deg));opacity:.3}}
      .ck-ov[data-season="ny"] .ck-catwrap::before{background:radial-gradient(ellipse at center,rgba(150,205,255,.42) 0%,rgba(120,175,245,.22) 42%,transparent 70%)}
      .ck-ov[data-season="spring"] .ck-catwrap::before,.ck-ov[data-season="love"] .ck-catwrap::before{background:radial-gradient(ellipse at center,rgba(255,165,205,.44) 0%,rgba(255,120,170,.22) 42%,transparent 70%)}
      @media (prefers-reduced-motion:reduce){.ck-cat,.ck-cat.tap,.ck-catwrap::before,.ck-catwrap::after,.ck-spark,.ck-fl{animation:none}.ck-season{display:none}}
      .ck-hat{position:absolute;pointer-events:none;filter:drop-shadow(0 4px 6px rgba(0,0,0,.3))}
      .ck-combo{position:absolute;top:17%;left:50%;transform:translateX(-50%);font-family:'Nunito',sans-serif;font-weight:800;color:var(--gold-l);text-shadow:0 2px 10px rgba(0,0,0,.6);pointer-events:none;opacity:0;font-size:24px}
      .ck-combo.show{opacity:1}
      .ck-fx{position:absolute;inset:0;pointer-events:none;z-index:6;overflow:hidden}
      .ck-boosts{display:flex;gap:10px;margin:2px 0 9px}
      .ck-boost{display:inline-flex;align-items:center;gap:6px;background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:8px 15px;min-height:44px;color:var(--cream);font-weight:700;font-size:13px;cursor:pointer}
      .ck-boost .ck-i{color:var(--gold)}.ck-boost:disabled{opacity:.4;cursor:default}
      .ck-energy{width:84%;max-width:360px;margin:0 0 16px}.ck-energy__row{display:flex;align-items:center;gap:7px;font-weight:700;font-size:13px;margin-bottom:6px;color:var(--cream);font-variant-numeric:tabular-nums}.ck-energy__row .ck-i{color:var(--gold)}.ck-energy__bar{height:11px;border-radius:8px;background:rgba(0,0,0,.34);box-shadow:inset 0 1px 2px rgba(0,0,0,.45);overflow:hidden}.ck-energy__fill{height:100%;border-radius:8px;background:linear-gradient(90deg,#8DBF20,#D8FF7A);box-shadow:0 0 7px rgba(238,191,82,.5);transition:width .25s}
      .ck-up{position:absolute;color:var(--gold-l);font-weight:800;pointer-events:none;text-shadow:0 2px 5px rgba(0,0,0,.5);z-index:7;font-variant-numeric:tabular-nums}
      .ck-coin{position:absolute;z-index:7;pointer-events:none}
      .ck-uphd{padding:16px 16px 6px;text-align:center;width:100%;box-sizing:border-box}.ck-uphd .b{font-family:'Nunito',sans-serif;font-weight:700;font-size:24px;display:inline-flex;align-items:center;gap:8px;color:var(--cream)}.ck-uphd .b .ck-i{color:var(--gold)}.ck-uphd .p{color:var(--gold);font-weight:700;font-size:13px;margin-top:3px;display:flex;align-items:center;justify-content:center;gap:5px;font-variant-numeric:tabular-nums}
      .ck-uplist{flex:1;overflow:auto;padding:6px 12px 16px;width:100%;box-sizing:border-box}
      /* ── Главная · обзор (hub) ── */
      .ck-hub{flex:1;overflow:auto;padding:14px 14px 18px;width:100%;box-sizing:border-box}
      .ck-hub__hero{text-align:center;padding:2px 0 14px}
      .ck-hub__av{width:70px;height:70px;margin:0 auto 8px;border-radius:50%;object-fit:cover;box-shadow:0 8px 22px rgba(0,0,0,.4),0 0 26px rgba(155,92,255,.32)}
      .ck-hub__name{font-family:'Nunito',sans-serif;font-weight:900;font-size:17px;color:var(--cream)}
      .ck-hub__sub{font-size:11.5px;color:var(--muted);margin-top:2px}
      .ck-duelcall{display:flex;align-items:center;gap:10px;padding:12px;margin:0 0 12px;border:1px solid rgba(255,46,126,.55);border-radius:16px;background:linear-gradient(135deg,rgba(255,46,126,.18),rgba(155,92,255,.10));box-shadow:0 8px 24px rgba(0,0,0,.24)}
      .ck-duelcall__b{flex:1;min-width:0}.ck-duelcall__b b{display:block;color:var(--ink);font-size:13.5px}.ck-duelcall__b span{display:block;color:var(--muted);font-size:11.5px;margin-top:2px}.ck-duelcall button{flex:none;border:1px solid #DFFF8F;border-radius:11px;padding:9px 11px;background:linear-gradient(180deg,#D4FF6A,#A8F51E);color:#12210A;font-weight:800;font-size:11.5px}
      .ck-bento{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .ck-tile{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px 12px}
      .ck-tile__l{display:block;font-size:9px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);margin-bottom:4px}
      .ck-tile__v{font-size:16px;font-weight:900;color:var(--cream);font-variant-numeric:tabular-nums;display:flex;align-items:center;gap:5px;white-space:nowrap}
      .ck-tile__v.lime{color:var(--gold-l)}.ck-tile__v.grape{color:var(--grape-l,#B79BFF)}
      .ck-hubrows{display:flex;flex-direction:column;gap:7px}
      .ck-row2{display:flex;align-items:center;gap:11px;background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:10px 11px;cursor:pointer;text-align:left;width:100%;font:inherit;color:inherit}
      .ck-row2:active{transform:scale(.985);filter:brightness(1.08)}
      .ck-row2__ic{width:32px;height:32px;flex:none;border-radius:9px;background:rgba(155,92,255,.14);border:1px solid rgba(155,92,255,.36);display:flex;align-items:center;justify-content:center;color:var(--grape-l,#B79BFF)}
      .ck-row2__b{flex:1;min-width:0}.ck-row2__b b{display:block;font-size:13px;font-weight:800;color:var(--cream)}.ck-row2__b i{font-style:normal;font-size:10.5px;color:var(--muted)}
      .ck-row2__ch{margin-left:auto;color:var(--muted);font-size:18px;font-weight:700}
      .ck-row2 .ck-badge{margin-left:6px}
      .ck-sect{color:var(--muted);font-weight:700;font-size:11px;margin:12px 4px 7px;text-transform:uppercase;letter-spacing:.7px}
      .ck-bank{background:linear-gradient(160deg,rgba(212,169,78,.14),rgba(212,169,78,.05));border:1px solid rgba(212,169,78,.35);border-radius:14px;padding:11px 12px;margin:0 0 10px}
      .ck-bank__hd{font-weight:800;font-size:13.5px;color:var(--gold,#D4FF6A)}
      .ck-bank__sub{color:var(--muted);font-size:11.5px;margin-top:3px}
      .ck-bank__bar{height:8px;border-radius:6px;background:rgba(0,0,0,.35);overflow:hidden;margin-top:7px}
      .ck-bank__bar i{display:block;height:100%;border-radius:6px;background:linear-gradient(90deg,#d4a94e,#f0d896);transition:width .4s}
      .ck-seg{display:flex;gap:6px;width:100%;max-width:360px;margin:2px 0 8px;padding:0 12px;box-sizing:border-box}
      .ck-seg__b{position:relative;flex:1;border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:12px;padding:9px 4px;font-weight:700;font-size:12.5px;cursor:pointer;min-height:38px}
      .ck-seg__b.on{background:linear-gradient(180deg,#D4FF6A,#A8F51E 58%,#8DBF20);color:#12210A;border-color:#DFFF8F}
      .ck-seg__b--new::after{content:'';position:absolute;top:6px;right:9px;width:8px;height:8px;border-radius:50%;background:#e5484d;box-shadow:0 0 0 2px var(--panel)}
      /* Подпись-источник под названием сегмента («за бизнесы» / «выпадают за игру») —
         цвет наследует кнопку: на золотом активе тёмная, на панели приглушённая */
      .ck-seg__sub{display:block;font-size:9px;font-weight:600;line-height:1.2;margin-top:1px;color:inherit;opacity:.75;text-transform:none;letter-spacing:0}
      .ck-badge{display:inline-flex;align-items:center;justify-content:center;position:absolute;top:1px;right:22%;min-width:15px;height:15px;padding:0 4px;border-radius:8px;background:#e5484d;color:#fff;font-size:9px;font-weight:800;line-height:1;box-shadow:0 0 0 2px rgba(18,8,11,.6)}
      .ck-badge[hidden]{display:none}
      .ck-games-hd{margin:10px 2px 2px;padding:11px 14px;border-radius:14px;background:linear-gradient(90deg,rgba(238,191,82,.16),rgba(238,191,82,.04));border:1px solid var(--line);color:var(--cream);font-size:13.5px;font-weight:700;text-align:center}.ck-games-hd b{color:var(--gold-l);font-size:16px}
      .ck-gift{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--gold-l);background:rgba(238,191,82,.1);border:1px solid var(--line);border-radius:11px;padding:8px 11px;font-weight:600;margin-top:2px}
      .ck-gift.ok{color:#9be7a8;background:rgba(72,187,120,.1)}
      .ck-gift.earned{justify-content:space-between}.ck-gift.earned span{display:flex;align-items:center;gap:7px;flex:1;min-width:0}.ck-gift.earned .ck-card__buy{flex:none}
      .ck-cats{display:flex;gap:7px;margin:0 0 10px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}.ck-cats::-webkit-scrollbar{display:none}
      .ck-cat-chip{flex:none;min-height:44px;box-sizing:border-box;border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:18px;padding:10px 15px;font-weight:700;font-size:12.5px;cursor:pointer;white-space:nowrap}
      .ck-cat-chip.on{background:linear-gradient(180deg,#D4FF6A,#A8F51E 58%,#8DBF20);color:#12210A;border-color:#DFFF8F}
      .ck-biz{display:flex;align-items:center;gap:12px;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:10px 12px;margin-bottom:9px;position:relative;opacity:0;animation:ckBizIn .34s ease-out forwards}
      @keyframes ckBizIn{0%{opacity:0;transform:translateY(9px)}100%{opacity:1;transform:none}}
      .ck-biz.locked{filter:saturate(.35) brightness(.82)}
      .ck-biz.bump{opacity:1;animation:ckBizBump .32s ease-out}@keyframes ckBizBump{0%{opacity:1;transform:scale(1)}40%{opacity:1;transform:scale(1.03)}100%{opacity:1;transform:scale(1)}}
      .ck-biz__art{width:64px;height:64px;flex:none;border-radius:14px;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;box-shadow:inset 0 1px 0 rgba(255,255,255,.14),0 3px 8px rgba(0,0,0,.3)}
      .ck-biz__art::after{content:'';position:absolute;inset:0;background:radial-gradient(circle at 32% 22%,rgba(255,255,255,.18),transparent 60%);pointer-events:none;z-index:2}
      .ck-biz__art img{width:100%;height:100%;object-fit:contain;position:relative;z-index:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
      .ck-biz__art svg{width:30px;height:30px;color:#F2FFCE;position:relative;z-index:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))}
      .cat-boost .ck-biz__art{background:linear-gradient(150deg,#C0FF33,#5E7B1E)}
      .cat-prod .ck-biz__art{background:linear-gradient(150deg,#d6a64c,#7c4a18)}
      .cat-mkt .ck-biz__art{background:linear-gradient(150deg,#cc5e72,#7a2030)}
      .cat-staff .ck-biz__art{background:linear-gradient(150deg,#4fa0ad,#1f4a55)}
      .cat-net .ck-biz__art{background:linear-gradient(150deg,#9070c2,#3f2a66)}
      .ck-biz__b{flex:1;min-width:0}.ck-biz__n{font-weight:700;font-size:15px;color:var(--ink)}
      .ck-biz__meta{display:flex;align-items:center;gap:7px;margin-top:5px;flex-wrap:wrap}
      .ck-biz__lvl{font-size:10.5px;font-weight:700;color:var(--muted);background:rgba(0,0,0,.26);padding:2px 8px;border-radius:9px;white-space:nowrap}
      .ck-biz__prof{font-size:11.5px;font-weight:700;color:var(--gold-l);font-variant-numeric:tabular-nums;white-space:nowrap}
      .ck-biz__lock{font-size:11px;font-weight:700;color:var(--muted);display:inline-flex;align-items:center;gap:4px}
      .ck-biz__buy{display:inline-flex;align-items:center;gap:5px;flex:none;border:1px solid #DFFF8F;border-radius:12px;padding:9px 13px;font-weight:800;font-size:13px;background:linear-gradient(180deg,#D4FF6A,#A8F51E 56%,#8DBF20);color:#12210A;cursor:pointer;white-space:nowrap;font-variant-numeric:tabular-nums;box-shadow:0 4px 11px rgba(165,112,28,.38),inset 0 1px 0 rgba(255,255,255,.5)}
      .ck-biz__buy:disabled{background:rgba(255,255,255,.07);color:var(--muted);border-color:transparent;box-shadow:none;cursor:default}
      .ck-dovegrid{display:grid;grid-template-columns:repeat(2,1fr);gap:9px;margin-bottom:6px}
      .ck-dove{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px 8px;text-align:center;opacity:0;animation:ckBizIn .34s ease-out forwards}
      .ck-dove.silh{cursor:pointer}
      .ck-dove.silh:active{transform:scale(.97)}
      .ck-dove__art{position:relative;width:88px;height:88px;margin:0 auto;border-radius:14px;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,rgba(238,191,82,.18),rgba(238,191,82,.04));border:1px solid var(--line);overflow:hidden}
      .ck-dove__art img{width:100%;height:100%;object-fit:contain;position:relative;z-index:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
      .ck-dove.silh .ck-dove__art img{filter:brightness(0);opacity:.3}
      .ck-dove__q{position:absolute;z-index:2;font-family:'Nunito',sans-serif;font-weight:800;font-size:34px;color:var(--muted)}
      .ck-dove__n{margin-top:7px;font-weight:700;font-size:12.5px;color:var(--ink)}
      .ck-dove.silh .ck-dove__n{color:var(--muted)}
      .ck-dove__role{font-size:10.5px;color:var(--muted);margin-top:1px}
      .ck-card{display:flex;align-items:center;gap:12px;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:11px 12px;margin-bottom:9px}
      .ck-card__ic{width:46px;height:46px;flex:none;border-radius:13px;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,rgba(238,191,82,.2),rgba(238,191,82,.04));border:1px solid var(--line);color:var(--gold-l)}
      .ck-card__b{flex:1;min-width:0}.ck-card__n{font-weight:700;font-size:15px;color:var(--ink)}.ck-card__s{color:var(--muted);font-size:12px;margin-top:2px;font-variant-numeric:tabular-nums}
      .ck-card__buy{display:inline-flex;align-items:center;gap:5px;border:1px solid #DFFF8F;border-radius:12px;padding:9px 13px;font-weight:800;font-size:13px;background:linear-gradient(180deg,#D4FF6A,#A8F51E 56%,#8DBF20);color:#12210A;cursor:pointer;white-space:nowrap;font-variant-numeric:tabular-nums;box-shadow:0 4px 11px rgba(165,112,28,.38),inset 0 1px 0 rgba(255,255,255,.5)}.ck-card__buy:disabled{background:rgba(255,255,255,.07);color:var(--muted);border-color:transparent;box-shadow:none;cursor:default}
      .ck-row{display:flex;align-items:center;gap:10px;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px 12px;margin-bottom:7px}
      .ck-row .r{width:28px;font-weight:800;color:var(--gold);text-align:center;font-variant-numeric:tabular-nums}.ck-row .n{flex:1;font-weight:600;color:var(--ink)}.ck-row .v{font-weight:700;color:var(--gold);font-size:13px;display:inline-flex;align-items:center;gap:5px;font-variant-numeric:tabular-nums}.ck-row.me{background:rgba(238,191,82,.14);border-color:rgba(238,191,82,.34)}
      .ck-bonus{display:flex;flex-direction:column;align-items:stretch;gap:10px}
      .ck-combo3{display:flex;gap:8px}
      .ck-cmb{flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;padding:10px 4px;border-radius:12px;background:rgba(0,0,0,.22);border:1px solid var(--line);color:var(--muted);font-size:10.5px;text-align:center;position:relative}
      .ck-cmb svg{width:24px;height:24px;opacity:.45}
      .ck-cmb.on{color:var(--gold-l);border-color:rgba(238,191,82,.5);background:rgba(238,191,82,.1)}.ck-cmb.on svg{opacity:1}
      .ck-cmb.on::after{content:'✓';position:absolute;top:3px;right:6px;color:var(--gold-l);font-size:11px;font-weight:800}
      .ck-morse{font-family:'JetBrains Mono',ui-monospace,monospace;letter-spacing:2px;word-spacing:12px;font-size:19px;color:var(--gold-l);text-align:center;padding:12px 8px;background:rgba(0,0,0,.26);border-radius:12px;border:1px solid var(--line)}
      .ck-cipher-in{flex:1;min-width:0;background:rgba(0,0,0,.26);border:1px solid var(--line);border-radius:12px;padding:10px 12px;color:var(--ink);font-size:14px;font-weight:700;text-transform:uppercase;outline:none}
      .ck-cipher-in::placeholder{color:var(--muted);text-transform:none;font-weight:400}
      .ck-cipher-in:focus{border-color:rgba(238,191,82,.5)}
      .ck-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:5px;margin:12px 0}
      .ck-cal-day{background:rgba(0,0,0,.22);border:1px solid var(--line);border-radius:9px;padding:7px 1px;text-align:center}
      .ck-cal-day .d{font-weight:700;color:var(--cream);font-size:11px}.ck-cal-day .a{color:var(--gold-l);font-weight:700;font-variant-numeric:tabular-nums;font-size:9.5px;margin-top:3px}
      .ck-cal-day.done{opacity:.5}.ck-cal-day.today{background:rgba(238,191,82,.16);border-color:rgba(238,191,82,.55)}
      .ck-daily.done{background:var(--panel);color:var(--muted);border-color:var(--line);box-shadow:none}
      /* Тур Василия (обучение новичка, 31.07): спотлайт-дырка + пузырь-проводник */
      /* Пульс готового клейма (комбо собрано) — мягкое золотое дыхание кнопки */
      .ck-claim-pulse{animation:ckClaimPulse 1.6s ease-in-out infinite}
      @keyframes ckClaimPulse{0%,100%{box-shadow:0 0 0 0 rgba(240,194,78,.55)}50%{box-shadow:0 0 0 9px rgba(240,194,78,0)}}
      @media (prefers-reduced-motion:reduce){.ck-claim-pulse{animation:none}}
      /* Тур живёт в document.body (поверх пет-оверлея) — переменные бренда объявляем
         на себе, снаружи .ck-ov они не каскадируются (баг «тёмный текст на тёмном») */
      .ck-tour{--gold:#C0FF33;--gold-l:#D8FF7A;--cream:#eee7dd;--ink:#f1ece6;--muted:#9aa0ab;--line:rgba(255,255,255,.14);position:fixed;inset:0;z-index:10060;pointer-events:none;font-family:'Nunito','Mulish',system-ui,-apple-system,sans-serif}
      .ck-tour__hole{position:fixed;border-radius:16px;box-shadow:0 0 0 9999px rgba(10,6,5,.72);border:2px solid var(--gold);transition:left .28s ease,top .28s ease,width .28s ease,height .28s ease}
      .ck-tour__bub{position:fixed;box-sizing:border-box;pointer-events:auto;background:linear-gradient(180deg,#1B1526,#120D1C);border:1px solid var(--gold);border-radius:18px;padding:14px;box-shadow:0 16px 44px rgba(0,0,0,.55);transition:top .28s ease,left .28s ease}
      .ck-tour__head{display:flex;gap:10px;align-items:flex-start}
      .ck-tour__head img{width:46px;height:46px;object-fit:contain;flex:none;filter:drop-shadow(0 2px 6px rgba(0,0,0,.4))}
      .ck-tour__t{font-size:14.5px;font-weight:600;color:var(--cream);line-height:1.5;padding-top:3px;letter-spacing:.1px}
      .ck-tour__row{display:flex;justify-content:space-between;align-items:center;margin-top:12px;gap:10px}
      .ck-tour__next{min-height:44px;box-sizing:border-box;border:1px solid #DFFF8F;border-radius:12px;padding:9px 22px;font-weight:800;font-size:13px;background:linear-gradient(180deg,#D4FF6A,#A8F51E 56%,#8DBF20);color:#12210A;cursor:pointer}
      .ck-tour__skip{min-height:44px;box-sizing:border-box;border:none;background:none;color:var(--muted);font-size:12px;font-weight:600;cursor:pointer;padding:8px 4px}
      @media (prefers-reduced-motion:reduce){.ck-tour__hole,.ck-tour__bub{transition:none}}
      /* «Сладкий тап» + реплики Василия (вкладка Котик, 31.07) */
      .ck-sweettap{position:absolute;left:50%;top:34%;transform:translate(-50%,-50%) scale(.6);font-family:'Nunito',sans-serif;font-weight:900;font-size:34px;letter-spacing:1px;color:#D8FF7A;text-shadow:0 0 18px rgba(240,194,78,.9),0 3px 10px rgba(0,0,0,.55);pointer-events:none;z-index:6;animation:ckSweetPop 1.05s ease-out forwards}
      @keyframes ckSweetPop{0%{opacity:0;transform:translate(-50%,-50%) scale(.6)}18%{opacity:1;transform:translate(-50%,-50%) scale(1.15)}32%{transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-86%) scale(1)}}
      .ck-say{position:absolute;left:50%;top:-6px;transform:translateX(-50%) translateY(6px);max-width:78%;background:rgba(20,12,9,.92);border:1px solid var(--line);color:var(--cream);font-weight:700;font-size:13.5px;line-height:1.35;padding:9px 14px;border-radius:14px 14px 14px 4px;box-shadow:0 8px 22px rgba(0,0,0,.4);opacity:0;transition:opacity .22s,transform .22s;pointer-events:none;z-index:6;text-align:center}
      .ck-say.show{opacity:1;transform:translateX(-50%) translateY(0)}
      @media (prefers-reduced-motion:reduce){.ck-sweettap{animation:none;opacity:1}}
      /* FTUE «Первый день»: чип-чеклист первой сессии (аудит 30.07) */
      .ck-ftue{margin-top:8px;display:inline-flex;align-items:center;gap:7px;background:rgba(0,0,0,.3);border:1px solid var(--gold);color:var(--gold-l);border-radius:12px;padding:7px 14px;font-size:12.5px;font-weight:800;cursor:pointer}
      .ck-ftue[hidden]{display:none}
      .ck-ftue b{color:#9be7a8}
      .ck-ftue:active{transform:scale(.96)}
      .ck-ftue-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);text-align:left}
      .ck-ftue-row:last-child{border-bottom:none}
      .ck-ftue-row .st{width:22px;height:22px;flex:none;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;background:rgba(255,255,255,.08);color:var(--muted)}
      .ck-ftue-row.done .st{background:linear-gradient(180deg,#9be7a8,#48bb78);color:#0b2e17}
      .ck-ftue-row .t{flex:1;min-width:0;font-size:12.5px;font-weight:700;color:var(--ink);line-height:1.35}
      .ck-ftue-row.dim .t{color:var(--muted)}
      .ck-ftue-row .ck-card__buy{padding:7px 12px;font-size:12px}
      .ck-nav{display:flex;border-top:1px solid var(--line);background:rgba(14,10,26,.55);backdrop-filter:blur(8px)}
      .ck-nav__b{flex:1;border:none;background:transparent;color:var(--muted);padding:9px 0 12px;font-weight:600;font-size:11.5px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px}.ck-nav__b.on{color:var(--gold-l)}
      .ck-levelup{position:absolute;inset:0;z-index:8;display:flex;align-items:center;justify-content:center;pointer-events:none}.ck-levelup span{font-family:'Nunito',sans-serif;color:var(--gold-l);font-weight:700;font-size:26px;background:linear-gradient(180deg,rgba(27,21,38,.94),rgba(18,13,28,.94));border:1px solid var(--line);padding:14px 24px;border-radius:18px;opacity:0;box-shadow:0 12px 36px rgba(0,0,0,.5)}.ck-levelup span.show{animation:ckLU 1.6s ease-out}@keyframes ckLU{0%{opacity:0;transform:scale(.6)}20%{opacity:1;transform:scale(1.1)}80%{opacity:1}100%{opacity:0}}
      .ck-scrim{position:absolute;inset:0;z-index:8;background:rgba(6,4,14,.55);display:none}.ck-scrim.on{display:block}
      .ck-pop{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9;background:linear-gradient(180deg,#1B1526,#120D1C);border:1px solid var(--line);border-radius:20px;padding:24px;text-align:center;box-shadow:0 18px 50px rgba(0,0,0,.6);display:none;max-width:80%}.ck-pop.on{display:block}.ck-pop h3{margin:0 0 6px;font-family:'Nunito',sans-serif;font-weight:700;font-size:20px;color:var(--cream)}.ck-pop .v{font-family:'Nunito',sans-serif;font-size:32px;font-weight:700;color:var(--gold-l);margin:10px 0;display:inline-flex;align-items:center;gap:8px;font-variant-numeric:tabular-nums}.ck-pop button{margin-top:10px;border:1px solid #DFFF8F;border-radius:14px;padding:12px 28px;font-weight:800;background:linear-gradient(180deg,#D4FF6A,#A8F51E 56%,#8DBF20);color:#12210A;cursor:pointer}
      /* ===================== ДИЗАЙН-ДОВОДКА (перенос на master) ===================== */
      .ck-ov{--cream:#eee7dd;--ink:#f1ece6;--muted:#9aa0ab;background:radial-gradient(130% 100% at 50% -10%,#1B1526 0%,#120D1C 52%,#0B0814 100%);font-family:'Nunito','Mulish',system-ui,sans-serif}
      .ck-ov button:focus-visible,.ck-ov input:focus-visible,.ck-cat:focus-visible,.ck-gems__c:focus-visible,.ck-mem__c:focus-visible,.ck-quiz__o:focus-visible,.ck-nav__b:focus-visible{outline:2px solid var(--gold-l);outline-offset:2px}
      .ck-ov[data-tier="1"]{--tg:rgba(155,92,255,.14)}.ck-ov[data-tier="2"]{--tg:rgba(155,92,255,.18)}.ck-ov[data-tier="3"]{--tg:rgba(155,92,255,.22)}.ck-ov[data-tier="4"]{--tg:rgba(155,92,255,.26)}.ck-ov[data-tier="5"]{--tg:rgba(155,92,255,.30)}.ck-ov[data-tier="6"]{--tg:rgba(192,255,51,.22)}
      .ck-ov:not(.turbo)[data-tier="1"]{background:radial-gradient(90% 56% at 50% -4%,rgba(155,92,255,.16),transparent 62%),radial-gradient(75% 45% at 82% 112%,rgba(192,255,51,.08),transparent 58%),linear-gradient(180deg,#0E0A1A,#0B0814)}
      .ck-ov:not(.turbo)[data-tier="2"]{background:radial-gradient(92% 58% at 50% -4%,rgba(155,92,255,.22),transparent 64%),radial-gradient(75% 45% at 82% 112%,rgba(192,255,51,.10),transparent 58%),linear-gradient(180deg,#0F0A1C,#0B0814)}
      .ck-ov:not(.turbo)[data-tier="3"]{background:radial-gradient(96% 60% at 50% -3%,rgba(155,92,255,.28),transparent 66%),radial-gradient(78% 46% at 82% 112%,rgba(192,255,51,.11),transparent 58%),linear-gradient(180deg,#0F0A1E,#0B0814)}
      .ck-ov:not(.turbo)[data-tier="4"]{background:radial-gradient(98% 62% at 50% -3%,rgba(155,92,255,.32),transparent 66%),radial-gradient(80% 48% at 82% 112%,rgba(255,46,126,.10),transparent 58%),linear-gradient(180deg,#100A20,#0B0814)}
      .ck-ov:not(.turbo)[data-tier="5"]{background:radial-gradient(100% 64% at 50% -3%,rgba(155,92,255,.36),transparent 66%),radial-gradient(80% 48% at 82% 112%,rgba(255,46,126,.12),transparent 58%),linear-gradient(180deg,#110A22,#0B0814)}
      .ck-ov:not(.turbo)[data-tier="6"]{background:radial-gradient(115% 70% at 50% -5%,rgba(192,255,51,.30),transparent 68%),radial-gradient(80% 48% at 20% 112%,rgba(155,92,255,.28),transparent 60%),linear-gradient(180deg,#0F1208,#0B0814)}
      .ck-ov[data-tier="1"] .ck-catwrap::before{background:radial-gradient(circle at 50% 46%,rgba(192,255,51,.34) 0%,rgba(155,92,255,.34) 46%,transparent 71%)}
      .ck-ov[data-tier="2"] .ck-catwrap::before{background:radial-gradient(circle at 50% 46%,rgba(192,255,51,.40) 0%,rgba(155,92,255,.40) 46%,transparent 71%)}
      .ck-ov[data-tier="3"] .ck-catwrap::before{background:radial-gradient(circle at 50% 46%,rgba(192,255,51,.46) 0%,rgba(155,92,255,.44) 46%,transparent 72%)}
      .ck-ov[data-tier="4"] .ck-catwrap::before{background:radial-gradient(circle at 50% 46%,rgba(155,92,255,.52) 0%,rgba(255,46,126,.30) 46%,transparent 71%)}
      .ck-ov[data-tier="5"] .ck-catwrap::before{background:radial-gradient(circle at 50% 46%,rgba(192,255,51,.46) 0%,rgba(255,46,126,.34) 46%,transparent 71%)}
      .ck-ov[data-tier="6"] .ck-catwrap::before{background:radial-gradient(circle at 50% 46%,rgba(192,255,51,.60) 0%,rgba(155,92,255,.46) 46%,transparent 73%)}
      .ck-catwrap{align-items:flex-end;padding-bottom:16px;isolation:isolate}
      .ck-catwrap::before{top:62%;z-index:1}.ck-catwrap::after{bottom:8%;z-index:1}.ck-cat{z-index:2}
      /* Ранние спрайты (котёнок stage1 / стажёр stage2) нарисованы мельче в кадре —
         рендерим их крупнее, чтобы кот был виден в полный рост, а не терялся у бустов */
      .ck-ov[data-tier="1"] .ck-cat{max-width:90%;max-height:99%}
      .ck-ov[data-tier="2"] .ck-cat{max-width:76%;max-height:97%}
      .ck-ov[data-tier="3"] .ck-cat{max-width:66%}
      .ck-scene{position:absolute;inset:0;z-index:0;background-position:center center;background-size:cover;background-repeat:no-repeat;filter:brightness(.62) saturate(.92)}
      .ck-scene::after{content:'';position:absolute;inset:0;background:radial-gradient(70% 42% at 50% 46%,transparent,rgba(0,0,0,.34) 100%),linear-gradient(180deg,rgba(0,0,0,.74),rgba(0,0,0,.34) 16%,transparent 38%,transparent 60%,rgba(0,0,0,.52) 88%,rgba(0,0,0,.66))}
      ${Array.from({ length: 19 }, (_, i) => `.ck-ov[data-tier="${i + 1}"] .ck-scene{background-image:url(/assets/images/scene/career-${i + 1}.webp?v=2)}`).join('')}
      #ck-scr-cat>:not(.ck-scene){position:relative;z-index:1}
      .ck-combo{z-index:8;top:13%}
      .ck-lvl{text-shadow:0 1px 4px rgba(0,0,0,.75)}.ck-prog__t{color:#c2c7cf;text-shadow:0 1px 3px rgba(0,0,0,.8)}
      .ck-screen.on{animation:ckScreenIn .22s ease-out}@keyframes ckScreenIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
      .ck-nav__b{position:relative;transition:color .18s}.ck-nav__b.on::before{content:'';position:absolute;top:0;left:50%;transform:translateX(-50%);width:24px;height:3px;border-radius:0 0 3px 3px;background:var(--gold);box-shadow:0 0 8px var(--gold)}
      .ck-nav__b.locked{opacity:.42}
      .ck-intro{text-align:center;color:var(--muted);font-size:12px;line-height:1.45;margin:0 0 12px;padding:0 6px}
      .ck-today{display:flex;flex-wrap:wrap;align-items:center;gap:6px;background:rgba(0,0,0,.22);border:1px solid var(--line);border-radius:13px;padding:9px 11px;margin:0 0 12px}
      .ck-today__t{font-size:9px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:var(--muted);width:100%}
      .ck-today__i{font-size:11px;font-weight:800;color:var(--muted);background:rgba(255,255,255,.05);border-radius:8px;padding:4px 8px}
      .ck-today__i.pend{color:#12210A;background:linear-gradient(180deg,#D4FF6A,#A8F51E)}
      .ck-today__i.done{color:#9be7a8;background:rgba(155,231,168,.1)}
      .ck-navlk{position:absolute;top:2px;right:11%;font-size:8px;font-weight:800;color:var(--gold-l);background:rgba(0,0,0,.6);padding:1px 4px;border-radius:6px;line-height:1.35}
      .ck-nav-pop{animation:ckNavPop .8s ease-out}
      @keyframes ckNavPop{0%,100%{transform:none}30%{transform:translateY(-5px) scale(1.14)}}
      .cat-staff .ck-biz__art{background:linear-gradient(150deg,#8fae4f,#3f5e1e)}.cat-net .ck-biz__art{background:linear-gradient(150deg,#6f76c2,#2f3470)}
      .ck-card__buy,.ck-biz__buy{min-height:44px;box-sizing:border-box}
      .ck-skel{position:relative;overflow:hidden;background:rgba(255,255,255,.05)}.ck-skel::after{content:'';position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,rgba(255,255,255,.10),transparent);animation:ckShimmer 1.2s ease-in-out infinite}@keyframes ckShimmer{100%{transform:translateX(100%)}}
      .ck-skrow{display:flex;align-items:center;gap:10px;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px 12px;margin-bottom:7px}.ck-skrow .sk-r{width:24px;height:24px;border-radius:50%;flex:none}.ck-skrow .sk-n{height:12px;border-radius:6px;flex:1}.ck-skrow .sk-v{width:62px;height:12px;border-radius:6px;flex:none}
      .ck-empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:30px 18px;color:var(--muted)}.ck-empty__ic{width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(238,191,82,.08);border:1px solid var(--line);color:var(--gold);margin-bottom:12px}.ck-empty__ic svg{width:30px;height:30px}.ck-empty__t{font-weight:800;font-size:15px;color:var(--cream);margin-bottom:4px}.ck-empty__s{font-size:12.5px;line-height:1.5;max-width:240px}
      @media (prefers-reduced-motion:reduce){.ck-screen.on,.ck-skel::after,.ck-conf,.ck-coin,.ck-flyc,.ck-ripple,.ck-flash,.ck-balpop,.ck-bonus-fly,.ck-coach{animation:none!important}}
      /* Онбординг-туториал (показ один раз) */
      .ck-tut{position:absolute;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;box-sizing:border-box;background:rgba(8,5,6,.74);backdrop-filter:blur(4px);padding:24px;animation:ckScreenIn .25s ease-out}
      .ck-tut__card{max-width:330px;width:100%;max-height:100%;overflow-y:auto;overscroll-behavior:contain;box-sizing:border-box;background:linear-gradient(180deg,#1B1526,#120D1C);border:1px solid var(--line);border-radius:22px;padding:22px 20px;text-align:center;box-shadow:0 18px 50px rgba(0,0,0,.6)}
      .ck-tut__ic{width:64px;height:64px;margin:0 auto 10px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 38% 30%,rgba(255,227,156,.28),rgba(238,191,82,.08));border:1px solid var(--line);color:var(--gold-l)}
      .ck-tut h3{margin:0 0 4px;font-family:'Nunito',sans-serif;font-weight:700;font-size:21px;color:var(--cream)}
      .ck-tut__sub{color:var(--muted);font-size:12.5px;line-height:1.45;margin-bottom:14px}
      .ck-tut__step{display:flex;align-items:center;gap:12px;text-align:left;background:rgba(255,255,255,.04);border:1px solid var(--line);border-radius:14px;padding:10px 12px;margin-bottom:9px}
      .ck-tut__step .si{width:38px;height:38px;flex:none;border-radius:11px;display:flex;align-items:center;justify-content:center;background:linear-gradient(150deg,#C0FF33,#5E7B1E);color:#120D1C}
      .ck-tut__step .st{font-weight:700;font-size:13.5px;color:var(--ink)}.ck-tut__step .sd{font-size:11.5px;color:var(--muted);margin-top:1px}
      .ck-tut__go{margin-top:6px;width:100%;border:1px solid #DFFF8F;border-radius:14px;padding:13px;font-weight:800;font-size:16px;background:linear-gradient(180deg,#D4FF6A,#A8F51E 56%,#8DBF20);color:#12210A;cursor:pointer}
      @media (max-height:620px){.ck-tut{padding:8px 12px}.ck-tut__card{padding:14px 16px}.ck-tut__ic{width:48px;height:48px;margin-bottom:7px}.ck-tut__step{padding:8px 10px;margin-bottom:7px}}
      /* Цель «следующий котик» у прогресс-бара */
      .ck-progwrap{display:flex;align-items:center;justify-content:center;gap:12px;width:84%;max-width:380px;margin-top:10px}
      .ck-progwrap .ck-prog{width:auto;flex:1;min-width:0;margin-top:0}
      .ck-goal{display:flex;flex-direction:column;align-items:center;gap:3px;flex:none;width:58px;text-align:center}
      .ck-goal[hidden]{display:none}
      .ck-goal__av{width:42px;height:42px;border-radius:50%;border:2px solid var(--gold);background:rgba(0,0,0,.4);box-shadow:0 0 12px rgba(238,191,82,.4),inset 0 1px 3px rgba(0,0,0,.5);overflow:hidden;display:flex;align-items:center;justify-content:center}
      .ck-goal__av img{width:132%;height:132%;object-fit:contain;filter:saturate(1.05) brightness(.92);opacity:.95;transform:translateY(9%)}
      .ck-goal__l{font-size:8.5px;font-weight:800;color:var(--gold-l);text-shadow:0 1px 3px rgba(0,0,0,.85);line-height:1.05;letter-spacing:.2px;max-width:58px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
      /* Эскалация комбо */
      .ck-combo[data-tier="1"]{color:#D8FF7A;text-shadow:0 0 14px rgba(255,170,60,.7),0 2px 10px rgba(0,0,0,.6)}
      .ck-combo[data-tier="2"]{color:#ff9d4d;text-shadow:0 0 18px rgba(255,120,30,.85),0 2px 10px rgba(0,0,0,.6)}
      .ck-combo[data-tier="3"]{color:#ff6a4d;text-shadow:0 0 26px rgba(255,70,40,.95),0 2px 12px rgba(0,0,0,.7)}
      @keyframes ckcombopop{0%{transform:translateX(-50%) scale(.62)}55%{transform:translateX(-50%) scale(1.16)}100%{transform:translateX(-50%) scale(1)}}
      .ck-combo.pop{animation:ckcombopop .26s ease-out}
      @keyframes ckcatshake{0%,100%{transform:translate(0,0)}20%{transform:translate(-5px,2px)}40%{transform:translate(5px,-2px)}60%{transform:translate(-4px,1px)}80%{transform:translate(4px,-1px)}}
      .ck-catwrap.ck-shake{animation:ckcatshake .42s ease-in-out}
      .ck-burst{position:absolute;width:9px;height:9px;border-radius:50%;background:radial-gradient(circle,#fff,#D8FF7A 60%,rgba(255,170,60,0));box-shadow:0 0 8px rgba(255,200,90,.85);pointer-events:none;transition:transform .5s ease-out,opacity .5s}
      /* Подсказка «энергия кончилась» */
      @keyframes ckenshake{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
      .ck-energy.shake{animation:ckenshake .42s ease-in-out}
      #ck-scr-cat .ck-ehint{position:absolute;left:50%;bottom:18px;transform:translateX(-50%) translateY(10px);width:min(330px,88%);box-sizing:border-box;background:linear-gradient(180deg,rgba(42,32,28,.98),rgba(28,21,19,.98));border:1px solid var(--gold);border-radius:16px;padding:14px 16px;box-shadow:0 14px 44px rgba(0,0,0,.55);display:flex;flex-direction:column;gap:9px;z-index:30;opacity:0;transition:opacity .25s,transform .25s}
      #ck-scr-cat .ck-ehint.show{opacity:1;transform:translateX(-50%) translateY(0)}
      .ck-ehint__h{display:flex;align-items:center;gap:8px;font-family:'Nunito',sans-serif;font-weight:800;color:var(--gold-l);font-size:15.5px}
      .ck-ehint__h .ck-i{color:var(--gold)}
      .ck-ehint__s{font-size:12.5px;color:var(--muted);line-height:1.45}
      .ck-ehint__btn{margin-top:2px;border:1px solid #DFFF8F;border-radius:12px;padding:11px;font-weight:800;font-size:14px;background:linear-gradient(180deg,#D4FF6A,#A8F51E 56%,#8DBF20);color:#12210A;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px;box-shadow:0 4px 11px rgba(165,112,28,.38),inset 0 1px 0 rgba(255,255,255,.5)}
      .ck-ehint__btn .ck-i{color:#12210A}
      @media (prefers-reduced-motion:reduce){.ck-combo.pop,.ck-catwrap.ck-shake,.ck-burst,.ck-energy.shake,#ck-scr-cat .ck-ehint{animation:none!important;transition:none!important}}
      /* Ивент-баннер + престиж (#9) */
      .ck-event{margin-top:5px;padding:5px 13px;border-radius:20px;font-size:12px;font-weight:800;color:#12210A;background:linear-gradient(90deg,#D4FF6A,#C0FF33);box-shadow:0 3px 12px rgba(238,191,82,.4);display:inline-flex;align-items:center;gap:6px}
      .ck-event[hidden]{display:none}.ck-event b{font-weight:900}.ck-event .ck-i{color:#12210A}
      .ck-pbadge{display:inline-flex;align-items:center;gap:3px;font-size:10.5px;font-weight:800;color:#3a230c;background:linear-gradient(90deg,#D8FF7A,#e0a93a);padding:1px 7px;border-radius:9px;vertical-align:1px;box-shadow:0 1px 4px rgba(0,0,0,.3)}
      .ck-pbadge .ck-i{color:#12210A}.ck-pbadge--sm{font-size:9.5px;padding:0 6px}
      .ck-pbadge--baron{background:linear-gradient(90deg,#d8c6ff,#9070c2);color:#2c1a4a}.ck-pbadge--baron .ck-i{color:#2c1a4a}
      .ck-prestige{margin-top:9px;border:1px solid #DFFF8F;border-radius:13px;padding:9px 16px;font-weight:800;font-size:13px;background:linear-gradient(180deg,#D4FF6A,#8DBF20);color:#12210A;cursor:pointer;display:inline-flex;align-items:center;gap:7px;box-shadow:0 4px 12px rgba(165,112,28,.4)}
      .ck-prestige[hidden]{display:none}.ck-prestige .ck-i{color:#12210A}
      /* Коуч-хинты новичку (одноразовые тултипы — см. coach()) */
      .ck-coach{position:fixed;z-index:50;max-width:250px;background:linear-gradient(180deg,#1B1526,#120D1C);border:1px solid rgba(238,191,82,.55);border-radius:16px;padding:11px 13px;box-shadow:0 12px 30px rgba(0,0,0,.55);font-family:'Nunito','Inter',system-ui,sans-serif;animation:ckCoachIn .18s ease-out}
      @keyframes ckCoachIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
      .ck-coach__arr{position:absolute;width:12px;height:12px;left:50%;background:#120D1C;border:1px solid rgba(238,191,82,.55);transform:translateX(-50%) rotate(45deg)}
      .ck-coach__arr.top{top:-7px;border-right:none;border-bottom:none}
      .ck-coach__arr.bottom{bottom:-7px;border-left:none;border-top:none}
      .ck-coach__row{display:flex;align-items:flex-start;gap:8px}
      .ck-coach__ic{flex:none;color:#D8FF7A;margin-top:1px}
      .ck-coach__t{font-size:12.5px;line-height:1.42;color:#eee7dd}
      .ck-coach__ok{display:block;margin:9px 0 0 auto;border:1px solid #DFFF8F;border-radius:10px;padding:10px 16px;font-weight:800;font-size:12px;background:linear-gradient(180deg,#D4FF6A,#A8F51E 56%,#8DBF20);color:#12210A;cursor:pointer}
      .ck-coach-glow{outline:2px solid rgba(238,191,82,.85);outline-offset:3px;border-radius:10px}
      /* Гайд «Как играть» — полный справочник по механикам, открывается кнопкой ? и из тьюториала */
      .ck-guide-btn{position:absolute;top:12px;left:max(12px,calc(50% - 228px));z-index:9;width:34px;height:34px;border:1px solid rgba(238,191,82,.55);border-radius:50%;background:rgba(0,0,0,.28);color:var(--gold-l);font-weight:800;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center}
      .ck-guide-btn::after{content:'';position:absolute;inset:-7px;border-radius:50%}
      .ck-guide{position:absolute;inset:0;z-index:20000;display:none;flex-direction:column;width:100%;max-width:none;transform:none;background:linear-gradient(180deg,#1B1526,#120D1C);animation:ckGuideIn .18s ease-out}
      .ck-guide.on{display:flex}
      @keyframes ckGuideIn{from{opacity:0}to{opacity:1}}
      @media (prefers-reduced-motion:reduce){.ck-guide{animation:none}}
      .ck-guide__hd{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px 16px 10px;flex:none}
      .ck-guide__t{display:flex;align-items:center;gap:8px;font-family:'Nunito',sans-serif;font-weight:800;font-size:19px;color:var(--cream)}
      .ck-guide__t .ck-i{color:var(--gold-l)}
      .ck-guide__x{width:34px;height:34px;flex:none;border:1px solid var(--line);border-radius:50%;background:rgba(0,0,0,.28);color:var(--cream);font-size:17px;cursor:pointer}
      .ck-guide__body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:4px 16px 26px}
      .ck-guide__card{display:flex;gap:12px;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:13px 14px;margin-bottom:10px}
      .ck-guide__ic{width:40px;height:40px;flex:none;border-radius:12px;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,rgba(238,191,82,.2),rgba(238,191,82,.04));border:1px solid var(--line);color:var(--gold-l)}
      .ck-guide__b{min-width:0}
      .ck-guide__n{font-weight:800;font-size:14.5px;color:var(--ink);margin-bottom:4px}
      .ck-guide__s{font-size:13px;line-height:1.5;color:var(--cream);opacity:.88}
      .ck-tut__guide{display:flex;align-items:center;justify-content:center;min-height:44px;box-sizing:border-box;margin-top:4px;width:100%;border:none;background:none;color:var(--gold-l);font-weight:700;font-size:12.5px;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
    `;
    document.head.appendChild(s);
  }

  function build() {
    styles();
    ov = document.createElement('div'); ov.className = 'ck-ov';
    ov.innerHTML = `
      ${COIN_SPRITE}
      <button class="ck-x" id="ck-x" type="button" aria-label="Закрыть игру">×</button>
      <div class="ck-screen on" id="ck-scr-cat">
        <button class="ck-daily" id="ck-daily" style="display:none"></button>
        <div class="ck-lvl" id="ck-lvl"></div>
        <div class="ck-greet" id="ck-greet"></div>
        <div class="ck-bal">${COIN(32)} <span id="ck-bal">0</span></div>
        <div class="ck-prof" id="ck-prof">${COIN(14)} +0 / час</div>
        <div class="ck-event" id="ck-event" hidden></div>
        <button class="ck-event" id="ck-shop-offer" hidden type="button" aria-label="Открыть предложение Марии"></button>
        <div id="ck-shop-actions" hidden style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap"><button class="ck-event" id="ck-shop-point" type="button">📍 Найти точку</button><button class="ck-event" id="ck-shop-site" type="button">🛒 Заказать на сайте</button><div style="width:100%;font-size:11px;color:var(--muted);text-align:center;margin-top:2px">Переход сам по себе не даёт награду. Монеты начисляются только после оплаченного и подтверждённого заказа.</div></div>
        <button class="ck-ftue" id="ck-ftue" hidden></button>
        <div class="ck-progwrap"><div class="ck-prog"><div class="ck-prog__bar"><div class="ck-prog__fill" id="ck-prog"></div></div><div class="ck-prog__t" id="ck-progt"></div></div><div class="ck-goal" id="ck-goal" hidden><div class="ck-goal__av"><img id="ck-goal-img" alt="" draggable="false"/></div><div class="ck-goal__l" id="ck-goal-l"></div></div></div>
        <button class="ck-prestige" id="ck-prestige" hidden></button>
        <div class="ck-scene" id="ck-scene"></div>
        <div class="ck-catwrap" id="ck-catwrap" role="button" tabindex="0" aria-label="Тапнуть Василия и заработать монеты"><img class="ck-cat" id="ck-cat" draggable="false" alt="Василий"/><img class="ck-hat" id="ck-hat" draggable="false" alt="" style="display:none"/><div class="ck-combo" id="ck-combo"></div></div>
        <div class="ck-boosts">
          <button class="ck-boost" id="ck-bt-turbo">${ICON.rocket(16)} Турбо <span id="ck-bt-turbo-n"></span></button>
          <button class="ck-boost" id="ck-bt-energy">${ICON.bolt(16)} Энергия <span id="ck-bt-energy-n"></span></button>
        </div>
        <div class="ck-energy"><div class="ck-energy__row" id="ck-enrow"><span id="ck-enpre">${ICON.bolt(15)}</span> <span id="ck-en">0</span> / <span id="ck-enmax">1000</span></div><div class="ck-energy__bar"><div class="ck-energy__fill" id="ck-enfill"></div></div></div>
      </div>
      <div class="ck-screen" id="ck-scr-up"><div class="ck-uphd"><div class="ck-bal" style="justify-content:center;font-size:30px">${COIN(26)} <span id="ck-bal2">0</span></div><div class="p" id="ck-prof2">${COIN(13)} +0 / час</div></div><div class="ck-uplist" id="ck-uplist"></div></div>
      <div class="ck-screen" id="ck-scr-dove"><div class="ck-uphd"><div class="b">${ICON.dove(22)} Голубятня</div></div>
        <div class="ck-uplist" id="ck-dove-col"></div></div>
      <div class="ck-screen" id="ck-scr-tasks"><div class="ck-uphd"><div class="b">${ICON.gift(22)} Призы</div></div><div class="ck-uplist" id="ck-taskslist"></div></div>
      <div class="ck-screen" id="ck-scr-top"><div class="ck-uphd"><div class="b">${ICON.trophy(22)} Рейтинг</div><div class="p" id="ck-myrank"></div></div><div class="ck-uplist" id="ck-toplist"></div></div>
      <div class="ck-screen" id="ck-scr-hub"><div class="ck-hub" id="ck-hub-body"></div></div>
      <div class="ck-fx" id="ck-fx"></div>
      <div class="ck-levelup" id="ck-levelup"><span id="ck-levelup-t"></span></div>
      <div class="ck-scrim" id="ck-scrim"></div>
      <div class="ck-pop" id="ck-pop"></div>
      <div class="ck-guide" id="ck-guide">
        <div class="ck-guide__hd"><div class="ck-guide__t">${ICON.list(20)} Как играть</div><button class="ck-guide__x" id="ck-guide-x" type="button" aria-label="Закрыть">×</button></div>
        <div class="ck-guide__body" id="ck-guide-body"></div>
      </div>
      <div class="ck-nav">
        <button class="ck-nav__b" data-tab="hub">${ICON.home(21)}Главная</button>
        <button class="ck-nav__b on" data-tab="cat">${ICON.paw(21)}Котик</button>
        <button class="ck-nav__b" data-tab="up">${ICON.bolt(21)}Прокачка</button>
        <button class="ck-nav__b" data-tab="dove">${ICON.dove(21)}Голуби<span class="ck-badge" id="ck-dove-badge" hidden></span></button>
        <button class="ck-nav__b" data-tab="tasks">${ICON.gift(21)}Призы<span class="ck-badge" id="ck-tasks-badge" hidden></span></button>
        <button class="ck-nav__b" data-tab="top">${ICON.trophy(21)}Рейтинг</button>
      </div>
      <button class="ck-guide-btn" id="ck-guide-btn" type="button" aria-label="Как работает этот раздел">?</button>`;
    document.body.appendChild(ov);
    const xBtn = ov.querySelector('#ck-x');
    if (PURE) {
      // Выходить «в магазин» некуда: в Mini App крестик закрывает приложение, в госте скрыт.
      if (window.App && App.platform !== 'guest') xBtn.onclick = () => { void flushForPageExit(); try { App.close(); } catch (_) {} };
      else xBtn.style.display = 'none';
    } else xBtn.onclick = close;
    const catWrap = ov.querySelector('#ck-catwrap');
    catWrap.addEventListener('pointerdown', onTap); // тап-зона = вся арена с глоу, не только спрайт кота
    catWrap.addEventListener('pointerup', releaseTapPointer);
    catWrap.addEventListener('pointercancel', releaseTapPointer);
    catWrap.addEventListener('lostpointercapture', releaseTapPointer);
    catWrap.addEventListener('pointerleave', releaseTapPointer);
    catWrap.addEventListener('keydown', (e) => {
      if ((e.key !== 'Enter' && e.key !== ' ') || e.repeat) return;
      const r = catWrap.getBoundingClientRect();
      onTap({ preventDefault: () => e.preventDefault(), clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
    });
    attachCatRetry(ov.querySelector('#ck-cat'));
    ov.querySelector('#ck-daily').onclick = dailyBtn;
    ov.querySelector('#ck-bt-turbo').onclick = () => boost('turbo');
    ov.querySelector('#ck-bt-energy').onclick = () => boost('energy');
    ov.querySelector('#ck-prestige').onclick = prestigeConfirm;
    ov.querySelectorAll('.ck-nav__b').forEach(b => b.onclick = () => setTab(b.dataset.tab));
    ov.querySelector('#ck-guide-btn').onclick = () => { window.haptic && window.haptic('light'); openGuide(); };
    ov.querySelector('#ck-guide-x').onclick = closeGuide;
    ov.querySelector('#ck-guide-body').innerHTML = guideHtml();
    // Скрим под #ck-pop: фон перестаёт быть кликабельным, тап по нему закрывает попап
    // через собственную кнопку попапа (у welcome-попапа на закрытии висит POST /seen).
    const pop0 = ov.querySelector('#ck-pop'), scrim = ov.querySelector('#ck-scrim');
    new MutationObserver(() => scrim.classList.toggle('on', pop0.classList.contains('on'))).observe(pop0, { attributes: true, attributeFilter: ['class'] });
    scrim.onclick = () => { const okb = pop0.querySelector('#ck-pop-ok'); if (okb) okb.click(); else pop0.classList.remove('on'); };
    ckDiagWireTapTrigger();
  }

  // ── Гайд «Как играть» — полный справочник по механикам (кнопка ? / ссылка в тьюториале) ──
  function guideSections() {
    const s = [
      { ic: ICON.tap(20), t: 'Тап и комбо', d: 'Тапай Василия — каждый тап приносит монеты и расходует 2 энергии. Одна единица энергии возвращается за 4 секунды. Держи темп без пауз дольше пяти тапов подряд — над котиком загорится комбо-счётчик ×N, а на каждой десятке комбо экран вспыхивает искрами.' },
      { ic: ICON.star(20), t: 'Уровни и карьера Василия', d: 'Монеты, заработанные в текущем цикле карьеры, двигают Василия по лестнице из девятнадцати ступеней — от Котёнка-стажёра до Императора выпечки. После престижа счётчик цикла начинается заново, но уже открытые разделы остаются доступны. На каждом новом уровне у кота меняется образ и сцена вокруг — костюм, атрибуты, фон. Полоска под балансом показывает прогресс до следующего уровня, а рядом — силуэт того, кем Василий станет дальше.' },
      { ic: ICON.rocket(20), t: 'Бусты', d: 'Турбо и Энергия — два бесплатных буста на вкладке «Котик». Турбо на 20 секунд даёт монеты за тап ×5, Энергия сразу наполняет шкалу энергии до максимума. Каждый буст доступен до 6 раз в день, а на следующий день лимит обновляется — счётчик рядом с кнопкой показывает, сколько попыток осталось.' },
      { ic: ICON.shop(20), t: 'Прокачка и бизнесы', d: 'В «Прокачке» — четыре направления: Производство, Маркетинг, Персонал и Сеть. Каждый бизнес, который ты завёл, дальше сам приносит монеты в час — после закрытия игры доход копится максимум 3 часа, а следующий уровень бизнеса поднимает доход ещё выше. Часть бизнесов открывается только с определённого уровня игрока — до этого карточка показана силуэтом с замком. Там же можно докупить Мультитап (больше монет за тап) и Запас энергии (выше потолок энергии).' },
      { ic: ICON.gift(20), t: 'Награда дня', d: 'Каждый день, когда заходишь в игру впервые, тебе доступна награда дня — забери её кнопкой сверху экрана. Награда растёт вместе со стриком: чем больше дней подряд ты заходишь, тем она весомее, а пропущенный день сбрасывает счётчик. Календарь на семь дней вперёд показывает, сколько причитается в каждый из ближайших дней.' },
      { ic: ICON.gem(20), t: 'Комбо дня', d: 'В «Прокачке» каждый день выбираются три случайных бизнеса — прокачай (купи хотя бы один уровень) все три, и получишь бонус +12 000 монет. Бизнес на максимальном уровне засчитывается автоматически. Забрать бонус можно на вкладке «Призы». Комбо обновляется раз в сутки.' },
      { ic: ICON.chest(20), t: 'Сундук и кейс', d: 'Сундук удачи открывается бесплатно раз в день. Платный Кейс удачи стоит 100 000: в нём голуби, ранние уровни бизнесов и шанс 0,05% выиграть 10 млн. Можно сделать до 10 прокрутов в сутки; после пяти неокупившихся открытий следующая доступная попытка как минимум окупается.' },
      { ic: ICON.dove(20), t: 'Голубятня', d: 'Каждый голубь добавляет монеты к доходу в час; звёзды и тюнинг усиливают вклад. Голубей можно отправлять на задания с таймером и шансом успеха. До трёх любимцев можно выбрать для показа рядом со своим именем в рейтинге — на силу и доход этот выбор не влияет.' },
      { ic: ICON.trophy(20), t: 'Рейтинг и команды', d: 'Рейтинг недели показывает игроков по количеству монет, заработанных с начала недели — отсчёт идёт с понедельника. В команде общий счёт складывается из очков участников, а копилка стаи наполняется общими вкладами: при достижении цели доход всей стаи умножается на ×1,25 до конца недели.' },
      { ic: ICON.users(20), t: 'Друзья', d: 'Позови друга в игру по своей ссылке — как только он присоединится, тебе начислится 30 000 монет, а другу — 2 500 монет на старт. Ссылку можно скопировать или отправить прямо из игры кнопкой «Позвать».' },
    ];
    s.push({ ic: ICON.list(20), t: 'Призы и задания', d: 'На вкладке «Призы» — простые поручения за монеты: заглянуть на сайт «Марии», оставить отзыв, пригласить друга или просто держать серию заходов и баланс. Выполнил условие — жми кнопку с наградой рядом с заданием. Ниже, в Достижениях — более долгие цели вроде количества тапов, уровня, собранных бизнесов или дней подряд, тоже с наградой в монетах.' });
    s.push({ ic: ICON.medal(20), t: 'Награды за прогресс', d: 'Доходишь до нужного уровня, собираешь коллекцию бизнесов или приглашаешь друзей — и получаешь игровые призы. Баллы на карту клуба «Мария» и купоны доступны в авторизованной игре.' });
    return s;
  }
  function guideHtml() {
    return guideSections().map(x => `<div class="ck-guide__card"><div class="ck-guide__ic">${x.ic}</div><div class="ck-guide__b"><div class="ck-guide__n">${x.t}</div><div class="ck-guide__s">${x.d}</div></div></div>`).join('');
  }
  function openGuide() {
    if (!ov) return;
    closeActiveCoach();
    const g = ov.querySelector('#ck-guide'); if (!g) return;
    g.classList.add('on');
    const body = ov.querySelector('#ck-guide-body');
    if (body) {
      body.scrollTop = 0;
      // «Пройти обучение заново» — перезапуск тура Василия из гайда (один раз вставляем)
      if (!body.querySelector('#ck-guide-tour')) {
        const b = document.createElement('button');
        b.id = 'ck-guide-tour';
        b.className = 'ck-card__buy';
        b.style.cssText = 'width:100%;justify-content:center;margin:2px 0 12px';
        b.innerHTML = `${ICON.paw(15)} Пройти обучение с Василием`;
        b.onclick = () => {
          // Полный перепросмотр онбординга: welcome-карта + все 6 туров + коучи
          try {
            ['cat', 'up', 'dove', 'col', 'tasks', 'top', 'hub'].forEach(k => localStorage.removeItem('ck_tour3_' + k));
            localStorage.removeItem('ck_tut_v1');
            localStorage.removeItem('ck_dove_col_seen');
            Object.keys(localStorage).filter(k => k.indexOf('ck_coach_') === 0).forEach(k => localStorage.removeItem(k));
          } catch (e) {}
          coachSeenMem.clear();
          closeGuide();
          if (tab !== 'cat') setTab('cat');
          setTimeout(showTutorial, 250);
        };
        body.prepend(b);
      }
    }
  }
  function closeGuide() { const g = ov && ov.querySelector('#ck-guide'); if (g) g.classList.remove('on'); }

  // ── Вкладка «Голуби» = альбом пород (window.CatDove, public/js/catdove.js).
  // Монтируется лениво при первом входе — не грузим модуль, пока вкладку не открыли.
  // (Сегмент «Помощники» / витрина бизнес-голубей удалён по решению юзера 04.08.2026.)
  let doveColMounted = false;
  function mountDoveCol() {
    const col = ov.querySelector('#ck-dove-col');
    if (col && !doveColMounted && window.CatDove) {
      // POST-запросы голубятни меняют тот же баланс, что и тапы. Ставим их в общую
      // очередь мутаций; GET остаются параллельными, чтобы экран не грузился медленнее.
      const doveApi = (path, opts) => opts && String(opts.method || 'GET').toUpperCase() !== 'GET' ? mutationApi(path, opts) : api(path, opts);
      doveColMounted = true; window.CatDove.mount(col, doveApi);
    }
    else if (col && doveColMounted && window.CatDove && typeof window.CatDove.refresh === 'function') {
      // Альбом меняется и вне своей вкладки: голубь может выпасть из сундука,
      // комбо или мини-игры. При повторном входе перечитываем инвентарь/гонку.
      void window.CatDove.refresh();
    }
    // тур альбома при первом входе новичка — с задержкой на асинхронный монтаж CatDove
    // (якорь ещё не отрисован → мягкий выход, покажется в следующий раз)
    if (!tourSeen('col')) setTimeout(() => { if (tab === 'dove' && !tourActive) startTour('col'); }, 1100);
  }
  // Бейдж непрочитанной почты голубятни на кнопке навбара — грузится один раз при
  // старте игры и при каждом открытии вкладки «Голуби» (unreadMail из /api/pigeons).
  function updateDoveBadge(n) {
    const b = ov && ov.querySelector('#ck-dove-badge'); if (!b) return;
    if (n > 0) { b.textContent = n > 9 ? '9+' : String(n); b.hidden = false; } else b.hidden = true;
  }
  async function loadDoveBadge() {
    if (!authed()) return;
    // Обмены отключены — бейдж больше не делает лишний сетевой запрос.
    updateDoveBadge(0);
  }

  // ── Прогрессивное открытие вкладок: у новичка активны «Котик»+«Прокачка»,
  // остальные разблокируются по уровню. Безопасно для существующих игроков —
  // level = leagueFor(totalEarned) МОНОТОНЕН (totalEarned только растёт), поэтому
  // никто, кто уже был выше порога, вкладку не теряет; блокировка касается только
  // самых первых минут новичка. Пороги низкие: Призы — ур.2, Голуби/Рейтинг — ур.3.
  const TAB_UNLOCK = { cat: 1, up: 1, tasks: 2, dove: 3, top: 3 };
  const TAB_NAME = { tasks: 'Призы', dove: 'Голуби', top: 'Рейтинг' };
  const tabReq = (t) => TAB_UNLOCK[t] || 1;
  // Серверный level включает храповик при изменении порогов; локальный расчёт нужен,
  // чтобы новый уровень появился сразу на ещё не синхронизированных тапах.
  const playerLevel = () => st ? Math.min(LEAGUES.length, Math.max(Number(st.level) || 1, leagueFor(Number(st.totalEarned) || 0).level)) : 1;
  const playerLeague = () => leagueForLevel(playerLevel());
  // Престиж сбрасывает уровень цикла, но не должен снова отнимать уже освоенные
  // разделы (и доступ к сохранённым голубям/команде/наградам).
  const unlockLevel = () => st && Number(st.prestige || 0) > 0 ? LEAGUES.length : playerLevel();
  const tabLocked = (t) => unlockLevel() < tabReq(t);
  let unlockedSeen = null;
  function applyTabLocks() {
    if (!ov || !st) return;
    const lvl = unlockLevel();
    const nowUnlocked = new Set();
    ov.querySelectorAll('.ck-nav__b').forEach(btn => {
      const t = btn.dataset.tab, req = tabReq(t), locked = lvl < req;
      btn.classList.toggle('locked', locked);
      btn.setAttribute('aria-disabled', locked ? 'true' : 'false');
      let lk = btn.querySelector('.ck-navlk');
      if (locked) { if (!lk) { lk = document.createElement('span'); lk.className = 'ck-navlk'; btn.appendChild(lk); } lk.textContent = 'ур.' + req; }
      else { if (lk) lk.remove(); nowUnlocked.add(t); }
    });
    if (unlockedSeen) { // празднуем новую разблокировку (не на первом рендере)
      nowUnlocked.forEach(t => {
        if (!unlockedSeen.has(t) && TAB_NAME[t]) {
          flashMsg('Открыто: ' + TAB_NAME[t] + '!', 'light');
          const b = ov.querySelector('.ck-nav__b[data-tab="' + t + '"]');
          if (b) { b.classList.add('ck-nav-pop'); setTimeout(() => b.classList.remove('ck-nav-pop'), 800); }
        }
      });
    }
    unlockedSeen = nowUnlocked;
  }

  function setTab(t) {
    if (tabLocked(t)) { window.haptic && window.haptic('light'); flashMsg('Откроется на уровне ' + tabReq(t), 'light'); return; }
    closeActiveCoach();
    const pop = ov && ov.querySelector('#ck-pop'); if (pop) pop.classList.remove('on'); // попап не должен висеть над чужой вкладкой
    window.haptic && window.haptic('selection');
    if (tab === 'cat' && t !== 'cat') void flushForPageExit();
    tab = t;
    ov.querySelector('#ck-scr-cat').classList.toggle('on', t === 'cat');
    ov.querySelector('#ck-scr-up').classList.toggle('on', t === 'up');
    ov.querySelector('#ck-scr-dove').classList.toggle('on', t === 'dove');
    ov.querySelector('#ck-scr-tasks').classList.toggle('on', t === 'tasks');
    ov.querySelector('#ck-scr-top').classList.toggle('on', t === 'top');
    ov.querySelector('#ck-scr-hub').classList.toggle('on', t === 'hub');
    ov.querySelectorAll('.ck-nav__b').forEach(b => {
      const active = b.dataset.tab === t;
      b.classList.toggle('on', active);
      if (active) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    if (t === 'hub') renderHub();
    if (t === 'up') { renderUpgrades(); coach('up', COACH.up.t, '#ck-uplist', { icon: ICON[COACH.up.icon](18) }); }
    if (t === 'dove') { mountDoveCol(); loadDoveBadge(); }
    if (t === 'tasks') renderTasks();
    if (t === 'top') { renderTop(); coach('top', COACH.top.t, '#ck-toplist', { icon: ICON[COACH.top.icon](18) }); }
    tourOnTab(t);
  }

  // ── Главная · обзор: «общие значения и смыслы» всей игры одним экраном ──
  let hubGen = 0;
  function renderHub() {
    const gen = ++hubGen;
    const body = ov && ov.querySelector('#ck-hub-body'); if (!body || !st) return;
    const catSrc = (ov.querySelector('#ck-cat') || {}).src || '';
    const profit = Math.floor((st.profitPerHour || 0) * passiveIncomeMult());
    const total = CARDS.length;
    const tiles = [
      `<div class="ck-tile"><span class="ck-tile__l">Баланс</span><span class="ck-tile__v lime">${COIN(14)} ${fmt(st.balance)}</span></div>`,
      `<div class="ck-tile"><span class="ck-tile__l">Доход</span><span class="ck-tile__v lime">${COIN(13)} +${fmt(profit)}/ч</span></div>`,
      `<div class="ck-tile"><span class="ck-tile__l">Бизнесы</span><span class="ck-tile__v">${st.cardsOwned || 0} / ${total}</span></div>`,
      `<div class="ck-tile"><span class="ck-tile__l">Стрик</span><span class="ck-tile__v">${st.dailyStreak || 0} дн ${ICON.fire(14)}</span></div>`,
      `<div class="ck-tile"><span class="ck-tile__l">Топ недели</span><span class="ck-tile__v grape" id="ck-hub-rank">…</span></div>`,
      `<div class="ck-tile"><span class="ck-tile__l">Копилка стаи</span><span class="ck-tile__v" id="ck-hub-bank">…</span></div>`,
    ].join('');
    // Разделы = «смыслы»: что где лежит, одной строкой.
    const rows = [
      { tab: 'up', ic: ICON.bolt(17), t: 'Прокачка', d: 'Бизнесы приносят монеты сами' },
      { tab: 'dove', ic: ICON.dove(17), t: 'Голуби', d: 'Коллекция пород и гонки' },
      { tab: 'tasks', ic: ICON.gift(17), t: 'Призы', d: 'Награда дня, сундук, комбо' },
      { tab: 'top', ic: ICON.trophy(17), t: 'Рейтинг', d: 'Твоё место среди игроков' },
    ].map(r => `<button class="ck-row2" data-goto="${r.tab}"${r.id ? ` id="${r.id}"` : ''}><span class="ck-row2__ic">${r.ic}</span><span class="ck-row2__b"><b>${r.t}</b><i>${r.d}</i></span><span class="ck-row2__ch">›</span></button>`).join('');
    const hubLevel = playerLevel();
    const earnedLabel = Number(st.prestige || 0) > 0 ? 'в этом цикле заработано' : 'всего заработано';
    body.innerHTML =
      `<div class="ck-hub__hero"><img class="ck-hub__av" src="${catSrc}" alt="" draggable="false"/>` +
      `<div class="ck-hub__name">Василий · Уровень ${hubLevel}</div>` +
      `<div class="ck-hub__sub">${playerLeague().name} · ${earnedLabel} ${fmt(st.totalEarned)}</div></div>` +
      `<div class="ck-bento">${tiles}</div>` +
      `<div class="ck-sect">Разделы</div><div class="ck-hubrows">${rows}</div>`;
    body.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => { window.haptic && window.haptic('selection'); setTab(b.dataset.goto); });
    if (authed()) api('/api/pigeons/drag/duels').then(d => {
      const duel = d && Array.isArray(d.incoming) ? d.incoming[0] : null;
      if (!duel || gen !== hubGen || tab !== 'hub' || !body.isConnected || body.querySelector('.ck-duelcall')) return;
      const safeName = window.escapeHtml ? window.escapeHtml(duel.fromName || 'Друг') : 'Друг';
      body.insertAdjacentHTML('afterbegin', `<div class="ck-duelcall"><span>${ICON.flag(24)}</span><div class="ck-duelcall__b"><b>${safeName} вызывает на дуэль</b><span>${duel.stake ? 'Ставка ' + fmt(duel.stake) + ' монет' : 'Без ставки'}</span></div><button id="ck-duel-accept">Принять дуэль</button></div>`);
      const btn = body.querySelector('#ck-duel-accept'); if (btn) btn.onclick = () => {
        setTab('dove');
        setTimeout(() => { if (window.CatDove && window.CatDove.openIncomingDuel) window.CatDove.openIncomingDuel(duel); }, 250);
      };
    }).catch(() => {});
    // Топ недели и копилка стаи — по сети, best-effort; до ответа «…», при неудаче «—»/«нет»
    if (authed()) {
      Promise.all([loadTop().catch(() => null), api('/api/clicker/squads').catch(() => null)]).then(([top, sq]) => {
        if (gen !== hubGen || tab !== 'hub' || !body.isConnected) return;
        const rk = body.querySelector('#ck-hub-rank'); if (rk) rk.textContent = (top && top.myRank) ? '#' + top.myRank : '—';
        const bk = body.querySelector('#ck-hub-bank');
        if (bk) { if (sq && sq.bank && sq.bank.target) bk.textContent = Math.min(100, Math.round(sq.bank.sum / sq.bank.target * 100)) + '%'; else bk.textContent = 'нет'; }
      });
    } else { const rk = ov.querySelector('#ck-hub-rank'); if (rk) rk.textContent = '—'; const bk = ov.querySelector('#ck-hub-bank'); if (bk) bk.textContent = 'нет'; }
  }

  const turboOn = () => Date.now() < turboUntil;
  function releaseTapPointer(e) {
    if (!e || e.pointerId == null) return;
    activeTapPointers.delete(e.pointerId);
  }
  function scheduleTapRender() {
    if (tapRenderFrame) return;
    tapRenderFrame = requestAnimationFrame(() => { tapRenderFrame = 0; if (st && ov && ov.classList.contains('on')) renderTop2(); });
  }
  function pulseCat() {
    const cat = ov && ov.querySelector('#ck-cat'); if (!cat) return;
    cat.classList.add('tap');
    clearTimeout(catTapTimer);
    catTapTimer = setTimeout(() => cat.classList.remove('tap'), 80);
  }
  function onTap(e) {
    e.preventDefault();
    if (e.pointerId != null) {
      if (!activeTapPointers.has(e.pointerId) && activeTapPointers.size >= MAX_TAP_POINTERS) return;
      activeTapPointers.add(e.pointerId);
      // pointerup может произойти уже за пределами арены. Без capture id оставался
      // в activeTapPointers, и после нескольких таких жестов кот переставал тапаться.
      try { e.currentTarget && e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    }
    if (!st) return; // тап до завершения load() на медленной сети — не ронять TypeError'ом
    const signedIn = authed();
    const tapAccountNow = signedIn ? accountStorageKey('ck_state_context') : '';
    if (signedIn && tapAccount && tapAccount !== tapAccountNow) {
      pending = 0; pendingComboBonus = 0; pendingTapGain = 0; pendingTapEnergy = 0; tapRetryBatch = null;
    }
    if (signedIn) tapAccount = tapAccountNow;
    // Сначала персистим активный пассив. Раньше rawSave() тапа сдвигал _ts и
    // стирал уже показанный на экране гостевой доход с момента прошлого save.
    if (st.energy < TAP_COST) { energyEmpty(); return; }
    const mult = turboOn() ? TURBO_MULT : 1;
    const eMult = (st.event && st.event.active && (!st.event.endsTs || Number(st.event.endsTs) > Date.now())) ? st.event.mult : 1; // ивент ×N (зеркало сервера)
    const bankMult = (st.bankMult && st.bankMult > 1) ? st.bankMult : 1;
    // «Сладкий тап»: номер ЭТОГО тапа в lifetime-счётчике (st.taps с последнего синка
    // + улетевшие inflight + несинканные pending + текущий). Кратен SWEET_TAP_EVERY →
    // крит ×SWEET_TAP_MULT — сервер начислит ровно столько же в батче (детерминизм).
    // authed: st.taps (последний синк) + улетевшие + несинканные; гость: st.taps ведётся
    // локально прямо тут (pending у гостя не флашится и в счёт не входит)
    const inflightHere = signedIn && tapsInflightAccount === tapAccountNow ? tapsInflight : 0;
    const retryHere = signedIn && (!tapRetryBatch || !tapRetryBatch.account || tapRetryBatch.account === tapAccountNow) ? Number(tapRetryBatch && tapRetryBatch.n || 0) : 0;
    const lifetime = (signedIn ? Number(st.taps || 0) + inflightHere + retryHere + pending : Number(st.taps || 0)) + 1;
    const sweet = lifetime % SWEET_TAP_EVERY === 0;
    const baseTapGain = Math.floor(st.perTap * mult * (st.prestigeMult || 1) * eMult * bankMult);
    const gain = baseTapGain * (sweet ? SWEET_TAP_MULT : 1);
    st.energy -= TAP_COST; st.balance += gain; st.totalEarned += gain;
    if (signedIn) { pending++; pendingTapGain += gain; pendingTapEnergy += TAP_COST; }
    else { const s = stageGuestTapState(true); st.taps = s.taps; }
    if (sweet) sweetTapFx(e.clientX, e.clientY, gain);
    else maybeCatSpeak();
    // комбо
    const now = performance.now(); combo = (now - comboT < 450) ? combo + 1 : 1; comboT = now;
    // Монеты считаются на КАЖДЫЙ тап. Экран обновляется один раз за кадр, а тяжёлые
    // DOM/audio-эффекты — не чаще 11 раз/с: так мультитап не забивает мобильный WebView.
    const fxNow = performance.now(), drawTapFx = fxNow - lastTapFxAt >= 90;
    if (drawTapFx) {
      lastTapFxAt = fxNow;
      pulseCat();
      // Сладкий тап уже имеет собственный акцент — не наслаиваем поверх него
      // обычные звук, вибрацию и три DOM-эффекта.
      if (!sweet) {
        sfxTap(combo);
        if (fxNow - lastTapHapticAt >= 120) { lastTapHapticAt = fxNow; window.haptic && window.haptic('light'); }
        const fx = ov.querySelector('#ck-fx'), fxRect = fx && fx.getBoundingClientRect();
        flyUp(e.clientX, e.clientY, '+' + gain, Math.min(40, 22 + combo), fxRect);
        ripple(e.clientX, e.clientY, fxRect); flyCoin(e.clientX, e.clientY, fxRect);
      }
    }
    const comboBonus = comboBonusFor(baseTapGain, lifetime);
    if (comboBonus > 0) {
      st.balance += comboBonus; st.totalEarned += comboBonus;
      if (signedIn) { pendingComboBonus += comboBonus; pendingTapGain += comboBonus; }
      else stageGuestTapState(false);
      flyUp(e.clientX, e.clientY - 22, `комбо +${fmt(comboBonus)}`, 34);
    }
    scheduleTapRender();
    if (combo >= 5 && drawTapFx) showCombo();
    if (combo >= 30 && combo % 30 === 0) coinShower(4);
    tourOnTap();
    sessionTapCount++;
    if (sessionTapCount === 30) coach('level', COACH.level.t, '.ck-progwrap', { icon: ICON[COACH.level.icon](18) });
  }
  let comboHideT = 0, comboPulseAnim = null;
  function showCombo() {
    const el = ov.querySelector('#ck-combo');
    const tier = combo >= 30 ? 3 : combo >= 20 ? 2 : combo >= 10 ? 1 : 0;
    el.dataset.tier = tier;
    el.innerHTML = ICON.fire(Math.min(30, Math.round(18 + combo * 0.5))) + ' ×' + combo;
    el.style.fontSize = Math.min(46, 22 + combo) + 'px';
    el.classList.add('show');
    if (typeof el.animate === 'function') {
      if (comboPulseAnim) comboPulseAnim.cancel();
      comboPulseAnim = el.animate([{ transform: 'translateX(-50%) scale(.86)' }, { transform: 'translateX(-50%) scale(1.08)', offset: .55 }, { transform: 'translateX(-50%) scale(1)' }], { duration: 220, easing: 'ease-out' });
    }
    clearTimeout(comboHideT); comboHideT = setTimeout(() => el.classList.remove('show'), 950);
    coach('combo', COACH.combo.t, '#ck-combo', { icon: ICON[COACH.combo.icon](18) });
    if (combo >= 10 && combo % 10 === 0) comboMilestone(tier);
  }
  function comboBonusFor(baseTapGain, lifetime) {
    // Сервер надёжно проверяет lifetime taps: каждый 10-й даёт ещё один baseTap.
    // Быстрая серия остаётся визуальной механикой и больше не влияет на доверие.
    return lifetime % 10 === 0 ? Math.max(1, Math.floor(baseTapGain)) : 0;
  }
  function comboMilestone(tier) {
    if (combo % 30 === 0) window.haptic && window.haptic('medium');
    const wrap = ov.querySelector('#ck-catwrap');
    if (wrap && typeof wrap.animate === 'function') wrap.animate([
      { transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' },
    ], { duration: 260, easing: 'ease-out' });
    burstSparks(3 + Math.min(1, tier));
  }
  // ── «Сладкий тап» + реплики Василия (вкладка Котик, 31.07) ────────────────────
  function sweetTapFx(x, y, gain) {
    window.haptic && window.haptic('success');
    sfxReward();
    flyUp(x, y, `+${fmt(gain)}`, 46);
    const fx = ov.querySelector('#ck-fx');
    if (fx) {
      const d = document.createElement('div');
      d.className = 'ck-sweettap';
      d.textContent = 'СЛАДКИЙ ТАП ×' + SWEET_TAP_MULT;
      fx.appendChild(d);
      setTimeout(() => d.remove(), 1100);
    }
    burstSparks(4);
  }
  // Реплики — характер кота: редкие (не спамят), только на вкладке «Котик».
  const CAT_SPEAK = [
    'Мур! Так и до эклера дотапаем', 'Ещё лапкой! Тесто само не замесится',
    'Чую запах круассанов…', 'Гур-гур! То есть — тап-тап!',
    'Голуби говорят, ты сегодня в ударе', 'После работы — по бенто?',
    'Мои усы чуют премию', 'Крем взбит. Осталось всё остальное',
    'Вот бы лапы не уставали…', 'Пекарня сама себя не прокачает',
  ];
  let speakAt = 0, lastTapAt = 0;
  function catSay(text, ms) {
    const wrap = ov.querySelector('#ck-catwrap');
    if (!wrap) return;
    const old = wrap.querySelector('.ck-say'); if (old) old.remove();
    const b = document.createElement('div');
    b.className = 'ck-say';
    b.textContent = text;
    wrap.appendChild(b);
    requestAnimationFrame(() => b.classList.add('show'));
    setTimeout(() => { b.classList.remove('show'); setTimeout(() => b.remove(), 260); }, ms || 2300);
  }
  function maybeCatSpeak() {
    lastTapAt = Date.now();
    if (Date.now() - speakAt < 45000 || Math.random() > 0.02) return;
    speakAt = Date.now();
    catSay(CAT_SPEAK[Math.floor(Math.random() * CAT_SPEAK.length)]);
  }
  // Простой 50с на вкладке «Котик» → Василий напоминает о себе (не чаще раза в 2 мин)
  setInterval(() => {
    if (!ov || !ov.classList.contains('on') || tab !== 'cat' || !st) return;
    const now = Date.now();
    if (lastTapAt && now - lastTapAt > 50000 && now - speakAt > 120000) {
      speakAt = now;
      catSay(CAT_SPEAK[Math.floor(Math.random() * CAT_SPEAK.length)]);
    }
  }, 8000);

  function burstSparks(n) {
    let rm = false; try { rm = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    if (rm) return;
    const fx = ov.querySelector('#ck-fx'), w = fx.clientWidth, h = fx.clientHeight, cx = w / 2, cy = h * 0.5;
    for (let i = 0; i < n; i++) {
      const d = document.createElement('div'); d.className = 'ck-burst';
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.6, dist = 45 + Math.random() * 75;
      d.style.left = cx + 'px'; d.style.top = cy + 'px'; fx.appendChild(d);
      requestAnimationFrame(() => { d.style.transform = `translate(${(Math.cos(a) * dist).toFixed(0)}px,${(Math.sin(a) * dist).toFixed(0)}px) scale(0)`; d.style.opacity = '0'; });
      setTimeout(() => d.remove(), 520);
    }
  }
  let enHintAt = -1e9;
  function energyEmpty() {
    window.haptic && window.haptic('medium');
    const en = ov.querySelector('.ck-energy'); if (en) { en.classList.remove('shake'); void en.offsetWidth; en.classList.add('shake'); setTimeout(() => en.classList.remove('shake'), 440); }
    const now = performance.now(); if (now - enHintAt < 5000) return; enHintAt = now;
    showEnergyHint();
  }
  function showEnergyHint() {
    const scr = ov.querySelector('#ck-scr-cat'); if (!scr) return;
    const old = scr.querySelector('.ck-ehint'); if (old) old.remove();
    const hasBoost = st && st.boostEnergyLeft > 0;
    const el = document.createElement('div'); el.className = 'ck-ehint';
    el.innerHTML = `<div class="ck-ehint__h">${ICON.bolt(20)} Энергия кончилась</div>`
      + `<div class="ck-ehint__s">${hasBoost ? 'Восстанови сейчас или подожди — возвращается 1 энергия за 4 секунды.' : 'Возвращается 1 энергия за 4 секунды. А бизнесы в «Прокачке» приносят монеты даже без тапов.'}</div>`
      + `<button class="ck-ehint__btn" id="ck-eh-act">${ICON.bolt(17)} ${hasBoost ? 'Восстановить (' + st.boostEnergyLeft + ')' : 'К бизнесам'}</button>`;
    scr.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); };
    el.querySelector('#ck-eh-act').onclick = () => { if (hasBoost) boost('energy'); else setTab('up'); close(); };
    setTimeout(close, 6500);
  }
  function flyUp(x, y, txt, size, knownRect) {
    const fx = ov.querySelector('#ck-fx'); if (!fx) return; const r = knownRect || fx.getBoundingClientRect();
    const el = document.createElement('div'); el.className = 'ck-up'; el.textContent = txt; el.style.fontSize = (size || 24) + 'px';
    el.style.left = ((x || r.width / 2) - r.left - 10) + 'px'; el.style.top = ((y || r.height / 2) - r.top - 10) + 'px';
    el.style.transition = 'transform .8s ease-out, opacity .8s'; fx.appendChild(el);
    requestAnimationFrame(() => { el.style.transform = `translate(${(Math.random() - .5) * 50}px,-80px)`; el.style.opacity = '0'; });
    setTimeout(() => el.remove(), 850);
  }
  function coinShower(count) {
    const fx = ov.querySelector('#ck-fx'); const w = fx.clientWidth;
    const total = Math.max(1, Number(count) || 8);
    for (let i = 0; i < total; i++) { const c = document.createElement('div'); c.className = 'ck-coin'; c.innerHTML = COIN(22); c.style.left = (Math.random() * w) + 'px'; c.style.top = '-30px'; c.style.transition = 'transform 1s ease-in, opacity 1s'; fx.appendChild(c); requestAnimationFrame(() => { c.style.transform = `translateY(${fx.clientHeight + 40}px) rotate(${(Math.random() - .5) * 360}deg)`; c.style.opacity = '0.2'; }); setTimeout(() => c.remove(), 1000); }
  }
  // kind: 'error' (дефолт, с вибро) | 'light' (нейтральные сообщения). Плашка держится ~0.8с и гаснет — раньше гасла мгновенно и терялась.
  // Топ-слой (z 30000, крепится к ov, не к #ck-fx z6): сообщение видно над хабом «Игры»,
  // оверлеями мини-игр (z 11-12) и попапами — раньше «Перемешали!» внутри gems просто терялось.
  function flashMsg(text, kind) { if (!ov || !ov.classList.contains('on')) return; const el = document.createElement('div'); el.className = 'ck-up'; el.style.color = kind === 'light' ? 'var(--gold-l)' : '#ff8a8a'; el.style.fontSize = '16px'; el.style.background = 'rgba(20,8,10,.88)'; el.style.padding = '9px 16px'; el.style.borderRadius = '13px'; el.style.maxWidth = '82%'; el.style.textAlign = 'center'; el.style.zIndex = '30000'; el.textContent = text; el.style.left = '50%'; el.style.top = '56%'; el.style.transform = 'translateX(-50%)'; el.style.transition = 'opacity .5s ease .8s'; ov.appendChild(el); window.haptic && window.haptic(kind === 'light' ? 'light' : 'error'); requestAnimationFrame(() => el.style.opacity = '0'); setTimeout(() => el.remove(), 1400); }

  // ── Анимации (juice) ─────────────────────────────────────────────────────────
  let lastFly = 0;
  function spawnSparks() {
    const wrap = ov && ov.querySelector('#ck-catwrap'); if (!wrap || wrap.querySelector('.ck-spark')) return;
    if (document.hidden) return;
    let rm = false; try { rm = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    if (rm) return;
    for (let i = 0; i < 3; i++) { const s = document.createElement('div'); s.className = 'ck-spark'; s.style.left = (14 + Math.random() * 72) + '%'; s.style.top = (55 + Math.random() * 28) + '%'; s.style.animationDuration = (4 + Math.random() * 3).toFixed(1) + 's'; s.style.animationDelay = (-Math.random() * 6).toFixed(1) + 's'; wrap.appendChild(s); }
  }
  function ripple(x, y, knownRect) { const fx = ov.querySelector('#ck-fx'); if (!fx) return; const r = knownRect || fx.getBoundingClientRect(); const el = document.createElement('div'); el.className = 'ck-ripple'; el.style.left = (x - r.left) + 'px'; el.style.top = (y - r.top) + 'px'; fx.appendChild(el); setTimeout(() => el.remove(), 520); }
  let balancePulseAnim = null;
  function bumpBalance() {
    const b = ov && ov.querySelector('#ck-bal'); if (!b) return;
    if (typeof b.animate === 'function') {
      if (balancePulseAnim) balancePulseAnim.cancel();
      balancePulseAnim = b.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.08)', offset: .45 }, { transform: 'scale(1)' }], { duration: 240, easing: 'ease-out' });
      return;
    }
    b.classList.add('ck-balpop'); setTimeout(() => b.classList.remove('ck-balpop'), 250);
  }
  function flyCoin(x, y, knownRect) {
    const now = performance.now(); if (now - lastFly < 70) return; lastFly = now;
    bumpBalance();
    let rm = false; try { rm = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    if (rm) return;
    const fx = ov.querySelector('#ck-fx'); if (!fx) return; const r = knownRect || fx.getBoundingClientRect();
    const el = document.createElement('div'); el.className = 'ck-flyc'; el.innerHTML = COIN(20);
    const sx = x - r.left - 10, sy = y - r.top - 10;
    const dx = (Math.random() - .5) * 120, spin = (Math.random() - .5) * 520;
    const dur = 600 + Math.random() * 180;
    fx.appendChild(el);
    if (typeof el.animate === 'function') {
      const anim = el.animate([
        { transform: `translate3d(${sx}px,${sy}px,0) rotate(0deg) scale(1)`, opacity: 1 },
        { transform: `translate3d(${sx + dx * .72}px,${sy - 88}px,0) rotate(${spin * .62}deg) scale(.82)`, opacity: .92, offset: .62 },
        { transform: `translate3d(${sx + dx}px,${sy + 12}px,0) rotate(${spin}deg) scale(.45)`, opacity: 0 },
      ], { duration: dur, easing: 'cubic-bezier(.2,.58,.36,1)', fill: 'forwards' });
      anim.onfinish = () => el.remove();
      return;
    }
    el.style.transform = `translate3d(${sx}px,${sy}px,0)`;
    el.style.opacity = '0';
    setTimeout(() => el.remove(), dur);
  }
  function flash() { const fx = ov.querySelector('#ck-fx'); const el = document.createElement('div'); el.className = 'ck-flash'; fx.appendChild(el); setTimeout(() => el.remove(), 720); }
  function confettiBurst() {
    const fx = ov.querySelector('#ck-fx'); const cx = fx.clientWidth / 2, cy = fx.clientHeight * 0.42;
    const cols = ['#D8FF7A', '#A8F51E', '#8DBF20', '#ffffff', '#ffd86b'];
    for (let i = 0; i < 26; i++) { const c = document.createElement('div'); c.className = 'ck-conf'; const sz = 5 + Math.random() * 5; c.style.width = sz + 'px'; c.style.height = (sz * 0.6) + 'px'; c.style.background = cols[i % cols.length]; c.style.left = cx + 'px'; c.style.top = cy + 'px'; c.style.transition = 'transform .9s cubic-bezier(.2,.6,.4,1),opacity .9s'; fx.appendChild(c); const ang = Math.random() * Math.PI * 2, dist = 60 + Math.random() * 120; requestAnimationFrame(() => { c.style.transform = `translate(${Math.cos(ang) * dist}px,${Math.sin(ang) * dist + 80}px) rotate(${Math.random() * 540}deg)`; c.style.opacity = '0'; }); setTimeout(() => c.remove(), 950); }
  }
  function evolveCat(oldSrc) {
    const wrap = ov.querySelector('#ck-catwrap'), cat = ov.querySelector('#ck-cat'); if (!wrap || !cat || !oldSrc) return;
    const cr = cat.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    const g = document.createElement('img'); g.className = 'ck-ghost'; g.src = oldSrc;
    g.style.left = (cr.left - wr.left) + 'px'; g.style.top = (cr.top - wr.top) + 'px'; g.style.width = cr.width + 'px'; g.style.height = cr.height + 'px';
    wrap.appendChild(g); requestAnimationFrame(() => { g.style.opacity = '0'; g.style.transform = 'scale(1.16)'; }); setTimeout(() => g.remove(), 660);
  }

  // ── Сезонные темы (авто по дате Иркутска + тест-override) ─────────────────────
  function seasonTheme() {
    let id = (window.catClickSeason) || ''; // тест: window.catClickSeason='ny'|'spring'|'love'
    try { id = id || new URLSearchParams(location.search).get('season') || localStorage.getItem('ck_season') || ''; } catch (_) {}
    if (!id) {
      const dd = new Date(Date.now() + 8 * 3600e3), m = dd.getUTCMonth() + 1, day = dd.getUTCDate();
      if ((m === 12 && day >= 15) || (m === 1 && day <= 10)) id = 'ny';
      else if (m === 2 && day >= 10 && day <= 16) id = 'love';
      else if ((m === 2 && day >= 25) || (m === 3 && day <= 9)) id = 'spring';
    }
    const T = { ny: { greet: 'С Новым годом!', kind: 'snow' }, spring: { greet: 'С 8 Марта!', kind: 'petal' }, love: { greet: 'С Днём влюблённых!', kind: 'heart' } };
    return T[id] ? { id, greet: T[id].greet, kind: T[id].kind } : null;
  }
  function seasonChipIcon(id) {
    if (id === 'ny') return SVG('<path d="M12 3v18M3 12h18M5.6 5.6 18.4 18.4M18.4 5.6 5.6 18.4"/>', 14);
    if (id === 'spring') return SVG('<path d="M12 21v-8M12 13c-2.4 0-4-1.8-4-4 0-2.4 4-5 4-5s4 2.6 4 5c0 2.2-1.6 4-4 4Z"/>', 14);
    return SVG('<path d="M12 20s-6.5-4.2-6.5-9A3.3 3.3 0 0 1 12 8a3.3 3.3 0 0 1 6.5 3c0 4.8-6.5 9-6.5 9Z"/>', 14);
  }
  function spawnSeason(th) {
    const old = ov.querySelector('.ck-season'); if (old) old.remove();
    if (!th) return;
    const layer = document.createElement('div'); layer.className = 'ck-season';
    for (let i = 0; i < 16; i++) {
      const p = document.createElement('div'); p.className = 'ck-fl'; p.style.left = (Math.random() * 100).toFixed(1) + '%';
      const dur = 6 + Math.random() * 6; p.style.animationDuration = dur.toFixed(1) + 's'; p.style.animationDelay = (-Math.random() * dur).toFixed(1) + 's';
      p.style.setProperty('--sx', ((Math.random() * 2 - 1) * 40).toFixed(0) + 'px'); p.style.setProperty('--rz', (Math.random() * 360).toFixed(0) + 'deg');
      const sz = Math.round((10 + Math.random() * 8));
      if (th.kind === 'snow') p.innerHTML = '<div class="ck-snow"></div>';
      else { const col = th.kind === 'heart' ? '#ff7aa8' : '#ff9ec4'; const path = th.kind === 'heart' ? '<path d="M12 21s-7-4.6-7-10A3.6 3.6 0 0 1 12 8a3.6 3.6 0 0 1 7 3c0 5.4-7 10-7 10Z"/>' : '<path d="M12 3c1.3 2.6.6 5-1.3 6.4M12 3c-1.3 2.6-.6 5 1.3 6.4M12 3v9M5 8c-.3 2.4 1.2 4.3 3.6 4.6M19 8c.3 2.4-1.2 4.3-3.6 4.6"/>'; p.innerHTML = `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="${th.kind === 'heart' ? col : 'none'}" stroke="${col}" stroke-width="1.6">${path}</svg>`; }
      layer.appendChild(p);
    }
    ov.appendChild(layer);
  }
  function applySeason() {
    if (!ov) return; const th = seasonTheme(); const g = ov.querySelector('#ck-greet');
    if (th) { ov.dataset.season = th.id; if (g) { g.innerHTML = seasonChipIcon(th.id) + ' ' + th.greet; g.classList.add('on'); } }
    else { delete ov.dataset.season; if (g) g.classList.remove('on'); }
    spawnSeason(th);
  }

  // ── «Золотой котик»: случайный летящий бонус ──────────────────────────────────
  function scheduleBonus() { clearTimeout(bonusTimer); bonusTimer = setTimeout(showFlyingBonus, 60000 + Math.random() * 65000); }
  function showFlyingBonus() {
    if (!ov || !ov.classList.contains('on') || tab !== 'cat') { scheduleBonus(); return; }
    const fx = ov.querySelector('#ck-fx'); const w = fx.clientWidth, h = fx.clientHeight;
    const el = document.createElement('div'); el.className = 'ck-bonus-fly'; el.innerHTML = COIN(50);
    const y0 = h * (0.18 + Math.random() * 0.3); const fromLeft = Math.random() < 0.5;
    el.style.top = y0 + 'px'; el.style.left = (fromLeft ? -64 : w + 64) + 'px'; el.style.transition = 'left 5.2s linear, top 5.2s ease-in';
    const grab = (e) => { e.preventDefault(); e.stopPropagation(); if (el._done) return; el._done = true; clearTimeout(el._t); grabBonus(el); };
    el.addEventListener('pointerdown', grab);
    fx.appendChild(el);
    requestAnimationFrame(() => { el.style.left = (fromLeft ? w + 64 : -64) + 'px'; el.style.top = (y0 + h * 0.34) + 'px'; });
    el._t = setTimeout(() => el.remove(), 5300);
    scheduleBonus();
  }
  async function grabBonus(el) {
    const actionSession = overlaySession;
    const r = el.getBoundingClientRect(), fr = ov.querySelector('#ck-fx').getBoundingClientRect();
    el.remove(); confettiBurst(); window.haptic && window.haptic('light'); // мгновенный отклик на сам тап, награда догонит

    let amount = 0, pigeonDrop;
    if (authed()) {
      const d = await mutationApi('/api/clicker/bonus', { method: 'POST', body: '{}' }).catch(() => null);
      if (d && !d.error) { applyServerState(d); amount = d.amount; pigeonDrop = d.pigeonDrop; }
      else {
        // Не повторяем claim: первый запрос мог зачислиться до обрыва ответа.
        const fresh = await stateApi('/api/clicker').catch(() => null);
        const synced = !!(fresh && !fresh.error);
        if (synced) { applyServerState(fresh); renderAll(); bumpBalance(); }
        if (overlaySessionActive(actionSession)) flashMsg(!d || d.error === 'internal' ? (synced ? 'Связь прервалась — баланс обновлён' : 'Нет связи — проверь баланс после повторного входа') : 'Бонус уже забран');
        return;
      }
    }
    else { amount = guestBonusRaw(); if (amount) applyServerState(guestDerive()); }
    if (!overlaySessionActive(actionSession)) return;
    if (amount) { sfxReward(); window.haptic && window.haptic('success'); coinShower(); queueDoveDrop(pigeonDrop); dailyPopupRaw(ICON.star(20) + ' Золотой бонус!', amount); renderAll(); bumpBalance(); }
  }
  function guestBonusRaw() {
    guestDerive(); const s = rawGet(); if (s.bonusAt && Date.now() - s.bonusAt < 45000) return 0;
    const lvl = leagueFor(s.totalEarned).level; const amount = Math.min(60000, Math.round(300 + Math.random() * (700 + lvl * 600)));
    s.balance += amount; s.totalEarned += amount; s.bonusAt = Date.now(); rawSave(s); return amount;
  }

  // ── Сундук удачи ──────────────────────────────────────────────────────────────
  function rollChestGuest(level) {
    const r = Math.random(), sc = 1 + level * 0.25;
    if (r < 0.42) return { type: 'coins', amount: Math.round((300 + Math.random() * 1000) * sc) };
    if (r < 0.68) return { type: 'coins', amount: Math.round((1200 + Math.random() * 2500) * sc) };
    if (r < 0.82) return { type: 'turbo' };
    if (r < 0.95) return { type: 'energy' };
    return { type: 'jackpot', amount: Math.round(5000 + Math.random() * 15000) };
  }
  function guestOpenChestRaw() {
    guestDerive(); const s = rawGet(); const today = irkToday(); if (s.chestDate === today) return null;
    const prize = rollChestGuest(leagueFor(s.totalEarned).level);
    if (prize.type === 'coins' || prize.type === 'jackpot') { s.balance += prize.amount; s.totalEarned += prize.amount; }
    else if (prize.type === 'turbo') { s.turboUntil = Math.max(Date.now(), Number(s.turboUntil || 0)) + TURBO_SEC * 1000; }
    else if (prize.type === 'energy') { s.energy = energyMaxFor(s.energyLevel); }
    s.chestDate = today; rawSave(s); return prize;
  }
  async function openChestAct() {
    return withLock('chest', async () => {
      const actionSession = overlaySession;
      let prize = null, pigeonDrop;
      if (authed()) {
        const d = await mutationApi('/api/clicker/chest', { method: 'POST', body: '{}' }).catch(() => null);
        if (d && !d.error) { applyServerState(d); prize = d.prize; pigeonDrop = d.pigeonDrop; }
        else if (!d || d.error === 'internal') {
          const fresh = await stateApi('/api/clicker').catch(() => null);
          if (fresh && !fresh.error && fresh.chestAvailable === false) {
            applyServerState(fresh); turboUntil = Date.now() + Math.max(0, Number(fresh.turboMsLeft) || 0); renderAll(); renderTasks(); bumpBalance();
            if (overlaySessionActive(actionSession)) flashMsg('Сундук открылся — награда уже применена'); return;
          }
          if (overlaySessionActive(actionSession)) flashMsg('Нет связи — попробуй ещё раз'); return;
        } else { if (overlaySessionActive(actionSession)) flashMsg(d.error === 'internal' ? 'Нет связи — попробуй ещё раз' : d.error === 'already' ? 'Сундук уже открыт' : 'Не удалось открыть сундук'); return; }
      }
      else { prize = guestOpenChestRaw(); if (!prize) { if (overlaySessionActive(actionSession)) flashMsg('Сундук уже открыт'); return; } applyServerState(guestDerive()); }
      turboUntil = Date.now() + (st.turboMsLeft || 0);
      if (!overlaySessionActive(actionSession)) return;
      sfxLevel(); window.haptic && window.haptic('success'); confettiBurst(); coinShower(); queueDoveDrop(pigeonDrop); chestPopup(prize); renderAll(); renderTasks(); bumpBalance();
    });
  }
  function chestPopup(prize) {
    const pop = ov.querySelector('#ck-pop'); let body;
    if (prize.type === 'turbo') body = `<div class="v">${ICON.rocket(22)} Турбо ×5</div><div style="color:var(--muted);font-size:13px">20 секунд множитель за тап!</div>`;
    else if (prize.type === 'energy') body = `<div class="v">${ICON.bolt(22)} Полная энергия</div>`;
    else body = `<div class="v">+${fmt(prize.amount)} ${COIN(24)}</div>${prize.type === 'jackpot' ? '<div style="color:var(--gold-l);font-size:14px;font-weight:800;letter-spacing:1px">ДЖЕКПОТ!</div>' : ''}`;
    pop.innerHTML = `<h3>${ICON.chest(20)} Сундук удачи</h3>${body}<button id="ck-pop-ok">Класс!</button>`; pop.classList.add('on'); pop.querySelector('#ck-pop-ok').onclick = () => { pop.classList.remove('on'); advancePopupQueue(); };
  }

  // ── Платный кейс (CS2-стиль): открытие → рил-анимация → приз ─────────────────
  const casePendingKey = () => accountStorageKey('ck_case_pending_v2');
  let pendingCaseRequestId = null;
  let pendingCaseAccountKey = '';
  let cancelCaseReel = null;
  function syncCaseRequestAccount() {
    const key = casePendingKey();
    if (pendingCaseAccountKey !== key) {
      pendingCaseAccountKey = key;
      pendingCaseRequestId = null;
    }
    return key;
  }
  function existingCaseRequestId() {
    const key = syncCaseRequestAccount();
    if (pendingCaseRequestId) return pendingCaseRequestId;
    try {
      const saved = localStorage.getItem(key);
      if (saved && /^[a-zA-Z0-9_-]{8,80}$/.test(saved)) pendingCaseRequestId = saved;
    } catch (_) {}
    return pendingCaseRequestId;
  }
  function caseRequestId() {
    existingCaseRequestId();
    if (!pendingCaseRequestId) pendingCaseRequestId = (window.crypto && typeof window.crypto.randomUUID === 'function') ? window.crypto.randomUUID().replace(/-/g, '') : (Date.now().toString(36) + '_' + Math.random().toString(36).slice(2));
    try { localStorage.setItem(syncCaseRequestAccount(), pendingCaseRequestId); } catch (_) {}
    return pendingCaseRequestId;
  }
  function clearCaseRequestId() {
    const key = syncCaseRequestAccount();
    pendingCaseRequestId = null;
    try { localStorage.removeItem(key); } catch (_) {}
  }
  async function openCaseAct() {
    if (!authed()) { openBotGame(); return; }
    // Незавершённый запрос можно повторить даже если первое списание уже уменьшило
    // баланс ниже цены: это чтение прежнего результата, а не новая покупка.
    if (!existingCaseRequestId() && st && Number(st.balance) < CASE_COST) { flashMsg('Не хватает монет на кейс'); return; }
    return withLock('case', async () => {
      const session = overlaySession;
      // Один id переживает сетевой обрыв/перезапуск WebView. Сервер вернёт прежний
      // результат по idempotency key и не спишет стоимость кейса второй раз.
      const requestId = caseRequestId();
      const send = () => mutationApi('/api/clicker/case', { method: 'POST', body: JSON.stringify({ requestId }) }).catch(() => null);
      let d = await send();
      if (!d || d.error === 'internal') d = await send();
      if (!d || d.error) {
        // Явный 4xx означает, что операция не состоялась; при неизвестном сетевом
        // исходе id сохраняем и следующий тап безопасно повторит тот же запрос.
        if (d && d.error !== 'internal') clearCaseRequestId();
        flashMsg(d && d.error === 'not_enough_coins' ? 'Не хватает монет' : d && d.error === 'case_limit' ? 'Лимит кейса на сегодня исчерпан' : 'Нет связи — попробуй ещё раз'); return;
      }
      clearCaseRequestId();
      applyServerState(d); turboUntil = Date.now() + (st.turboMsLeft || 0);
      if (!overlaySessionActive(session)) return;
      window.haptic && window.haptic('light'); renderAll(); renderTasks(); bumpBalance();
      await runCaseReel(d.prize, d.pigeonDrop, d.balanceBefore, d.newBalance, d.cost);
    });
  }
  // Тайл рила: монеты, голубь или бесплатный уровень бизнеса.
  function caseTileHtml(p) {
    const rar = p.rarity || '';
    let inner;
    if (p.type === 'coins') inner = `${COIN(38)}<div class="ck-caset__t">${fmt(p.amount || 0)}</div>`;
    else if (p.type === 'turbo') inner = `${ICON.rocket(38)}<div class="ck-caset__t">Турбо</div>`;
    else if (p.type === 'energy') inner = `${ICON.bolt(38)}<div class="ck-caset__t">Энергия</div>`;
    else if (p.type === 'business') inner = `${ICON.shop(38)}<div class="ck-caset__t">${p.businessName || 'Бизнес'}</div>`;
    else { const meta = DOVE_META[p.breed] || { name: 'Голубь' }; inner = `<div class="ck-caset__pic"><img src="/img/pigeons/${p.breed}.webp?v=2" alt="" onerror="this.style.display='none'"></div><div class="ck-caset__t">${meta.name}</div>`; }
    return `<div class="ck-caset" data-r="${rar}">${inner}</div>`;
  }
  // Наполнитель визуально повторяет распределение денежных результатов; точный
  // приз (включая предметы) всегда выбирает сервер.
  function randomFiller() {
    const r = Math.random();
    if (r < .10) return { type: 'coins', amount: 0 };
    if (r < .40) return { type: 'coins', amount: Math.round(10000 + Math.random() * 60000) };
    if (r < .60) return { type: 'coins', amount: Math.round(70000 + Math.random() * 29000) };
    if (r < .72) return { type: 'coins', amount: 100000 };
    if (r < .82) return { type: 'coins', amount: Math.round(110000 + Math.random() * 50000) };
    if (r < .88) return { type: 'coins', amount: Math.round(200000 + Math.random() * 200000) };
    if (r < .9984) return { type: 'coins', amount: Math.round(500000 + Math.random() * 1000000) };
    return { type: 'coins', amount: 10000000 };
  }
  function runCaseReel(prize, pigeonDrop, balanceBefore, newBalance, cost) {
    return new Promise(resolve => {
    let el = ov.querySelector('#ck-case');
    if (!el) {
      el = document.createElement('div'); el.id = 'ck-case'; el.className = 'ck-case';
      el.innerHTML = `<div class="ck-case__hd">${ICON.chest(18)} Кейс удачи</div><button class="ck-case__x" id="ck-case-x" type="button" aria-label="Закрыть">×</button><div class="ck-case__reel"><div class="ck-case__mark"></div><div class="ck-case__track" id="ck-case-track"></div></div><div class="ck-case__res" id="ck-case-res"></div>`;
      ov.appendChild(el);
    }
    const track = el.querySelector('#ck-case-track'), res = el.querySelector('#ck-case-res');
    // Рил сам показывает выпавшего голубя — отдельный dove-drop попап не нужен (не двоим).
    const close = el.querySelector('#ck-case-x'); close.disabled = true; close.style.opacity = '.35'; close.onclick = null;
    res.className = 'ck-case__res'; res.innerHTML = '';
    let settled = false, revealTimer = 0;
    const finish = (hide = true) => {
      if (settled) return;
      settled = true; clearTimeout(revealTimer);
      if (hide) el.classList.remove('on');
      if (cancelCaseReel === cancel) cancelCaseReel = null;
      resolve();
    };
    const cancel = () => finish(true);
    cancelCaseReel = cancel;
    const WIN = 45, N = 52; // выигрышный тайл ближе к концу ленты
    const win = { type: prize.type, amount: prize.amount, breed: prize.breed, rarity: prize.rarity, businessName: prize.businessName };
    let html = '';
    for (let i = 0; i < N; i++) html += (i === WIN) ? caseTileHtml(win) : caseTileHtml(randomFiller());
    track.innerHTML = html;
    track.style.transition = 'none'; track.style.transform = 'translate3d(0,-50%,0)';
    el.classList.add('on');
    requestAnimationFrame(() => {
      if (settled) return;
      const tileW = 96 + 10;                                   // ширина тайла + gap
      const reelW = el.querySelector('.ck-case__reel').clientWidth;
      const jitter = (Math.random() * 2 - 1) * 22;              // лёгкий сдвиг от центра (±22px), тайл всё равно под маркером
      const target = -(WIN * tileW + 48 - reelW / 2) + jitter;
      void track.offsetWidth;
      track.style.transition = 'transform 4.4s cubic-bezier(.10,.62,.14,1)';
      track.style.transform = 'translate3d(' + target.toFixed(1) + 'px,-50%,0)';
      window.haptic && window.haptic('light');
      revealTimer = setTimeout(() => { if (!settled) revealCase(prize, res, el, balanceBefore, newBalance, cost, finish); }, 4550);
    });
    });
  }
  function revealCase(prize, res, el, balanceBefore, newBalance, cost, finish) {
    let title, sub = '';
    if (prize.type === 'coins') { title = `+${fmt(prize.amount)} ${COIN(22)}`; if (prize.amount >= 10000000) sub = 'СУПЕРДЖЕКПОТ · ШАНС 0,05%!'; else if (prize.amount >= 150000) sub = 'ДЖЕКПОТ!'; else if (prize.amount < CASE_COST) sub = 'В этот раз немного — крутани ещё'; }
    else if (prize.type === 'turbo') { title = `${ICON.rocket(22)} Турбо ×5`; sub = '20 секунд множителя за тап'; }
    else if (prize.type === 'energy') { title = `${ICON.bolt(22)} Полная энергия`; }
    else if (prize.type === 'business') { title = `${ICON.shop(22)} ${prize.businessName || 'Уровень бизнеса'}`; sub = `Бесплатная прокачка · рыночная цена ${fmt(prize.marketValue || 0)}`; }
    else { const meta = DOVE_META[prize.breed] || { name: 'Голубь', r: prize.rarity }; const rl = { common: 'обычный', rare: 'редкий', epic: 'эпический', legendary: 'легендарный' }[meta.r || prize.rarity] || ''; title = `${meta.name}`; sub = `${rl} голубь · цена ${fmt(prize.marketValue || 0)}${prize.isNew ? ' · новый в альбоме!' : ' · дубль для звёзд/гонок'}`; }
    const itemText = prize.type === 'coins' ? ` + ${fmt(prize.amount || 0)}` : ` + предмет ${fmt(prize.marketValue || 0)}`;
    const receipt = Number.isFinite(Number(balanceBefore)) && Number.isFinite(Number(newBalance)) ? `<div class="rs">Было ${fmt(balanceBefore)} − ${fmt(cost || CASE_COST)}${itemText} = ${fmt(newBalance)} монет${prize.type === 'coins' ? '' : ' + предмет'}</div>` : '';
    const canAgain = st && Number(st.balance) >= CASE_COST;
    res.innerHTML = `<div class="rt">${title}</div><div class="rs">${sub}</div>${receipt}<div class="ck-case__actions"><button id="ck-case-again" type="button"${canAgain ? '' : ' disabled'}>${canAgain ? `Крутить ещё · ${fmt(CASE_COST)}` : 'Не хватает монет'}</button><button class="secondary" id="ck-case-ok" type="button">Закрыть</button></div>`;
    res.classList.add('on');
    const big = prize.type === 'business' || prize.type === 'pigeon' && (prize.rarity === 'epic' || prize.rarity === 'legendary') || (prize.type === 'coins' && prize.amount >= 150000);
    window.haptic && window.haptic(big ? 'success' : 'light');
    if (big) { sfxLevel(); confettiBurst(); coinShower(); } else sfxReward();
    const close = el.querySelector('#ck-case-x'); close.disabled = false; close.style.opacity = '1'; close.onclick = () => finish(true);
    res.querySelector('#ck-case-ok').onclick = () => finish(true);
    const again = res.querySelector('#ck-case-again');
    if (again && canAgain) again.onclick = () => { again.disabled = true; finish(false); setTimeout(openCaseAct, 0); };
  }

  // ── Мини-игра «Золотой дождь» (canvas, 20с лови монеты) ───────────────────────
  function rainAvailable() { return !st || st.rainAvailable; }
  async function openRain() {
    return withLock('rain-start', async () => {
      if (gameSubmissions.size) { flashMsg('Сохраняем предыдущий результат…'); return; }
      if (!rainAvailable()) { flashMsg('Игра будет снова ' + untilNewDay()); return; }
      if (!(await beginGameAttempt('rain'))) return;
      let el = ov.querySelector('#ck-rain');
      if (!el) {
        el = document.createElement('div'); el.id = 'ck-rain'; el.className = 'ck-rain';
        el.innerHTML = `<div class="ck-rain__hud"><div class="t">${ICON.bolt(16)} <span id="ck-rain-t">20</span></div><div class="sp"></div><div class="s">${COIN(16)} <span id="ck-rain-s">0</span></div><button class="x" id="ck-rain-x">×</button></div><canvas id="ck-rain-cv"></canvas><div class="ck-rain__hint" id="ck-rain-hint">Лови падающие монеты! Золотые — ×3</div>`;
        ov.appendChild(el); el.querySelector('#ck-rain-x').onclick = confirmRainExit;
      }
      el.querySelector('#ck-rain-s').textContent = '0'; el.querySelector('#ck-rain-t').textContent = '20'; el.querySelector('#ck-rain-hint').style.display = '';
      el.classList.add('on'); startRain();
    });
  }
  function startRain() {
    const el = ov.querySelector('#ck-rain'), cv = el.querySelector('#ck-rain-cv');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const elr = el.getBoundingClientRect(), hud = el.querySelector('.ck-rain__hud').getBoundingClientRect();
    const W = elr.width, H = Math.max(200, elr.height - hud.height);
    cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    rainState = { items: [], score: 0, tEnd: performance.now() + 20000, lastSpawn: 0, W, H, ctx, ended: false, lastTs: performance.now() };
    cv.onpointerdown = (e) => { e.preventDefault(); const r = cv.getBoundingClientRect(); hitRain(e.clientX - r.left, e.clientY - r.top); };
    cancelAnimationFrame(rainRAF); rainRAF = requestAnimationFrame(rainLoop);
  }
  function hitRain(x, y) {
    const s = rainState; if (!s) return;
    for (let i = s.items.length - 1; i >= 0; i--) { const it = s.items[i]; const dx = x - it.x, dy = y - it.y, rr = it.r + 10; if (dx * dx + dy * dy <= rr * rr) { s.items.splice(i, 1); s.score += it.gold ? 3 : 1; ov.querySelector('#ck-rain-s').textContent = s.score; ov.querySelector('#ck-rain-hint').style.display = 'none'; note(it.gold ? 1320 : 880, 0.11, 'triangle', 0.07, it.gold ? 1760 : 1400); window.haptic && window.haptic('light'); break; } }
  }
  function rainLoop(ts) {
    const s = rainState; if (!s || s.ended) return;
    const now = ts || performance.now();
    if (now - s.lastTs < MG_MIN_FRAME_MS) { rainRAF = requestAnimationFrame(rainLoop); return; }
    const dt = Math.min(0.05, (now - s.lastTs) / 1000); s.lastTs = now;
    const left = Math.max(0, (s.tEnd - now) / 1000); ov.querySelector('#ck-rain-t').textContent = Math.ceil(left);
    if (left <= 0) { endRain(false); return; }
    if (now - s.lastSpawn > Math.max(230, 420 - s.score * 3)) { s.lastSpawn = now; const gold = Math.random() < 0.15; const r = gold ? 21 : 16; s.items.push({ x: r + Math.random() * (s.W - 2 * r), y: -r, r, vy: 110 + Math.random() * 150, gold }); }
    const ctx = s.ctx; ctx.clearRect(0, 0, s.W, s.H);
    for (let i = s.items.length - 1; i >= 0; i--) { const it = s.items[i]; it.y += it.vy * dt; if (it.y - it.r > s.H) { s.items.splice(i, 1); continue; } drawRainCoin(ctx, it); }
    rainRAF = requestAnimationFrame(rainLoop);
  }
  function drawRainCoin(ctx, it) {
    ctx.save(); ctx.translate(it.x, it.y);
    const g = ctx.createRadialGradient(-it.r * 0.3, -it.r * 0.3, it.r * 0.2, 0, 0, it.r);
    g.addColorStop(0, '#fff3cf'); g.addColorStop(.5, '#C0FF33'); g.addColorStop(1, '#8DBF20');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, it.r, 0, 7); ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = it.gold ? '#fff' : '#5E7B1E'; ctx.stroke();
    if (it.gold) { ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.beginPath(); ctx.arc(0, 0, it.r + 2.5, 0, 7); ctx.stroke(); }
    ctx.fillStyle = '#16210A'; ctx.font = `700 ${Math.round(it.r * 1.05)}px Georgia,serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('М', 0, it.r * 0.08);
    ctx.restore();
  }
  // × мид-гейм: набранное сгорит, но неподтверждённая сервером попытка не расходуется.
  function confirmRainExit() {
    const s = rainState; if (!s || s.ended) return;
    if (!s.score) { endRain(true); return; } // терять нечего — выходим сразу
    s.pauseLeft = Math.max(0, s.tEnd - performance.now()); cancelAnimationFrame(rainRAF);
    const el = ov.querySelector('#ck-rain');
    let c = el.querySelector('#ck-rain-cfm');
    if (!c) { c = document.createElement('div'); c.id = 'ck-rain-cfm'; c.className = 'ck-rain__cfm'; el.appendChild(c); }
    c.innerHTML = `<div class="b"><div class="t">Выйти из игры?</div><div class="s">Собранные ${s.score} ${COIN(13)} сгорят, но игру можно будет начать заново</div><div class="r"><button class="stay" id="ck-rain-stay">Доиграть</button><button class="quit" id="ck-rain-quit">Выйти</button></div></div>`;
    c.querySelector('#ck-rain-stay').onclick = () => { c.remove(); const p = rainState; if (!p || p.ended) return; p.tEnd = performance.now() + p.pauseLeft; p.lastTs = performance.now(); cancelAnimationFrame(rainRAF); rainRAF = requestAnimationFrame(rainLoop); window.haptic && window.haptic('light'); };
    c.querySelector('#ck-rain-quit').onclick = () => { window.haptic && window.haptic('light'); endRain(true); };
    window.haptic && window.haptic('warning');
  }
  function endRain(aborted) {
    const s = rainState; if (!s || s.ended) return; s.ended = true; cancelAnimationFrame(rainRAF);
    const el = ov.querySelector('#ck-rain'); el.classList.remove('on');
    const cfm = el.querySelector('#ck-rain-cfm'); if (cfm) cfm.remove(); // close() мог прийти при открытом confirm
    if (aborted) { clearGameAttempt('rain'); rainState = null; return; }
    submitRain(s.score); rainState = null;
  }
  async function submitRain(score) {
    const gameSession = overlaySession;
    gameSubmissions.add('rain'); renderGames();
    let reward = 0, netfail = false;
    try {
      if (authed()) {
        const expected = Math.min(8000, 1500 + playerLeague().level * 500);
        const d = await submitAttemptResult('/api/clicker/rain', 'rain', score, expected).catch(() => null);
        if (!overlaySessionActive(gameSession)) return;
        if (d && !d.error) { applyServerState(d); reward = d.reward; }
        else if (d && d.error) { sfxError(); flashMsg('Результат не засчитан — запусти игру заново'); renderAll(); return; }
        else netfail = true;
      }
      else { const g = guestClaimRainRaw(score); if (g != null) { reward = g; applyServerState(guestDerive()); } }
      if (!overlaySessionActive(gameSession)) return;
      if (netfail && !reward) { sfxError(); flashMsg('Нет связи — результат не засчитан'); renderAll(); return; } // не праздновать «+0» с конфетти
      sfxReward(); window.haptic && window.haptic('success'); confettiBurst(); coinShower(); dailyPopupRaw(ICON.rain(20) + ` Золотой дождь · ${score} ${plu(score, 'монета', 'монеты', 'монет')}`, reward || 0); renderAll(); renderTasks(); bumpBalance();
    } finally {
      gameSubmissions.delete('rain');
      if (overlaySessionActive(gameSession)) renderGames();
    }
  }
  // ── Хаб «Игры»: единый claim (clamp+гейт 1/день; для гостя — localStorage) ────
  const GAME_CAP = { quiz_kids: { reward: 2500 }, quiz_riddle: { reward: 2400 }, count: { reward: 1200 }, memory: { reward: 3000 }, gems: { reward: 4500 }, tower: { reward: 6000 } };
  // gamesDone приходит только в getClicker/claimGame; tap/buy его не несут → кэшируем
  let gdCache = [], gdCacheDay = irkToday();
  function gamesDoneNow() {
    if (authed()) {
      const today = irkToday();
      if (gdCacheDay !== today) { gdCache = []; gdCacheDay = today; }
      if (st && Array.isArray(st.gamesDone)) { gdCache = st.gamesDone; gdCacheDay = today; }
      return gdCache;
    }
    return guestGamesDoneList();
  }
  function gameDone(g) { return gamesDoneNow().indexOf(g) >= 0; }
  function guestGamesDoneList() { const s = rawGet(); const today = irkToday(); const g = s.gamesDone || {}; return Object.keys(g).filter(k => g[k] === today); }
  function guestClaimGameRaw(game, score) {
    const cfg = GAME_CAP[game]; if (!cfg) return null; guestDerive(); const s = rawGet(); const today = irkToday();
    if (!s.gamesDone) s.gamesDone = {}; if (s.gamesDone[game] === today) return null;
    const reward = cfg.reward;
    s.balance += reward; s.totalEarned += reward; s.gamesDone[game] = today; rawSave(s); return reward;
  }
  async function submitGame(game, score) {
    gameSubmissions.add(game); renderGames();
    try {
      let reward = 0, pigeonDrop;
      if (authed()) { const d = await submitAttemptResult('/api/clicker/game', game, score, GAME_CAP[game]?.reward || 0).catch(() => null); if (d && !d.error) { applyServerState(d); reward = d.reward || 0; pigeonDrop = d.pigeonDrop; } else return d && d.error ? { error: d.error } : null; /* сеть/попытка упала — не праздновать «+0» */ }
      else { const g = guestClaimGameRaw(game, score); if (g != null) { reward = g; applyServerState(guestDerive()); } else return { error: 'already' }; }
      return { reward, pigeonDrop };
    } finally {
      gameSubmissions.delete(game);
    }
  }

  function guestClaimRainRaw(score) {
    guestDerive(); const s = rawGet(); const today = irkToday(); if (s.rainDate === today) return 0;
    const lvl = leagueFor(s.totalEarned).level; const reward = Math.min(8000, 1500 + lvl * 500);
    s.balance += reward; s.totalEarned += reward; s.rainDate = today; rawSave(s); return reward;
  }

  // ── Карточка-хвастовство (canvas → шеринг) ────────────────────────────────────
  function drawCardCoin(ctx, x, y, r) {
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.2, x, y, r);
    g.addColorStop(0, '#fff3cf'); g.addColorStop(.5, '#C0FF33'); g.addColorStop(1, '#8DBF20');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#5E7B1E'; ctx.stroke();
    ctx.fillStyle = '#16210A'; ctx.font = `700 ${Math.round(r * 1.15)}px Georgia,serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('М', x, y + r * 0.06);
  }
  async function shareCard() {
    const lg = playerLeague();
    const cv = document.createElement('canvas'); cv.width = 720; cv.height = 900; const ctx = cv.getContext('2d');
    const bg = ctx.createRadialGradient(360, -40, 80, 360, 520, 920); bg.addColorStop(0, '#4e1b26'); bg.addColorStop(.55, '#2c1017'); bg.addColorStop(1, '#180a0f'); ctx.fillStyle = bg; ctx.fillRect(0, 0, 720, 900);
    const gl = ctx.createRadialGradient(360, 430, 40, 360, 430, 300); gl.addColorStop(0, 'rgba(255,196,72,.5)'); gl.addColorStop(.5, 'rgba(255,170,48,.16)'); gl.addColorStop(1, 'rgba(255,170,48,0)'); ctx.fillStyle = gl; ctx.fillRect(0, 130, 720, 640);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#D8FF7A'; ctx.font = '700 48px Georgia,serif'; ctx.fillText('Котик Комбат', 360, 92);
    await new Promise((res) => { const img = new Image(); img.onload = () => { let w = img.width, h = img.height; const sc = Math.min(380 / w, 430 / h); w *= sc; h *= sc; ctx.drawImage(img, 360 - w / 2, 500 - h, w, h); res(); }; img.onerror = res; img.src = A(lg.cat || 'idle.png'); });
    ctx.fillStyle = '#f4ead7'; ctx.font = '700 42px Georgia,serif'; ctx.fillText(lg.name, 360, 590);
    ctx.fillStyle = '#bb9d88'; ctx.font = '600 27px Georgia,serif'; ctx.fillText('Уровень ' + lg.level, 360, 628);
    const bal = fmt(Math.floor(st.totalEarned)); ctx.font = '700 58px Georgia,serif'; const tw = ctx.measureText(bal).width; const total = 64 + tw, sx = 360 - total / 2;
    drawCardCoin(ctx, sx + 26, 700, 28); ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(bal, sx + 64, 718); ctx.textAlign = 'center';
    ctx.fillStyle = '#A8F51E'; ctx.font = '600 26px Georgia,serif'; ctx.fillText('Кондитерская «Мария»', 360, 818);
    ctx.fillStyle = '#bb9d88'; ctx.font = '400 21px Georgia,serif'; ctx.fillText('Тапай котика — от уличного до императора', 360, 854);
    cardPopup(cv.toDataURL('image/png'));
  }
  function cardPopup(url) {
    const pop = ov.querySelector('#ck-pop');
    pop.innerHTML = `<h3>${ICON.trophy(18)} Твоя карточка</h3><img src="${url}" alt="" style="width:240px;max-width:72vw;border-radius:14px;display:block;margin:10px auto;border:1px solid var(--line)"/><div style="display:flex;gap:8px;justify-content:center"><a class="ck-card__buy" href="${url}" download="kotik-kombat.png" style="text-decoration:none;justify-content:center">Сохранить</a><button class="ck-card__buy" id="ck-card-share" style="justify-content:center">Поделиться</button></div><button id="ck-pop-ok" style="margin-top:10px">Закрыть</button>`;
    pop.classList.add('on'); pop.querySelector('#ck-pop-ok').onclick = () => pop.classList.remove('on');
    pop.querySelector('#ck-card-share').onclick = () => shareImg(url);
  }
  async function shareImg(url) {
    try { const blob = await (await fetch(url)).blob(); const file = new File([blob], 'kotik-kombat.png', { type: 'image/png' }); if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: 'Мой котик в «Котик Комбат» от кондитерской «Мария»!' }); return; } } catch (_) {}
    shareRef();
  }

  function renderTop2() { // лёгкий рендер баланса при тапе (без полного)
    ov.querySelector('#ck-bal').textContent = fmt(st.balance);
    ov.querySelector('#ck-en').textContent = Math.floor(st.energy);
    ov.querySelector('#ck-enfill').style.width = Math.min(100, st.energy / st.energyMax * 100) + '%';
  }

  function prestigeConfirm() {
    if (!st || !st.prestigeReady) return;
    if (!authed()) { flashMsg('Престиж — при входе через «Марию»'); return; }
    const next = (st.prestige || 0) + 1, m = (1 + next * 0.1).toFixed(1);
    const pop = ov.querySelector('#ck-pop');
    pop.innerHTML = `<h3>${ICON.star(20)} Престиж ${next}</h3>`
      + `<div style="color:var(--cream);font-size:14px;line-height:1.5;margin:6px 0 4px">Сбросишь баланс, бизнесы и апгрейды — но <b style="color:var(--gold-l)">навсегда</b> получишь <b style="color:var(--gold-l)">×${m}</b> к заработку.</div>`
      + `<div style="color:var(--muted);font-size:12.5px;line-height:1.45">Серия, друзья, команда и достижения останутся.</div>`
      + `<button id="ck-pp-go">Уйти в престиж</button>`
      + `<button id="ck-pp-no" style="background:rgba(255,255,255,.08);color:var(--cream);box-shadow:none;border-color:var(--line);margin-top:8px">Пока нет</button>`;
    pop.classList.add('on');
    pop.querySelector('#ck-pp-no').onclick = () => pop.classList.remove('on');
    pop.querySelector('#ck-pp-go').onclick = () => { pop.classList.remove('on'); prestigeDo(); };
  }
  async function prestigeDo() {
    return withLock('prestige', async () => {
    const actionSession = overlaySession;
    const beforePrestige = Number(st && st.prestige || 0);
    let d = await mutationApi('/api/clicker/prestige', { method: 'POST', body: '{}' }).catch(() => null);
    if (!d || d.error === 'internal') {
      const fresh = await stateApi('/api/clicker').catch(() => null);
      if (fresh && !fresh.error && Number(fresh.prestige) > beforePrestige) { applyServerState(fresh); d = { ...fresh, prestige: fresh.prestige, recovered: true }; }
    }
    if (d && !d.error) {
      applyServerState(d);
      if (!overlaySessionActive(actionSession)) return;
      sfxLevel(); window.haptic && window.haptic('success'); flash(); confettiBurst(); coinShower();
      const t = ov.querySelector('#ck-levelup-t'); t.innerHTML = ICON.star(22) + ' Престиж ' + d.prestige + ' · заработок ×' + (1 + d.prestige * 0.1).toFixed(1); t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
      renderAll(); renderUpgrades(); bumpBalance();
    } else if (overlaySessionActive(actionSession)) flashMsg(d && d.error === 'not_ready' ? 'Сначала дойди до макс. уровня' : d && d.error === 'max' ? 'Достигнут максимум престижа' : 'Не получилось');
    });
  }
  function renderAll() {
    if (!ov || !st) return;
    const lg = playerLeague();
    ov.querySelector('#ck-bal').textContent = fmt(st.balance);
    ov.querySelector('#ck-bal2').textContent = fmt(st.balance);
    const pBadge = st.prestige > 0 ? ` <span class="ck-pbadge">${ICON.star(12)} Престиж ${st.prestige}</span>` : '';
    ov.querySelector('#ck-lvl').innerHTML = `Уровень ${lg.level} · ${lg.name}${pBadge}`;
    // Бафф копилки стаи виден там, где игрок живёт — рядом с доходом
    const bankChip = (st.bankMult && st.bankMult > 1) ? ` <span style="color:var(--gold,#D4FF6A);font-weight:800">⚔️×${st.bankMult}</span>` : '';
    const prof = `${COIN(13)} +${fmt(Math.floor(st.profitPerHour * passiveIncomeMult()))} / час${bankChip}`; ov.querySelector('#ck-prof').innerHTML = prof; ov.querySelector('#ck-prof2').innerHTML = prof;
    // бейдж «Призы»: сколько бесплатного ГОТОВО забрать прямо сейчас (сундук, комбо) —
    // дискаверабилити ежедневок с любой вкладки (аудит: вкладка без индикатора)
    const tb = ov.querySelector('#ck-tasks-badge');
    if (tb) {
      const ready = (st.chestAvailable ? 1 : 0) + ((st.combo && st.combo.complete && !st.combo.claimed) ? 1 : 0);
      if (ready > 0 && !tabLocked('tasks')) { tb.textContent = String(ready); tb.hidden = false; } else tb.hidden = true;
    }
    // ивент-баннер (×N монеты)
    const evb = ov.querySelector('#ck-event');
    if (st.event && st.event.active && Number(st.event.endsTs) > Date.now()) { evb.hidden = false; evb.innerHTML = `${ICON.bolt(15)} <b>${st.event.name}</b> · до конца ${fmtDur(st.event.endsTs - Date.now())}`; }
    else evb.hidden = true;
    const offer = ov.querySelector('#ck-shop-offer');
    if (offer) offer.hidden = true;
    const actions = ov.querySelector('#ck-shop-actions');
    if (actions) { actions.hidden = false; const site = actions.querySelector('#ck-shop-site'); const point = actions.querySelector('#ck-shop-point'); const go = async (kind, u) => { const d = await api('/api/clicker/commerce-click', { method: 'POST', body: JSON.stringify({ kind, taskId: 'daily-offer' }) }).catch(() => null); if (d?.token && kind === 'site') { const sep = u.includes('?') ? '&' : '?'; u += sep + 'maria_ref=' + encodeURIComponent(d.token); } if (window.App?.openExternal) App.openExternal(u); else window.open(u, '_blank', 'noopener'); }; if (site) site.onclick = () => go('site', 'https://maria-irk.ru/'); if (point) point.onclick = () => go('store', 'https://yandex.ru/maps/?text=Мария%20кондитерская%20Иркутск'); }
    // кнопка престижа (на макс. уровне, только для авторизованных)
    const pb = ov.querySelector('#ck-prestige');
    if (st.prestigeReady && authed()) { pb.hidden = false; pb.innerHTML = `${ICON.star(16)} Уйти в престиж · заработок ×${(1 + (st.prestige + 1) * 0.1).toFixed(1)}`; }
    else pb.hidden = true;
    ov.querySelector('#ck-en').textContent = Math.floor(st.energy); ov.querySelector('#ck-enmax').textContent = st.energyMax;
    ov.querySelector('#ck-enfill').style.width = Math.min(100, st.energy / st.energyMax * 100) + '%';
    if (!energyHintFired && tab === 'cat' && st.energyMax > 0 && st.energy / st.energyMax < 0.15) { energyHintFired = true; coach('energy', COACH.energy.t, '.ck-energy', { icon: ICON[COACH.energy.icon](18) }); }
    if (!boostsHintFired && tab === 'cat' && lg.level >= 2) { boostsHintFired = true; coach('boosts', COACH.boosts.t, '.ck-boosts', { icon: ICON[COACH.boosts.icon](18) }); }
    const nn = nextNeedForLevel(lg.level), prog = ov.querySelector('#ck-prog'), progt = ov.querySelector('#ck-progt');
    if (nn) { const pct = Math.max(0, Math.min(100, (st.totalEarned - lg.need) / (nn - lg.need) * 100)); prog.style.width = pct + '%'; progt.innerHTML = `${fmt(st.totalEarned)} / ${fmt(nn)} ${COIN(12)} до ур. ${lg.level + 1}`; }
    else { prog.style.width = '100%'; progt.textContent = 'Максимальный уровень!'; }
    // цель — силуэт следующего котика
    const goal = ov.querySelector('#ck-goal'), nx = LEAGUES[lg.level];
    if (nx && nn) { goal.hidden = false; const gi = ov.querySelector('#ck-goal-img'), gs = A(nx.cat); if (gi.getAttribute('src') !== gs) gi.src = gs; ov.querySelector('#ck-goal-l').textContent = nx.name; goal.title = 'Цель: ' + nx.name; }
    else goal.hidden = true;
    // ежедневка
    const daily = ov.querySelector('#ck-daily');
    daily.style.display = '';
    if (st.dailyAvailable) { daily.classList.remove('done'); daily.innerHTML = `${ICON.gift(16)} Награда дня · День ${st.dailyStreak + 1}`; }
    else { daily.classList.add('done'); daily.innerHTML = `${ICON.gift(16)} Награда ✓ · день ${st.dailyStreak}`; }
    // бусты
    ov.querySelector('#ck-bt-turbo-n').textContent = '(' + st.boostTurboLeft + ')';
    ov.querySelector('#ck-bt-energy-n').textContent = '(' + st.boostEnergyLeft + ')';
    ov.querySelector('#ck-bt-turbo').disabled = st.boostTurboLeft <= 0 || turboOn(); // во время турбо тап впустую сжёг бы заряд
    ov.querySelector('#ck-bt-energy').disabled = st.boostEnergyLeft <= 0 || st.energy >= st.energyMax;
    // турбо-вид
    const on = turboOn(); ov.classList.toggle('turbo', on); ov.querySelector('#ck-cat').classList.toggle('turbo', on);
    if (on) ov.querySelector('#ck-enpre').innerHTML = ICON.rocket(15) + ' ТУРБО ×5! ·';
    else ov.querySelector('#ck-enpre').innerHTML = ICON.bolt(15);
    if (lg.level !== curLevel) { if (lg.level > curLevel) levelUp(lg); curLevel = lg.level; }
    const tier = bgTier(lg.level); if (ov.dataset.tier !== '' + tier) ov.dataset.tier = '' + tier;
    applyCostume(lg);
    applyTabLocks();
  }
  // Пер-уровневые сцены карьеры: фон = уровень 1..19 (career-N.webp)
  function bgTier(l) { return Math.min(19, Math.max(1, l)); }
  function applyCostume(lg) {
    const cat = ov.querySelector('#ck-cat'), hat = ov.querySelector('#ck-hat');
    hat.style.display = 'none'; // шапки-наклейки убраны — костюм = смена всей картинки кота
    const src = A(lg.cat || 'idle.png');
    if (cat.getAttribute('src') !== src) cat.src = src;
    applyCatSize(cat);
  }
  function levelUp(lg) {
    sfxLevel(); window.haptic && window.haptic('success');
    const oldSrc = (ov.querySelector('#ck-cat') || {}).src; // костюм сменится в applyCostume — кросс-фейд
    flash(); confettiBurst(); coinShower(); evolveCat(oldSrc);
    const t = ov.querySelector('#ck-levelup-t'); t.innerHTML = ICON.star(22) + ' ' + lg.name; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
  }

  function renderUpgrades() {
    if (!ov || !st) return; const list = ov.querySelector('#ck-uplist');
    const biz = (cat, art, name, metaHtml, buyHtml, idx) => `<div class="ck-biz cat-${cat.replace(' locked', '')}${cat.includes('locked') ? ' locked' : ''}" style="animation-delay:${(idx * 0.035).toFixed(2)}s"><div class="ck-biz__art">${art}</div><div class="ck-biz__b"><div class="ck-biz__n">${name}</div><div class="ck-biz__meta">${metaHtml}</div></div>${buyHtml}</div>`;
    const buyBtn = (price, dis, act, id) => `<button class="ck-biz__buy" data-act="${act}" data-id="${id || ''}" ${dis ? 'disabled' : ''}>${COIN(15)} ${fmt(price)}</button>`;
    let h = '<div class="ck-intro">Бизнесы приносят монеты <b>сами</b> — доход капает даже когда игра закрыта. Бусты усиливают тап и энергию.</div><div class="ck-sect">Бусты</div>';
    h += biz('boost', cardArt('multitap'), 'Мультитап', `<span class="ck-biz__lvl">+1 за тап</span><span class="ck-biz__prof">сейчас +${st.perTap}</span>`, buyBtn(st.multitapPrice, st.balance < st.multitapPrice, 'multitap'), 0);
    h += biz('boost', cardArt('energy'), 'Запас энергии', `<span class="ck-biz__lvl">+500 энергии</span><span class="ck-biz__prof">сейчас ${st.energyMax}</span>`, buyBtn(st.energyPrice, st.balance < st.energyPrice, 'energy'), 1);
    h += '<div class="ck-sect">Бизнесы — пассивный доход · офлайн до 3 часов</div>';
    h += '<div class="ck-cats">' + CARD_CATS.map(ct => `<button class="ck-cat-chip${ct.id === upCat ? ' on' : ''}" data-cat="${ct.id}">${ct.name}</button>`).join('') + '</div>';
    let i = 0;
    for (const c of st.cards) {
      if (c.cat !== upCat) continue;
      if (c.locked) h += biz(c.cat + ' locked', cardArt(c.id), c.name, `<span class="ck-biz__lock">${ICON.lock(12)} с уровня ${c.req}</span>`, `<button class="ck-biz__buy" disabled aria-label="Откроется с уровня ${c.req}">${ICON.lock(15)}</button>`, i++);
      else {
        const baseGain = Number(c.profitGain != null ? c.profitGain : Math.max(0, c.profit - (c.currentProfit || 0)));
        const gain = Math.floor(baseGain * (Number(st.albumMult) || 1) * passiveIncomeMult());
        const maxed = c.maxed || c.level >= 20;
        h += biz(c.cat, cardArt(c.id), c.name, `<span class="ck-biz__lvl">Ур. ${c.level}${maxed ? ' · максимум' : ''}</span><span class="ck-biz__prof">${maxed ? 'Прокачка завершена' : `+${fmt(gain)}/час`}</span>`, maxed ? `<button class="ck-biz__buy" disabled>MAX</button>` : buyBtn(c.price, st.balance < c.price, 'card', c.id), i++);
      }
    }
    list.innerHTML = h;
    if (lastBought) { const el = list.querySelector(`[data-id="${lastBought}"]`); const card = el && el.closest('.ck-biz'); if (card) { card.classList.add('bump'); if (bizCoachPending) coach('bizFirst', COACH.bizFirst.t, card, { icon: ICON[COACH.bizFirst.icon](18) }); } bizCoachPending = false; lastBought = null; }
    list.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { window.haptic && window.haptic('selection'); upCat = b.dataset.cat; renderUpgrades(); });
    list.querySelectorAll('[data-act]').forEach(b => b.onclick = () => buy(b.dataset.act, b.dataset.id || undefined));
  }
  // (renderDove/helperPopup — витрина бизнес-голубей «Помощники» — удалены 04.08.2026:
  //  вкладка «Голуби» теперь = альбом пород CatDove, монтируется в mountDoveCol.)
  function skelRows(n) { let h = ''; for (let i = 0; i < n; i++) h += '<div class="ck-skrow"><span class="sk-r ck-skel"></span><span class="sk-n ck-skel"></span><span class="sk-v ck-skel"></span></div>'; return h; }
  // «Сегодня» — статус ежедневок одной строкой (в шапке вкладки «Призы»): что уже сделано,
  // что ждёт. Подсвечиваем золотым то, что можно забрать/сделать прямо сейчас.
  function todayStatusHtml() {
    if (!st) return '';
    const cmb = st.combo || {};
    const chip = (label, done, pend) => `<span class="ck-today__i ${done ? 'done' : pend ? 'pend' : ''}">${label}</span>`;
    const comboDone = !!cmb.claimed, comboPend = !!cmb.complete && !cmb.claimed;
    const comboLbl = comboDone ? 'Комбо ✓' : comboPend ? 'Комбо готово!' : 'Комбо ' + ((cmb.hits && cmb.hits.length) || 0) + '/3';
    return `<div class="ck-today"><span class="ck-today__t">Сегодня</span>
      ${chip(st.dailyAvailable ? 'Награда дня' : 'Награда ✓', !st.dailyAvailable, st.dailyAvailable)}
      ${chip(comboLbl, comboDone, comboPend)}
      ${chip(st.chestAvailable ? 'Сундук готов!' : 'Сундук ✓', !st.chestAvailable, st.chestAvailable)}
    </div>`;
  }
  function emptyState(ic, title, sub) { return `<div class="ck-empty"><div class="ck-empty__ic">${ic}</div><div class="ck-empty__t">${title}</div><div class="ck-empty__s">${sub}</div></div>`; }
  let topGen = 0;
  async function renderTop() {
    const gen = ++topGen;
    const list = ov.querySelector('#ck-toplist'); const rank = ov.querySelector('#ck-myrank');
    const left = fmtDur(seasonEndsTs() - Date.now());
    const introTop = '<div class="ck-intro">Топ недели — по заработанным монетам, в воскресенье сезон закрывается и раздаются места. Команды складывают монеты всех участников.</div>';
    // «Похвастаться» — только когда есть чем: у гостя и игрока с 0 очков сезона кнопка спрятана (аудит 30.07)
    const canBrag = authed() && st && st.season && Number(st.season.points) > 0;
    const brag = canBrag ? `<button class="ck-card__buy" id="ck-brag" style="width:100%;justify-content:center;margin-bottom:12px">${ICON.trophy(15)} Похвастаться карточкой</button>` : '';
    const ref = PURE ? refCard('ck-invite2') : '';
    const sq = await squadBlock();
    if (gen !== topGen) return;
    const wire = () => {
      const bb = ov.querySelector('#ck-brag'); if (bb) bb.onclick = shareCard;
      const inv = ov.querySelector('#ck-invite2'); if (inv) inv.onclick = shareRef;
      const retry = ov.querySelector('#ck-top-retry'); if (retry) retry.onclick = () => renderTop();
      sq.wire();
    };
    if (!authed()) { rank.textContent = `Сезон недели · до сброса ${left}`; list.innerHTML = introTop + brag + ref + sq.html + '<div class="ck-sect">Топ недели</div>' + emptyState(ICON.trophy(30), 'Личный рейтинг закрыт', PURE ? 'Открой игру в Telegram — копи монеты и попадай в топ недели.' : 'Войди через приложение «Мария» — копи монеты и попадай в топ недели.'); wire(); return; }
    list.innerHTML = introTop + brag + ref + sq.html + '<div class="ck-sect">Топ недели</div>' + skelRows(5); wire();
    const d = await loadTop();
    if (gen !== topGen) return;
    const ends = d && d.seasonEndsTs ? fmtDur(d.seasonEndsTs - Date.now()) : left;
    rank.textContent = `Сезон недели · до сброса ${ends}` + (d && d.myRank ? ` · ты #${d.myRank}` : '');
    const wk = weeklyPrizeCard(d && d.weekly);
    const head = '<div class="ck-sect">Топ недели</div>';
    if (!d || d.error || !Array.isArray(d.top)) {
      list.innerHTML = introTop + brag + ref + sq.html + head + emptyState(ICON.bolt(30), 'Не удалось загрузить рейтинг', 'Проверь связь и попробуй ещё раз.') + '<button class="ck-card__buy" id="ck-top-retry" style="width:100%;justify-content:center">Обновить</button>';
      wire(); return;
    }
    if (!d || !d.top || !d.top.length) { list.innerHTML = introTop + brag + ref + wk + sq.html + head + emptyState(ICON.trophy(30), 'Сезон только начался', 'Заработай монеты и стань первым в топе недели!'); wire(); return; }
    list.innerHTML = introTop + brag + ref + wk + sq.html + head + d.top.map((r, i) => {
      // showcase/title — Task 8 (getTop), могут отсутствовать у старого закэшированного клиента.
      const mini = (window.CatDove && window.CatDove.miniIconsHtml) ? window.CatDove.miniIconsHtml(r.showcase) : '';
      const titleBadge = r.title ? ` <span class="ck-pbadge ck-pbadge--sm ck-pbadge--baron">${ICON.dove(10)}${String(r.title).replace(/</g, '&lt;')}</span>` : '';
      return `<div class="ck-row${r.me ? ' me' : ''}"><div class="r">${i < 3 ? ICON.medal(20) : i + 1}</div><div class="n"><div>${(r.name || '').replace(/</g, '&lt;')}${r.prestige > 0 ? ` <span class="ck-pbadge ck-pbadge--sm">★${r.prestige}</span>` : ''}${titleBadge}</div>${mini}</div><div class="v">${COIN(14)} ${fmt(r.total)}</div></div>`;
    }).join('');
    wire();
  }
  function weeklyPrizeCard(w) {
    if (!w) return '';
    // Баннер «призы недели — скоро» вычищен 30.07.2026 вместе с витриной обмена
    // (не обещаем неработающее); секция появится сама, когда бэк пришлёт enabled+prizes.
    let head = '', body = '';
    if (w.enabled && w.prizes && w.prizes.length) {
      head = '<div class="ck-sect">Приз недели</div>';
      body = '<div class="ck-card ck-bonus" style="flex-direction:column;align-items:stretch;gap:8px;padding:12px 14px">'
        + w.prizes.map((p) => `<div class="ck-row"><div class="r">${ICON.medal(20)}</div><div class="n">${p.rank} место</div><div class="v" style="color:var(--gold-l)">${(p.label || '').replace(/</g, '&lt;')}</div></div>`).join('')
        + '</div>';
    }
    let lw = '';
    if (w.lastWeek && w.lastWeek.length) {
      lw = '<div class="ck-sect">Прошлая неделя</div>'
        + w.lastWeek.map((r) => `<div class="ck-row${r.me ? ' me' : ''}"><div class="r">${ICON.medal(20)}</div><div class="n">${(r.name || '').replace(/</g, '&lt;')}</div><div class="v">${COIN(14)} ${fmt(r.points)}</div></div>`).join('');
    }
    return head + body + lw;
  }
  // Состав стаи: тап по своей команде → попап со списком участников (имя + монеты
  // в общий счёт + вклад в копилку недели). Данные с /api/clicker/squad-members.
  async function openSquadMembers() {
    window.haptic && window.haptic('light');
    const pop = ov.querySelector('#ck-pop'); if (!pop) return;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    pop.innerHTML = `<h3>${ICON.users(20)} Состав стаи</h3><div id="ck-sqm-body" style="max-height:52vh;overflow:auto;text-align:left;width:100%">${skelRows(4)}</div><button id="ck-pop-ok">Закрыть</button>`;
    pop.classList.add('on');
    pop.querySelector('#ck-pop-ok').onclick = () => pop.classList.remove('on');
    const body = pop.querySelector('#ck-sqm-body');
    const d = await api('/api/clicker/squad-members').catch(() => null);
    // Ответ относится именно к созданному выше узлу. После закрытия/открытия другого
    // попапа одинаковый id больше не позволяет старому запросу испортить новый экран.
    if (!body || !body.isConnected || !pop.classList.contains('on')) return;
    if (!d || d.error) { body.innerHTML = emptyState(ICON.bolt(28), 'Не удалось загрузить состав', 'Проверь связь и открой состав ещё раз.'); return; }
    if (!d.inSquad) { body.innerHTML = emptyState(ICON.users(28), 'Ты не в стае', 'Вступи в команду в списке ниже.'); return; }
    if (!d.members || !d.members.length) { body.innerHTML = emptyState(ICON.users(28), 'Пусто', 'В стае пока никого.'); return; }
    const h3 = pop.querySelector('h3'); if (h3) h3.innerHTML = `${ICON.users(20)} «${esc(d.name)}» · ${d.members.length}`;
    body.innerHTML = d.members.map((m, i) => `<div class="ck-row${m.me ? ' me' : ''}"><div class="r">${i + 1}</div><div class="n">${esc(m.name)}${m.me ? ' · ты' : ''}</div><div class="v">${COIN(12)} ${fmt(m.coins)}${m.bank ? ` · <span style="color:var(--gold-l);font-size:11px">🏦 ${fmt(m.bank)}</span>` : ''}</div></div>`).join('');
  }
  async function squadBlock() {
    if (!authed()) {
      const chips = SQUADS.map(s => `<button class="ck-cat-chip" disabled>${s.name}</button>`).join('');
      return { html: `<div class="ck-sect">Команды</div><div class="ck-cats">${chips}</div><div style="color:var(--muted);font-size:12px;text-align:center;margin:2px 0 6px">${PURE ? 'Открой игру в Telegram — вступай в команду и тащи её в топ' : 'Войди через «Марию» — вступай в команду и тащи её в топ'}</div>`, wire: () => {} };
    }
    const d = await api('/api/clicker/squads').catch(() => null);
    if (!d || d.error || !Array.isArray(d.squads)) return {
      html: `<div class="ck-sect">Команды</div><div class="ck-card"><div class="ck-card__ic">${ICON.bolt(26)}</div><div class="ck-card__b"><div class="ck-card__n">Не удалось загрузить стаи</div><div class="ck-card__s">Проверь связь</div></div><button class="ck-card__buy" id="ck-sq-retry">Обновить</button></div>`,
      wire: () => { const b = ov.querySelector('#ck-sq-retry'); if (b) b.onclick = () => renderTop(); },
    };
    const my = d.mySquad;
    // Рейтинг: у своих стай (custom) кнопка «Попроситься» вместо мгновенного входа
    const rows = d.squads.map((s, i) => {
      const act = s.id === my ? '' : s.custom
        ? (d.myPending === s.id ? `<span style="color:var(--muted);font-size:11px">заявка ⏳</span>` : `<button class="ck-cat-chip" data-req="${s.id}" style="padding:3px 9px;font-size:11px">Попроситься</button>`)
        : '';
      const cnt = s.id === my
        ? `<span style="font-size:11px">· ${s.members} · <span style="color:var(--gold-l)">состав ›</span></span>`
        : `<span style="color:var(--muted);font-size:11px">· ${s.members}</span>`;
      return `<div class="ck-row${s.id === my ? ' me' : ''}"${s.id === my ? ' data-sq-members="1" style="cursor:pointer"' : ''}><div class="r">${i < 3 ? ICON.medal(18) : i + 1}</div><div class="n">${s.name}${s.custom ? ' ⚔️' : ''} ${cnt}</div><div class="v">${COIN(13)} ${fmt(s.points)} ${act}</div></div>`;
    }).join('');
    const chips = SQUADS.map(s => `<button class="ck-cat-chip${s.id === my ? ' on' : ''}" data-squad="${s.id}">${s.name}</button>`).join('');
    // Моя своя стая (владелец): инвайт + заявки. Или кнопка «Создать стаю».
    let ownHtml = '';
    if (d.myOwn) {
      ownHtml = `<div class="ck-bank" id="ck-sq-own"><div class="ck-bank__hd">⚔️ Твоя стая «${d.myOwn.name}»</div><div class="ck-bank__sub">Код приглашения: <b style="letter-spacing:1px">${d.myOwn.inviteCode}</b>${d.myOwn.requests ? ` · заявок: <b>${d.myOwn.requests}</b>` : ''}</div><div class="ck-cats" style="margin-top:6px"><button class="ck-cat-chip" data-sq-invite="1">Пригласить друга</button>${d.myOwn.requests ? `<button class="ck-cat-chip" data-sq-reqs="1">Заявки (${d.myOwn.requests})</button>` : ''}</div><div id="ck-sq-reqlist"></div></div>`;
    } else {
      ownHtml = `<div class="ck-cats" style="margin:6px 0 2px"><button class="ck-cat-chip" data-sq-create="1">⚔️ Создать свою стаю · ${fmt(SQUAD_CREATE_COST)} ${COIN(12)}</button><button class="ck-cat-chip" data-sq-code="1">У меня есть код</button></div>`;
    }
    // Копилка стаи: прогресс к цели недели → ×1.25 к тапам всей команде
    let bankHtml = '';
    if (my && d.bank) {
      const b = d.bank;
      const pct = Math.min(100, Math.round(b.sum / b.target * 100));
      const myName = ((d.squads || []).find(s => s.id === my) || SQUADS.find(s => s.id === my) || {}).name || 'стаи';
      const presets = [1000, 5000, 25000].map(v => `<button class="ck-cat-chip" data-bank="${v}" ${(st && st.balance < v) ? 'disabled' : ''}>${fmt(v)}</button>`).join('');
      // Топ-3 вкладчиков недели — признание тем, кто вложился
      const donors = (b.topDonors && b.topDonors.length)
        ? `<div class="ck-bank__sub" style="margin-top:5px">Герои недели: ${b.topDonors.map((t, i) => `${['🥇', '🥈', '🥉'][i] || ''}${(t.name || 'Игрок').replace(/[<>]/g, '')} ${fmt(t.total)}`).join(' · ')}</div>` : '';
      bankHtml = b.reached
        ? `<div class="ck-bank"><div class="ck-bank__hd">🏆 Копилка «${myName}» полна!</div><div class="ck-bank__sub">Весь доход стаи ×${b.mult} до конца недели — тапы и бизнесы</div><div class="ck-bank__bar"><i style="width:100%"></i></div>${donors}</div>`
        : `<div class="ck-bank"><div class="ck-bank__hd">🏦 Копилка стаи · ${fmt(b.sum)} / ${fmt(b.target)}</div><div class="ck-bank__bar"><i style="width:${pct}%"></i></div><div class="ck-bank__sub">Наполните вместе до воскресенья — весь доход стаи ×${b.mult} (тапы и бизнесы)${b.myTotal ? ` · твой вклад ${fmt(b.myTotal)}` : ''}</div><div class="ck-cats" style="margin-top:6px">${presets}</div><div style="display:flex;gap:8px;margin-top:7px"><input class="ck-cipher-in" id="ck-bank-custom" inputmode="numeric" type="text" maxlength="12" placeholder="Своя сумма" aria-label="Своя сумма в копилку" style="flex:1;min-width:0"/><button class="ck-cat-chip" data-bank-custom="1">Внести</button></div>${donors}${b.myToday >= b.dayCap ? `<div class="ck-bank__sub">Дневной лимит вклада исчерпан — продолжишь ${untilNewDay()}</div>` : ''}</div>`;
    }
    return { html: `<div class="ck-sect">Команды</div><div style="color:var(--muted);font-size:12px;text-align:center;margin:0 0 6px">Монеты всех игроков команды складываются в общий счёт</div>${ownHtml}${bankHtml}${rows}<div style="color:var(--muted);font-size:12px;text-align:center;margin:6px 0 4px">${my ? 'Сменить команду:' : 'Или выбери открытую команду:'}</div><div class="ck-cats">${chips}</div>`, wire: () => {
      ov.querySelectorAll('[data-squad]').forEach(b => b.onclick = () => joinSquadAct(b.dataset.squad));
      ov.querySelectorAll('[data-sq-members]').forEach(b => b.onclick = () => openSquadMembers());
      ov.querySelectorAll('[data-bank]').forEach(b => b.onclick = () => donateBank(Number(b.dataset.bank)));
      const customBank = ov.querySelector('#ck-bank-custom');
      const customBankBtn = ov.querySelector('[data-bank-custom]');
      const donateCustom = () => {
        const raw = String(customBank && customBank.value || '').replace(/\s/g, '').replace(/,/g, '');
        const amount = Number(raw);
        if (!Number.isInteger(amount) || amount <= 0) { flashMsg('Введи целую сумму монет'); return; }
        donateBank(amount);
      };
      if (customBankBtn) customBankBtn.onclick = donateCustom;
      if (customBank) customBank.onkeydown = (e) => { if (e.key === 'Enter') donateCustom(); };
      ov.querySelectorAll('[data-req]').forEach(b => b.onclick = () => requestJoinAct(b.dataset.req));
      const c = ov.querySelector('[data-sq-create]'); if (c) c.onclick = createSquadAct;
      const k = ov.querySelector('[data-sq-code]'); if (k) k.onclick = joinByCodeAct;
      const inv = ov.querySelector('[data-sq-invite]'); if (inv) inv.onclick = () => inviteToSquad(d.myOwn);
      const rq = ov.querySelector('[data-sq-reqs]'); if (rq) rq.onclick = loadSquadRequests;
    } };
  }
  // ── Свои стаи: действия ──
  // prompt() в TG WebView заблокирован на части платформ → игровой попап #ck-pop
  function squadInputPopup(title, sub, placeholder, btnLabel, onSubmit) {
    const pop = ov && ov.querySelector('#ck-pop'); if (!pop) return;
    window.haptic && window.haptic('light');
    pop.innerHTML = `<h3>⚔️ ${title}</h3>
      <div style="color:var(--muted);font-size:12.5px;margin-bottom:8px">${sub}</div>
      <div style="display:flex;gap:8px"><input class="ck-cipher-in" id="ck-pop-sq-in" maxlength="20" placeholder="${placeholder}" autocomplete="off" spellcheck="false" enterkeyhint="done"/><button class="ck-card__buy" id="ck-pop-sq-go" style="justify-content:center">${btnLabel}</button></div>
      <button id="ck-pop-ok" style="background:rgba(255,255,255,.07);color:var(--ink);border-color:var(--line)">Закрыть</button>`;
    pop.classList.add('on');
    const inp = pop.querySelector('#ck-pop-sq-in');
    const submit = () => { const v = inp.value.trim(); if (!v) return; pop.classList.remove('on'); onSubmit(v); };
    pop.querySelector('#ck-pop-sq-go').onclick = submit;
    inp.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
    pop.querySelector('#ck-pop-ok').onclick = () => pop.classList.remove('on');
    setTimeout(() => { try { inp.focus(); } catch {} }, 60);
  }
  function createSquadAct() {
    if (st && st.balance < SQUAD_CREATE_COST) { flashMsg(`Нужно ${fmt(SQUAD_CREATE_COST)} монет`); return; }
    squadInputPopup('Своя стая', `Придумай название (3–20 символов) · создание спишет ${fmt(SQUAD_CREATE_COST)} ${COIN(12)}`, 'Название стаи', 'Создать', async (name) => {
      return withLock('squad-create', async () => {
        const actionSession = overlaySession;
        const body = JSON.stringify({ name });
        let d = await mutationApi('/api/clicker/squad-create', { method: 'POST', body }).catch(() => null);
        let lost = !d || d.error === 'internal';
        if (lost) d = await mutationApi('/api/clicker/squad-create', { method: 'POST', body }).catch(() => null);
        if (lost && (!d || d.error === 'already_owner')) {
          const [fresh, squads] = await Promise.all([stateApi('/api/clicker').catch(() => null), api('/api/clicker/squads').catch(() => null)]);
          const expected = String(name).trim().replace(/\s+/g, ' ').toLocaleLowerCase();
          const actual = String(squads && squads.myOwn && squads.myOwn.name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
          if (fresh && !fresh.error && squads && squads.myOwn && expected === actual) d = { ...fresh, inviteCode: squads.myOwn.inviteCode, recovered: true };
        }
        if (d && !d.error) {
          applyServerState(d);
          if (!overlaySessionActive(actionSession)) return;
          sfxReward(); window.haptic && window.haptic('success');
          if (!d.recovered) confettiBurst();
          flashMsg(`⚔️ Стая создана! Код: ${d.inviteCode}`); renderTop(); bumpBalance();
        } else if (overlaySessionActive(actionSession)) flashMsg(!d || d.error === 'internal' ? 'Нет связи' : d.error === 'bad_name' ? 'Название не подходит — 3–20 букв/цифр, без грубостей' : d.error === 'name_taken' ? 'Такое название уже занято' : d.error === 'no_coins' ? `Нужно ${fmt(SQUAD_CREATE_COST)} монет` : d.error === 'already_owner' ? 'У тебя уже есть своя стая' : 'Не получилось');
      });
    });
  }
  function joinByCodeAct() {
    squadInputPopup('Код приглашения', 'Введи код, который прислал владелец стаи', 'Код из 6 символов', 'Вступить', async (code) => {
      return withLock('squad-code', async () => {
        const actionSession = overlaySession;
        const body = JSON.stringify({ code });
        let d = await mutationApi('/api/clicker/squad-code', { method: 'POST', body }).catch(() => null);
        if (!d || d.error === 'internal') d = await mutationApi('/api/clicker/squad-code', { method: 'POST', body }).catch(() => null);
        if (d && !d.error) {
          applyServerState(d);
          if (!overlaySessionActive(actionSession)) return;
          sfxBuy(); window.haptic && window.haptic('success'); flashMsg(`⚔️ Ты в стае «${d.squadName}»!`); renderTop();
        } else if (overlaySessionActive(actionSession)) flashMsg(!d || d.error === 'internal' ? 'Нет связи' : d.error === 'owner_locked' ? 'Владелец не может покинуть свою стаю' : d.error === 'full' ? 'Стая заполнена' : 'Код не найден — проверь у владельца');
      });
    });
  }
  async function requestJoinAct(id) {
    return withLock('squad-request', async () => {
      const actionSession = overlaySession;
      const body = JSON.stringify({ id });
      let d = await api('/api/clicker/squad-request', { method: 'POST', body }).catch(() => null);
      if (!d || d.error === 'internal') d = await api('/api/clicker/squad-request', { method: 'POST', body }).catch(() => null);
      if (!overlaySessionActive(actionSession)) return;
      if (d && !d.error) { window.haptic && window.haptic('light'); flashMsg(d.pending ? 'Заявка отправлена — владелец рассмотрит' : 'Готово'); renderTop(); }
      else flashMsg(!d || d.error === 'internal' ? 'Нет связи' : d.error === 'owner_locked' ? 'Владелец не может покинуть свою стаю' : d.error === 'full' ? 'Стая заполнена' : d.error === 'already_in' ? 'Ты уже в этой стае' : 'Не получилось');
    });
  }
  function inviteToSquad(own) {
    if (!own) return;
    const link = `https://t.me/${BOT}?start=cksq_${own.inviteCode}`;
    const text = `⚔️ Вступай в мою стаю «${own.name}» в «Котик Комбат»! Тапаем вместе и делим бонусы.`;
    if (window.App && App.share) App.share(link, text);
    else void copyText(link + '\n' + text).then(ok => flashMsg(ok ? 'Ссылка скопирована' : link));
  }
  async function loadSquadRequests() {
    const actionSession = overlaySession;
    const box = ov.querySelector('#ck-sq-reqlist');
    if (!box) return;
    const d = await api('/api/clicker/squad-requests').catch(() => null);
    if (!overlaySessionActive(actionSession) || !box.isConnected || !ov.contains(box)) return;
    if (!d || !d.requests) { box.innerHTML = '<div class="ck-bank__sub">Не удалось загрузить</div>'; return; }
    if (!d.requests.length) { box.innerHTML = '<div class="ck-bank__sub">Заявок пока нет</div>'; return; }
    box.innerHTML = d.requests.map(r => `<div class="ck-row"><div class="n">${(r.name || 'Игрок').replace(/[<>]/g, '')} <span style="color:var(--muted);font-size:11px">· ${COIN(11)} ${fmt(r.totalEarned)}</span></div><div class="v"><button class="ck-cat-chip" data-acc="${r.chatId}" style="padding:3px 9px;font-size:11px">Принять</button><button class="ck-cat-chip" data-rej="${r.chatId}" style="padding:3px 9px;font-size:11px">✕</button></div></div>`).join('');
    box.querySelectorAll('[data-acc]').forEach(b => b.onclick = () => decideReq(Number(b.dataset.acc), true));
    box.querySelectorAll('[data-rej]').forEach(b => b.onclick = () => decideReq(Number(b.dataset.rej), false));
  }
  async function decideReq(chatId, accept) {
    return withLock('squad-decide:' + chatId, async () => {
      const actionSession = overlaySession;
      const body = JSON.stringify({ chatId, accept });
      let d = await api('/api/clicker/squad-decide', { method: 'POST', body }).catch(() => null);
      let recovered = false;
      if (!d || d.error === 'internal') {
        d = await api('/api/clicker/squad-decide', { method: 'POST', body }).catch(() => null);
        recovered = !!(d && d.error === 'no_request');
      }
      if (!overlaySessionActive(actionSession)) return;
      if ((d && !d.error) || recovered) {
        window.haptic && window.haptic(accept ? 'success' : 'light');
        flashMsg(recovered ? 'Заявка уже обработана — список обновлён' : accept ? 'Принят в стаю!' : 'Заявка отклонена');
        renderTop();
      } else flashMsg(!d || d.error === 'internal' ? 'Нет связи' : d.error === 'full' ? 'Стая заполнена' : d.error === 'applicant_blocked' ? 'Игрок временно заблокирован' : 'Не получилось');
    });
  }
  const bankPendingKey = () => accountStorageKey('ck_squad_bank_pending_v2');
  function bankPending(amount) {
    try {
      const saved = JSON.parse(localStorage.getItem(bankPendingKey()) || 'null');
      if (saved && Number.isSafeInteger(saved.amount) && saved.amount > 0 && /^[a-zA-Z0-9_-]{8,80}$/.test(saved.requestId || '')) return saved;
    } catch (_) {}
    const next = { amount, requestId: clientRequestId() };
    try { localStorage.setItem(bankPendingKey(), JSON.stringify(next)); } catch (_) {}
    return next;
  }
  function clearBankPending() { try { localStorage.removeItem(bankPendingKey()); } catch (_) {} }
  async function donateBank(amount) {
    return withLock('squad-bank', async () => {
      const actionSession = overlaySession;
      const pendingBank = bankPending(amount);
      const send = () => mutationApi('/api/clicker/squad-bank', { method: 'POST', body: JSON.stringify(pendingBank) }).catch(() => null);
      let d = await send();
      if (!d || d.error === 'internal') d = await send();
      // `internal` после COMMIT остаётся неоднозначным: сохраняем requestId и на
      // следующем тапе перечитываем тот же результат. Явный 4xx можно забыть.
      if (d && d.error !== 'internal') clearBankPending();
      if (d && !d.error) {
        applyServerState(d);
        if (!overlaySessionActive(actionSession)) return;
        sfxReward(); window.haptic && window.haptic('success');
        if (d.bank && d.bank.reached) { confettiBurst(); flashMsg(`🏆 Копилка полна! Весь доход стаи ×${d.bank.mult}`); }
        else flashMsg(`В копилку: +${fmt(d.donated)}`);
        renderTop(); bumpBalance();
      } else if (overlaySessionActive(actionSession)) {
        flashMsg(!d ? 'Нет связи' : d.error === 'day_cap' ? 'Дневной лимит вклада исчерпан' : d.error === 'bad_amount' ? 'Не хватает монет' : 'Не получилось');
      }
    });
  }
  async function joinSquadAct(id) {
    return withLock('squad-join', async () => {
      const actionSession = overlaySession;
      const body = JSON.stringify({ id });
      let d = await mutationApi('/api/clicker/squad', { method: 'POST', body }).catch(() => null);
      if (!d || d.error === 'internal') d = await mutationApi('/api/clicker/squad', { method: 'POST', body }).catch(() => null);
      if (d && !d.error) {
        applyServerState(d);
        if (!overlaySessionActive(actionSession)) return;
        sfxBuy(); window.haptic && window.haptic('medium'); renderTop();
      } else if (overlaySessionActive(actionSession)) flashMsg(!d || d.error === 'internal' ? 'Нет связи' : d.error === 'owner_locked' ? 'Владелец не может покинуть свою стаю' : 'Не получилось');
      });
  }

  // ── Рефералы + Задания ───────────────────────────────────────────────────────
  const linkOpened = {};
  // refLink: серверная платформо-зависимая ссылка (st.refLink), иначе фолбэк t.me
  function refLink() { if (st && st.refLink) return st.refLink; const code = st && st.refCode; return code ? `https://t.me/${BOT}?start=ckref_${code}` : `https://t.me/${BOT}/app`; }
  function openBotGame() {
    const link = `https://t.me/${BOT}/app`;
    if (window.App && App.openExternal) App.openExternal(link);
    else {
      const opened = window.open(link, '_blank');
      if (opened) opened.opener = null;
      else window.location.assign(link);
    }
  }
  function shareRef() {
    if (!authed()) { openBotGame(); return; }
    const link = refLink();
    const text = '🐱 Играю в «Котик Комбат» от кондитерской «Мария» — тапай котика и качай уровни! Заходи по ссылке, нам обоим дадут монеты 🪙';
    const full = text + ' ' + link;
    if (window.App && App.share) App.share(link, text);
    else if (navigator.share) navigator.share({ url: link, text }).catch(() => copyText(full).then(ok => flashMsg(ok ? 'Ссылка скопирована' : link)));
    else void copyText(full).then(ok => { if (ok) flashMsg('Ссылка скопирована'); else if (window.App && App.openExternal) App.openExternal(link); else flashMsg(link); });
  }
  // Карточка «Пригласи друзей». Вынесена, т.к. в PURE нужна и в Задании (скрыты),
  // и в Рейтинге (доступен) — id параметризован, чтобы избежать дубля #ck-invite
  // в DOM (оба контейнера ck-scr-tasks/ck-scr-top существуют одновременно).
  function refCard(idAttr) {
    if (!authed()) {
      return `<div class="ck-card" style="background:linear-gradient(90deg,rgba(238,191,82,.18),rgba(238,191,82,.05))">
        <div class="ck-card__ic">${ICON.users(26)}</div><div class="ck-card__b"><div class="ck-card__n">Приглашения — в Telegram</div>
        <div class="ck-card__s">Открой игру через бота: там появится личная ссылка, и бонусы будут засчитываться.</div></div>
        <button class="ck-card__buy" id="${idAttr || 'ck-invite'}">Открыть</button></div>`;
    }
    const refCount = (st && st.referrals) || 0;
    return `<div class="ck-card" style="background:linear-gradient(90deg,rgba(238,191,82,.18),rgba(238,191,82,.05))">
      <div class="ck-card__ic">${ICON.users(26)}</div><div class="ck-card__b"><div class="ck-card__n">Пригласи друзей</div>
      <div class="ck-card__s">Друзей: ${refCount} · +${fmt(REF_REFERRER)} ${COIN(13)} тебе и +${fmt(REF_INVITEE)} другу</div></div>
      <button class="ck-card__buy" id="${idAttr || 'ck-invite'}">Позвать</button></div>`;
  }
  // Надёжная регистрация реферала: ловим код из startParam → сохраняем; флаг
  // «выполнено» ставим ТОЛЬКО после успеха сервера → при сбое повтор на след. заходе.
  // Запускается и при открытии игры, и фоном при загрузке приложения (см. низ файла).
  function refStorageKeys() {
    let account = 'unknown';
    try {
      const u = window.App && App.user && App.user();
      if (u && Number.isFinite(Number(u.id))) account = String((App.platform || 'app')) + '_' + String(Math.floor(Number(u.id)));
    } catch (_) {}
    return { done: 'maria_ck_ref_done_v2_' + account, pending: 'ck_pending_ref_v2_' + account };
  }
  async function ensureRefRegistered() {
    try {
      if (!authed()) return;                                  // гость — реф невозможен, ждём авторизации
      const keys = refStorageKeys();
      if (localStorage.getItem(keys.done)) { try { localStorage.removeItem(keys.pending); } catch (_) {} return; }
      let code = '';
      const sp = (window.App && App.startParam && App.startParam()) || '';
      const m = /^ckref_(\d+)$/.exec(sp);
      if (m) { code = m[1]; try { localStorage.setItem(keys.pending, code); } catch (_) {} }
      if (!code) { try { code = localStorage.getItem(keys.pending) || ''; } catch (_) {} }
      if (!code) return;
      const d = await mutationApi('/api/clicker/ref', { method: 'POST', body: JSON.stringify({ code }) }).catch(() => null);
      if (d && !d.error) {                                    // успех → фиксируем, чистим pending
        applyServerState(d);
        try { localStorage.setItem(keys.done, '1'); localStorage.removeItem(keys.pending); } catch (_) {}
        if (d.refReward && ov && ov.classList.contains('on')) dailyPopupRaw(ICON.gift(20) + ' Бонус за приглашение', d.refReward);
      }                                                       // сбой → pending остаётся, повтор позже
    } catch (_) {}
  }
  // Реальные покупки у «Марии» → игровые монеты (за новые траты, троттлинг на сервере).
  async function maybePurchaseBonus() {
    try {
      if (!authed()) return;
      const actionSession = overlaySession;
      const d = await mutationApi('/api/clicker/purchase-sync', { method: 'POST', body: '{}' }).catch(() => null);
      if (d && !d.error) {
        if (d.balance != null) applyServerState(d);
        if (!overlaySessionActive(actionSession)) return;
        if (Array.isArray(d.pigeonDrops) && d.pigeonDrops.length) pendingDoveSummary = d.pigeonDrops;
        if (d.bonus > 0) { sfxReward(); window.haptic && window.haptic('success'); confettiBurst(); purchasePopup(d.bonus); }
        else if (pendingDoveSummary) { const s = pendingDoveSummary; pendingDoveSummary = null; doveDropsSummaryPopup(s); }
      }
    } catch (_) {}
  }
  function purchasePopup(amount) { const pop = ov.querySelector('#ck-pop'); pop.innerHTML = `<h3>${ICON.gift(20)} Спасибо за покупки!</h3><div class="v">+${fmt(amount)} ${COIN(26)}</div><div style="color:var(--muted);font-size:13px">Бонус за покупки в «Марии» — чем больше заказываешь, тем больше монет в игре 🎂</div><button id="ck-pop-ok">Класс!</button>`; pop.classList.add('on'); pop.querySelector('#ck-pop-ok').onclick = () => { pop.classList.remove('on'); advancePopupQueue(); }; }
  // Неподписанный localStorage нельзя безопасно переносить в серверную экономику.
  async function maybeMigrateGuest() {
    try {
      if (!authed()) return;
      if (loadNetFail) return;
      if (localStorage.getItem('ck_migrated')) return;
      localStorage.setItem('ck_migrated', '1');
    } catch (_) {}
  }
  function guestTaskList() {
    const s = guestDerive(); const done = (rawGet().tasksDone) || {};
    return TASKS.filter(t => t.type !== 'ref').map(t => {
      let claim = false;
      if (t.type === 'link') claim = !!linkOpened[t.id];
      else if (t.type === 'level') claim = s.level >= t.target;
      else if (t.type === 'balance') claim = s.totalEarned >= t.target;
      else if (t.type === 'streak') claim = s.dailyStreak >= t.target;
      return { id: t.id, name: t.name, icon: t.icon, reward: t.reward, type: t.type, link: t.link || null, done: !!done[t.id], claimable: !done[t.id] && claim };
    });
  }
  function guestClaimTask(id) {
    const t = TASKS.find(x => x.id === id) || ACHIEVEMENTS.find(x => x.id === id); if (!t) return 0;
    const ds = guestDerive(); const s = rawGet(); if (s.tasksDone && s.tasksDone[id]) return 0;
    if (!condMet(t, ds)) return 0;
    s.balance += t.reward; s.totalEarned += t.reward; s.tasksDone = s.tasksDone || {}; s.tasksDone[id] = 1; rawSave(s); return t.reward;
  }
  function guestAchList() {
    const ds = guestDerive(); const done = (rawGet().tasksDone) || {};
    return ACHIEVEMENTS.filter(a => a.type !== 'ref').map(a => ({ ...a, done: !!done[a.id], claimable: !done[a.id] && condMet(a, ds) }));
  }
  let tasksGen = 0; // токен поколения: два конкурирующих renderTasks не перетирают вкладку друг у друга
  async function renderTasks() {
    const gen = ++tasksGen;
    const list = ov.querySelector('#ck-taskslist');
    if (authed()) list.innerHTML = skelRows(6);
    const refBlock = refCard();
    let tasks, tasksFail = false, purchaseTasks = [], purchaseClaims = [], purchasePhoneVerified = true;
    if (authed()) {
      const d = await api('/api/clicker/tasks').catch(() => null);
      tasks = d && d.tasks;
      tasksFail = !d || !!d.error || !Array.isArray(tasks);
      const pd = await api('/api/clicker/purchase-tasks').catch(() => null);
      if (pd && Array.isArray(pd.tasks)) purchaseTasks = pd.tasks;
      if (pd && Array.isArray(pd.claims)) purchaseClaims = pd.claims;
      if (pd && typeof pd.phoneVerified === 'boolean') purchasePhoneVerified = pd.phoneVerified;
    }
    else tasks = guestTaskList();
    if (gen !== tasksGen) return;
    if (!tasks) tasks = [];
    const rows = tasks.map(t => {
      let btn;
      if (t.done) btn = `<button class="ck-card__buy" disabled>✓ Готово</button>`;
      else if (t.type === 'link' && !(linkOpened[t.id])) btn = `<button class="ck-card__buy" data-open="${t.id}" data-link="${t.link || ''}">Открыть</button>`;
      else if (t.claimable) btn = `<button class="ck-card__buy" data-claim="${t.id}">+${fmt(t.reward)} ${COIN(14)}</button>`;
      else btn = `<button class="ck-card__buy" disabled>+${fmt(t.reward)}</button>`;
      return `<div class="ck-card"><div class="ck-card__ic">${taskIcon(t.id)}</div><div class="ck-card__b"><div class="ck-card__n">${t.name}</div><div class="ck-card__s">Награда +${fmt(t.reward)} ${COIN(13)}</div></div>${btn}</div>`;
    }).join('');
    let achs;
    if (authed()) {
      const d = await api('/api/clicker/achievements').catch(() => null);
      achs = d && d.achievements;
      tasksFail = tasksFail || !d || !!d.error || !Array.isArray(achs);
    }
    else achs = guestAchList();
    if (gen !== tasksGen) return;
    if (!achs) achs = [];
    const achRows = achs.map(a => {
      const btn = a.done ? `<button class="ck-card__buy" disabled style="justify-content:center">✓ Получено</button>`
        : a.claimable ? `<button class="ck-card__buy" data-claim="${a.id}">+${fmt(a.reward)} ${COIN(14)}</button>`
          : `<button class="ck-card__buy" disabled>+${fmt(a.reward)}</button>`;
      return `<div class="ck-card"${a.done ? ' style="opacity:.6"' : ''}><div class="ck-card__ic">${achIcon(a.icon)}</div><div class="ck-card__b"><div class="ck-card__n">${a.name}</div><div class="ck-card__s">${achDesc(a)}</div></div>${btn}</div>`;
    }).join('');
      const purchasePhoneRow = !purchasePhoneVerified ? `<div class="ck-card"><div class="ck-card__ic">${ICON.phone ? ICON.phone(22) : ICON.wallet(22)}</div><div class="ck-card__b"><div class="ck-card__n">Подтверди номер телефона</div><div class="ck-card__s">Это нужно для наград за покупки в «Марии». Нажми кнопку — откроется безопасное подтверждение номера${window.App?.platform === 'vk' ? ' VK' : ' Telegram'}.</div></div><button class="ck-card__buy" id="ck-purchase-phone">Поделиться номером</button></div>` : '';
    const purchaseRows = purchaseTasks.map(t => {
      const claimed = t.status === 'confirmed';
      const period = t.endsAt ? `до ${new Date(t.endsAt).toLocaleDateString('ru-RU')}` : 'без срока';
      const reward = [Number(t.rewardCoins) > 0 ? `+${fmt(Number(t.rewardCoins))} ${COIN(13)}` : '', Number(t.loyaltyPoints) > 0 ? `+${fmt(Number(t.loyaltyPoints))} баллов` : ''].filter(Boolean).join(' · ');
      const phoneHint = !purchasePhoneVerified && !claimed ? `<br><span style="color:var(--gold-l);font-weight:800">📱 Нужен подтверждённый номер телефона</span>` : '';
      return `<div class="ck-card"${claimed ? ' style="opacity:.65"' : ''}><div class="ck-card__ic">${ICON.gift(22)}</div><div class="ck-card__b"><div class="ck-card__n">${t.title}</div><div class="ck-card__s">${t.description || `Купи нужный товар · ${period}`}<br>${reward || 'Награда уточняется'}${phoneHint}</div></div><button class="ck-card__buy" disabled>${claimed ? '✓ Засчитано' : 'Проверяем'}</button></div>`;
    }).join('');
    // «Награды за прогресс» (реальные промокоды/баллы) СКРЫТЫ — решение юзера 31.07:
    // в «Призах» только внутриигровое до согласования внешних наград с Машей.
    // Бэк (milestones/claim, GIFTS_ENABLED) жив — вернуть = флаг true.
    const SHOW_PROGRESS_REWARDS = false;
    const progRows = SHOW_PROGRESS_REWARDS ? await milestonesHtml() : '';
    if (gen !== tasksGen) return;
    const failCard = tasksFail ? `<div class="ck-card"><div class="ck-card__ic">${ICON.bolt(26)}</div><div class="ck-card__b"><div class="ck-card__n">Не всё загрузилось</div><div class="ck-card__s">Проверь связь</div></div><button class="ck-card__buy" id="ck-tasks-retry">Обновить</button></div>` : '';
    // Промокод убран из вкладки «Призы» по решению юзера (15.07). redeemCodeAct/эндпоинт живы —
    // при возврате секции достаточно вернуть promoCard в innerHTML ниже.
    const purchaseBlock = purchasePhoneRow || purchaseRows ? '<div class="ck-sect">🛍 Покупки в Марии</div>' + '<div class="ck-intro" style="font-size:12px">Для заказа на сайте или покупки в точке нужен подтверждённый номер телефона. Переход, корзина и отменённый заказ не засчитываются — награда появляется только после подтверждения оплаченной покупки.</div>' + purchasePhoneRow + purchaseRows : '';
    list.innerHTML = '<div class="ck-intro">Забирай бесплатное: награда дня, сундук удачи, комбо дня. Ниже — задания и достижения за монеты.</div>' + todayStatusHtml() + failCard + bonusBlock() + purchaseBlock + (progRows ? `<div class="ck-sect">${ICON.gift(13)} Награды за прогресс</div>` + progRows : '') + '<div class="ck-sect">Друзья</div>' + refBlock + '<div class="ck-sect">Задания</div>' + rows + '<div class="ck-sect">Достижения</div>' + achRows;
    const rtb = list.querySelector('#ck-tasks-retry'); if (rtb) rtb.onclick = () => renderTasks();
    const pp = list.querySelector('#ck-purchase-phone'); if (pp) pp.onclick = () => requestPhone();
    ov.querySelector('#ck-invite').onclick = shareRef;
    list.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { const id = b.dataset.open, link = b.dataset.link; if (link) { if (window.App && App.openExternal) App.openExternal(link); else window.open(link, '_blank'); } linkOpened[id] = true; setTimeout(renderTasks, 400); });
    list.querySelectorAll('[data-claim]').forEach(b => b.onclick = () => claimTask(b.dataset.claim));
    list.querySelectorAll('[data-ms]').forEach(b => b.onclick = () => { const g = b.dataset.ms; if (g === 'phone') requestPhone(); else claimMilestoneAct(g); });
    const cg = ov.querySelector('#ck-code-go'), ci = ov.querySelector('#ck-code-in');
    if (cg && ci) { cg.onclick = () => redeemCodeAct(ci.value); ci.onkeydown = (e) => { if (e.key === 'Enter') redeemCodeAct(ci.value); }; }
    wireBonus();
  }
  async function milestonesHtml() {
    let data = null, pv = false;
    if (authed()) { const d = await api('/api/clicker/milestones').catch(() => null); if (d && d.milestones) { data = d.milestones; pv = !!d.phoneVerified; } }
    if (!data) { const gs = authed() ? st : guestDerive(); data = MILESTONES.map(m => ({ id: m.id, title: m.title, kind: m.kind, points: m.points || 0, perkText: m.perkText || '', reached: condMet({ type: m.cond.type, target: m.cond.target }, gs), granted: false })); }
    return data.map(m => {
      const rewardLabel = m.kind === 'both' ? `${COIN(13)} +${fmt(m.points)} баллов + ${ICON.gift(13)} ${m.perkText}` : m.kind === 'perk' ? `${ICON.gift(13)} ${m.perkText}` : `${COIN(13)} +${fmt(m.points)} баллов на карту`;
      let btn;
      if (m.granted) btn = `<button class="ck-card__buy" disabled>✓ Получено</button>`;
      else if (!authed()) btn = `<button class="ck-card__buy" disabled>Войти</button>`;
      else if (!m.reached) btn = `<button class="ck-card__buy" disabled>${ICON.lock(14)} Рано</button>`;
      else if (pv) btn = `<button class="ck-card__buy" data-ms="${m.id}">Забрать</button>`;
      else btn = `<button class="ck-card__buy" data-ms="phone">Подтвердить номер</button>`;
      return `<div class="ck-card"${m.granted ? ' style="opacity:.55"' : ''}><div class="ck-card__ic">${m.kind === 'points' ? ICON.star(26) : ICON.gift(26)}</div><div class="ck-card__b"><div class="ck-card__n">${m.title}</div><div class="ck-card__s">${rewardLabel}</div></div>${btn}</div>`;
    }).join('');
  }
  async function claimMilestoneAct(id) {
    if (!authed()) { flashMsg('Войди через приложение «Мария»'); return; }
    return withLock('milestone', async () => {
      const actionSession = overlaySession;
      const body = JSON.stringify({ id });
      let d = await mutationApi('/api/clicker/milestone', { method: 'POST', body }).catch(() => null);
      if (!d || d.error === 'internal') d = await mutationApi('/api/clicker/milestone', { method: 'POST', body }).catch(() => null);
      if (!overlaySessionActive(actionSession)) return;
      if (d && !d.error) {
        if (!d.duplicate) { sfxLevel(); window.haptic && window.haptic('success'); confettiBurst(); }
        if (d.promoCode) promoPopup(d.perkTitle, d.promoCode, d.minOrder, d.duplicate ? 0 : d.points);
        else if (d.duplicate) flashMsg('Награда уже получена и сохранена', 'light');
        else giftPopup(d.points);
        renderTasks();
      } else flashMsg(!d || d.error === 'internal' ? 'Нет связи — попробуй ещё раз' : d.error === 'need_phone' ? 'Сначала подтверди телефон' : d.error === 'already' ? 'Награда уже получена' : d.error === 'not_ready' ? 'Веха ещё не достигнута' : 'Не получилось, попробуй позже');
    });
  }
  function promoPopup(title, code, minOrder, points) {
    const pop = ov.querySelector('#ck-pop');
    const ptsLine = points ? `<div style="font-size:13px;color:var(--gold-l);font-weight:700;margin:6px 0">${COIN(13)} +${fmt(points)} баллов на карту тоже начислено</div>` : '';
    pop.innerHTML = `<h3>${ICON.gift(20)} Подарок!</h3><div style="font-size:18px;font-weight:800;color:var(--ink);margin:4px 0">${title || 'Подарок «Мария»'}</div>${ptsLine}<div style="margin:8px 0;font-size:13px;color:var(--muted)">Применить в корзине или назвать менеджеру${minOrder ? ` (от ${fmt(minOrder)}₽)` : ''}:</div><div class="ck-morse" style="font-size:21px;letter-spacing:2px">${code}</div><div style="font-size:12px;color:var(--muted);margin-top:6px">Код действует 30 дней · сохранён в «Мои награды»</div><div style="display:flex;gap:8px;justify-content:center;margin:10px 0 2px"><button class="ck-card__buy" id="ck-pop-copy" style="justify-content:center">Скопировать</button></div><button id="ck-pop-ok">Закрыть</button>`;
    pop.classList.add('on'); const cp = pop.querySelector('#ck-pop-copy'); if (cp) cp.onclick = async () => { cp.textContent = await copyText(code) ? 'Скопировано' : 'Выдели код выше'; }; pop.querySelector('#ck-pop-ok').onclick = () => pop.classList.remove('on');
  }
  function giftPopup(points) { const pop = ov.querySelector('#ck-pop'); pop.innerHTML = `<h3>${ICON.gift(20)} Подарок на карту!</h3><div class="v">+${points} баллов</div><div style="color:var(--muted);font-size:13px">Баллы «Мария» зачислены на твою карту клуба — трать при заказе тортов 🎂</div><button id="ck-pop-ok">Класс!</button>`; pop.classList.add('on'); pop.querySelector('#ck-pop-ok').onclick = () => pop.classList.remove('on'); }
  async function requestPhone() {
    // VK: номер выдаётся самим VK Mini Apps, а не Telegram-ботом.
    // Важно не открывать t.me fallback — в VK он выглядит как «кнопка не работает».
    if (window.App?.platform === 'vk') {
      flashMsg('Запрашиваем номер в VK…', 'light');
      const r = await window.App.verifyPhoneVk?.();
      if (r?.ok) {
        window.haptic?.('success');
        flashMsg(r.bonusAwarded > 0 ? `Номер подтверждён · +${fmt(r.bonusAwarded)} баллов` : 'Номер подтверждён', 'light');
        await window.ckRefreshState?.();
        renderTasks();
      } else if (r?.error === 'denied') {
        flashMsg('Разрешение на номер не выдано. Можно повторить позже.', 'light');
      } else if (r?.error === 'not_vk') {
        flashMsg('Открой игру внутри VK, чтобы подтвердить номер', 'light');
      } else {
        flashMsg('Не удалось подтвердить номер. Попробуй ещё раз.', 'light');
      }
      return;
    }
    if (window.App?.requestContact?.((ok) => { if (ok) { flashMsg('Спасибо! Проверяем номер…', 'light'); setTimeout(renderTasks, 1500); } })) return;
    const link = `https://t.me/${BOT}?start=phone`;
    if (window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(link);
    } else if (window.Telegram?.WebApp?.openLink) {
      window.Telegram.WebApp.openLink(link);
    } else {
      window.open(link, '_blank', 'noopener');
    }
    flashMsg('Открыл бота «Мария» — нажми «Поделиться телефоном»', 'light');
  }
  async function redeemCodeAct(code) {
    if (!code || !code.trim()) return;
    if (!authed()) { flashMsg('Промокоды — при входе через «Марию»'); return; }
    return withLock('code', async () => {
      const actionSession = overlaySession;
      const body = JSON.stringify({ code });
      let d = await mutationApi('/api/clicker/code', { method: 'POST', body }).catch(() => null);
      let recovered = false;
      if (!d || d.error === 'internal') {
        d = await mutationApi('/api/clicker/code', { method: 'POST', body }).catch(() => null);
        recovered = !!(d && d.error === 'used');
      }
      if (d && !d.error && d.reward != null) applyServerState(d);
      if (recovered) await window.ckRefreshState();
      if (!overlaySessionActive(actionSession)) return;
      if (d && !d.error && d.reward != null) { sfxReward(); window.haptic && window.haptic('success'); confettiBurst(); dailyPopupRaw(ICON.gift(20) + ' Промокод принят!', d.reward); renderAll(); renderTasks(); bumpBalance(); }
      else if (recovered) { renderTasks(); flashMsg('Код применён — баланс обновлён', 'light'); }
      else flashMsg(!d || d.error === 'internal' ? 'Нет связи — попробуй ещё раз' : d.error === 'used' ? 'Код уже использован' : d.error === 'invalid' ? 'Неверный код' : 'Не получилось');
    });
  }
  function achDesc(a) { const m = { taps: `${fmt(a.target)} тапов`, balance: `Накопить ${fmt(a.target)}`, level: `Уровень ${a.target}`, cards: `Открыть ${a.target} ${plu(a.target, 'бизнес', 'бизнеса', 'бизнесов')}`, streak: `${a.target} ${plu(a.target, 'день', 'дня', 'дней')} подряд`, ref: `${a.target} ${plu(a.target, 'друг', 'друга', 'друзей')}` }; return m[a.type] || ''; }
  function bonusBlock() {
    const cmb = (st && st.combo) || { cards: [], hits: [], complete: false, claimed: false, reward: COMBO_REWARD };
    const slots = cmb.cards.map(id => `<div class="ck-cmb ${cmb.hits.includes(id) ? 'on' : ''}">${cardIcon(id)}<span>${cardName(id)}</span></div>`).join('');
    const comboBtn = cmb.claimed
      ? `<button class="ck-card__buy" disabled style="width:100%;justify-content:center">✓ Забрано сегодня</button>`
      : cmb.complete
        ? `<button class="ck-card__buy ck-claim-pulse" id="ck-combo-claim" style="width:100%;justify-content:center">Забрать +${fmt(cmb.reward)} ${COIN(14)}</button>`
        : `<button class="ck-card__buy" disabled style="width:100%;justify-content:center">Собрано ${cmb.hits.length}/3 — прокачай их в «Прокачке»</button>`;
    const comboCard = `<div class="ck-card ck-bonus">
      <div style="display:flex;align-items:center;gap:11px"><div class="ck-card__ic">${ICON.star(26)}</div><div class="ck-card__b"><div class="ck-card__n">Комбо дня</div><div class="ck-card__s">Прокачай эти 3 бизнеса сегодня; MAX уже засчитан · +${fmt(cmb.reward)} ${COIN(13)}</div></div></div>
      <div class="ck-combo3">${slots}</div>${comboBtn}</div>`;
    const chestAvail = !st || st.chestAvailable;
    const chestCard = `<div class="ck-card ck-bonus" style="background:linear-gradient(90deg,rgba(238,191,82,.16),rgba(238,191,82,.04))">
      <div style="display:flex;align-items:center;gap:11px"><div class="ck-card__ic">${ICON.chest(26)}</div><div class="ck-card__b"><div class="ck-card__n">Сундук удачи</div><div class="ck-card__s">${chestAvail ? 'Монеты, турбо или джекпот!' : 'Новый сундук ' + untilNewDay()}</div></div>
      ${chestAvail ? `<button class="ck-card__buy" id="ck-chest-open">Открыть</button>` : `<button class="ck-card__buy" disabled>✓ Открыт</button>`}</div></div>`;
    // Платный «Кейс удачи» (как кейсы CS2): платишь монетами → голубь/буст/джекпот, чем
    // реже голубь — тем ценнее. Экономика с домовым эджем (сервер src/lootbox.ts).
    const signedIn = authed();
    const canCase = signedIn && (!st || Number(st.balance) >= CASE_COST);
    const caseSub = signedIn
      ? '0,05% на 10 млн · до 10 прокрутов в сутки · голуби и ранние уровни бизнесов · защита после 5 проигрышей'
      : 'Кейсы и выпавшие голуби сохраняются после входа через Telegram.';
    const caseCard = `<div class="ck-card ck-bonus" style="background:linear-gradient(90deg,rgba(155,92,255,.20),rgba(155,92,255,.05));border-color:rgba(155,92,255,.4)">
      <div style="display:flex;align-items:center;gap:11px"><div class="ck-card__ic" style="background:rgba(155,92,255,.2)">${ICON.chest(26)}</div><div class="ck-card__b"><div class="ck-card__n">Кейс удачи</div><div class="ck-card__s">${caseSub}</div></div>
      <button class="ck-card__buy" id="ck-case-open"${signedIn && !canCase ? ' disabled' : ''}>${signedIn ? COIN(13) + ' ' + fmt(CASE_COST) : 'В Telegram'}</button></div></div>`;
    return '<div class="ck-sect">Бонусы дня</div>' + chestCard + caseCard + comboCard;
  }
  function wireBonus() {
    const cb = ov.querySelector('#ck-combo-claim'); if (cb) cb.onclick = claimCombo;
    const ch = ov.querySelector('#ck-chest-open'); if (ch) ch.onclick = openChestAct;
    const co = ov.querySelector('#ck-case-open'); if (co) co.onclick = openCaseAct;
    const go = ov.querySelector('#ck-cipher-go'), inp = ov.querySelector('#ck-cipher-in');
    if (go && inp) { go.onclick = () => claimCipher(inp.value); inp.onkeydown = (e) => { if (e.key === 'Enter') claimCipher(inp.value); }; }
  }
  async function claimTask(id) {
    return withLock('task', async () => {
      const actionSession = overlaySession;
      let reward = 0, netfail = false, recovered = false;
      if (authed()) {
        const body = JSON.stringify({ id });
        let d = await mutationApi('/api/clicker/task', { method: 'POST', body }).catch(() => null);
        if (!d || d.error === 'internal') {
          d = await mutationApi('/api/clicker/task', { method: 'POST', body }).catch(() => null);
          recovered = !!(d && d.error === 'already');
        }
        netfail = !d || d.error === 'internal';
        if (d && !d.error) { applyServerState(d); reward = d.reward; }
      }
      else { reward = guestClaimTask(id); if (reward) applyServerState(guestDerive()); }
      if (recovered) await window.ckRefreshState();
      if (!overlaySessionActive(actionSession)) return;
      if (reward) { sfxReward(); window.haptic && window.haptic('success'); dailyPopupRaw('✅ Задание выполнено', reward); renderAll(); renderTasks(); bumpBalance(); }
      else if (recovered) { renderTasks(); flashMsg('Награда уже зачислена — баланс обновлён', 'light'); }
      else flashMsg(netfail ? 'Нет связи — попробуй ещё раз' : 'Пока недоступно');
    });
  }
  // ── Дроп голубя: попап поверх #ck-pop, показывается ПОСЛЕ закрытия предыдущего
  // попапа (сундук/комбо/золотой бонус/игра/покупки) — один общий DOM-элемент,
  // два попапа разом не влезают. Очередь на случай будущих множественных дропов;
  // сейчас реально копится максимум 1 штука (combo/chest/bonus/game дают по одному),
  // кроме purchase-sync — там отдельный сводный попап (doveDropsSummaryPopup), не очередь.
  // Мини-мирror имя+редкость — src/pigeons.ts::PIGEON_BREEDS (полный список с сетами/
  // артом ведёт catdove.js; тут достаточно для попапа дропа).
  const DOVE_META = {
    sizar: { name: 'Сизарь', r: 'common' }, belobok: { name: 'Белобокий', r: 'common' }, ryaboy: { name: 'Рябой', r: 'common' }, chubaty: { name: 'Чубатый', r: 'common' },
    vanil: { name: 'Ванильный', r: 'rare' }, shoko: { name: 'Шоколадный', r: 'rare' }, karamel: { name: 'Карамельный', r: 'rare' }, yagodny: { name: 'Ягодный', r: 'rare' },
    pochtar: { name: 'Иркутский почтарь', r: 'epic' }, baikal: { name: 'Байкальский гонец', r: 'epic' }, kurier: { name: 'Ночной курьер', r: 'epic' }, vozhak: { name: 'Вожак стаи', r: 'epic' },
    svadebny: { name: 'Свадебный', r: 'epic' }, imeninny: { name: 'Именинный', r: 'epic' }, snezhny: { name: 'Снежный', r: 'epic' }, zolotoy: { name: 'Золотой голубь Василия', r: 'legendary' },
  };
  const DOVE_RCOLOR = { common: 'rgba(200,204,212,.7)', rare: '#d9a35f', epic: '#c1a3f0', legendary: 'var(--gold-l)' };
  let doveDropQueue = [], pendingDoveSummary = null;
  function queueDoveDrop(drop) { if (drop && drop.breed) doveDropQueue.push(drop); }
  function queueDoveDrops(drops) { if (Array.isArray(drops)) drops.forEach(queueDoveDrop); }
  // Вызывается из OK-обработчика всех попапов-«триггеров» (сундук/комбо/бонус/игра/
  // покупки) — после их закрытия показывает следующий дроп-попап, если он есть.
  function advancePopupQueue() {
    if (doveDropQueue.length) { setTimeout(showDovePopup, 260); return; }
    if (pendingDoveSummary) { const s = pendingDoveSummary; pendingDoveSummary = null; setTimeout(() => doveDropsSummaryPopup(s), 260); }
  }
  function showDovePopup() {
    const drop = doveDropQueue.shift();
    if (!drop || !ov) { advancePopupQueue(); return; }
    const meta = DOVE_META[drop.breed] || { name: drop.breed, r: 'common' };
    const pop = ov.querySelector('#ck-pop'); if (!pop) return;
    pop.innerHTML = `<h3>${ICON.dove(20)} Прилетел голубь!</h3>
      <div style="width:78px;height:78px;margin:8px auto;border-radius:16px;border:2px solid ${DOVE_RCOLOR[meta.r]};display:flex;align-items:center;justify-content:center;overflow:hidden;background:rgba(238,191,82,.08);box-shadow:${meta.r === 'legendary' ? '0 0 12px rgba(238,191,82,.35)' : 'none'}">
        <img src="/img/pigeons/${drop.breed}.webp?v=2" alt="" style="width:82%;height:82%;object-fit:contain" onerror="this.style.display='none'">
      </div>
      <div class="v" style="font-size:19px">${meta.name}</div>
      <div style="color:var(--muted);font-size:13px">${drop.isNew ? 'Новый в альбоме!' : 'Дубликат — усиливает коллекцию'}</div>
      <button id="ck-pop-ok">Класс!</button>`;
    pop.classList.add('on');
    pop.querySelector('#ck-pop-ok').onclick = () => { pop.classList.remove('on'); advancePopupQueue(); };
  }
  // Сводный попап для purchase-sync (может дать сразу несколько голубей за год покупок).
  function doveDropsSummaryPopup(drops) {
    if (!drops || !drops.length || !ov) return;
    const pop = ov.querySelector('#ck-pop'); if (!pop) return;
    const rows = drops.map((d) => {
      const meta = DOVE_META[d.breed] || { name: d.breed, r: 'common' };
      return `<div style="display:flex;align-items:center;gap:8px;padding:4px 2px;text-align:left"><span style="width:8px;height:8px;border-radius:50%;background:${DOVE_RCOLOR[meta.r]};flex:none"></span><span style="flex:1;font-size:13px;color:var(--cream)">${meta.name}</span><span style="font-size:11px;color:var(--muted);flex:none">${d.isNew ? 'новый!' : 'дубликат'}</span></div>`;
    }).join('');
    pop.innerHTML = `<h3>${ICON.dove(20)} Прилетели голуби!</h3><div style="max-height:200px;overflow-y:auto;margin:8px 0">${rows}</div><button id="ck-pop-ok">Класс!</button>`;
    pop.classList.add('on');
    pop.querySelector('#ck-pop-ok').onclick = () => { pop.classList.remove('on'); advancePopupQueue(); };
  }
  function dailyPopupRaw(title, amount) { const pop = ov.querySelector('#ck-pop'); pop.innerHTML = `<h3>${title}</h3><div class="v">+${fmt(amount)} ${COIN(26)}</div><button id="ck-pop-ok">Класс!</button>`; pop.classList.add('on'); pop.querySelector('#ck-pop-ok').onclick = () => { pop.classList.remove('on'); advancePopupQueue(); }; }

  function dailyCalHtml() {
    const streak = Math.max(0, Number(st && st.dailyStreak) || 0), avail = !st || st.dailyAvailable;
    const currentDay = Math.max(1, avail ? streak + 1 : streak);
    let h = '<div class="ck-cal">';
    for (let offset = 0; offset < 7; offset++) {
      const day = currentDay + offset;
      const done = !avail && offset === 0;
      const today = avail && offset === 0;
      h += `<div class="ck-cal-day ${done ? 'done' : ''} ${today ? 'today' : ''}"><div class="d">${done ? '✓' : day}</div><div class="a">${fmt(dailyReward(day))}</div></div>`;
    }
    return h + '</div>';
  }
  function dailyBtn() { if (st && st.dailyAvailable) claimDaily(); else openDailyView(); }
  function openDailyView() { const pop = ov.querySelector('#ck-pop'); pop.innerHTML = `<h3>${ICON.gift(20)} Награда дня</h3>${dailyCalHtml()}<div style="color:var(--muted);font-size:13px">Заходи каждый день — приз растёт. Пропустишь — стрик сгорит!</div><button id="ck-pop-ok">Закрыть</button>`; pop.classList.add('on'); pop.querySelector('#ck-pop-ok').onclick = () => pop.classList.remove('on'); }
  function dailyPopup(amount, streak) { const pop = ov.querySelector('#ck-pop'); pop.innerHTML = `<h3>${ICON.gift(20)} День ${streak} — награда!</h3><div class="v">+${fmt(amount)} ${COIN(26)}</div>${dailyCalHtml()}<div style="color:var(--muted);font-size:13px">Заходи каждый день — приз растёт!</div><button id="ck-pop-ok">Ура!</button>`; pop.classList.add('on'); pop.querySelector('#ck-pop-ok').onclick = () => pop.classList.remove('on'); }
  function passivePopup(amount) { if (!amount || amount <= 0) return; const pop = ov.querySelector('#ck-pop'); pop.innerHTML = `<h3>Пока тебя не было</h3><div class="v">+${fmt(amount)} ${COIN(26)}</div><div style="color:var(--muted);font-size:13px">Котик работал за тебя! Офлайн-доход копится максимум 3 часа.</div><button id="ck-pop-ok">Забрать</button>`; pop.classList.add('on'); pop.querySelector('#ck-pop-ok').onclick = () => pop.classList.remove('on'); }

  function loop(ts) {
    if (!ov || !ov.classList.contains('on') || document.hidden) return;
    const dtFull = lastTs ? (ts - lastTs) / 1000 : 0; lastTs = ts;
    renderAcc += dtFull;
    if (renderAcc < LOOP_FRAME_BUDGET) { raf = requestAnimationFrame(loop); return; } // кап 30fps: тап-хендлер вне цикла, тут только пассивный доход/комбо-декей/рендер
    const dt = renderAcc; renderAcc = 0;
    if (st) {
      // Открытая всю ночь игра тоже должна разблокировать новый сундук/игры/стрик.
      // При неудаче сети повторяем раз в 15 секунд, а не оставляем вчерашний UI.
      const wallNow = Date.now();
      if (wallNow >= dayCheckAt) {
        dayCheckAt = wallNow + 1000;
        const today = irkToday();
        if (today !== uiDay && wallNow >= dayRetryAt) {
          dayRetryAt = wallNow + 15000;
          void refreshAfterResume().then(ok => { if (ok) uiDay = today; });
        }
      }
      if (st.energy < st.energyMax) st.energy = Math.min(st.energyMax, st.energy + REGEN * dt);
      if (st.profitPerHour > 0) { const inc = st.profitPerHour / 3600 * dt * passiveIncomeMult(); st.balance += inc; st.totalEarned += inc; }
      if (combo && performance.now() - comboT > 700) { combo = 0; ov.querySelector('#ck-combo').classList.remove('show'); }
      syncT += dt; if (syncT > 1.6) { syncT = 0; if (authed()) flush(); else st = guestDerive(); }
      if (tab === 'cat') renderAll();
    }
    raf = requestAnimationFrame(loop);
  }

  // ── Повкладочное обучение (спека 2026-07-31-guided-tour, v2 по фидбеку юзера):
  // у КАЖДОЙ вкладки свой мини-тур, запускается при первом входе новичка туда.
  // Спотлайт-дырка + пузырь Василия; клики проходят сквозь затемнение (мягкий тур).
  // Прогресс: ck_tour3_<kind>. Обновлённая версия один раз показывается всем игрокам.
  // поверх пет-оверлея (z 9999) → тур-элемент в document.body с z выше.
  let tourActive = false, tourKind = null, tourStep = 0, tourTapCount = 0, tourEl = null;
  const tourSeen = (k) => { try { return localStorage.getItem('ck_tour3_' + k) === 'done'; } catch (e) { return true; } };
  const tourMark = (k) => { try { localStorage.setItem('ck_tour3_' + k, 'done'); } catch (e) {} };
  const TOURS = {
    cat: [
      { text: 'Мур! Я Василий — будущий император выпечки. Это мой главный зал, покажу что тут к чему', anchor: '#ck-catwrap', pos: 'top' },
      { text: 'Тапай по мне — каждый тап приносит монету. Ну-ка, пять тапов!', anchor: '#ck-catwrap', pos: 'top', wait: 'taps' },
      { text: 'Кстати: каждый 40-й тап — «Сладкий», сразу ×8 монет. Лови золотые вспышки!', anchor: '#ck-catwrap', pos: 'top' },
      { text: 'Энергия: тап стоит 2 единицы, а 1 единица возвращается за 4 секунды. Кончилась — используй бесплатный буст или загляни в другие вкладки', anchor: '.ck-energy', pos: 'top' },
      { text: 'Бусты: Турбо ×5 и мгновенная энергия — бесплатные, по кулдауну. Используй их, когда хочешь быстро добрать монеты до покупки', anchor: '.ck-boosts', pos: 'top' },
      { text: 'Твои монеты и доход в час. Монеты тратим на бизнесы, тюнинг голубей и ставки', anchor: '.ck-bal', pos: 'bottom' },
      { text: 'Полоска карьеры: все заработанные монеты двигают меня по 19 уровням — от стажёра до Императора выпечки', anchor: '.ck-progwrap', pos: 'bottom' },
      { text: '«Награда дня»: заходи каждый день — стрик растёт, награды тоже', anchor: '#ck-daily', anchorFn: function () { return ov.querySelector('#ck-daily:not([style*="none"])') || ov.querySelector('.ck-progwrap'); }, pos: 'bottom' },
      { text: 'И чеклист «Первый день» — за первые шаги плачу монетами. А теперь загляни во вкладки внизу: в каждой расскажу, что там', anchor: '#ck-ftue', anchorFn: function () { return ov.querySelector('#ck-ftue:not([hidden])') || ov.querySelector('#ck-catwrap'); }, pos: 'bottom' },
    ],
    up: [
      { text: 'Это «Прокачка» — сердце дохода. Наверху бусты: Мультитап (+1 за тап) и Запас энергии', anchor: '#ck-uplist', anchorFn: function () { return ov.querySelector('#ck-uplist .ck-card'); }, pos: 'bottom' },
      { text: 'Бизнесы приносят монеты САМИ; после выхода они копятся до 3 часов. «Пекарня» за 300 — отличный первый шаг', anchor: '#ck-uplist', anchorFn: function () { const b = ov.querySelector('[data-id="bakery"]'); return (b && (b.closest('.ck-biz') || b.closest('.ck-card'))) || ov.querySelector('#ck-uplist'); }, pos: 'bottom' },
      { text: 'Четыре направления: Производство, Маркетинг, Персонал, Сеть. Заводи бизнесы — доход капает даже когда игра закрыта', anchor: '.ck-cats', pos: 'bottom' },
      { text: 'Чем выше уровень бизнеса, тем дороже следующий — но и доход растёт. Копи и вкладывай!', anchor: '#ck-uplist', anchorFn: function () { return ov.querySelector('#ck-uplist .ck-biz') || ov.querySelector('#ck-uplist'); }, pos: 'bottom' },
    ],
    tasks: [
      { text: '«Призы» — сюда каждый день! Сундук удачи: монеты, турбо или джекпот', anchor: '#ck-taskslist', anchorFn: function () { return ov.querySelectorAll('#ck-taskslist .ck-bonus')[0]; }, pos: 'bottom' },
      { text: '«Комбо дня»: прокачай 3 названных бизнеса сегодня — +12 000. Меняются каждый день', anchor: '#ck-taskslist', anchorFn: function () { return ov.querySelectorAll('#ck-taskslist .ck-bonus')[1]; }, pos: 'bottom' },
      { text: 'Здесь бывают задания от «Марии»: купи указанный продукт в точке или оформи заказ на сайте. Сначала подтверди номер телефона — он нужен для честной привязки покупки', anchor: '#ck-purchase-phone', anchorFn: function () { return ov.querySelector('#ck-purchase-phone') || ov.querySelector('#ck-taskslist'); }, pos: 'bottom' },
      { text: 'Важно: переход, корзина и отменённый заказ награды не дают. Монеты и баллы начисляются только после оплаченной покупки, которую подтвердит система. Бот пришлёт уведомление; обычно проверка занимает до 15 минут', anchor: '#ck-purchase-phone', anchorFn: function () { return ov.querySelector('#ck-purchase-phone') || ov.querySelector('#ck-taskslist'); }, pos: 'bottom' },
      { text: 'Ниже — задания и достижения: монеты за действия в игре. Заглядывай, тут копятся награды', anchor: '#ck-taskslist', pos: 'top' },
    ],
    top: [
      { text: '«Рейтинг»: топ недели по заработанным монетам, в воскресенье сезон закрывается и раздаются места', anchor: '#ck-myrank', anchorFn: function () { return ov.querySelector('#ck-myrank') || ov.querySelector('#ck-toplist'); }, pos: 'bottom' },
      { text: 'Команды: монеты всех игроков команды складываются — выбери свою и тащи её в топ', anchor: '#ck-toplist', anchorFn: function () { return ov.querySelector('#ck-toplist .ck-cats') || ov.querySelector('#ck-toplist'); }, pos: 'bottom' },
      { text: 'Пригласи друга — обоим монеты: тебе +30 000, ему +2 500 на старт', anchor: '#ck-toplist', pos: 'bottom' },
    ],
    hub: [
      { text: 'Это раздел мини-игр. Выбирай игру, выполняй её условия и получай дополнительные монеты', anchor: '#ck-hub-body', pos: 'bottom' },
      { text: 'У каждой игры свои правила и лимит награды. Перед стартом читай короткое описание на карточке', anchor: '#ck-hub-body', pos: 'top' },
    ],
    col: [
      { text: 'Альбом пород: собери все 16! Каждый голубь увеличивает доход в час, а звёзды и тюнинг усиливают его', anchor: '#ck-dove-col .cd-summary', pos: 'bottom' },
      { text: 'Породы собраны в сеты. Собери четвёрку — над ней появится кнопка «Забрать приз»', anchor: '#ck-dove-col .cd-sethead', pos: 'bottom' },
      { text: 'В «Заданиях» отправляй голубей в полёт. Чем лучше птица и тюнинг, тем выше шанс полной награды; даже за провал будет 20%', anchor: '#cd-nav-missions', anchorFn: function () { return ov.querySelector('#cd-nav-missions') || ov.querySelector('#ck-dove-col .cd-navrow'); }, pos: 'bottom' },
      { text: 'Кнопка «Гонки» открывает всё спортивное: гонку стаи, драг-заезды, тренировки и ставки монетами', anchor: '#cd-nav-race', anchorFn: function () { return ov.querySelector('#cd-nav-race') || ov.querySelector('#ck-dove-col .cd-navrow'); }, pos: 'bottom' },
      { text: 'Тапни свою породу: там звёзды, тюнинг и выбор любимых голубей для показа рядом с твоим именем в рейтинге', anchor: '#ck-dove-col .cd-card:not(.cd-locked)', anchorFn: function () { return ov.querySelector('#ck-dove-col .cd-card:not(.cd-locked)') || ov.querySelector('#ck-dove-col .cd-grid'); }, pos: 'bottom' },
      { text: 'В «Друзьях» нажми на человека: можно написать ему в Telegram или вызвать на дуэль со своей ставкой', anchor: '#cd-nav-friends', pos: 'bottom' },
    ],
  };
  const TAB_TOURS = { cat: 'cat', up: 'up', dove: 'col', tasks: 'tasks', top: 'top', hub: 'hub' };
  function tourRoot(s) { return (s && s.root === 'doc') ? document : ov; }
  function startTour(kind) {
    if (tourActive || !ov || !ov.classList.contains('on') || !TOURS[kind] || tourSeen(kind)) return;
    closeActiveCoach();
    tourActive = true; tourKind = kind; tourStep = 0; tourTapCount = 0;
    tourEl = document.createElement('div');
    tourEl.className = 'ck-tour';
    tourEl.innerHTML = `<div class="ck-tour__hole" id="ck-tour-hole"></div>
      <div class="ck-tour__bub" id="ck-tour-bub">
        <div class="ck-tour__head"><img src="/assets/images/cat-mascot-cut.png" alt=""><div class="ck-tour__t" id="ck-tour-t"></div></div>
        <div class="ck-tour__row"><button class="ck-tour__skip" id="ck-tour-skip" type="button">Пропустить</button><button class="ck-tour__next" id="ck-tour-next" type="button">Дальше</button></div>
      </div>`;
    document.body.appendChild(tourEl);
    tourEl.querySelector('#ck-tour-skip').onclick = () => endTour(true);
    tourEl.querySelector('#ck-tour-next').onclick = () => tourAdvance('btn');
    window.addEventListener('resize', tourReposition);
    tourShow();
  }
  // done=true — тур пройден/пропущен (больше не показывать); false — мягкий выход
  // (ушёл со вкладки/якорь пропал) — покажется заново при следующем входе.
  function endTour(done) {
    if (!tourActive) return;
    tourActive = false;
    // ушёл на последнем шаге — тур по сути пройден, не повторяем целиком
    if (!done && TOURS[tourKind] && tourStep >= TOURS[tourKind].length - 1) done = true;
    if (done) tourMark(tourKind);
    tourKind = null;
    window.removeEventListener('resize', tourReposition);
    if (tourEl) { tourEl.remove(); tourEl = null; }
    window.haptic && window.haptic('light');
  }
  function tourAnchor(s) {
    const root = tourRoot(s);
    const el = (s.anchorFn && s.anchorFn()) || (s.anchor && root.querySelector(s.anchor));
    if (el && el.offsetParent !== null) return el;
    if (tourKind === 'cat') return ov.querySelector('#ck-catwrap');
    return null; // якорь пропал (закрыли оверлей/вкладку) — мягко выходим
  }
  function tourShow() {
    const steps = TOURS[tourKind];
    const s = steps && steps[tourStep];
    if (!s) { endTour(true); return; }
    const a = tourAnchor(s);
    if (!a) { endTour(false); return; }
    tourEl.querySelector('#ck-tour-t').textContent = s.text;
    tourEl.querySelector('#ck-tour-next').style.display = s.wait ? 'none' : '';
    window.haptic && window.haptic('light');
    tourReposition();
  }
  function tourReposition() {
    if (!tourActive || !tourEl) return;
    const s = TOURS[tourKind] && TOURS[tourKind][tourStep]; if (!s) return;
    const a = tourAnchor(s); if (!a) { endTour(false); return; }
    const r = a.getBoundingClientRect();
    const hole = tourEl.querySelector('#ck-tour-hole');
    const pad = 8;
    hole.style.left = (r.left - pad) + 'px';
    hole.style.top = (r.top - pad) + 'px';
    hole.style.width = (r.width + pad * 2) + 'px';
    hole.style.height = (r.height + pad * 2) + 'px';
    const bub = tourEl.querySelector('#ck-tour-bub');
    const bw = Math.min(330, window.innerWidth - 24);
    bub.style.width = bw + 'px';
    const bh = bub.offsetHeight || 150;
    let top = s.pos === 'bottom' ? r.bottom + pad + 12 : r.top - pad - bh - 12;
    if (top < 10) top = r.bottom + pad + 12;
    if (top + bh > window.innerHeight - 10) top = Math.max(10, window.innerHeight - bh - 10);
    let left = r.left + r.width / 2 - bw / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - bw - 12));
    bub.style.top = top + 'px';
    bub.style.left = left + 'px';
  }
  function tourAdvance(kind) {
    if (!tourActive) return;
    const s = TOURS[tourKind][tourStep];
    if (s && s.wait && kind === 'btn') return;
    tourStep++;
    tourShow();
  }
  function tourOnTap() {
    if (!tourActive) return;
    const s = TOURS[tourKind] && TOURS[tourKind][tourStep];
    if (s && s.wait === 'taps' && ++tourTapCount >= 5) tourAdvance('event');
  }
  // смена вкладки: активный тур чужой вкладки мягко закрываем и, если у новой есть
  // свой непройденный тур — запускаем его (после отрисовки вкладки)
  function tourOnTab(t) {
    if (tourActive) {
      if (TAB_TOURS[t] === tourKind) { tourReposition(); return; }
      endTour(false);
    }
    maybeTabTour(t);
  }
  function maybeTabTour(t) {
    const kind = TAB_TOURS[t];
    if (!kind || kind === 'cat') return; // cat-тур стартует из welcome/open()
    if (tourSeen(kind)) return;
    setTimeout(() => { if (tab === t && !tourActive) startTour(kind); }, 500);
  }

  function showTutorial() {
    if (!ov || !ov.classList.contains('on') || ov.querySelector('.ck-tut')) return;
    const t = document.createElement('div'); t.className = 'ck-tut';
    t.innerHTML = `<div class="ck-tut__card">
      <div class="ck-tut__ic">${ICON.paw(36)}</div>
      <h3>Котик Комбат</h3>
      <div class="ck-tut__sub">Помоги котику дорасти от подвала до тронного зала — 19 уровней, коллекции и ежедневные призы.</div>
      <div class="ck-tut__step"><div class="si">${ICON.paw(20)}</div><div><div class="st">Тапай котика</div><div class="sd">Каждый тап — монеты, лови комбо ×N</div></div></div>
      <div class="ck-tut__step"><div class="si">${ICON.shop(20)}</div><div><div class="st">Заводи бизнесы</div><div class="sd">В «Прокачке» — офлайн-монеты копятся сами, максимум 3 часа</div></div></div>
      <div class="ck-tut__step"><div class="si">${ICON.gift(20)}</div><div><div class="st">Заходи каждый день</div><div class="sd">Награды дня, комбо и новые игровые цели</div></div></div>
      <button class="ck-tut__go" id="ck-tut-go">Поехали!</button>
      <button class="ck-tut__guide" id="ck-tut-guide" type="button">Полный гайд — как всё устроено</button></div>`;
    ov.appendChild(t);
    // markTutSeen: и localStorage (fast-path), и СЕРВЕР (st.onboarded) — чтобы обучение
    // не повторялось после потери localStorage в webview.
    const markTutSeen = () => { try { localStorage.setItem('ck_tut_v1', '1'); } catch (e) {} if (authed()) api('/api/clicker/onboarded', { method: 'POST', body: '{}' }).catch(() => {}); if (st) st.onboarded = true; };
    t.querySelector('#ck-tut-go').onclick = () => { markTutSeen(); t.remove(); window.haptic && window.haptic('light'); startTour('cat'); };
    t.querySelector('#ck-tut-guide').onclick = () => { markTutSeen(); t.remove(); window.haptic && window.haptic('light'); openGuide(); };
  }
  async function open() {
    // Повторный вызов во время загрузки раньше запускал второй набор запросов и мог
    // применить более старый ответ поверх свежего состояния.
    if (ov && ov.classList.contains('on')) return;
    if (!ov) build();
    const mySession = ++overlaySession;
    activeTapPointers.clear();
    ov.classList.add('on'); document.documentElement.classList.remove('ck-gamefirst'); window.scrollLock && window.scrollLock(); ac();
    const loaded = await load();
    if (!overlaySessionActive(mySession)) return;
    if (!loaded) { showLoadFailure(); return; }
    await maybeMigrateGuest();
    if (!overlaySessionActive(mySession)) return;
    await ensureRefRegistered();
    if (!overlaySessionActive(mySession)) return;
    await maybePurchaseBonus();
    if (!overlaySessionActive(mySession)) return;
    curLevel = playerLevel();
    loadFtue(); // не await — чип «Первый день» догрузится сам, старт не тормозим
    ov.querySelector('#ck-cat').src = A(playerLeague().cat || 'idle.png');
    applyCatSize(ov.querySelector('#ck-cat'));
    setTab('cat'); renderAll(); spawnSparks(); applySeason(); scheduleBonus(); loadDoveBadge();
    if (loadNetFail) flashMsg('Нет связи — серверный прогресс не загрузился, попробуй обновить игру');
    // «Уже видел обучение» теперь помнит СЕРВЕР (st.onboarded) — localStorage в webview
    // Telegram Mini App часто НЕ переживает закрытие, из-за чего обучение лезло КАЖДЫЙ
    // вход. Плюс любой игрок с прогрессом (тапы/монеты/бизнес) считается прошедшим — даже
    // если и сервер, и localStorage «забыли».
    const onboarded = !!(st && st.onboarded);
    const hasProgress = !!(st && (Number(st.taps || 0) > 0 || Number(st.totalEarned || 0) > 500 || (Array.isArray(st.cards) && st.cards.some(c => c.level > 0))));
    let _seenTut = onboarded || hasProgress;
    try { if (!_seenTut) _seenTut = !!localStorage.getItem('ck_tut_v1'); } catch (e) {}
    if (onboarded) { try { localStorage.setItem('ck_tut_v1', '1'); } catch (e) {} }
    // Девственный аккаунт (без прогресса и серверного флага) на устройстве со старыми
    // метками другого человека → переиграть онбординг для ЭТОГО аккаунта.
    if (!onboarded && !hasProgress && authed() && st && Number(st.taps || 0) === 0 && Number(st.cardsOwned || 0) === 0 && Number(st.totalEarned || 0) <= 500 && _seenTut) {
      try {
        localStorage.removeItem('ck_tut_v1');
        ['cat', 'up', 'dove', 'col', 'tasks', 'top', 'hub'].forEach(k => localStorage.removeItem('ck_tour3_' + k));
        Object.keys(localStorage).filter(k => k.indexOf('ck_coach_') === 0).forEach(k => localStorage.removeItem(k));
      } catch (e) {}
      coachSeenMem.clear();
      _seenTut = false;
    }
    // Бэкофилл серверного флага: кто явно уже прошёл (прогресс/localStorage), но сервер
    // ещё не помнит — записываем, чтобы будущая потеря localStorage не переигрывала обучение.
    if (!onboarded && _seenTut && authed()) { api('/api/clicker/onboarded', { method: 'POST', body: '{}' }).catch(() => {}); if (st) st.onboarded = true; }
    if (!_seenTut) showTutorial();
    else if (!tourSeen('cat')) {
      // welcome видел, но тур главной не проходил и игрок ещё свежий (пришёл через
      // «Полный гайд» или закрыл игру на середине) — доводим обучение
      setTimeout(() => startTour('cat'), 600);
    } else {
      coach('tap', COACH.tap.t, '#ck-cat', { icon: ICON[COACH.tap.icon](18) });
      if (st.passiveEarned > 0) passivePopup(st.passiveEarned);
      else maybeWelcomePromo();
    }
    lastTs = 0; syncT = 0; combo = 0; renderAcc = 0; cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
  }
  // ── Хаб «Игры»: рендер + квизы + «Собери торт» + «Ровный крем» ───────────────
  let quizState = null, memState = null, towerState = null;
  // Рисованные сладости (правило бренда «никаких эмодзи как арта»); совпадение по равенству строк.
  const MEM_ICONS = [
    `<svg width="34" height="34" viewBox="0 0 40 40"><path d="M12 18h16l-1.6 12.4a1.8 1.8 0 0 1-1.8 1.6H15.4a1.8 1.8 0 0 1-1.8-1.6z" fill="#D4FF6A" stroke="#8DBF20" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 18c-.4-3.6 3-5.6 5.2-5.6.8-3.2 8.8-3.2 9.6 0 2.2 0 5.6 2 5.2 5.6z" fill="#ff9ec4" stroke="#e0639a" stroke-width="1.6" stroke-linejoin="round"/><circle cx="20" cy="9.6" r="2.3" fill="#e8413f"/></svg>`,
    `<svg width="34" height="34" viewBox="0 0 40 40"><rect x="7" y="18.4" width="26" height="5.6" rx="2.8" fill="#fff0c4" stroke="#e6c98a" stroke-width="1.1"/><path d="M8 19c0-5 5-8.2 12-8.2s12 3.2 12 8.2q-12 3-24 0z" fill="#c9a6e0" stroke="#9a6fc4" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 23.4c0 5 5 8.2 12 8.2s12-3.2 12-8.2q-12-3-24 0z" fill="#c9a6e0" stroke="#9a6fc4" stroke-width="1.5" stroke-linejoin="round"/><g fill="#b88fd6"><circle cx="10.5" cy="18.8" r="0.9"/><circle cx="14.5" cy="18.4" r="0.9"/><circle cx="25.5" cy="18.4" r="0.9"/><circle cx="29.5" cy="18.8" r="0.9"/></g><path d="M11 14.8q9-3 18 0" fill="none" stroke="#ecdcf6" stroke-width="1.4" stroke-linecap="round" opacity=".85"/></svg>`,
    `<svg width="34" height="34" viewBox="0 0 40 40"><circle cx="20" cy="20" r="13" fill="#d6a25a" stroke="#a9762f" stroke-width="1.6"/><circle cx="15" cy="16" r="1.8" fill="#16210A"/><circle cx="24" cy="15" r="1.8" fill="#16210A"/><circle cx="26" cy="23" r="1.8" fill="#16210A"/><circle cx="17" cy="25" r="1.8" fill="#16210A"/><circle cx="21" cy="20" r="1.5" fill="#16210A"/></svg>`,
    `<svg width="34" height="34" viewBox="0 0 40 40"><circle cx="20" cy="21" r="12" fill="#D4FF6A" stroke="#8DBF20" stroke-width="1.6"/><path d="M20 9c6.6 0 12 5.4 12 12 0 2-.5 4-1.4 5.6C28 24 24 26 20 26s-8-2-10.6-.6A11.9 11.9 0 0 1 8 21C8 14.4 13.4 9 20 9z" fill="#7a4a2a" stroke="#5a3318" stroke-width="1.4" stroke-linejoin="round"/><circle cx="20" cy="21" r="4.2" fill="#120D1C"/><circle cx="16" cy="15" r="1" fill="#ff9ec4"/><circle cx="24" cy="14" r="1" fill="#7da33f"/><circle cx="27" cy="19" r="1" fill="#ffd24d"/><circle cx="13" cy="19" r="1" fill="#5aa8e8"/></svg>`,
    `<svg width="34" height="34" viewBox="0 0 40 40"><path d="M8 31 20 12l12 19z" fill="#f0c688" stroke="#c9954a" stroke-width="1.6" stroke-linejoin="round"/><path d="M18 24.6 L33 24.6 L33 21 L23 21 Z" fill="#F2FFCE" stroke="#e3c39a" stroke-width="1"/><path d="M7 31 L33 15 L33 11.5 L7 27.5 Z" fill="#ff9ec4" stroke="#e0639a" stroke-width="1.4" stroke-linejoin="round"/><circle cx="32.4" cy="11.9" r="2.6" fill="#e8413f" stroke="#b02a28" stroke-width="0.9"/></svg>`,
    `<svg width="34" height="34" viewBox="0 0 40 40"><g stroke="#c0392b" stroke-width="1.6" stroke-linejoin="round"><path d="M11 20 4 13v14z" fill="#ff8a7a"/><path d="M29 20 36 13v14z" fill="#ff8a7a"/><ellipse cx="20" cy="20" rx="9" ry="8" fill="#ff6b5e"/></g><path d="M16 16c2.4 2.4 5.6 2.4 8 0" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".7"/></svg>`,
  ];

  function renderGames() {
    const box = ov && ov.querySelector('#ck-gameslist'); if (!box) return;
    const saving = gameSubmissions.size > 0;
    const card = (id, icon, name, desc) => {
      const done = gameDone(id);
      return `<div class="ck-card ck-bonus"><div style="display:flex;align-items:center;gap:11px"><div class="ck-card__ic">${icon}</div><div class="ck-card__b"><div class="ck-card__n">${name}</div><div class="ck-card__s">${done ? 'Сыграно — снова ' + untilNewDay() : desc}</div></div>${done ? `<button class="ck-card__buy" disabled>✓ Сегодня</button>` : saving ? `<button class="ck-card__buy" disabled>Сохраняем…</button>` : `<button class="ck-card__buy" data-game="${id}">Играть</button>`}</div></div>`;
    };
    const rainAvail = !st || st.rainAvailable;
    const rainCard = `<div class="ck-card ck-bonus"><div style="display:flex;align-items:center;gap:11px"><div class="ck-card__ic">${ICON.rain(26)}</div><div class="ck-card__b"><div class="ck-card__n">Золотой дождь</div><div class="ck-card__s">${rainAvail ? 'Лови монеты 20 секунд → бонус' : 'Сыграно — снова ' + untilNewDay()}</div></div>${rainAvail ? saving ? `<button class="ck-card__buy" disabled>Сохраняем…</button>` : `<button class="ck-card__buy" id="ck-games-rain">Играть</button>` : `<button class="ck-card__buy" disabled>✓ Сегодня</button>`}</div></div>`;
    // «Слово дня» — часть хаба игр (переехало из «Призов», решение юзера 31.07)
    const cph = (st && st.cipher) || { claimed: false, reward: CIPHER_REWARD };
    const cipherCard = `<div class="ck-card ck-bonus"><div style="display:flex;align-items:center;gap:11px"><div class="ck-card__ic">${ICON.bolt(26)}</div><div class="ck-card__b"><div class="ck-card__n">Слово дня</div><div class="ck-card__s">${cph.claimed ? 'Разгадано — приходи завтра' : `Собери слово из букв · +${fmt(cph.reward)} ` + COIN(13)}</div></div>${cph.claimed ? `<button class="ck-card__buy" disabled>✓ Сегодня</button>` : `<button class="ck-card__buy" id="ck-games-cipher">Играть</button>`}</div></div>`;
    const gated = ['quiz_kids', 'quiz_riddle', 'count', 'memory', 'gems', 'tower'];
    const total = gated.length + 2, doneN = gated.filter(gameDone).length + (rainAvail ? 0 : 1) + (cph.claimed ? 1 : 0), remain = total - doneN;
    const head = `<div class="ck-games-hd">${remain > 0 ? `Сегодня доступно игр: <b>${remain}</b> из ${total} · награды ждут ${COIN(14)}` : 'Все игры на сегодня пройдены — новые ' + untilNewDay()}</div>`;
    box.innerHTML = head +
      '<div class="ck-sect">Учимся и играем · детям</div>' +
      card('quiz_kids', ICON.quiz(26), 'Котовикторина', '5 вопросов обо всём · +2500 ' + COIN(13)) +
      card('quiz_riddle', ICON.paw(26), 'Загадки', 'Отгадай 4 загадки · +2400 ' + COIN(13)) +
      card('count', ICON.cupcake(26), 'Счёт конфет', 'Сложи конфеты, малышам · +1200 ' + COIN(13)) +
      card('memory', ICON.cake(26), 'Собери торт', 'Найди пары на память · +3000 ' + COIN(13)) +
      '<div class="ck-sect">Казуальные · всем</div>' +
      card('gems', ICON.gem(26), 'Сладкий ряд', 'Match-3: собирай 3+ конфеты в ряд · +4500 ' + COIN(13)) +
      card('tower', ICON.cake(26), 'Башня тортов', 'Ставь коржи ровно, строй башню · +6000 ' + COIN(13)) +
      cipherCard +
      rainCard;
    box.querySelectorAll('.ck-card__buy[data-game]').forEach(b => b.onclick = () => startGame(b.dataset.game));
    const rb = box.querySelector('#ck-games-rain'); if (rb) rb.onclick = openRain;
    const cb = box.querySelector('#ck-games-cipher'); if (cb) cb.onclick = openCipherPopup;
  }
  // Попап «Слова дня» (та же анаграмма и claimCipher, что жили в «Призах»)
  function openCipherPopup() {
    const pop = ov && ov.querySelector('#ck-pop'); if (!pop) return;
    const cph = (st && st.cipher) || { anagram: '', morse: '', len: 0, reward: CIPHER_REWARD };
    if (cph.claimed) { flashMsg('Уже разгадано сегодня'); return; }
    window.haptic && window.haptic('light');
    const letters = (cph.anagram || '').split('').join(' ');
    pop.innerHTML = `<h3>${ICON.bolt(20)} Слово дня</h3>
      <div style="color:var(--muted);font-size:12.5px;margin-bottom:8px">Собери слово из букв · +${fmt(cph.reward)} ${COIN(13)}</div>
      <div class="ck-morse" style="margin-bottom:10px">${letters || cph.morse}</div>
      <div style="display:flex;gap:8px"><input class="ck-cipher-in" id="ck-pop-cipher-in" maxlength="14" placeholder="${cph.len} букв" autocomplete="off" spellcheck="false" enterkeyhint="done" autocapitalize="characters"/><button class="ck-card__buy" id="ck-pop-cipher-go" style="justify-content:center">Разгадать</button></div>
      <button id="ck-pop-ok" style="background:rgba(255,255,255,.07);color:var(--ink);border-color:var(--line)">Закрыть</button>`;
    pop.classList.add('on');
    const inp = pop.querySelector('#ck-pop-cipher-in');
    const submit = () => { pop.classList.remove('on'); claimCipher(inp.value); };
    pop.querySelector('#ck-pop-cipher-go').onclick = submit;
    inp.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
    pop.querySelector('#ck-pop-ok').onclick = () => pop.classList.remove('on');
  }
  const gameAttempts = {};
  async function beginGameAttempt(game) {
    if (!authed()) return true;
    const d = await api('/api/clicker/game-attempt', { method: 'POST', body: JSON.stringify({ game }) }).catch(() => null);
    if (!d || d.error || !d.token) { flashMsg(!d || d.error === 'internal' ? 'Нет связи — игру не запустили' : 'Игру сейчас не удалось запустить'); return false; }
    gameAttempts[game] = d.token;
    return true;
  }
  function gameAttempt(game) { return gameAttempts[game] || ''; }
  function clearGameAttempt(game) { delete gameAttempts[game]; }
  async function submitAttemptResult(path, game, score, fallbackReward) {
    const attempt = gameAttempt(game);
    if (!attempt) return null;
    const send = () => mutationApi(path, { method: 'POST', body: JSON.stringify({ game, score, attempt }) }).catch(() => null);
    let d = await send();
    // Один повтор тем же подписанным токеном: если первый запрос не дошёл, он
    // завершит claim; если ответ потерялся после commit, GET ниже восстановит UI.
    if (!d || d.error === 'internal') d = await send();
    if (d && !d.error) { clearGameAttempt(game); return d; }
    if (!d || d.error === 'internal' || d.error === 'already') {
      const fresh = await stateApi('/api/clicker').catch(() => null);
      const recorded = fresh && !fresh.error && (game === 'rain'
        ? fresh.rainAvailable === false
        : Array.isArray(fresh.gamesDone) && fresh.gamesDone.indexOf(game) >= 0);
      if (recorded) {
        clearGameAttempt(game);
        return { ...fresh, reward: fallbackReward, recovered: true };
      }
    }
    if (d && d.error !== 'too_fast' && d.error !== 'internal') clearGameAttempt(game);
    return d;
  }
  async function startGame(g) {
    return withLock('game-start:' + g, async () => {
      if (gameSubmissions.size) { flashMsg('Сохраняем предыдущий результат…'); return; }
      if (gameDone(g)) { flashMsg('Сыграно — снова ' + untilNewDay()); return; }
      const gameSession = overlaySession;
      const hub = ov && ov.querySelector('#ck-games');
      if (!(await beginGameAttempt(g))) return;
      // Пока сервер выдавал подписанную попытку, игрок мог закрыть хаб или всю игру.
      // Не открываем мини-игру за уже закрытым экраном и не переносим токен дальше.
      if (!overlaySessionActive(gameSession) || !hub || !hub.classList.contains('on')) {
        clearGameAttempt(g);
        return;
      }
      if (g === 'memory') openMemory(); else if (g === 'tower') openTower(); else if (g === 'gems') openGems(); else openQuiz(g);
    });
  }
  function openGamesHub() { if (!ov) return; window.haptic && window.haptic('light'); ov.querySelector('#ck-games').classList.add('on'); renderGames(); }
  function closeGamesHub() { const g = ov && ov.querySelector('#ck-games'); if (g) g.classList.remove('on'); if (tab === 'tasks') renderTasks(); /* обновить счётчик «доступно N из 7» на карточке */ }
  function resultPopup(title, amount, sub) { const pop = ov.querySelector('#ck-pop'); pop.innerHTML = `<h3>${title}</h3><div class="v">+${fmt(amount)} ${COIN(26)}</div><div style="color:var(--muted);font-size:13px">${sub || ''}</div><button id="ck-pop-ok">Класс!</button>`; pop.classList.add('on'); pop.querySelector('#ck-pop-ok').onclick = () => { pop.classList.remove('on'); advancePopupQueue(); }; }
  function gameResultFailed(gres) {
    if (gres && !gres.error) return false;
    sfxError();
    flashMsg(gres && gres.error ? 'Результат не засчитан — запусти игру заново' : 'Нет связи — результат не засчитан');
    renderAll(); renderGames();
    return true;
  }

  // — Квизы (Котовикторина / Загадки / Счёт конфет) —
  function openQuiz(deck) {
    if (gameDone(deck)) { flashMsg('Сыграно — снова ' + untilNewDay()); return; }
    const qs = quizQuestions(deck); if (!qs.length) return;
    let el = ov.querySelector('#ck-quiz'); if (!el) { el = document.createElement('div'); el.id = 'ck-quiz'; el.className = 'ck-quiz'; ov.appendChild(el); }
    quizState = { deck, qs, i: 0, correct: 0, locked: false }; el.classList.add('on'); renderQuizStep();
  }
  function renderQuizStep() {
    const el = ov.querySelector('#ck-quiz'), s = quizState; if (!s) return; const q = s.qs[s.i]; const meta = GAME_META[s.deck];
    const dots = s.qs.map((_, k) => `<i class="${k < s.i ? 'd' : ''} ${k === s.i ? 'c' : ''}"></i>`).join('');
    el.innerHTML = `<div class="ck-quiz__hd"><div class="t">${meta.icon()} ${meta.name}</div><button class="x" id="ck-quiz-x">×</button></div><div class="ck-quiz__dots">${dots}</div><div class="ck-quiz__q">${q.q}</div><div class="ck-quiz__opts">${q.opts.map(o => `<button class="ck-quiz__o">${o}</button>`).join('')}</div>`;
    el.querySelector('#ck-quiz-x').onclick = closeQuiz;
    el.querySelectorAll('.ck-quiz__o').forEach(b => b.onclick = () => answerQuiz(b, q));
  }
  function answerQuiz(btn, q) {
    const s = quizState; if (!s || s.locked) return; s.locked = true;
    const ok = btn.textContent === q.a; const el = ov.querySelector('#ck-quiz');
    el.querySelectorAll('.ck-quiz__o').forEach(b => { b.disabled = true; if (b.textContent === q.a) b.classList.add('ok'); else if (b === btn) b.classList.add('bad'); });
    if (ok) { s.correct++; note(880, 0.12, 'triangle', 0.09, 1320); window.haptic && window.haptic('light'); } else { sfxError(); window.haptic && window.haptic('warning'); }
    setTimeout(() => { if (quizState !== s) return; s.i++; s.locked = false; if (s.i >= s.qs.length) finishQuiz(); else renderQuizStep(); }, 760);
  }
  async function finishQuiz() {
    const s = quizState; if (!s) return; const deck = s.deck, correct = s.correct, total = s.qs.length, meta = GAME_META[deck]; closeQuiz();
    const gameSession = overlaySession;
    const gres = await submitGame(deck, correct);
    if (!overlaySessionActive(gameSession)) return;
    if (gameResultFailed(gres)) return;
    sfxReward(); window.haptic && window.haptic('success'); confettiBurst();
    queueDoveDrop(gres.pigeonDrop);
    resultPopup(`${meta.icon()} ${correct}/${total} верно!`, gres.reward || 0, correct === total ? 'Идеально! 🌟' : 'Молодец, заходи завтра!');
    renderAll(); renderGames(); bumpBalance();
  }
  function closeQuiz() { const el = ov.querySelector('#ck-quiz'); if (el) el.classList.remove('on'); quizState = null; }

  // — «Собери торт» (память/пары) —
  function openMemory() {
    if (gameDone('memory')) { flashMsg('Сыграно — снова ' + untilNewDay()); return; }
    let el = ov.querySelector('#ck-mem'); if (!el) { el = document.createElement('div'); el.id = 'ck-mem'; el.className = 'ck-mem'; ov.appendChild(el); }
    const cards = shuffleSeed([...MEM_ICONS, ...MEM_ICONS], dateSeed(irkToday(), 'mem')).map(v => ({ v, done: false }));
    memState = { cards, flipped: [], matched: 0, moves: 0, t0: performance.now(), lock: false }; el.classList.add('on'); renderMemory();
  }
  function renderMemory() {
    const el = ov.querySelector('#ck-mem'), s = memState; if (!s) return;
    el.innerHTML = `<div class="ck-quiz__hd"><div class="t">${ICON.cake(20)} Собери торт</div><button class="x" id="ck-mem-x">×</button></div><div class="ck-mem__sub">Найди одинаковые пары · ходов: <span id="ck-mem-moves">0</span></div><div class="ck-mem__grid">${s.cards.map((c, k) => `<button class="ck-mem__c" data-k="${k}"><span class="f">?</span><span class="b">${c.v}</span></button>`).join('')}</div>`;
    el.querySelector('#ck-mem-x').onclick = closeMemory;
    el.querySelectorAll('.ck-mem__c').forEach(b => b.onclick = () => flipMem(parseInt(b.dataset.k, 10)));
  }
  function memCell(k) { return ov.querySelector(`.ck-mem__c[data-k="${k}"]`); }
  function flipMem(k) {
    const s = memState; if (!s || s.lock) return; const c = s.cards[k]; if (c.done || s.flipped.indexOf(k) >= 0) return;
    memCell(k).classList.add('show'); s.flipped.push(k); note(740, 0.08, 'sine', 0.06);
    if (s.flipped.length === 2) {
      s.moves++; ov.querySelector('#ck-mem-moves').textContent = s.moves; s.lock = true;
      const a = s.flipped[0], b = s.flipped[1];
      if (s.cards[a].v === s.cards[b].v) { s.cards[a].done = s.cards[b].done = true; s.matched++; setTimeout(() => { if (memState !== s) return; const ca = memCell(a), cb = memCell(b); if (ca) ca.classList.add('match'); if (cb) cb.classList.add('match'); s.flipped = []; s.lock = false; note(1046, 0.12, 'triangle', 0.08, 1320); window.haptic && window.haptic('light'); if (s.matched === MEM_ICONS.length) finishMemory(); }, 340); }
      else { setTimeout(() => { if (memState !== s) return; const ca = memCell(a), cb = memCell(b); if (ca) ca.classList.remove('show'); if (cb) cb.classList.remove('show'); s.flipped = []; s.lock = false; sfxError(); }, 720); }
    }
  }
  async function finishMemory() {
    const s = memState; if (!s) return; const secs = (performance.now() - s.t0) / 1000; const moves = s.moves;
    const score = Math.max(20, Math.min(100, Math.round(100 - (moves - MEM_ICONS.length) * 5 - secs * 1.2))); closeMemory();
    const gameSession = overlaySession;
    const gres = await submitGame('memory', score);
    if (!overlaySessionActive(gameSession)) return;
    if (gameResultFailed(gres)) return;
    sfxReward(); window.haptic && window.haptic('success'); confettiBurst();
    queueDoveDrop(gres.pigeonDrop);
    resultPopup(`${ICON.cake(22)} Торт собран!`, gres.reward || 0, `За ${moves} ходов · ${Math.round(secs)}с`);
    renderAll(); renderGames(); bumpBalance();
  }
  function closeMemory() { const el = ov.querySelector('#ck-mem'); if (el) el.classList.remove('on'); memState = null; }

  // — «Башня тортов» (стопка коржей, на канвасе). Тап → поставить корж ровно —
  const TOWER_COLORS = ['#7a2d3a', '#c98a3c', '#e7c98f', '#9d5a3c', '#d98fb0', '#8c4a6b'];
  function towerRoundRect(ctx, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function towerLayer(ctx, x, y, w, h, color, glow) {
    ctx.save(); if (glow) { ctx.shadowColor = 'rgba(255,210,110,.55)'; ctx.shadowBlur = 16; }
    ctx.fillStyle = color; towerRoundRect(ctx, x, y, w, h, 6); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,.20)'; towerRoundRect(ctx, x, y, w, Math.min(7, h / 2), 6); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.16)'; ctx.fillRect(x, y + h - 4, w, 4);
    ctx.restore();
  }
  function openTower() {
    if (gameDone('tower')) { flashMsg('Сыграно — снова ' + untilNewDay()); return; }
    let el = ov.querySelector('#ck-tower'); if (!el) { el = document.createElement('div'); el.id = 'ck-tower'; el.className = 'ck-tower'; ov.appendChild(el); }
    el.innerHTML = `<div class="ck-quiz__hd"><div class="t">${ICON.cake(20)} Башня тортов</div><button class="x" id="ck-tower-x">×</button></div><div class="ck-mem__sub">Тапни по экрану, чтобы поставить корж ровно. Чем выше башня — тем больше монет!</div><div class="ck-tower__score" id="ck-tower-score">0</div><canvas id="ck-tower-cv"></canvas>`;
    el.classList.add('on');
    el.querySelector('#ck-tower-x').onclick = closeTower;
    startTower();
  }
  function startTower() {
    const el = ov.querySelector('#ck-tower'), cv = el.querySelector('#ck-tower-cv');
    const rect = cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(240, Math.floor(rect.width)), H = Math.max(320, Math.floor(rect.height));
    cv.width = W * dpr; cv.height = H * dpr; const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    const baseW = Math.floor(W * 0.5), LH = 28;
    const base = { x: (W - baseW) / 2, w: baseW, color: TOWER_COLORS[0] };
    towerState = { ctx, W, H, LH, stack: [base], score: 0, cam: 0, ended: false, raf: 0, last: performance.now(),
      cur: { x: 0, w: baseW, dir: 1, speed: 150, color: TOWER_COLORS[1] } };
    cv.onpointerdown = (e) => { e.preventDefault(); towerDrop(); };
    towerState.raf = requestAnimationFrame(towerLoop);
  }
  function towerLoop(ts) {
    const s = towerState; if (!s || s.ended) return;
    if (ts - s.last < MG_MIN_FRAME_MS) { s.raf = requestAnimationFrame(towerLoop); return; }
    const dt = Math.min(0.05, (ts - s.last) / 1000); s.last = ts; const c = s.cur;
    c.x += c.dir * c.speed * dt;
    if (c.x <= 0) { c.x = 0; c.dir = 1; } if (c.x + c.w >= s.W) { c.x = s.W - c.w; c.dir = -1; }
    drawTower(); s.raf = requestAnimationFrame(towerLoop);
  }
  function drawTower() {
    const s = towerState, ctx = s.ctx; ctx.clearRect(0, 0, s.W, s.H);
    const towerTop = s.stack.length * s.LH;
    s.cam += ((Math.max(0, towerTop - (s.H - 150))) - s.cam) * 0.16;
    for (let i = 0; i < s.stack.length; i++) { const L = s.stack[i]; towerLayer(ctx, L.x, s.H - 44 - i * s.LH + s.cam, L.w, s.LH, L.color); }
    const cy = s.H - 44 - s.stack.length * s.LH + s.cam; towerLayer(ctx, s.cur.x, cy, s.cur.w, s.LH, s.cur.color, true);
  }
  function towerDrop() {
    const s = towerState; if (!s || s.ended) return;
    const prev = s.stack[s.stack.length - 1], c = s.cur;
    const l = Math.max(c.x, prev.x), r = Math.min(c.x + c.w, prev.x + prev.w), over = r - l;
    if (over <= 4) { finishTower(); return; }
    let nx = l, nw = over;
    if (Math.abs(c.x - prev.x) < 7) { nx = prev.x; nw = prev.w; note(1318, 0.14, 'triangle', 0.1, 1760); window.haptic && window.haptic('medium'); }
    else { note(820, 0.1, 'triangle', 0.08, 1150); window.haptic && window.haptic('light'); }
    s.stack.push({ x: nx, w: nw, color: c.color });
    s.score++; const se = ov.querySelector('#ck-tower-score'); if (se) se.textContent = s.score;
    const ci = s.stack.length % TOWER_COLORS.length;
    s.cur = { x: c.dir > 0 ? 0 : s.W - nw, w: nw, dir: c.dir > 0 ? 1 : -1, speed: 150 + s.score * 8, color: TOWER_COLORS[ci] };
  }
  async function finishTower() {
    const s = towerState; if (!s || s.ended) return; s.ended = true; cancelAnimationFrame(s.raf);
    const score = s.score; closeTower();
    const gameSession = overlaySession;
    const gres = await submitGame('tower', score);
    if (!overlaySessionActive(gameSession)) return;
    if (gameResultFailed(gres)) return;
    sfxReward(); window.haptic && window.haptic('success'); confettiBurst();
    queueDoveDrop(gres.pigeonDrop);
    resultPopup(`${ICON.cake(22)} Башня из ${score} коржей!`, gres.reward || 0, score >= 20 ? 'Высоченная! 🎂' : 'Неплохо — завтра выше!');
    renderAll(); renderGames(); bumpBalance();
  }
  function closeTower() { if (towerState) cancelAnimationFrame(towerState.raf); const el = ov.querySelector('#ck-tower'); if (el) el.classList.remove('on'); towerState = null; }

  // — «Сладкий ряд» (match-3 на конфетах). Модель проверена юнит-тестом —
  const GEMS = ['🍬', '🍭', '🍫', '🍓', '🫐'], GN = 7, GT = 5, GEM_SEC = 50;
  let gemsState = null;
  function findMatchesG(g, n) {
    const m = new Set();
    for (let r = 0; r < n; r++) { let run = 1; for (let c = 1; c <= n; c++) { if (c < n && g[r * n + c] >= 0 && g[r * n + c] === g[r * n + c - 1]) run++; else { if (run >= 3) for (let k = 1; k <= run; k++) m.add(r * n + c - k); run = 1; } } }
    for (let c = 0; c < n; c++) { let run = 1; for (let r = 1; r <= n; r++) { if (r < n && g[r * n + c] >= 0 && g[r * n + c] === g[(r - 1) * n + c]) run++; else { if (run >= 3) for (let k = 1; k <= run; k++) m.add((r - k) * n + c); run = 1; } } }
    return m;
  }
  function applyGravityG(g, n, rng) { for (let c = 0; c < n; c++) { let w = n - 1; for (let r = n - 1; r >= 0; r--) { if (g[r * n + c] >= 0) { g[w * n + c] = g[r * n + c]; if (w !== r) g[r * n + c] = -1; w--; } } for (let r = w; r >= 0; r--) g[r * n + c] = Math.floor(rng() * GT); } }
  function makeGemBoard(n, rng) { const g = new Array(n * n); for (let i = 0; i < g.length; i++) g[i] = Math.floor(rng() * GT); let m = findMatchesG(g, n), guard = 0; while (m.size && guard++ < 800) { m.forEach(i => g[i] = Math.floor(rng() * GT)); m = findMatchesG(g, n); } return g; }
  function adjG(a, b, n) { const ra = (a / n) | 0, ca = a % n, rb = (b / n) | 0, cb = b % n; return Math.abs(ra - rb) + Math.abs(ca - cb) === 1; }
  function hasMoveG(g, n) { for (let a = 0; a < n * n; a++) { const cands = [a + 1, a + n]; for (const b of cands) { if (b < n * n && adjG(a, b, n)) { const t = g[a]; g[a] = g[b]; g[b] = t; const ok = findMatchesG(g, n).size > 0; const u = g[a]; g[a] = g[b]; g[b] = u; if (ok) return true; } } } return false; }
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  function openGems() {
    if (gameDone('gems')) { flashMsg('Сыграно — снова ' + untilNewDay()); return; }
    let el = ov.querySelector('#ck-gems'); if (!el) { el = document.createElement('div'); el.id = 'ck-gems'; el.className = 'ck-gems'; ov.appendChild(el); }
    gemsState = { g: makeGemBoard(GN, Math.random), n: GN, sel: -1, score: 0, lock: false, ended: false, tEnd: performance.now() + GEM_SEC * 1000, raf: 0 };
    el.classList.add('on'); renderGemsUI();
    gemsState.raf = setTimeout(gemsTimer, 0); // секундному таймеру не нужен rAF 60fps
  }
  function renderGemsUI() {
    const el = ov.querySelector('#ck-gems');
    el.innerHTML = `<div class="ck-quiz__hd"><div class="t">${ICON.gem(20)} Сладкий ряд</div><button class="x" id="ck-gems-x">×</button></div><div class="ck-mem__sub">Меняй соседние конфеты, собирай 3+ в ряд · <span id="ck-gems-t">${GEM_SEC}</span>с · очки <span id="ck-gems-s">0</span></div><div class="ck-gems__grid" id="ck-gems-grid" style="grid-template-columns:repeat(${GN},1fr)"></div>`;
    el.querySelector('#ck-gems-x').onclick = closeGems; renderGemsGrid();
  }
  function renderGemsGrid() {
    const grid = ov.querySelector('#ck-gems-grid'), s = gemsState; if (!grid || !s) return;
    grid.innerHTML = s.g.map((t, i) => `<button class="ck-gems__c ${i === s.sel ? 'sel' : ''}" data-i="${i}">${t < 0 ? '' : `<span class="cd cd${t}"></span>`}</button>`).join('');
    grid.querySelectorAll('.ck-gems__c').forEach(b => b.onclick = () => tapGem(parseInt(b.dataset.i, 10)));
  }
  async function tapGem(i) {
    const s = gemsState; if (!s || s.lock || s.ended) return;
    if (s.sel < 0 || (s.sel !== i && !adjG(s.sel, i, s.n))) { s.sel = i; renderGemsGrid(); note(660, 0.06, 'sine', 0.05); return; }
    if (i === s.sel) { s.sel = -1; renderGemsGrid(); return; }
    const a = s.sel, b = i; s.sel = -1; s.lock = true;
    const t = s.g[a]; s.g[a] = s.g[b]; s.g[b] = t; renderGemsGrid();
    if (findMatchesG(s.g, s.n).size > 0) { window.haptic && window.haptic('light'); await resolveGemsAnimated(); }
    else { await wait(170); const u = s.g[a]; s.g[a] = s.g[b]; s.g[b] = u; renderGemsGrid(); sfxError(); window.haptic && window.haptic('warning'); }
    s.lock = false;
  }
  async function resolveGemsAnimated() {
    const s = gemsState;
    for (let guard = 0; guard < 60; guard++) {
      const m = findMatchesG(s.g, s.n); if (!m.size) break;
      const grid = ov.querySelector('#ck-gems-grid');
      if (grid) m.forEach(idx => { const c = grid.querySelector(`.ck-gems__c[data-i="${idx}"]`); if (c) c.classList.add('clr'); });
      s.score += m.size; const ss = ov.querySelector('#ck-gems-s'); if (ss) ss.textContent = s.score;
      note(880, 0.1, 'triangle', 0.08, 1320);
      await wait(230);
      if (s.ended) return;
      m.forEach(idx => s.g[idx] = -1); applyGravityG(s.g, s.n, Math.random); renderGemsGrid();
      await wait(150);
    }
    if (!hasMoveG(s.g, s.n)) { s.g = makeGemBoard(s.n, Math.random); renderGemsGrid(); flashMsg('Перемешали!', 'light'); }
  }
  function gemsTimer() {
    const s = gemsState; if (!s || s.ended) return;
    const left = Math.max(0, (s.tEnd - performance.now()) / 1000); const tEl = ov.querySelector('#ck-gems-t'); if (tEl) tEl.textContent = Math.ceil(left);
    if (left <= 0) { finishGems(); return; }
    s.raf = setTimeout(gemsTimer, 250);
  }
  async function finishGems() {
    const s = gemsState; if (!s || s.ended) return; s.ended = true; clearTimeout(s.raf);
    const score = s.score; closeGems();
    const gameSession = overlaySession;
    const gres = await submitGame('gems', score);
    if (!overlaySessionActive(gameSession)) return;
    if (gameResultFailed(gres)) return;
    sfxReward(); window.haptic && window.haptic('success'); confettiBurst();
    queueDoveDrop(gres.pigeonDrop);
    resultPopup(`${ICON.gem(22)} Собрано ${score} конфет!`, gres.reward || 0, 'Сладко! Заходи завтра');
    renderAll(); renderGames(); bumpBalance();
  }
  function closeGems() { if (gemsState) { gemsState.ended = true; clearTimeout(gemsState.raf); } const el = ov.querySelector('#ck-gems'); if (el) el.classList.remove('on'); gemsState = null; }

  function close() {
    if (ov && ov.classList.contains('on')) overlaySession++;
    activeTapPointers.clear(); cancelAnimationFrame(raf); clearTimeout(bonusTimer); clearTimeout(resumeRetryTimer);
    closeActiveCoach(); if (tourActive) endTour(false);
    if (cancelCaseReel) cancelCaseReel();
    else { const cs = ov && ov.querySelector('#ck-case'); if (cs) cs.classList.remove('on'); }
    closeGuide();
    const pop = ov && ov.querySelector('#ck-pop'); if (pop) pop.classList.remove('on');
    // Уведомление о дропе уже отражено в серверном альбоме. Не переносим старую
    // очередь в следующую сессию, где она выглядела бы наградой за другое действие.
    doveDropQueue.length = 0; pendingDoveSummary = null;
    if (window.CatDove && typeof window.CatDove.closeAll === 'function') window.CatDove.closeAll();
    if (rainState) endRain(true); if (quizState) closeQuiz(); if (memState) closeMemory();
    if (towerState) closeTower(); if (gemsState) closeGems();
    const gh = ov && ov.querySelector('#ck-games'); if (gh) gh.classList.remove('on');
    void flushForPageExit(); if (ov) ov.classList.remove('on'); window.scrollUnlock && window.scrollUnlock();
  }
  window.catClickOpen = open; window.catClickClose = close; window.catClickBonusNow = () => { if (ov && ov.classList.contains('on')) showFlyingBonus(); }; // превью/тест золотого бонуса
  // Вкладка ушла в фон — останавливаем главный rAF-цикл (жалоба «тормозит», лишние тики впустую);
  // вернулись — перезапускаем, только если игра всё ещё открыта.
  let resumeRefresh = null;
  async function refreshAfterResume() {
    if (resumeRefresh) return resumeRefresh;
    resumeRefresh = (async () => {
      const session = overlaySession;
      const account = accountStorageKey('ck_state_context');
      let fresh = null;
      if (authed()) {
        if (!(await settlePendingTaps())) return false;
        fresh = await stateApi('/api/clicker').catch(() => null);
        if (account !== accountStorageKey('ck_state_context') || !overlaySessionActive(session)) return false;
        if (fresh && fresh.error === 'account_blocked') { loadFailureReason = 'account_blocked'; showLoadFailure(); return false; }
        if (fresh && !fresh.error) {
          if (loadedStateAccount && loadedStateAccount !== account) { appliedStateRevision = -1; st = null; }
          if (!applyServerState(fresh)) return false;
          loadNetFail = false;
          loadedStateAccount = account; cacheServerState(account, fresh);
        }
      } else {
        fresh = guestDerive();
        if (!overlaySessionActive(session)) return false;
        applyServerState(fresh); loadedStateAccount = account;
      }
      if (!fresh || fresh.error || !overlaySessionActive(session)) return false;
      uiDay = irkToday();
      renderAll();
      if (tab === 'up') renderUpgrades();
      else if (tab === 'tasks') renderTasks();
      else if (tab === 'top') renderTop();
      else if (tab === 'hub') renderHub();
      else if (tab === 'dove' && window.CatDove && typeof window.CatDove.refresh === 'function') void window.CatDove.refresh();
      const games = ov.querySelector('#ck-games'); if (games && games.classList.contains('on')) renderGames();
      return true;
    })().finally(() => { resumeRefresh = null; });
    return resumeRefresh;
  }
  let resumeRetryTimer = 0;
  function refreshAfterResumeWithRetry(attempt = 0) {
    clearTimeout(resumeRetryTimer);
    void refreshAfterResume().then(ok => {
      if (ok || attempt >= 2 || document.hidden || !ov || !ov.classList.contains('on')) return;
      resumeRetryTimer = setTimeout(() => refreshAfterResumeWithRetry(attempt + 1), [1200, 3000, 7000][attempt] || 7000);
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearTimeout(resumeRetryTimer); cancelAnimationFrame(raf); flushGuestTapSave(); void flushForPageExit(); }
    else if (ov && ov.classList.contains('on')) {
      lastTs = 0; renderAcc = 0; cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
      refreshAfterResumeWithRetry();
    }
  });
  // pagehide надёжнее beforeunload в Telegram WebView; keepalive позволяет короткому
  // запросу с последними тапами завершиться уже во время закрытия страницы.
  window.addEventListener('pagehide', () => { flushGuestTapSave(); void flushForPageExit(); });
  window.ckSetTab = setTab;
  // Мост для catdove.js (сегмент «Коллекция» вкладки dove): api — тот же fetch-хелпер с
  // initData-заголовками, flashMsg — тост об ошибке, updateDoveBadge — бейдж непрочитанной
  // почты на кнопке навбара (учитывая, что мьютить его дальше будет Task 10 — почта).
  window.ckApi = api; window.ckMutationApi = mutationApi; window.ckFlash = flashMsg; window.ckUpdateDoveBadge = updateDoveBadge; window.ckOpenBotGame = openBotGame;
  // Мосты для catdove: переключение вкладок (кнопка «Вступить в команду» из почты)
  // и системный шаринг (ссылка «кода дружбы»)
  window.ckSetTab = setTab;
  window.ckShare = async (txt) => {
    let link = 'https://t.me/' + BOT + '/app';
    try { if (window.App && App.appLink) link = await App.appLink(); } catch (_) {}
    if (window.App && App.share) App.share(link, txt);
    else if (navigator.share) navigator.share({ url: link, text: txt }).catch(() => {});
  };
  // Мост для catdrag.js (драг-заезд): читать текущий баланс/энергию для UI (дизейбл ставок
  // выше баланса и т.п.) и синхронизировать стейт кликера после серверного списания
  // энергии/ставки — иначе игрок видит устаревшие цифры, пока не откроет кликер заново.
  window.ckBalance = () => (st ? st.balance : 0);
  window.ckEnergy = () => (st ? st.energy : 0);
  window.ckSyncState = (patch) => {
    if (!st || !patch) return;
    // Соседние режимы меняют тот же clicker_state. Их revision не даёт позднему
    // ответу более старого запроса главного экрана откатить баланс/энергию назад.
    const revision = Number(patch.revision);
    if (Number.isFinite(revision)) {
      if (revision < appliedStateRevision) return;
      appliedStateRevision = revision;
      st.revision = revision;
    }
    // Ответ соседней механики не содержит локальные тапы, появившиеся уже после
    // старта её запроса. Сохраняем их optimistic-overlay до следующего flush.
    const account = accountStorageKey('ck_state_context');
    const pendingCurrent = !tapAccount || tapAccount === account;
    const retryCurrent = !tapRetryBatch || !tapRetryBatch.account || tapRetryBatch.account === account;
    const pendingGain = pendingCurrent ? Number(pendingTapGain || 0) : 0;
    const pendingEnergy = pendingCurrent ? Number(pendingTapEnergy || 0) : 0;
    const retryGain = retryCurrent ? Number(tapRetryBatch && tapRetryBatch.gain || 0) : 0;
    const retryEnergy = retryCurrent ? Number(tapRetryBatch && tapRetryBatch.energy || 0) : 0;
    if (typeof patch.balance === 'number') st.balance = patch.balance + (authed() ? pendingGain + retryGain : 0);
    if (typeof patch.energy === 'number') st.energy = Math.max(0, patch.energy - (authed() ? pendingEnergy + retryEnergy : 0));
    if (typeof patch.totalEarnedDelta === 'number') st.totalEarned = Math.max(0, Number(st.totalEarned || 0) + patch.totalEarnedDelta);
    if (typeof patch.profitDelta === 'number') st.profitPerHour = Math.max(0, Number(st.profitPerHour || 0) + patch.profitDelta);
    renderAll();
  };
  window.ckRefreshState = async () => {
    const account = accountStorageKey('ck_state_context');
    if (!(await settlePendingTaps())) return null;
    const fresh = await stateApi('/api/clicker').catch(() => null);
    if (account !== accountStorageKey('ck_state_context')) return null;
    if (fresh && !fresh.error) {
      if (loadedStateAccount && loadedStateAccount !== account) { appliedStateRevision = -1; st = null; }
      if (applyServerState(fresh)) {
        loadNetFail = false;
        loadedStateAccount = account; cacheServerState(account, fresh);
      }
      renderAll(); return fresh;
    }
    return null;
  };
  window.addEventListener('resize', () => { if (ov && ov.classList.contains('on') && st) applyCostume(playerLeague()); });
  // Реф регистрируем фоном уже при загрузке приложения (не дожидаясь открытия игры):
  // друг перешёл по ckref-ссылке → бонус начислится, даже если в игру он не зайдёт.
  function refBootstrap() { try { if (window.App && typeof App.ready === 'function') App.ready().then(() => ensureRefRegistered(), () => ensureRefRegistered()); else ensureRefRegistered(); } catch (_) { ensureRefRegistered(); } } // App.ready — функция, у неё нет .then (старый код всегда падал в else)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(refBootstrap, 1500)); else setTimeout(refBootstrap, 1500);
  // ── Диагностическая панель (startapp=debug ИЛИ 7 тапов по бейджу уровня) ─────
  // Ничего никуда не отправляет — только показывает на экране сведения о платформе/
  // хранилищах/сети, чтобы разобраться, почему у гостя не сохраняется прогресс.
  function ckDiagLine(k, v) { return '<div>' + k + ': ' + v + '</div>'; }
  function ckDiag() {
    if (document.getElementById('ck-diag')) return; // уже открыта
    const panel = document.createElement('div');
    panel.id = 'ck-diag';
    panel.style.cssText = 'position:fixed;top:8px;left:8px;right:8px;z-index:99999;max-width:480px;margin:0 auto;'
      + 'background:rgba(10,8,6,.94);color:#9fe870;font:11px/1.5 "JetBrains Mono",monospace;padding:10px 12px;'
      + 'border-radius:10px;max-height:80vh;overflow:auto;white-space:pre-wrap;word-break:break-all;box-shadow:0 8px 24px rgba(0,0,0,.5)';
    document.body.appendChild(panel);
    const body = document.createElement('div'); panel.appendChild(body);
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'закрыть';
    closeBtn.style.cssText = 'margin-top:8px;padding:5px 12px;border:none;border-radius:8px;background:#9fe870;color:#0B0814;font:700 11px inherit;cursor:pointer';
    closeBtn.onclick = () => panel.remove();
    panel.appendChild(closeBtn);

    const st_ = {
      platform: '…', initLen: '…', authed: '…', ss: '…', ls: '…',
      clicker: '…', ver: 'catclick v115', errors: '…',
    };
    function render() {
      body.innerHTML = ''
        + ckDiagLine('platform', st_.platform)
        + ckDiagLine('initData len', st_.initLen)
        + ckDiagLine('authed', st_.authed)
        + ckDiagLine('sessionStorage', st_.ss)
        + ckDiagLine('localStorage', st_.ls)
        + ckDiagLine('GET /api/clicker', st_.clicker)
        + ckDiagLine('ver', st_.ver)
        + ckDiagLine('errors', st_.errors);
    }
    st_.platform = (window.App && App.platform) || 'н/д';
    st_.initLen = String((window.App && App.initDataLength && App.initDataLength()) || 0);
    st_.authed = String(!!(window.App && App.isAuthed && App.isAuthed()));
    try { sessionStorage.setItem('ck_diag', '1'); sessionStorage.removeItem('ck_diag'); st_.ss = 'ok'; }
    catch (e) { st_.ss = 'FAIL ' + (e && e.message); }
    try { localStorage.setItem('ck_diag', '1'); localStorage.removeItem('ck_diag'); st_.ls = 'ok'; }
    catch (e) { st_.ls = 'FAIL ' + (e && e.message); }
    st_.errors = ckDiagErrors.length ? ckDiagErrors.join(' | ') : '—';
    render();

    const hdr = (window.App && App.authHeader) ? App.authHeader() : {};
    fetch('/api/clicker', { headers: hdr }).then(r => { st_.clicker = String(r.status); render(); }).catch(e => { st_.clicker = 'ERR ' + (e && e.message); render(); });
    // ещё раз обновим errors чуть позже — на случай, если что-то упало во время самой диагностики
    setTimeout(() => { st_.errors = ckDiagErrors.length ? ckDiagErrors.join(' | ') : '—'; render(); }, 500);
  }
  // 7 быстрых тапов по бейджу уровня (#ck-lvl) — фолбэк на случай, если диплинк не передал start_param.
  function ckDiagWireTapTrigger() {
    const el = ov && ov.querySelector('#ck-lvl'); if (!el) return;
    let n = 0, tm = null;
    el.addEventListener('click', () => {
      n++; clearTimeout(tm); tm = setTimeout(() => { n = 0; }, 3000);
      if (n >= 7) { n = 0; ckDiag(); }
    });
  }
  // Deep-link из пуша-возврата (?startapp=click) → сразу открываем игру.
  function clickAutoOpen() {
    try {
      const sp = (window.App && App.startParam && App.startParam()) || '';
      let qsp = ''; try { qsp = new URLSearchParams(location.search).get('startapp') || ''; } catch (_) {}
      const gf = document.documentElement.classList.contains('ck-gamefirst');
      const isDebug = sp === 'debug' || qsp === 'debug';
      if (sp === 'click' || sp === 'game' || gf || isDebug) {
        try {
          const p = window.catClickOpen && window.catClickOpen();
          if (isDebug) Promise.resolve(p).then(() => ckDiag(), () => ckDiag());
        } catch (_) { if (isDebug) { try { ckDiag(); } catch (_) {} } }
      }
    } catch (_) {}
  }
  function clickBootstrap() {
    try {
      if (window.App && typeof App.ready === 'function') {
        // VK bridge может зависнуть внутри web-контейнера. Игра не должна
        // ждать нативную инициализацию: открываемся быстро, auth догружается
        // параллельно, а API вернёт понятный результат при необходимости.
        const ready = Promise.resolve().then(() => App.ready());
        Promise.race([ready, new Promise((resolve) => setTimeout(resolve, 1500))])
          .then(clickAutoOpen, clickAutoOpen);
      } else clickAutoOpen();
    } catch (_) { clickAutoOpen(); }
  }
  // Гейм-first (сплэш уже на экране, магазин под ним): открываем игру сразу, без задержки-«моргания».
  const _ckGameFirst = document.documentElement.classList.contains('ck-gamefirst');
  const _ckDelay = _ckGameFirst ? 0 : 600;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(clickBootstrap, _ckDelay)); else setTimeout(clickBootstrap, _ckDelay);
})();

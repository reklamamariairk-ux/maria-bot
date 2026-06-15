/* ── «Котик Комбат» — кликер (Hamster Kombat-стиль), усиленная версия ──────────
 * Тап (комбо+монетопад, турбо ×5), энергия, апгрейды, бизнесы (пассив+офлайн),
 * бусты (🚀 турбо / ⚡ полная энергия, 6/день), ежедневная награда (стрик),
 * лидерборд. Сервер /api/clicker* для авторизованных, localStorage у гостей.
 * ───────────────────────────────────────────────────────────────────────────── */
(function () {
  const A = (s) => `/assets/images/cat/${s}?v=20`;  // v20: чистый вырез без светлого ободка
  const LS = 'maria_click_v2';
  const REGEN = 1.5, PASSIVE_CAP_H = 3, TURBO_MULT = 5, TURBO_SEC = 20, DAILY_BOOSTS = 6;
  // ⚠️ Зеркало CARDS/CARD_CATS из src/clicker.ts — менять синхронно (+ cardIcon по id).
  const CARD_CATS = [{ id: 'prod', name: 'Производство' }, { id: 'mkt', name: 'Маркетинг' }, { id: 'staff', name: 'Персонал' }, { id: 'net', name: 'Сеть' }];
  const SQUADS = [{ id: 'choco', name: 'Шоколадные' }, { id: 'vanilla', name: 'Ванильные' }, { id: 'caramel', name: 'Карамельные' }, { id: 'berry', name: 'Ягодные' }];
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
    // 19 уровней под арт Маши. ⚠️ Лестница продублирована в src/clicker.ts — менять синхронно.
    { level: 1,  name: 'Тощий котик',        need: 0,       cat: 'cat-stage1.png' },
    { level: 2,  name: 'Обычный котик',      need: 200,     cat: 'cat-stage2.png' },
    { level: 3,  name: 'Сытый котик',        need: 600,     cat: 'cat-stage3.png' },
    { level: 4,  name: 'Толстый котик',      need: 1500,    cat: 'cat-stage4.png' },
    { level: 5,  name: 'Котик на спорте',    need: 3500,    cat: 'cat-stage5.png' },
    { level: 6,  name: 'Подкачанный котик',  need: 7000,    cat: 'cat-stage6.png' },
    { level: 7,  name: 'Котик в тонусе',     need: 13000,   cat: 'cat-stage7.png' },
    { level: 8,  name: 'Котик-бодибилдер',   need: 24000,   cat: 'cat-stage8.png' },
    { level: 9,  name: 'Котик-силач',        need: 42000,   cat: 'cat-stage9.png' },
    { level: 10, name: 'Котик-рэпер',        need: 70000,   cat: 'cat-stage10.png' },
    { level: 11, name: 'Котик при деньгах',  need: 110000,  cat: 'cat-stage11.png' },
    { level: 12, name: 'Котик-делец',        need: 170000,  cat: 'cat-stage12.png' },
    { level: 13, name: 'Котик-бизнесмен',    need: 260000,  cat: 'cat-stage13.png' },
    { level: 14, name: 'Котик-босс',         need: 400000,  cat: 'cat-stage14.png' },
    { level: 15, name: 'Котик-магнат',       need: 600000,  cat: 'cat-stage15.png' },
    { level: 16, name: 'Котик-воротила',     need: 880000,  cat: 'cat-stage16.png' },
    { level: 17, name: 'Котик-олигарх',      need: 1250000, cat: 'cat-stage17.png' },
    { level: 18, name: 'Котик-дон',          need: 1750000, cat: 'cat-stage18.png' },
    { level: 19, name: 'Повелитель котов',   need: 2500000, cat: 'cat-stage19.png' },
  ];
  const REF_REFERRER = 5000, REF_INVITEE = 2500, BOT = 'mariatortik_bot';
  // Соцссылки «Марии» — зеркало SOCIAL в src/clicker.ts (менять синхронно). Пустая = задание скрыто.
  const SOCIAL = { review: 'https://yandex.ru/maps/?text=Мария кондитерская Иркутск', vk: '', tg: '' };
  const TASKS = [
    { id: 'site', name: 'Заглянуть на сайт «Мария»', icon: '🌐', reward: 1500, type: 'link', link: 'https://www.maria-irk.ru/' },
    { id: 'review', name: 'Оставить отзыв о «Марии»', icon: '⭐', reward: 5000, type: 'link', link: SOCIAL.review },
    { id: 'vk', name: 'Подписаться на ВК «Мария»', icon: '👍', reward: 4000, type: 'link', link: SOCIAL.vk },
    { id: 'tg', name: 'Подписаться на Telegram «Мария»', icon: '📣', reward: 4000, type: 'link', link: SOCIAL.tg },
    { id: 'invite1', name: 'Пригласить друга', icon: '👥', reward: 10000, type: 'ref', target: 1 },
    { id: 'level3', name: 'Дойти до 3 уровня', icon: '⭐', reward: 3000, type: 'level', target: 3 },
    { id: 'balance10', name: 'Накопить 10 000 монет', icon: '💰', reward: 2500, type: 'balance', target: 10000 },
    { id: 'streak3', name: 'Заходить 3 дня подряд', icon: '🔥', reward: 4000, type: 'streak', target: 3 },
  ].filter(t => t.type !== 'link' || t.link);
  const leagueFor = (t) => { let l = LEAGUES[0]; for (const x of LEAGUES) if (t >= x.need) l = x; return l; };
  const nextNeed = (t) => { const n = LEAGUES.find(x => x.need > t); return n ? n.need : null; };
  const fmt = (n) => Math.floor(n).toLocaleString('ru-RU');
  const irkToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const priceMultitap = (l) => Math.round(200 * Math.pow(2, l));
  const priceEnergy = (l) => Math.round(300 * Math.pow(2, l));
  const energyMaxFor = (l) => 1000 + 500 * l;
  const perTapFor = (l) => 1 + l;
  const cardPrice = (c, l) => Math.round(c.basePrice * Math.pow(1.7, l));
  const cardProfit = (c, l) => c.baseProfit * l;
  const dailyReward = (streak) => 500 * Math.min(Math.max(1, streak), 10);

  // ── Иконки: единый набор (золото/крем) + брендовая монета ─────────────────────
  const COIN_SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    <radialGradient id="ckCoinGr" cx="36%" cy="30%" r="82%">
      <stop offset="0" stop-color="#fff3cf"/><stop offset=".5" stop-color="#f0c24e"/><stop offset="1" stop-color="#bd812a"/>
    </radialGradient>
    <symbol id="ckSymCoin" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="11" fill="url(#ckCoinGr)" stroke="#9c6a1c" stroke-width="1"/>
      <circle cx="12" cy="12" r="8.4" fill="none" stroke="#fde9b0" stroke-width="1" opacity=".5"/>
      <path d="M8 16.2V7.8l4 4.7 4-4.7v8.4" fill="none" stroke="#7a4a12" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
    </symbol></defs></svg>`;
  const COIN = (s) => `<svg class="ck-coin-i" width="${s}" height="${s}" viewBox="0 0 24 24"><use href="#ckSymCoin"/></svg>`;
  const SVG = (p, s) => `<svg class="ck-i" width="${s || 24}" height="${s || 24}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const ICON = {
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
    rain: (s) => SVG('<path d="M7.5 13.5A3.5 3.5 0 0 1 8 6.6a5 5 0 0 1 9.4 1.3A3.3 3.3 0 0 1 16.8 13.5M8 17l-1 2.5M12 17l-1 2.5M16 17l-1 2.5"/>', s),
    oven: (s) => SVG('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M7 6.6h.01M10 6.6h.01M7.5 13a4.5 4.5 0 0 1 9 0"/>', s),
    megaphone: (s) => SVG('<path d="M4 10v4l10 4.5V5.5L4 10ZM4 10H3.2A1.2 1.2 0 0 0 2 11.2v1.6A1.2 1.2 0 0 0 3.2 14H4M14 8.5a3.5 3.5 0 0 1 0 7M7 15v3.5"/>', s),
    chef: (s) => SVG('<path d="M7 13.5h10V19a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-5.5ZM7 13.5a3.6 3.6 0 0 1-.8-7A3.4 3.4 0 0 1 12 4.6a3.4 3.4 0 0 1 5.8 1.9 3.6 3.6 0 0 1-.8 7M7 16.5h10"/>', s),
    lock: (s) => SVG('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', s),
    dove: (s) => SVG('<path d="M21 7c-1.2.8-2.2.9-3 .4-1.6-1-4-.6-5.5 1.2C11 10.4 8.6 11.4 5 11.4c1.3 1.8 3.6 2.7 6 2.2-.9 2.2-2.7 3.6-5 4 2.3 1.4 5.5 1.4 8-.6 2-1.6 3-4 3-6.6 0-.9.4-1.7 1.2-2.2M8.5 18 7 21M12.5 17.5 12 21"/>', s),
  };
  const cardIcon = (id, s = 26) => ({ bakery: ICON.cupcake, coffee: ICON.coffee, oven: ICON.oven, cakefactory: ICON.cake, ads: ICON.megaphone, smm: ICON.send, tasting: ICON.star, loyalty: ICON.wallet, barista: ICON.coffee, baker: ICON.chef, confectioner: ICON.cupcake, manager: ICON.users, delivery: ICON.scooter, newshop: ICON.shop, franchise: ICON.gift, region: ICON.globe }[id] || ICON.cupcake)(s);
  // арт-плитка бизнеса: иллюстрация-PNG если есть (BIZ_ART_V>0), иначе SVG-иконка
  const BIZ_ART_V = 5; // голуби-помощники /assets/images/biz/<id>.png (все v3 — единый набор)
  const cardArt = (id) => BIZ_ART_V ? `<img src="/assets/images/biz/${id}.png?v=${BIZ_ART_V}" alt="" loading="lazy">` : cardIcon(id, 30);
  const taskIcon = (id) => ({ site: ICON.globe, review: ICON.star, vk: ICON.users, tg: ICON.send, invite1: ICON.users, level3: ICON.star, balance10: ICON.wallet, streak3: ICON.fire }[id] || ICON.star)(26);

  // ── Бонусы дня (зеркало src/clicker.ts — алгоритм/слова/морзе менять синхронно) ──
  const COMBO_REWARD = 50000, CIPHER_REWARD = 8000;
  const CIPHER_WORDS = ['МАРИЯ', 'ТОРТ', 'КОТИК', 'КРЕМ', 'ЭКЛЕР', 'МУСС', 'БИСКВИТ', 'ВАНИЛЬ', 'ШОКОЛАД', 'КАРАМЕЛЬ', 'ДЕСЕРТ', 'ПЕКАРНЯ'];
  const MORSE = { А: '.-', Б: '-...', В: '.--', Г: '--.', Д: '-..', Е: '.', Ж: '...-', З: '--..', И: '..', Й: '.---', К: '-.-', Л: '.-..', М: '--', Н: '-.', О: '---', П: '.--.', Р: '.-.', С: '...', Т: '-', У: '..-', Ф: '..-.', Х: '....', Ц: '-.-.', Ч: '---.', Ш: '----', Щ: '--.-', Ь: '-..-', Ы: '-.--', Э: '..-..', Ю: '..--', Я: '.-.-' };
  function dateSeed(day, salt) { let h = 2166136261 >>> 0; const s = day + salt; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
  function todaysCombo(day) { let h = dateSeed(day, 'combo'); const pool2 = CARDS.map(c => c.id); const pick = []; for (let i = 0; i < 3; i++) { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; pick.push(pool2.splice(h % pool2.length, 1)[0]); } return pick; }
  function todaysCipher(day) { return CIPHER_WORDS[dateSeed(day, 'cipher') % CIPHER_WORDS.length]; }
  function toMorse(w) { return w.split('').map(c => MORSE[c] || '').join(' '); }
  const cardName = (id) => (CARDS.find(c => c.id === id) || {}).name || id;

  // ── Сезон (неделя) + Достижения (зеркало src/clicker.ts — менять синхронно) ──────
  const weekMonday = () => { const d = Math.floor((Date.now() + 8 * 3600e3) / 86400000); return d - ((d + 3) % 7); };
  const seasonEndsTs = () => (weekMonday() + 7) * 86400000 - 8 * 3600e3;
  const ACHIEVEMENTS = [
    { id: 'ach_taps1k', name: 'Разминка лап', icon: 'tap', reward: 2000, type: 'taps', target: 1000 },
    { id: 'ach_taps10k', name: 'Мастер тапа', icon: 'tap', reward: 10000, type: 'taps', target: 10000 },
    { id: 'ach_earn50k', name: 'Первые полста', icon: 'wallet', reward: 5000, type: 'balance', target: 50000 },
    { id: 'ach_biz5', name: 'Бизнес-империя', icon: 'shop', reward: 8000, type: 'cards', target: 5 },
    { id: 'ach_lvl10', name: 'Высшая лига', icon: 'trophy', reward: 25000, type: 'level', target: 10 },
    { id: 'ach_lvl19', name: 'Повелитель котов', icon: 'star', reward: 100000, type: 'level', target: 19 },
    { id: 'ach_streak7', name: 'Неделя верности', icon: 'fire', reward: 7000, type: 'streak', target: 7 },
    { id: 'ach_ref3', name: 'Душа компании', icon: 'users', reward: 15000, type: 'ref', target: 3 },
    { id: 'col_prod', name: 'Цех в сборе', icon: 'dove', reward: 10000, type: 'collect', target: 'prod' },
    { id: 'col_mkt', name: 'Маркетинг в сборе', icon: 'dove', reward: 10000, type: 'collect', target: 'mkt' },
    { id: 'col_staff', name: 'Команда в сборе', icon: 'dove', reward: 10000, type: 'collect', target: 'staff' },
    { id: 'col_net', name: 'Сеть в сборе', icon: 'dove', reward: 10000, type: 'collect', target: 'net' },
    { id: 'col_all', name: 'Повелитель голубей', icon: 'trophy', reward: 60000, type: 'collect', target: 'all' },
  ];
  const achIcon = (key) => ({ tap: ICON.tap, wallet: ICON.wallet, shop: ICON.shop, trophy: ICON.trophy, star: ICON.star, fire: ICON.fire, users: ICON.users, dove: ICON.dove }[key] || ICON.star)(26);
  function condMet(t, s) {
    if (t.type === 'link') return !!linkOpened[t.id];
    if (t.type === 'level') return s.level >= t.target;
    if (t.type === 'balance') return s.totalEarned >= t.target;
    if (t.type === 'streak') return s.dailyStreak >= t.target;
    if (t.type === 'ref') return (s.referrals || 0) >= t.target;
    if (t.type === 'taps') return (s.taps || 0) >= t.target;
    if (t.type === 'cards') return (s.cardsOwned || 0) >= t.target;
    if (t.type === 'collect') { const cs = s.cards || []; if (t.target === 'all') return cs.length > 0 && cs.every(c => c.level > 0); const ic = cs.filter(c => c.cat === t.target); return ic.length > 0 && ic.every(c => c.level > 0); }
    return false;
  }
  function fmtDur(ms) { const h = Math.max(0, Math.floor(ms / 3600e3)); const d = Math.floor(h / 24); return d > 0 ? `${d}д ${h % 24}ч` : `${h}ч`; }

  // ── Реальные награды (витрина). ⚠️ redeem ВЫКЛ до согласования Маши (зеркало clicker.ts) ──
  const REWARDS_ENABLED = false;
  const REWARDS = [
    { id: 'promo5', name: 'Промокод −5%', cost: 100000, note: 'скидка на заказ' },
    { id: 'promo10', name: 'Промокод −10%', cost: 250000, note: 'скидка на заказ' },
    { id: 'bonus300', name: '300 бонусов на карту', cost: 200000, note: 'клуб «Мария»' },
    { id: 'dessert', name: 'Десерт в подарок', cost: 500000, note: 'при заказе' },
  ];

  let ov, audio, raf, lastTs = 0, pending = 0, syncT = 0, curLevel = 1, tab = 'cat';
  let st = null, turboUntil = 0, combo = 0, comboT = 0, bonusTimer = 0, rainState = null, rainRAF = 0, upCat = 'prod', lastBought = null;

  function authed() { return !!(window.App && App.isAuthed && App.isAuthed()); }
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
  // монета-«колокольчик»: основной тон + октава + искра; питч растёт с комбо
  function sfxTap(combo) {
    const k = 1 + Math.min(combo || 0, 24) * 0.014; const base = 740 * k;
    note(base, 0.16, 'triangle', 0.09, base * 1.5); note(base * 2, 0.12, 'sine', 0.05); note(base * 3.01, 0.06, 'sine', 0.03, null, 0.005);
  }
  function sfxBuy() { note(523, 0.14, 'triangle', 0.11, 660); note(784, 0.18, 'triangle', 0.1, null, 0.08); note(1318, 0.1, 'sine', 0.05, null, 0.12); }
  function sfxLevel() { [523, 659, 784, 1047, 1319].forEach((f, i) => note(f, 0.5, 'triangle', 0.12, null, i * 0.09)); note(2093, 0.5, 'sine', 0.04, null, 0.4); }
  function sfxTurbo() { note(180, 0.45, 'sawtooth', 0.1, 920); note(360, 0.4, 'triangle', 0.06, 1400, 0.04); note(1568, 0.18, 'sine', 0.05, null, 0.3); }
  function sfxReward() { [1568, 1318, 1047, 1568].forEach((f, i) => note(f, 0.22, 'triangle', 0.1, null, i * 0.07)); }
  function sfxError() { note(220, 0.18, 'sine', 0.08, 160); }
  function coinSfx() { sfxTap(0); }

  // ── Гость (localStorage) ─────────────────────────────────────────────────────
  function rawDefault() { return { balance: 0, totalEarned: 0, energy: 1000, multitapLevel: 0, energyLevel: 0, cards: {}, taps: 0, dailyStreak: 0, dailyDate: null, bE: 0, bT: 0, bDate: null, turboUntil: 0, tasksDone: {}, comboDate: null, comboHits: [], comboClaimed: null, cipherDate: null, bonusAt: 0, chestDate: null, rainDate: null, _ts: Date.now() }; }
  function rawGet() { let s; try { s = JSON.parse(localStorage.getItem(LS)); } catch (_) {} if (!s) s = rawDefault(); if (!s.cards) s.cards = {}; return s; }
  function rawSave(s) { s._ts = Date.now(); localStorage.setItem(LS, JSON.stringify(s)); }
  function profitOf(c) { let p = 0; for (const x of CARDS) p += cardProfit(x, c[x.id] || 0); return p; }
  function guestDerive() {
    const s = rawGet(); const today = irkToday();
    if (s.bDate !== today) { s.bE = 0; s.bT = 0; s.bDate = today; }
    const secs = Math.max(0, (Date.now() - (s._ts || Date.now())) / 1000);
    s.energy = Math.min(energyMaxFor(s.energyLevel), Math.round(s.energy + secs * REGEN));
    const passive = Math.floor(profitOf(s.cards) * Math.min(secs / 3600, PASSIVE_CAP_H));
    if (passive > 0) { s.balance += passive; s.totalEarned += passive; }
    rawSave(s); return guestState(s, passive);
  }
  function guestState(s, passive) {
    const today = irkToday();
    return {
      balance: s.balance, totalEarned: s.totalEarned, energy: s.energy, energyMax: energyMaxFor(s.energyLevel),
      perTap: perTapFor(s.multitapLevel), profitPerHour: profitOf(s.cards), passiveEarned: passive || 0,
      level: leagueFor(s.totalEarned).level, levelName: leagueFor(s.totalEarned).name, nextNeed: nextNeed(s.totalEarned),
      multitapLevel: s.multitapLevel, multitapPrice: priceMultitap(s.multitapLevel),
      energyLevel: s.energyLevel, energyPrice: priceEnergy(s.energyLevel),
      cards: CARDS.map(c => { const lv = s.cards[c.id] || 0; const locked = lv === 0 && !!c.req && leagueFor(s.totalEarned).level < c.req; return { id: c.id, name: c.name, cat: c.cat, level: lv, profit: cardProfit(c, lv + 1), price: cardPrice(c, lv), req: c.req || 0, locked }; }),
      dailyAvailable: s.dailyDate !== today, dailyStreak: s.dailyStreak, dailyNext: dailyReward(s.dailyDate === today ? s.dailyStreak : s.dailyStreak + 1),
      chestAvailable: s.chestDate !== today,
      rainAvailable: s.rainDate !== today,
      boostEnergyLeft: DAILY_BOOSTS - s.bE, boostTurboLeft: DAILY_BOOSTS - s.bT, turboMsLeft: Math.max(0, (s.turboUntil || 0) - Date.now()),
      combo: (() => { const cards = todaysCombo(today); const hits = s.comboDate === today ? (s.comboHits || []) : []; return { cards, hits, complete: cards.every(c => hits.includes(c)), claimed: s.comboClaimed === today, reward: COMBO_REWARD }; })(),
      cipher: { morse: toMorse(todaysCipher(today)), len: todaysCipher(today).length, claimed: s.cipherDate === today, reward: CIPHER_REWARD },
      taps: s.taps || 0, cardsOwned: CARDS.filter(c => (s.cards[c.id] || 0) > 0).length,
      season: { points: 0, endsTs: seasonEndsTs() },
    };
  }

  async function api(path, opts) { const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(App.authHeader ? App.authHeader() : {}) } }); return r.json(); }
  async function load() { st = authed() ? await api('/api/clicker').catch(() => guestDerive()) : guestDerive(); turboUntil = Date.now() + (st.turboMsLeft || 0); }
  async function flush() { if (pending <= 0 || !authed()) return; const n = pending; pending = 0; try { const d = await api('/api/clicker/tap', { method: 'POST', body: JSON.stringify({ taps: n }) }); st = d; } catch (_) { pending += n; } }

  async function buy(type, id) {
    let ok = false;
    if (authed()) { try { const d = await api('/api/clicker/buy', { method: 'POST', body: JSON.stringify({ type, id }) }); if (!d.error) { st = d; ok = true; } } catch (_) {} }
    else { const s = guestBuyRaw(type, id); if (s) { st = guestDerive(); ok = true; } }
    if (ok) { lastBought = type === 'card' ? id : null; sfxBuy(); window.haptic && window.haptic('medium'); renderAll(); renderUpgrades(); } else { sfxError(); flashMsg('Не хватает монет'); }
  }
  function guestBuyRaw(type, id) {
    guestDerive(); const s = rawGet(); let cost = 0;
    if (type === 'multitap') cost = priceMultitap(s.multitapLevel); else if (type === 'energy') cost = priceEnergy(s.energyLevel);
    else { const c = CARDS.find(x => x.id === id); const lv = s.cards[id] || 0; if (lv === 0 && c.req && leagueFor(s.totalEarned).level < c.req) return null; cost = cardPrice(c, lv); }
    if (s.balance < cost) return null; s.balance -= cost;
    if (type === 'multitap') s.multitapLevel++; else if (type === 'energy') s.energyLevel++; else {
      s.cards[id] = (s.cards[id] || 0) + 1;
      const today = irkToday();
      if (todaysCombo(today).includes(id)) { if (s.comboDate !== today) { s.comboHits = []; s.comboDate = today; } if (!s.comboHits.includes(id)) s.comboHits.push(id); }
    }
    rawSave(s); return s;
  }
  async function claimDaily() {
    let r;
    if (authed()) { r = await api('/api/clicker/daily', { method: 'POST', body: '{}' }).catch(() => null); if (r && !r.error) st = r; }
    else { const g = guestClaimDaily(); if (g) { r = { reward: g }; st = guestDerive(); } }
    if (r && r.reward) { sfxReward(); window.haptic && window.haptic('success'); dailyPopup(r.reward, st.dailyStreak); renderAll(); bumpBalance(); }
  }
  function guestClaimDaily() {
    guestDerive(); const s = rawGet(); const today = irkToday(); if (s.dailyDate === today) return 0;
    const yest = new Date(Date.now() + 8 * 3600 * 1000 - 86400000).toISOString().slice(0, 10);
    s.dailyStreak = s.dailyDate === yest ? s.dailyStreak + 1 : 1; const rew = dailyReward(s.dailyStreak);
    s.balance += rew; s.totalEarned += rew; s.dailyDate = today; rawSave(s); return rew;
  }
  async function claimCombo() {
    let r;
    if (authed()) { r = await api('/api/clicker/combo', { method: 'POST', body: '{}' }).catch(() => null); if (r && !r.error) st = r; else r = null; }
    else { const g = guestClaimComboRaw(); if (g) { r = { reward: COMBO_REWARD }; st = guestDerive(); } }
    if (r && r.reward) { sfxLevel(); window.haptic && window.haptic('success'); coinShower(); confettiBurst(); dailyPopupRaw(ICON.star(20) + ' Комбо дня собрано!', r.reward); renderAll(); renderTasks(); bumpBalance(); }
    else flashMsg('Комбо ещё не собрано');
  }
  function guestClaimComboRaw() {
    guestDerive(); const s = rawGet(); const today = irkToday();
    if (s.comboClaimed === today) return false;
    const combo = todaysCombo(today); const hits = s.comboDate === today ? (s.comboHits || []) : [];
    if (!combo.every(c => hits.includes(c))) return false;
    s.balance += COMBO_REWARD; s.totalEarned += COMBO_REWARD; s.comboClaimed = today; rawSave(s); return true;
  }
  async function claimCipher(guess) {
    let r;
    if (authed()) { r = await api('/api/clicker/cipher', { method: 'POST', body: JSON.stringify({ guess }) }).catch(() => null); if (r && !r.error) st = r; else { flashMsg(r && r.error === 'already' ? 'Уже разгадан сегодня' : 'Неверно, попробуй ещё'); return; } }
    else { const g = guestClaimCipherRaw(guess); if (!g) { flashMsg('Неверно, попробуй ещё'); return; } st = guestDerive(); r = { reward: CIPHER_REWARD }; }
    if (r && r.reward) { sfxReward(); window.haptic && window.haptic('success'); coinShower(); dailyPopupRaw(ICON.bolt(20) + ' Шифр разгадан!', r.reward); renderAll(); renderTasks(); bumpBalance(); }
  }
  function guestClaimCipherRaw(guess) {
    guestDerive(); const s = rawGet(); const today = irkToday();
    if (s.cipherDate === today) return false;
    if (String(guess || '').trim().toUpperCase().replace(/Ё/g, 'Е') !== todaysCipher(today)) return false;
    s.balance += CIPHER_REWARD; s.totalEarned += CIPHER_REWARD; s.cipherDate = today; rawSave(s); return true;
  }
  async function boost(type) {
    let ok = false;
    if (authed()) { try { const d = await api('/api/clicker/boost', { method: 'POST', body: JSON.stringify({ type }) }); if (!d.error) { st = d; ok = true; } } catch (_) {} }
    else { ok = guestBoost(type); if (ok) st = guestDerive(); }
    if (!ok) { flashMsg('Бусты на сегодня кончились'); return; }
    if (type === 'turbo') { turboUntil = Date.now() + TURBO_SEC * 1000; sfxTurbo(); }
    else { chord([520, 780], 0.14); }
    window.haptic && window.haptic('medium'); renderAll();
  }
  function guestBoost(type) {
    guestDerive(); const s = rawGet();
    if (type === 'energy') { if (s.bE >= DAILY_BOOSTS) return false; s.energy = energyMaxFor(s.energyLevel); s.bE++; }
    else { if (s.bT >= DAILY_BOOSTS) return false; s.turboUntil = Date.now() + TURBO_SEC * 1000; s.bT++; }
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
      .ck-ov{--gold:#eebf52;--gold-l:#ffe49c;--gold-d:#c2882a;--cream:#f4ead7;--ink:#efe2cf;--muted:#bb9d88;--panel:rgba(255,238,214,.055);--line:rgba(238,191,82,.16);
        position:fixed;inset:0;z-index:9999;display:none;flex-direction:column;
        background:radial-gradient(135% 105% at 50% -8%,#4e1b26 0%,#2c1017 52%,#180a0f 100%);
        overflow:hidden;touch-action:manipulation;user-select:none;-webkit-user-select:none;color:var(--ink);font-family:'Inter',system-ui,sans-serif}
      .ck-ov::after{content:'';position:absolute;inset:0;pointer-events:none;z-index:0;background:radial-gradient(125% 75% at 50% 118%,rgba(0,0,0,.55),transparent 58%)}
      .ck-ov.on{display:flex}.ck-ov.turbo{background:radial-gradient(135% 105% at 50% -8%,#6e2026 0%,#3a0f15 58%,#1c080f 100%)}
      .ck-screen{position:relative;z-index:1;flex:1;display:none;flex-direction:column;align-items:center;overflow:hidden}.ck-screen.on{display:flex}
      .ck-x{position:absolute;top:12px;right:12px;z-index:9;width:34px;height:34px;border:1px solid var(--line);border-radius:50%;background:rgba(0,0,0,.28);color:var(--cream);font-size:17px;cursor:pointer}
      .ck-i{display:inline-block;vertical-align:-.16em}.ck-coin-i{display:inline-block;vertical-align:-.18em;filter:drop-shadow(0 1px 1px rgba(0,0,0,.4))}
      .ck-daily{margin-top:13px;display:inline-flex;align-items:center;gap:7px;background:linear-gradient(180deg,#ffe7a6,#eebf52 58%,#cf9a36);color:#5a2028;font-weight:800;border:1px solid #ffe9b3;border-radius:14px;padding:9px 18px;font-size:13px;cursor:pointer;box-shadow:0 7px 18px rgba(170,115,30,.4),inset 0 1px 0 rgba(255,255,255,.55)}
      .ck-lvl{margin-top:13px;color:var(--gold-l);font-family:'Playfair Display',Georgia,serif;font-weight:700;font-size:17px;letter-spacing:.2px}
      .ck-bal{display:flex;align-items:center;justify-content:center;gap:9px;margin-top:4px;font-family:'Playfair Display',Georgia,serif;font-weight:700;font-size:40px;font-variant-numeric:tabular-nums;color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.45)}
      .ck-prof{margin-top:6px;display:inline-flex;align-items:center;gap:6px;background:var(--panel);border:1px solid var(--line);padding:4px 13px;border-radius:20px;font-weight:700;font-size:12px;color:var(--gold);font-variant-numeric:tabular-nums}
      .ck-prog{width:80%;max-width:330px;margin-top:10px}.ck-prog__bar{height:8px;border-radius:6px;background:rgba(0,0,0,.34);box-shadow:inset 0 1px 2px rgba(0,0,0,.45);overflow:hidden}.ck-prog__fill{height:100%;border-radius:6px;background:linear-gradient(90deg,#cf9a36,#ffe49c);box-shadow:0 0 8px rgba(238,191,82,.55);transition:width .3s}.ck-prog__t{color:var(--muted);font-size:10.5px;text-align:center;margin-top:4px;font-weight:600;font-variant-numeric:tabular-nums}
      .ck-catwrap{position:relative;flex:1;width:100%;display:flex;align-items:center;justify-content:center}
      .ck-catwrap::before{content:'';position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:76%;height:76%;background:radial-gradient(ellipse at center,rgba(255,196,72,.54) 0%,rgba(255,170,48,.30) 42%,rgba(255,170,48,0) 70%);filter:blur(9px);pointer-events:none;z-index:0;animation:ckGlowPulse 4.2s ease-in-out infinite}
      .ck-catwrap::after{content:'';position:absolute;left:50%;bottom:5%;transform:translateX(-50%);width:44%;height:22px;border-radius:50%;background:radial-gradient(ellipse at center,rgba(0,0,0,.5),transparent 72%);filter:blur(3px);pointer-events:none;z-index:0;animation:ckShadowPulse 3.6s ease-in-out infinite}
      .ck-cat{position:relative;z-index:1;max-width:62%;max-height:94%;width:auto;height:auto;object-fit:contain;cursor:pointer;filter:drop-shadow(0 14px 18px rgba(40,8,12,.5));transform-origin:bottom center;-webkit-tap-highlight-color:transparent;animation:ckBreathe 3.8s ease-in-out infinite}
      .ck-cat.tap{animation:ckBreathe 3.8s ease-in-out infinite,ckTapSq .26s ease-out}.ck-cat.turbo{filter:drop-shadow(0 0 30px #ffb13d) drop-shadow(0 16px 22px rgba(40,8,12,.5))}
      @keyframes ckBreathe{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-5px) scale(1.016)}}
      @keyframes ckTapSq{0%{transform:scale(1,1)}30%{transform:scale(1.07,.9)}62%{transform:scale(.97,1.05)}100%{transform:scale(1,1)}}
      @keyframes ckGlowPulse{0%,100%{opacity:.82;transform:translate(-50%,-50%) scale(1)}50%{opacity:1;transform:translate(-50%,-50%) scale(1.07)}}
      @keyframes ckShadowPulse{0%,100%{opacity:1;width:44%}50%{opacity:.8;width:40%}}
      .ck-ripple{position:absolute;width:0;height:0;border:2px solid var(--gold-l);border-radius:50%;pointer-events:none;z-index:6;transform:translate(-50%,-50%);animation:ckRip .5s ease-out forwards}
      @keyframes ckRip{0%{width:8px;height:8px;opacity:.7}100%{width:130px;height:130px;opacity:0}}
      .ck-flyc{position:absolute;z-index:7;pointer-events:none;transition:left .5s cubic-bezier(.5,0,.6,1),top .5s cubic-bezier(.5,0,.6,1),opacity .5s,transform .5s}
      .ck-balpop{display:inline-block;animation:ckBalPop .24s ease-out}
      @keyframes ckBalPop{0%{transform:scale(1)}45%{transform:scale(1.08)}100%{transform:scale(1)}}
      .ck-spark{position:absolute;width:7px;height:7px;border-radius:50%;background:radial-gradient(circle,rgba(255,232,160,.95),transparent 70%);pointer-events:none;z-index:0;opacity:0;animation:ckSpark linear infinite}
      @keyframes ckSpark{0%{transform:translateY(20px) scale(.6);opacity:0}25%{opacity:.7}100%{transform:translateY(-130px) scale(1);opacity:0}}
      .ck-flash{position:absolute;inset:0;z-index:7;pointer-events:none;background:radial-gradient(circle at 50% 46%,rgba(255,242,205,.9),rgba(255,200,90,.35) 30%,transparent 62%);opacity:0;animation:ckFlash .7s ease-out forwards}
      @keyframes ckFlash{0%{opacity:0;transform:scale(.5)}28%{opacity:1}100%{opacity:0;transform:scale(1.5)}}
      .ck-ghost{position:absolute;pointer-events:none;z-index:3;object-fit:contain;transition:opacity .6s ease-out,transform .6s ease-out}
      .ck-conf{position:absolute;z-index:7;pointer-events:none;border-radius:1px;will-change:transform,opacity}
      .ck-greet{display:none;margin-top:8px;align-items:center;gap:6px;background:var(--panel);border:1px solid var(--line);color:var(--gold-l);padding:4px 13px;border-radius:20px;font-weight:700;font-size:12px}
      .ck-greet.on{display:inline-flex}
      .ck-rain{position:absolute;inset:0;z-index:11;display:none;flex-direction:column;background:radial-gradient(135% 100% at 50% -8%,#3a1018,#180a10);touch-action:none}
      .ck-rain.on{display:flex}
      .ck-rain__hud{display:flex;align-items:center;gap:14px;padding:14px 16px;font-weight:800;font-size:15px;color:var(--cream);font-variant-numeric:tabular-nums}
      .ck-rain__hud .t{display:inline-flex;align-items:center;gap:6px}.ck-rain__hud .s{display:inline-flex;align-items:center;gap:6px;color:var(--gold-l)}.ck-rain__hud .sp{flex:1}
      .ck-rain__hud .x{width:32px;height:32px;border:1px solid var(--line);border-radius:50%;background:rgba(0,0,0,.3);color:var(--cream);font-size:16px;cursor:pointer}
      .ck-rain canvas{flex:1;width:100%;display:block;touch-action:none;cursor:pointer}
      .ck-rain__hint{position:absolute;left:0;right:0;top:48%;text-align:center;color:var(--muted);font-size:13px;pointer-events:none}
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
      .ck-combo{position:absolute;top:17%;left:50%;transform:translateX(-50%);font-family:'Playfair Display',serif;font-weight:800;color:var(--gold-l);text-shadow:0 2px 10px rgba(0,0,0,.6);pointer-events:none;opacity:0;font-size:24px}
      .ck-combo.show{opacity:1}
      .ck-fx{position:absolute;inset:0;pointer-events:none;z-index:6;overflow:hidden}
      .ck-boosts{display:flex;gap:10px;margin:2px 0 9px}
      .ck-boost{display:inline-flex;align-items:center;gap:6px;background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:8px 15px;color:var(--cream);font-weight:700;font-size:13px;cursor:pointer}
      .ck-boost .ck-i{color:var(--gold)}.ck-boost:disabled{opacity:.4;cursor:default}
      .ck-energy{width:84%;max-width:360px;margin:0 0 16px}.ck-energy__row{display:flex;align-items:center;gap:7px;font-weight:700;font-size:13px;margin-bottom:6px;color:var(--cream);font-variant-numeric:tabular-nums}.ck-energy__row .ck-i{color:var(--gold)}.ck-energy__bar{height:11px;border-radius:8px;background:rgba(0,0,0,.34);box-shadow:inset 0 1px 2px rgba(0,0,0,.45);overflow:hidden}.ck-energy__fill{height:100%;border-radius:8px;background:linear-gradient(90deg,#c2882a,#ffe49c);box-shadow:0 0 7px rgba(238,191,82,.5);transition:width .25s}
      .ck-up{position:absolute;color:var(--gold-l);font-weight:800;pointer-events:none;text-shadow:0 2px 5px rgba(0,0,0,.5);z-index:7;font-variant-numeric:tabular-nums}
      .ck-coin{position:absolute;z-index:7;pointer-events:none}
      .ck-uphd{padding:16px 16px 6px;text-align:center;width:100%;box-sizing:border-box}.ck-uphd .b{font-family:'Playfair Display',Georgia,serif;font-weight:700;font-size:24px;display:inline-flex;align-items:center;gap:8px;color:var(--cream)}.ck-uphd .b .ck-i{color:var(--gold)}.ck-uphd .p{color:var(--gold);font-weight:700;font-size:13px;margin-top:3px;display:inline-flex;align-items:center;gap:5px;font-variant-numeric:tabular-nums}
      .ck-uplist{flex:1;overflow:auto;padding:6px 12px 16px;width:100%;box-sizing:border-box}
      .ck-sect{color:var(--muted);font-weight:700;font-size:11px;margin:12px 4px 7px;text-transform:uppercase;letter-spacing:.7px}
      .ck-cats{display:flex;gap:7px;margin:0 0 10px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}.ck-cats::-webkit-scrollbar{display:none}
      .ck-cat-chip{flex:none;border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:18px;padding:7px 14px;font-weight:700;font-size:12.5px;cursor:pointer;white-space:nowrap}
      .ck-cat-chip.on{background:linear-gradient(180deg,#ffe7a6,#eebf52 58%,#cf9a36);color:#5a2028;border-color:#ffe9b3}
      .ck-biz{display:flex;align-items:center;gap:12px;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:10px 12px;margin-bottom:9px;position:relative;opacity:0;animation:ckBizIn .34s ease-out forwards}
      @keyframes ckBizIn{0%{opacity:0;transform:translateY(9px)}100%{opacity:1;transform:none}}
      .ck-biz.locked{filter:saturate(.35) brightness(.82)}
      .ck-biz.bump{animation:ckBizBump .32s ease-out}@keyframes ckBizBump{0%{transform:scale(1)}40%{transform:scale(1.03)}100%{transform:scale(1)}}
      .ck-biz__art{width:64px;height:64px;flex:none;border-radius:14px;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;box-shadow:inset 0 1px 0 rgba(255,255,255,.14),0 3px 8px rgba(0,0,0,.3)}
      .ck-biz__art::after{content:'';position:absolute;inset:0;background:radial-gradient(circle at 32% 22%,rgba(255,255,255,.18),transparent 60%);pointer-events:none;z-index:2}
      .ck-biz__art img{width:100%;height:100%;object-fit:contain;position:relative;z-index:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
      .ck-biz__art svg{width:30px;height:30px;color:#fff8ec;position:relative;z-index:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))}
      .cat-boost .ck-biz__art{background:linear-gradient(150deg,#f0c24e,#9c6a1c)}
      .cat-prod .ck-biz__art{background:linear-gradient(150deg,#d6a64c,#7c4a18)}
      .cat-mkt .ck-biz__art{background:linear-gradient(150deg,#cc5e72,#7a2030)}
      .cat-staff .ck-biz__art{background:linear-gradient(150deg,#4fa0ad,#1f4a55)}
      .cat-net .ck-biz__art{background:linear-gradient(150deg,#9070c2,#3f2a66)}
      .ck-biz__b{flex:1;min-width:0}.ck-biz__n{font-weight:700;font-size:15px;color:var(--ink)}
      .ck-biz__meta{display:flex;align-items:center;gap:7px;margin-top:5px;flex-wrap:wrap}
      .ck-biz__lvl{font-size:10.5px;font-weight:700;color:var(--muted);background:rgba(0,0,0,.26);padding:2px 8px;border-radius:9px;white-space:nowrap}
      .ck-biz__prof{font-size:11.5px;font-weight:700;color:var(--gold-l);font-variant-numeric:tabular-nums;white-space:nowrap}
      .ck-biz__lock{font-size:11px;font-weight:700;color:var(--muted);display:inline-flex;align-items:center;gap:4px}
      .ck-biz__buy{display:inline-flex;align-items:center;gap:5px;flex:none;border:1px solid #ffe9b3;border-radius:12px;padding:9px 13px;font-weight:800;font-size:13px;background:linear-gradient(180deg,#ffe7a6,#eebf52 56%,#cf9a36);color:#5a2028;cursor:pointer;white-space:nowrap;font-variant-numeric:tabular-nums;box-shadow:0 4px 11px rgba(165,112,28,.38),inset 0 1px 0 rgba(255,255,255,.5)}
      .ck-biz__buy:disabled{background:rgba(255,255,255,.07);color:var(--muted);border-color:transparent;box-shadow:none;cursor:default}
      .ck-dovegrid{display:grid;grid-template-columns:repeat(2,1fr);gap:9px;margin-bottom:6px}
      .ck-dove{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px 8px;text-align:center;opacity:0;animation:ckBizIn .34s ease-out forwards}
      .ck-dove__art{position:relative;width:88px;height:88px;margin:0 auto;border-radius:14px;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,rgba(238,191,82,.18),rgba(238,191,82,.04));border:1px solid var(--line);overflow:hidden}
      .ck-dove__art img{width:100%;height:100%;object-fit:contain;position:relative;z-index:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
      .ck-dove.silh .ck-dove__art img{filter:brightness(0);opacity:.3}
      .ck-dove__q{position:absolute;z-index:2;font-family:'Playfair Display',serif;font-weight:800;font-size:34px;color:var(--muted)}
      .ck-dove__n{margin-top:7px;font-weight:700;font-size:12.5px;color:var(--ink)}
      .ck-dove.silh .ck-dove__n{color:var(--muted)}
      .ck-dove__role{font-size:10.5px;color:var(--muted);margin-top:1px}
      .ck-card{display:flex;align-items:center;gap:12px;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:11px 12px;margin-bottom:9px}
      .ck-card__ic{width:46px;height:46px;flex:none;border-radius:13px;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,rgba(238,191,82,.2),rgba(238,191,82,.04));border:1px solid var(--line);color:var(--gold-l)}
      .ck-card__b{flex:1;min-width:0}.ck-card__n{font-weight:700;font-size:15px;color:var(--ink)}.ck-card__s{color:var(--muted);font-size:12px;margin-top:2px;font-variant-numeric:tabular-nums}
      .ck-card__buy{display:inline-flex;align-items:center;gap:5px;border:1px solid #ffe9b3;border-radius:12px;padding:9px 13px;font-weight:800;font-size:13px;background:linear-gradient(180deg,#ffe7a6,#eebf52 56%,#cf9a36);color:#5a2028;cursor:pointer;white-space:nowrap;font-variant-numeric:tabular-nums;box-shadow:0 4px 11px rgba(165,112,28,.38),inset 0 1px 0 rgba(255,255,255,.5)}.ck-card__buy:disabled{background:rgba(255,255,255,.07);color:var(--muted);border-color:transparent;box-shadow:none;cursor:default}
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
      .ck-nav{display:flex;border-top:1px solid var(--line);background:rgba(18,8,11,.5);backdrop-filter:blur(8px)}
      .ck-nav__b{flex:1;border:none;background:transparent;color:var(--muted);padding:9px 0 12px;font-weight:600;font-size:11.5px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px}.ck-nav__b.on{color:var(--gold-l)}
      .ck-levelup{position:absolute;inset:0;z-index:8;display:flex;align-items:center;justify-content:center;pointer-events:none}.ck-levelup span{font-family:'Playfair Display',serif;color:var(--gold-l);font-weight:700;font-size:26px;background:linear-gradient(180deg,rgba(46,17,25,.92),rgba(26,10,15,.92));border:1px solid var(--line);padding:14px 24px;border-radius:18px;opacity:0;box-shadow:0 12px 36px rgba(0,0,0,.5)}.ck-levelup span.show{animation:ckLU 1.6s ease-out}@keyframes ckLU{0%{opacity:0;transform:scale(.6)}20%{opacity:1;transform:scale(1.1)}80%{opacity:1}100%{opacity:0}}
      .ck-pop{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9;background:linear-gradient(180deg,#2e1119,#1d0a11);border:1px solid var(--line);border-radius:20px;padding:24px;text-align:center;box-shadow:0 18px 50px rgba(0,0,0,.6);display:none;max-width:80%}.ck-pop.on{display:block}.ck-pop h3{margin:0 0 6px;font-family:'Playfair Display',serif;font-weight:700;font-size:20px;color:var(--cream)}.ck-pop .v{font-family:'Playfair Display',serif;font-size:32px;font-weight:700;color:var(--gold-l);margin:10px 0;display:inline-flex;align-items:center;gap:8px;font-variant-numeric:tabular-nums}.ck-pop button{margin-top:10px;border:1px solid #ffe9b3;border-radius:14px;padding:12px 28px;font-weight:800;background:linear-gradient(180deg,#ffe7a6,#eebf52 56%,#cf9a36);color:#5a2028;cursor:pointer}
    `;
    document.head.appendChild(s);
  }

  function build() {
    styles();
    ov = document.createElement('div'); ov.className = 'ck-ov';
    ov.innerHTML = `
      ${COIN_SPRITE}
      <button class="ck-x" id="ck-x">×</button>
      <div class="ck-screen on" id="ck-scr-cat">
        <button class="ck-daily" id="ck-daily" style="display:none"></button>
        <div class="ck-lvl" id="ck-lvl"></div>
        <div class="ck-greet" id="ck-greet"></div>
        <div class="ck-bal">${COIN(32)} <span id="ck-bal">0</span></div>
        <div class="ck-prof" id="ck-prof">${COIN(14)} +0 / час</div>
        <div class="ck-prog"><div class="ck-prog__bar"><div class="ck-prog__fill" id="ck-prog"></div></div><div class="ck-prog__t" id="ck-progt"></div></div>
        <div class="ck-catwrap" id="ck-catwrap"><img class="ck-cat" id="ck-cat" draggable="false"/><img class="ck-hat" id="ck-hat" draggable="false" style="display:none"/><div class="ck-combo" id="ck-combo"></div></div>
        <div class="ck-boosts">
          <button class="ck-boost" id="ck-bt-turbo">${ICON.rocket(16)} Турбо <span id="ck-bt-turbo-n"></span></button>
          <button class="ck-boost" id="ck-bt-energy">${ICON.bolt(16)} Энергия <span id="ck-bt-energy-n"></span></button>
        </div>
        <div class="ck-energy"><div class="ck-energy__row" id="ck-enrow"><span id="ck-enpre">${ICON.bolt(15)}</span> <span id="ck-en">0</span> / <span id="ck-enmax">1000</span></div><div class="ck-energy__bar"><div class="ck-energy__fill" id="ck-enfill"></div></div></div>
      </div>
      <div class="ck-screen" id="ck-scr-up"><div class="ck-uphd"><div class="ck-bal" style="justify-content:center;font-size:30px">${COIN(26)} <span id="ck-bal2">0</span></div><div class="p" id="ck-prof2">${COIN(13)} +0 / час</div></div><div class="ck-uplist" id="ck-uplist"></div></div>
      <div class="ck-screen" id="ck-scr-dove"><div class="ck-uphd"><div class="b">${ICON.dove(22)} Голубятня</div></div><div class="ck-uplist" id="ck-dovelist"></div></div>
      <div class="ck-screen" id="ck-scr-tasks"><div class="ck-uphd"><div class="b">${ICON.list(22)} Задания</div></div><div class="ck-uplist" id="ck-taskslist"></div></div>
      <div class="ck-screen" id="ck-scr-top"><div class="ck-uphd"><div class="b">${ICON.trophy(22)} Рейтинг</div><div class="p" id="ck-myrank"></div></div><div class="ck-uplist" id="ck-toplist"></div></div>
      <div class="ck-fx" id="ck-fx"></div>
      <div class="ck-levelup" id="ck-levelup"><span id="ck-levelup-t"></span></div>
      <div class="ck-pop" id="ck-pop"></div>
      <div class="ck-nav">
        <button class="ck-nav__b on" data-tab="cat">${ICON.paw(21)}Котик</button>
        <button class="ck-nav__b" data-tab="up">${ICON.bolt(21)}Прокачка</button>
        <button class="ck-nav__b" data-tab="dove">${ICON.dove(21)}Голуби</button>
        <button class="ck-nav__b" data-tab="tasks">${ICON.list(21)}Задания</button>
        <button class="ck-nav__b" data-tab="top">${ICON.trophy(21)}Рейтинг</button>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#ck-x').onclick = close;
    ov.querySelector('#ck-cat').addEventListener('pointerdown', onTap);
    ov.querySelector('#ck-daily').onclick = dailyBtn;
    ov.querySelector('#ck-bt-turbo').onclick = () => boost('turbo');
    ov.querySelector('#ck-bt-energy').onclick = () => boost('energy');
    ov.querySelectorAll('.ck-nav__b').forEach(b => b.onclick = () => setTab(b.dataset.tab));
  }

  function setTab(t) {
    tab = t;
    ov.querySelector('#ck-scr-cat').classList.toggle('on', t === 'cat');
    ov.querySelector('#ck-scr-up').classList.toggle('on', t === 'up');
    ov.querySelector('#ck-scr-dove').classList.toggle('on', t === 'dove');
    ov.querySelector('#ck-scr-tasks').classList.toggle('on', t === 'tasks');
    ov.querySelector('#ck-scr-top').classList.toggle('on', t === 'top');
    ov.querySelectorAll('.ck-nav__b').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    if (t === 'up') renderUpgrades();
    if (t === 'dove') renderDove();
    if (t === 'tasks') renderTasks();
    if (t === 'top') renderTop();
  }

  const turboOn = () => Date.now() < turboUntil;
  function onTap(e) {
    e.preventDefault(); ac();
    if (st.energy < 1) { flashMsg('нет энергии ⚡'); return; }
    const mult = turboOn() ? TURBO_MULT : 1;
    const gain = st.perTap * mult;
    st.energy -= 1; st.balance += gain; st.totalEarned += gain; pending++;
    if (!authed()) { const s = rawGet(); s.energy -= 1; s.balance += gain; s.totalEarned += gain; s.taps = (s.taps || 0) + 1; rawSave(s); }
    // комбо
    const now = performance.now(); combo = (now - comboT < 450) ? combo + 1 : 1; comboT = now;
    const cat = ov.querySelector('#ck-cat'); cat.classList.remove('tap'); void cat.offsetWidth; cat.classList.add('tap'); setTimeout(() => cat.classList.remove('tap'), 80);
    sfxTap(combo); window.haptic && window.haptic('light');
    flyUp(e.clientX, e.clientY, '+' + gain, Math.min(40, 22 + combo));
    ripple(e.clientX, e.clientY); flyCoin(e.clientX, e.clientY);
    if (combo >= 5) showCombo();
    if (combo >= 12 && combo % 3 === 0) coinShower();
    renderTop2();
  }
  function showCombo() { const el = ov.querySelector('#ck-combo'); el.innerHTML = ICON.fire(20) + ' x' + combo; el.classList.add('show'); el.style.fontSize = Math.min(40, 20 + combo) + 'px'; }
  function flyUp(x, y, txt, size) {
    const fx = ov.querySelector('#ck-fx'); const r = fx.getBoundingClientRect();
    const el = document.createElement('div'); el.className = 'ck-up'; el.textContent = txt; el.style.fontSize = (size || 24) + 'px';
    el.style.left = ((x || r.width / 2) - r.left - 10) + 'px'; el.style.top = ((y || r.height / 2) - r.top - 10) + 'px';
    el.style.transition = 'transform .8s ease-out, opacity .8s'; fx.appendChild(el);
    requestAnimationFrame(() => { el.style.transform = `translate(${(Math.random() - .5) * 50}px,-80px)`; el.style.opacity = '0'; });
    setTimeout(() => el.remove(), 850);
  }
  function coinShower() {
    const fx = ov.querySelector('#ck-fx'); const w = fx.clientWidth;
    for (let i = 0; i < 8; i++) { const c = document.createElement('div'); c.className = 'ck-coin'; c.innerHTML = COIN(22); c.style.left = (Math.random() * w) + 'px'; c.style.top = '-30px'; c.style.transition = 'transform 1s ease-in, opacity 1s'; fx.appendChild(c); requestAnimationFrame(() => { c.style.transform = `translateY(${fx.clientHeight + 40}px) rotate(${(Math.random() - .5) * 360}deg)`; c.style.opacity = '0.2'; }); setTimeout(() => c.remove(), 1000); }
  }
  function flashMsg(text) { const fx = ov.querySelector('#ck-fx'); const el = document.createElement('div'); el.className = 'ck-up'; el.style.color = '#ff8a8a'; el.style.fontSize = '20px'; el.textContent = text; el.style.left = '50%'; el.style.top = '56%'; el.style.transform = 'translateX(-50%)'; el.style.transition = 'opacity .9s'; fx.appendChild(el); requestAnimationFrame(() => el.style.opacity = '0'); setTimeout(() => el.remove(), 900); }

  // ── Анимации (juice) ─────────────────────────────────────────────────────────
  let lastFly = 0;
  function spawnSparks() {
    const wrap = ov && ov.querySelector('#ck-catwrap'); if (!wrap || wrap.querySelector('.ck-spark')) return;
    for (let i = 0; i < 6; i++) { const s = document.createElement('div'); s.className = 'ck-spark'; s.style.left = (14 + Math.random() * 72) + '%'; s.style.top = (55 + Math.random() * 28) + '%'; s.style.animationDuration = (4 + Math.random() * 3).toFixed(1) + 's'; s.style.animationDelay = (-Math.random() * 6).toFixed(1) + 's'; wrap.appendChild(s); }
  }
  function ripple(x, y) { const fx = ov.querySelector('#ck-fx'); const r = fx.getBoundingClientRect(); const el = document.createElement('div'); el.className = 'ck-ripple'; el.style.left = (x - r.left) + 'px'; el.style.top = (y - r.top) + 'px'; fx.appendChild(el); setTimeout(() => el.remove(), 520); }
  function bumpBalance() { const b = ov && ov.querySelector('#ck-bal'); if (!b) return; b.classList.remove('ck-balpop'); void b.offsetWidth; b.classList.add('ck-balpop'); }
  function flyCoin(x, y) {
    const now = performance.now(); if (now - lastFly < 80) return; lastFly = now;
    const fx = ov.querySelector('#ck-fx'); const r = fx.getBoundingClientRect(); const bal = ov.querySelector('#ck-bal'); if (!bal) return; const br = bal.getBoundingClientRect();
    const el = document.createElement('div'); el.className = 'ck-flyc'; el.innerHTML = COIN(20);
    el.style.left = (x - r.left - 10) + 'px'; el.style.top = (y - r.top - 10) + 'px'; fx.appendChild(el);
    requestAnimationFrame(() => { el.style.left = (br.left + br.width / 2 - r.left - 10) + 'px'; el.style.top = (br.top + br.height / 2 - r.top - 10) + 'px'; el.style.transform = 'scale(.45)'; el.style.opacity = '0'; });
    setTimeout(() => { el.remove(); bumpBalance(); }, 510);
  }
  function flash() { const fx = ov.querySelector('#ck-fx'); const el = document.createElement('div'); el.className = 'ck-flash'; fx.appendChild(el); setTimeout(() => el.remove(), 720); }
  function confettiBurst() {
    const fx = ov.querySelector('#ck-fx'); const cx = fx.clientWidth / 2, cy = fx.clientHeight * 0.42;
    const cols = ['#ffe49c', '#eebf52', '#cf9a36', '#ffffff', '#ffd86b'];
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
    const r = el.getBoundingClientRect(), fr = ov.querySelector('#ck-fx').getBoundingClientRect();
    el.remove(); confettiBurst();
    let amount = 0;
    if (authed()) { const d = await api('/api/clicker/bonus', { method: 'POST', body: '{}' }).catch(() => null); if (d && !d.error) { st = d; amount = d.amount; } }
    else { amount = guestBonusRaw(); if (amount) st = guestDerive(); }
    if (amount) { sfxReward(); window.haptic && window.haptic('success'); coinShower(); dailyPopupRaw(ICON.star(20) + ' Золотой бонус!', amount); renderAll(); bumpBalance(); }
  }
  function guestBonusRaw() {
    guestDerive(); const s = rawGet(); if (s.bonusAt && Date.now() - s.bonusAt < 45000) return 0;
    const lvl = leagueFor(s.totalEarned).level; const amount = Math.min(60000, Math.round(300 + Math.random() * (700 + lvl * 600)));
    s.balance += amount; s.totalEarned += amount; s.bonusAt = Date.now(); rawSave(s); return amount;
  }

  // ── Сундук удачи ──────────────────────────────────────────────────────────────
  function rollChestGuest(level) {
    const r = Math.random(), sc = 1 + level * 0.25;
    if (r < 0.42) return { type: 'coins', amount: Math.round((500 + Math.random() * 1800) * sc) };
    if (r < 0.68) return { type: 'coins', amount: Math.round((2000 + Math.random() * 4000) * sc) };
    if (r < 0.82) return { type: 'turbo' };
    if (r < 0.95) return { type: 'energy' };
    return { type: 'jackpot', amount: Math.round(15000 + Math.random() * 35000) };
  }
  function guestOpenChestRaw() {
    guestDerive(); const s = rawGet(); const today = irkToday(); if (s.chestDate === today) return null;
    const prize = rollChestGuest(leagueFor(s.totalEarned).level);
    if (prize.type === 'coins' || prize.type === 'jackpot') { s.balance += prize.amount; s.totalEarned += prize.amount; }
    else if (prize.type === 'turbo') { s.turboUntil = Date.now() + TURBO_SEC * 1000; }
    else if (prize.type === 'energy') { s.energy = energyMaxFor(s.energyLevel); }
    s.chestDate = today; rawSave(s); return prize;
  }
  async function openChestAct() {
    let prize = null;
    if (authed()) { const d = await api('/api/clicker/chest', { method: 'POST', body: '{}' }).catch(() => null); if (d && !d.error) { st = d; prize = d.prize; } else { flashMsg('Сундук уже открыт'); return; } }
    else { prize = guestOpenChestRaw(); if (!prize) { flashMsg('Сундук уже открыт'); return; } st = guestDerive(); }
    turboUntil = Date.now() + (st.turboMsLeft || 0);
    sfxLevel(); window.haptic && window.haptic('success'); confettiBurst(); coinShower(); chestPopup(prize); renderAll(); renderTasks(); bumpBalance();
  }
  function chestPopup(prize) {
    const pop = ov.querySelector('#ck-pop'); let body;
    if (prize.type === 'turbo') body = `<div class="v">${ICON.rocket(22)} Турбо ×5</div><div style="color:var(--muted);font-size:13px">20 секунд множитель за тап!</div>`;
    else if (prize.type === 'energy') body = `<div class="v">${ICON.bolt(22)} Полная энергия</div>`;
    else body = `<div class="v">+${fmt(prize.amount)} ${COIN(24)}</div>${prize.type === 'jackpot' ? '<div style="color:var(--gold-l);font-size:14px;font-weight:800;letter-spacing:1px">ДЖЕКПОТ!</div>' : ''}`;
    pop.innerHTML = `<h3>${ICON.chest(20)} Сундук удачи</h3>${body}<button id="ck-pop-ok">Класс!</button>`; pop.classList.add('on'); pop.querySelector('#ck-pop-ok').onclick = () => pop.classList.remove('on');
  }

  // ── Мини-игра «Золотой дождь» (canvas, 20с лови монеты) ───────────────────────
  function rainAvailable() { return !st || st.rainAvailable; }
  function openRain() {
    if (!rainAvailable()) { flashMsg('Игра будет завтра'); return; }
    let el = ov.querySelector('#ck-rain');
    if (!el) {
      el = document.createElement('div'); el.id = 'ck-rain'; el.className = 'ck-rain';
      el.innerHTML = `<div class="ck-rain__hud"><div class="t">${ICON.bolt(16)} <span id="ck-rain-t">20</span></div><div class="sp"></div><div class="s">${COIN(16)} <span id="ck-rain-s">0</span></div><button class="x" id="ck-rain-x">×</button></div><canvas id="ck-rain-cv"></canvas><div class="ck-rain__hint" id="ck-rain-hint">Лови падающие монеты! Золотые — ×3</div>`;
      ov.appendChild(el); el.querySelector('#ck-rain-x').onclick = () => endRain(true);
    }
    el.querySelector('#ck-rain-s').textContent = '0'; el.querySelector('#ck-rain-t').textContent = '20'; el.querySelector('#ck-rain-hint').style.display = '';
    el.classList.add('on'); startRain();
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
    const now = ts || performance.now(); const dt = Math.min(0.05, (now - s.lastTs) / 1000); s.lastTs = now;
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
    g.addColorStop(0, '#fff3cf'); g.addColorStop(.5, '#f0c24e'); g.addColorStop(1, '#bd812a');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, it.r, 0, 7); ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = it.gold ? '#fff' : '#9c6a1c'; ctx.stroke();
    if (it.gold) { ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.beginPath(); ctx.arc(0, 0, it.r + 2.5, 0, 7); ctx.stroke(); }
    ctx.fillStyle = '#7a4a12'; ctx.font = `700 ${Math.round(it.r * 1.05)}px Georgia,serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('М', 0, it.r * 0.08);
    ctx.restore();
  }
  function endRain(aborted) {
    const s = rainState; if (!s || s.ended) return; s.ended = true; cancelAnimationFrame(rainRAF);
    const el = ov.querySelector('#ck-rain'); el.classList.remove('on');
    if (aborted) { rainState = null; return; }
    submitRain(s.score); rainState = null;
  }
  async function submitRain(score) {
    let reward = 0;
    if (authed()) { const d = await api('/api/clicker/rain', { method: 'POST', body: JSON.stringify({ score }) }).catch(() => null); if (d && !d.error) { st = d; reward = d.reward; } }
    else { const g = guestClaimRainRaw(score); if (g != null) { reward = g; st = guestDerive(); } }
    sfxReward(); window.haptic && window.haptic('success'); confettiBurst(); coinShower(); dailyPopupRaw(ICON.rain(20) + ` Золотой дождь · ${score} монет`, reward || 0); renderAll(); renderTasks(); bumpBalance();
  }
  function guestClaimRainRaw(score) {
    guestDerive(); const s = rawGet(); const today = irkToday(); if (s.rainDate === today) return 0;
    const sc = Math.max(0, Math.min(120, Math.floor(score))); const lvl = leagueFor(s.totalEarned).level; const reward = Math.min(80000, sc * (60 + lvl * 20));
    s.balance += reward; s.totalEarned += reward; s.rainDate = today; rawSave(s); return reward;
  }

  // ── Карточка-хвастовство (canvas → шеринг) ────────────────────────────────────
  function drawCardCoin(ctx, x, y, r) {
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.2, x, y, r);
    g.addColorStop(0, '#fff3cf'); g.addColorStop(.5, '#f0c24e'); g.addColorStop(1, '#bd812a');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#9c6a1c'; ctx.stroke();
    ctx.fillStyle = '#7a4a12'; ctx.font = `700 ${Math.round(r * 1.15)}px Georgia,serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('М', x, y + r * 0.06);
  }
  async function shareCard() {
    const lg = leagueFor(st.totalEarned);
    const cv = document.createElement('canvas'); cv.width = 720; cv.height = 900; const ctx = cv.getContext('2d');
    const bg = ctx.createRadialGradient(360, -40, 80, 360, 520, 920); bg.addColorStop(0, '#4e1b26'); bg.addColorStop(.55, '#2c1017'); bg.addColorStop(1, '#180a0f'); ctx.fillStyle = bg; ctx.fillRect(0, 0, 720, 900);
    const gl = ctx.createRadialGradient(360, 430, 40, 360, 430, 300); gl.addColorStop(0, 'rgba(255,196,72,.5)'); gl.addColorStop(.5, 'rgba(255,170,48,.16)'); gl.addColorStop(1, 'rgba(255,170,48,0)'); ctx.fillStyle = gl; ctx.fillRect(0, 130, 720, 640);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffe49c'; ctx.font = '700 48px Georgia,serif'; ctx.fillText('Котик Комбат', 360, 92);
    await new Promise((res) => { const img = new Image(); img.onload = () => { let w = img.width, h = img.height; const sc = Math.min(380 / w, 430 / h); w *= sc; h *= sc; ctx.drawImage(img, 360 - w / 2, 500 - h, w, h); res(); }; img.onerror = res; img.src = A(lg.cat || 'idle.png'); });
    ctx.fillStyle = '#f4ead7'; ctx.font = '700 42px Georgia,serif'; ctx.fillText(lg.name, 360, 590);
    ctx.fillStyle = '#bb9d88'; ctx.font = '600 27px Georgia,serif'; ctx.fillText('Уровень ' + lg.level, 360, 628);
    const bal = fmt(Math.floor(st.totalEarned)); ctx.font = '700 58px Georgia,serif'; const tw = ctx.measureText(bal).width; const total = 64 + tw, sx = 360 - total / 2;
    drawCardCoin(ctx, sx + 26, 700, 28); ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(bal, sx + 64, 718); ctx.textAlign = 'center';
    ctx.fillStyle = '#eebf52'; ctx.font = '600 26px Georgia,serif'; ctx.fillText('Кондитерская «Мария»', 360, 818);
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

  function renderAll() {
    if (!ov || !st) return;
    const lg = leagueFor(st.totalEarned);
    ov.querySelector('#ck-bal').textContent = fmt(st.balance);
    ov.querySelector('#ck-bal2').textContent = fmt(st.balance);
    ov.querySelector('#ck-lvl').textContent = `Уровень ${lg.level} · ${lg.name}`;
    const prof = `${COIN(13)} +${fmt(st.profitPerHour)} / час`; ov.querySelector('#ck-prof').innerHTML = prof; ov.querySelector('#ck-prof2').innerHTML = prof;
    ov.querySelector('#ck-en').textContent = Math.floor(st.energy); ov.querySelector('#ck-enmax').textContent = st.energyMax;
    ov.querySelector('#ck-enfill').style.width = Math.min(100, st.energy / st.energyMax * 100) + '%';
    const nn = nextNeed(st.totalEarned), prog = ov.querySelector('#ck-prog'), progt = ov.querySelector('#ck-progt');
    if (nn) { const pct = Math.min(100, (st.totalEarned - lg.need) / (nn - lg.need) * 100); prog.style.width = pct + '%'; progt.innerHTML = `${fmt(st.totalEarned)} / ${fmt(nn)} ${COIN(12)} до ур. ${lg.level + 1}`; }
    else { prog.style.width = '100%'; progt.textContent = 'Максимальный уровень!'; }
    // ежедневка
    const daily = ov.querySelector('#ck-daily');
    daily.style.display = '';
    if (st.dailyAvailable) { daily.classList.remove('done'); daily.innerHTML = `${ICON.gift(16)} Награда дня · День ${st.dailyStreak + 1}`; }
    else { daily.classList.add('done'); daily.innerHTML = `${ICON.gift(16)} Награда ✓ · день ${st.dailyStreak}`; }
    // бусты
    ov.querySelector('#ck-bt-turbo-n').textContent = '(' + st.boostTurboLeft + ')';
    ov.querySelector('#ck-bt-energy-n').textContent = '(' + st.boostEnergyLeft + ')';
    ov.querySelector('#ck-bt-turbo').disabled = st.boostTurboLeft <= 0;
    ov.querySelector('#ck-bt-energy').disabled = st.boostEnergyLeft <= 0 || st.energy >= st.energyMax;
    // турбо-вид
    const on = turboOn(); ov.classList.toggle('turbo', on); ov.querySelector('#ck-cat').classList.toggle('turbo', on);
    if (on) ov.querySelector('#ck-enpre').innerHTML = ICON.rocket(15) + ' ТУРБО ×5! ·';
    else ov.querySelector('#ck-enpre').innerHTML = ICON.bolt(15);
    if (lg.level !== curLevel) { if (lg.level > curLevel) levelUp(lg); curLevel = lg.level; }
    applyCostume(lg);
  }
  function applyCostume(lg) {
    const cat = ov.querySelector('#ck-cat'), hat = ov.querySelector('#ck-hat');
    hat.style.display = 'none'; // шапки-наклейки убраны — костюм = смена всей картинки кота
    const src = A(lg.cat || 'idle.png');
    if (cat.getAttribute('src') !== src) cat.src = src;
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
    let h = rewardsBlock();
    h += '<div class="ck-sect">Бусты</div>';
    h += biz('boost', cardArt('multitap'), 'Мультитап', `<span class="ck-biz__lvl">+1 за тап</span><span class="ck-biz__prof">сейчас +${st.perTap}</span>`, buyBtn(st.multitapPrice, st.balance < st.multitapPrice, 'multitap'), 0);
    h += biz('boost', cardArt('energy'), 'Запас энергии', `<span class="ck-biz__lvl">+500 энергии</span><span class="ck-biz__prof">сейчас ${st.energyMax}</span>`, buyBtn(st.energyPrice, st.balance < st.energyPrice, 'energy'), 1);
    h += '<div class="ck-sect">Бизнесы — пассивный доход</div>';
    h += '<div class="ck-cats">' + CARD_CATS.map(ct => `<button class="ck-cat-chip${ct.id === upCat ? ' on' : ''}" data-cat="${ct.id}">${ct.name}</button>`).join('') + '</div>';
    let i = 0;
    for (const c of st.cards) {
      if (c.cat !== upCat) continue;
      if (c.locked) h += biz(c.cat + ' locked', cardArt(c.id), c.name, `<span class="ck-biz__lock">${ICON.lock(12)} с уровня ${c.req}</span>`, `<button class="ck-biz__buy" disabled>${ICON.lock(15)}</button>`, i++);
      else h += biz(c.cat, cardArt(c.id), c.name, `<span class="ck-biz__lvl">Ур. ${c.level}</span><span class="ck-biz__prof">+${fmt(c.profit)}/час</span>`, buyBtn(c.price, st.balance < c.price, 'card', c.id), i++);
    }
    list.innerHTML = h;
    if (lastBought) { const el = list.querySelector(`[data-id="${lastBought}"]`); const card = el && el.closest('.ck-biz'); if (card) { card.classList.add('bump'); } lastBought = null; }
    list.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { upCat = b.dataset.cat; renderUpgrades(); });
    list.querySelectorAll('[data-act]').forEach(b => b.onclick = () => buy(b.dataset.act, b.dataset.id || undefined));
    list.querySelectorAll('[data-redeem]').forEach(b => b.onclick = () => redeem(b.dataset.redeem));
  }
  function rewardsBlock() {
    const bal = (st && st.balance) || 0;
    const banner = !REWARDS_ENABLED
      ? `<div class="ck-card" style="background:linear-gradient(90deg,rgba(238,191,82,.18),rgba(238,191,82,.05))"><div class="ck-card__ic">${ICON.gift(26)}</div><div class="ck-card__b"><div class="ck-card__n">Обменивай монеты на реальное</div><div class="ck-card__s">Скидки и бонусы «Марии» — скоро открываем!</div></div></div>`
      : '';
    const cards = REWARDS.map(r => {
      const btn = !REWARDS_ENABLED
        ? `<button class="ck-card__buy" disabled>Скоро</button>`
        : `<button class="ck-card__buy" data-redeem="${r.id}" ${bal >= r.cost ? '' : 'disabled'}>${COIN(14)} ${fmt(r.cost)}</button>`;
      return `<div class="ck-card"${REWARDS_ENABLED ? '' : ' style="opacity:.7"'}><div class="ck-card__ic">${ICON.gift(26)}</div><div class="ck-card__b"><div class="ck-card__n">${r.name}</div><div class="ck-card__s">${r.note} · ${fmt(r.cost)} монет</div></div>${btn}</div>`;
    }).join('');
    return '<div class="ck-sect">Награды «Марии»</div>' + banner + cards;
  }
  function redeem(id) {
    if (!REWARDS_ENABLED) { flashMsg('Скоро откроем'); return; }
    if (!authed()) { flashMsg('Войди через приложение «Мария»'); return; }
    api('/api/clicker/redeem', { method: 'POST', body: JSON.stringify({ id }) }).then(d => {
      if (d && !d.error && d.code) { st = d; sfxLevel(); window.haptic && window.haptic('success'); codePopup(d.code); renderAll(); renderUpgrades(); }
      else flashMsg(d && d.error === 'daily_limit' ? 'Лимит на сегодня' : d && d.error === 'disabled' ? 'Скоро откроем' : 'Не хватает монет');
    }).catch(() => flashMsg('Ошибка'));
  }
  function codePopup(code) { const pop = ov.querySelector('#ck-pop'); pop.innerHTML = `<h3>${ICON.gift(20)} Награда твоя!</h3><div class="v" style="font-size:22px">${code}</div><div style="color:var(--muted);font-size:13px">Покажи код на кассе «Марии»</div><button id="ck-pop-ok">Класс!</button>`; pop.classList.add('on'); pop.querySelector('#ck-pop-ok').onclick = () => pop.classList.remove('on'); }
  function renderDove() {
    const list = ov.querySelector('#ck-dovelist'); if (!st) { list.innerHTML = ''; return; }
    const owned = st.cards.filter(c => c.level > 0).length, total = st.cards.length;
    let h = `<div style="text-align:center;color:var(--muted);font-size:13px;margin:0 0 12px;line-height:1.5">Собери всех помощников кота — <b style="color:var(--gold-l)">${owned}/${total}</b>. Заводи бизнесы в «Прокачке»; награды за комплект — в «Заданиях» → Достижения.</div>`;
    for (const ct of CARD_CATS) {
      const cards = st.cards.filter(c => c.cat === ct.id); const got = cards.filter(c => c.level > 0).length;
      h += `<div class="ck-sect">${ct.name} · ${got}/${cards.length}</div><div class="ck-dovegrid">`;
      let i = 0;
      for (const c of cards) {
        const has = c.level > 0;
        const art = BIZ_ART_V ? `<img src="/assets/images/biz/${c.id}.png?v=${BIZ_ART_V}" alt="" loading="lazy">` : cardIcon(c.id, 36);
        h += `<div class="ck-dove ${has ? 'got' : 'silh'}" style="animation-delay:${(i * 0.03).toFixed(2)}s"><div class="ck-dove__art">${art}${has ? '' : '<span class="ck-dove__q">?</span>'}</div><div class="ck-dove__n">${has ? c.name : '???'}</div><div class="ck-dove__role">${has ? 'Ур. ' + c.level : 'не открыт'}</div></div>`;
        i++;
      }
      h += '</div>';
    }
    list.innerHTML = h;
  }
  async function renderTop() {
    const list = ov.querySelector('#ck-toplist'); const rank = ov.querySelector('#ck-myrank');
    const left = fmtDur(seasonEndsTs() - Date.now());
    const brag = `<button class="ck-card__buy" id="ck-brag" style="width:100%;justify-content:center;margin-bottom:12px">${ICON.trophy(15)} Похвастаться карточкой</button>`;
    const sq = await squadBlock();
    const wire = () => { const bb = ov.querySelector('#ck-brag'); if (bb) bb.onclick = shareCard; sq.wire(); };
    if (!authed()) { rank.textContent = `Сезон недели · до сброса ${left}`; list.innerHTML = brag + sq.html + '<div class="ck-sect">Топ недели</div><div style="text-align:center;color:var(--muted);padding:24px 14px;line-height:1.5">Личный рейтинг — при входе через приложение «Мария».</div>'; wire(); return; }
    list.innerHTML = brag + sq.html + '<div style="text-align:center;color:var(--muted);padding:20px">Загрузка…</div>'; wire();
    const d = await loadTop();
    const ends = d && d.seasonEndsTs ? fmtDur(d.seasonEndsTs - Date.now()) : left;
    rank.textContent = `Сезон недели · до сброса ${ends}` + (d && d.myRank ? ` · ты #${d.myRank}` : '');
    const head = '<div class="ck-sect">Топ недели</div>';
    if (!d || !d.top || !d.top.length) { list.innerHTML = brag + sq.html + head + '<div style="text-align:center;color:var(--muted);padding:20px">Сезон только начался — заработай монеты и будь первым!</div>'; wire(); return; }
    list.innerHTML = brag + sq.html + head + d.top.map((r, i) => `<div class="ck-row${r.me ? ' me' : ''}"><div class="r">${i < 3 ? ICON.medal(20) : i + 1}</div><div class="n">${(r.name || '').replace(/</g, '&lt;')}</div><div class="v">${COIN(14)} ${fmt(r.total)}</div></div>`).join('');
    wire();
  }
  async function squadBlock() {
    if (!authed()) {
      const chips = SQUADS.map(s => `<button class="ck-cat-chip" disabled>${s.name}</button>`).join('');
      return { html: `<div class="ck-sect">Команды</div><div class="ck-cats">${chips}</div><div style="color:var(--muted);font-size:12px;text-align:center;margin:2px 0 6px">Войди через «Марию» — вступай в команду и тащи её в топ</div>`, wire: () => {} };
    }
    const d = await api('/api/clicker/squads').catch(() => null);
    if (!d || !d.squads) return { html: '', wire: () => {} };
    const my = d.mySquad;
    const rows = d.squads.map((s, i) => `<div class="ck-row${s.id === my ? ' me' : ''}"><div class="r">${i < 3 ? ICON.medal(18) : i + 1}</div><div class="n">${s.name} <span style="color:var(--muted);font-size:11px">· ${s.members}</span></div><div class="v">${COIN(13)} ${fmt(s.points)}</div></div>`).join('');
    const chips = SQUADS.map(s => `<button class="ck-cat-chip${s.id === my ? ' on' : ''}" data-squad="${s.id}">${s.name}</button>`).join('');
    return { html: `<div class="ck-sect">Команды</div>${rows}<div style="color:var(--muted);font-size:12px;text-align:center;margin:6px 0 4px">${my ? 'Сменить команду:' : 'Выбери команду:'}</div><div class="ck-cats">${chips}</div>`, wire: () => { ov.querySelectorAll('[data-squad]').forEach(b => b.onclick = () => joinSquadAct(b.dataset.squad)); } };
  }
  async function joinSquadAct(id) {
    const d = await api('/api/clicker/squad', { method: 'POST', body: JSON.stringify({ id }) }).catch(() => null);
    if (d && !d.error) { st = d; sfxBuy(); window.haptic && window.haptic('medium'); renderTop(); } else flashMsg('Не получилось');
  }

  // ── Рефералы + Задания ───────────────────────────────────────────────────────
  const linkOpened = {};
  function refLink() { const code = st && st.refCode; return code ? `https://t.me/${BOT}?startapp=ckref_${code}` : `https://t.me/${BOT}`; }
  function shareRef() {
    const link = refLink();
    const txt = `🐱 Играю в «Котик Комбат» от кондитерской «Мария» — тапай котика и качай уровни! Заходи по ссылке, нам обоим дадут монеты 🪙 ${link}`;
    if (window.App && App.share) App.share(txt); else if (navigator.share) navigator.share({ text: txt }).catch(() => {}); else if (window.App && App.openExternal) App.openExternal(link);
  }
  async function maybeRegisterRef() {
    if (!authed()) return;
    try {
      const sp = (window.App && App.startParam) || '';
      const m = /^ckref_(\d+)$/.exec(sp);
      if (!m) return;
      if (localStorage.getItem('maria_ck_ref_done')) return;
      localStorage.setItem('maria_ck_ref_done', '1');
      const d = await api('/api/clicker/ref', { method: 'POST', body: JSON.stringify({ code: m[1] }) });
      if (d && !d.error) { st = d; if (d.refReward) { dailyPopupRaw(ICON.gift(20) + ' Бонус за приглашение', d.refReward); } }
    } catch (_) {}
  }
  function guestTaskList() {
    const s = guestDerive(); const done = (rawGet().tasksDone) || {};
    return TASKS.map(t => {
      let claim = false;
      if (t.type === 'link') claim = !!linkOpened[t.id];
      else if (t.type === 'level') claim = s.level >= t.target;
      else if (t.type === 'balance') claim = s.totalEarned >= t.target;
      else if (t.type === 'streak') claim = s.dailyStreak >= t.target;
      else if (t.type === 'ref') claim = false;
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
    return ACHIEVEMENTS.map(a => ({ ...a, done: !!done[a.id], claimable: !done[a.id] && condMet(a, ds) }));
  }
  async function renderTasks() {
    const list = ov.querySelector('#ck-taskslist');
    const refCount = (st && st.referrals) || 0;
    const refBlock = `<div class="ck-card" style="background:linear-gradient(90deg,rgba(238,191,82,.18),rgba(238,191,82,.05))">
      <div class="ck-card__ic">${ICON.users(26)}</div><div class="ck-card__b"><div class="ck-card__n">Пригласи друзей</div>
      <div class="ck-card__s">Друзей: ${refCount} · +${fmt(REF_REFERRER)} ${COIN(13)} тебе и +${fmt(REF_INVITEE)} другу</div></div>
      <button class="ck-card__buy" id="ck-invite">Позвать</button></div>`;
    let tasks;
    if (authed()) { const d = await api('/api/clicker/tasks').catch(() => null); tasks = d && d.tasks; }
    else tasks = guestTaskList();
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
    if (authed()) { const d = await api('/api/clicker/achievements').catch(() => null); achs = d && d.achievements; }
    else achs = guestAchList();
    if (!achs) achs = [];
    const achRows = achs.map(a => {
      const btn = a.done ? `<button class="ck-card__buy" disabled style="justify-content:center">✓ Получено</button>`
        : a.claimable ? `<button class="ck-card__buy" data-claim="${a.id}">+${fmt(a.reward)} ${COIN(14)}</button>`
          : `<button class="ck-card__buy" disabled>+${fmt(a.reward)}</button>`;
      return `<div class="ck-card"${a.done ? ' style="opacity:.6"' : ''}><div class="ck-card__ic">${achIcon(a.icon)}</div><div class="ck-card__b"><div class="ck-card__n">${a.name}</div><div class="ck-card__s">${achDesc(a)}</div></div>${btn}</div>`;
    }).join('');
    const promoCard = `<div class="ck-sect">Промокод</div><div class="ck-card ck-bonus"><div style="display:flex;align-items:center;gap:11px"><div class="ck-card__ic">${ICON.gift(26)}</div><div class="ck-card__b"><div class="ck-card__n">Есть промокод?</div><div class="ck-card__s">Лови коды в соцсетях «Марии» → монеты</div></div></div><div style="display:flex;gap:8px"><input class="ck-cipher-in" id="ck-code-in" maxlength="24" placeholder="ВВЕДИ КОД" autocomplete="off" spellcheck="false"/><button class="ck-card__buy" id="ck-code-go" style="justify-content:center">Применить</button></div></div>`;
    list.innerHTML = bonusBlock() + promoCard + '<div class="ck-sect">Друзья</div>' + refBlock + '<div class="ck-sect">Задания</div>' + rows + '<div class="ck-sect">Достижения</div>' + achRows;
    ov.querySelector('#ck-invite').onclick = shareRef;
    list.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { const id = b.dataset.open, link = b.dataset.link; if (link) { if (window.App && App.openExternal) App.openExternal(link); else window.open(link, '_blank'); } linkOpened[id] = true; setTimeout(renderTasks, 400); });
    list.querySelectorAll('[data-claim]').forEach(b => b.onclick = () => claimTask(b.dataset.claim));
    const cg = ov.querySelector('#ck-code-go'), ci = ov.querySelector('#ck-code-in');
    if (cg && ci) { cg.onclick = () => redeemCodeAct(ci.value); ci.onkeydown = (e) => { if (e.key === 'Enter') redeemCodeAct(ci.value); }; }
    wireBonus();
  }
  async function redeemCodeAct(code) {
    if (!code || !code.trim()) return;
    if (!authed()) { flashMsg('Промокоды — при входе через «Марию»'); return; }
    const d = await api('/api/clicker/code', { method: 'POST', body: JSON.stringify({ code }) }).catch(() => null);
    if (d && !d.error && d.reward != null) { st = d; sfxReward(); window.haptic && window.haptic('success'); confettiBurst(); dailyPopupRaw(ICON.gift(20) + ' Промокод принят!', d.reward); renderAll(); renderTasks(); bumpBalance(); }
    else flashMsg(d && d.error === 'used' ? 'Код уже использован' : d && d.error === 'invalid' ? 'Неверный код' : 'Не получилось');
  }
  function achDesc(a) { const m = { taps: `${fmt(a.target)} тапов`, balance: `Накопить ${fmt(a.target)}`, level: `Уровень ${a.target}`, cards: `Все ${a.target} бизнеса`, streak: `${a.target} дней подряд`, ref: `${a.target} друга` }; return m[a.type] || ''; }
  function bonusBlock() {
    const cmb = (st && st.combo) || { cards: [], hits: [], complete: false, claimed: false, reward: COMBO_REWARD };
    const cph = (st && st.cipher) || { morse: '', len: 0, claimed: false, reward: CIPHER_REWARD };
    const slots = cmb.cards.map(id => `<div class="ck-cmb ${cmb.hits.includes(id) ? 'on' : ''}">${cardIcon(id)}<span>${cardName(id)}</span></div>`).join('');
    const comboBtn = cmb.claimed
      ? `<button class="ck-card__buy" disabled style="width:100%;justify-content:center">✓ Забрано сегодня</button>`
      : cmb.complete
        ? `<button class="ck-card__buy" id="ck-combo-claim" style="width:100%;justify-content:center">Забрать +${fmt(cmb.reward)} ${COIN(14)}</button>`
        : `<button class="ck-card__buy" disabled style="width:100%;justify-content:center">Собрано ${cmb.hits.length}/3 — прокачай их в «Прокачке»</button>`;
    const comboCard = `<div class="ck-card ck-bonus">
      <div style="display:flex;align-items:center;gap:11px"><div class="ck-card__ic">${ICON.star(26)}</div><div class="ck-card__b"><div class="ck-card__n">Комбо дня</div><div class="ck-card__s">Прокачай эти 3 бизнеса сегодня · +${fmt(cmb.reward)} ${COIN(13)}</div></div></div>
      <div class="ck-combo3">${slots}</div>${comboBtn}</div>`;
    const cipherCard = `<div class="ck-card ck-bonus">
      <div style="display:flex;align-items:center;gap:11px"><div class="ck-card__ic">${ICON.bolt(26)}</div><div class="ck-card__b"><div class="ck-card__n">Шифр дня</div><div class="ck-card__s">Расшифруй морзе и впиши слово · +${fmt(cph.reward)} ${COIN(13)}</div></div></div>
      ${cph.claimed
        ? `<button class="ck-card__buy" disabled style="width:100%;justify-content:center">✓ Разгадан сегодня</button>`
        : `<div class="ck-morse">${cph.morse}</div><div style="display:flex;gap:8px"><input class="ck-cipher-in" id="ck-cipher-in" maxlength="14" placeholder="${cph.len} букв" autocomplete="off" spellcheck="false"/><button class="ck-card__buy" id="ck-cipher-go" style="justify-content:center">Разгадать</button></div>`}</div>`;
    const chestAvail = !st || st.chestAvailable;
    const chestCard = `<div class="ck-card ck-bonus" style="background:linear-gradient(90deg,rgba(238,191,82,.16),rgba(238,191,82,.04))">
      <div style="display:flex;align-items:center;gap:11px"><div class="ck-card__ic">${ICON.chest(26)}</div><div class="ck-card__b"><div class="ck-card__n">Сундук удачи</div><div class="ck-card__s">${chestAvail ? 'Монеты, турбо или джекпот!' : 'Возвращайся завтра за новым'}</div></div>
      ${chestAvail ? `<button class="ck-card__buy" id="ck-chest-open">Открыть</button>` : `<button class="ck-card__buy" disabled>✓ Открыт</button>`}</div>`;
    const rainAvail = !st || st.rainAvailable;
    const rainCard = `<div class="ck-card ck-bonus">
      <div style="display:flex;align-items:center;gap:11px"><div class="ck-card__ic">${ICON.rain(26)}</div><div class="ck-card__b"><div class="ck-card__n">Золотой дождь</div><div class="ck-card__s">${rainAvail ? 'Лови монеты 20 секунд → бонус' : 'Сыграно — приходи завтра'}</div></div>
      ${rainAvail ? `<button class="ck-card__buy" id="ck-rain-play">Играть</button>` : `<button class="ck-card__buy" disabled>✓ Сыграно</button>`}</div>`;
    return '<div class="ck-sect">Бонусы дня</div>' + chestCard + rainCard + comboCard + cipherCard;
  }
  function wireBonus() {
    const cb = ov.querySelector('#ck-combo-claim'); if (cb) cb.onclick = claimCombo;
    const ch = ov.querySelector('#ck-chest-open'); if (ch) ch.onclick = openChestAct;
    const rp = ov.querySelector('#ck-rain-play'); if (rp) rp.onclick = openRain;
    const go = ov.querySelector('#ck-cipher-go'), inp = ov.querySelector('#ck-cipher-in');
    if (go && inp) { go.onclick = () => claimCipher(inp.value); inp.onkeydown = (e) => { if (e.key === 'Enter') claimCipher(inp.value); }; }
  }
  async function claimTask(id) {
    let reward = 0;
    if (authed()) { const d = await api('/api/clicker/task', { method: 'POST', body: JSON.stringify({ id }) }).catch(() => null); if (d && !d.error) { st = d; reward = d.reward; } }
    else { reward = guestClaimTask(id); if (reward) st = guestDerive(); }
    if (reward) { sfxReward(); window.haptic && window.haptic('success'); dailyPopupRaw('✅ Задание выполнено', reward); renderAll(); renderTasks(); bumpBalance(); }
    else flashMsg('Пока недоступно');
  }
  function dailyPopupRaw(title, amount) { const pop = ov.querySelector('#ck-pop'); pop.innerHTML = `<h3>${title}</h3><div class="v">+${fmt(amount)} ${COIN(26)}</div><button id="ck-pop-ok">Класс!</button>`; pop.classList.add('on'); pop.querySelector('#ck-pop-ok').onclick = () => pop.classList.remove('on'); }

  function dailyCalHtml() {
    const streak = (st && st.dailyStreak) || 0, avail = !st || st.dailyAvailable, todayDay = avail ? streak + 1 : 0;
    let h = '<div class="ck-cal">';
    for (let i = 1; i <= 7; i++) { const done = i <= streak; const today = i === todayDay; h += `<div class="ck-cal-day ${done ? 'done' : ''} ${today ? 'today' : ''}"><div class="d">${done ? '✓' : i}</div><div class="a">${fmt(dailyReward(i))}</div></div>`; }
    return h + '</div>';
  }
  function dailyBtn() { if (st && st.dailyAvailable) claimDaily(); else openDailyView(); }
  function openDailyView() { const pop = ov.querySelector('#ck-pop'); pop.innerHTML = `<h3>${ICON.gift(20)} Награда дня</h3>${dailyCalHtml()}<div style="color:var(--muted);font-size:13px">Заходи каждый день — приз растёт. Пропустишь — стрик сгорит!</div><button id="ck-pop-ok">Закрыть</button>`; pop.classList.add('on'); pop.querySelector('#ck-pop-ok').onclick = () => pop.classList.remove('on'); }
  function dailyPopup(amount, streak) { const pop = ov.querySelector('#ck-pop'); pop.innerHTML = `<h3>${ICON.gift(20)} День ${streak} — награда!</h3><div class="v">+${fmt(amount)} ${COIN(26)}</div>${dailyCalHtml()}<div style="color:var(--muted);font-size:13px">Заходи каждый день — приз растёт!</div><button id="ck-pop-ok">Ура!</button>`; pop.classList.add('on'); pop.querySelector('#ck-pop-ok').onclick = () => pop.classList.remove('on'); }
  function passivePopup(amount) { if (!amount || amount <= 0) return; const pop = ov.querySelector('#ck-pop'); pop.innerHTML = `<h3>Пока тебя не было</h3><div class="v">+${fmt(amount)} ${COIN(26)}</div><div style="color:var(--muted);font-size:13px">Котик работал за тебя!</div><button id="ck-pop-ok">Забрать</button>`; pop.classList.add('on'); pop.querySelector('#ck-pop-ok').onclick = () => pop.classList.remove('on'); }

  function loop(ts) {
    if (!ov || !ov.classList.contains('on')) return;
    const dt = lastTs ? (ts - lastTs) / 1000 : 0; lastTs = ts;
    if (st) {
      if (st.energy < st.energyMax) st.energy = Math.min(st.energyMax, st.energy + REGEN * dt);
      if (st.profitPerHour > 0) { const inc = st.profitPerHour / 3600 * dt; st.balance += inc; st.totalEarned += inc; }
      if (combo && performance.now() - comboT > 700) { combo = 0; ov.querySelector('#ck-combo').classList.remove('show'); }
      syncT += dt; if (syncT > 1.6) { syncT = 0; flush(); }
      if (tab === 'cat') renderAll();
    }
    raf = requestAnimationFrame(loop);
  }

  async function open() {
    if (!ov) build();
    ov.classList.add('on'); window.scrollLock && window.scrollLock(); ac();
    await load(); await maybeRegisterRef(); curLevel = leagueFor(st.totalEarned).level;
    ov.querySelector('#ck-cat').src = A(leagueFor(st.totalEarned).cat || 'idle.png');
    setTab('cat'); renderAll(); spawnSparks(); applySeason(); scheduleBonus();
    if (st.passiveEarned > 0) passivePopup(st.passiveEarned);
    lastTs = 0; syncT = 0; combo = 0; cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
  }
  function close() { cancelAnimationFrame(raf); clearTimeout(bonusTimer); if (rainState) endRain(true); flush(); if (ov) ov.classList.remove('on'); window.scrollUnlock && window.scrollUnlock(); }
  window.catClickOpen = open; window.catClickClose = close; window.catClickBonusNow = () => { if (ov && ov.classList.contains('on')) showFlyingBonus(); }; // превью/тест золотого бонуса
  window.addEventListener('resize', () => { if (ov && ov.classList.contains('on') && st) applyCostume(leagueFor(st.totalEarned)); });
})();

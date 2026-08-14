/* ── «Коллекция голубей» — альбом/сеты/звёзды/витрина ─────────────────────────
 * Сегмент «Коллекция» вкладки dove в catclick.js (сегмент «Помощники» — карточки
 * бизнесов, это отдельная существующая механика, catdove.js её не трогает).
 * Каталог пород — зеркало src/pigeons.ts::PIGEON_BREEDS/PIGEON_SETS/starTarget —
 * менять синхронно с сервером.
 * API: window.CatDove = { mount(container, api), refreshBadge() }.
 * mount вызывается catclick.js один раз при первом открытии сегмента «Коллекция»;
 * api — fetch-хелпер catclick (тот же initData-заголовок), передан аргументом
 * (и продублирован в window.ckApi catclick.js — на случай отдельного вызова).
 * Тосты об ошибках — через window.ckFlash (catclick.js::flashMsg), если нет —
 * молча (не должно случиться, catdove.js всегда грузится вместе с catclick.js).
 * ───────────────────────────────────────────────────────────────────────────── */
(function () {
  // 4 сета × 4 — зеркало src/pigeons.ts::PIGEON_BREEDS
  const BREEDS = [
    { id: "sizar",    name: "Сизарь",             set: "city",  rarity: "common" },
    { id: "belobok",  name: "Белобокий",          set: "city",  rarity: "common" },
    { id: "ryaboy",   name: "Рябой",              set: "city",  rarity: "common" },
    { id: "chubaty",  name: "Чубатый",            set: "city",  rarity: "common" },
    { id: "vanil",    name: "Ванильный",          set: "sweet", rarity: "rare" },
    { id: "shoko",    name: "Шоколадный",         set: "sweet", rarity: "rare" },
    { id: "karamel",  name: "Карамельный",        set: "sweet", rarity: "rare" },
    { id: "yagodny",  name: "Ягодный",            set: "sweet", rarity: "rare" },
    { id: "pochtar",  name: "Иркутский почтарь",  set: "post",  rarity: "epic" },
    { id: "baikal",   name: "Байкальский гонец",  set: "post",  rarity: "epic" },
    { id: "kurier",   name: "Ночной курьер",      set: "post",  rarity: "epic" },
    { id: "vozhak",   name: "Вожак стаи",         set: "post",  rarity: "epic" },
    { id: "svadebny", name: "Свадебный",          set: "fest",  rarity: "epic" },
    { id: "imeninny", name: "Именинный",          set: "fest",  rarity: "epic" },
    { id: "snezhny",  name: "Снежный",            set: "fest",  rarity: "epic" },
    { id: "zolotoy",  name: "Золотой голубь Василия", set: "fest", rarity: "legendary" },
  ];
  const BY_ID = new Map(BREEDS.map(b => [b.id, b]));
  const SETS = [
    { id: "city",  name: "Городские",        reward: 25000 },
    { id: "sweet", name: "Кондитерские",     reward: 50000 },
    { id: "post",  name: "Почтовые легенды", reward: 75000 },
    { id: "fest",  name: "Праздничные",      reward: 100000 },
  ];
  // Звёзды: сколько дублей скормить до следующей. ★1→★2 = 3, ★2→★3 = 5, ★3 = кап. Зеркало src/pigeons.ts::starTarget
  const starTarget = (stars) => stars === 1 ? 3 : stars === 2 ? 5 : null;
  const MAX_SHOWCASE = 3;
  const DUEL_STAKES = [0, 500, 2000, 10000];
  // Стикер-фразы Василия — зеркало src/pigeons.ts::STICKERS (id = индекс, менять синхронно).
  const STICKERS = [
    "Держи, пригодится!", "Сладкого дня!", "От Василия с любовью 🐾", "Такой красавец искал тебя!",
    "За вкусную неделю!", "Пусть воркует у тебя!", "Обменяемся ещё!", "Ты в отличной стае!",
    "Спасибо за игру!", "Гур-гур! (это комплимент)",
  ];
  // Имена, приходящие с сервера (fromName в TradeRow/MailRow, name в recipients) —
  // сырой first_name/username живого пользователя, потенциально с HTML-спецсимволами.
  // ВСЕГДА через esc() при вставке в innerHTML — своих данных (BREEDS/STICKERS) esc не нужен.
  const esc = (s) => (window.escapeHtml ? window.escapeHtml(s) : String(s == null ? '' : s));

  const fmt = (n) => { n = Number(n) || 0; return Math.round(n).toLocaleString('ru-RU'); };
  const num = (n) => { n = Number(n); return Number.isFinite(n) ? n : 0; };
  const plu = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return (a > 10 && a < 20) ? many : (b > 1 && b < 5) ? few : (b === 1) ? one : many; };

  function svg(inner, s) { return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`; }
  // Плейсхолдер до готового арта: тот же силуэт голубя, что ICON.dove в catclick — своя
  // копия тут, catdove.js работает как отдельный модуль без чтения приватных функций catclick.
  const DOVE_ICON = (s) => svg('<path d="M21 7c-1.2.8-2.2.9-3 .4-1.6-1-4-.6-5.5 1.2C11 10.4 8.6 11.4 5 11.4c1.3 1.8 3.6 2.7 6 2.2-.9 2.2-2.7 3.6-5 4 2.3 1.4 5.5 1.4 8-.6 2-1.6 3-4 3-6.6 0-.9.4-1.7 1.2-2.2M8.5 18 7 21M12.5 17.5 12 21"/>', s || 26);
  const COIN_ICON = (s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><use href="#ckSymCoin"/></svg>`;
  const SWAP_ICON = (s) => svg('<path d="M4 7h13m0 0-3.5-3.5M17 7l-3.5 3.5M20 17H7m0 0 3.5-3.5M7 17l3.5 3.5"/>', s || 16);
  const MAILBOX_ICON = (s) => svg('<path d="M4 6.5 12 12l8-5.5"/><rect x="4" y="6.5" width="16" height="11" rx="2"/>', s || 16);
  const USERS_ICON = (s) => svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>', s || 16);
  const GEAR_ICON = (s) => svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>', s || 16);
  const FLAG_ICON = (s) => svg('<path d="M5 21V4m0 1h12l-2.5 3.5L17 12H5"/>', s || 14);
  const NEST_ICON = (s) => svg('<path d="M4 11 12 5l8 6"/><path d="M6 10v9h12v-9"/><circle cx="12" cy="14.2" r="2.2"/>', s || 15);

  function authed() { return !!(window.App && App.isAuthed && App.isAuthed()); }
  const PURE = () => document.documentElement.classList.contains('ck-pure');
  function flash(msg) { if (window.ckFlash) window.ckFlash(msg); }
  function haptic(k) { window.haptic && window.haptic(k); }

  let container = null, apiRef = null, data = null, busy = false, missionTimer = null, mountReady = null;
  // ── доп. состояние: гонка (грузится вместе с альбомом), обмены/рецепиенты
  // (лениво, при первом открытии соответствующей страницы), мастера создания
  // предложения/письма (шаг за шагом переиспользуют #cd-sheet). needsRerenderOnClose —
  // отложенный полный render() после закрытия шита: страница «Обмены» позволяет
  // сделать несколько действий подряд, не закрываясь на каждой — render() пересобирает
  // #cd-scrim/#cd-sheet и убил бы открытый шит, поэтому откладываем его до closeSheet().
  let race = null, recipients = null, tradesCache = null, tradesTab = 'toMe', mailCache = null;
  // Бейдж входящих обменов на кнопке «Обмены» + флаг «создаю обмен с доски» (для нумерации шагов).
  let incomingTrades = 0, tradesBadgeInit = false, tradeFromBoard = false;
  let tcState = null, msState = null, needsRerenderOnClose = false, tradeTargetFriend = null;

  // ── стили (свой блок, не трогаем catclick-css — переменные --gold-*/--muted/--panel/
  // --line/--ink/--cream каскадируются от .ck-ov, наш контейнер лежит внутри него) ──
  function styles() {
    if (document.getElementById('catdove-css')) return;
    const s = document.createElement('style'); s.id = 'catdove-css';
    s.textContent = `
      .cd-root{padding:2px 2px 4px}
      .cd-summary{text-align:center;color:var(--muted);font-size:13px;margin:0 0 12px;line-height:1.5}
      .cd-hint{display:flex;align-items:center;gap:10px;background:linear-gradient(180deg,rgba(192,255,51,.15),rgba(192,255,51,.05));border:1px solid rgba(192,255,51,.38);border-radius:14px;padding:10px 12px;margin:0 0 12px}
      .cd-hint__b{flex:1;min-width:0}
      .cd-hint__tag{display:inline-block;font-size:9px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:var(--gold-l);opacity:.9;margin-bottom:2px}
      .cd-hint__t{font-size:12.5px;font-weight:700;color:var(--ink);line-height:1.35}
      .cd-hint__cta{flex:none;background:linear-gradient(180deg,#D4FF6A,#A8F51E 56%,#8DBF20);color:#12210A;border:none;border-radius:11px;padding:9px 13px;font-weight:800;font-size:12px;cursor:pointer;min-height:38px}
      .cd-hint__cta:active{transform:scale(.96)}
      .cd-racenote{font-size:11px;color:var(--muted);line-height:1.45;margin:3px 4px 11px;text-align:center}
      .cd-racenote b{color:var(--ink)}
      .cd-summary b{color:var(--gold-l)}
      .cd-sect-t{color:var(--muted);font-weight:700;font-size:11px;margin:4px 4px 7px;text-transform:uppercase;letter-spacing:.7px}
      /* ── Гонка стаи: закатный hero (слои драг-трассы), дивизион-чипы, медали ── */
      .cd-racehero{position:relative;border:1px solid var(--line);border-radius:16px;overflow:hidden;margin-bottom:12px;background:linear-gradient(180deg,#1B1526,#120D1C)}
      .cd-racehero__bg{position:absolute;inset:0;background:url(/img/drag/sky.webp) top/cover no-repeat}
      .cd-racehero__bg::after{content:'';position:absolute;left:0;right:0;bottom:0;height:64%;background:url(/img/drag/city.webp) bottom left/auto 100% repeat-x}
      .cd-racehero__scrim{position:absolute;inset:0;background:radial-gradient(120% 85% at 82% 8%,rgba(255,46,126,.28),transparent 55%),linear-gradient(180deg,rgba(27,15,38,.40),rgba(11,8,20,.80) 82%)}
      .cd-racehero__in{position:relative;display:flex;align-items:center;gap:10px;padding:12px 12px 2px;min-height:72px}
      .cd-racehero__b{flex:1;min-width:0}
      .cd-racehero__t{font-weight:800;font-size:15.5px;color:var(--gold-l);text-shadow:0 2px 8px rgba(0,0,0,.75)}
      .cd-racehero__s{font-size:11.5px;color:var(--cream);opacity:.9;margin-top:2px;text-shadow:0 1px 6px rgba(0,0,0,.75)}
      .cd-racehero__art{width:76px;height:76px;flex:none;filter:drop-shadow(0 3px 10px rgba(0,0,0,.5)) drop-shadow(0 0 10px rgba(192,255,51,.45))}
      .cd-racehero__art img{width:100%;height:100%;object-fit:contain}
      .cd-racehero__acts{position:relative;display:flex;gap:8px;padding:10px 12px 12px}
      .cd-ctabtn{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid #DFFF8F;border-radius:12px;padding:10px 8px;font-weight:800;font-size:12.5px;background:linear-gradient(180deg,#D4FF6A,#A8F51E 56%,#8DBF20);color:#12210A;cursor:pointer}
      .cd-ctabtn--ghost{background:rgba(0,0,0,.42);color:var(--cream);border-color:var(--line)}
      .cd-divchip{display:inline-flex;align-items:center;border-radius:9px;padding:2.5px 9px;font-size:10.5px;font-weight:900;letter-spacing:.3px;margin-top:6px}
      .cd-divchip--gold{background:linear-gradient(180deg,#D4FF6A,#A8F51E);color:#16210A}
      .cd-divchip--silver{background:linear-gradient(180deg,#d9dade,#a7abb5);color:#33363d}
      .cd-divchip--bronze{background:linear-gradient(180deg,#A8F51E,#C0FF33);color:#16210A}
      .cd-divhead{display:flex;align-items:center;gap:8px;margin:12px 2px 7px}
      .cd-divhead .cd-divchip{margin-top:0}
      .cd-divhead__line{flex:1;height:1px;background:var(--line)}
      /* Строка-тизер «Итоги прошлой недели» — полные таблицы дивизионов живут в шите */
      .cd-resultsrow{display:flex;align-items:center;gap:9px;width:100%;box-sizing:border-box;background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:10px 12px;margin-bottom:12px;color:var(--ink);font-weight:700;font-size:12.5px;cursor:pointer;text-align:left}
      .cd-resultsrow:active{transform:scale(.98)}
      .cd-resultsrow__medal{width:22px;height:22px;flex:none;border-radius:50%;background:linear-gradient(180deg,#D4FF6A,#A8F51E);display:flex;align-items:center;justify-content:center;color:#16210A;font-size:11px;font-weight:900}
      .cd-resultsrow__s{flex:1;min-width:0}
      .cd-resultsrow__sub{display:block;font-weight:500;font-size:10.5px;color:var(--muted);margin-top:1px}
      .cd-resultsrow__chev{flex:none;color:var(--muted)}
      /* Заголовок сета над своей четвёркой карточек: имя + прогресс + награда/клейм */
      .cd-sethead{display:flex;align-items:center;gap:8px;margin:2px 2px 7px;min-height:38px}
      .cd-sethead__n{flex:1;min-width:0;display:flex;align-items:baseline;gap:7px}
      .cd-sethead__n b{font-weight:800;font-size:13.5px;color:var(--ink)}
      .cd-sethead__p{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}
      .cd-sethead__p.full{color:#9be7a8}
      .cd-sethead__prize{flex:none;display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:var(--muted)}
      .cd-racerow{display:flex;align-items:center;gap:9px;background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:8px 11px;margin-bottom:6px}
      .cd-racerow--top{border-color:rgba(192,255,51,.5);background:linear-gradient(90deg,rgba(255,231,166,.10),rgba(192,255,51,.03))}
      .cd-racerow--top.cd-racerow--silver{border-color:rgba(199,203,212,.5);background:linear-gradient(90deg,rgba(217,218,222,.10),rgba(167,171,181,.03))}
      .cd-racerow--top.cd-racerow--bronze{border-color:rgba(217,162,106,.5);background:linear-gradient(90deg,rgba(217,162,106,.10),rgba(184,129,63,.03))}
      .cd-medal{width:22px;height:22px;flex:none;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;box-shadow:inset 0 -1px 2px rgba(0,0,0,.25)}
      .cd-medal--gold{background:linear-gradient(180deg,#D4FF6A,#A8F51E);color:#16210A}
      .cd-medal--silver{background:linear-gradient(180deg,#d9dade,#a7abb5);color:#33363d}
      .cd-medal--bronze{background:linear-gradient(180deg,#A8F51E,#C0FF33);color:#16210A}
      .cd-medal--dim{background:rgba(255,255,255,.08);color:var(--muted);box-shadow:none}
      .cd-racerow__art{width:34px;height:34px;flex:none;border-radius:9px;background:radial-gradient(circle at 50% 35%,rgba(192,255,51,.16),transparent 78%);display:flex;align-items:center;justify-content:center}
      .cd-racerow__art img{width:92%;height:92%;object-fit:contain}
      .cd-racerow__b{flex:1;min-width:0}
      .cd-racerow__n{font-size:12px;font-weight:700;color:var(--ink)}
      .cd-racerow__s{font-size:10.5px;color:var(--muted);margin-top:1px}
      .cd-racerow__prize{font-size:11.5px;color:var(--gold-l);font-weight:800;flex:none;display:flex;align-items:center;gap:3px}
      .cd-divbar{position:relative;height:8px;border-radius:4px;background:rgba(255,255,255,.1);margin:8px 0 4px;overflow:hidden}
      .cd-divbar i{position:absolute;left:0;top:0;bottom:0;border-radius:4px;background:linear-gradient(90deg,#C0FF33,#a7abb5 45%,#C0FF33);}
      .cd-divbar b{position:absolute;top:-1px;bottom:-1px;width:2px;background:rgba(20,12,9,.85)}
      .cd-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:14px}
      .cd-card{position:relative;background:var(--panel);border:2px solid var(--line);border-radius:13px;padding:6px 4px 8px;text-align:center;cursor:pointer;opacity:0;animation:cdIn .3s ease-out forwards;box-sizing:border-box}
      .cd-card:not(.cd-locked):active{transform:scale(.96)}
      @keyframes cdIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
      .cd-card[data-r="common"]{border-color:rgba(141,146,156,.55)}
      .cd-card[data-r="rare"]{border-color:#C0FF33}
      .cd-card[data-r="epic"]{border-color:#9B5CFF}
      .cd-card[data-r="legendary"]{border-color:#FF2E7E;box-shadow:0 0 12px rgba(255,46,126,.45)}
      .cd-card.cd-locked{cursor:pointer}
      .cd-card.cd-locked:active{transform:scale(.96)}
      /* Шит закрытой породы: приглушённый силуэт + чипы характеристик */
      .cd-lk-art{width:96px;height:96px;margin:2px auto 10px;border-radius:14px;background:linear-gradient(160deg,rgba(192,255,51,.10),rgba(192,255,51,.02));display:flex;align-items:center;justify-content:center;overflow:hidden}
      .cd-lk-art img{width:84%;height:84%;object-fit:contain;filter:brightness(0);opacity:.28}
      .cd-lk-rows{display:flex;flex-direction:column;gap:7px;margin-bottom:12px}
      .cd-lk-row{display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:9px 12px}
      .cd-lk-row b{font-size:12px;color:var(--muted);font-weight:700}
      .cd-lk-row span{font-size:12.5px;color:var(--ink);font-weight:700;text-align:right}
      .cd-rarity{display:inline-flex;border-radius:9px;padding:2.5px 9px;font-size:10.5px;font-weight:900;letter-spacing:.3px}
      .cd-rarity--common{background:rgba(141,146,156,.25);color:#c6cad2}
      .cd-rarity--rare{background:rgba(192,255,51,.20);color:#C0FF33}
      .cd-rarity--epic{background:rgba(155,92,255,.28);color:#B79BFF}
      .cd-rarity--legendary{background:linear-gradient(180deg,#FF7FB0,#FF2E7E);color:#2A0512}
      .cd-art{position:relative;width:100%;aspect-ratio:1;border-radius:10px;margin:0 auto 6px;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,rgba(192,255,51,.14),rgba(192,255,51,.03));overflow:hidden}
      .cd-art img{width:82%;height:82%;object-fit:contain;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
      .cd-art svg{width:50%;height:50%;color:var(--gold-l)}
      .cd-card.cd-locked .cd-art img,.cd-card.cd-locked .cd-art svg{filter:brightness(0);opacity:.15}
      .cd-cnt{position:absolute;top:4px;right:5px;font-size:9.5px;font-weight:800;color:var(--gold-l);background:rgba(0,0,0,.42);border-radius:8px;padding:1px 5px;z-index:2}
      .cd-n{font-weight:700;font-size:10px;color:var(--ink);line-height:1.2;min-height:2.3em;display:flex;align-items:center;justify-content:center}
      .cd-card.cd-locked .cd-n{color:var(--muted)}
      .cd-stars{font-size:9.5px;color:var(--gold);letter-spacing:1px;margin-top:1px}
      .cd-stars .off{color:rgba(255,255,255,.16)}
      .cd-week{position:absolute;top:-6px;left:-6px;background:linear-gradient(90deg,#D4FF6A,#C0FF33);color:#12210A;font-size:7.5px;font-weight:900;padding:3px 5px;border-radius:7px;box-shadow:0 2px 6px rgba(0,0,0,.3);z-index:3;white-space:nowrap}
      .cd-showtag{position:absolute;bottom:-4px;left:50%;transform:translateX(-50%);background:rgba(192,255,51,.92);color:#16210A;font-size:8px;font-weight:900;border-radius:6px;padding:1px 5px;z-index:2;white-space:nowrap}
      .cd-champ{display:flex;align-items:center;gap:12px;background:linear-gradient(90deg,rgba(255,231,166,.14),rgba(192,255,51,.04));border:2px solid var(--gold);border-radius:16px;padding:11px 12px;margin-bottom:16px;box-shadow:0 3px 12px rgba(192,255,51,.18);cursor:pointer}
      .cd-champ:active{transform:scale(.98)}
      .cd-champ__art{width:56px;height:56px;flex:none;border-radius:13px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.22)}
      .cd-champ__art img{width:88%;height:88%;object-fit:contain}
      .cd-champ__art svg{width:60%;height:60%;color:var(--gold-l)}
      .cd-champ__b{flex:1;min-width:0}
      .cd-champ__n{font-weight:800;font-size:15px;color:var(--gold-l)}
      .cd-champ__s{font-size:12px;color:var(--muted);margin-top:2px}
      .cd-setrow{display:flex;align-items:center;gap:10px;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px 12px;margin-bottom:8px}
      .cd-setrow__n{flex:1;min-width:0}
      .cd-setrow__n b{font-weight:700;font-size:13.5px;color:var(--ink);display:block}
      .cd-setrow__p{font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums;margin-top:2px}
      .cd-setrow__done{flex:none;font-size:11.5px;font-weight:800;color:#9be7a8;white-space:nowrap}
      .cd-claimbtn{flex:none;display:inline-flex;align-items:center;gap:5px;border:1px solid #DFFF8F;border-radius:12px;padding:9px 13px;font-weight:800;font-size:12px;background:linear-gradient(180deg,#D4FF6A,#A8F51E 56%,#8DBF20);color:#12210A;cursor:pointer;white-space:nowrap;min-height:38px}
      .cd-claimbtn:disabled{opacity:.6;cursor:default}
      .cd-scrim{position:fixed;inset:0;z-index:9400;background:rgba(10,6,5,.5);display:none}
      .cd-scrim.on{display:block}
      .cd-sheet{position:fixed;left:0;right:0;bottom:0;z-index:9401;background:linear-gradient(180deg,#1B1526,#120D1C);border-radius:20px 20px 0 0;padding:18px 18px calc(18px + env(safe-area-inset-bottom,0px));box-shadow:0 -14px 44px rgba(0,0,0,.5);transform:translateY(100%);transition:transform .22s ease-out}
      .cd-sheet.on{transform:translateY(0)}
      .cd-sheet__hd{display:flex;align-items:center;justify-content:flex-start;gap:11px;margin-bottom:2px}
      .cd-sheet__t{font-family:'Nunito',sans-serif;font-weight:800;font-size:17px;color:var(--cream)}
      .cd-sheet__back{flex:none;display:inline-flex;align-items:center;gap:3px;font-family:'Nunito',sans-serif;font-weight:800;font-size:12px;color:var(--grape-l,#B79BFF);background:var(--panel);border:1px solid rgba(155,92,255,.42);border-radius:11px;padding:7px 11px;cursor:pointer}
      .cd-sheet__back:active{transform:scale(.95);filter:brightness(1.1)}
      .cd-sheet__x{width:30px;height:30px;flex:none;border:1px solid var(--line);border-radius:50%;background:rgba(0,0,0,.28);color:var(--cream);font-size:15px;cursor:pointer}
      .cd-sheet__stars{font-size:17px;color:var(--gold);letter-spacing:3px;margin:8px 0 14px}
      .cd-sheet__act{width:100%;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:7px;border:1px solid #DFFF8F;border-radius:14px;padding:13px;font-weight:800;font-size:14px;background:linear-gradient(180deg,#D4FF6A,#A8F51E 56%,#8DBF20);color:#12210A;cursor:pointer;margin-bottom:10px;min-height:44px}
      .cd-sheet__act:disabled{background:rgba(255,255,255,.07);color:var(--muted);border-color:transparent;cursor:default}
      .cd-sheet__act--on{background:linear-gradient(180deg,#9be7a8,#48bb78);color:#0b2e17;border-color:#9be7a8}
      .cd-sheet__hint{font-size:11.5px;color:var(--muted);text-align:center;margin:-4px 0 10px}
      .cd-pop-scrim{position:fixed;inset:0;z-index:9500;background:rgba(10,6,5,.55);display:none;align-items:center;justify-content:center}
      .cd-pop-scrim.on{display:flex}
      .cd-pop{background:linear-gradient(180deg,#1B1526,#120D1C);border:1px solid var(--line);border-radius:20px;padding:24px;text-align:center;box-shadow:0 18px 50px rgba(0,0,0,.6);max-width:82%}
      .cd-pop h3{margin:0 0 6px;font-family:'Nunito',sans-serif;font-weight:700;font-size:19px;color:var(--cream)}
      .cd-pop .v{font-family:'Nunito',sans-serif;font-size:30px;font-weight:700;color:var(--gold-l);margin:10px 0;display:inline-flex;align-items:center;gap:8px}
      .cd-pop button{margin-top:8px;border:1px solid #DFFF8F;border-radius:14px;padding:12px 26px;font-weight:800;background:linear-gradient(180deg,#D4FF6A,#A8F51E 56%,#8DBF20);color:#12210A;cursor:pointer}
      .cd-empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:30px 18px;color:var(--muted)}
      .cd-empty__ic{width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(192,255,51,.08);border:1px solid var(--line);color:var(--gold);margin-bottom:12px}
      .cd-empty__t{font-weight:800;font-size:15px;color:var(--cream);margin-bottom:4px}
      .cd-empty__s{font-size:12.5px;line-height:1.5;max-width:240px}
      .cd-skrow{display:flex;align-items:center;gap:10px;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px 12px;margin-bottom:7px}
      .cd-sk{position:relative;overflow:hidden;background:rgba(255,255,255,.05);border-radius:8px}
      .cd-sk::after{content:'';position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,rgba(255,255,255,.10),transparent);animation:cdShim 1.2s ease-in-out infinite}
      @keyframes cdShim{100%{transform:translateX(100%)}}
      .cd-sheet{max-height:82vh;overflow-y:auto}
      .cd-navrow{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}
      .cd-navbtn{position:relative;flex:1;display:flex;align-items:center;justify-content:center;gap:6px;background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:10px 8px;font-weight:700;font-size:12.5px;color:var(--ink);cursor:pointer;min-height:40px}
      .cd-navbtn:active{transform:scale(.97)}
      /* Покупка закрытой породы: рамка карточки — цвет редкости, как в альбоме */
      .cd-shopbal{font-size:12.5px;color:var(--muted);margin:2px 2px 9px;display:flex;align-items:center;gap:5px}
      .cd-shopbal b{color:var(--cream)}
      .cd-shoprow{display:flex;align-items:center;gap:11px;background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:8px 10px;margin-bottom:7px}
      .cd-shoprow[data-r="common"]{border-color:rgba(141,146,156,.42)}
      .cd-shoprow[data-r="rare"]{border-color:rgba(192,255,51,.5)}
      .cd-shoprow[data-r="epic"]{border-color:rgba(155,92,255,.5)}
      .cd-shoprow[data-r="legendary"]{border-color:rgba(255,46,126,.55)}
      .cd-shoprow__art{width:44px;height:44px;flex:none;border-radius:9px;overflow:hidden;background:rgba(255,255,255,.04);display:flex;align-items:center;justify-content:center}
      .cd-shoprow__art img{width:100%;height:100%;object-fit:contain}
      .cd-shoprow__b{flex:1;min-width:0}.cd-shoprow__b b{display:block;font-size:13px;font-weight:800;color:var(--cream)}.cd-shoprow__b i{font-style:normal;font-size:10.5px;color:var(--muted)}
      .cd-shoprow__buy{flex:none;display:inline-flex;align-items:center;gap:4px;border:1px solid #DFFF8F;border-radius:11px;padding:8px 11px;font-weight:800;font-size:12px;background:linear-gradient(180deg,#D4FF6A,#A8F51E 56%,#8DBF20);color:#12210A;cursor:pointer;font-variant-numeric:tabular-nums;white-space:nowrap}
      .cd-shoprow__buy:active{transform:scale(.96)}
      .cd-shoprow__buy:disabled{background:rgba(255,255,255,.06);color:var(--muted);border-color:transparent;cursor:default}
      .cd-navbadge{position:absolute;top:-6px;right:6px;min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:#e5484d;color:#fff;font-size:9.5px;font-weight:800;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.35)}
      .cd-subtabs{display:flex;gap:6px;margin-bottom:12px;background:rgba(0,0,0,.22);border-radius:12px;padding:3px}
      .cd-subtab{flex:1;text-align:center;padding:8px 4px;border-radius:10px;font-weight:700;font-size:11.5px;color:var(--muted);cursor:pointer;background:transparent;border:none}
      .cd-subtab.on{background:var(--panel);color:var(--gold-l)}
      .cd-subcount{display:inline-flex;min-width:15px;height:15px;padding:0 4px;margin-left:4px;border-radius:8px;background:#e5484d;color:#fff;font-size:9px;font-weight:800;align-items:center;justify-content:center;vertical-align:middle}
      .cd-steps{font-size:10px;color:var(--gold-l);font-weight:800;text-transform:uppercase;letter-spacing:.6px;text-align:center;margin:-2px 0 9px;opacity:.85}
      .cd-deal{display:flex;align-items:center;justify-content:center;gap:7px;background:rgba(0,0,0,.2);border-radius:11px;padding:7px 10px;margin:-2px 0 11px;font-size:12px;font-weight:700;color:var(--ink);flex-wrap:wrap}
      .cd-deal img{width:26px;height:26px;border-radius:7px;object-fit:contain}
      .cd-deal__coin{display:inline-flex;align-items:center;gap:3px;font-weight:800;color:var(--gold-l);font-variant-numeric:tabular-nums}
      /* Доплата монетами в обмене */
      .cd-coinseg{display:flex;gap:6px;margin:2px 0 10px}
      .cd-coinseg button{flex:1;padding:9px 4px;border-radius:11px;font-weight:800;font-size:11.5px;border:1px solid var(--line);background:var(--panel);color:var(--muted);cursor:pointer}
      .cd-coinseg button.on{border-color:#DFFF8F;background:linear-gradient(180deg,#D4FF6A,#A8F51E 56%,#8DBF20);color:#12210A}
      .cd-coinchips{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:10px}
      .cd-coinchip{padding:8px 12px;border-radius:11px;font-weight:800;font-size:12px;border:1px solid var(--line);background:var(--panel);color:var(--ink);cursor:pointer;font-variant-numeric:tabular-nums;display:inline-flex;align-items:center;gap:4px}
      .cd-coinchip.on{border-color:#DFFF8F;color:var(--gold-l)}
      .cd-coinchip:disabled{opacity:.4;cursor:default}
      .cd-deal__arw{color:var(--gold-l);font-weight:900}
      .cd-traderow{display:flex;align-items:center;gap:8px;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:9px 10px;margin-bottom:8px}
      .cd-traderow__swap{display:flex;align-items:center;gap:7px;flex:1;min-width:0}
      .cd-traderow__art{width:34px;height:34px;border-radius:9px;background:rgba(255,255,255,.05);border:1px solid rgba(141,146,156,.42);display:flex;align-items:center;justify-content:center;overflow:hidden;flex:none}
      .cd-traderow__art[data-r="rare"]{border-color:rgba(192,255,51,.55)}
      .cd-traderow__art[data-r="epic"]{border-color:rgba(155,92,255,.55)}
      .cd-traderow__art[data-r="legendary"]{border-color:rgba(255,46,126,.6)}
      .cd-traderow--locked{opacity:.55}
      .cd-traderow__art img{width:80%;height:80%;object-fit:contain}
      .cd-traderow__arrow{color:var(--muted);flex:none;font-size:12px}
      .cd-traderow__meta{font-size:10.5px;color:var(--muted);margin-top:2px}
      .cd-traderow__act{flex:none;display:flex;flex-direction:column;gap:6px;align-items:stretch}
      .cd-tbtn{border:1px solid #DFFF8F;border-radius:10px;padding:8px 12px;font-weight:800;font-size:11.5px;background:linear-gradient(180deg,#D4FF6A,#A8F51E 56%,#8DBF20);color:#12210A;cursor:pointer;white-space:nowrap;min-height:34px}
      .cd-tbtn:disabled{opacity:.6;cursor:default}
      .cd-tbtn--ghost{background:rgba(255,255,255,.06);color:var(--muted);border-color:var(--line)}
      .cd-mailcard{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:11px 12px;margin-bottom:9px}
      .cd-mailcard__top{display:flex;align-items:center;gap:10px}
      .cd-mailcard__art{width:42px;height:42px;border-radius:11px;background:rgba(192,255,51,.1);display:flex;align-items:center;justify-content:center;overflow:hidden;flex:none}
      .cd-mailcard__art img{width:82%;height:82%;object-fit:contain}
      .cd-mailcard__b{flex:1;min-width:0}
      .cd-mailcard__n{font-weight:700;font-size:13px;color:var(--ink)}
      .cd-mailcard__phrase{font-size:12px;color:var(--gold-l);margin-top:2px;font-style:italic;overflow-wrap:break-word}
      .cd-mailcard__from{font-size:10.5px;color:var(--muted);margin-top:3px;overflow-wrap:break-word}
      .cd-mailcard__thanks{margin-top:9px;width:100%;box-sizing:border-box;text-align:center}
      .cd-reciperow{display:flex;align-items:center;justify-content:space-between;gap:8px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:7px;cursor:pointer;overflow-wrap:break-word}
      .cd-reciperow span{min-width:0}
      .cd-reciperow small{display:block;color:var(--muted);font-size:10.5px;line-height:1.25;text-align:right}
      .cd-reciperow:active{transform:scale(.98)}
      .cd-pickgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:10px}
      .cd-pickcard{background:var(--panel);border:2px solid var(--line);border-radius:13px;padding:6px 4px 8px;text-align:center;cursor:pointer;box-sizing:border-box}
      .cd-pickcard:active{transform:scale(.96)}
      .cd-pickcard[data-r="common"]{border-color:rgba(141,146,156,.55)}
      .cd-pickcard[data-r="rare"]{border-color:#C0FF33}
      .cd-pickcard[data-r="epic"]{border-color:#9B5CFF}
      .cd-pickcard[data-r="legendary"]{border-color:#FF2E7E;box-shadow:0 0 12px rgba(255,46,126,.45)}
      @media (prefers-reduced-motion:reduce){.cd-card{animation:none;opacity:1}.cd-sk::after{animation:none}}
      /* Мини-витрина в лидерборде (window.CatDove.miniIconsHtml) — своя CSS, не зависит от mount() */
      .cd-mini-row{display:inline-flex;gap:4px;margin-top:4px}
      .cd-mini{width:13px;height:13px;border-radius:4px;border:1.5px solid rgba(141,146,156,.55);background:rgba(0,0,0,.28);display:inline-flex;align-items:center;justify-content:center;overflow:hidden;flex:none;box-sizing:border-box}
      .cd-mini[data-r="rare"]{border-color:#C0FF33}
      .cd-mini[data-r="epic"]{border-color:#9B5CFF}
      .cd-mini[data-r="legendary"]{border-color:#FF2E7E;box-shadow:0 0 5px rgba(255,46,126,.6)}
      .cd-mini img{width:100%;height:100%;object-fit:contain}
      .cd-mini svg{width:70%;height:70%;color:var(--gold-l)}
    `;
    document.head.appendChild(s);
  }

  function emptyState(title, sub) {
    return `<div class="cd-empty"><div class="cd-empty__ic">${DOVE_ICON(28)}</div><div class="cd-empty__t">${title}</div><div class="cd-empty__s">${sub}</div></div>`;
  }
  function skeleton() {
    let rows = '';
    for (let i = 0; i < 3; i++) rows += `<div class="cd-skrow"><span class="cd-sk" style="width:24px;height:24px;border-radius:50%;flex:none"></span><span class="cd-sk" style="height:12px;flex:1"></span></div>`;
    return `<div class="cd-root"><div class="cd-sk" style="height:36px;border-radius:12px;margin-bottom:14px"></div>${rows}</div>`;
  }

  // ── данные ────────────────────────────────────────────────────────────────
  async function load() {
    if (!apiRef || !authed()) { data = null; race = null; return; }
    const [d, r] = await Promise.all([
      apiRef('/api/pigeons').catch(() => null),
      apiRef('/api/pigeons/race').catch(() => null),
    ]);
    if (!d || !Array.isArray(d.inventory)) { data = null; return; }
    const invMap = {};
    d.inventory.forEach((row) => { invMap[row.breed] = { count: num(row.count), stars: num(row.stars) || 1, showcase: num(row.showcase), speed: num(row.tune_speed), stamina: num(row.tune_stamina), luck: num(row.tune_luck), passivePerHour: num(row.passivePerHour) }; });
    data = { sets: Array.isArray(d.sets) ? d.sets : [], invMap, weekBreed: d.weekBreed || null, unreadMail: num(d.unreadMail), passivePerHour: num(d.passivePerHour) };
    // race — за флагом PIGEON_RACE_ENABLED на сервере; секция рисуется только когда enabled=true.
    race = (r && typeof r.enabled === 'boolean') ? r : null;
  }

  function showcaseOrder() {
    // breeds с showcase>0, отсортированные по позиции (1..3)
    const arr = Object.keys(data.invMap)
      .map(id => ({ id, pos: data.invMap[id].showcase }))
      .filter(x => x.pos > 0)
      .sort((a, b) => a.pos - b.pos)
      .map(x => x.id);
    return arr;
  }

  // ── «Что дальше»: одна контекстная подсказка сверху вкладки — убирает ступор
  // «что тут делать». Возвращает {text, ctaLabel}; действие кнопки кладётся в hintCta,
  // вешается в wire(). Приоритет: деньги на столе → новичок → прокачка → сеты → гонка.
  let hintCta = null;
  function nextStepHint() {
    hintCta = null;
    const sets = data.sets || [];
    const ownedCount = BREEDS.filter(b => b.id !== 'champion' && data.invMap[b.id] && data.invMap[b.id].count > 0).length;
    const mk = (text, ctaLabel, run) => { hintCta = run || null; return { text, ctaLabel: run ? ctaLabel : null }; };
    const ready = sets.find(s => num(s.owned) >= 4 && !s.claimed);
    if (ready) { const def = SETS.find(x => x.id === ready.id) || {}; return mk(`Сет «${def.name || ready.id}» собран — забери ${fmt(def.reward || 0)} монет!`, 'Забрать', () => claimSetAct(ready.id)); }
    if (ownedCount === 0) return mk('Голубей пока нет. Они выпадают за комбо дня и сундук удачи. Ещё можно тапнуть закрытую породу в альбоме и купить её за монеты.', 'Играть', () => { closeSheet(); if (window.ckSetTab) window.ckSetTab('cat'); });
    const feedable = Object.keys(data.invMap).some(id => { if (id === 'champion') return false; const inv = data.invMap[id]; const st = Math.max(1, Math.min(3, num(inv.stars))); const need = starTarget(st); return need != null && (num(inv.count) - 1) >= need; });
    if (feedable) return mk('У тебя есть запасные дубли — тапни породу и «скорми» их: голубь получит звезду и станет сильнее в заезде.', null, null);
    const near = sets.find(s => num(s.owned) === 3 && !s.claimed);
    if (near) { const def = SETS.find(x => x.id === near.id) || {}; return mk(`До сета «${def.name || near.id}» не хватает одной породы (+${fmt(def.reward || 0)} монет). Тапни закрытую карточку: там характеристики и покупка.`, null, null); }
    if (ownedCount > 0 && (!race || !race.myBreed)) return mk(race && race.enabled
      ? 'Твой голубь — ещё и гонщик! Прокачай его (⚙ в карточке породы) и гоняй в Драг-заезде или заяви в Гонку стаи.'
      : 'Твой голубь — ещё и гонщик! Прокачай его (⚙ в карточке породы) и гоняй в Драг-заезде.',
      'Драг-заезд', () => openDragBreedPicker());
    if (ownedCount >= 16) return mk(race && race.enabled
      ? 'Альбом собран! Тюнингуй гонщиков (⚙ в карточке породы) и побеждай в заездах и Гонке стаи.'
      : 'Альбом собран! Тюнингуй гонщиков (⚙ в карточке породы) и побеждай в Драг-заезде.', null, null);
    return mk('Тапни любую свою породу: там докорм звёзд, тюнинг, выбор любимца для рейтинга и обмен с другими игроками.', null, null);
  }

  // ── рендер ────────────────────────────────────────────────────────────────
  function cardHtml(b) {
    const inv = data.invMap[b.id];
    const owned = !!inv && inv.count > 0;
    const week = data.weekBreed === b.id;
    const artSrc = `/img/pigeons/${b.id}.webp?v=2`;
    const art = `<img src="${artSrc}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span style="display:none;align-items:center;justify-content:center;width:100%;height:100%">${DOVE_ICON(30)}</span>`;
    if (!owned) {
      return `<div class="cd-card cd-locked" data-r="${b.rarity}" data-breed="${b.id}">
        ${week ? '<span class="cd-week">Неделя</span>' : ''}
        <div class="cd-art">${art}</div>
        <div class="cd-n">???</div>
      </div>`;
    }
    const stars = Math.max(1, Math.min(3, num(inv.stars)));
    const starHtml = '★'.repeat(stars) + `<span class="off">${'★'.repeat(3 - stars)}</span>`;
    return `<div class="cd-card" data-r="${b.rarity}" data-breed="${b.id}">
      ${week ? '<span class="cd-week">Неделя</span>' : ''}
      <span class="cd-cnt">×${num(inv.count)}</span>
      <div class="cd-art">${art}</div>
      <div class="cd-n">${b.name}</div>
      <div class="cd-stars">${starHtml}</div>
      ${inv.showcase > 0 ? '<span class="cd-showtag">в рейтинге</span>' : ''}
    </div>`;
  }

  // Блок сета в альбоме: заголовок (имя + прогресс + награда/клейм) прямо над
  // своей четвёркой карточек — награда живёт рядом с тем, за что её дают.
  function setBlockHtml(setDef) {
    const s = (data.sets || []).find(x => x.id === setDef.id) || { owned: 0, claimed: false };
    const owned = num(s.owned), full = owned >= 4;
    let action;
    if (s.claimed) action = '<span class="cd-setrow__done">Получено ✓</span>';
    else if (full) action = `<button class="cd-claimbtn" data-claim="${setDef.id}">${COIN_ICON(14)} Забрать ${fmt(setDef.reward)}</button>`;
    else action = `<span class="cd-sethead__prize">приз ${COIN_ICON(12)} ${fmt(setDef.reward)}</span>`;
    const cards = BREEDS.filter(b => b.set === setDef.id).map(cardHtml).join('');
    return `<div class="cd-sethead">
      <div class="cd-sethead__n"><b>${setDef.name}</b><span class="cd-sethead__p${full ? ' full' : ''}">${owned}/4</span></div>
      ${action}
    </div>
    <div class="cd-grid">${cards}</div>`;
  }

  function render() {
    if (!container) return;
    if (!authed()) {
      container.innerHTML = emptyState('Альбом закрыт', PURE()
        ? 'Войди через Telegram — собирай породы голубей и получай награды за сеты.'
        : 'Войди через приложение «Мария» — собирай породы голубей и получай награды за сеты.');
      return;
    }
    if (!data) {
      container.innerHTML = emptyState('Не удалось загрузить', 'Проверь связь и открой «Коллекцию» ещё раз.');
      return;
    }
    const ownedCount = BREEDS.filter(b => b.id !== 'champion' && data.invMap[b.id] && data.invMap[b.id].count > 0).length;
    const setBlocks = SETS.map(setBlockHtml).join('');
    const hint = nextStepHint();
    container.innerHTML = `<div class="cd-root">
      <div class="cd-summary">Собрано <b>${ownedCount}/16 пород</b> · голуби приносят <b>+${fmt(data.passivePerHour)}/час</b><br>Звёзды и любой тюнинг увеличивают этот доход.</div>
      <div class="cd-hint">
        <div class="cd-hint__b"><span class="cd-hint__tag">Что дальше</span><div class="cd-hint__t">${hint.text}</div></div>
        ${hint.ctaLabel ? `<button class="cd-hint__cta" id="cd-hint-cta" type="button">${hint.ctaLabel}</button>` : ''}
      </div>
      <div class="cd-navrow">
        ${ownedCount > 0 ? `<button class="cd-navbtn" id="cd-nav-race">${FLAG_ICON(15)} Гонки</button>` : ''}
        ${ownedCount > 0 ? `<button class="cd-navbtn" id="cd-nav-missions">${DOVE_ICON(16)} Задания</button>` : ''}
        <button class="cd-navbtn" id="cd-nav-trades">${SWAP_ICON(15)} Обмены${incomingTrades > 0 ? `<span class="cd-navbadge">${incomingTrades > 9 ? '9+' : incomingTrades}</span>` : ''}</button>
        <button class="cd-navbtn" id="cd-nav-friends">${USERS_ICON(15)} Друзья</button>
      </div>
      <div class="cd-sect-t">Альбом · собери сет — забери приз</div>
      ${setBlocks}
      <div class="cd-scrim" id="cd-scrim"></div>
      <div class="cd-sheet" id="cd-sheet"></div>
      <div class="cd-pop-scrim" id="cd-pop-scrim"><div class="cd-pop" id="cd-pop"></div></div>
    </div>`;
    wire();
    // Бейдж входящих обменов — один фоновый запрос при первом рендере альбома
    // (после действий с обменами обновляется точечно через refreshTradesBadge).
    if (authed() && !tradesBadgeInit) { tradesBadgeInit = true; refreshTradesBadge(); }
  }
  // Точечно обновляет бейдж «Обмены» (число входящих) без полного ре-рендера альбома.
  function updateTradesBadgeDom() {
    const btn = container && container.querySelector('#cd-nav-trades');
    if (!btn) return;
    let bd = btn.querySelector('.cd-navbadge');
    if (incomingTrades > 0) {
      if (!bd) { bd = document.createElement('span'); bd.className = 'cd-navbadge'; btn.appendChild(bd); }
      bd.textContent = incomingTrades > 9 ? '9+' : incomingTrades;
    } else if (bd) { bd.remove(); }
  }
  // Тянет доску обменов (и кэширует её, чтобы открытие было мгновенным) + считает входящие.
  async function refreshTradesBadge() {
    const d = await apiRef('/api/pigeons/trades').catch(() => null);
    if (d && Array.isArray(d.toMe)) { tradesCache = d; incomingTrades = d.toMe.length; }
    updateTradesBadgeDom();
  }

  function wire() {
    container.querySelectorAll('.cd-card:not(.cd-locked)').forEach(el => {
      el.onclick = () => openSheet(el.dataset.breed);
    });
    container.querySelectorAll('.cd-card.cd-locked').forEach(el => {
      el.onclick = () => openLockedSheet(el.dataset.breed);
    });
    container.querySelectorAll('[data-claim]').forEach(el => {
      el.onclick = () => claimSetAct(el.dataset.claim, el);
    });
    const scrim = container.querySelector('#cd-scrim');
    if (scrim) scrim.onclick = closeSheet;
    const hintBtn = container.querySelector('#cd-hint-cta'); if (hintBtn && hintCta) hintBtn.onclick = hintCta;
    const navR = container.querySelector('#cd-nav-race'); if (navR) navR.onclick = openRacePage;
    const navM = container.querySelector('#cd-nav-missions'); if (navM) navM.onclick = openMissionsPage;
    const navT = container.querySelector('#cd-nav-trades'); if (navT) navT.onclick = openTradesPage;
    const navF = container.querySelector('#cd-nav-friends'); if (navF) navF.onclick = openFriendsPage;
  }

  // ── шит действий (звёзды/витрина/обмены/гонка) — общий #cd-scrim/#cd-sheet,
  // переиспользуется всеми под-экранами (см. openTradesPage/openFriendsPage/openSheet).
  function closeSheet() {
    if (missionTimer) { clearInterval(missionTimer); missionTimer = null; }
    const sc = container.querySelector('#cd-scrim'), sh = container.querySelector('#cd-sheet');
    if (sc) sc.classList.remove('on');
    if (sh) { sh.classList.remove('on'); sh.innerHTML = ''; }
    if (needsRerenderOnClose) { needsRerenderOnClose = false; render(); }
  }

  function openSheet(breedId) {
    const b = BY_ID.get(breedId), inv = data.invMap[breedId];
    if (!b || !inv || inv.count <= 0) return;
    haptic('light');
    const stars = Math.max(1, Math.min(3, num(inv.stars)));
    const need = starTarget(stars);
    const spare = inv.count - 1;
    const feedEnabled = need != null && spare >= need;
    const feedLabel = need == null
      ? 'Максимум звёзд достигнут'
      : `Скормить дубли (${need}) → ${'★'.repeat(stars + 1)}`;
    const isShown = inv.showcase > 0;
    const curShowcase = showcaseOrder();
    const showcaseFull = curShowcase.length >= MAX_SHOWCASE && !isShown;
    const showLabel = isShown ? 'Не показывать в рейтинге' : (showcaseFull ? `Уже выбрано ${MAX_SHOWCASE}/${MAX_SHOWCASE}` : 'Показывать в рейтинге');
    const canTrade = inv.count > 1; // обмен отдаёт только дубликат — как feed
    const duplicatePrice = b.id === 'champion' ? null : PIGEON_PRICE[b.rarity];
    const duplicateBalance = pigeonBuyBalance();
    const canBuyDuplicate = duplicatePrice != null && duplicateBalance >= duplicatePrice;
    const sc = container.querySelector('#cd-scrim'), sh = container.querySelector('#cd-sheet');
    if (!sc || !sh) return;
    sh.innerHTML = `
      <div class="cd-sheet__hd"><button class="cd-sheet__back" id="cd-sheet-x">‹ Назад</button><div class="cd-sheet__t">${b.name}</div></div>
      <div class="cd-sheet__stars">${'★'.repeat(stars)}<span style="color:rgba(255,255,255,.18)">${'★'.repeat(3 - stars)}</span></div>
      <div class="cd-sheet__hint" style="margin:-4px 0 10px;text-align:center">Приносит <b style="color:var(--gold-l)">+${fmt(inv.passivePerHour)}/час</b></div>
      <div class="cd-sheet__hint" style="margin:-6px 0 10px">Звёзды усиливают голубя в заезде — расти их, скармливая дубли</div>
      ${duplicatePrice != null ? `<button class="cd-sheet__act" id="cd-buy-duplicate" ${canBuyDuplicate ? '' : 'disabled'}>${COIN_ICON(13)} Купить дубль за ${fmt(duplicatePrice)}</button><div class="cd-sheet__hint" style="margin:-6px 0 10px">В запасе дублей: ${Math.max(0, spare)}${canBuyDuplicate ? '' : ` · не хватает ${fmt(duplicatePrice - duplicateBalance)} монет`}</div>` : ''}
      <button class="cd-sheet__act" id="cd-feed" ${feedEnabled ? '' : 'disabled'}>${feedLabel}</button>
      ${need != null && !feedEnabled ? `<div class="cd-sheet__hint">Нужно ${need} запасных (сейчас ${Math.max(0, spare)})</div>` : ''}
      <button class="cd-sheet__act${isShown ? ' cd-sheet__act--on' : ''}" id="cd-show" ${(!isShown && showcaseFull) ? 'disabled' : ''}>${showLabel}</button>
      <div class="cd-sheet__hint" style="margin:-6px 0 10px">Можно выбрать до трёх любимых голубей. Их мини-картинки увидят другие игроки рядом с твоим именем в рейтинге. На доход и силу это не влияет.</div>
      <button class="cd-sheet__act" id="cd-tune">${GEAR_ICON(15)} Тюнинг гонщика</button>
      <div class="cd-sheet__hint" style="margin:-6px 0 10px">Скорость · выносливость · удача — решают исход заезда</div>
      <button class="cd-sheet__act" id="cd-drag-one">${FLAG_ICON(15)} Драг-заезд</button>
      <div class="cd-sheet__hint" style="margin:-6px 0 10px">Быстрый заезд именно на этом голубе — тренировка или ставка</div>
      ${canTrade ? `<button class="cd-sheet__act" id="cd-trade-start">${SWAP_ICON(15)} Предложить обмен</button>` : ''}
    `;
    sc.classList.add('on');
    requestAnimationFrame(() => sh.classList.add('on'));
    sh.querySelector('#cd-sheet-x').onclick = closeSheet;
    const feedBtn = sh.querySelector('#cd-feed');
    if (feedBtn && feedEnabled) feedBtn.onclick = () => feedAct(breedId, feedBtn);
    const duplicateBtn = sh.querySelector('#cd-buy-duplicate');
    if (duplicateBtn && !duplicateBtn.disabled) duplicateBtn.onclick = () => buyPigeonAct(breedId, () => openSheet(breedId));
    const showBtn = sh.querySelector('#cd-show');
    if (showBtn && !showBtn.disabled) showBtn.onclick = () => showcaseAct(breedId, isShown, showBtn);
    const tuneBtn = sh.querySelector('#cd-tune');
    if (tuneBtn) tuneBtn.onclick = () => openTune(breedId);
    const dragBtn = sh.querySelector('#cd-drag-one');
    if (dragBtn) dragBtn.onclick = () => { closeSheet(); if (window.CatDrag) window.CatDrag.open(apiRef, breedId); };
    const tradeBtn = sh.querySelector('#cd-trade-start');
    if (tradeBtn) tradeBtn.onclick = () => { tradeFromBoard = false; openTradeWant(breedId); };
  }

  // ── Шит закрытой породы: характеристики до получения (имя не раскрываем —
  // интрига «???» остаётся до первого дропа, но игрок видит, ЧТО ищет и ЗАЧЕМ) ──
  const RARITY_LABEL = { common: 'Обычный', rare: 'Редкий', epic: 'Эпический', legendary: 'Легендарный' };
  // Базовая сила пород в заезде — зеркало src/drag.ts::RARITY_BASE (менять синхронно).
  const DRAG_RARITY_BASE = { common: 10, rare: 16, epic: 22, legendary: 28 };
  const DRAG_POWER_CAP = (r) => DRAG_RARITY_BASE[r] + 2 * 4 + 6 * 10 + 6 * 10; // ★3 + тюнинг 10/10
  // Цена покупки закрытой породы — зеркало src/pigeons.ts::PIGEON_PRICE (менять синхронно).
  const PIGEON_PRICE = { common: 30000, rare: 120000, epic: 600000, legendary: 2500000 };
  function openLockedSheet(breedId) {
    const b = BY_ID.get(breedId);
    if (!b || b.id === 'champion') return;
    haptic('light');
    const sc = container.querySelector('#cd-scrim'), sh = container.querySelector('#cd-sheet');
    if (!sc || !sh) return;
    const setDef = SETS.find(s => s.id === b.set);
    const week = data && data.weekBreed === b.id;
    const price = PIGEON_PRICE[b.rarity];
    const bal = pigeonBuyBalance();
    const afford = bal >= price;
    const drop = week
      ? 'Порода недели — выпадает чаще! Её можно выбить за комбо дня и сундук удачи или купить прямо здесь.'
      : 'Можно выбить за комбо дня и сундук удачи или купить прямо здесь.';
    sh.innerHTML = `
      <div class="cd-sheet__hd"><button class="cd-sheet__back" id="cd-sheet-x">‹ Назад</button><div class="cd-sheet__t">Кто здесь живёт?</div></div>
      <div class="cd-lk-art"><img src="/img/pigeons/${b.id}.webp?v=2" alt="" onerror="this.style.display='none'"></div>
      <div class="cd-lk-rows">
        <div class="cd-lk-row"><b>Редкость</b><span class="cd-rarity cd-rarity--${b.rarity}">${RARITY_LABEL[b.rarity]}</span></div>
        <div class="cd-lk-row"><b>Сила в заезде</b><span>${DRAG_RARITY_BASE[b.rarity]} база · до ${DRAG_POWER_CAP(b.rarity)} с прокачкой</span></div>
        ${setDef ? `<div class="cd-lk-row"><b>Сет</b><span>«${setDef.name}» · приз ${fmt(setDef.reward)} монет</span></div>` : ''}
      </div>
      <button class="cd-sheet__act" id="cd-buy-locked" ${afford ? '' : 'disabled'}>${COIN_ICON(13)} Купить за ${fmt(price)}</button>
      <div class="cd-sheet__hint" style="margin:-6px 0 10px">Баланс: ${fmt(bal)} монет${afford ? '' : ` · не хватает ${fmt(price - bal)}`}</div>
      <div class="cd-sheet__hint" style="margin:0">${drop}</div>
    `;
    sc.classList.add('on');
    requestAnimationFrame(() => sh.classList.add('on'));
    sh.querySelector('#cd-sheet-x').onclick = closeSheet;
    const buyBtn = sh.querySelector('#cd-buy-locked');
    if (buyBtn && !buyBtn.disabled) buyBtn.onclick = () => buyPigeonAct(breedId, closeSheet);
  }

  // ── Задания голубей: один полёт на птицу, результат забирается после таймера ──
  const MISSION_REASON = { bird_busy: 'Этот голубь уже на задании', not_owned: 'Птица не найдена', unknown_mission: 'Задание не найдено', mission_locked: 'Сначала повысь звёзды или тюнинг голубя', not_ready: 'Голубь ещё в пути', not_found: 'Задание уже получено' };
  const durationText = (sec) => sec < 3600 ? `${Math.round(sec / 60)} мин` : `${Math.round(sec / 3600)} ч`;
  const leftText = (date) => {
    const s = Math.max(0, Math.ceil((new Date(date).getTime() - Date.now()) / 1000));
    if (!s) return 'готово';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? `${h} ч ${m} мин` : `${m}:${String(x).padStart(2, '0')}`;
  };

  async function openMissionsPage() {
    haptic('light');
    const sc = container.querySelector('#cd-scrim'), sh = container.querySelector('#cd-sheet'); if (!sc || !sh) return;
    sh.innerHTML = `<div class="cd-sheet__hd"><button class="cd-sheet__back" id="cd-sheet-x">‹ Назад</button><div class="cd-sheet__t">Задания голубей</div></div><div id="cd-missions-body" style="padding:4px 0">Загрузка…</div>`;
    sc.classList.add('on'); requestAnimationFrame(() => sh.classList.add('on'));
    sh.querySelector('#cd-sheet-x').onclick = closeSheet;
    await renderMissions();
    let introSeen = false; try { introSeen = localStorage.getItem('cd_missions_tutorial_v2') === '1'; } catch (_) {}
    if (!introSeen) missionHelpPopup(true);
    if (missionTimer) clearInterval(missionTimer);
    missionTimer = setInterval(updateMissionTimers, 1000);
  }

  function updateMissionTimers() {
    if (!container) return;
    container.querySelectorAll('[data-completes]').forEach(el => {
      const ready = new Date(el.dataset.completes).getTime() <= Date.now();
      el.textContent = ready ? 'Забрать награду' : `В пути · ${leftText(el.dataset.completes)}`;
      el.disabled = !ready;
    });
  }

  async function renderMissions() {
    const body = container.querySelector('#cd-missions-body'); if (!body) return;
    const d = await apiRef('/api/pigeons/missions').catch(() => null);
    if (!d || !Array.isArray(d.pigeons)) { body.innerHTML = '<div class="cd-sheet__hint">Не удалось загрузить задания</div>'; return; }
    const defs = new Map((d.missions || []).map(m => [m.id, m]));
    const active = new Map((d.active || []).map(m => [m.breed, m]));
    const cards = d.pigeons.map(p => {
      const b = BY_ID.get(p.breed) || { name: p.breed };
      const a = active.get(p.breed);
      if (a) {
        const def = defs.get(a.mission_id) || { name: 'Задание' };
        return `<div class="cd-setrow" style="display:block;margin-bottom:9px"><div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:7px"><b>${b.name}</b><span style="color:var(--gold-l);font-size:11px">шанс ${num(a.chance)}%</span></div><div style="font-size:12px;color:var(--muted);margin-bottom:8px">${def.name} · награда ${fmt(a.reward)} (${fmt(a.consolation)} при провале)</div><button class="cd-sheet__act" style="margin:0" data-claim-mission="${a.id}" data-completes="${a.completes_at}"></button></div>`;
      }
      const unlocked = (d.missions || []).filter(m => num(p.power) >= num(m.minPower));
      const opts = unlocked.map(m => { const perHour = Math.round(num(m.reward) * 3600 / num(m.durationSec)); const tier = m.tier === 'elite' ? 'Элита' : m.tier === 'advanced' ? 'Продвинутое' : 'Базовое'; return `<option value="${m.id}">${tier} · ${m.name} · ${fmt(perHour)}/час</option>`; }).join('');
      const next = (d.missions || []).filter(m => num(m.minPower) > num(p.power)).sort((a, b) => num(a.minPower) - num(b.minPower))[0];
      return `<div class="cd-setrow" style="display:block;margin-bottom:9px"><div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:7px"><b>${b.name}</b><span style="color:var(--gold-l);font-size:11px">+${fmt(p.passivePerHour)}/час</span></div><div style="font-size:11px;color:var(--muted);margin-bottom:7px">Сила ${num(p.power)} · ★${p.stars} · тюнинг ${p.speed}/${p.stamina}/${p.luck}</div><select data-mission-select="${p.breed}" style="width:100%;box-sizing:border-box;background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:10px;margin-bottom:7px">${opts}</select>${next ? `<div class="cd-sheet__hint" style="margin:-2px 0 7px">Следующее задание откроется при силе ${next.minPower}</div>` : `<div class="cd-sheet__hint" style="margin:-2px 0 7px">Открыты все задания</div>`}<button class="cd-sheet__act" style="margin:0" data-start-mission="${p.breed}">Отправить</button></div>`;
    }).join('');
    body.innerHTML = `<button class="cd-navbtn" id="cd-mission-help" style="width:100%;margin-bottom:9px" type="button">? Как работают задания и сила</button><div class="cd-sheet__hint" style="margin-bottom:10px">Звёзды и тюнинг повышают силу: она открывает прибыльные задания и увеличивает шанс. В списке указан доход задания за час.</div>${cards}`;
    body.querySelector('#cd-mission-help').onclick = () => missionHelpPopup(false);
    body.querySelectorAll('[data-start-mission]').forEach(btn => { btn.onclick = () => startMissionAct(btn.dataset.startMission, btn); });
    body.querySelectorAll('[data-claim-mission]').forEach(btn => { btn.onclick = () => claimMissionAct(num(btn.dataset.claimMission), btn); });
    updateMissionTimers();
  }

  function missionHelpPopup(firstTime) {
    const s = container.querySelector('#cd-pop-scrim'), p = container.querySelector('#cd-pop'); if (!s || !p) return;
    p.innerHTML = `<h3>${DOVE_ICON(21)} ${firstTime ? 'Новое: задания голубей' : 'Как работают задания'}</h3>
      <div style="font-size:13px;line-height:1.5;color:var(--cream);text-align:left;margin:8px 0 14px">
        <p><b>1.</b> У каждого голубя есть сила: её дают редкость, звёзды и весь тюнинг.</p>
        <p><b>2.</b> Сила 20 открывает продвинутые задания, 50 — элитные. Самые прибыльные маршруты требуют силу 65.</p>
        <p><b>3.</b> В выборе маршрута показана прибыль за час. Чем выше уровень задания, тем больше заработок.</p>
        <p><b>4.</b> Сила также повышает шанс успеха. За успех выдаётся 100% награды, при провале — 20%.</p>
        <p><b>Важно:</b> личный доход голубя в час продолжает начисляться и во время полёта.</p>
      </div><button id="cd-mission-help-ok">Понятно, отправляем!</button>`;
    s.classList.add('on');
    const close = () => { try { localStorage.setItem('cd_missions_tutorial_v2', '1'); } catch (_) {} s.classList.remove('on'); };
    s.onclick = (e) => { if (e.target === s) close(); };
    p.querySelector('#cd-mission-help-ok').onclick = close;
  }

  async function startMissionAct(breed, btn) {
    if (busy) return; const sel = container.querySelector(`[data-mission-select="${breed}"]`); if (!sel) return;
    busy = true; btn.disabled = true;
    try {
      const d = await apiRef('/api/pigeons/missions/start', { method: 'POST', body: JSON.stringify({ breed, missionId: sel.value }) }).catch(() => null);
      if (d && d.ok) { haptic('medium'); flash('Голубь отправлен!'); await renderMissions(); }
      else { flash(MISSION_REASON[d && d.error] || 'Не удалось отправить'); btn.disabled = false; }
    } finally { busy = false; }
  }

  async function claimMissionAct(id, btn) {
    if (busy || btn.disabled) return; busy = true; btn.disabled = true;
    try {
      const d = await apiRef('/api/pigeons/missions/claim', { method: 'POST', body: JSON.stringify({ id }) }).catch(() => null);
      if (d && d.ok) {
        haptic(d.success ? 'success' : 'medium');
        flash(d.success ? `Задание выполнено: +${fmt(d.reward)}` : `Задание провалено, но голубь привёз +${fmt(d.reward)}`);
        if (typeof window.ckSyncState === 'function') window.ckSyncState({ balance: num(d.newBalance) });
        await renderMissions();
      } else { flash(MISSION_REASON[d && d.error] || 'Не удалось забрать'); btn.disabled = false; }
    } finally { busy = false; }
  }

  // ── Тюнинг гонщика: 3 характеристики за монеты, дивизион по сумме уровней ──
  const STAT_LABEL = { speed: 'Скорость', stamina: 'Выносливость', luck: 'Удача' };
  const STAT_HINT = { speed: 'базовый темп', stamina: 'тапы сильнее', luck: 'меньше случайности' };
  const TUNE_MAX = 10;
  const TUNE_REASON = { not_owned: 'Птица не найдена', bad_stat: 'Неизвестная характеристика', max_level: 'Максимальный уровень', not_enough_coins: 'Не хватает монет', rate_limited: 'Слишком быстро — подожди пару секунд' };

  async function openTune(breedId) {
    const b = BY_ID.get(breedId); if (!b) return;
    haptic('light');
    const sc = container.querySelector('#cd-scrim'), sh = container.querySelector('#cd-sheet');
    if (!sc || !sh) return;
    sh.innerHTML = `<div class="cd-sheet__hd"><button class="cd-sheet__back" id="cd-sheet-x">‹ Назад</button><div class="cd-sheet__t">Тюнинг: ${b.name}</div></div><div id="cd-tune-body" style="padding:4px 0"><div style="color:var(--muted);font-size:12.5px;text-align:center;padding:10px 0">Загрузка…</div></div>`;
    sc.classList.add('on');
    requestAnimationFrame(() => sh.classList.add('on'));
    sh.querySelector('#cd-sheet-x').onclick = closeSheet;
    await renderTune(breedId);
  }

  async function renderTune(breedId) {
    const body = container.querySelector('#cd-tune-body'); if (!body) return;
    const t = await apiRef('/api/pigeons/tune?breed=' + encodeURIComponent(breedId)).catch(() => null);
    if (!t || !t.owned) { body.innerHTML = `<div style="color:var(--muted);font-size:12.5px;text-align:center;padding:10px 0">Птица не найдена</div>`; return; }
    const balance = num(t.balance);
    if (data && data.invMap[breedId]) {
      data.passivePerHour += num(t.passivePerHour) - num(data.invMap[breedId].passivePerHour);
      data.invMap[breedId].passivePerHour = num(t.passivePerHour);
      data.invMap[breedId].speed = num(t.speed); data.invMap[breedId].stamina = num(t.stamina); data.invMap[breedId].luck = num(t.luck);
    }
    const rows = ['speed', 'stamina', 'luck'].map(stat => {
      const lvl = num(t[stat]);
      const cost = t.nextCost[stat];
      const bars = Array.from({ length: TUNE_MAX }, (_, i) => `<span style="flex:1;height:6px;border-radius:3px;background:${i < lvl ? 'var(--gold)' : 'rgba(255,255,255,.12)'}"></span>`).join('');
      const poor = cost != null && cost > balance;
      const btn = cost == null
        ? `<span style="font-size:11px;color:var(--muted);flex:none">макс</span>`
        : `<button class="cd-claimbtn" data-stat="${stat}" style="flex:none" ${poor ? 'disabled' : ''}>${COIN_ICON(11)} ${fmt(cost)}</button>`;
      return `<div style="padding:7px 2px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:5px">
          <div style="font-size:12.5px;color:var(--ink);font-weight:700">${STAT_LABEL[stat]} <span style="color:var(--muted);font-weight:500;font-size:11px">${lvl}/${TUNE_MAX} · ${STAT_HINT[stat]}</span></div>
          ${btn}
        </div>
        <div style="display:flex;gap:3px">${bars}</div>
      </div>`;
    }).join('');
    // дивизион-бар: зоны 0-8 бронза / 9-17 серебро / 18-30 золото (зеркало src/drag.ts::raceDivision)
    const pr = Math.max(0, Math.min(30, num(t.powerRating)));
    body.innerHTML = `<div class="cd-summary" style="margin-bottom:8px">Этот голубь приносит <b>+${fmt(t.passivePerHour)}/час</b>. Каждый уровень тюнинга увеличивает доход.</div><div class="cd-setrow" style="margin-bottom:4px">
      <div class="cd-setrow__n" style="flex:1">
        <div style="display:flex;align-items:center;gap:8px"><b>Дивизион:</b><span style="display:inline-flex" class="cd-divhead">${divChip(t.division)}</span></div>
        <div class="cd-divbar"><i style="width:${Math.round(pr / 30 * 100)}%"></i><b style="left:30%"></b><b style="left:60%"></b></div>
        <div class="cd-setrow__p">рейтинг силы ${pr}/30 — сумма уровней тюнинга</div>
      </div>
    </div>${rows}`;
    body.querySelectorAll('button[data-stat]').forEach(btn => { btn.onclick = () => tuneAct(breedId, btn.dataset.stat, btn); });
  }

  async function tuneAct(breedId, stat, btn) {
    if (busy) return; busy = true; if (btn) btn.disabled = true;
    try {
      const d = await apiRef('/api/pigeons/tune', { method: 'POST', body: JSON.stringify({ breed: breedId, stat }) }).catch(() => null);
      if (d && d.ok) { haptic('medium'); await renderTune(breedId); }
      else { flash(TUNE_REASON[d && d.error] || 'Не получилось прокачать'); if (btn) btn.disabled = false; }
    } finally { busy = false; }
  }

  const FEED_REASON = { not_owned: 'Птица не найдена', max_stars: 'Максимум звёзд', not_enough_dupes: 'Не хватает запасных дублей' };
  async function feedAct(breedId, btn) {
    if (busy) return; busy = true; if (btn) btn.disabled = true;
    try {
      const d = await apiRef('/api/pigeons/feed', { method: 'POST', body: JSON.stringify({ breed: breedId }) }).catch(() => null);
      if (d && d.ok) {
        data.invMap[breedId].stars = num(d.stars) || data.invMap[breedId].stars;
        data.invMap[breedId].count -= num(d.spent) || 0;
        haptic('medium');
        closeSheet();
        render();
      } else {
        flash(FEED_REASON[d && d.error] || 'Не получилось скормить дубли');
        if (btn) btn.disabled = false;
      }
    } finally { busy = false; }
  }

  const SHOW_REASON = { bad_input: 'Можно выбрать не больше трёх голубей', unknown_breed: 'Неизвестная порода', not_owned: 'Птица не найдена' };
  async function showcaseAct(breedId, wasShown, btn) {
    if (busy) return; busy = true; if (btn) btn.disabled = true;
    try {
      let breeds = showcaseOrder();
      if (wasShown) breeds = breeds.filter(id => id !== breedId);
      else { if (breeds.length >= MAX_SHOWCASE) { flash(`Для рейтинга уже выбрано ${MAX_SHOWCASE}/${MAX_SHOWCASE}`); return; } breeds = breeds.concat([breedId]); }
      const d = await apiRef('/api/pigeons/showcase', { method: 'POST', body: JSON.stringify({ breeds }) }).catch(() => null);
      if (d && d.ok) {
        Object.keys(data.invMap).forEach(id => { data.invMap[id].showcase = 0; });
        breeds.forEach((id, i) => { if (data.invMap[id]) data.invMap[id].showcase = i + 1; });
        haptic('light');
        closeSheet();
        render();
      } else {
        flash(SHOW_REASON[d && d.error] || 'Не получилось обновить выбор');
        if (btn) btn.disabled = false;
      }
    } finally { busy = false; }
  }

  // ── общие хелперы для под-экранов (обмены/друзья/гонка) ────────────────────
  function skeletonRows(n) {
    let rows = '';
    for (let i = 0; i < n; i++) rows += `<div class="cd-skrow"><span class="cd-sk" style="width:24px;height:24px;border-radius:50%;flex:none"></span><span class="cd-sk" style="height:12px;flex:1"></span></div>`;
    return rows;
  }
  // Плитка-пикер породы (для «что хочешь взамен» / «кого отправить» / гонки) —
  // явный список id, а не весь каталог: вызывающий решает, что показывать (все
  // породы кроме отдаваемой / только дубликаты / только имеющиеся).
  function pickGridHtml(ids, selectedId) {
    return `<div class="cd-pickgrid">${ids.map(id => {
      const b = BY_ID.get(id); if (!b) return '';
      const artSrc = `/img/pigeons/${id}.webp?v=2`;
      return `<div class="cd-pickcard${id === selectedId ? ' sel' : ''}" data-r="${b.rarity}" data-breed="${id}">
        <div class="cd-art"><img src="${artSrc}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span style="display:none;align-items:center;justify-content:center;width:100%;height:100%">${DOVE_ICON(24)}</span></div>
        <div class="cd-n" style="font-size:9.5px">${b.name}</div>
      </div>`;
    }).join('')}</div>`;
  }
  function stickerListHtml() {
    return STICKERS.map((s, i) => `<div class="cd-reciperow" data-sticker="${i}"><span>${s}</span></div>`).join('');
  }
  async function loadRecipients() {
    if (recipients) return recipients;
    const d = await apiRef('/api/pigeons/recipients').catch(() => null);
    recipients = (d && Array.isArray(d.squad) && Array.isArray(d.refs))
      ? { friends: Array.isArray(d.friends) ? d.friends : [], squad: d.squad, refs: d.refs, friendLink: d.friendLink || '' }
      : { friends: [], squad: [], refs: [], friendLink: '' };
    return recipients;
  }
  function refreshRecipients() {
    recipients = null;
    return loadRecipients();
  }
  async function openFriendsPage() {
    haptic('light');
    const sc = container.querySelector('#cd-scrim'), sh = container.querySelector('#cd-sheet');
    if (!sc || !sh) return;
    sh.innerHTML = `<div class="cd-sheet__hd"><button class="cd-sheet__back" id="cd-sheet-x">‹ Назад</button><div class="cd-sheet__t">Друзья</div></div>
      <div class="cd-sheet__hint" style="margin-top:2px">Друг появится здесь после того, как откроет твою ссылку в Telegram-боте. Это отдельная дружба для голубей, не рейтинг и не команда.</div>
      <button class="cd-sheet__act" id="cd-fr-invite">${USERS_ICON(15)} Позвать друга по ссылке</button>
      <div class="cd-sect-t">Друзья для голубей</div>
      <div id="cd-fr-list">${skeletonRows(2)}</div>`;
    sc.classList.add('on');
    requestAnimationFrame(() => sh.classList.add('on'));
    sh.querySelector('#cd-sheet-x').onclick = closeSheet;
    const inviteBtn = sh.querySelector('#cd-fr-invite');
    if (inviteBtn) inviteBtn.onclick = () => shareFriendLink(recipients);
    const rec = await refreshRecipients();
    const list = sh.querySelector('#cd-fr-list');
    if (!list) return;
    const friends = Array.isArray(rec.friends) ? rec.friends : [];
    list.innerHTML = friends.length
      ? friends.map(r => `<div class="cd-reciperow cd-friend-open" data-chat="${r.chat}"><span>${esc(r.name)}</span><small>${r.username ? '@' + esc(r.username) + ' · ' : ''}нажми, чтобы открыть друга</small></div>`).join('')
      : emptyState('Пока нет друзей', 'Нажми «Позвать друга по ссылке». Когда друг откроет ссылку в боте, он появится в этом списке.');
    const byChat = new Map(friends.map(r => [num(r.chat), r]));
    list.querySelectorAll('.cd-friend-open').forEach(el => { el.onclick = () => openFriendProfile(byChat.get(num(el.dataset.chat))); });
    const inv = sh.querySelector('#cd-fr-invite'); if (inv) inv.onclick = () => shareFriendLink(rec);
  }

  async function openFriendProfile(friend) {
    if (!friend || !friend.chat) return;
    const sh = container.querySelector('#cd-sheet'); if (!sh) return;
    const username = String(friend.username || '').replace(/^@/, '');
    sh.innerHTML = `<div class="cd-sheet__hd"><button class="cd-sheet__back" id="cd-sheet-x">‹ Друзья</button><div class="cd-sheet__t">${esc(friend.name)}</div></div>
      ${username ? `<button class="cd-sheet__act" id="cd-friend-tg">Написать @${esc(username)} в Telegram</button>` : `<div class="cd-sheet__hint">У друга не указан публичный username Telegram, поэтому открыть личный чат по ссылке нельзя.</div>`}
      <button class="cd-sheet__act" id="cd-friend-trade">${SWAP_ICON(15)} Предложить обмен</button>
      <button class="cd-sheet__act" id="cd-friend-duel">${FLAG_ICON(15)} Вызвать на дуэль</button>
      <div class="cd-sect-t">Обмены от этого друга</div><div id="cd-friend-trades">${skeletonRows(2)}</div>`;
    sh.querySelector('#cd-sheet-x').onclick = openFriendsPage;
    const tg = sh.querySelector('#cd-friend-tg'); if (tg) tg.onclick = () => { window.open('https://t.me/' + encodeURIComponent(username), '_blank'); };
    sh.querySelector('#cd-friend-trade').onclick = () => { tradeTargetFriend = friend; openTradeGive(); };
    sh.querySelector('#cd-friend-duel').onclick = () => openFriendRaceStakePicker(friend);
    const d = await apiRef('/api/pigeons/trades').catch(() => null);
    if (d && Array.isArray(d.open)) tradesCache = d;
    const box = sh.querySelector('#cd-friend-trades'); if (!box) return;
    const incoming = (tradesCache && tradesCache.toMe || []).filter(t => num(t.from_chat) === num(friend.chat));
    box.innerHTML = incoming.length ? incoming.map(t => tradeRowHtml(t, 'toMe')).join('') : `<div class="cd-sheet__hint">Новых предложений от этого друга нет.</div>`;
    box.querySelectorAll('[data-accept]').forEach(el => { el.onclick = async () => { await acceptTradeAct(num(el.dataset.accept), el); openFriendProfile(friend); }; });
    box.querySelectorAll('[data-decline]').forEach(el => { el.onclick = async () => { await declineTradeAct(num(el.dataset.decline), el); openFriendProfile(friend); }; });
  }

  // ── Обмены: создание предложения ───────────────────────────────────────────
  // Мини-чип «отдаёшь X → хочешь Y» для контекста на шагах флоу.
  function dealChip(giveId, wantId, coin) {
    const g = BY_ID.get(giveId), w = wantId ? BY_ID.get(wantId) : null;
    const art = (id) => `<img src="/img/pigeons/${id}.webp?v=2" alt="" onerror="this.style.display='none'">`;
    const c = num(coin);
    // coin>0 — я доплачиваю (монеты на МОЕЙ стороне, give); coin<0 — прошу доплату (на стороне want)
    const coinChip = (n) => `<span class="cd-deal__coin">+${COIN_ICON(12)} ${fmt(n)}</span>`;
    const giveSide = `${art(giveId)}<span>${g ? g.name : giveId}</span>${c > 0 ? coinChip(c) : ''}`;
    const wantSide = w ? `${art(wantId)}<span>${w.name}</span>${c < 0 ? coinChip(-c) : ''}` : '<span style="color:var(--muted)">выбери</span>';
    return `<div class="cd-deal">${giveSide}<span class="cd-deal__arw">→</span>${wantSide}</div>`;
  }
  // Пресеты доплаты монетами в обмене (зеркало серверного потолка TRADE_COIN_CAP=100M)
  const COIN_PRESETS = [5000, 25000, 100000, 500000, 2000000];
  // Шаг 1 (с доски): выбери свою запасную породу. С карточки породы этот шаг пропущен
  // (порода уже выбрана тапом по карточке), флоу начинается сразу с «что хочешь взамен».
  function openTradeGive() {
    tradeFromBoard = true;
    tcState = { give: null, want: null };
    haptic('light');
    const sh = container.querySelector('#cd-sheet');
    if (!sh) return;
    const spares = Object.keys(data.invMap).filter(id => id !== 'champion' && data.invMap[id].count > 1);
    if (!spares.length) {
      sh.innerHTML = `<div class="cd-sheet__hd"><button class="cd-sheet__back" id="cd-sheet-x">‹ Назад</button><div class="cd-sheet__t">Предложить обмен</div></div>
        ${emptyState('Нет запасных', 'Меняться можно только запасным дублем породы. Дубль появляется, когда порода выпадает во второй раз.')}`;
      sh.querySelector('#cd-sheet-x').onclick = openTradesPage;
      return;
    }
    sh.innerHTML = `<div class="cd-sheet__hd"><button class="cd-sheet__back" id="cd-sheet-x">‹ Назад</button><div class="cd-sheet__t">Что отдаёшь?</div></div>
      <div class="cd-steps">Обмен · шаг 1 из 3</div>
      <div class="cd-sheet__hint" style="margin-top:0">Только запасного дубля — базовый голубь остаётся у тебя</div>
      ${pickGridHtml(spares, null)}`;
    sh.querySelector('#cd-sheet-x').onclick = openTradesPage; // назад к доске
    sh.querySelectorAll('.cd-pickcard').forEach(el => { el.onclick = () => openTradeWant(el.dataset.breed); });
  }
  function openTradeWant(giveId) {
    tcState = { give: giveId, want: null, coin: 0 };
    haptic('light');
    const sh = container.querySelector('#cd-sheet');
    if (!sh) return;
    const ids = BREEDS.filter(b => b.id !== 'champion' && b.id !== giveId).map(b => b.id);
    sh.innerHTML = `<div class="cd-sheet__hd"><button class="cd-sheet__back" id="cd-sheet-x">‹ Назад</button><div class="cd-sheet__t">Что хочешь взамен?</div></div>
      ${tradeFromBoard ? '<div class="cd-steps">Обмен · шаг 2 из 4</div>' : ''}
      ${dealChip(giveId, null, 0)}
      ${pickGridHtml(ids, null)}`;
    sh.querySelector('#cd-sheet-x').onclick = tradeFromBoard ? openTradeGive : closeSheet;
    sh.querySelectorAll('.cd-pickcard').forEach(el => { el.onclick = () => openTradeCoins(el.dataset.breed); });
  }
  // Шаг «Доплата»: по желанию добавь монеты (я доплачу, coin>0) или попроси доплату
  // за сильного голубя (coin<0). Уравнивает ценность обмена. coin=0 — чистый своп.
  function openTradeCoins(wantId) {
    if (!tcState) return;
    tcState.want = wantId; if (typeof tcState.coin !== 'number') tcState.coin = 0;
    haptic('light');
    const sh = container.querySelector('#cd-sheet');
    if (!sh) return;
    const bal = typeof window.ckBalance === 'function' ? num(window.ckBalance()) : 0;
    // Режим и сумма — отдельно (иначе «Я доплачу» при сумме 0 читался бы как «Без доплаты»).
    let mode = tcState.coin > 0 ? 'pay' : tcState.coin < 0 ? 'ask' : 'none';
    let amt = Math.abs(tcState.coin);
    const sync = () => { tcState.coin = mode === 'pay' ? amt : mode === 'ask' ? -amt : 0; };
    const draw = () => {
      sync();
      const chips = (mode === 'none') ? '' : `<div class="cd-coinchips">${COIN_PRESETS.map(v => {
        const tooMuch = mode === 'pay' && v > bal;
        return `<button class="cd-coinchip${amt === v ? ' on' : ''}" data-amt="${v}"${tooMuch ? ' disabled' : ''}>${COIN_ICON(12)} ${fmt(v)}</button>`;
      }).join('')}</div>`;
      sh.innerHTML = `<div class="cd-sheet__hd"><button class="cd-sheet__back" id="cd-sheet-x">‹ Назад</button><div class="cd-sheet__t">Доплата монетами?</div></div>
        ${tradeFromBoard ? '<div class="cd-steps">Обмен · шаг 3 из 4</div>' : ''}
        ${dealChip(tcState.give, wantId, tcState.coin)}
        <div class="cd-sheet__hint" style="margin-top:0">Уравняй ценность: доплати за более крутого голубя — или попроси доплату, отдавая сильного. По желанию.</div>
        <div class="cd-coinseg">
          <button data-mode="none"${mode === 'none' ? ' class="on"' : ''}>Без доплаты</button>
          <button data-mode="pay"${mode === 'pay' ? ' class="on"' : ''}>Я доплачу</button>
          <button data-mode="ask"${mode === 'ask' ? ' class="on"' : ''}>Прошу доплату</button>
        </div>
        ${chips}
        <div class="cd-sheet__hint">${mode === 'pay' ? `Твой баланс: ${fmt(bal)}. Монеты уйдут в залог и вернутся, если отменишь обмен.` : mode === 'ask' ? 'Принимающий доплатит эту сумму тебе при обмене.' : ''}</div>
        <button class="cd-sheet__act" id="cd-coin-next"${(mode !== 'none' && amt === 0) ? ' disabled' : ''}>Дальше</button>`;
      sh.querySelector('#cd-sheet-x').onclick = () => openTradeWant(tcState.give); // назад к «взамен»
      sh.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { mode = b.dataset.mode; if (mode === 'none') amt = 0; draw(); });
      sh.querySelectorAll('[data-amt]').forEach(b => { if (!b.disabled) b.onclick = () => { amt = num(b.dataset.amt); draw(); }; });
      const nx = sh.querySelector('#cd-coin-next'); if (nx && !nx.disabled) nx.onclick = () => { sync(); openTradeRecipient(wantId); };
    };
    draw();
  }
  async function openTradeRecipient(wantId) {
    if (!tcState) return;
    tcState.want = wantId;
    haptic('light');
    const sh = container.querySelector('#cd-sheet');
    if (!sh) return;
    if (tradeTargetFriend) {
      const friend = tradeTargetFriend;
      sh.innerHTML = `<div class="cd-sheet__hd"><button class="cd-sheet__back" id="cd-sheet-x">‹ Назад</button><div class="cd-sheet__t">Обмен с ${esc(friend.name)}</div></div>
        ${dealChip(tcState.give, wantId, num(tcState.coin))}
        <div class="cd-sheet__hint">Предложение увидит только этот друг. Он сможет принять его или отказаться.</div>
        <button class="cd-sheet__act" id="cd-trade-direct">Отправить предложение</button>`;
      sh.querySelector('#cd-sheet-x').onclick = () => openTradeCoins(tcState.want);
      sh.querySelector('#cd-trade-direct').onclick = () => submitTrade(friend.chat);
      return;
    }
    sh.innerHTML = `<div class="cd-sheet__hd"><button class="cd-sheet__back" id="cd-sheet-x">‹ Назад</button><div class="cd-sheet__t">Кому предложить?</div></div>
      ${tradeFromBoard ? '<div class="cd-steps">Обмен · шаг 4 из 4</div>' : ''}
      ${dealChip(tcState.give, wantId, num(tcState.coin))}
      <button class="cd-sheet__act" id="cd-trade-open">Всем на доску (открытый обмен)</button>
      <div class="cd-sect-t">Или выбери адресата</div>
      <div id="cd-trade-recip">${skeletonRows(2)}</div>`;
    sh.querySelector('#cd-sheet-x').onclick = () => openTradeCoins(tcState.want); // назад к шагу доплаты
    sh.querySelector('#cd-trade-open').onclick = () => submitTrade(null);
    const rec = await loadRecipients();
    const box = sh.querySelector('#cd-trade-recip');
    if (!box) return; // шит уже закрыт/сменился, пока грузили
    const rows = (Array.isArray(rec.friends) ? rec.friends : []).concat(rec.squad, rec.refs);
    box.innerHTML = (rows.length
      ? rows.map(r => `<div class="cd-reciperow" data-chat="${r.chat}"><span>${esc(r.name)}</span></div>`).join('')
      : `<div style="color:var(--muted);font-size:12.5px;text-align:center;padding:8px 0">Пока нет знакомых — предложи всем на доску</div>`)
      + `<button class="cd-tbtn cd-tbtn--ghost" id="cd-tr-addfr" style="width:100%;box-sizing:border-box;margin-top:4px">＋ Позвать друга по ссылке</button>`;
    box.querySelectorAll('.cd-reciperow').forEach(el => { el.onclick = () => submitTrade(Number(el.dataset.chat)); });
    const addFr = box.querySelector('#cd-tr-addfr'); if (addFr) addFr.onclick = () => shareFriendLink(rec);
  }
  const TRADE_CREATE_REASON = { bad_input: 'Неверный выбор породы', self: 'Нельзя предложить самому себе', limit: 'Не больше 3 предложений одновременно', need_duplicate: 'Отдать можно только запасного', no_player: 'Игрок не найден', bad_coins: 'Неверная сумма доплаты', not_enough_coins: 'Не хватает монет на доплату' };
  async function submitTrade(to) {
    if (busy || !tcState) return; busy = true;
    try {
      const body = { give: tcState.give, want: tcState.want, coinDelta: num(tcState.coin) };
      if (to != null) body.to = to;
      const d = await apiRef('/api/pigeons/trade', { method: 'POST', body: JSON.stringify(body) }).catch(() => null);
      if (d && d.ok) {
        haptic('medium'); flash('Предложение создано');
        if (typeof window.ckSyncState === 'function' && typeof d.newBalance === 'number') window.ckSyncState({ balance: d.newBalance }); // доплата ушла в эскроу
        tcState = null; tradeFromBoard = false; tradeTargetFriend = null;
        await load(); render();       // альбом обновился (запасной дубль ушёл в эскроу)
        tradesTab = 'mine';
        openTradesPage();             // возвращаемся на доску, вкладка «Мои» — видно новое предложение
      } else {
        flash(TRADE_CREATE_REASON[d && d.error] || 'Не получилось создать предложение');
      }
    } finally { busy = false; }
  }

  // ── Покупка закрытой породы за монеты кликера (цены — зеркало PIGEON_PRICE) ──
  let buyBusy = false;
  function pigeonBuyBalance() { return typeof window.ckBalance === 'function' ? num(window.ckBalance()) : 0; }
  async function buyPigeonAct(breed, redraw) {
    if (buyBusy) return; buyBusy = true;
    const b = BY_ID.get(breed);
    const d = await apiRef('/api/pigeons/buy', { method: 'POST', body: JSON.stringify({ breed }) }).catch(() => null);
    buyBusy = false;
    if (!d || d.error) {
      flash(d && d.error === 'not_enough_coins' ? 'Не хватает монет' : d && d.error === 'not_buyable' ? 'Эту породу не купить' : 'Не получилось купить');
      return;
    }
    haptic('success');
    // Обновляем инвентарь с сервера: покупка может закрыть сет, а sets.owned/claimed живут в /api/pigeons.
    const inv = data.invMap[breed] || { count: 0, stars: 1, showcase: 0 };
    inv.count = num(inv.count) + 1; data.invMap[breed] = inv;
    if (typeof window.ckSyncState === 'function' && typeof d.newBalance === 'number') window.ckSyncState({ balance: d.newBalance });
    await load();
    needsRerenderOnClose = true;
    const ready = (data.sets || []).find(s => num(s.owned) >= 4 && !s.claimed);
    const bought = data.invMap[breed];
    flash(ready ? 'Сет собран — забери награду!' : d.isNew ? (b ? b.name : 'Голубь') + ' теперь твой! Гоняй в Драг-заезде' : `Дубль добавлен · запасных: ${Math.max(0, num(bought && bought.count) - 1)}`);
    if (redraw) redraw();
  }

  // ── Обмены: доска (Мне/Доска/Мои) ───────────────────────────────────────────
  async function openTradesPage() {
    haptic('light');
    const sc = container.querySelector('#cd-scrim'), sh = container.querySelector('#cd-sheet');
    if (!sc || !sh) return;
    sh.innerHTML = `<div class="cd-sheet__hd"><button class="cd-sheet__back" id="cd-sheet-x">‹ Назад</button><div class="cd-sheet__t">Обмены</div></div>
      <div class="cd-sheet__hint" style="margin-top:2px">Меняйся дублями пород с другими игроками</div>
      <button class="cd-sheet__act" id="cd-trade-create">${SWAP_ICON(15)} Предложить обмен</button>
      <div class="cd-subtabs" id="cd-trade-tabs">
        <button class="cd-subtab" data-t="toMe" type="button">Входящие<span class="cd-subcount" id="cd-sc-toMe" style="display:none"></span></button>
        <button class="cd-subtab" data-t="open" type="button">Доска</button>
        <button class="cd-subtab" data-t="mine" type="button">Мои<span class="cd-subcount" id="cd-sc-mine" style="display:none"></span></button>
      </div>
      <div id="cd-trade-list">${skeletonRows(3)}</div>`;
    sc.classList.add('on');
    requestAnimationFrame(() => sh.classList.add('on'));
    sh.querySelector('#cd-sheet-x').onclick = closeSheet;
    sh.querySelector('#cd-trade-create').onclick = () => { tradeTargetFriend = null; openTradeGive(); };
    sh.querySelectorAll('.cd-subtab').forEach(b => { b.onclick = () => { tradesTab = b.dataset.t; renderTradesTab(); }; });
    // Мгновенный рендер из кэша (refreshTradesBadge мог уже подтянуть доску), затем свежий запрос.
    if (tradesCache) { if (!tradesCache.toMe.length && tradesTab === 'toMe') tradesTab = tradesCache.open.length ? 'open' : 'toMe'; renderTradesTab(); }
    const d = await apiRef('/api/pigeons/trades').catch(() => null);
    tradesCache = (d && Array.isArray(d.open)) ? d : (tradesCache || { open: [], toMe: [], mine: [] });
    incomingTrades = tradesCache.toMe.length; updateTradesBadgeDom();
    if (!container.querySelector('#cd-trade-list')) return; // закрыто, пока грузили
    if (!tradesCache.toMe.length && tradesTab === 'toMe') tradesTab = tradesCache.open.length ? 'open' : 'toMe';
    renderTradesTab();
  }
  function updateSubCounts() {
    const sh = container.querySelector('#cd-sheet'); if (!sh || !tradesCache) return;
    const set = (id, n) => { const el = sh.querySelector(id); if (!el) return; if (n > 0) { el.textContent = n > 9 ? '9+' : n; el.style.display = ''; } else el.style.display = 'none'; };
    set('#cd-sc-toMe', (tradesCache.toMe || []).length);
    set('#cd-sc-mine', (tradesCache.mine || []).length);
  }
  function renderTradesTab() {
    const sh = container.querySelector('#cd-sheet');
    if (!sh || !tradesCache) return;
    sh.querySelectorAll('.cd-subtab').forEach(b => b.classList.toggle('on', b.dataset.t === tradesTab));
    updateSubCounts();
    const box = sh.querySelector('#cd-trade-list');
    if (!box) return;
    const list = tradesCache[tradesTab] || [];
    if (!list.length) {
      box.innerHTML = emptyState('Пусто', tradesTab === 'mine' ? 'У тебя нет активных предложений. Нажми «Предложить обмен» выше.' : tradesTab === 'toMe' ? 'Тебе пока никто не предлагал обмен.' : 'На доске пусто. Нажми «Предложить обмен» — и оно появится тут для всех.');
      return;
    }
    box.innerHTML = list.map(t => tradeRowHtml(t, tradesTab)).join('');
    box.querySelectorAll('[data-accept]').forEach(el => { el.onclick = () => acceptTradeAct(Number(el.dataset.accept), el); });
    box.querySelectorAll('[data-cancel]').forEach(el => { el.onclick = () => cancelTradeAct(Number(el.dataset.cancel), el); });
    box.querySelectorAll('[data-decline]').forEach(el => { el.onclick = () => declineTradeAct(Number(el.dataset.decline), el); });
  }
  function tradeRowHtml(t, kind) {
    const give = BY_ID.get(t.give), want = BY_ID.get(t.want);
    const coin = num(t.coinDelta);
    const bal = typeof window.ckBalance === 'function' ? num(window.ckBalance()) : 0;
    // Принять чужой обмен можно, если: есть ЗАПАСНОЙ дубль запрашиваемой породы (база остаётся
    // у тебя) И (если создатель просит доплату, coin<0) хватает монет на доплату. Гасим заранее.
    const wantInv = data.invMap[t.want];
    const haveSpare = !!wantInv && num(wantInv.count) > 1;
    const canPayCoin = coin >= 0 || bal >= -coin;   // coin<0 → принимающий доплачивает -coin
    const canFulfill = kind === 'mine' || (haveSpare && canPayCoin);
    // Метка монет: coin>0 создатель доплачивает → принимающий ПОЛУЧИТ; coin<0 → принимающий ДОПЛАТИТ
    const coinTag = coin > 0 ? `<span class="cd-deal__coin">получишь +${fmt(coin)}</span>`
      : coin < 0 ? `<span class="cd-deal__coin">+ доплата ${fmt(-coin)}</span>` : '';
    const btn = kind === 'mine'
      ? `<button class="cd-tbtn cd-tbtn--ghost" data-cancel="${t.id}">Отменить</button>`
      : kind === 'toMe'
      ? `<button class="cd-tbtn" data-accept="${t.id}"${canFulfill ? '' : ' disabled'}>Принять</button><button class="cd-tbtn cd-tbtn--ghost" data-decline="${t.id}">Отказаться</button>`
      : `<button class="cd-tbtn" data-accept="${t.id}"${canFulfill ? '' : ' disabled'}>Принять</button>`;
    // meta: почему нельзя принять — приоритет «нет запасного», затем «мало монет»
    const why = !haveSpare ? `нужен запасной «${want ? want.name : t.want}» — сейчас его нет`
      : !canPayCoin ? `нужно ещё ${fmt(-coin - bal)} монет на доплату` : '';
    const meta = kind === 'mine'
      ? 'от тебя' + (coin > 0 ? ` · доплачиваешь ${fmt(coin)}` : coin < 0 ? ` · просишь ${fmt(-coin)}` : '')
      : (canFulfill ? 'от ' + esc(t.fromName) + ` · отдашь запасного «${want ? want.name : t.want}»` : why);
    return `<div class="cd-traderow${canFulfill ? '' : ' cd-traderow--locked'}">
      <div class="cd-traderow__swap">
        <div class="cd-traderow__art" data-r="${give ? give.rarity : 'common'}"><img src="/img/pigeons/${t.give}.webp?v=2" alt="" onerror="this.style.display='none'"></div>
        <span class="cd-traderow__arrow">→</span>
        <div class="cd-traderow__art" data-r="${want ? want.rarity : 'common'}"><img src="/img/pigeons/${t.want}.webp?v=2" alt="" onerror="this.style.display='none'"></div>
        <div style="min-width:0;flex:1">
          <div style="font-size:11.5px;color:var(--ink);font-weight:700">${give ? give.name : t.give} → ${want ? want.name : t.want}${coinTag ? ' · ' + coinTag : ''}</div>
          <div class="cd-traderow__meta">${meta}</div>
        </div>
      </div>
      <div class="cd-traderow__act">${btn}</div>
    </div>`;
  }
  const TRADE_ACCEPT_REASON = { gone: 'Предложение уже разобрали', own: 'Это твоё предложение', not_addressed: 'Предложение не для тебя', need_duplicate: 'Отдать можно только запасного', not_enough_coins: 'Не хватает монет на доплату' };
  async function acceptTradeAct(id, btn) {
    if (busy) return; busy = true; if (btn) btn.disabled = true;
    try {
      const d = await apiRef('/api/pigeons/trade/accept', { method: 'POST', body: JSON.stringify({ id }) }).catch(() => null);
      if (d && d.ok) {
        haptic('medium'); flash('Обмен состоялся!');
        if (typeof window.ckSyncState === 'function' && typeof d.newBalance === 'number') window.ckSyncState({ balance: d.newBalance }); // доплата зачтена
        needsRerenderOnClose = true;
        await load();
        const list = await apiRef('/api/pigeons/trades').catch(() => null);
        tradesCache = (list && Array.isArray(list.open)) ? list : tradesCache;
        incomingTrades = (tradesCache.toMe || []).length; updateTradesBadgeDom();
        renderTradesTab();
      } else {
        flash(TRADE_ACCEPT_REASON[d && d.error] || 'Не получилось принять обмен');
        if (btn) btn.disabled = false;
      }
    } finally { busy = false; }
  }
  const TRADE_DECLINE_REASON = { gone: 'Предложение уже разобрали' };
  async function declineTradeAct(id, btn) {
    if (busy) return; busy = true; if (btn) btn.disabled = true;
    try {
      const d = await apiRef('/api/pigeons/trade/decline', { method: 'POST', body: JSON.stringify({ id }) }).catch(() => null);
      if (d && d.ok) {
        haptic('light'); flash('Ты отказался от обмена');
        needsRerenderOnClose = true;
        const list = await apiRef('/api/pigeons/trades').catch(() => null);
        tradesCache = (list && Array.isArray(list.open)) ? list : tradesCache;
        incomingTrades = (tradesCache.toMe || []).length; updateTradesBadgeDom();
        renderTradesTab();
      } else {
        flash(TRADE_DECLINE_REASON[d && d.error] || 'Не получилось отказаться');
        if (btn) btn.disabled = false;
      }
    } finally { busy = false; }
  }
  const TRADE_CANCEL_REASON = { gone: 'Предложение уже разобрали' };
  async function cancelTradeAct(id, btn) {
    if (busy) return; busy = true; if (btn) btn.disabled = true;
    try {
      const d = await apiRef('/api/pigeons/trade/cancel', { method: 'POST', body: JSON.stringify({ id }) }).catch(() => null);
      if (d && d.ok) {
        haptic('light'); flash('Предложение отменено');
        if (typeof window.ckSyncState === 'function' && typeof d.newBalance === 'number') window.ckSyncState({ balance: d.newBalance }); // эскроу-монеты вернулись
        needsRerenderOnClose = true;
        await load();
        const list = await apiRef('/api/pigeons/trades').catch(() => null);
        tradesCache = (list && Array.isArray(list.open)) ? list : tradesCache;
        incomingTrades = (tradesCache.toMe || []).length; updateTradesBadgeDom();
        renderTradesTab();
      } else {
        flash(TRADE_CANCEL_REASON[d && d.error] || 'Не получилось отменить');
        if (btn) btn.disabled = false;
      }
    } finally { busy = false; }
  }

  // ── Почта: входящие + «Поблагодарить» ───────────────────────────────────────
  function mailShellHtml() {
    return `<div class="cd-sheet__hd"><button class="cd-sheet__back" id="cd-sheet-x">‹ Назад</button><div class="cd-sheet__t">Почта</div></div>
      <button class="cd-sheet__act" id="cd-mail-send">${SWAP_ICON(15)} Отправить голубя</button>
      <div id="cd-mail-list"></div>`;
  }
  function wireMailShell(sh) {
    sh.querySelector('#cd-sheet-x').onclick = closeSheet;
    sh.querySelector('#cd-mail-send').onclick = openMailSendBreed;
  }
  async function openMailPage() {
    haptic('light');
    const sc = container.querySelector('#cd-scrim'), sh = container.querySelector('#cd-sheet');
    if (!sc || !sh) return;
    sh.innerHTML = mailShellHtml();
    wireMailShell(sh);
    sh.querySelector('#cd-mail-list').innerHTML = skeletonRows(3);
    sc.classList.add('on');
    requestAnimationFrame(() => sh.classList.add('on'));
    const d = await apiRef('/api/pigeons/mail').catch(() => null);
    mailCache = (d && Array.isArray(d.mail)) ? d.mail : [];
    // GET /api/pigeons/mail помечает письма прочитанными на сервере — синхронизируем
    // бейдж на кнопке навбара catclick.js (Голуби<span id="ck-dove-badge">) сразу.
    if (window.ckUpdateDoveBadge) window.ckUpdateDoveBadge(0);
    if (data) data.unreadMail = 0;
    if (!container.querySelector('#cd-mail-list')) return; // закрыто, пока грузили
    renderMailList();
  }
  function showMailShellFromCache() {
    const sh = container.querySelector('#cd-sheet');
    if (!sh) return;
    sh.innerHTML = mailShellHtml();
    wireMailShell(sh);
    renderMailList();
  }
  function renderMailList() {
    const sh = container.querySelector('#cd-sheet');
    if (!sh || !mailCache) return;
    const box = sh.querySelector('#cd-mail-list');
    if (!box) return;
    if (!mailCache.length) { box.innerHTML = emptyState('Пусто', 'Голуби ещё не прилетали — отправь первым!'); return; }
    box.innerHTML = mailCache.map(mailCardHtml).join('');
    box.querySelectorAll('[data-thank]').forEach(el => { el.onclick = () => openThanksPicker(Number(el.dataset.thank)); });
  }
  function mailCardHtml(m) {
    const b = BY_ID.get(m.breed);
    const thanked = m.thanksSticker != null;
    return `<div class="cd-mailcard">
      <div class="cd-mailcard__top">
        <div class="cd-mailcard__art"><img src="/img/pigeons/${m.breed}.webp?v=2" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span style="display:none;align-items:center;justify-content:center;width:100%;height:100%">${DOVE_ICON(18)}</span></div>
        <div class="cd-mailcard__b">
          <div class="cd-mailcard__n">${b ? b.name : m.breed}</div>
          <div class="cd-mailcard__phrase">«${STICKERS[m.sticker] || ''}»</div>
          <div class="cd-mailcard__from">от ${esc(m.fromName)}</div>
        </div>
      </div>
      ${thanked
        ? `<div style="font-size:11px;color:var(--muted);margin-top:8px">Ты поблагодарил: «${STICKERS[m.thanksSticker] || ''}»</div>`
        : `<button class="cd-tbtn cd-mailcard__thanks" data-thank="${m.id}">Поблагодарить</button>`}
    </div>`;
  }
  function openThanksPicker(mailId) {
    const sh = container.querySelector('#cd-sheet');
    if (!sh) return;
    sh.innerHTML = `<div class="cd-sheet__hd"><button class="cd-sheet__back" id="cd-sheet-x">‹ Назад</button><div class="cd-sheet__t">Выбери стикер</div></div>${stickerListHtml()}`;
    sh.querySelector('#cd-sheet-x').onclick = closeSheet;
    sh.querySelectorAll('.cd-reciperow').forEach(el => { el.onclick = () => thanksAct(mailId, Number(el.dataset.sticker)); });
  }
  async function thanksAct(mailId, sticker) {
    if (busy) return; busy = true;
    try {
      const d = await apiRef('/api/pigeons/mail/thanks', { method: 'POST', body: JSON.stringify({ id: mailId, sticker }) }).catch(() => null);
      if (d && d.ok) {
        haptic('light'); flash('Спасибо отправлено!');
        const m = mailCache && mailCache.find(x => x.id === mailId); if (m) m.thanksSticker = sticker;
        showMailShellFromCache();
      } else {
        flash('Не получилось отправить спасибо');
        showMailShellFromCache();
      }
    } finally { busy = false; }
  }

  // ── Почта: отправка (дубликат → адресат → стикер) ──────────────────────────
  function openMailSendBreed() {
    msState = {};
    haptic('light');
    const spares = Object.keys(data.invMap).filter(id => data.invMap[id].count > 1);
    const sh = container.querySelector('#cd-sheet');
    if (!sh) return;
    if (!spares.length) {
      sh.innerHTML = `<div class="cd-sheet__hd"><button class="cd-sheet__back" id="cd-sheet-x">‹ Назад</button><div class="cd-sheet__t">Отправить голубя</div></div>${emptyState('Нечего отправить', 'Нужен хотя бы один запасной дубликат породы.')}`;
      sh.querySelector('#cd-sheet-x').onclick = closeSheet;
      return;
    }
    sh.innerHTML = `<div class="cd-sheet__hd"><button class="cd-sheet__back" id="cd-sheet-x">‹ Назад</button><div class="cd-sheet__t">Кого отправишь?</div></div>
      <div class="cd-steps">Отправка · шаг 1 из 3</div>
      <div class="cd-sheet__hint" style="margin-top:0">Улетит запасной дубль — базовый голубь остаётся у тебя</div>
      ${pickGridHtml(spares, null)}`;
    sh.querySelector('#cd-sheet-x').onclick = closeSheet;
    sh.querySelectorAll('.cd-pickcard').forEach(el => { el.onclick = () => openMailSendRecipient(el.dataset.breed); });
  }
  // Шаринг «кода дружбы»: получатель кликает ссылку — бот связывает вас взаимно.
  function fallbackFriendLink() {
    try {
      const u = window.App && App.user && App.user();
      const id = u && Number(u.id);
      if (!Number.isFinite(id) || id <= 0) return '';
      const internal = App.platform === 'vk' ? 2000000000000 + id : App.platform === 'max' ? 4000000000000 + id : id;
      return `https://t.me/mariatortik_bot?start=ckfr_${Math.floor(internal)}`;
    } catch (_) { return ''; }
  }
  function shareFriendLink(rec) {
    const link = (rec && rec.friendLink) || fallbackFriendLink();
    if (!link) { flash('Ссылка дружбы недоступна'); return; }
    haptic('light');
    const text = '🕊️ Добавь меня в друзья в «Котик Комбат» — будем слать друг другу голубей и меняться породами!';
    const full = `${text} ${link}`;
    if (window.App && App.share) { App.share(link, text); return; }
    if (navigator.share) { navigator.share({ url: link, text }).catch(() => copyFriendLink(full)); return; }
    copyFriendLink(full);
  }
  function copyFriendLink(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => flash('Ссылка скопирована'), () => flash(text));
        return;
      }
    } catch (_) {}
    flash(text);
  }
  async function openMailSendRecipient(breedId) {
    if (!msState) return;
    msState.breed = breedId;
    haptic('light');
    const sh = container.querySelector('#cd-sheet');
    if (!sh) return;
    sh.innerHTML = `<div class="cd-sheet__hd"><button class="cd-sheet__back" id="cd-sheet-x">‹ Назад</button><div class="cd-sheet__t">Кому отправить?</div></div>
      <div class="cd-steps">Отправка · шаг 2 из 3</div>
      <div class="cd-deal"><img src="/img/pigeons/${breedId}.webp?v=2" alt="" onerror="this.style.display='none'"><span>${BY_ID.get(breedId).name}</span><span class="cd-deal__arw">→</span><span style="color:var(--muted)">кому?</span></div>
      <button class="cd-sheet__act" id="cd-ms-random">Случайному игроку</button>
      <div class="cd-sect-t">Друзья</div>
      <div id="cd-ms-friends">${skeletonRows(1)}</div>
      <div class="cd-sect-t">Однокомандцы</div>
      <div id="cd-ms-squad">${skeletonRows(2)}</div>
      <div class="cd-sect-t">Рефералы</div>
      <div id="cd-ms-refs">${skeletonRows(2)}</div>`;
    sh.querySelector('#cd-sheet-x').onclick = openMailSendBreed; // назад к выбору голубя
    sh.querySelector('#cd-ms-random').onclick = () => openMailSendSticker('random');
    const rec = await loadRecipients();
    const frBox = sh.querySelector('#cd-ms-friends'), sqBox = sh.querySelector('#cd-ms-squad'), rfBox = sh.querySelector('#cd-ms-refs');
    if (!frBox || !sqBox || !rfBox) return; // шит уже закрыт/сменился, пока грузили
    const friends = Array.isArray(rec.friends) ? rec.friends : [];
    frBox.innerHTML = (friends.length
      ? friends.map(r => `<div class="cd-reciperow" data-chat="${r.chat}"><span>${esc(r.name)}</span></div>`).join('')
      : '')
      + `<button class="cd-tbtn cd-tbtn--ghost" id="cd-ms-addfr" style="width:100%;box-sizing:border-box;margin-bottom:7px">＋ Позвать друга по ссылке</button>`;
    sqBox.innerHTML = rec.squad.length
      ? rec.squad.map(r => `<div class="cd-reciperow" data-chat="${r.chat}"><span>${esc(r.name)}</span></div>`).join('')
      : `<button class="cd-tbtn cd-tbtn--ghost" id="cd-ms-jointeam" style="width:100%;box-sizing:border-box;margin-bottom:7px">Вступить в команду — в «Рейтинге»</button>`;
    rfBox.innerHTML = rec.refs.length
      ? rec.refs.map(r => `<div class="cd-reciperow" data-chat="${r.chat}"><span>${esc(r.name)}</span></div>`).join('')
      : `<div style="color:var(--muted);font-size:12px;padding:4px 2px 10px">Рефералы из общей игры появятся тут отдельно. Для голубиной дружбы используй кнопку «Позвать друга по ссылке» выше.</div>`;
    const addFr = sh.querySelector('#cd-ms-addfr'); if (addFr) addFr.onclick = () => shareFriendLink(rec);
    const joinT = sh.querySelector('#cd-ms-jointeam'); if (joinT) joinT.onclick = () => { closeSheet(); if (window.ckSetTab) window.ckSetTab('top'); };
    [frBox, sqBox, rfBox].forEach(box => box.querySelectorAll('.cd-reciperow').forEach(el => { el.onclick = () => openMailSendSticker(Number(el.dataset.chat)); }));
  }
  function openMailSendSticker(to) {
    if (!msState) return;
    msState.to = to;
    haptic('light');
    const sh = container.querySelector('#cd-sheet');
    if (!sh) return;
    sh.innerHTML = `<div class="cd-sheet__hd"><button class="cd-sheet__back" id="cd-sheet-x">‹ Назад</button><div class="cd-sheet__t">Что напишешь?</div></div>
      <div class="cd-steps">Отправка · шаг 3 из 3</div>
      <div class="cd-sheet__hint" style="margin-top:0">Стикер-подпись Василия к твоему голубю</div>
      ${stickerListHtml()}`;
    sh.querySelector('#cd-sheet-x').onclick = () => openMailSendRecipient(msState.breed); // назад к выбору адресата
    sh.querySelectorAll('.cd-reciperow').forEach(el => { el.onclick = () => submitMail(Number(el.dataset.sticker)); });
  }
  const MAIL_SEND_REASON = {
    bad_breed: 'Неизвестная порода', bad_sticker: 'Неверный стикер',
    bad_input: 'Не получилось отправить — проверь выбор',
    daily_limit: 'Голубь уже улетел сегодня — приходи завтра',
    no_players: 'Нет активных игроков рядом', no_player: 'Игрок не найден',
    self: 'Нельзя отправить самому себе', need_duplicate: 'Отдать можно только запасного',
    no_squad: 'Ты не в команде',
  };
  async function submitMail(sticker) {
    if (busy || !msState) return; busy = true;
    try {
      const d = await apiRef('/api/pigeons/mail', { method: 'POST', body: JSON.stringify({ breed: msState.breed, to: msState.to, sticker }) }).catch(() => null);
      if (d && d.ok) {
        haptic('medium'); flash('Голубь отправлен!');
        msState = null;
        closeSheet();
        await load(); render();
      } else {
        flash(MAIL_SEND_REASON[d && d.error] || 'Не получилось отправить');
      }
    } finally { busy = false; }
  }

  // ── Гонка стаи (за флагом PIGEON_RACE_ENABLED — секция не рисуется, пока сервер
  // не вернёт enabled=true). Прошлонедельные результаты хранят только chat_id, а
  // клиент не знает свой chat_id (нет такого поля в App-мосте catclick.js) — «своё
  // место» намеренно НЕ подсвечиваем, честно показываем весь топ без выделения.
  function divChip(d) {
    const names = { gold: 'Золото', silver: 'Серебро', bronze: 'Бронза' };
    return names[d] ? `<span class="cd-divchip cd-divchip--${d}">${names[d]}</span>` : '';
  }
  function raceRow(r, d) {
    const b = BY_ID.get(r.breed);
    const place = num(r.place);
    const top = place === 1;
    return `<div class="cd-racerow${top ? ` cd-racerow--top cd-racerow--${d}` : ''}">
      <span class="cd-medal ${top ? `cd-medal--${d}` : 'cd-medal--dim'}">${place}</span>
      <div class="cd-racerow__art"><img src="/img/pigeons/${r.breed}.webp?v=2" alt="" onerror="this.style.display='none'"></div>
      <div class="cd-racerow__b"><div class="cd-racerow__n">${b ? b.name : r.breed}</div><div class="cd-racerow__s">${num(r.score)} ${plu(num(r.score), 'очко', 'очка', 'очков')}</div></div>
      <div class="cd-racerow__prize">${COIN_ICON(12)} ${fmt(r.prize)}</div>
    </div>`;
  }
  // Есть ли что показывать в «Итогах недели» (объект по дивизионам {bronze:[],silver:[],gold:[]})
  function raceResults() {
    const lr = race && race.lastResults && typeof race.lastResults === 'object' && !Array.isArray(race.lastResults) ? race.lastResults : null;
    if (!lr || !['gold', 'silver', 'bronze'].some(d => Array.isArray(lr[d]) && lr[d].length)) return null;
    return lr;
  }
  // Экран «Гонки»: весь блок гонок (герой заезда, драг, таблица дивизиона, итоги недели)
  // вынесен в шит по кнопке — чтобы не хоронить альбом вверху вкладки. Открывается из
  // навбара голубятни (#cd-nav-race). Кнопки заезда/драга/итогов вешаются здесь.
  function openRacePage() {
    if (!data) return;
    haptic('light');
    const sc = container.querySelector('#cd-scrim'), sh = container.querySelector('#cd-sheet');
    if (!sc || !sh) return;
    sh.innerHTML = `<div class="cd-sheet__hd"><button class="cd-sheet__back" id="cd-sheet-x">‹ Назад</button><div class="cd-sheet__t">${FLAG_ICON(16)} Гонки</div></div>${raceHtml()}`;
    sc.classList.add('on');
    requestAnimationFrame(() => sh.classList.add('on'));
    sh.querySelector('#cd-sheet-x').onclick = closeSheet;
    const raceBtn = sh.querySelector('#cd-race-enter'); if (raceBtn) raceBtn.onclick = openRaceBreedPicker;
    const dragBtn = sh.querySelector('#cd-drag-enter'); if (dragBtn) dragBtn.onclick = openDragBreedPicker;
    const friendRaceBtn = sh.querySelector('#cd-friend-race-enter'); if (friendRaceBtn) friendRaceBtn.onclick = openFriendRaceFriendPicker;
    const resBtn = sh.querySelector('#cd-race-results'); if (resBtn) resBtn.onclick = openRaceResultsSheet;
  }
  function raceHtml() {
    return `<div class="cd-sect-t">Гонки голубей</div>
      <div class="cd-racehero">
        <div class="cd-racehero__bg"></div>
        <div class="cd-racehero__scrim"></div>
        <div class="cd-racehero__in">
          <div class="cd-racehero__b">
            <div class="cd-racehero__t">Тренировка и дуэли</div>
            <div class="cd-racehero__s">выбери голубя, сделай разгон тапами и сразу увидь честный результат</div>
          </div>
        </div>
        <div class="cd-racehero__acts">
          <button class="cd-ctabtn" id="cd-drag-enter">${FLAG_ICON(14)} Тренировка</button>
          <button class="cd-ctabtn cd-ctabtn--ghost" id="cd-friend-race-enter">${USERS_ICON(14)} Дуэль с другом</button>
        </div>
      </div>
      <div class="cd-racenote"><b>Тренировка</b> — без ставки, чтобы проверить голубя и разгон. <b>Дуэль</b> — только вы вдвоём: оба выбираете голубя, оба тапаете, ставку забирает победитель.</div>`;
  }
  function fmtLeft(ts) {
    const ms = num(ts) - Date.now();
    if (ms <= 0) return 'считаются';
    const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000);
    return d > 0 ? `${d} д ${h} ч` : h > 0 ? `${h} ч` : 'меньше часа';
  }
  // Живая таблица моего дивизиона на ЭТОЙ неделе (топ-3 + моя строка, если ниже).
  function weekStandingsHtml() {
    if (!race || !Array.isArray(race.standings) || !race.standings.length || !race.myBreed) return '';
    const rows = [];
    race.standings.slice(0, 3).forEach((s, i) => rows.push([s, i + 1]));
    if (race.myPlace > 3) {
      const meRow = race.standings.find(s => s.me);
      if (meRow) rows.push([meRow, race.myPlace]);
    }
    const medal = (p) => p === 1 ? 'cd-medal--gold' : p === 2 ? 'cd-medal--silver' : p === 3 ? 'cd-medal--bronze' : 'cd-medal--dim';
    return rows.map(([s, p]) => {
      const b = BY_ID.get(s.breed);
      return `<div class="cd-racerow${s.me ? ' cd-racerow--top cd-racerow--gold' : ''}">
        <span class="cd-medal ${medal(p)}">${p}</span>
        <div class="cd-racerow__art"><img src="/img/pigeons/${s.breed}.webp?v=2" alt="" onerror="this.style.display='none'"></div>
        <div class="cd-racerow__b"><div class="cd-racerow__n">${b ? b.name : s.breed}${s.me ? ' · ты' : ''}</div><div class="cd-racerow__s">${fmt(s.score)} ${plu(num(s.score), 'очко', 'очка', 'очков')}</div></div>
      </div>`;
    }).join('');
  }
  // Шит «Итоги недели»: три дивизиона той же вёрсткой, что раньше в ленте.
  function openRaceResultsSheet() {
    const lr = raceResults(); if (!lr) return;
    haptic('light');
    const sc = container.querySelector('#cd-scrim'), sh = container.querySelector('#cd-sheet');
    if (!sc || !sh) return;
    const blocks = ['gold', 'silver', 'bronze'].map(d => {
      const arr = Array.isArray(lr[d]) ? lr[d] : [];
      if (!arr.length) return '';
      return `<div class="cd-divhead">${divChip(d)}<span class="cd-divhead__line"></span></div>${arr.map((r) => raceRow(r, d)).join('')}`;
    }).join('');
    sh.innerHTML = `<div class="cd-sheet__hd"><button class="cd-sheet__back" id="cd-sheet-x">‹ Назад</button><div class="cd-sheet__t">Итоги прошлой недели</div></div>${blocks}`;
    sc.classList.add('on');
    requestAnimationFrame(() => sh.classList.add('on'));
    sh.querySelector('#cd-sheet-x').onclick = closeSheet;
  }

  async function openFriendRaceFriendPicker() {
    if (!data) return;
    haptic('light');
    const sc = container.querySelector('#cd-scrim'), sh = container.querySelector('#cd-sheet');
    if (!sc || !sh) return;
    sh.innerHTML = `<div class="cd-sheet__hd"><button class="cd-sheet__back" id="cd-sheet-x">‹ Назад</button><div class="cd-sheet__t">Дуэли с друзьями</div></div><div id="cd-friend-race-list">${skeletonRows(3)}</div>`;
    sc.classList.add('on'); requestAnimationFrame(() => sh.classList.add('on'));
    sh.querySelector('#cd-sheet-x').onclick = openRacePage;
    const rec = await loadRecipients();
    const duels = await apiRef('/api/pigeons/drag/duels').catch(() => ({ incoming: [], outgoing: [], done: [] }));
    const friends = Array.isArray(rec.friends) ? rec.friends : [];
    const incoming = Array.isArray(duels.incoming) ? duels.incoming : [];
    const outgoing = Array.isArray(duels.outgoing) ? duels.outgoing : [];
    const box = sh.querySelector('#cd-friend-race-list'); if (!box) return;
    const incomingHtml = incoming.length
      ? `<div class="cd-sect-t">Тебя вызвали</div>${incoming.map(d => `<div class="cd-reciperow"><div class="cd-duel-in" data-id="${num(d.id)}" style="flex:1;min-width:0"><span>${esc(d.fromName || 'Друг')} · ${d.stake ? fmt(d.stake) + ' монет' : 'без ставки'}</span><small>нажми, чтобы принять и выбрать голубя</small></div><button class="cd-tbtn cd-tbtn--ghost cd-duel-decline" data-id="${num(d.id)}">Отказать</button></div>`).join('')}`
      : '';
    const outgoingHtml = outgoing.length
      ? `<div class="cd-sect-t">Ждут ответа</div>${outgoing.map(d => `<div class="cd-reciperow"><span>${esc(d.fromName || d.toName || 'Друг')} · ${fmt(d.stake || 0)}</span><small>друг ещё не выбрал голубя</small></div>`).join('')}`
      : '';
    const friendsHtml = friends.length
      ? `<div class="cd-sect-t">Создать дуэль</div>${friends.map(r => `<div class="cd-reciperow cd-duel-new" data-chat="${num(r.chat)}" data-name="${esc(r.name)}"><span>${esc(r.name)}</span><small>только вы вдвоём · можно со ставкой</small></div>`).join('')}`
      : `<div class="cd-sheet__hint">Сначала добавь друга по ссылке — после этого сможете вызывать друг друга на дуэль.</div>
        <button class="cd-sheet__act" id="cd-friend-race-link">${USERS_ICON(15)} Позвать друга</button>`;
    box.innerHTML = incomingHtml + outgoingHtml + friendsHtml;
    const byId = new Map(incoming.map(d => [num(d.id), d]));
    box.querySelectorAll('.cd-duel-in').forEach(el => { el.onclick = () => openFriendRaceAcceptBreedPicker(byId.get(num(el.dataset.id))); });
    box.querySelectorAll('.cd-duel-decline').forEach(el => { el.onclick = () => declineDuelAct(num(el.dataset.id), el); });
    box.querySelectorAll('.cd-duel-new').forEach(el => { el.onclick = () => openFriendRaceStakePicker({ chat: num(el.dataset.chat), name: el.dataset.name || 'Друг' }); });
    const btn = box.querySelector('#cd-friend-race-link'); if (btn) btn.onclick = shareFriendLink;
  }

  async function declineDuelAct(id, btn) {
    if (busy) return; busy = true; if (btn) btn.disabled = true;
    try {
      const d = await apiRef('/api/pigeons/drag/duel/decline', { method: 'POST', body: JSON.stringify({ id }) }).catch(() => null);
      if (d && d.ok) { haptic('light'); flash('Ты отказался от дуэли'); openFriendRaceFriendPicker(); }
      else { flash('Вызов уже недоступен'); if (btn) btn.disabled = false; }
    } finally { busy = false; }
  }

  function duelBalance() { return typeof window.ckBalance === 'function' ? num(window.ckBalance()) : 0; }
  function ensureDuelStake(stake) {
    const need = Math.max(0, num(stake)), balance = duelBalance();
    if (balance >= need) return true;
    flash(`Не хватает ${fmt(need - balance)} монет на ставку. Сейчас на балансе ${fmt(balance)}.`);
    return false;
  }

  function openFriendRaceStakePicker(friend) {
    if (!data || !friend || !friend.chat) return;
    const sc = container.querySelector('#cd-scrim'), sh = container.querySelector('#cd-sheet');
    if (!sc || !sh) return;
    sh.innerHTML = `<div class="cd-sheet__hd"><button class="cd-sheet__back" id="cd-sheet-x">‹ Назад</button><div class="cd-sheet__t">Ставка с ${esc(friend.name)}</div></div>
      <div class="cd-sheet__hint">Оба ставят одинаково. Победитель забирает банк. Можно выбрать готовую сумму или написать свою — до 1 000 000.</div>
      ${DUEL_STAKES.map(v => `<div class="cd-reciperow cd-duel-stake" data-stake="${v}"><span>${v ? `${fmt(v)} монет` : 'Без ставки'}</span><small>следующий шаг — выбрать голубя</small></div>`).join('')}
      <div style="display:flex;gap:8px;margin-top:10px"><input id="cd-duel-custom" inputmode="numeric" type="number" min="0" max="1000000" step="1" placeholder="Своя сумма" class="cd-cipher-in" style="text-transform:none"><button class="cd-tbtn" id="cd-duel-custom-go">Дальше</button></div>`;
    sc.classList.add('on'); requestAnimationFrame(() => sh.classList.add('on'));
    sh.querySelector('#cd-sheet-x').onclick = openFriendRaceFriendPicker;
    sh.querySelectorAll('.cd-duel-stake').forEach(el => { el.onclick = () => { const stake = num(el.dataset.stake); if (ensureDuelStake(stake)) openFriendRaceBreedPicker(friend, stake); }; });
    sh.querySelector('#cd-duel-custom-go').onclick = () => {
      const raw = Number(sh.querySelector('#cd-duel-custom').value);
      if (!Number.isSafeInteger(raw) || raw < 0 || raw > 1000000) { flash('Введи целую сумму от 0 до 1 000 000'); return; }
      if (ensureDuelStake(raw)) openFriendRaceBreedPicker(friend, raw);
    };
  }

  function openFriendRaceBreedPicker(friend, stake) {
    if (!data || !friend || !friend.chat) return;
    if (!ensureDuelStake(stake)) return;
    const owned = Object.keys(data.invMap).filter(id => data.invMap[id].count > 0 && id !== 'champion');
    if (!owned.length) { flash('Нет птицы для заезда'); return; }
    const sc = container.querySelector('#cd-scrim'), sh = container.querySelector('#cd-sheet');
    if (!sc || !sh) return;
    sh.innerHTML = `<div class="cd-sheet__hd"><button class="cd-sheet__back" id="cd-sheet-x">‹ Назад</button><div class="cd-sheet__t">Кто гонится с ${esc(friend.name)}?</div></div>${pickGridHtml(owned, null)}`;
    sc.classList.add('on'); requestAnimationFrame(() => sh.classList.add('on'));
    sh.querySelector('#cd-sheet-x').onclick = () => openFriendRaceStakePicker(friend);
    sh.querySelectorAll('.cd-pickcard').forEach(el => {
      el.onclick = () => {
        const breedId = el.dataset.breed;
        if (!ensureDuelStake(stake)) return;
        closeSheet();
        if (window.CatDrag && window.CatDrag.openDuelCreate) window.CatDrag.openDuelCreate(apiRef, breedId, friend.chat, friend.name, stake);
      };
    });
  }

  function openFriendRaceAcceptBreedPicker(duel) {
    if (!data || !duel || !duel.id) return;
    if (!ensureDuelStake(duel.stake || 0)) return;
    const owned = Object.keys(data.invMap).filter(id => data.invMap[id].count > 0 && id !== 'champion');
    if (!owned.length) { flash('Нет птицы для заезда'); return; }
    const sc = container.querySelector('#cd-scrim'), sh = container.querySelector('#cd-sheet');
    if (!sc || !sh) return;
    sh.innerHTML = `<div class="cd-sheet__hd"><button class="cd-sheet__back" id="cd-sheet-x">‹ Назад</button><div class="cd-sheet__t">Ответить ${esc(duel.fromName || 'другу')}</div></div>${pickGridHtml(owned, null)}`;
    sc.classList.add('on'); requestAnimationFrame(() => sh.classList.add('on'));
    sh.querySelector('#cd-sheet-x').onclick = openFriendRaceFriendPicker;
    sh.querySelectorAll('.cd-pickcard').forEach(el => {
      el.onclick = () => {
        const breedId = el.dataset.breed;
        if (!ensureDuelStake(duel.stake || 0)) return;
        closeSheet();
        if (window.CatDrag && window.CatDrag.openDuelAccept) window.CatDrag.openDuelAccept(apiRef, breedId, duel.id, duel.fromName || 'Друг', duel.stake || 0);
      };
    });
  }
  // Драг-заезд (отдельный always-on режим поверх недельной гонки, catdrag.js) — выбор
  // владеемой породы через тот же пикер-шит, что и заявка на недельную гонку.
  function openDragBreedPicker() {
    if (!data) return;
    const owned = Object.keys(data.invMap).filter(id => data.invMap[id].count > 0);
    if (!owned.length) { flash('Нет ни одной птицы для заезда'); return; }
    haptic('light');
    const sc = container.querySelector('#cd-scrim'), sh = container.querySelector('#cd-sheet');
    if (!sc || !sh) return;
    sh.innerHTML = `<div class="cd-sheet__hd"><button class="cd-sheet__back" id="cd-sheet-x">‹ Назад</button><div class="cd-sheet__t">Кто едет в драг-заезде?</div></div>${pickGridHtml(owned, null)}`;
    sc.classList.add('on');
    requestAnimationFrame(() => sh.classList.add('on'));
    sh.querySelector('#cd-sheet-x').onclick = closeSheet;
    sh.querySelectorAll('.cd-pickcard').forEach(el => {
      el.onclick = () => {
        const breedId = el.dataset.breed;
        closeSheet();
        if (window.CatDrag) window.CatDrag.open(apiRef, breedId);
      };
    });
  }
  // Заявка недели = отборочный полёт (CatDrag.openQualify): прогрев + реакция дают
  // часть очков; после успешной заявки полёт сам дёргает refresh голубятни.
  function openRaceBreedPicker() {
    if (!data) return;
    const owned = Object.keys(data.invMap).filter(id => data.invMap[id].count > 0);
    if (!owned.length) { flash('Нет ни одной птицы для заявки'); return; }
    haptic('light');
    const sc = container.querySelector('#cd-scrim'), sh = container.querySelector('#cd-sheet');
    if (!sc || !sh) return;
    sh.innerHTML = `<div class="cd-sheet__hd"><button class="cd-sheet__back" id="cd-sheet-x">‹ Назад</button><div class="cd-sheet__t">Кто летит за стаю?</div></div>
      <div class="cd-sheet__hint">Отборочный полёт — одна попытка в неделю: прогрев и реакция добавляют очков</div>
      ${pickGridHtml(owned, null)}`;
    sc.classList.add('on');
    requestAnimationFrame(() => sh.classList.add('on'));
    sh.querySelector('#cd-sheet-x').onclick = closeSheet;
    sh.querySelectorAll('.cd-pickcard').forEach(el => {
      el.onclick = () => {
        const breedId = el.dataset.breed;
        closeSheet();
        if (window.CatDrag && window.CatDrag.openQualify) {
          window.CatDrag.openQualify(apiRef, breedId, async () => { await load(); render(); });
        }
      };
    });
  }

  // ── попап награды сета ───────────────────────────────────────────────────
  const CLAIM_REASON = { unknown_set: 'Такого сета нет', incomplete: 'Сет ещё не собран', already: 'Уже получено' };
  function closeRewardPopup() { const s = container.querySelector('#cd-pop-scrim'); if (s) s.classList.remove('on'); }
  function rewardPopup(amount) {
    const s = container.querySelector('#cd-pop-scrim'), p = container.querySelector('#cd-pop');
    if (!s || !p) return;
    p.innerHTML = `<h3>${DOVE_ICON(20)} Сет собран!</h3><div class="v">${COIN_ICON(26)} +${fmt(amount)}</div><button id="cd-pop-ok">Класс!</button>`;
    s.classList.add('on');
    s.onclick = (e) => { if (e.target === s) closeRewardPopup(); };
    p.querySelector('#cd-pop-ok').onclick = closeRewardPopup;
  }
  async function claimSetAct(setId, btn) {
    if (busy) return; busy = true; if (btn) btn.disabled = true;
    try {
      const d = await apiRef('/api/pigeons/set-claim', { method: 'POST', body: JSON.stringify({ set: setId }) }).catch(() => null);
      if (d && d.ok) {
        const s = data.sets.find(x => x.id === setId); if (s) s.claimed = true;
        if (typeof window.ckSyncState === 'function' && typeof d.newBalance === 'number') window.ckSyncState({ balance: d.newBalance });
        haptic('medium');
        render();
        rewardPopup(d.reward);
      } else {
        flash(CLAIM_REASON[d && d.error] || 'Не получилось забрать награду');
        if (btn) btn.disabled = false;
      }
    } finally { busy = false; }
  }

  // ── публичный API ────────────────────────────────────────────────────────
  async function mount(el, api) {
    container = el; apiRef = api || window.ckApi;
    styles();
    container.innerHTML = skeleton();
    mountReady = load();
    await mountReady;
    render();
    mountReady = null;
  }

  async function refreshBadge() {
    const api = apiRef || window.ckApi;
    if (!api || !authed()) return;
    const d = await api('/api/pigeons').catch(() => null);
    if (d && window.ckUpdateDoveBadge) window.ckUpdateDoveBadge(num(d.unreadMail));
  }

  // Публичный хелпер для лидерборда (catclick.js::renderTop) — рендерит до 3 мини-иконок
  // витрины (12-14px, рамка редкости), т.к. catclick не имеет доступа к каталогу пород/
  // цветам редкости из catdove.js. Работает независимо от mount() (сам гарантирует CSS).
  // showcase: {breed,stars}[] из GET /api/clicker/top::top[].showcase — может отсутствовать
  // (старый закэшированный клиент) или быть пустым, тогда возвращаем ''.
  function miniIconsHtml(showcase) {
    if (!Array.isArray(showcase) || !showcase.length) return '';
    styles();
    const items = showcase.slice(0, 3).map((it) => {
      const id = it && typeof it.breed === 'string' ? it.breed : '';
      if (!id) return '';
      const b = BY_ID.get(id);
      const rarity = b ? b.rarity : 'common';
      const artSrc = `/img/pigeons/${esc(id)}.webp?v=2`;
      return `<span class="cd-mini" data-r="${rarity}"><img src="${artSrc}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span style="display:none;align-items:center;justify-content:center;width:100%;height:100%">${DOVE_ICON(8)}</span></span>`;
    }).join('');
    return items ? `<span class="cd-mini-row">${items}</span>` : '';
  }

  async function openIncomingDuel(duel) {
    if (!duel || !duel.id) return;
    if (mountReady) await mountReady;
    if (!data) { await load(); render(); }
    openFriendRaceAcceptBreedPicker(duel);
  }

  window.CatDove = { mount, refreshBadge, miniIconsHtml, openIncomingDuel, openDuels: openFriendRaceFriendPicker };
})();

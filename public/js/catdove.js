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
  // 4 сета × 4 + «Чемпион» вне сетов (только приз гонки) — зеркало src/pigeons.ts::PIGEON_BREEDS
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
    { id: "champion", name: "Чемпион",            set: "",      rarity: "legendary" }, // не дропается
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

  function svg(inner, s) { return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`; }
  // Плейсхолдер до готового арта: тот же силуэт голубя, что ICON.dove в catclick — своя
  // копия тут, catdove.js работает как отдельный модуль без чтения приватных функций catclick.
  const DOVE_ICON = (s) => svg('<path d="M21 7c-1.2.8-2.2.9-3 .4-1.6-1-4-.6-5.5 1.2C11 10.4 8.6 11.4 5 11.4c1.3 1.8 3.6 2.7 6 2.2-.9 2.2-2.7 3.6-5 4 2.3 1.4 5.5 1.4 8-.6 2-1.6 3-4 3-6.6 0-.9.4-1.7 1.2-2.2M8.5 18 7 21M12.5 17.5 12 21"/>', s || 26);
  const COIN_ICON = (s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><use href="#ckSymCoin"/></svg>`;
  const SWAP_ICON = (s) => svg('<path d="M4 7h13m0 0-3.5-3.5M17 7l-3.5 3.5M20 17H7m0 0 3.5-3.5M7 17l3.5 3.5"/>', s || 16);
  const MAILBOX_ICON = (s) => svg('<path d="M4 6.5 12 12l8-5.5"/><rect x="4" y="6.5" width="16" height="11" rx="2"/>', s || 16);

  function authed() { return !!(window.App && App.isAuthed && App.isAuthed()); }
  const PURE = () => document.documentElement.classList.contains('ck-pure');
  function flash(msg) { if (window.ckFlash) window.ckFlash(msg); }
  function haptic(k) { window.haptic && window.haptic(k); }

  let container = null, apiRef = null, data = null, busy = false;
  // ── доп. состояние: гонка (грузится вместе с альбомом), обмены/почта/рецепиенты
  // (лениво, при первом открытии соответствующей страницы), мастера создания
  // предложения/письма (шаг за шагом переиспользуют #cd-sheet). needsRerenderOnClose —
  // отложенный полный render() после закрытия шита: страницы «Обмены»/«Почта» позволяют
  // сделать несколько действий подряд, не закрываясь на каждой — render() пересобирает
  // #cd-scrim/#cd-sheet и убил бы открытый шит, поэтому откладываем его до closeSheet().
  let race = null, recipients = null, tradesCache = null, tradesTab = 'toMe', mailCache = null;
  let tcState = null, msState = null, needsRerenderOnClose = false;

  // ── стили (свой блок, не трогаем catclick-css — переменные --gold-*/--muted/--panel/
  // --line/--ink/--cream каскадируются от .ck-ov, наш контейнер лежит внутри него) ──
  function styles() {
    if (document.getElementById('catdove-css')) return;
    const s = document.createElement('style'); s.id = 'catdove-css';
    s.textContent = `
      .cd-root{padding:2px 2px 4px}
      .cd-summary{text-align:center;color:var(--muted);font-size:13px;margin:0 0 12px;line-height:1.5}
      .cd-summary b{color:var(--gold-l)}
      .cd-sect-t{color:var(--muted);font-weight:700;font-size:11px;margin:4px 4px 7px;text-transform:uppercase;letter-spacing:.7px}
      .cd-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:14px}
      .cd-card{position:relative;background:var(--panel);border:2px solid var(--line);border-radius:13px;padding:6px 4px 8px;text-align:center;cursor:pointer;opacity:0;animation:cdIn .3s ease-out forwards;box-sizing:border-box}
      .cd-card:not(.cd-locked):active{transform:scale(.96)}
      @keyframes cdIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
      .cd-card[data-r="common"]{border-color:rgba(141,146,156,.55)}
      .cd-card[data-r="rare"]{border-color:#b8813f}
      .cd-card[data-r="epic"]{border-color:#9070c2}
      .cd-card[data-r="legendary"]{border-color:var(--gold);box-shadow:0 0 10px rgba(238,191,82,.3)}
      .cd-card.cd-locked{cursor:default}
      .cd-art{position:relative;width:100%;aspect-ratio:1;border-radius:10px;margin:0 auto 6px;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,rgba(238,191,82,.14),rgba(238,191,82,.03));overflow:hidden}
      .cd-art img{width:82%;height:82%;object-fit:contain;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
      .cd-art svg{width:50%;height:50%;color:var(--gold-l)}
      .cd-card.cd-locked .cd-art img,.cd-card.cd-locked .cd-art svg{filter:brightness(0);opacity:.15}
      .cd-cnt{position:absolute;top:4px;right:5px;font-size:9.5px;font-weight:800;color:var(--gold-l);background:rgba(0,0,0,.42);border-radius:8px;padding:1px 5px;z-index:2}
      .cd-n{font-weight:700;font-size:10px;color:var(--ink);line-height:1.2;min-height:2.3em;display:flex;align-items:center;justify-content:center}
      .cd-card.cd-locked .cd-n{color:var(--muted)}
      .cd-stars{font-size:9.5px;color:var(--gold);letter-spacing:1px;margin-top:1px}
      .cd-stars .off{color:rgba(255,255,255,.16)}
      .cd-week{position:absolute;top:-6px;left:-6px;background:linear-gradient(90deg,#ffe7a6,#f0c24e);color:#5a2028;font-size:7.5px;font-weight:900;padding:3px 5px;border-radius:7px;box-shadow:0 2px 6px rgba(0,0,0,.3);z-index:3;white-space:nowrap}
      .cd-showtag{position:absolute;bottom:-4px;left:50%;transform:translateX(-50%);background:rgba(238,191,82,.92);color:#3a230c;font-size:8px;font-weight:900;border-radius:6px;padding:1px 5px;z-index:2;white-space:nowrap}
      .cd-champ{display:flex;align-items:center;gap:12px;background:linear-gradient(90deg,rgba(255,231,166,.14),rgba(238,191,82,.04));border:2px solid var(--gold);border-radius:16px;padding:11px 12px;margin-bottom:16px;box-shadow:0 3px 12px rgba(238,191,82,.18);cursor:pointer}
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
      .cd-claimbtn{flex:none;display:inline-flex;align-items:center;gap:5px;border:1px solid #ffe9b3;border-radius:12px;padding:9px 13px;font-weight:800;font-size:12px;background:linear-gradient(180deg,#ffe7a6,#eebf52 56%,#cf9a36);color:#5a2028;cursor:pointer;white-space:nowrap;min-height:38px}
      .cd-claimbtn:disabled{opacity:.6;cursor:default}
      .cd-scrim{position:fixed;inset:0;z-index:9400;background:rgba(10,6,5,.5);display:none}
      .cd-scrim.on{display:block}
      .cd-sheet{position:fixed;left:0;right:0;bottom:0;z-index:9401;background:linear-gradient(180deg,#2e1119,#1d0a11);border-radius:20px 20px 0 0;padding:18px 18px calc(18px + env(safe-area-inset-bottom,0px));box-shadow:0 -14px 44px rgba(0,0,0,.5);transform:translateY(100%);transition:transform .22s ease-out}
      .cd-sheet.on{transform:translateY(0)}
      .cd-sheet__hd{display:flex;align-items:center;justify-content:space-between;gap:10px}
      .cd-sheet__t{font-family:'Nunito',sans-serif;font-weight:800;font-size:17px;color:var(--cream)}
      .cd-sheet__x{width:30px;height:30px;flex:none;border:1px solid var(--line);border-radius:50%;background:rgba(0,0,0,.28);color:var(--cream);font-size:15px;cursor:pointer}
      .cd-sheet__stars{font-size:17px;color:var(--gold);letter-spacing:3px;margin:8px 0 14px}
      .cd-sheet__act{width:100%;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:7px;border:1px solid #ffe9b3;border-radius:14px;padding:13px;font-weight:800;font-size:14px;background:linear-gradient(180deg,#ffe7a6,#eebf52 56%,#cf9a36);color:#5a2028;cursor:pointer;margin-bottom:10px;min-height:44px}
      .cd-sheet__act:disabled{background:rgba(255,255,255,.07);color:var(--muted);border-color:transparent;cursor:default}
      .cd-sheet__act--on{background:linear-gradient(180deg,#9be7a8,#48bb78);color:#0b2e17;border-color:#9be7a8}
      .cd-sheet__hint{font-size:11.5px;color:var(--muted);text-align:center;margin:-4px 0 10px}
      .cd-pop-scrim{position:fixed;inset:0;z-index:9500;background:rgba(10,6,5,.55);display:none;align-items:center;justify-content:center}
      .cd-pop-scrim.on{display:flex}
      .cd-pop{background:linear-gradient(180deg,#2e1119,#1d0a11);border:1px solid var(--line);border-radius:20px;padding:24px;text-align:center;box-shadow:0 18px 50px rgba(0,0,0,.6);max-width:82%}
      .cd-pop h3{margin:0 0 6px;font-family:'Nunito',sans-serif;font-weight:700;font-size:19px;color:var(--cream)}
      .cd-pop .v{font-family:'Nunito',sans-serif;font-size:30px;font-weight:700;color:var(--gold-l);margin:10px 0;display:inline-flex;align-items:center;gap:8px}
      .cd-pop button{margin-top:8px;border:1px solid #ffe9b3;border-radius:14px;padding:12px 26px;font-weight:800;background:linear-gradient(180deg,#ffe7a6,#eebf52 56%,#cf9a36);color:#5a2028;cursor:pointer}
      .cd-empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:30px 18px;color:var(--muted)}
      .cd-empty__ic{width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(238,191,82,.08);border:1px solid var(--line);color:var(--gold);margin-bottom:12px}
      .cd-empty__t{font-weight:800;font-size:15px;color:var(--cream);margin-bottom:4px}
      .cd-empty__s{font-size:12.5px;line-height:1.5;max-width:240px}
      .cd-skrow{display:flex;align-items:center;gap:10px;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px 12px;margin-bottom:7px}
      .cd-sk{position:relative;overflow:hidden;background:rgba(255,255,255,.05);border-radius:8px}
      .cd-sk::after{content:'';position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,rgba(255,255,255,.10),transparent);animation:cdShim 1.2s ease-in-out infinite}
      @keyframes cdShim{100%{transform:translateX(100%)}}
      .cd-sheet{max-height:82vh;overflow-y:auto}
      .cd-navrow{display:flex;gap:8px;margin-bottom:14px}
      .cd-navbtn{position:relative;flex:1;display:flex;align-items:center;justify-content:center;gap:6px;background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:10px 8px;font-weight:700;font-size:12.5px;color:var(--ink);cursor:pointer;min-height:40px}
      .cd-navbtn:active{transform:scale(.97)}
      .cd-navbadge{position:absolute;top:-6px;right:6px;min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:#e5484d;color:#fff;font-size:9.5px;font-weight:800;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.35)}
      .cd-subtabs{display:flex;gap:6px;margin-bottom:12px;background:rgba(0,0,0,.22);border-radius:12px;padding:3px}
      .cd-subtab{flex:1;text-align:center;padding:8px 4px;border-radius:10px;font-weight:700;font-size:11.5px;color:var(--muted);cursor:pointer;background:transparent;border:none}
      .cd-subtab.on{background:var(--panel);color:var(--gold-l)}
      .cd-traderow{display:flex;align-items:center;gap:8px;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:9px 10px;margin-bottom:8px}
      .cd-traderow__swap{display:flex;align-items:center;gap:7px;flex:1;min-width:0}
      .cd-traderow__art{width:34px;height:34px;border-radius:9px;background:rgba(238,191,82,.1);display:flex;align-items:center;justify-content:center;overflow:hidden;flex:none}
      .cd-traderow__art img{width:80%;height:80%;object-fit:contain}
      .cd-traderow__arrow{color:var(--muted);flex:none;font-size:12px}
      .cd-traderow__meta{font-size:10.5px;color:var(--muted);margin-top:2px}
      .cd-traderow__act{flex:none}
      .cd-tbtn{border:1px solid #ffe9b3;border-radius:10px;padding:8px 12px;font-weight:800;font-size:11.5px;background:linear-gradient(180deg,#ffe7a6,#eebf52 56%,#cf9a36);color:#5a2028;cursor:pointer;white-space:nowrap;min-height:34px}
      .cd-tbtn:disabled{opacity:.6;cursor:default}
      .cd-tbtn--ghost{background:rgba(255,255,255,.06);color:var(--muted);border-color:var(--line)}
      .cd-mailcard{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:11px 12px;margin-bottom:9px}
      .cd-mailcard__top{display:flex;align-items:center;gap:10px}
      .cd-mailcard__art{width:42px;height:42px;border-radius:11px;background:rgba(238,191,82,.1);display:flex;align-items:center;justify-content:center;overflow:hidden;flex:none}
      .cd-mailcard__art img{width:82%;height:82%;object-fit:contain}
      .cd-mailcard__b{flex:1;min-width:0}
      .cd-mailcard__n{font-weight:700;font-size:13px;color:var(--ink)}
      .cd-mailcard__phrase{font-size:12px;color:var(--gold-l);margin-top:2px;font-style:italic;overflow-wrap:break-word}
      .cd-mailcard__from{font-size:10.5px;color:var(--muted);margin-top:3px;overflow-wrap:break-word}
      .cd-mailcard__thanks{margin-top:9px;width:100%;box-sizing:border-box;text-align:center}
      .cd-reciperow{display:flex;align-items:center;justify-content:space-between;gap:8px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:7px;cursor:pointer;overflow-wrap:break-word}
      .cd-reciperow:active{transform:scale(.98)}
      .cd-pickgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:10px}
      .cd-pickcard{background:var(--panel);border:2px solid var(--line);border-radius:13px;padding:6px 4px 8px;text-align:center;cursor:pointer;box-sizing:border-box}
      .cd-pickcard:active{transform:scale(.96)}
      .cd-pickcard[data-r="common"]{border-color:rgba(141,146,156,.55)}
      .cd-pickcard[data-r="rare"]{border-color:#b8813f}
      .cd-pickcard[data-r="epic"]{border-color:#9070c2}
      .cd-pickcard[data-r="legendary"]{border-color:var(--gold);box-shadow:0 0 10px rgba(238,191,82,.3)}
      @media (prefers-reduced-motion:reduce){.cd-card{animation:none;opacity:1}.cd-sk::after{animation:none}}
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
    d.inventory.forEach((row) => { invMap[row.breed] = { count: num(row.count), stars: num(row.stars) || 1, showcase: num(row.showcase) }; });
    data = { sets: Array.isArray(d.sets) ? d.sets : [], invMap, weekBreed: d.weekBreed || null, unreadMail: num(d.unreadMail) };
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

  // ── рендер ────────────────────────────────────────────────────────────────
  function cardHtml(b) {
    const inv = data.invMap[b.id];
    const owned = !!inv && inv.count > 0;
    const week = data.weekBreed === b.id;
    const artSrc = `/img/pigeons/${b.id}.webp?v=1`;
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
      ${inv.showcase > 0 ? '<span class="cd-showtag">витрина</span>' : ''}
    </div>`;
  }

  function championHtml() {
    const b = BY_ID.get('champion');
    const inv = data.invMap.champion;
    if (!inv || inv.count <= 0) return '';
    const artSrc = `/img/pigeons/champion.webp?v=1`;
    const art = `<img src="${artSrc}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span style="display:none;align-items:center;justify-content:center;width:100%;height:100%">${DOVE_ICON(30)}</span>`;
    return `<div class="cd-champ" data-breed="champion">
      <div class="cd-champ__art">${art}</div>
      <div class="cd-champ__b">
        <div class="cd-champ__n">${b.name} ${'★'.repeat(Math.max(1, Math.min(3, num(inv.stars))))}</div>
        <div class="cd-champ__s">Приз гонки стаи · ×${num(inv.count)}${inv.showcase > 0 ? ' · на витрине' : ''}</div>
      </div>
    </div>`;
  }

  function setRowHtml(setDef) {
    const s = (data.sets || []).find(x => x.id === setDef.id) || { owned: 0, claimed: false };
    const owned = num(s.owned), full = owned >= 4;
    let action;
    if (s.claimed) action = '<span class="cd-setrow__done">Получено ✓</span>';
    else if (full) action = `<button class="cd-claimbtn" data-claim="${setDef.id}">${COIN_ICON(14)} Забрать ${fmt(setDef.reward)}</button>`;
    else action = '';
    return `<div class="cd-setrow">
      <div class="cd-setrow__n"><b>${setDef.name}</b><div class="cd-setrow__p">${owned}/4 собрано</div></div>
      ${action}
    </div>`;
  }

  function render() {
    if (!container) return;
    if (!authed()) {
      container.innerHTML = emptyState('Коллекция закрыта', PURE()
        ? 'Открой игру в Telegram — собирай голубей-помощников и получай награды за сеты.'
        : 'Войди через приложение «Мария» — собирай голубей и получай награды за сеты.');
      return;
    }
    if (!data) {
      container.innerHTML = emptyState('Не удалось загрузить', 'Проверь связь и открой «Коллекцию» ещё раз.');
      return;
    }
    const ownedCount = BREEDS.filter(b => b.id !== 'champion' && data.invMap[b.id] && data.invMap[b.id].count > 0).length;
    const grid = BREEDS.filter(b => b.id !== 'champion').map(cardHtml).join('');
    const sets = SETS.map(setRowHtml).join('');
    container.innerHTML = `<div class="cd-root">
      <div class="cd-summary">Собери коллекцию голубей — <b>${ownedCount}/16</b>. Голуби падают за тапы и покупки, «порода недели» выпадает чаще.</div>
      <div class="cd-navrow">
        <button class="cd-navbtn" id="cd-nav-trades">${SWAP_ICON(15)} Обмены</button>
        <button class="cd-navbtn" id="cd-nav-mail">${MAILBOX_ICON(15)} Почта${data.unreadMail > 0 ? `<span class="cd-navbadge">${data.unreadMail > 9 ? '9+' : data.unreadMail}</span>` : ''}</button>
      </div>
      <div class="cd-grid">${grid}</div>
      ${championHtml()}
      <div class="cd-sect-t">Сеты</div>
      ${sets}
      ${raceHtml()}
      <div class="cd-scrim" id="cd-scrim"></div>
      <div class="cd-sheet" id="cd-sheet"></div>
      <div class="cd-pop-scrim" id="cd-pop-scrim"><div class="cd-pop" id="cd-pop"></div></div>
    </div>`;
    wire();
  }

  function wire() {
    container.querySelectorAll('.cd-card:not(.cd-locked)').forEach(el => {
      el.onclick = () => openSheet(el.dataset.breed);
    });
    const champ = container.querySelector('.cd-champ');
    if (champ) champ.onclick = () => openSheet('champion');
    container.querySelectorAll('[data-claim]').forEach(el => {
      el.onclick = () => claimSetAct(el.dataset.claim, el);
    });
    const scrim = container.querySelector('#cd-scrim');
    if (scrim) scrim.onclick = closeSheet;
    const navT = container.querySelector('#cd-nav-trades'); if (navT) navT.onclick = openTradesPage;
    const navM = container.querySelector('#cd-nav-mail'); if (navM) navM.onclick = openMailPage;
    const raceBtn = container.querySelector('#cd-race-enter'); if (raceBtn) raceBtn.onclick = openRaceBreedPicker;
  }

  // ── шит действий (звёзды/витрина/обмены/почта/гонка) — общий #cd-scrim/#cd-sheet,
  // переиспользуется всеми под-экранами (см. openTradesPage/openMailPage/openSheet).
  function closeSheet() {
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
    const showLabel = isShown ? 'Убрать с витрины' : (showcaseFull ? `На витрине уже ${MAX_SHOWCASE}/${MAX_SHOWCASE}` : 'На витрину');
    const canTrade = inv.count > 1; // обмен/почта отдают только дубликат — как feed
    const sc = container.querySelector('#cd-scrim'), sh = container.querySelector('#cd-sheet');
    if (!sc || !sh) return;
    sh.innerHTML = `
      <div class="cd-sheet__hd"><div class="cd-sheet__t">${b.name}</div><button class="cd-sheet__x" id="cd-sheet-x">×</button></div>
      <div class="cd-sheet__stars">${'★'.repeat(stars)}<span style="color:rgba(255,255,255,.18)">${'★'.repeat(3 - stars)}</span></div>
      <button class="cd-sheet__act" id="cd-feed" ${feedEnabled ? '' : 'disabled'}>${feedLabel}</button>
      ${need != null && !feedEnabled ? `<div class="cd-sheet__hint">Нужно ${need} запасных (сейчас ${Math.max(0, spare)})</div>` : ''}
      <button class="cd-sheet__act${isShown ? ' cd-sheet__act--on' : ''}" id="cd-show" ${(!isShown && showcaseFull) ? 'disabled' : ''}>${showLabel}</button>
      ${canTrade ? `<button class="cd-sheet__act" id="cd-trade-start">${SWAP_ICON(15)} Предложить обмен</button>` : ''}
    `;
    sc.classList.add('on');
    requestAnimationFrame(() => sh.classList.add('on'));
    sh.querySelector('#cd-sheet-x').onclick = closeSheet;
    const feedBtn = sh.querySelector('#cd-feed');
    if (feedBtn && feedEnabled) feedBtn.onclick = () => feedAct(breedId, feedBtn);
    const showBtn = sh.querySelector('#cd-show');
    if (showBtn && !showBtn.disabled) showBtn.onclick = () => showcaseAct(breedId, isShown, showBtn);
    const tradeBtn = sh.querySelector('#cd-trade-start');
    if (tradeBtn) tradeBtn.onclick = () => openTradeWant(breedId);
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

  const SHOW_REASON = { bad_input: 'Можно не больше трёх на витрине', unknown_breed: 'Неизвестная порода', not_owned: 'Птица не найдена' };
  async function showcaseAct(breedId, wasShown, btn) {
    if (busy) return; busy = true; if (btn) btn.disabled = true;
    try {
      let breeds = showcaseOrder();
      if (wasShown) breeds = breeds.filter(id => id !== breedId);
      else { if (breeds.length >= MAX_SHOWCASE) { flash(`На витрине уже ${MAX_SHOWCASE}/${MAX_SHOWCASE}`); return; } breeds = breeds.concat([breedId]); }
      const d = await apiRef('/api/pigeons/showcase', { method: 'POST', body: JSON.stringify({ breeds }) }).catch(() => null);
      if (d && d.ok) {
        Object.keys(data.invMap).forEach(id => { data.invMap[id].showcase = 0; });
        breeds.forEach((id, i) => { if (data.invMap[id]) data.invMap[id].showcase = i + 1; });
        haptic('light');
        closeSheet();
        render();
      } else {
        flash(SHOW_REASON[d && d.error] || 'Не получилось обновить витрину');
        if (btn) btn.disabled = false;
      }
    } finally { busy = false; }
  }

  // ── общие хелперы для под-экранов (обмены/почта/гонка) ─────────────────────
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
      const artSrc = `/img/pigeons/${id}.webp?v=1`;
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
    recipients = (d && Array.isArray(d.squad) && Array.isArray(d.refs)) ? d : { squad: [], refs: [] };
    return recipients;
  }

  // ── Обмены: создание предложения (из карточки, count>1) ────────────────────
  function openTradeWant(giveId) {
    tcState = { give: giveId, want: null };
    haptic('light');
    const sh = container.querySelector('#cd-sheet');
    if (!sh) return;
    const ids = BREEDS.filter(b => b.id !== 'champion' && b.id !== giveId).map(b => b.id);
    sh.innerHTML = `<div class="cd-sheet__hd"><div class="cd-sheet__t">Что хочешь взамен?</div><button class="cd-sheet__x" id="cd-sheet-x">×</button></div>
      <div class="cd-sheet__hint">Отдашь: ${BY_ID.get(giveId).name}</div>
      ${pickGridHtml(ids, null)}`;
    sh.querySelector('#cd-sheet-x').onclick = closeSheet;
    sh.querySelectorAll('.cd-pickcard').forEach(el => { el.onclick = () => openTradeRecipient(el.dataset.breed); });
  }
  async function openTradeRecipient(wantId) {
    if (!tcState) return;
    tcState.want = wantId;
    haptic('light');
    const sh = container.querySelector('#cd-sheet');
    if (!sh) return;
    sh.innerHTML = `<div class="cd-sheet__hd"><div class="cd-sheet__t">Кому предложить?</div><button class="cd-sheet__x" id="cd-sheet-x">×</button></div>
      <div class="cd-sheet__hint">Отдашь ${BY_ID.get(tcState.give).name} → получишь ${BY_ID.get(wantId).name}</div>
      <button class="cd-sheet__act" id="cd-trade-open">Всем на доску (открытый обмен)</button>
      <div class="cd-sect-t">Или выбери адресата</div>
      <div id="cd-trade-recip">${skeletonRows(2)}</div>`;
    sh.querySelector('#cd-sheet-x').onclick = closeSheet;
    sh.querySelector('#cd-trade-open').onclick = () => submitTrade(null);
    const rec = await loadRecipients();
    const box = sh.querySelector('#cd-trade-recip');
    if (!box) return; // шит уже закрыт/сменился, пока грузили
    const rows = rec.squad.concat(rec.refs);
    box.innerHTML = rows.length
      ? rows.map(r => `<div class="cd-reciperow" data-chat="${r.chat}"><span>${esc(r.name)}</span></div>`).join('')
      : `<div style="color:var(--muted);font-size:12.5px;text-align:center;padding:8px 0">Пока нет активных знакомых — предложи всем на доску</div>`;
    box.querySelectorAll('.cd-reciperow').forEach(el => { el.onclick = () => submitTrade(Number(el.dataset.chat)); });
  }
  const TRADE_CREATE_REASON = { bad_input: 'Неверный выбор породы', self: 'Нельзя предложить самому себе', limit: 'Не больше 3 предложений одновременно', need_duplicate: 'Отдать можно только запасного' };
  async function submitTrade(to) {
    if (busy || !tcState) return; busy = true;
    try {
      const body = { give: tcState.give, want: tcState.want };
      if (to != null) body.to = to;
      const d = await apiRef('/api/pigeons/trade', { method: 'POST', body: JSON.stringify(body) }).catch(() => null);
      if (d && d.ok) {
        haptic('medium'); flash('Предложение создано');
        tcState = null; tradesCache = null;
        closeSheet();
        await load(); render();
      } else {
        flash(TRADE_CREATE_REASON[d && d.error] || 'Не получилось создать предложение');
      }
    } finally { busy = false; }
  }

  // ── Обмены: доска (Мне/Доска/Мои) ───────────────────────────────────────────
  async function openTradesPage() {
    haptic('light');
    const sc = container.querySelector('#cd-scrim'), sh = container.querySelector('#cd-sheet');
    if (!sc || !sh) return;
    sh.innerHTML = `<div class="cd-sheet__hd"><div class="cd-sheet__t">Обмены</div><button class="cd-sheet__x" id="cd-sheet-x">×</button></div>
      <div class="cd-subtabs" id="cd-trade-tabs">
        <button class="cd-subtab" data-t="toMe" type="button">Мне</button>
        <button class="cd-subtab" data-t="open" type="button">Доска</button>
        <button class="cd-subtab" data-t="mine" type="button">Мои</button>
      </div>
      <div id="cd-trade-list">${skeletonRows(3)}</div>`;
    sc.classList.add('on');
    requestAnimationFrame(() => sh.classList.add('on'));
    sh.querySelector('#cd-sheet-x').onclick = closeSheet;
    sh.querySelectorAll('.cd-subtab').forEach(b => { b.onclick = () => { tradesTab = b.dataset.t; renderTradesTab(); }; });
    const d = await apiRef('/api/pigeons/trades').catch(() => null);
    tradesCache = (d && Array.isArray(d.open)) ? d : { open: [], toMe: [], mine: [] };
    if (!container.querySelector('#cd-trade-list')) return; // закрыто, пока грузили
    if (!tradesCache.toMe.length && tradesTab === 'toMe') tradesTab = tradesCache.open.length ? 'open' : 'toMe';
    renderTradesTab();
  }
  function renderTradesTab() {
    const sh = container.querySelector('#cd-sheet');
    if (!sh || !tradesCache) return;
    sh.querySelectorAll('.cd-subtab').forEach(b => b.classList.toggle('on', b.dataset.t === tradesTab));
    const box = sh.querySelector('#cd-trade-list');
    if (!box) return;
    const list = tradesCache[tradesTab] || [];
    if (!list.length) {
      box.innerHTML = emptyState('Пусто', tradesTab === 'mine' ? 'У тебя нет открытых предложений.' : tradesTab === 'toMe' ? 'Тебе пока никто не предлагал обмен.' : 'На доске пока нет открытых предложений.');
      return;
    }
    box.innerHTML = list.map(t => tradeRowHtml(t, tradesTab)).join('');
    box.querySelectorAll('[data-accept]').forEach(el => { el.onclick = () => acceptTradeAct(Number(el.dataset.accept), el); });
    box.querySelectorAll('[data-cancel]').forEach(el => { el.onclick = () => cancelTradeAct(Number(el.dataset.cancel), el); });
  }
  function tradeRowHtml(t, kind) {
    const give = BY_ID.get(t.give), want = BY_ID.get(t.want);
    const btn = kind === 'mine'
      ? `<button class="cd-tbtn cd-tbtn--ghost" data-cancel="${t.id}">Отменить</button>`
      : `<button class="cd-tbtn" data-accept="${t.id}">Принять</button>`;
    return `<div class="cd-traderow">
      <div class="cd-traderow__swap">
        <div class="cd-traderow__art"><img src="/img/pigeons/${t.give}.webp?v=1" alt="" onerror="this.style.display='none'"></div>
        <span class="cd-traderow__arrow">→</span>
        <div class="cd-traderow__art"><img src="/img/pigeons/${t.want}.webp?v=1" alt="" onerror="this.style.display='none'"></div>
        <div style="min-width:0;flex:1">
          <div style="font-size:11.5px;color:var(--ink);font-weight:700">${give ? give.name : t.give} → ${want ? want.name : t.want}</div>
          <div class="cd-traderow__meta">${kind === 'mine' ? 'от тебя' : 'от ' + esc(t.fromName)}</div>
        </div>
      </div>
      <div class="cd-traderow__act">${btn}</div>
    </div>`;
  }
  const TRADE_ACCEPT_REASON = { gone: 'Предложение уже разобрали', own: 'Это твоё предложение', not_addressed: 'Предложение не для тебя', need_duplicate: 'Отдать можно только запасного' };
  async function acceptTradeAct(id, btn) {
    if (busy) return; busy = true; if (btn) btn.disabled = true;
    try {
      const d = await apiRef('/api/pigeons/trade/accept', { method: 'POST', body: JSON.stringify({ id }) }).catch(() => null);
      if (d && d.ok) {
        haptic('medium'); flash('Обмен состоялся!');
        needsRerenderOnClose = true;
        await load();
        const list = await apiRef('/api/pigeons/trades').catch(() => null);
        tradesCache = (list && Array.isArray(list.open)) ? list : tradesCache;
        renderTradesTab();
      } else {
        flash(TRADE_ACCEPT_REASON[d && d.error] || 'Не получилось принять обмен');
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
        needsRerenderOnClose = true;
        await load();
        const list = await apiRef('/api/pigeons/trades').catch(() => null);
        tradesCache = (list && Array.isArray(list.open)) ? list : tradesCache;
        renderTradesTab();
      } else {
        flash(TRADE_CANCEL_REASON[d && d.error] || 'Не получилось отменить');
        if (btn) btn.disabled = false;
      }
    } finally { busy = false; }
  }

  // ── Почта: входящие + «Поблагодарить» ───────────────────────────────────────
  function mailShellHtml() {
    return `<div class="cd-sheet__hd"><div class="cd-sheet__t">Почта</div><button class="cd-sheet__x" id="cd-sheet-x">×</button></div>
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
        <div class="cd-mailcard__art"><img src="/img/pigeons/${m.breed}.webp?v=1" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span style="display:none;align-items:center;justify-content:center;width:100%;height:100%">${DOVE_ICON(18)}</span></div>
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
    sh.innerHTML = `<div class="cd-sheet__hd"><div class="cd-sheet__t">Выбери стикер</div><button class="cd-sheet__x" id="cd-sheet-x">×</button></div>${stickerListHtml()}`;
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
      sh.innerHTML = `<div class="cd-sheet__hd"><div class="cd-sheet__t">Отправить голубя</div><button class="cd-sheet__x" id="cd-sheet-x">×</button></div>${emptyState('Нечего отправить', 'Нужен хотя бы один запасной дубликат породы.')}`;
      sh.querySelector('#cd-sheet-x').onclick = closeSheet;
      return;
    }
    sh.innerHTML = `<div class="cd-sheet__hd"><div class="cd-sheet__t">Кого отправишь?</div><button class="cd-sheet__x" id="cd-sheet-x">×</button></div>${pickGridHtml(spares, null)}`;
    sh.querySelector('#cd-sheet-x').onclick = closeSheet;
    sh.querySelectorAll('.cd-pickcard').forEach(el => { el.onclick = () => openMailSendRecipient(el.dataset.breed); });
  }
  async function openMailSendRecipient(breedId) {
    if (!msState) return;
    msState.breed = breedId;
    haptic('light');
    const sh = container.querySelector('#cd-sheet');
    if (!sh) return;
    sh.innerHTML = `<div class="cd-sheet__hd"><div class="cd-sheet__t">Кому отправить?</div><button class="cd-sheet__x" id="cd-sheet-x">×</button></div>
      <div class="cd-sheet__hint">Отправишь: ${BY_ID.get(breedId).name}</div>
      <button class="cd-sheet__act" id="cd-ms-random">Случайному игроку</button>
      <div class="cd-sect-t">Однокомандцы</div>
      <div id="cd-ms-squad">${skeletonRows(2)}</div>
      <div class="cd-sect-t">Рефералы</div>
      <div id="cd-ms-refs">${skeletonRows(2)}</div>`;
    sh.querySelector('#cd-sheet-x').onclick = closeSheet;
    sh.querySelector('#cd-ms-random').onclick = () => openMailSendSticker('random');
    const rec = await loadRecipients();
    const sqBox = sh.querySelector('#cd-ms-squad'), rfBox = sh.querySelector('#cd-ms-refs');
    if (!sqBox || !rfBox) return; // шит уже закрыт/сменился, пока грузили
    sqBox.innerHTML = rec.squad.length
      ? rec.squad.map(r => `<div class="cd-reciperow" data-chat="${r.chat}"><span>${esc(r.name)}</span></div>`).join('')
      : `<div style="color:var(--muted);font-size:12px;padding:4px 2px 10px">Пока нет активных однокомандцев</div>`;
    rfBox.innerHTML = rec.refs.length
      ? rec.refs.map(r => `<div class="cd-reciperow" data-chat="${r.chat}"><span>${esc(r.name)}</span></div>`).join('')
      : `<div style="color:var(--muted);font-size:12px;padding:4px 2px 10px">Пока нет активных рефералов</div>`;
    sqBox.querySelectorAll('.cd-reciperow').forEach(el => { el.onclick = () => openMailSendSticker(Number(el.dataset.chat)); });
    rfBox.querySelectorAll('.cd-reciperow').forEach(el => { el.onclick = () => openMailSendSticker(Number(el.dataset.chat)); });
  }
  function openMailSendSticker(to) {
    if (!msState) return;
    msState.to = to;
    haptic('light');
    const sh = container.querySelector('#cd-sheet');
    if (!sh) return;
    sh.innerHTML = `<div class="cd-sheet__hd"><div class="cd-sheet__t">Что напишешь?</div><button class="cd-sheet__x" id="cd-sheet-x">×</button></div>${stickerListHtml()}`;
    sh.querySelector('#cd-sheet-x').onclick = closeSheet;
    sh.querySelectorAll('.cd-reciperow').forEach(el => { el.onclick = () => submitMail(Number(el.dataset.sticker)); });
  }
  const MAIL_SEND_REASON = {
    bad_breed: 'Неизвестная порода', bad_sticker: 'Неверный стикер',
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
  function raceHtml() {
    if (!race || !race.enabled) return '';
    const mine = race.myBreed ? BY_ID.get(race.myBreed) : null;
    const results = Array.isArray(race.lastResults) ? race.lastResults : [];
    const rows = results.length ? results.map(r => {
      const b = BY_ID.get(r.breed);
      return `<div class="cd-traderow">
        <div class="cd-traderow__swap">
          <div style="width:24px;text-align:center;font-weight:800;color:var(--gold-l);flex:none;font-size:12px">№${num(r.place)}</div>
          <div class="cd-traderow__art"><img src="/img/pigeons/${r.breed}.webp?v=1" alt="" onerror="this.style.display='none'"></div>
          <div style="min-width:0;flex:1"><div style="font-size:12px;color:var(--ink);font-weight:700">${b ? b.name : r.breed}</div><div class="cd-traderow__meta">${num(r.score)} очков</div></div>
        </div>
        <div style="font-size:11.5px;color:var(--gold-l);font-weight:800;flex:none">${COIN_ICON(12)} ${fmt(r.prize)}</div>
      </div>`;
    }).join('') : `<div style="color:var(--muted);font-size:12.5px;text-align:center;padding:8px 0">Итоги прошлой недели ещё не подведены</div>`;
    return `<div class="cd-sect-t">Гонка стаи</div>
      <div class="cd-setrow">
        <div class="cd-setrow__n"><b>${mine ? 'Заявлен: ' + mine.name : 'Пока не участвуешь'}</b><div class="cd-setrow__p">${num(race.entrants)} участников на этой неделе</div></div>
        ${!mine ? `<button class="cd-claimbtn" id="cd-race-enter">Заявить</button>` : ''}
      </div>
      ${rows}`;
  }
  function openRaceBreedPicker() {
    if (!data) return;
    const owned = Object.keys(data.invMap).filter(id => data.invMap[id].count > 0);
    if (!owned.length) { flash('Нет ни одной птицы для заявки'); return; }
    haptic('light');
    const sc = container.querySelector('#cd-scrim'), sh = container.querySelector('#cd-sheet');
    if (!sc || !sh) return;
    sh.innerHTML = `<div class="cd-sheet__hd"><div class="cd-sheet__t">Заяви птицу на гонку</div><button class="cd-sheet__x" id="cd-sheet-x">×</button></div>${pickGridHtml(owned, null)}`;
    sc.classList.add('on');
    requestAnimationFrame(() => sh.classList.add('on'));
    sh.querySelector('#cd-sheet-x').onclick = closeSheet;
    sh.querySelectorAll('.cd-pickcard').forEach(el => { el.onclick = () => raceEnterAct(el.dataset.breed); });
  }
  const RACE_ENTER_REASON = { disabled: 'Гонка сейчас недоступна', unknown_breed: 'Неизвестная порода', not_owned: 'Птица не найдена', already: 'Ты уже заявил голубя на этой неделе' };
  async function raceEnterAct(breedId) {
    if (busy) return; busy = true;
    try {
      const d = await apiRef('/api/pigeons/race/enter', { method: 'POST', body: JSON.stringify({ breed: breedId }) }).catch(() => null);
      if (d && d.ok) {
        haptic('medium'); flash('Заявка принята!');
        if (race) race.myBreed = breedId;
        closeSheet();
        render();
      } else {
        flash(RACE_ENTER_REASON[d && d.error] || 'Не получилось заявить');
      }
    } finally { busy = false; }
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
    await load();
    render();
  }

  async function refreshBadge() {
    const api = apiRef || window.ckApi;
    if (!api || !authed()) return;
    const d = await api('/api/pigeons').catch(() => null);
    if (d && window.ckUpdateDoveBadge) window.ckUpdateDoveBadge(num(d.unreadMail));
  }

  window.CatDove = { mount, refreshBadge };
})();

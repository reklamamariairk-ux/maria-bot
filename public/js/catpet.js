/* ── «Дом Василия» — виртуальный питомец (тамагочи) ───────────────────────────
 * Василий живёт в приложении, ХОДИТ по 4 локациям, у него потребности (голод/настроение/
 * энергия/чистота), за ним ухаживаешь. Состояние — на сервере (/api/pet) для
 * авторизованных, на localStorage для гостей. Мини-игры открываются в Игровой.
 * Арт: cat/walk1..4.png (ходьба сбоку), idle/happy/full/hungry/open/chew (анфас),
 *      bakery-bg.jpg (кухня) + bg-bedroom/playroom/yard.jpg
 * ───────────────────────────────────────────────────────────────────────────── */
(function () {
  const A = (s) => `/assets/images/cat/${s}?v=2`;  // v2: кадры дома = канон-Василий (фаза 2 арт-комплекта)
  const SVG = (p, s = 18) => `<svg class="pet-i" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const PIC = {
    feed:    (s) => SVG('<path d="M4 20h16"/><path d="M6 20V9a6 6 0 0 1 12 0v11"/><path d="M12 3v3"/>', s),   // кекс/еда
    sleep:   (s) => SVG('<path d="M3 12h6l-6 6h6"/><path d="M14 5h7l-7 7h7"/>', s),                            // Zzz
    play:    (s) => SVG('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18"/><path d="M3 12h18"/>', s), // клубок/мяч
    pet:     (s) => SVG('<path d="M12 21s-7-4.6-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.4-7 10-7 10z"/>', s),  // сердечко
    hunger:  (s) => SVG('<path d="M4 20h16"/><path d="M6 20V9a6 6 0 0 1 12 0v11"/>', s),
    mood:    (s) => SVG('<circle cx="12" cy="12" r="9"/><path d="M8 14a4 4 0 0 0 8 0"/><path d="M9 9h.01M15 9h.01"/>', s), // улыбка
    energy:  (s) => SVG('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>', s),                                          // молния
    hygiene: (s) => SVG('<path d="M12 3c3 4 5 6 5 9a5 5 0 0 1-10 0c0-3 2-5 5-9z"/>', s),                       // капля
    gift:    (s) => SVG('<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/>', s), // подарок
  };
  // Пороги care-вех — зеркало src/clicker.ts MILESTONES ms_care* (менять синхронно)
  const CARE_MILESTONES = [
    { d: 7,   label: '200 баллов' },
    { d: 14,  label: 'промокод −5%' },
    { d: 30,  label: '500 баллов' },
    { d: 60,  label: 'десерт в подарок' },
    { d: 100, label: '1000 баллов' },
  ];
  const PURE = document.documentElement.classList.contains('ck-pure'); // чистая игра: без реальных призов
  // Коуч-хинты новичку (одноразовые, БЕЗ коммерции) — используют общий движок coach()
  // из catclick.js (window.ckCoach/window.ckCoachClose). Вызов гейтится их наличием.
  const COACH_PET = {
    home:     'Это Дом Василия: корми, гладь и играй с ним каждый день — за заботу капают монеты',
    homePlay: 'В Игровой — мини-игры: «Накорми» и «Ловилка». Рекорды сохраняются',
    petNeeds: 'Шкалы убывают со временем — заходи ухаживать за Василием каждый день',
    hats:     'В магазине Двора — шляпы за монеты Василия. Заработай их заботой и мини-играми',
  };
  // Счётчик открытий Дома (переживает сессии в localStorage) — нужен, чтобы отличить
  // первое открытие (там срабатывает хинт 'home') от второго+ (там — 'petNeeds').
  function bumpHomeOpenCount() {
    let n = 0;
    try { n = parseInt(localStorage.getItem('ck_pet_opens') || '0', 10) || 0; } catch (_) {}
    n++;
    try { localStorage.setItem('ck_pet_opens', String(n)); } catch (_) {}
    return n;
  }
  const NAV_ICON = { feed: PIC.feed, sleep: PIC.sleep, play: PIC.play, walk: PIC.pet };
  const WALK = ['walk1.png', 'walk2.png', 'walk3.png', 'walk4.png'];
  const LOC = {
    kitchen:  { bg: 'bakery-bg.jpg',  name: 'Кухня',   action: 'feed',  label: PIC.feed(18) + ' Покормить',    need: 'hunger' },
    bedroom:  { bg: 'bg-bedroom.jpg', name: 'Спальня', action: 'sleep', label: PIC.sleep(18) + ' Уложить спать', need: 'energy' },
    playroom: { bg: 'bg-playroom.jpg',name: 'Игровая', action: 'play',  label: PIC.play(18) + ' Поиграть',      need: 'mood' },
    yard:     { bg: 'bg-yard.jpg',    name: 'Двор',    action: 'walk',  label: PIC.pet(18) + ' Погладить',      need: 'mood' },
  };
  const ORDER = ['kitchen', 'bedroom', 'playroom', 'yard'];
  const NEEDS = [
    { k: 'hunger', ic: PIC.hunger, name: 'Сытость' },
    { k: 'mood',   ic: PIC.mood,   name: 'Настроение' },
    { k: 'energy', ic: PIC.energy, name: 'Энергия' },
  ];
  const LS = 'maria_pet_v1';
  // Магазин (цены — источник правды на бэке; здесь зеркало + арт и посадка на голову)
  const SHOP = [
    { id: 'detective', name: 'Шапка сыщика',      price: 120, img: 'hat-detective.png', w: 0.66, dx: 0.02, dy: -0.02 },
    { id: 'pirate',    name: 'Пиратская шляпа',   price: 180, img: 'hat-pirate.png',    w: 0.78, dx: 0.00, dy: 0.00 },
    { id: 'wizard',    name: 'Колпак волшебника', price: 250, img: 'hat-wizard.png',    w: 0.60, dx: 0.02, dy: -0.16 },
    { id: 'crown',     name: 'Корона',            price: 400, img: 'hat-crown.png',     w: 0.52, dx: 0.02, dy: 0.06 },
  ];
  const HAT = (id) => SHOP.find(h => h.id === id);

  // Кадры кота рисованы в разном пиксельном масштабе → пер-кадровый коэффициент
  // CSS-высоты (иначе лежачий кот-гигант и мелкий шагающий). Подобрано по монтажу
  // scripts/pet-hat-bake.mjs / _strip*.png.
  const FRAME_K = { 'full.png': 0.60, 'happy.png': 1.08, 'walk1.png': 0.78, 'walk2.png': 0.78, 'walk3.png': 0.78, 'walk4.png': 0.78 };
  const CAT_H = 46;      // базовая высота кота, % высоты сцены
  const CAT_MAXH = 320;  // базовый потолок высоты, px
  const HAT_PAD = 1.25;  // у шляпных webp-кадров холст выше на 25% (запас под шляпу)
  const HAT_FRAMES = ['idle.png', 'happy.png', 'full.png', 'walk1.png', 'walk2.png', 'walk3.png', 'walk4.png'];

  // Шляпа ВПЕЧЕНА в готовые webp-варианты кадров (scripts/pet-hat-bake.mjs) —
  // рантайм-позиционирования шляпы больше нет, она не может «съехать».
  function catSrc(frame) {
    const id = state && state.items && state.items.equipped;
    return (id && HAT(id) && HAT_FRAMES.indexOf(frame) !== -1) ? frame.replace('.png', '-' + id + '.webp') : frame;
  }
  let frameSeq = 0; // токен «последний запрошенный кадр» — гасит гонки decode() между setCatFrame()
  function setCatFrame(el, frame) {
    const src = catSrc(frame);
    const full = A(src);
    const changing = !el.src || el.src.indexOf('/' + src) === -1; // не дёргать src без смены
    el.dataset.frame = frame;
    // Размер кота ПОСТОЯННЫЙ (не растёт с уровнем — решение юзера 08.07); FRAME_K
    // выравнивает позы между собой: лежачий ниже стоячего, шагающий чуть крупнее.
    const k = (FRAME_K[frame] || 1) * (src === frame ? 1 : HAT_PAD);
    const applySize = () => {
      el.style.height = (CAT_H * k) + '%';
      el.style.maxHeight = Math.round(CAT_MAXH * k) + 'px';
    };
    if (!changing) { applySize(); return; } // тот же кадр уже на экране — высота уже верная
    if (el.dataset.pendingFrame === frame) return; // decode этого кадра уже в полёте (rAF-цикл ходьбы зовёт нас ~60/с)
    el.dataset.pendingFrame = frame;
    // Новый кадр: меняем src и высоту ТОЛЬКО когда картинка уже декодирована — иначе
    // старый кадр на миг растягивается в чужой масштаб (жалоба «кот дёргается»).
    const my = ++frameSeq;
    const pre = new Image();
    pre.src = full;
    const swap = () => {
      if (el.dataset.pendingFrame === frame) delete el.dataset.pendingFrame;
      if (my !== frameSeq || el.dataset.frame !== frame) return; // запросили другой кадр раньше, чем этот успел
      el.src = full;
      applySize();
    };
    if (pre.decode) pre.decode().catch(() => {}).then(swap);
    else { pre.onload = swap; pre.onerror = swap; }
  }
  // ── Ретрай при сетевом сбое («кот не прогружается») — до 2 повторов с бэкофом 1с/3с ──
  function attachImgRetry(el) {
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

  let ov, state, loc = 'kitchen', cat = { x: 0.5, dir: 1, vx: 0.04, mode: 'walk', frame: 0, t: 0, busy: false };
  let raf, lastTs = 0, walkImgs = [], renderAcc = 0;
  const FRAME_BUDGET = 1 / 30; // кап рендера цикла «кот ходит» на 30fps — мобильный GPU не должен перерисовывать каждый natively-60fps тик
  let memState = null; // in-memory фолбэк локального состояния — переживает сломанный/недоступный localStorage

  // ── Состояние: сервер или localStorage ──────────────────────────────────────
  function authed() { return !!(window.App && App.isAuthed && App.isAuthed()); }
  function localDefault() { return { hunger: 80, mood: 80, energy: 80, hygiene: 80, level: 1, xp: 0, xpNext: 100, coins: 0, location: 'kitchen', items: { owned: [], equipped: null }, care_streak: 0, care_date: null, _ts: Date.now() }; }
  // Best-effort обёртки над localStorage — в кривых webview getItem/setItem кидают, это не должно валить игру.
  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function localGet() {
    let s; try { s = JSON.parse(lsGet(LS)); } catch (_) {}
    // Хранилище недоступно/пусто/битое — берём последнее известное состояние из памяти,
    // а не localDefault() (иначе прогресс визуально «не растёт»: каждое действие стартует с нуля).
    if (!s) s = memState || localDefault();
    if (!s.items) s.items = { owned: [], equipped: null };
    const hrs = Math.max(0, (Date.now() - (s._ts || Date.now())) / 3600000);
    const dec = { hunger: 6, mood: 4, energy: 3, hygiene: 2.5 };
    ['hunger', 'mood', 'energy', 'hygiene'].forEach(k => s[k] = Math.max(0, Math.min(100, Math.round(s[k] - dec[k] * hrs))));
    s.careStreak = s.care_streak || 0;  // гостевой стрик: snake→camel для renderNeeds
    s._ts = Date.now();
    memState = s; lsSet(LS, JSON.stringify(s));
    return s;
  }
  function localBuy(id) {
    const s = localGet(); const it = HAT(id); if (!it) return s;
    if (!s.items.owned.includes(id) && s.coins >= it.price) { s.coins -= it.price; s.items.owned.push(id); }
    memState = s; lsSet(LS, JSON.stringify(s)); return s;
  }
  function localEquip(id) {
    const s = localGet(); s.items.equipped = (id && s.items.owned.includes(id)) ? id : null;
    memState = s; lsSet(LS, JSON.stringify(s)); return s;
  }
  function localAction(action) {
    const s = localGet();
    const R = { feed: { hunger: 45, mood: 8 }, sleep: { energy: 55, mood: 5 }, play: { mood: 35, energy: -10 }, walk: { mood: 18, energy: -4 } }[action] || {};
    Object.keys(R).forEach(k => s[k] = Math.max(0, Math.min(100, s[k] + R[k])));
    s.xp += 12; while (s.xp >= s.xpNext) { s.xp -= s.xpNext; s.level++; s.xpNext = s.level * 100; }
    // стрик заботы — монеты только раз в день (анти-фарм)
    const dayKey = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const yKey = new Date(Date.now() + 8 * 3600 * 1000 - 86400000).toISOString().slice(0, 10);
    let sb = 0;
    if (s.care_date !== dayKey) {
      s.care_streak = (s.care_date === yKey) ? (s.care_streak || 0) + 1 : 1;
      s.care_date = dayKey;
      sb = 100 * Math.min(Math.max(1, s.care_streak), 10);
      s.coins += sb;               // у гостя монеты локальные
    }
    s.careStreak = s.care_streak;  // для единообразия с сервером
    s._streakBonus = sb;
    s._ts = Date.now();
    memState = s; lsSet(LS, JSON.stringify(s)); return s;
  }
  async function api(path, opts) {
    const r = await fetch(path, {
      ...opts,
      signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined, // не висеть вечно в мёртвой сети
      headers: { 'Content-Type': 'application/json', ...(App.authHeader ? App.authHeader() : {}) },
    });
    if (!r.ok) {
      const e = new Error('http ' + r.status);
      try { e.body = await r.json(); } catch (_) {} // {error:reason} бэка — для человеческих тостов
      throw e;
    }
    return r.json();
  }
  async function loadState() { state = authed() ? await api('/api/pet') : localGet(); loc = state.location && LOC[state.location] ? state.location : 'kitchen'; }
  async function doAction(action) {
    let bonus = 0;
    const lvl0 = state ? state.level : null;
    try {
      if (authed()) {
        try {
          const resp = await api('/api/pet/action', { method: 'POST', body: JSON.stringify({ action }) });
          state = resp; bonus = Number(resp.streakBonus || 0);
        } catch (_) { showSyncFail(); }
      } else {
        // localAction никогда не кидает (localGet/lsSet — best-effort), но подстрахуемся ещё раз.
        try { state = localAction(action); bonus = Number((state && state._streakBonus) || 0); }
        catch (_) { state = state || memState || localDefault(); }
      }
    } finally {
      // Перерисовка ОБЯЗАНА произойти всегда — иначе экран замирает до следующего действия.
      renderNeeds();
      renderGift(state);
    }
    if (bonus > 0) showCareBonus(bonus, state.careStreak);
    if (lvl0 != null && state && state.level > lvl0) { showToast('Василий вырос — уровень ' + state.level + '!'); window.haptic?.('success'); }
  }
  function showToast(html) {
    if (!ov) return;
    let t = ov.querySelector('#pet-toast');
    if (!t) { t = document.createElement('div'); t.id = 'pet-toast'; t.className = 'pet-toast'; ov.appendChild(t); }
    t.innerHTML = html;
    t.classList.add('on');
    clearTimeout(t._tm); t._tm = setTimeout(() => t.classList.remove('on'), 2600);
  }
  function showCareBonus(bonus, streak) { showToast('Василий рад! Забота ' + streak + ' ' + plu(streak, 'день', 'дня', 'дней') + ' подряд · +' + bonus + ' ' + plu(bonus, 'монета', 'монеты', 'монет')); window.haptic?.('success'); }
  function showSyncFail() { showToast('Нет связи — прогресс не сохранён'); window.haptic?.('error'); }
  async function saveLoc() { if (authed()) { api('/api/pet/location', { method: 'POST', body: JSON.stringify({ location: loc }) }).catch(() => {}); } else { const s = localGet(); s.location = loc; memState = s; lsSet(LS, JSON.stringify(s)); } }
  // Причины отказа бэка (routes/pet.ts) → человеческий текст; нет body = сеть упала
  const plu = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return (a > 10 && a < 20) ? many : (b > 1 && b < 5) ? few : (b === 1) ? one : many; };
  const SHOP_ERR = { not_enough_coins: 'Не хватает монет', already_owned: 'Уже куплено', not_owned: 'Сначала купи эту шляпу' };
  function shopFail(e) {
    const reason = e && e.body && e.body.error;
    showToast(reason ? (SHOP_ERR[reason] || 'Не получилось') : 'Нет связи — попробуй ещё раз');
    window.haptic?.('error');
  }
  async function buyItem(id) {
    if (authed()) {
      try { state = await api('/api/pet/buy', { method: 'POST', body: JSON.stringify({ item: id }) }); window.haptic?.('medium'); }
      catch (e) { shopFail(e); }
    } else { state = localBuy(id); window.haptic?.('medium'); }
    renderNeeds(); renderShop(); renderHat();
  }
  async function equipItem(id) {
    if (authed()) {
      try { state = await api('/api/pet/equip', { method: 'POST', body: JSON.stringify({ item: id }) }); }
      catch (e) { shopFail(e); }
    } else state = localEquip(id);
    renderShop(); renderHat();
  }

  // ── UI ────────────────────────────────────────────────────────────────────────
  function styles() {
    if (document.getElementById('catpet-css')) return;
    const s = document.createElement('style'); s.id = 'catpet-css';
    s.textContent = `
      .pet-i{display:inline-block;vertical-align:-.18em}
      .pet-ov{position:fixed;inset:0;z-index:9999;display:none;flex-direction:column;overflow:hidden;background:#fdfaf3 center/cover no-repeat;touch-action:none;user-select:none;max-width:480px;margin:0 auto;box-shadow:0 0 0 100vmax rgba(20,14,10,.5)}
      .pet-ov.on{display:flex}
      .pet-topwrap{position:relative;z-index:3;display:flex;flex-direction:column;background:linear-gradient(180deg,rgba(0,0,0,.28),transparent)}
      .pet-top{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;padding:10px 12px 4px}
      .pet-need{display:flex;align-items:center;gap:5px;flex:1 1 44%}
      .pet-need__i{font-size:15px}
      .pet-need__bar{flex:1;height:9px;border-radius:6px;background:rgba(255,255,255,.45);overflow:hidden}
      .pet-need__fill{height:100%;border-radius:6px;transition:width .4s}
      .pet-row2{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:0 12px 8px}
      .pet-lvl{color:#fff;font-weight:800;font-size:13px;text-shadow:0 1px 3px rgba(0,0,0,.5);line-height:1.2}
      .pet-x{position:absolute;top:8px;right:8px;width:40px;height:40px;border:1px solid rgba(255,255,255,.28);border-radius:50%;background:rgba(20,12,9,.55);color:#fff;font-size:22px;cursor:pointer;z-index:4}
      .pet-stage{position:relative;flex:1;overflow:hidden}
      .pet-cat{position:absolute;bottom:23%;height:46%;width:auto;max-height:320px;transform-origin:bottom center;will-change:left,transform} /* тень уже запечена в кадры (rembg); filter:drop-shadow тут заставлял GPU перерастеризовывать кота каждый кадр ходьбы — жалоба «тормозит». height/max-height переопределяет setCatFrame() пер-кадрово */
      .pet-fx{position:absolute;inset:0;pointer-events:none;z-index:4}
      .pet-name{position:absolute;top:10px;left:12px;color:#fff;font-weight:900;font-size:18px;text-shadow:0 2px 5px rgba(0,0,0,.5);z-index:3}
      .pet-action{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);z-index:5}
      .pet-action__btn{border:none;border-radius:18px;padding:14px 30px;font-size:17px;font-weight:800;color:#fff;background:#ff7a2d;box-shadow:0 8px 20px rgba(255,122,45,.5);cursor:pointer}
      /* Панель комнат — в языке навигации игры (тёмный шоколад + золотой актив),
         чтобы «Дом» не выглядел другим приложением (аудит 30.07) */
      .pet-nav{position:relative;z-index:3;display:flex;justify-content:space-around;padding:8px 6px 14px;background:linear-gradient(0deg,rgba(20,12,9,.62),transparent)}
      .pet-nav__b{flex:1;margin:0 4px;border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:8px 4px;background:rgba(26,18,14,.78);font-size:12px;font-weight:700;color:#eee7dd;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px}
      .pet-nav__b.on{background:linear-gradient(180deg,#ffe7a6,#eebf52);border-color:#ffe9b3;color:#5a2028;box-shadow:0 4px 10px rgba(0,0,0,.25)}
      .pet-nav__b .i{font-size:20px}
      .pet-bubble{position:absolute;z-index:5;background:#fff;border-radius:14px;padding:6px 10px;font-weight:800;color:#7a3b12;box-shadow:0 4px 12px rgba(0,0,0,.2);font-size:14px;transform:translate(-50%,0);opacity:0;transition:opacity .2s}
      .pet-play{position:absolute;inset:0;z-index:6;display:none;align-items:center;justify-content:center;background:rgba(40,20,8,.5);backdrop-filter:blur(2px)}
      .pet-play.on{display:flex}
      .pet-play__card{background:#fff5ea;border-radius:22px;padding:22px;width:84%;max-width:340px;text-align:center}
      .pet-play__card h3{margin:0 0 12px;color:#7a3b12}
      .pet-play__g{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
      .pet-play__g button{border:none;border-radius:16px;padding:14px 18px;font-weight:800;cursor:pointer;background:#ff7a2d;color:#fff;font-size:15px}
      .pet-shop-btn{position:absolute;top:8px;right:88px;z-index:4;width:34px;height:34px;border:none;border-radius:50%;background:rgba(0,0,0,.3);color:#fff;font-size:17px;cursor:pointer}
      .pet-shop{position:absolute;inset:0;z-index:7;display:none;flex-direction:column;background:rgba(40,20,8,.55);backdrop-filter:blur(3px)}
      .pet-shop.on{display:flex}
      .pet-shop__h{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;color:#fff;font-weight:900;font-size:18px}
      .pet-shop__h button{border:none;border-radius:12px;padding:8px 14px;font-weight:800;background:#fff;color:#7a3b12;cursor:pointer}
      .pet-shop__grid{flex:1;overflow:auto;display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:0 14px 18px}
      .pet-item{background:#fff7ee;border-radius:18px;padding:12px;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,.15)}
      .pet-item img{width:78px;height:78px;object-fit:contain}
      .pet-item__n{font-weight:800;color:#7a3b12;font-size:13px;margin:4px 0}
      .pet-item__b{border:none;border-radius:12px;padding:9px 0;width:100%;font-weight:800;cursor:pointer;font-size:13px}
      .pet-item__b.buy{background:#ffcf3f;color:#7a3b12}
      .pet-item__b.buy:disabled{background:#e7ddcf;color:#b3a48f;cursor:default}
      .pet-item__b.equip{background:#ff7a2d;color:#fff}
      .pet-item__b.on{background:#7ed957;color:#fff}
      .pet-streak{position:static;margin-left:auto;font-weight:800;font-size:13px;color:#c2882a;background:rgba(255,255,255,.7);border-radius:12px;padding:5px 10px;white-space:nowrap}
      .pet-gift{position:absolute;left:50%;transform:translateX(-50%);bottom:172px;z-index:6;display:flex;align-items:center;gap:7px;border:0;cursor:pointer;font:inherit;font-weight:800;font-size:13px;color:#7a5a13;background:rgba(255,248,231,.92);border-radius:14px;padding:7px 12px;box-shadow:0 2px 10px rgba(0,0,0,.12)}
      .pet-gift.ready{color:#fff;background:linear-gradient(120deg,#e0a93c,#c2882a);animation:petgift 1.6s ease-in-out infinite}
      @keyframes petgift{0%,100%{transform:translateX(-50%) scale(1)}50%{transform:translateX(-50%) scale(1.05)}}
      @media (prefers-reduced-motion: reduce){.pet-gift.ready{animation:none}}
      .pet-toast{position:absolute;left:50%;bottom:96px;transform:translateX(-50%);z-index:8;max-width:88%;text-align:center;background:linear-gradient(180deg,#ffe7a6,#eebf52);color:#5a2028;font-weight:800;font-size:13px;border-radius:14px;padding:9px 14px;opacity:0;transition:opacity .3s;pointer-events:none}
      .pet-toast.on{opacity:1}
      .pet-x::after,.pet-shop-btn::after{content:'';position:absolute;inset:-7px} /* хит-ареа 34px → 48px */
      #pet-do:active,.pet-nav__b:active,#pet-x:active,#pet-shop-btn:active,.pet-item__b:active:not(:disabled),.pet-play__g button:active,.pet-shop__h button:active{transform:scale(.95);filter:brightness(.93)}
      #pet-gift:active{filter:brightness(.9)} /* transform не трогаем: конфликт с translateX(-50%) и анимацией .ready */
    `;
    document.head.appendChild(s);
  }

  function build() {
    styles();
    ov = document.createElement('div'); ov.className = 'pet-ov';
    ov.innerHTML = `
      <div class="pet-topwrap">
        <div class="pet-top" id="pet-needs"></div>
        <div class="pet-row2">
          <div class="pet-lvl" id="pet-lvl"></div>
          <div class="pet-streak" id="pet-streak"></div>
        </div>
      </div>
      <button class="pet-gift" id="pet-gift" style="display:none" type="button" data-haptic="light"></button>
      <button class="pet-x" id="pet-x" data-haptic="light">×</button>
      <button class="pet-shop-btn" id="pet-shop-btn" data-haptic="light"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.57a1 1 0 0 0 .99.84H5v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V10h1.15a1 1 0 0 0 .99-.84l.58-3.57a2 2 0 0 0-1.34-2.23z"/></svg></button>
      <div class="pet-stage" id="pet-stage">
        <div class="pet-name" id="pet-locname"></div>
        <img class="pet-cat" id="pet-cat" draggable="false"/>
        <div class="pet-fx" id="pet-fx"></div>
        <div class="pet-action" id="pet-action"></div>
      </div>
      <div class="pet-shop" id="pet-shop">
        <div class="pet-shop__h"><span>Наряды Василия · <span id="pet-shop-coins">0</span> монет</span><button id="pet-shop-close" data-haptic="light">Готово</button></div>
        <div class="pet-shop__grid" id="pet-shop-grid"></div>
      </div>
      <div class="pet-nav" id="pet-nav"></div>
      <div class="pet-play" id="pet-play"><div class="pet-play__card"><h3>Во что поиграем?</h3><div class="pet-play__g">
        <button id="pet-g-feed">Накорми</button><button id="pet-g-catch">Ловилка</button>
      </div><div style="margin-top:14px"><button id="pet-g-cancel" data-haptic="light" style="background:#eee;color:#7a3b12;border:none;border-radius:14px;padding:10px 18px;font-weight:700;cursor:pointer">Назад</button></div></div></div>
    `;
    document.body.appendChild(ov);
    ov.querySelector('#pet-x').onclick = close;
    ov.querySelector('#pet-gift').onclick = openGiftLadder;
    // nav
    const nav = ov.querySelector('#pet-nav');
    nav.innerHTML = ORDER.map(k => `<button class="pet-nav__b" data-loc="${k}" data-haptic="selection"><span class="i">${NAV_ICON[LOC[k].action](20)}</span>${LOC[k].name}</button>`).join('');
    nav.querySelectorAll('.pet-nav__b').forEach(b => b.onclick = () => goLoc(b.dataset.loc));
    // play menu
    ov.querySelector('#pet-g-feed').onclick = () => { hidePlay(); window.catFeedOpen?.(); afterPlay(); };
    ov.querySelector('#pet-g-catch').onclick = () => { hidePlay(); window.catGameOpen?.(); afterPlay(); };
    ov.querySelector('#pet-g-cancel').onclick = hidePlay;
    // магазин
    ov.querySelector('#pet-shop-btn').onclick = () => { renderShop(); ov.querySelector('#pet-shop').classList.add('on'); };
    ov.querySelector('#pet-shop-close').onclick = () => ov.querySelector('#pet-shop').classList.remove('on');
    // тап по фону попапа = закрыть (по самому оверлею, не по внутренностям)
    ov.querySelector('#pet-shop').onclick = (e) => { if (e.target === e.currentTarget) { window.haptic?.('light'); e.currentTarget.classList.remove('on'); } };
    ov.querySelector('#pet-play').onclick = (e) => { if (e.target === e.currentTarget) { window.haptic?.('light'); hidePlay(); } };
    // needs skeleton
    ov.querySelector('#pet-needs').innerHTML = NEEDS.map(n => `
      <div class="pet-need"><span class="pet-need__i">${n.ic(15)}</span><div class="pet-need__bar"><div class="pet-need__fill" id="need-${n.k}"></div></div></div>`).join('');
  }

  let careGranted = null; // Set id забранных care-вех (authed); null = ещё не загружено
  async function loadCareGranted() {
    if (!authed()) { careGranted = new Set(); return; }
    try {
      const d = await api('/api/clicker/milestones');
      careGranted = new Set((d && d.milestones || []).filter(m => m.granted && m.id.indexOf('ms_care') === 0).map(m => m.id));
    } catch (_) { careGranted = new Set(); }
  }
  function renderGift(state) {
    const el = ov.querySelector('#pet-gift'); if (!el || !state) return;
    const best = Math.max(Number(state.careStreakBest || 0), Number(state.careStreak || 0), Number(state.care_streak || 0));
    const granted = careGranted || new Set();
    const next = CARE_MILESTONES.find(m => !granted.has('ms_care' + m.d));
    if (!next) { el.style.display = 'none'; return; }
    el.style.display = '';
    if (best >= next.d) { el.classList.add('ready'); el.innerHTML = PIC.gift(15) + ' Тебя ждёт подарок: ' + next.label + '!'; }
    else { el.classList.remove('ready'); el.innerHTML = PIC.gift(15) + ' До подарка «' + next.label + '»: ещё ' + (next.d - best) + ' дн. заботы'; }
  }
  function openGiftLadder() {
    close();
    try {
      const ck = document.querySelector('.ck-ov');
      if (ck && ck.classList.contains('on')) { window.ckSetTab && window.ckSetTab('tasks'); }
      else if (window.catClickOpen) { Promise.resolve(window.catClickOpen()).then(() => { window.ckSetTab && window.ckSetTab('tasks'); }); }
    } catch (_) {}
  }

  function renderNeeds() {
    if (!state) return;
    NEEDS.forEach(n => {
      const el = ov.querySelector('#need-' + n.k); if (!el) return;
      const v = state[n.k] ?? 0; el.style.width = v + '%';
      el.style.background = v > 50 ? 'linear-gradient(90deg,#7ed957,#aee571)' : v > 25 ? 'linear-gradient(90deg,#ffb347,#ffd23f)' : 'linear-gradient(90deg,#ff5a5a,#ff8a8a)';
    });
    ov.querySelector('#pet-lvl').innerHTML = `Ур. ${state.level} · ${state.coins} ${plu(state.coins, 'монета', 'монеты', 'монет')}<br><span style="font-weight:600;opacity:.85">${state.xp}/${state.xpNext} XP</span>`;
    const ps = ov.querySelector('#pet-streak');
    if (ps) ps.innerHTML = (state.careStreak > 0)
      ? PIC.pet(14) + ' Забота: ' + state.careStreak + (state.careStreak >= 5 ? ' дней' : ' дн.')
      : 'Погладь Василия!';
  }

  function renderLoc() {
    ov.style.backgroundImage = `url(${A(LOC[loc].bg)})`;
    ov.querySelector('#pet-locname').innerHTML = NAV_ICON[LOC[loc].action](16) + ' ' + LOC[loc].name;
    ov.querySelectorAll('.pet-nav__b').forEach(b => b.classList.toggle('on', b.dataset.loc === loc));
    const act = ov.querySelector('#pet-action');
    act.innerHTML = `<button class="pet-action__btn" id="pet-do">${LOC[loc].label}</button>`;
    act.querySelector('#pet-do').onclick = onAction;
  }

  function goLoc(k) {
    if (k === loc) return;
    if (window.ckCoachClose) { try { window.ckCoachClose(); } catch (_) {} }
    loc = k; cat.x = 0.5; saveLoc(); renderLoc();
    if (k === 'playroom' && window.ckCoach) { try { window.ckCoach('homePlay', COACH_PET.homePlay, '#pet-do', { icon: PIC.play(18), root: ov }); } catch (_) {} }
    if (k === 'yard' && window.ckCoach) { try { window.ckCoach('hats', COACH_PET.hats, '#pet-shop-btn', { icon: PIC.gift(18), root: ov }); } catch (_) {} }
  }

  // ── Действия ухода ──────────────────────────────────────────────────────────
  let actionBusy = false, poseTm = 0; // анти-даблтап + таймер возврата позы в idle
  async function onAction() {
    const cfg = LOC[loc];
    if (cfg.action === 'play') { showPlay(); return; }
    if (actionBusy) return;
    actionBusy = true;
    const btn = ov.querySelector('#pet-do'); if (btn) btn.disabled = true;
    clearTimeout(poseTm); // старый таймер не должен сбросить позу посреди нового действия
    cat.busy = true;
    const catEl = ov.querySelector('#pet-cat');
    if (cfg.action === 'feed') { setCatFrame(catEl, 'happy.png'); bubble('Ням!'); hearts(); }
    else if (cfg.action === 'sleep') { setCatFrame(catEl, 'full.png'); bubble('Zzz'); }
    else { setCatFrame(catEl, 'happy.png'); bubble('Мур!'); hearts(); }
    window.haptic?.('medium');
    try { await doAction(cfg.action); }
    finally { actionBusy = false; if (btn) btn.disabled = false; }
    // после действия возвращаемся в idle — иначе поза (особенно лежачая) залипала до следующей ходьбы
    poseTm = setTimeout(() => { cat.busy = false; setCatFrame(catEl, 'idle.png'); }, 1400);
  }

  function bubble(text) {
    const fx = ov.querySelector('#pet-fx'); const catEl = ov.querySelector('#pet-cat');
    const b = document.createElement('div'); b.className = 'pet-bubble'; b.textContent = text;
    fx.appendChild(b);
    const r = catEl.getBoundingClientRect(); const sr = fx.getBoundingClientRect();
    b.style.left = (r.left - sr.left + r.width / 2) + 'px'; b.style.top = (r.top - sr.top - 18) + 'px';
    requestAnimationFrame(() => b.style.opacity = '1');
    setTimeout(() => { b.style.opacity = '0'; setTimeout(() => b.remove(), 300); }, 1300);
  }
  function hearts() {
    const fx = ov.querySelector('#pet-fx'); const catEl = ov.querySelector('#pet-cat');
    const r = catEl.getBoundingClientRect(); const sr = fx.getBoundingClientRect();
    for (let i = 0; i < 6; i++) {
      const h = document.createElement('div'); h.innerHTML = PIC.pet(22); h.style.cssText = 'position:absolute;font-size:22px;pointer-events:none;transition:transform 1s ease-out,opacity 1s';
      h.style.left = (r.left - sr.left + r.width * (0.3 + Math.random() * 0.4)) + 'px'; h.style.top = (r.top - sr.top + r.height * 0.2) + 'px';
      fx.appendChild(h);
      requestAnimationFrame(() => { h.style.transform = `translate(${(Math.random() - .5) * 80}px,-${80 + Math.random() * 60}px)`; h.style.opacity = '0'; });
      setTimeout(() => h.remove(), 1100);
    }
  }

  function renderShop() {
    if (!state) return;
    ov.querySelector('#pet-shop-coins').textContent = state.coins ?? 0;
    const owned = (state.items && state.items.owned) || [];
    const eq = (state.items && state.items.equipped) || null;
    ov.querySelector('#pet-shop-grid').innerHTML = SHOP.map(h => {
      const own = owned.includes(h.id), on = eq === h.id;
      let btn;
      if (!own) btn = `<button class="pet-item__b buy" data-buy="${h.id}" ${(state.coins ?? 0) < h.price ? 'disabled' : ''}>${h.price} ${plu(h.price, 'монета', 'монеты', 'монет')}</button>`;
      else if (on) btn = `<button class="pet-item__b on" data-equip="">Снять</button>`;
      else btn = `<button class="pet-item__b equip" data-equip="${h.id}">Надеть</button>`;
      return `<div class="pet-item"><img src="${A(h.img)}"/><div class="pet-item__n">${h.name}</div>${btn}</div>`;
    }).join('');
    // на время запроса кнопка гаснет с «…»; buyItem/equipItem в конце перерисуют весь грид
    ov.querySelectorAll('#pet-shop-grid [data-buy]').forEach(b => b.onclick = () => {
      if (b.disabled) return;
      b.disabled = true; b.textContent = '…';
      buyItem(b.dataset.buy);
    });
    ov.querySelectorAll('#pet-shop-grid [data-equip]').forEach(b => b.onclick = () => {
      if (b.disabled) return;
      b.disabled = true; b.textContent = '…';
      equipItem(b.dataset.equip);
    });
  }
  function renderHat() {
    // Шляпа впечена в webp-кадры — просто пере-применяем текущий кадр с учётом надетого.
    const catEl = ov.querySelector('#pet-cat'); if (!catEl) return;
    setCatFrame(catEl, catEl.dataset.frame || 'idle.png');
  }

  function showPlay() { window.haptic?.('light'); ov.querySelector('#pet-play').classList.add('on'); }
  function hidePlay() { ov.querySelector('#pet-play').classList.remove('on'); }
  let playCheck = 0; // интервал ожидания конца мини-игры — чистится в close()
  function afterPlay() {
    // вернулись из мини-игры → настроение вверх (оптимистично)
    clearInterval(playCheck);
    let seen = false; // оверлей игры обязан был реально появиться — иначе первый тик дарит бесплатный play
    playCheck = setInterval(() => {
      const playing = document.querySelector('.cg-ov.on, .cf2-root.on, .cf-ov.on');
      if (playing) { seen = true; return; }
      clearInterval(playCheck);
      if (seen) doAction('play');
    }, 800);
  }

  // ── Цикл «кот ходит» ─────────────────────────────────────────────────────────
  function loop(ts) {
    if (!ov || !ov.classList.contains('on') || document.hidden) return;
    const dtFull = lastTs ? (ts - lastTs) / 1000 : 0.016; lastTs = ts;
    renderAcc += dtFull;
    if (renderAcc < FRAME_BUDGET) { raf = requestAnimationFrame(loop); return; } // кап 30fps: копим dt, рисуем раз в ~33мс
    const dt = renderAcc; renderAcc = 0;
    const catEl = ov.querySelector('#pet-cat');
    const stage = ov.querySelector('#pet-stage');
    if (!catEl || !stage) { raf = requestAnimationFrame(loop); return; }
    const W = stage.clientWidth;
    if (!cat.busy) {
      cat.t += dt;
      if (cat.mode === 'walk') {
        cat.x += cat.dir * cat.vx * dt;
        if (cat.x < 0.12) { cat.x = 0.12; cat.dir = 1; }
        if (cat.x > 0.88) { cat.x = 0.88; cat.dir = -1; }
        // смена кадров ходьбы
        cat.frame = (cat.frame + dt * 8) % WALK.length;
        setCatFrame(catEl, WALK[Math.floor(cat.frame)]);
        catEl.style.transform = `scaleX(${cat.dir})`;
        if (cat.t > 1.2 + Math.random() * 1.4) { cat.mode = 'idle'; cat.t = 0; setCatFrame(catEl, 'idle.png'); catEl.style.transform = 'scaleX(1)'; }
      } else { // idle — кот в основном стоит анфас (шапка видна, нет дрожания кадров)
        if (cat.t > 4 + Math.random() * 4) { cat.mode = 'walk'; cat.t = 0; cat.dir = Math.random() < 0.5 ? -1 : 1; }
      }
    }
    const catW = catEl.offsetWidth;
    // клэмп по фактической ширине кадра — широкий лежачий кадр не должен резаться краями сцены
    catEl.style.left = Math.max(0, Math.min(W - catW, cat.x * W - catW / 2)) + 'px';
    raf = requestAnimationFrame(loop);
  }

  // ── Открытие/закрытие ───────────────────────────────────────────────────────
  async function open() {
    if (!ov) build();
    ov.classList.add('on'); window.scrollLock?.();
    try { await loadState(); } catch (_) { state = localGet(); if (authed()) showToast('Нет связи — показан офлайн-режим'); }
    // префетч кадров ходьбы — после loadState, чтобы префетчить вариант с надетой шляпой
    walkImgs = WALK.map(w => { const i = new Image(); i.src = A(catSrc(w)); return i; });
    // + кадры действий (покормить/уложить спать) — та же причина «дёргается» была на них,
    // просто реже, т.к. они грузились впервые только по нажатию кнопки.
    ['happy.png', 'full.png'].forEach(f => { const i = new Image(); i.src = A(catSrc(f)); walkImgs.push(i); });
    renderNeeds(); renderLoc(); renderHat();
    const openN = bumpHomeOpenCount();
    if (window.ckCoach) {
      try {
        if (openN <= 1) window.ckCoach('home', COACH_PET.home, '#pet-do', { icon: PIC.pet(18), root: ov });
        else window.ckCoach('petNeeds', COACH_PET.petNeeds, '#pet-do', { icon: PIC.hunger(18), root: ov });
      } catch (_) {}
    }
    renderGift(state); loadCareGranted().then(() => renderGift(state));
    attachImgRetry(ov.querySelector('#pet-cat'));
    setCatFrame(ov.querySelector('#pet-cat'), 'idle.png');
    cat = { x: 0.5, dir: 1, vx: 0.04, mode: 'walk', frame: 0, t: 0, busy: false };
    lastTs = 0; renderAcc = 0; cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
  }
  function close() {
    cancelAnimationFrame(raf); clearInterval(playCheck);
    if (window.ckCoachClose) { try { window.ckCoachClose(); } catch (_) {} }
    if (ov) {
      ov.classList.remove('on');
      // прибираем попапы — иначе при повторном открытии Дома всплывают старые
      ov.querySelector('#pet-shop').classList.remove('on');
      ov.querySelector('#pet-play').classList.remove('on');
    }
    window.scrollUnlock?.();
  }
  // Вкладка ушла в фон — останавливаем rAF-цикл ходьбы (жалоба «тормозит», лишние тики впустую);
  // вернулись — перезапускаем, только если Дом всё ещё открыт.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(raf); }
    else if (ov && ov.classList.contains('on')) { lastTs = 0; renderAcc = 0; cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); }
  });
  window.catPetOpen = open;
  window.catPetClose = close;
})();

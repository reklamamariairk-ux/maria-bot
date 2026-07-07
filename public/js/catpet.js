/* ── «Дом Василия» — виртуальный питомец (тамагочи) ───────────────────────────
 * Василий живёт в приложении, ХОДИТ по 4 локациям, у него потребности (голод/настроение/
 * энергия/чистота), за ним ухаживаешь. Состояние — на сервере (/api/pet) для
 * авторизованных, на localStorage для гостей. Мини-игры открываются в Игровой.
 * Арт: cat/walk1..4.png (ходьба сбоку), idle/happy/full/hungry/open/chew (анфас),
 *      bakery-bg.jpg (кухня) + bg-bedroom/playroom/yard.jpg
 * ───────────────────────────────────────────────────────────────────────────── */
(function () {
  const A = (s) => `/assets/images/cat/${s}`;
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
  };
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
    { k: 'hygiene',ic: PIC.hygiene,name: 'Чистота' },
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

  let ov, state, loc = 'kitchen', cat = { x: 0.5, dir: 1, vx: 0.04, mode: 'walk', frame: 0, t: 0, busy: false };
  let raf, lastTs = 0, walkImgs = [];

  // ── Состояние: сервер или localStorage ──────────────────────────────────────
  function authed() { return !!(window.App && App.isAuthed && App.isAuthed()); }
  function localDefault() { return { hunger: 80, mood: 80, energy: 80, hygiene: 80, level: 1, xp: 0, xpNext: 100, coins: 0, location: 'kitchen', items: { owned: [], equipped: null }, _ts: Date.now() }; }
  function localGet() {
    let s; try { s = JSON.parse(localStorage.getItem(LS)); } catch (_) {}
    if (!s) s = localDefault();
    if (!s.items) s.items = { owned: [], equipped: null };
    const hrs = Math.max(0, (Date.now() - (s._ts || Date.now())) / 3600000);
    const dec = { hunger: 6, mood: 4, energy: 3, hygiene: 2.5 };
    ['hunger', 'mood', 'energy', 'hygiene'].forEach(k => s[k] = Math.max(0, Math.min(100, Math.round(s[k] - dec[k] * hrs))));
    s._ts = Date.now(); localStorage.setItem(LS, JSON.stringify(s));
    return s;
  }
  function localBuy(id) {
    const s = localGet(); const it = HAT(id); if (!it) return s;
    if (!s.items.owned.includes(id) && s.coins >= it.price) { s.coins -= it.price; s.items.owned.push(id); }
    localStorage.setItem(LS, JSON.stringify(s)); return s;
  }
  function localEquip(id) {
    const s = localGet(); s.items.equipped = (id && s.items.owned.includes(id)) ? id : null;
    localStorage.setItem(LS, JSON.stringify(s)); return s;
  }
  function localAction(action) {
    const s = localGet();
    const R = { feed: { hunger: 45, mood: 8 }, sleep: { energy: 55, mood: 5 }, play: { mood: 35, energy: -10 }, walk: { mood: 18, energy: -4 } }[action] || {};
    Object.keys(R).forEach(k => s[k] = Math.max(0, Math.min(100, s[k] + R[k])));
    s.xp += 12; s.coins += 3; while (s.xp >= s.xpNext) { s.xp -= s.xpNext; s.level++; s.xpNext = s.level * 100; }
    s._ts = Date.now(); localStorage.setItem(LS, JSON.stringify(s)); return s;
  }
  async function api(path, opts) {
    const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(App.authHeader ? App.authHeader() : {}) } });
    return r.json();
  }
  async function loadState() { state = authed() ? await api('/api/pet') : localGet(); loc = state.location && LOC[state.location] ? state.location : 'kitchen'; }
  async function doAction(action) {
    if (authed()) { try { state = await api('/api/pet/action', { method: 'POST', body: JSON.stringify({ action }) }); } catch (_) {} }
    else state = localAction(action);
    renderNeeds();
  }
  async function saveLoc() { if (authed()) { api('/api/pet/location', { method: 'POST', body: JSON.stringify({ location: loc }) }).catch(() => {}); } else { const s = localGet(); s.location = loc; localStorage.setItem(LS, JSON.stringify(s)); } }
  async function buyItem(id) {
    if (authed()) { try { const r = await api('/api/pet/buy', { method: 'POST', body: JSON.stringify({ item: id }) }); if (!r.error) state = r; } catch (_) {} }
    else state = localBuy(id);
    renderNeeds(); renderShop(); renderHat();
  }
  async function equipItem(id) {
    if (authed()) { try { const r = await api('/api/pet/equip', { method: 'POST', body: JSON.stringify({ item: id }) }); if (!r.error) state = r; } catch (_) {} }
    else state = localEquip(id);
    renderShop(); renderHat();
  }

  // ── UI ────────────────────────────────────────────────────────────────────────
  function styles() {
    if (document.getElementById('catpet-css')) return;
    const s = document.createElement('style'); s.id = 'catpet-css';
    s.textContent = `
      .pet-i{display:inline-block;vertical-align:-.18em}
      .pet-ov{position:fixed;inset:0;z-index:9999;display:none;flex-direction:column;overflow:hidden;background:#fdfaf3 center/cover no-repeat;touch-action:none;user-select:none}
      .pet-ov.on{display:flex}
      .pet-top{position:relative;z-index:3;display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;padding:10px 12px;background:linear-gradient(180deg,rgba(0,0,0,.28),transparent)}
      .pet-need{display:flex;align-items:center;gap:5px;flex:1 1 44%}
      .pet-need__i{font-size:15px}
      .pet-need__bar{flex:1;height:9px;border-radius:6px;background:rgba(255,255,255,.45);overflow:hidden}
      .pet-need__fill{height:100%;border-radius:6px;transition:width .4s}
      .pet-lvl{position:absolute;top:10px;right:48px;color:#fff;font-weight:800;font-size:13px;text-shadow:0 1px 3px rgba(0,0,0,.5);text-align:right;line-height:1.2}
      .pet-x{position:absolute;top:8px;right:8px;width:34px;height:34px;border:none;border-radius:50%;background:rgba(0,0,0,.3);color:#fff;font-size:19px;cursor:pointer;z-index:4}
      .pet-stage{position:relative;flex:1;overflow:hidden}
      .pet-cat{position:absolute;bottom:14%;width:34%;max-width:200px;filter:drop-shadow(0 12px 14px rgba(0,0,0,.3));transform-origin:bottom center;will-change:left,transform}
      .pet-fx{position:absolute;inset:0;pointer-events:none;z-index:4}
      .pet-name{position:absolute;top:10px;left:12px;color:#fff;font-weight:900;font-size:18px;text-shadow:0 2px 5px rgba(0,0,0,.5);z-index:3}
      .pet-action{position:absolute;left:50%;bottom:78px;transform:translateX(-50%);z-index:5}
      .pet-action__btn{border:none;border-radius:18px;padding:14px 30px;font-size:17px;font-weight:800;color:#fff;background:#ff7a2d;box-shadow:0 8px 20px rgba(255,122,45,.5);cursor:pointer}
      .pet-nav{position:relative;z-index:3;display:flex;justify-content:space-around;padding:8px 6px 14px;background:linear-gradient(0deg,rgba(0,0,0,.32),transparent)}
      .pet-nav__b{flex:1;margin:0 4px;border:none;border-radius:14px;padding:8px 4px;background:rgba(255,255,255,.85);font-size:12px;font-weight:700;color:#7a3b12;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px}
      .pet-nav__b.on{background:#ffd23f;box-shadow:0 4px 10px rgba(0,0,0,.2)}
      .pet-nav__b .i{font-size:20px}
      .pet-bubble{position:absolute;z-index:5;background:#fff;border-radius:14px;padding:6px 10px;font-weight:800;color:#7a3b12;box-shadow:0 4px 12px rgba(0,0,0,.2);font-size:14px;transform:transl(-50%,0);opacity:0;transition:opacity .2s}
      .pet-play{position:absolute;inset:0;z-index:6;display:none;align-items:center;justify-content:center;background:rgba(40,20,8,.5);backdrop-filter:blur(2px)}
      .pet-play.on{display:flex}
      .pet-play__card{background:#fff5ea;border-radius:22px;padding:22px;width:84%;max-width:340px;text-align:center}
      .pet-play__card h3{margin:0 0 12px;color:#7a3b12}
      .pet-play__g{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
      .pet-play__g button{border:none;border-radius:16px;padding:14px 18px;font-weight:800;cursor:pointer;background:#ff7a2d;color:#fff;font-size:15px}
      .pet-shop-btn{position:absolute;top:8px;right:88px;z-index:4;width:34px;height:34px;border:none;border-radius:50%;background:rgba(0,0,0,.3);color:#fff;font-size:17px;cursor:pointer}
      .pet-hat{position:absolute;z-index:2;pointer-events:none;will-change:left,top,transform;filter:drop-shadow(0 4px 5px rgba(0,0,0,.25))}
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
    `;
    document.head.appendChild(s);
  }

  function build() {
    styles();
    ov = document.createElement('div'); ov.className = 'pet-ov';
    ov.innerHTML = `
      <div class="pet-top" id="pet-needs"></div>
      <div class="pet-lvl" id="pet-lvl"></div>
      <button class="pet-x" id="pet-x">×</button>
      <button class="pet-shop-btn" id="pet-shop-btn"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.57a1 1 0 0 0 .99.84H5v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V10h1.15a1 1 0 0 0 .99-.84l.58-3.57a2 2 0 0 0-1.34-2.23z"/></svg></button>
      <div class="pet-stage" id="pet-stage">
        <div class="pet-name" id="pet-locname"></div>
        <img class="pet-cat" id="pet-cat" draggable="false"/>
        <img class="pet-hat" id="pet-hat" draggable="false" style="display:none"/>
        <div class="pet-fx" id="pet-fx"></div>
        <div class="pet-action" id="pet-action"></div>
      </div>
      <div class="pet-shop" id="pet-shop">
        <div class="pet-shop__h"><span>Наряды Василия · <span id="pet-shop-coins">0</span> монет</span><button id="pet-shop-close">Готово</button></div>
        <div class="pet-shop__grid" id="pet-shop-grid"></div>
      </div>
      <div class="pet-nav" id="pet-nav"></div>
      <div class="pet-play" id="pet-play"><div class="pet-play__card"><h3>Во что поиграем?</h3><div class="pet-play__g">
        <button id="pet-g-feed">Накорми</button><button id="pet-g-catch">Ловилка</button>
      </div><div style="margin-top:14px"><button id="pet-g-cancel" style="background:#eee;color:#7a3b12;border:none;border-radius:14px;padding:10px 18px;font-weight:700;cursor:pointer">Назад</button></div></div></div>
    `;
    document.body.appendChild(ov);
    ov.querySelector('#pet-x').onclick = close;
    // nav
    const nav = ov.querySelector('#pet-nav');
    nav.innerHTML = ORDER.map(k => `<button class="pet-nav__b" data-loc="${k}"><span class="i">${NAV_ICON[LOC[k].action](20)}</span>${LOC[k].name}</button>`).join('');
    nav.querySelectorAll('.pet-nav__b').forEach(b => b.onclick = () => goLoc(b.dataset.loc));
    // play menu
    ov.querySelector('#pet-g-feed').onclick = () => { hidePlay(); window.catFeedOpen?.(); afterPlay(); };
    ov.querySelector('#pet-g-catch').onclick = () => { hidePlay(); window.catGameOpen?.(); afterPlay(); };
    ov.querySelector('#pet-g-cancel').onclick = hidePlay;
    // магазин
    ov.querySelector('#pet-shop-btn').onclick = () => { renderShop(); ov.querySelector('#pet-shop').classList.add('on'); };
    ov.querySelector('#pet-shop-close').onclick = () => ov.querySelector('#pet-shop').classList.remove('on');
    // needs skeleton
    ov.querySelector('#pet-needs').innerHTML = NEEDS.map(n => `
      <div class="pet-need"><span class="pet-need__i">${n.ic(15)}</span><div class="pet-need__bar"><div class="pet-need__fill" id="need-${n.k}"></div></div></div>`).join('');
  }

  function renderNeeds() {
    if (!state) return;
    NEEDS.forEach(n => {
      const el = ov.querySelector('#need-' + n.k); if (!el) return;
      const v = state[n.k] ?? 0; el.style.width = v + '%';
      el.style.background = v > 50 ? 'linear-gradient(90deg,#7ed957,#aee571)' : v > 25 ? 'linear-gradient(90deg,#ffb347,#ffd23f)' : 'linear-gradient(90deg,#ff5a5a,#ff8a8a)';
    });
    ov.querySelector('#pet-lvl').innerHTML = `Ур. ${state.level} · ${state.coins} монет<br><span style="font-weight:600;opacity:.85">${state.xp}/${state.xpNext} XP</span>`;
  }

  function renderLoc() {
    ov.style.backgroundImage = `url(${A(LOC[loc].bg)})`;
    ov.querySelector('#pet-locname').innerHTML = NAV_ICON[LOC[loc].action](16) + ' ' + LOC[loc].name;
    ov.querySelectorAll('.pet-nav__b').forEach(b => b.classList.toggle('on', b.dataset.loc === loc));
    const act = ov.querySelector('#pet-action');
    act.innerHTML = `<button class="pet-action__btn" id="pet-do">${LOC[loc].label}</button>`;
    act.querySelector('#pet-do').onclick = onAction;
  }

  function goLoc(k) { if (k === loc) return; loc = k; cat.x = 0.5; saveLoc(); renderLoc(); }

  // ── Действия ухода ──────────────────────────────────────────────────────────
  async function onAction() {
    const cfg = LOC[loc];
    if (cfg.action === 'play') { showPlay(); return; }
    cat.busy = true;
    const catEl = ov.querySelector('#pet-cat');
    if (cfg.action === 'feed') { catEl.src = A('happy.png'); bubble('Ням! 🍖'); hearts(); }
    else if (cfg.action === 'sleep') { catEl.src = A('full.png'); bubble('Zzz 💤'); }
    else { catEl.src = A('happy.png'); bubble('Мур! 💕'); hearts(); }
    window.haptic?.('light');
    await doAction(cfg.action);
    setTimeout(() => { cat.busy = false; }, 1400);
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
      const h = document.createElement('div'); h.textContent = '❤️'; h.style.cssText = 'position:absolute;font-size:22px;pointer-events:none;transition:transform 1s ease-out,opacity 1s';
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
      if (!own) btn = `<button class="pet-item__b buy" data-buy="${h.id}" ${(state.coins ?? 0) < h.price ? 'disabled' : ''}>${h.price} монет</button>`;
      else if (on) btn = `<button class="pet-item__b on" data-equip="">Снять</button>`;
      else btn = `<button class="pet-item__b equip" data-equip="${h.id}">Надеть</button>`;
      return `<div class="pet-item"><img src="${A(h.img)}"/><div class="pet-item__n">${h.name}</div>${btn}</div>`;
    }).join('');
    ov.querySelectorAll('#pet-shop-grid [data-buy]').forEach(b => b.onclick = () => buyItem(b.dataset.buy));
    ov.querySelectorAll('#pet-shop-grid [data-equip]').forEach(b => b.onclick = () => equipItem(b.dataset.equip));
  }
  function renderHat() {
    const hatEl = ov.querySelector('#pet-hat'); if (!hatEl) return;
    const id = state && state.items && state.items.equipped;
    if (!id || !HAT(id)) { hatEl.style.display = 'none'; return; }
    hatEl.src = A(HAT(id).img); hatEl.style.display = ''; // позиция — в loop
  }

  function showPlay() { ov.querySelector('#pet-play').classList.add('on'); }
  function hidePlay() { ov.querySelector('#pet-play').classList.remove('on'); }
  function afterPlay() {
    // вернулись из мини-игры → настроение вверх (оптимистично)
    const check = setInterval(() => {
      const playing = document.querySelector('.cg-ov.on, .cf2-root.on, .cf-ov.on');
      if (!playing) { clearInterval(check); doAction('play'); }
    }, 800);
  }

  // ── Цикл «кот ходит» ─────────────────────────────────────────────────────────
  function loop(ts) {
    if (!ov || !ov.classList.contains('on')) return;
    const dt = lastTs ? (ts - lastTs) / 1000 : 0.016; lastTs = ts;
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
        catEl.src = A(WALK[Math.floor(cat.frame)]);
        catEl.style.transform = `scaleX(${cat.dir})`;
        if (cat.t > 3 + Math.random() * 3) { cat.mode = 'idle'; cat.t = 0; catEl.src = A('idle.png'); catEl.style.transform = 'scaleX(1)'; }
      } else { // idle
        if (cat.t > 1.5 + Math.random() * 2) { cat.mode = 'walk'; cat.t = 0; cat.dir = Math.random() < 0.5 ? -1 : 1; }
      }
    }
    const catW = catEl.offsetWidth;
    catEl.style.left = (cat.x * W - catW / 2) + 'px';
    // шапка на голове — чисто на фронтальной позе; во время ходьбы (вид сбоку) прячем
    const hatEl = ov.querySelector('#pet-hat');
    if (hatEl && hatEl.style.display !== 'none') {
      const id = state && state.items && state.items.equipped; const h = id && HAT(id);
      const walking = cat.mode === 'walk' && !cat.busy;
      hatEl.style.opacity = walking ? '0' : '1';
      if (h && !walking) {
        const cr = catEl.getBoundingClientRect(), sr = stage.getBoundingClientRect();
        const hw = cr.width * h.w; hatEl.style.width = hw + 'px';
        const cx = (cr.left - sr.left) + cr.width * (0.5 + h.dx);
        hatEl.style.left = (cx - hw / 2) + 'px';
        hatEl.style.top = ((cr.top - sr.top) + cr.height * h.dy) + 'px';
        hatEl.style.transform = 'none';
      }
    }
    raf = requestAnimationFrame(loop);
  }

  // ── Открытие/закрытие ───────────────────────────────────────────────────────
  async function open() {
    if (!ov) build();
    ov.classList.add('on'); window.scrollLock?.();
    // префетч кадров ходьбы
    walkImgs = WALK.map(w => { const i = new Image(); i.src = A(w); return i; });
    try { await loadState(); } catch (_) { state = localGet(); }
    renderNeeds(); renderLoc(); renderHat();
    ov.querySelector('#pet-cat').src = A('idle.png');
    cat = { x: 0.5, dir: 1, vx: 0.04, mode: 'walk', frame: 0, t: 0, busy: false };
    lastTs = 0; cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
  }
  function close() { cancelAnimationFrame(raf); if (ov) ov.classList.remove('on'); window.scrollUnlock?.(); }
  window.catPetOpen = open;
  window.catPetClose = close;
})();

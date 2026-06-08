/* ── «Котик Марии» — виртуальный питомец (тамагочи) ───────────────────────────
 * Кот живёт в приложении, ХОДИТ по 4 локациям, у него потребности (голод/настроение/
 * энергия/чистота), за ним ухаживаешь. Состояние — на сервере (/api/pet) для
 * авторизованных, на localStorage для гостей. Мини-игры открываются в Игровой.
 * Арт: cat/walk1..4.png (ходьба сбоку), idle/happy/full/hungry/open/chew (анфас),
 *      bakery-bg.jpg (кухня) + bg-bedroom/playroom/yard.jpg
 * ───────────────────────────────────────────────────────────────────────────── */
(function () {
  const A = (s) => `/assets/images/cat/${s}`;
  const WALK = ['walk1.png', 'walk2.png', 'walk3.png', 'walk4.png'];
  const LOC = {
    kitchen:  { bg: 'bakery-bg.jpg', name: 'Кухня',   icon: '🍰', action: 'feed',  label: '🍖 Покормить', need: 'hunger' },
    bedroom:  { bg: 'bg-bedroom.jpg', name: 'Спальня', icon: '🛏', action: 'sleep', label: '💤 Уложить спать', need: 'energy' },
    playroom: { bg: 'bg-playroom.jpg', name: 'Игровая', icon: '🎮', action: 'play',  label: '🎮 Играть', need: 'mood' },
    yard:     { bg: 'bg-yard.jpg', name: 'Двор',     icon: '🌳', action: 'walk',  label: '✨ Погладить', need: 'mood' },
  };
  const ORDER = ['kitchen', 'bedroom', 'playroom', 'yard'];
  const NEEDS = [
    { k: 'hunger', icon: '🍖', name: 'Сытость' },
    { k: 'mood', icon: '😺', name: 'Настроение' },
    { k: 'energy', icon: '💤', name: 'Энергия' },
    { k: 'hygiene', icon: '🛁', name: 'Чистота' },
  ];
  const LS = 'maria_pet_v1';

  let ov, state, loc = 'kitchen', cat = { x: 0.5, dir: 1, vx: 0.04, mode: 'walk', frame: 0, t: 0, busy: false };
  let raf, lastTs = 0, walkImgs = [];

  // ── Состояние: сервер или localStorage ──────────────────────────────────────
  function authed() { return !!(window.App && App.isAuthed && App.isAuthed()); }
  function localDefault() { return { hunger: 80, mood: 80, energy: 80, hygiene: 80, level: 1, xp: 0, xpNext: 100, coins: 0, location: 'kitchen', _ts: Date.now() }; }
  function localGet() {
    let s; try { s = JSON.parse(localStorage.getItem(LS)); } catch (_) {}
    if (!s) s = localDefault();
    const hrs = Math.max(0, (Date.now() - (s._ts || Date.now())) / 3600000);
    const dec = { hunger: 12, mood: 8, energy: 6, hygiene: 5 };
    ['hunger', 'mood', 'energy', 'hygiene'].forEach(k => s[k] = Math.max(0, Math.min(100, Math.round(s[k] - dec[k] * hrs))));
    s._ts = Date.now(); localStorage.setItem(LS, JSON.stringify(s));
    return s;
  }
  function localAction(action) {
    const s = localGet();
    const R = { feed: { hunger: 45, mood: 8 }, sleep: { energy: 55, mood: 5 }, wash: { hygiene: 60, mood: 5 }, play: { mood: 35, energy: -10 } }[action] || {};
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

  // ── UI ────────────────────────────────────────────────────────────────────────
  function styles() {
    if (document.getElementById('catpet-css')) return;
    const s = document.createElement('style'); s.id = 'catpet-css';
    s.textContent = `
      .pet-ov{position:fixed;inset:0;z-index:9999;display:none;flex-direction:column;overflow:hidden;background:#f3e2cf center/cover no-repeat;touch-action:none;user-select:none}
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
      <div class="pet-stage" id="pet-stage">
        <div class="pet-name" id="pet-locname"></div>
        <img class="pet-cat" id="pet-cat" draggable="false"/>
        <div class="pet-fx" id="pet-fx"></div>
        <div class="pet-action" id="pet-action"></div>
      </div>
      <div class="pet-nav" id="pet-nav"></div>
      <div class="pet-play" id="pet-play"><div class="pet-play__card"><h3>Во что поиграем?</h3><div class="pet-play__g">
        <button id="pet-g-feed">🍰 Накорми</button><button id="pet-g-catch">🥧 Ловилка</button>
      </div><div style="margin-top:14px"><button id="pet-g-cancel" style="background:#eee;color:#7a3b12;border:none;border-radius:14px;padding:10px 18px;font-weight:700;cursor:pointer">Назад</button></div></div></div>
    `;
    document.body.appendChild(ov);
    ov.querySelector('#pet-x').onclick = close;
    // nav
    const nav = ov.querySelector('#pet-nav');
    nav.innerHTML = ORDER.map(k => `<button class="pet-nav__b" data-loc="${k}"><span class="i">${LOC[k].icon}</span>${LOC[k].name}</button>`).join('');
    nav.querySelectorAll('.pet-nav__b').forEach(b => b.onclick = () => goLoc(b.dataset.loc));
    // play menu
    ov.querySelector('#pet-g-feed').onclick = () => { hidePlay(); window.catFeedOpen?.(); afterPlay(); };
    ov.querySelector('#pet-g-catch').onclick = () => { hidePlay(); window.catGameOpen?.(); afterPlay(); };
    ov.querySelector('#pet-g-cancel').onclick = hidePlay;
    // needs skeleton
    ov.querySelector('#pet-needs').innerHTML = NEEDS.map(n => `
      <div class="pet-need"><span class="pet-need__i">${n.icon}</span><div class="pet-need__bar"><div class="pet-need__fill" id="need-${n.k}"></div></div></div>`).join('');
  }

  function renderNeeds() {
    if (!state) return;
    NEEDS.forEach(n => {
      const el = ov.querySelector('#need-' + n.k); if (!el) return;
      const v = state[n.k] ?? 0; el.style.width = v + '%';
      el.style.background = v > 50 ? 'linear-gradient(90deg,#7ed957,#aee571)' : v > 25 ? 'linear-gradient(90deg,#ffb347,#ffd23f)' : 'linear-gradient(90deg,#ff5a5a,#ff8a8a)';
    });
    ov.querySelector('#pet-lvl').innerHTML = `Ур. ${state.level} · 🪙 ${state.coins}<br><span style="font-weight:600;opacity:.85">${state.xp}/${state.xpNext} XP</span>`;
  }

  function renderLoc() {
    ov.style.backgroundImage = `url(${A(LOC[loc].bg)})`;
    ov.querySelector('#pet-locname').textContent = LOC[loc].icon + ' ' + LOC[loc].name;
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
    raf = requestAnimationFrame(loop);
  }

  // ── Открытие/закрытие ───────────────────────────────────────────────────────
  async function open() {
    if (!ov) build();
    ov.classList.add('on'); window.scrollLock?.();
    // префетч кадров ходьбы
    walkImgs = WALK.map(w => { const i = new Image(); i.src = A(w); return i; });
    try { await loadState(); } catch (_) { state = localGet(); }
    renderNeeds(); renderLoc();
    ov.querySelector('#pet-cat').src = A('idle.png');
    cat = { x: 0.5, dir: 1, vx: 0.04, mode: 'walk', frame: 0, t: 0, busy: false };
    lastTs = 0; cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
  }
  function close() { cancelAnimationFrame(raf); if (ov) ov.classList.remove('on'); window.scrollUnlock?.(); }
  window.catPetOpen = open;
  window.catPetClose = close;
})();

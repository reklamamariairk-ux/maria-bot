/* ── «Котик Комбат» — кликер (в духе Hamster Kombat) ──────────────────────────
 * Тапаешь кота → монеты (+N вылетает), кот подпрыгивает. Энергия тратится и
 * восстанавливается. Уровни по накоплению — на каждом кот меняет костюм (шапку).
 * Состояние на сервере (/api/clicker) для авторизованных, localStorage у гостей.
 * ───────────────────────────────────────────────────────────────────────────── */
(function () {
  const A = (s) => `/assets/images/cat/${s}`;
  const LS = 'maria_click_v1';
  const REGEN = 3, TAP_COST = 1;
  // Уровни (зеркало бэка) + костюм (шапка) на уровень. Позже cat можно заменить на полноценный костюм-арт.
  const LEVELS = [
    { level: 1, name: 'Уличный котик',   need: 0,     perTap: 1, energyMax: 1000, cat: 'idle.png', hat: null,               hp: null },
    { level: 2, name: 'Котик-сыщик',     need: 1500,  perTap: 2, energyMax: 1200, cat: 'idle.png', hat: 'hat-detective.png', hp: { w: 0.66, dy: -0.02 } },
    { level: 3, name: 'Котик-пират',     need: 7000,  perTap: 3, energyMax: 1500, cat: 'idle.png', hat: 'hat-pirate.png',    hp: { w: 0.78, dy: 0.00 } },
    { level: 4, name: 'Котик-волшебник', need: 25000, perTap: 5, energyMax: 2000, cat: 'idle.png', hat: 'hat-wizard.png',    hp: { w: 0.60, dy: -0.16 } },
    { level: 5, name: 'Котик-король',    need: 80000, perTap: 8, energyMax: 2500, cat: 'idle.png', hat: 'hat-crown.png',     hp: { w: 0.52, dy: 0.06 } },
  ];
  const levelFor = (t) => { let l = LEVELS[0]; for (const x of LEVELS) if (t >= x.need) l = x; return l; };
  const nextNeed = (t) => { const n = LEVELS.find(x => x.need > t); return n ? n.need : null; };

  let ov, audio, raf, lastTs = 0;
  let st = { balance: 0, totalEarned: 0, energy: 1000 };
  let pending = 0, syncT = 0, curLevel = 1;

  function authed() { return !!(window.App && App.isAuthed && App.isAuthed()); }
  function ac() { if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {} } return audio; }
  function coinSfx() { const a = ac(); if (!a) return; const o = a.createOscillator(), g = a.createGain(); o.type = 'square'; o.frequency.value = 880; o.frequency.exponentialRampToValueAtTime(1400, a.currentTime + 0.06); g.gain.value = 0.06; g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.09); o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + 0.1); }
  function levelSfx() { [660, 880, 1175].forEach((f, i) => setTimeout(() => { const a = ac(); if (!a) return; const o = a.createOscillator(), g = a.createGain(); o.type = 'triangle'; o.frequency.value = f; g.gain.value = 0.16; g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.3); o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + 0.32); }, i * 90)); }

  // ── состояние ──────────────────────────────────────────────────────────────
  function localGet() {
    let s; try { s = JSON.parse(localStorage.getItem(LS)); } catch (_) {}
    if (!s) s = { balance: 0, totalEarned: 0, energy: 1000, _ts: Date.now() };
    const lv = levelFor(s.totalEarned);
    const secs = Math.max(0, (Date.now() - (s._ts || Date.now())) / 1000);
    s.energy = Math.min(lv.energyMax, Math.round(s.energy + secs * REGEN));
    s._ts = Date.now(); localStorage.setItem(LS, JSON.stringify(s));
    return s;
  }
  function localSave() { const s = { balance: st.balance, totalEarned: st.totalEarned, energy: st.energy, _ts: Date.now() }; localStorage.setItem(LS, JSON.stringify(s)); }
  async function api(path, opts) { const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(App.authHeader ? App.authHeader() : {}) } }); return r.json(); }

  async function load() {
    if (authed()) { try { const d = await api('/api/clicker'); st = { balance: d.balance, totalEarned: d.totalEarned, energy: d.energy }; } catch (_) { st = localGet(); } }
    else { const s = localGet(); st = { balance: s.balance, totalEarned: s.totalEarned, energy: s.energy }; }
  }
  async function flush() {
    if (pending <= 0) return;
    const n = pending; pending = 0;
    if (authed()) { try { const d = await api('/api/clicker/tap', { method: 'POST', body: JSON.stringify({ taps: n }) }); st = { balance: d.balance, totalEarned: d.totalEarned, energy: d.energy }; renderAll(); } catch (_) { pending += n; } }
    else { localSave(); }
  }

  // ── UI ──────────────────────────────────────────────────────────────────────
  function styles() {
    if (document.getElementById('catclick-css')) return;
    const s = document.createElement('style'); s.id = 'catclick-css';
    s.textContent = `
      .ck-ov{position:fixed;inset:0;z-index:9999;display:none;flex-direction:column;align-items:center;
        background:radial-gradient(120% 90% at 50% 0%,#3a2150,#1a1030 70%);overflow:hidden;touch-action:manipulation;user-select:none;-webkit-user-select:none}
      .ck-ov.on{display:flex}
      .ck-x{position:absolute;top:12px;right:12px;z-index:6;width:36px;height:36px;border:none;border-radius:50%;background:rgba(255,255,255,.15);color:#fff;font-size:19px;cursor:pointer}
      .ck-lvl{margin-top:16px;color:#ffd23f;font-weight:900;font-size:15px;letter-spacing:.3px}
      .ck-bal{display:flex;align-items:center;gap:8px;margin-top:4px;color:#fff;font-weight:900;font-size:38px;text-shadow:0 2px 8px rgba(0,0,0,.4)}
      .ck-bal .c{font-size:30px}
      .ck-prog{width:78%;max-width:340px;margin-top:8px}
      .ck-prog__bar{height:8px;border-radius:6px;background:rgba(255,255,255,.18);overflow:hidden}
      .ck-prog__fill{height:100%;border-radius:6px;background:linear-gradient(90deg,#ffd23f,#ff9d33);transition:width .3s}
      .ck-prog__t{color:#cdbce8;font-size:11px;text-align:center;margin-top:3px}
      .ck-catwrap{position:relative;flex:1;width:100%;display:flex;align-items:center;justify-content:center}
      .ck-cat{width:62%;max-width:300px;cursor:pointer;transition:transform .08s;filter:drop-shadow(0 18px 26px rgba(0,0,0,.45));transform-origin:bottom center;-webkit-tap-highlight-color:transparent}
      .ck-cat.tap{transform:scale(.94)}
      .ck-hat{position:absolute;pointer-events:none;filter:drop-shadow(0 4px 6px rgba(0,0,0,.3))}
      .ck-fx{position:absolute;inset:0;pointer-events:none;z-index:5;overflow:hidden}
      .ck-energy{width:84%;max-width:360px;margin:0 0 22px;color:#fff}
      .ck-energy__row{display:flex;align-items:center;gap:8px;font-weight:800;font-size:14px;margin-bottom:5px}
      .ck-energy__bar{height:12px;border-radius:8px;background:rgba(255,255,255,.18);overflow:hidden}
      .ck-energy__fill{height:100%;border-radius:8px;background:linear-gradient(90deg,#4fd1ff,#7ed957);transition:width .25s}
      .ck-up{position:absolute;color:#ffd23f;font-weight:900;font-size:26px;pointer-events:none;text-shadow:0 2px 5px rgba(0,0,0,.5);z-index:6}
      .ck-tag{position:absolute;top:14px;left:12px;z-index:6;color:#9b86c4;font-size:11px;font-weight:700}
      .ck-levelup{position:absolute;inset:0;z-index:7;display:flex;align-items:center;justify-content:center;pointer-events:none}
      .ck-levelup span{color:#fff;font-weight:900;font-size:30px;background:rgba(0,0,0,.4);padding:14px 22px;border-radius:18px;opacity:0}
      .ck-levelup span.show{animation:ckLU 1.6s ease-out}
      @keyframes ckLU{0%{opacity:0;transform:scale(.6)}20%{opacity:1;transform:scale(1.1)}80%{opacity:1}100%{opacity:0;transform:scale(1)}}
    `;
    document.head.appendChild(s);
  }

  function build() {
    styles();
    ov = document.createElement('div'); ov.className = 'ck-ov';
    ov.innerHTML = `
      <button class="ck-x" id="ck-x">×</button>
      <div class="ck-tag">тап-кликер</div>
      <div class="ck-lvl" id="ck-lvl">Уровень 1 · Уличный котик</div>
      <div class="ck-bal"><span class="c">🪙</span><span id="ck-bal">0</span></div>
      <div class="ck-prog"><div class="ck-prog__bar"><div class="ck-prog__fill" id="ck-prog"></div></div><div class="ck-prog__t" id="ck-progt"></div></div>
      <div class="ck-catwrap" id="ck-catwrap">
        <img class="ck-cat" id="ck-cat" draggable="false"/>
        <img class="ck-hat" id="ck-hat" draggable="false" style="display:none"/>
      </div>
      <div class="ck-fx" id="ck-fx"></div>
      <div class="ck-levelup" id="ck-levelup"><span id="ck-levelup-t"></span></div>
      <div class="ck-energy">
        <div class="ck-energy__row">⚡ <span id="ck-en">0</span> / <span id="ck-enmax">1000</span></div>
        <div class="ck-energy__bar"><div class="ck-energy__fill" id="ck-enfill"></div></div>
      </div>
    `;
    document.body.appendChild(ov);
    ov.querySelector('#ck-x').onclick = close;
    const cat = ov.querySelector('#ck-cat');
    cat.addEventListener('pointerdown', onTap);
  }

  function onTap(e) {
    e.preventDefault(); ac();
    const lv = levelFor(st.totalEarned);
    if (st.energy < TAP_COST) { flash('нет энергии ⚡'); return; }
    st.energy -= TAP_COST; st.balance += lv.perTap; st.totalEarned += lv.perTap; pending++;
    const cat = ov.querySelector('#ck-cat');
    cat.classList.remove('tap'); void cat.offsetWidth; cat.classList.add('tap');
    setTimeout(() => cat.classList.remove('tap'), 90);
    coinSfx(); window.haptic && window.haptic('light');
    flyUp(e.clientX, e.clientY, '+' + lv.perTap);
    renderAll();
    if (!authed()) localSave();
  }

  function flyUp(x, y, txt) {
    const fx = ov.querySelector('#ck-fx'); if (!fx) return;
    const r = fx.getBoundingClientRect();
    const el = document.createElement('div'); el.className = 'ck-up'; el.textContent = txt;
    el.style.left = ((x || r.width / 2) - r.left - 10) + 'px'; el.style.top = ((y || r.height / 2) - r.top - 10) + 'px';
    el.style.transition = 'transform .8s ease-out, opacity .8s'; fx.appendChild(el);
    requestAnimationFrame(() => { el.style.transform = `translate(${(Math.random() - .5) * 40}px,-70px)`; el.style.opacity = '0'; });
    setTimeout(() => el.remove(), 850);
  }
  function flash(text) { const fx = ov.querySelector('#ck-fx'); const el = document.createElement('div'); el.className = 'ck-up'; el.style.color = '#ff7a7a'; el.textContent = text; el.style.left = '50%'; el.style.top = '60%'; el.style.transform = 'translateX(-50%)'; el.style.transition = 'opacity .8s'; fx.appendChild(el); requestAnimationFrame(() => el.style.opacity = '0'); setTimeout(() => el.remove(), 800); }

  function renderAll() {
    if (!ov) return;
    const lv = levelFor(st.totalEarned);
    ov.querySelector('#ck-bal').textContent = Math.floor(st.balance).toLocaleString('ru-RU');
    ov.querySelector('#ck-lvl').textContent = `Уровень ${lv.level} · ${lv.name}`;
    ov.querySelector('#ck-en').textContent = Math.floor(st.energy);
    ov.querySelector('#ck-enmax').textContent = lv.energyMax;
    ov.querySelector('#ck-enfill').style.width = Math.min(100, st.energy / lv.energyMax * 100) + '%';
    // прогресс до след. уровня
    const nn = nextNeed(st.totalEarned);
    const prog = ov.querySelector('#ck-prog'), progt = ov.querySelector('#ck-progt');
    if (nn) { const base = lv.need; const pct = Math.min(100, (st.totalEarned - base) / (nn - base) * 100); prog.style.width = pct + '%'; progt.textContent = `${Math.floor(st.totalEarned).toLocaleString('ru-RU')} / ${nn.toLocaleString('ru-RU')} 🪙 до уровня ${lv.level + 1}`; }
    else { prog.style.width = '100%'; progt.textContent = 'Максимальный уровень! 👑'; }
    // костюм по уровню
    if (lv.level !== curLevel) { if (lv.level > curLevel && curLevel > 0) levelUp(lv); curLevel = lv.level; }
    applyCostume(lv);
  }
  function applyCostume(lv) {
    const cat = ov.querySelector('#ck-cat'), hat = ov.querySelector('#ck-hat');
    if (cat.getAttribute('src') !== A(lv.cat)) cat.src = A(lv.cat);
    if (lv.hat) { hat.src = A(lv.hat); hat.style.display = ''; positionHat(lv); }
    else hat.style.display = 'none';
  }
  function positionHat(lv) {
    const cat = ov.querySelector('#ck-cat'), hat = ov.querySelector('#ck-hat'), wrap = ov.querySelector('#ck-catwrap');
    if (!lv.hp || !cat.complete) { setTimeout(() => positionHat(lv), 120); return; }
    const cr = cat.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    const hw = cr.width * lv.hp.w; hat.style.width = hw + 'px';
    hat.style.left = ((cr.left - wr.left) + cr.width * 0.5 - hw / 2) + 'px';
    hat.style.top = ((cr.top - wr.top) + cr.height * lv.hp.dy) + 'px';
  }
  function levelUp(lv) {
    levelSfx(); window.haptic && window.haptic('success');
    const t = ov.querySelector('#ck-levelup-t'); t.textContent = '🎉 ' + lv.name + '!';
    t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
  }

  // ── цикл: регенерация энергии + периодический sync ───────────────────────────
  function loop(ts) {
    if (!ov || !ov.classList.contains('on')) return;
    const dt = lastTs ? (ts - lastTs) / 1000 : 0; lastTs = ts;
    const lv = levelFor(st.totalEarned);
    if (st.energy < lv.energyMax) st.energy = Math.min(lv.energyMax, st.energy + REGEN * dt);
    syncT += dt;
    if (syncT > 1.6) { syncT = 0; flush(); }
    renderAll();
    raf = requestAnimationFrame(loop);
  }

  async function open() {
    if (!ov) build();
    ov.classList.add('on'); window.scrollLock && window.scrollLock(); ac();
    await load(); curLevel = levelFor(st.totalEarned).level;
    ov.querySelector('#ck-cat').src = A(levelFor(st.totalEarned).cat);
    renderAll();
    lastTs = 0; syncT = 0; cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
  }
  function close() { cancelAnimationFrame(raf); flush(); if (ov) ov.classList.remove('on'); window.scrollUnlock && window.scrollUnlock(); }
  window.catClickOpen = open;
  window.catClickClose = close;
  window.addEventListener('resize', () => { if (ov && ov.classList.contains('on')) applyCostume(levelFor(st.totalEarned)); });
})();

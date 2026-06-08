/* ── Игра «Накорми Котика» ────────────────────────────────────────────────
 * 60-секундный фрэнзи: тащи пироги коту в рот. Кот открывает рот → жуёт →
 * радуется (смена спрайтов + squash), сердечки/крошки-частицы, WebAudio-звук,
 * комбо, золотой пирог. Очки → звёзды (cat_feed). Анимированный фон пекарни.
 * Ассеты: /assets/images/cat/{idle,open,chew,happy,hungry,full}.png + bakery-bg.jpg
 * ───────────────────────────────────────────────────────────────────────── */
(function () {
  const GAME_KEY = 'cat_feed';
  const DUR = 60;                 // секунд
  const CAT = (s) => `/assets/images/cat/${s}.png`;
  const STATES = ['idle', 'open', 'chew', 'happy', 'hungry', 'full'];

  let ov, pcanvas, pctx, raf, audio;
  const cat = {};                 // preloaded Image per state
  let pies = [];                  // {img, name, id} caталожные фото
  const S = {
    running: false, score: 0, combo: 0, lastFeed: 0, timeLeft: DUR, best: 0,
    fed: 0, busy: false, parts: [], tEnd: 0, hungerT: 0,
  };

  // ── Звук (синтез, без файлов) ──────────────────────────────────────────────
  function ac() { if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {} } return audio; }
  function tone(freq, dur, type, gain, slideTo) {
    const a = ac(); if (!a) return;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, a.currentTime + dur);
    g.gain.value = gain || 0.18; g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + dur);
  }
  function sfxChomp() {
    const a = ac(); if (!a) return;
    // короткий шумовой «чавк»
    const buf = a.createBuffer(1, a.sampleRate * 0.12, a.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 2);
    const src = a.createBufferSource(); src.buffer = buf;
    const g = a.createGain(); g.gain.value = 0.25; g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.12);
    const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    src.connect(f); f.connect(g); g.connect(a.destination); src.start();
    tone(180, 0.1, 'sine', 0.12, 90);
  }
  function sfxHappy() { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'triangle', 0.16), i * 70)); }
  function sfxGold() { [659, 880, 1047, 1319].forEach((f, i) => setTimeout(() => tone(f, 0.2, 'triangle', 0.18), i * 60)); }
  function sfxPop() { tone(420, 0.08, 'square', 0.1, 700); }

  // ── Ассеты ──────────────────────────────────────────────────────────────────
  function preload(src) { return new Promise(r => { const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = src; }); }
  async function loadAll() {
    if (!cat.idle) { for (const s of STATES) cat[s] = await preload(CAT(s)); }
    if (!pies.length) {
      try {
        const r = await fetch('/api/catalog/products?limit=24');
        const d = await r.json();
        const picks = (d.products || []).filter(p => p.image).slice(0, 8);
        const ims = await Promise.all(picks.map(p => preload('/img?u=' + encodeURIComponent(p.image))));
        pies = ims.map((im, i) => im && { im, name: picks[i].name, id: picks[i].id }).filter(Boolean);
      } catch (_) {}
    }
  }

  // ── UI ──────────────────────────────────────────────────────────────────────
  function styles() {
    if (document.getElementById('catfeed-css')) return;
    const s = document.createElement('style'); s.id = 'catfeed-css';
    s.textContent = `
      .cf-ov{position:fixed;inset:0;z-index:9999;display:none;flex-direction:column;overflow:hidden;
        background:#f3e2cf center/cover no-repeat;touch-action:none;user-select:none;-webkit-user-select:none}
      .cf-ov.on{display:flex}
      .cf-ov::before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(255,250,240,.15),rgba(120,70,30,.18))}
      .cf-top{position:relative;display:flex;align-items:center;gap:10px;padding:12px 14px;z-index:3}
      .cf-meter{flex:1;height:14px;border-radius:10px;background:rgba(255,255,255,.5);overflow:hidden;box-shadow:inset 0 1px 3px rgba(0,0,0,.15)}
      .cf-meter__fill{height:100%;width:100%;border-radius:10px;background:linear-gradient(90deg,#ff8a3d,#ffd23f);transition:width .25s}
      .cf-time{font-weight:900;color:#fff;font-size:20px;text-shadow:0 2px 4px rgba(0,0,0,.35);min-width:54px;text-align:center}
      .cf-score{position:absolute;top:52px;left:0;right:0;text-align:center;z-index:3;color:#fff;font-weight:900;font-size:34px;text-shadow:0 3px 8px rgba(0,0,0,.4)}
      .cf-x{width:36px;height:36px;border:none;border-radius:50%;background:rgba(0,0,0,.25);color:#fff;font-size:20px;cursor:pointer}
      .cf-stage{position:relative;flex:1;z-index:2}
      .cf-cat{position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);width:46%;max-width:230px;
        filter:drop-shadow(0 14px 18px rgba(0,0,0,.28));transition:transform .12s;will-change:transform}
      .cf-cat.cf-breathe{animation:cfBreathe 3.2s ease-in-out infinite}
      @keyframes cfBreathe{0%,100%{transform:translate(-50%,-50%) scale(1,1)}50%{transform:translate(-50%,-50%) scale(1.025,.975)}}
      .cf-cat.cf-chomp{animation:cfChomp .26s ease-out}
      @keyframes cfChomp{0%{transform:translate(-50%,-50%) scale(1,1)}35%{transform:translate(-50%,-48%) scale(1.12,.9)}100%{transform:translate(-50%,-50%) scale(1,1)}}
      .cf-cat.cf-happy{animation:cfHappy .5s ease-out}
      @keyframes cfHappy{0%{transform:translate(-50%,-50%) scale(1)}30%{transform:translate(-50%,-56%) scale(1.06)}60%{transform:translate(-50%,-50%) scale(.98)}100%{transform:translate(-50%,-50%) scale(1)}}
      .cf-pcanvas{position:absolute;inset:0;pointer-events:none;z-index:4}
      .cf-plate{position:relative;z-index:3;display:flex;justify-content:center;gap:10px;padding:10px 12px 18px;flex-wrap:wrap;min-height:96px}
      .cf-pie{width:66px;height:66px;border-radius:50%;background:#fff center/cover;box-shadow:0 6px 14px rgba(0,0,0,.22);
        border:3px solid #fff;cursor:grab;touch-action:none;transition:transform .12s}
      .cf-pie.gold{border-color:#ffc233;box-shadow:0 0 0 3px #ffe08a,0 6px 16px rgba(255,170,0,.5)}
      .cf-pie:active{cursor:grabbing;transform:scale(1.12)}
      .cf-hint{position:absolute;left:0;right:0;bottom:108px;text-align:center;color:#fff;font-weight:700;font-size:14px;text-shadow:0 2px 5px rgba(0,0,0,.4);z-index:3;pointer-events:none}
      .cf-combo{position:absolute;left:50%;top:38%;transform:translateX(-50%);z-index:5;color:#ffd23f;font-weight:900;font-size:30px;
        text-shadow:0 3px 8px rgba(0,0,0,.45);opacity:0;pointer-events:none}
      .cf-combo.show{animation:cfCombo .7s ease-out}
      @keyframes cfCombo{0%{opacity:0;transform:translateX(-50%) scale(.6)}30%{opacity:1;transform:translateX(-50%) scale(1.15)}100%{opacity:0;transform:translateX(-50%) translateY(-30px) scale(1)}}
      .cf-panel{position:absolute;inset:0;z-index:10;display:none;flex-direction:column;align-items:center;justify-content:center;gap:14px;
        padding:26px;text-align:center;background:rgba(40,20,8,.55);backdrop-filter:blur(3px)}
      .cf-panel.on{display:flex}
      .cf-panel h2{margin:0;color:#fff;font-size:28px;font-weight:900;text-shadow:0 3px 8px rgba(0,0,0,.4)}
      .cf-panel p{margin:0;color:#ffe9d2;font-size:16px}
      .cf-panel .cf-big{font-size:60px}
      .cf-btn{border:none;border-radius:16px;padding:14px 28px;font-size:17px;font-weight:800;cursor:pointer;background:#ff7a2d;color:#fff;box-shadow:0 6px 18px rgba(255,122,45,.45)}
      .cf-btn--ghost{background:rgba(255,255,255,.92);color:#7a3b12}
      .cf-row{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
      .cf-countin{position:absolute;inset:0;z-index:11;display:flex;align-items:center;justify-content:center;color:#fff;font-size:120px;font-weight:900;text-shadow:0 4px 16px rgba(0,0,0,.5);pointer-events:none}
    `;
    document.head.appendChild(s);
  }

  function build() {
    styles();
    ov = document.createElement('div'); ov.className = 'cf-ov';
    ov.innerHTML = `
      <div class="cf-top">
        <div class="cf-meter"><div class="cf-meter__fill" id="cf-fill"></div></div>
        <div class="cf-time" id="cf-time">0:60</div>
        <button class="cf-x" id="cf-x">×</button>
      </div>
      <div class="cf-score" id="cf-score">0</div>
      <div class="cf-stage" id="cf-stage">
        <img class="cf-cat cf-breathe" id="cf-cat" src="${CAT('idle')}" alt="Котик" draggable="false"/>
        <div class="cf-combo" id="cf-combo"></div>
        <div class="cf-hint" id="cf-hint">Тащи пироги Котику в рот! 🐱</div>
      </div>
      <canvas class="cf-pcanvas" id="cf-pcanvas"></canvas>
      <div class="cf-plate" id="cf-plate"></div>
      <div class="cf-panel" id="cf-panel"></div>
      <div class="cf-countin" id="cf-countin" style="display:none"></div>
    `;
    document.body.appendChild(ov);
    ov.style.backgroundImage = `url(/assets/images/cat/bakery-bg.jpg)`;
    pcanvas = ov.querySelector('#cf-pcanvas'); pctx = pcanvas.getContext('2d');
    ov.querySelector('#cf-x').onclick = close;
    initDrag();
  }

  function setCat(state) { const c = document.getElementById('cf-cat'); if (c && cat[state]) c.src = CAT(state); }

  // ── Тарелка с пирогами ───────────────────────────────────────────────────────
  function fillPlate() {
    const plate = document.getElementById('cf-plate');
    if (!plate) return;
    while (plate.children.length < 4) addPie(plate);
  }
  function addPie(plate) {
    const gold = Math.random() < 0.12;
    const el = document.createElement('div');
    el.className = 'cf-pie' + (gold ? ' gold' : '');
    el.dataset.gold = gold ? '1' : '';
    if (pies.length) { const pp = pies[(Math.random() * pies.length) | 0]; el.style.backgroundImage = `url(${pp.im.src})`; }
    else { el.textContent = '🥧'; el.style.fontSize = '38px'; el.style.display = 'flex'; el.style.alignItems = 'center'; el.style.justifyContent = 'center'; }
    plate.appendChild(el);
  }

  let drag = null;
  function initDrag() {
    ov.addEventListener('pointerdown', (e) => {
      if (!S.running) return;
      const pie = e.target.closest('.cf-pie');
      if (!pie) return;
      e.preventDefault();
      const r = pie.getBoundingClientRect();
      const ghost = pie.cloneNode(true);
      ghost.style.position = 'fixed'; ghost.style.zIndex = 20; ghost.style.left = r.left + 'px'; ghost.style.top = r.top + 'px';
      ghost.style.margin = 0; ghost.style.pointerEvents = 'none'; ghost.style.transform = 'scale(1.15)';
      document.body.appendChild(ghost);
      drag = { ghost, src: pie, dx: e.clientX - r.left, dy: e.clientY - r.top, gold: pie.dataset.gold === '1' };
      ov.setPointerCapture?.(e.pointerId);
    });
    ov.addEventListener('pointermove', (e) => {
      if (!drag) return;
      drag.ghost.style.left = (e.clientX - drag.dx) + 'px';
      drag.ghost.style.top = (e.clientY - drag.dy) + 'px';
    });
    const drop = (e) => {
      if (!drag) return;
      const catEl = document.getElementById('cf-cat');
      const cr = catEl.getBoundingClientRect();
      const x = e.clientX, y = e.clientY;
      const hit = x > cr.left && x < cr.right && y > cr.top && y < cr.bottom * 1 && y < cr.top + cr.height * 0.75;
      drag.ghost.remove();
      if (hit) { feed(drag.gold, cr); drag.src.remove(); fillPlate(); }
      drag = null;
    };
    ov.addEventListener('pointerup', drop);
    ov.addEventListener('pointercancel', drop);
  }

  // ── Кормление ────────────────────────────────────────────────────────────────
  function feed(gold, cr) {
    if (!S.running) return;
    const now = performance.now();
    if (now - S.lastFeed < 1500) S.combo++; else S.combo = 1;
    S.lastFeed = now; S.fed++;
    const base = gold ? 50 : 10;
    const gain = base * S.combo;
    S.score += gain;
    document.getElementById('cf-score').textContent = S.score;

    const catEl = document.getElementById('cf-cat');
    catEl.classList.remove('cf-breathe');
    setCat('open');
    gold ? sfxGold() : sfxChomp();
    window.haptic?.('light');
    burst(cr.left + cr.width / 2, cr.top + cr.height * 0.4, gold);
    catEl.classList.remove('cf-chomp'); void catEl.offsetWidth; catEl.classList.add('cf-chomp');

    if (S.combo >= 2) showCombo(S.combo);

    clearTimeout(S._t1); clearTimeout(S._t2);
    S._t1 = setTimeout(() => { setCat('chew'); }, 160);
    S._t2 = setTimeout(() => {
      setCat('happy'); catEl.classList.remove('cf-chomp'); void catEl.offsetWidth; catEl.classList.add('cf-happy');
      if (S.combo >= 3 || gold) sfxHappy();
      setTimeout(() => { catEl.classList.remove('cf-happy'); catEl.classList.add('cf-breathe'); if (S.running) setCat('idle'); }, 480);
    }, 420);
  }
  function showCombo(n) {
    const el = document.getElementById('cf-combo'); if (!el) return;
    el.textContent = 'x' + n + ' комбо!';
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    sfxPop();
  }

  // ── Частицы ───────────────────────────────────────────────────────────────────
  function resizeP() { const r = pcanvas.getBoundingClientRect(); const dpr = Math.min(devicePixelRatio || 1, 2); pcanvas.width = r.width * dpr; pcanvas.height = r.height * dpr; pctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
  function burst(x, y, gold) {
    const rect = pcanvas.getBoundingClientRect(); x -= rect.left; y -= rect.top;
    const n = gold ? 18 : 10;
    for (let i = 0; i < n; i++) {
      const heart = gold || Math.random() < 0.5;
      S.parts.push({
        x, y, vx: (Math.random() - .5) * 4, vy: -2 - Math.random() * 3,
        g: heart ? -0.02 : 0.18, life: 1, heart, gold,
        size: heart ? 16 + Math.random() * 10 : 4 + Math.random() * 4,
        rot: Math.random() * 6,
      });
    }
  }
  function drawParts(dt) {
    pctx.clearRect(0, 0, pcanvas.width, pcanvas.height);
    for (let i = S.parts.length - 1; i >= 0; i--) {
      const p = S.parts[i];
      p.vy += p.g; p.x += p.vx; p.y += p.vy; p.life -= dt / 900;
      if (p.life <= 0) { S.parts.splice(i, 1); continue; }
      pctx.globalAlpha = Math.max(0, p.life);
      if (p.heart) { pctx.font = `${p.size}px serif`; pctx.fillText(p.gold ? '⭐' : '❤️', p.x, p.y); }
      else { pctx.fillStyle = '#c98a4a'; pctx.beginPath(); pctx.arc(p.x, p.y, p.size, 0, 7); pctx.fill(); }
    }
    pctx.globalAlpha = 1;
  }

  // ── Луп / таймер ───────────────────────────────────────────────────────────────
  let lastTs = 0;
  function loop(ts) {
    if (!S.running) return;
    const dt = lastTs ? ts - lastTs : 16; lastTs = ts;
    drawParts(dt);
    // таймер
    S.timeLeft = Math.max(0, (S.tEnd - performance.now()) / 1000);
    const el = document.getElementById('cf-time'); if (el) el.textContent = '0:' + String(Math.ceil(S.timeLeft)).padStart(2, '0');
    const fill = document.getElementById('cf-fill'); if (fill) fill.style.width = (S.timeLeft / DUR * 100) + '%';
    // «голод» если давно не кормили → грустный спрайт
    if (!S.busy && performance.now() - S.lastFeed > 2200) {
      const c = document.getElementById('cf-cat'); if (c && !/hungry|happy|chew|open/.test(c.src)) { /* keep idle */ }
    }
    if (S.timeLeft <= 0) { end(); return; }
    raf = requestAnimationFrame(loop);
  }

  function countdownStart() {
    const ci = document.getElementById('cf-countin'); ci.style.display = 'flex';
    let n = 3;
    const tick = () => {
      if (n > 0) { ci.textContent = n; sfxPop(); n--; setTimeout(tick, 700); }
      else { ci.textContent = 'НЯМ!'; sfxHappy(); setTimeout(() => { ci.style.display = 'none'; begin(); }, 500); }
    };
    tick();
  }
  function begin() {
    S.running = true; S.score = 0; S.combo = 0; S.fed = 0; S.lastFeed = 0; S.parts = [];
    S.tEnd = performance.now() + DUR * 1000; lastTs = 0;
    document.getElementById('cf-score').textContent = '0';
    document.getElementById('cf-panel').classList.remove('on');
    setCat('idle');
    fillPlate();
    raf = requestAnimationFrame(loop);
  }

  async function end() {
    S.running = false; cancelAnimationFrame(raf);
    setCat('full'); window.haptic?.('success'); sfxHappy();
    const isRec = S.score > S.best; if (isRec) S.best = S.score;
    let reward = '';
    if (window.App?.isAuthed?.()) {
      try {
        const r = await fetch('/api/game-result', { method: 'POST', headers: { 'Content-Type': 'application/json', ...App.authHeader() }, body: JSON.stringify({ game: GAME_KEY, score: S.score }) });
        const d = await r.json();
        if (d.gated) reward = '🔓 Подтверди номер в Профиле — и за игру будут звёзды.';
        else if (d.starsAwarded > 0) reward = `⭐ +${d.starsAwarded}${d.capped ? ' (дневной лимит)' : ''}`;
        else if (d.capped) reward = '⭐ Дневной лимит звёзд достигнут — рекорд засчитан!';
        if (typeof d.balance?.stars === 'number') reward += (reward ? ' · ' : '') + `всего ⭐ ${d.balance.stars}`;
      } catch (_) {}
    } else reward = 'Открой через приложение «Марии» — и получай звёзды за рекорды.';

    const panel = document.getElementById('cf-panel');
    panel.innerHTML = `
      <div class="cf-big">${isRec ? '🏆' : '😻'}</div>
      <h2>${isRec ? 'Новый рекорд!' : 'Вкусно!'}</h2>
      <p>Котик объелся на <b>${S.score}</b> очков (${S.fed} пирогов)${S.best ? ` · рекорд ${S.best}` : ''}.</p>
      ${reward ? `<p style="color:#ffd23f;font-weight:800">${reward}</p>` : ''}
      <div class="cf-row"><button class="cf-btn" id="cf-again">Ещё раз 🍰</button><button class="cf-btn cf-btn--ghost" id="cf-share">Похвастаться</button></div>
      <div class="cf-row"><button class="cf-btn cf-btn--ghost" id="cf-close2">В меню</button></div>`;
    panel.classList.add('on');
    panel.querySelector('#cf-again').onclick = () => { document.getElementById('cf-plate').innerHTML = ''; countdownStart(); };
    panel.querySelector('#cf-close2').onclick = close;
    panel.querySelector('#cf-share').onclick = () => {
      const link = window.App?.appLink?.() || 'https://t.me/mariatortik_bot';
      const txt = `Я накормил Котика на ${S.score} очков в игре кондитерской «Мария» 🐱🍰 Побей мой рекорд! ${link}`;
      if (window.App?.share) App.share(txt); else if (navigator.share) navigator.share({ text: txt }).catch(() => {});
    };
  }

  // ── Открытие/закрытие ──────────────────────────────────────────────────────────
  async function open() {
    if (!ov) build();
    ov.classList.add('on'); window.scrollLock?.();
    ac(); // активируем звук на жесте
    await loadAll();
    requestAnimationFrame(() => { resizeP(); document.getElementById('cf-plate').innerHTML = ''; countdownStart(); });
  }
  function close() { S.running = false; cancelAnimationFrame(raf); if (ov) ov.classList.remove('on'); window.scrollUnlock?.(); }
  window.catFeedOpen = open;
  window.catFeedClose = close;
  window.addEventListener('resize', () => { if (ov && ov.classList.contains('on')) resizeP(); });
})();

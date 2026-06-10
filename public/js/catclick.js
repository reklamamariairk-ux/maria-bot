/* ── «Котик Комбат» — кликер в духе Hamster Kombat (полная версия) ─────────────
 * Тап → монеты. Энергия (регенит). Апгрейды: мультитап (+за тап), лимит энергии.
 * Карточки-бизнесы → пассивный доход (монеты/час, капают офлайн с потолком).
 * Лиги по накоплению → костюм кота. Сервер /api/clicker для авторизованных,
 * localStorage у гостей (та же экономика). Костюм пока = шапка hat-*.png.
 * ───────────────────────────────────────────────────────────────────────────── */
(function () {
  const A = (s) => `/assets/images/cat/${s}`;
  const LS = 'maria_click_v2';
  const REGEN = 3, PASSIVE_CAP_H = 3;

  // ── Каталоги (зеркало бэка) ──────────────────────────────────────────────────
  const CARDS = [
    { id: 'bakery', name: 'Пекарня', icon: '🍞', basePrice: 300, baseProfit: 30 },
    { id: 'coffee', name: 'Кофемашина', icon: '☕', basePrice: 900, baseProfit: 85 },
    { id: 'delivery', name: 'Доставка', icon: '🛵', basePrice: 2500, baseProfit: 200 },
    { id: 'cakefactory', name: 'Фабрика тортов', icon: '🎂', basePrice: 7000, baseProfit: 520 },
    { id: 'franchise', name: 'Франшиза «Мария»', icon: '🏪', basePrice: 20000, baseProfit: 1500 },
  ];
  const LEAGUES = [
    { level: 1, name: 'Уличный котик', need: 0, hat: null, hp: null },
    { level: 2, name: 'Котик-сыщик', need: 300, hat: 'hat-detective.png', hp: { w: 0.66, dy: -0.02 } },
    { level: 3, name: 'Котик-пират', need: 1500, hat: 'hat-pirate.png', hp: { w: 0.78, dy: 0.00 } },
    { level: 4, name: 'Котик-волшебник', need: 6000, hat: 'hat-wizard.png', hp: { w: 0.60, dy: -0.16 } },
    { level: 5, name: 'Котик-король', need: 20000, hat: 'hat-crown.png', hp: { w: 0.52, dy: 0.06 } },
  ];
  const leagueFor = (t) => { let l = LEAGUES[0]; for (const x of LEAGUES) if (t >= x.need) l = x; return l; };
  const nextNeed = (t) => { const n = LEAGUES.find(x => x.need > t); return n ? n.need : null; };
  const fmt = (n) => Math.floor(n).toLocaleString('ru-RU');
  const priceMultitap = (l) => Math.round(200 * Math.pow(2, l));
  const priceEnergy = (l) => Math.round(300 * Math.pow(2, l));
  const energyMaxFor = (l) => 1000 + 500 * l;
  const perTapFor = (l) => 1 + l;
  const cardPrice = (c, l) => Math.round(c.basePrice * Math.pow(1.6, l));
  const cardProfit = (c, l) => c.baseProfit * l;

  let ov, audio, raf, lastTs = 0, pending = 0, syncT = 0, curLevel = 1, tab = 'cat';
  let st = null; // server-shape state

  function authed() { return !!(window.App && App.isAuthed && App.isAuthed()); }
  function ac() { if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {} } return audio; }
  function coinSfx() { const a = ac(); if (!a) return; const o = a.createOscillator(), g = a.createGain(); o.type = 'square'; o.frequency.value = 880; o.frequency.exponentialRampToValueAtTime(1400, a.currentTime + 0.06); g.gain.value = 0.05; g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.09); o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + 0.1); }
  function buySfx() { [700, 1050].forEach((f, i) => setTimeout(() => { const a = ac(); if (!a) return; const o = a.createOscillator(), g = a.createGain(); o.type = 'triangle'; o.frequency.value = f; g.gain.value = 0.14; g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.25); o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + 0.27); }, i * 90)); }
  function levelSfx() { [660, 880, 1175].forEach((f, i) => setTimeout(() => { const a = ac(); if (!a) return; const o = a.createOscillator(), g = a.createGain(); o.type = 'triangle'; o.frequency.value = f; g.gain.value = 0.16; g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.3); o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + 0.32); }, i * 90)); }

  // ── Гостевое состояние (localStorage, та же экономика) ───────────────────────
  function rawDefault() { return { balance: 0, totalEarned: 0, energy: 1000, multitapLevel: 0, energyLevel: 0, cards: {}, _ts: Date.now() }; }
  function rawGet() { let s; try { s = JSON.parse(localStorage.getItem(LS)); } catch (_) {} if (!s) s = rawDefault(); if (!s.cards) s.cards = {}; return s; }
  function profitOf(cards) { let p = 0; for (const c of CARDS) p += cardProfit(c, cards[c.id] || 0); return p; }
  function guestDerive() {
    const s = rawGet();
    const secs = Math.max(0, (Date.now() - (s._ts || Date.now())) / 1000);
    s.energy = Math.min(energyMaxFor(s.energyLevel), Math.round(s.energy + secs * REGEN));
    const pph = profitOf(s.cards);
    const passive = Math.floor(pph * Math.min(secs / 3600, PASSIVE_CAP_H));
    if (passive > 0) { s.balance += passive; s.totalEarned += passive; }
    s._ts = Date.now(); localStorage.setItem(LS, JSON.stringify(s));
    return guestState(s, passive);
  }
  function guestState(s, passive) {
    return {
      balance: s.balance, totalEarned: s.totalEarned, energy: s.energy, energyMax: energyMaxFor(s.energyLevel),
      perTap: perTapFor(s.multitapLevel), profitPerHour: profitOf(s.cards), passiveEarned: passive || 0,
      level: leagueFor(s.totalEarned).level, levelName: leagueFor(s.totalEarned).name, nextNeed: nextNeed(s.totalEarned),
      multitapLevel: s.multitapLevel, multitapPrice: priceMultitap(s.multitapLevel),
      energyLevel: s.energyLevel, energyPrice: priceEnergy(s.energyLevel),
      cards: CARDS.map(c => ({ id: c.id, name: c.name, icon: c.icon, level: s.cards[c.id] || 0, profit: cardProfit(c, (s.cards[c.id] || 0) + 1), price: cardPrice(c, s.cards[c.id] || 0) })),
    };
  }
  function guestSaveTap(perTap) { const s = rawGet(); s.energy -= 1; s.balance += perTap; s.totalEarned += perTap; s._ts = Date.now(); localStorage.setItem(LS, JSON.stringify(s)); }
  function guestBuy(type, id) {
    const s = rawGet(); // применим decay/passive сперва
    guestDerive(); const s2 = rawGet();
    let cost = 0;
    if (type === 'multitap') cost = priceMultitap(s2.multitapLevel);
    else if (type === 'energy') cost = priceEnergy(s2.energyLevel);
    else { const c = CARDS.find(x => x.id === id); cost = cardPrice(c, s2.cards[id] || 0); }
    if (s2.balance < cost) return false;
    s2.balance -= cost;
    if (type === 'multitap') s2.multitapLevel++;
    else if (type === 'energy') s2.energyLevel++;
    else s2.cards[id] = (s2.cards[id] || 0) + 1;
    s2._ts = Date.now(); localStorage.setItem(LS, JSON.stringify(s2)); return true;
  }

  async function api(path, opts) { const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(App.authHeader ? App.authHeader() : {}) } }); return r.json(); }
  async function load() { st = authed() ? await api('/api/clicker').catch(() => guestDerive()) : guestDerive(); }
  async function flush() {
    if (pending <= 0 || !authed()) return;
    const n = pending; pending = 0;
    try { const d = await api('/api/clicker/tap', { method: 'POST', body: JSON.stringify({ taps: n }) }); st = d; } catch (_) { pending += n; }
  }
  async function buy(type, id) {
    let ok = false;
    if (authed()) { try { const d = await api('/api/clicker/buy', { method: 'POST', body: JSON.stringify({ type, id }) }); if (!d.error) { st = d; ok = true; } } catch (_) {} }
    else { ok = guestBuy(type, id); if (ok) st = guestDerive(); }
    if (ok) { buySfx(); window.haptic && window.haptic('medium'); renderAll(); renderUpgrades(); }
    else flashMsg('Не хватает монет');
  }

  // ── UI ────────────────────────────────────────────────────────────────────────
  function styles() {
    if (document.getElementById('catclick-css')) return;
    const s = document.createElement('style'); s.id = 'catclick-css';
    s.textContent = `
      .ck-ov{position:fixed;inset:0;z-index:9999;display:none;flex-direction:column;background:radial-gradient(120% 90% at 50% 0%,#3a2150,#160c28 72%);overflow:hidden;touch-action:manipulation;user-select:none;-webkit-user-select:none;color:#fff}
      .ck-ov.on{display:flex}
      .ck-x{position:absolute;top:10px;right:10px;z-index:8;width:34px;height:34px;border:none;border-radius:50%;background:rgba(255,255,255,.15);color:#fff;font-size:18px;cursor:pointer}
      .ck-screen{flex:1;display:none;flex-direction:column;align-items:center;overflow:hidden}
      .ck-screen.on{display:flex}
      .ck-lvl{margin-top:14px;color:#ffd23f;font-weight:900;font-size:14px}
      .ck-bal{display:flex;align-items:center;gap:8px;margin-top:2px;font-weight:900;font-size:36px;text-shadow:0 2px 8px rgba(0,0,0,.4)}
      .ck-prof{margin-top:4px;background:rgba(255,255,255,.1);padding:5px 12px;border-radius:20px;font-weight:800;font-size:13px;color:#7ed957}
      .ck-prog{width:78%;max-width:340px;margin-top:8px}
      .ck-prog__bar{height:7px;border-radius:6px;background:rgba(255,255,255,.16);overflow:hidden}
      .ck-prog__fill{height:100%;border-radius:6px;background:linear-gradient(90deg,#ffd23f,#ff9d33);transition:width .3s}
      .ck-prog__t{color:#cdbce8;font-size:10px;text-align:center;margin-top:3px}
      .ck-catwrap{position:relative;flex:1;width:100%;display:flex;align-items:center;justify-content:center}
      .ck-cat{width:60%;max-width:290px;cursor:pointer;transition:transform .08s;filter:drop-shadow(0 18px 26px rgba(0,0,0,.5));transform-origin:bottom center;-webkit-tap-highlight-color:transparent}
      .ck-cat.tap{transform:scale(.93)}
      .ck-hat{position:absolute;pointer-events:none;filter:drop-shadow(0 4px 6px rgba(0,0,0,.3))}
      .ck-fx{position:absolute;inset:0;pointer-events:none;z-index:6;overflow:hidden}
      .ck-energy{width:84%;max-width:360px;margin:0 0 16px}
      .ck-energy__row{display:flex;align-items:center;gap:8px;font-weight:800;font-size:13px;margin-bottom:5px}
      .ck-energy__bar{height:11px;border-radius:8px;background:rgba(255,255,255,.16);overflow:hidden}
      .ck-energy__fill{height:100%;border-radius:8px;background:linear-gradient(90deg,#4fd1ff,#7ed957);transition:width .25s}
      .ck-up{position:absolute;color:#ffd23f;font-weight:900;font-size:24px;pointer-events:none;text-shadow:0 2px 5px rgba(0,0,0,.5);z-index:7}
      /* upgrades */
      .ck-uphd{padding:14px 16px 6px;text-align:center}
      .ck-uphd .b{font-weight:900;font-size:26px}
      .ck-uphd .p{color:#7ed957;font-weight:800;font-size:13px;margin-top:2px}
      .ck-uplist{flex:1;overflow:auto;padding:6px 12px 14px;width:100%;box-sizing:border-box}
      .ck-sect{color:#b9a7dd;font-weight:800;font-size:12px;margin:10px 4px 6px;text-transform:uppercase;letter-spacing:.4px}
      .ck-card{display:flex;align-items:center;gap:12px;background:rgba(255,255,255,.07);border-radius:16px;padding:12px;margin-bottom:9px}
      .ck-card__ic{font-size:30px;width:42px;text-align:center}
      .ck-card__b{flex:1;min-width:0}
      .ck-card__n{font-weight:800;font-size:15px}
      .ck-card__s{color:#b9a7dd;font-size:12px;margin-top:2px}
      .ck-card__buy{border:none;border-radius:12px;padding:10px 14px;font-weight:800;font-size:13px;background:#ffcf3f;color:#3a2150;cursor:pointer;white-space:nowrap}
      .ck-card__buy:disabled{background:rgba(255,255,255,.12);color:#8d7fae;cursor:default}
      /* nav */
      .ck-nav{display:flex;border-top:1px solid rgba(255,255,255,.1)}
      .ck-nav__b{flex:1;border:none;background:transparent;color:#b9a7dd;padding:11px 0 14px;font-weight:800;font-size:13px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px}
      .ck-nav__b .i{font-size:20px}
      .ck-nav__b.on{color:#ffd23f}
      .ck-levelup{position:absolute;inset:0;z-index:8;display:flex;align-items:center;justify-content:center;pointer-events:none}
      .ck-levelup span{color:#fff;font-weight:900;font-size:28px;background:rgba(0,0,0,.45);padding:14px 22px;border-radius:18px;opacity:0}
      .ck-levelup span.show{animation:ckLU 1.6s ease-out}
      @keyframes ckLU{0%{opacity:0;transform:scale(.6)}20%{opacity:1;transform:scale(1.1)}80%{opacity:1}100%{opacity:0}}
      .ck-pop{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9;background:#2a1a44;border-radius:20px;padding:22px 24px;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.5);display:none}
      .ck-pop.on{display:block}
      .ck-pop h3{margin:0 0 6px;font-size:20px}.ck-pop .v{font-size:30px;font-weight:900;color:#ffd23f;margin:8px 0}
      .ck-pop button{margin-top:8px;border:none;border-radius:14px;padding:12px 28px;font-weight:800;background:#ffcf3f;color:#3a2150;cursor:pointer}
    `;
    document.head.appendChild(s);
  }

  function build() {
    styles();
    ov = document.createElement('div'); ov.className = 'ck-ov';
    ov.innerHTML = `
      <button class="ck-x" id="ck-x">×</button>
      <!-- экран КОТИК -->
      <div class="ck-screen on" id="ck-scr-cat">
        <div class="ck-lvl" id="ck-lvl"></div>
        <div class="ck-bal">🪙 <span id="ck-bal">0</span></div>
        <div class="ck-prof" id="ck-prof">🏭 +0 / час</div>
        <div class="ck-prog"><div class="ck-prog__bar"><div class="ck-prog__fill" id="ck-prog"></div></div><div class="ck-prog__t" id="ck-progt"></div></div>
        <div class="ck-catwrap" id="ck-catwrap"><img class="ck-cat" id="ck-cat" draggable="false"/><img class="ck-hat" id="ck-hat" draggable="false" style="display:none"/></div>
        <div class="ck-energy"><div class="ck-energy__row">⚡ <span id="ck-en">0</span> / <span id="ck-enmax">1000</span></div><div class="ck-energy__bar"><div class="ck-energy__fill" id="ck-enfill"></div></div></div>
      </div>
      <!-- экран ПРОКАЧКА -->
      <div class="ck-screen" id="ck-scr-up">
        <div class="ck-uphd"><div class="ck-bal" style="justify-content:center;font-size:28px">🪙 <span id="ck-bal2">0</span></div><div class="p" id="ck-prof2">🏭 +0 / час</div></div>
        <div class="ck-uplist" id="ck-uplist"></div>
      </div>
      <div class="ck-fx" id="ck-fx"></div>
      <div class="ck-levelup" id="ck-levelup"><span id="ck-levelup-t"></span></div>
      <div class="ck-pop" id="ck-pop"></div>
      <div class="ck-nav">
        <button class="ck-nav__b on" data-tab="cat"><span class="i">🐱</span>Котик</button>
        <button class="ck-nav__b" data-tab="up"><span class="i">⚡</span>Прокачка</button>
      </div>
    `;
    document.body.appendChild(ov);
    ov.querySelector('#ck-x').onclick = close;
    ov.querySelector('#ck-cat').addEventListener('pointerdown', onTap);
    ov.querySelectorAll('.ck-nav__b').forEach(b => b.onclick = () => setTab(b.dataset.tab));
  }

  function setTab(t) {
    tab = t;
    ov.querySelector('#ck-scr-cat').classList.toggle('on', t === 'cat');
    ov.querySelector('#ck-scr-up').classList.toggle('on', t === 'up');
    ov.querySelectorAll('.ck-nav__b').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    if (t === 'up') renderUpgrades();
  }

  function onTap(e) {
    e.preventDefault(); ac();
    if (st.energy < 1) { flashMsg('нет энергии ⚡'); return; }
    st.energy -= 1; st.balance += st.perTap; st.totalEarned += st.perTap; pending++;
    if (!authed()) guestSaveTap(st.perTap);
    const cat = ov.querySelector('#ck-cat');
    cat.classList.remove('tap'); void cat.offsetWidth; cat.classList.add('tap'); setTimeout(() => cat.classList.remove('tap'), 90);
    coinSfx(); window.haptic && window.haptic('light');
    flyUp(e.clientX, e.clientY, '+' + st.perTap);
    renderAll();
  }
  function flyUp(x, y, txt) {
    const fx = ov.querySelector('#ck-fx'); const r = fx.getBoundingClientRect();
    const el = document.createElement('div'); el.className = 'ck-up'; el.textContent = txt;
    el.style.left = ((x || r.width / 2) - r.left - 10) + 'px'; el.style.top = ((y || r.height / 2) - r.top - 10) + 'px';
    el.style.transition = 'transform .8s ease-out, opacity .8s'; fx.appendChild(el);
    requestAnimationFrame(() => { el.style.transform = `translate(${(Math.random() - .5) * 40}px,-70px)`; el.style.opacity = '0'; });
    setTimeout(() => el.remove(), 850);
  }
  function flashMsg(text) { const fx = ov.querySelector('#ck-fx'); const el = document.createElement('div'); el.className = 'ck-up'; el.style.color = '#ff8a8a'; el.textContent = text; el.style.left = '50%'; el.style.top = '58%'; el.style.transform = 'translateX(-50%)'; el.style.transition = 'opacity .9s'; fx.appendChild(el); requestAnimationFrame(() => el.style.opacity = '0'); setTimeout(() => el.remove(), 900); }

  function renderAll() {
    if (!ov || !st) return;
    const lg = leagueFor(st.totalEarned);
    ov.querySelector('#ck-bal').textContent = fmt(st.balance);
    ov.querySelector('#ck-bal2').textContent = fmt(st.balance);
    ov.querySelector('#ck-lvl').textContent = `Уровень ${lg.level} · ${lg.name}`;
    const prof = `🏭 +${fmt(st.profitPerHour)} / час`;
    ov.querySelector('#ck-prof').textContent = prof; ov.querySelector('#ck-prof2').textContent = prof;
    ov.querySelector('#ck-en').textContent = Math.floor(st.energy);
    ov.querySelector('#ck-enmax').textContent = st.energyMax;
    ov.querySelector('#ck-enfill').style.width = Math.min(100, st.energy / st.energyMax * 100) + '%';
    const nn = nextNeed(st.totalEarned), prog = ov.querySelector('#ck-prog'), progt = ov.querySelector('#ck-progt');
    if (nn) { const pct = Math.min(100, (st.totalEarned - lg.need) / (nn - lg.need) * 100); prog.style.width = pct + '%'; progt.textContent = `${fmt(st.totalEarned)} / ${fmt(nn)} 🪙 до ур. ${lg.level + 1}`; }
    else { prog.style.width = '100%'; progt.textContent = 'Максимальный уровень! 👑'; }
    if (lg.level !== curLevel) { if (lg.level > curLevel) levelUp(lg); curLevel = lg.level; }
    applyCostume(lg);
  }
  function applyCostume(lg) {
    const cat = ov.querySelector('#ck-cat'), hat = ov.querySelector('#ck-hat');
    if (cat.getAttribute('src') !== A('idle.png')) cat.src = A('idle.png');
    if (lg.hat) { if (hat.getAttribute('src') !== A(lg.hat)) hat.src = A(lg.hat); hat.style.display = ''; positionHat(lg); }
    else hat.style.display = 'none';
  }
  function positionHat(lg) {
    const cat = ov.querySelector('#ck-cat'), hat = ov.querySelector('#ck-hat'), wrap = ov.querySelector('#ck-catwrap');
    if (!lg.hp || !cat.complete || !cat.width) { setTimeout(() => positionHat(lg), 120); return; }
    const cr = cat.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    const hw = cr.width * lg.hp.w; hat.style.width = hw + 'px';
    hat.style.left = ((cr.left - wr.left) + cr.width * 0.5 - hw / 2) + 'px';
    hat.style.top = ((cr.top - wr.top) + cr.height * lg.hp.dy) + 'px';
  }
  function levelUp(lg) { levelSfx(); window.haptic && window.haptic('success'); const t = ov.querySelector('#ck-levelup-t'); t.textContent = '🎉 ' + lg.name + '!'; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show'); }

  function renderUpgrades() {
    if (!ov || !st) return;
    const list = ov.querySelector('#ck-uplist');
    const row = (icon, name, sub, price, dis, onclick, id) => `
      <div class="ck-card"><div class="ck-card__ic">${icon}</div><div class="ck-card__b"><div class="ck-card__n">${name}</div><div class="ck-card__s">${sub}</div></div>
      <button class="ck-card__buy" data-act="${onclick}" data-id="${id || ''}" ${dis ? 'disabled' : ''}>🪙 ${fmt(price)}</button></div>`;
    let html = '<div class="ck-sect">Бусты</div>';
    html += row('👆', 'Мультитап', `+1 монета за тап · сейчас +${st.perTap}`, st.multitapPrice, st.balance < st.multitapPrice, 'multitap');
    html += row('🔋', 'Запас энергии', `+500 к максимуму · сейчас ${st.energyMax}`, st.energyPrice, st.balance < st.energyPrice, 'energy');
    html += '<div class="ck-sect">Бизнесы — пассивный доход</div>';
    for (const c of st.cards) html += row(c.icon, c.name, `Ур. ${c.level} · +${fmt(c.profit)}/час`, c.price, st.balance < c.price, 'card', c.id);
    list.innerHTML = html;
    list.querySelectorAll('.ck-card__buy').forEach(b => b.onclick = () => { const act = b.dataset.act; buy(act, b.dataset.id || undefined); });
  }

  function passivePopup(amount) {
    if (!amount || amount <= 0) return;
    const pop = ov.querySelector('#ck-pop');
    pop.innerHTML = `<h3>Пока тебя не было 😺</h3><div class="v">+${fmt(amount)} 🪙</div><div style="color:#b9a7dd;font-size:13px">Котик работал за тебя!</div><button id="ck-pop-ok">Забрать</button>`;
    pop.classList.add('on'); pop.querySelector('#ck-pop-ok').onclick = () => pop.classList.remove('on');
  }

  function loop(ts) {
    if (!ov || !ov.classList.contains('on')) return;
    const dt = lastTs ? (ts - lastTs) / 1000 : 0; lastTs = ts;
    if (st) {
      if (st.energy < st.energyMax) st.energy = Math.min(st.energyMax, st.energy + REGEN * dt);
      // живой пассив на главном балансе (визуально)
      if (st.profitPerHour > 0) { const inc = st.profitPerHour / 3600 * dt; st.balance += inc; st.totalEarned += inc; }
      syncT += dt; if (syncT > 1.6) { syncT = 0; flush(); }
      if (tab === 'cat') renderAll();
    }
    raf = requestAnimationFrame(loop);
  }

  async function open() {
    if (!ov) build();
    ov.classList.add('on'); window.scrollLock && window.scrollLock(); ac();
    await load();
    curLevel = leagueFor(st.totalEarned).level;
    ov.querySelector('#ck-cat').src = A('idle.png');
    setTab('cat'); renderAll();
    if (st.passiveEarned > 0) passivePopup(st.passiveEarned);
    lastTs = 0; syncT = 0; cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
  }
  function close() { cancelAnimationFrame(raf); flush(); if (ov) ov.classList.remove('on'); window.scrollUnlock && window.scrollUnlock(); }
  window.catClickOpen = open;
  window.catClickClose = close;
  window.addEventListener('resize', () => { if (ov && ov.classList.contains('on') && st) applyCostume(leagueFor(st.totalEarned)); });
})();

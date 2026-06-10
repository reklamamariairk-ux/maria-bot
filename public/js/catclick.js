/* ── «Котик Комбат» — кликер (Hamster Kombat-стиль), усиленная версия ──────────
 * Тап (комбо+монетопад, турбо ×5), энергия, апгрейды, бизнесы (пассив+офлайн),
 * бусты (🚀 турбо / ⚡ полная энергия, 6/день), ежедневная награда (стрик),
 * лидерборд. Сервер /api/clicker* для авторизованных, localStorage у гостей.
 * ───────────────────────────────────────────────────────────────────────────── */
(function () {
  const A = (s) => `/assets/images/cat/${s}`;
  const LS = 'maria_click_v2';
  const REGEN = 3, PASSIVE_CAP_H = 3, TURBO_MULT = 5, TURBO_SEC = 20, DAILY_BOOSTS = 6;
  const CARDS = [
    { id: 'bakery', name: 'Пекарня', icon: '🍞', basePrice: 300, baseProfit: 30 },
    { id: 'coffee', name: 'Кофемашина', icon: '☕', basePrice: 900, baseProfit: 85 },
    { id: 'delivery', name: 'Доставка', icon: '🛵', basePrice: 2500, baseProfit: 200 },
    { id: 'cakefactory', name: 'Фабрика тортов', icon: '🎂', basePrice: 7000, baseProfit: 520 },
    { id: 'franchise', name: 'Франшиза «Мария»', icon: '🏪', basePrice: 20000, baseProfit: 1500 },
  ];
  const LEAGUES = [
    // cat = картинка кота-в-костюме на уровне
    { level: 1, name: 'Уличный котик', need: 0, cat: 'idle.png' },
    { level: 2, name: 'Котик-поварёнок', need: 300, cat: 'cat-cook.png' },
    { level: 3, name: 'Шеф-кондитер', need: 1500, cat: 'cat-chef.png' },
    { level: 4, name: 'Бизнес-кот', need: 6000, cat: 'cat-business.png' },
    { level: 5, name: 'Супер-кот', need: 20000, cat: 'cat-super.png' },
    { level: 6, name: 'Котик-король', need: 60000, cat: 'cat-king.png' },
  ];
  const REF_REFERRER = 5000, REF_INVITEE = 2500, BOT = 'mariatortik_bot';
  const TASKS = [
    { id: 'site', name: 'Заглянуть на сайт «Мария»', icon: '🌐', reward: 1500, type: 'link', link: 'https://www.maria-irk.ru/' },
    { id: 'invite1', name: 'Пригласить друга', icon: '👥', reward: 10000, type: 'ref', target: 1 },
    { id: 'level3', name: 'Стать шеф-кондитером (ур.3)', icon: '👨‍🍳', reward: 3000, type: 'level', target: 3 },
    { id: 'balance10', name: 'Накопить 10 000 монет', icon: '💰', reward: 2500, type: 'balance', target: 10000 },
    { id: 'streak3', name: 'Заходить 3 дня подряд', icon: '🔥', reward: 4000, type: 'streak', target: 3 },
  ];
  const leagueFor = (t) => { let l = LEAGUES[0]; for (const x of LEAGUES) if (t >= x.need) l = x; return l; };
  const nextNeed = (t) => { const n = LEAGUES.find(x => x.need > t); return n ? n.need : null; };
  const fmt = (n) => Math.floor(n).toLocaleString('ru-RU');
  const irkToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const priceMultitap = (l) => Math.round(200 * Math.pow(2, l));
  const priceEnergy = (l) => Math.round(300 * Math.pow(2, l));
  const energyMaxFor = (l) => 1000 + 500 * l;
  const perTapFor = (l) => 1 + l;
  const cardPrice = (c, l) => Math.round(c.basePrice * Math.pow(1.6, l));
  const cardProfit = (c, l) => c.baseProfit * l;
  const dailyReward = (streak) => 500 * Math.min(Math.max(1, streak), 10);

  let ov, audio, raf, lastTs = 0, pending = 0, syncT = 0, curLevel = 1, tab = 'cat';
  let st = null, turboUntil = 0, combo = 0, comboT = 0;

  function authed() { return !!(window.App && App.isAuthed && App.isAuthed()); }
  function ac() { if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {} } return audio; }
  function beep(f, t, g, slide) { const a = ac(); if (!a) return; const o = a.createOscillator(), gn = a.createGain(); o.type = t || 'square'; o.frequency.value = f; if (slide) o.frequency.exponentialRampToValueAtTime(slide, a.currentTime + 0.07); gn.gain.value = g || 0.05; gn.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.09); o.connect(gn); gn.connect(a.destination); o.start(); o.stop(a.currentTime + 0.1); }
  function coinSfx() { beep(880, 'square', 0.05, 1400); }
  function chord(arr, g) { arr.forEach((f, i) => setTimeout(() => beep(f, 'triangle', g || 0.14), i * 80)); }

  // ── Гость (localStorage) ─────────────────────────────────────────────────────
  function rawDefault() { return { balance: 0, totalEarned: 0, energy: 1000, multitapLevel: 0, energyLevel: 0, cards: {}, dailyStreak: 0, dailyDate: null, bE: 0, bT: 0, bDate: null, turboUntil: 0, tasksDone: {}, _ts: Date.now() }; }
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
      cards: CARDS.map(c => ({ id: c.id, name: c.name, icon: c.icon, level: s.cards[c.id] || 0, profit: cardProfit(c, (s.cards[c.id] || 0) + 1), price: cardPrice(c, s.cards[c.id] || 0) })),
      dailyAvailable: s.dailyDate !== today, dailyStreak: s.dailyStreak, dailyNext: dailyReward(s.dailyDate === today ? s.dailyStreak : s.dailyStreak + 1),
      boostEnergyLeft: DAILY_BOOSTS - s.bE, boostTurboLeft: DAILY_BOOSTS - s.bT, turboMsLeft: Math.max(0, (s.turboUntil || 0) - Date.now()),
    };
  }

  async function api(path, opts) { const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(App.authHeader ? App.authHeader() : {}) } }); return r.json(); }
  async function load() { st = authed() ? await api('/api/clicker').catch(() => guestDerive()) : guestDerive(); turboUntil = Date.now() + (st.turboMsLeft || 0); }
  async function flush() { if (pending <= 0 || !authed()) return; const n = pending; pending = 0; try { const d = await api('/api/clicker/tap', { method: 'POST', body: JSON.stringify({ taps: n }) }); st = d; } catch (_) { pending += n; } }

  async function buy(type, id) {
    let ok = false;
    if (authed()) { try { const d = await api('/api/clicker/buy', { method: 'POST', body: JSON.stringify({ type, id }) }); if (!d.error) { st = d; ok = true; } } catch (_) {} }
    else { const s = guestBuyRaw(type, id); if (s) { st = guestDerive(); ok = true; } }
    if (ok) { chord([700, 1050]); window.haptic && window.haptic('medium'); renderAll(); renderUpgrades(); } else flashMsg('Не хватает монет');
  }
  function guestBuyRaw(type, id) {
    guestDerive(); const s = rawGet(); let cost = 0;
    if (type === 'multitap') cost = priceMultitap(s.multitapLevel); else if (type === 'energy') cost = priceEnergy(s.energyLevel);
    else { const c = CARDS.find(x => x.id === id); cost = cardPrice(c, s.cards[id] || 0); }
    if (s.balance < cost) return null; s.balance -= cost;
    if (type === 'multitap') s.multitapLevel++; else if (type === 'energy') s.energyLevel++; else s.cards[id] = (s.cards[id] || 0) + 1;
    rawSave(s); return s;
  }
  async function claimDaily() {
    let r;
    if (authed()) { r = await api('/api/clicker/daily', { method: 'POST', body: '{}' }).catch(() => null); if (r && !r.error) st = r; }
    else { const g = guestClaimDaily(); if (g) { r = { reward: g }; st = guestDerive(); } }
    if (r && r.reward) { chord([660, 880, 1320], 0.16); window.haptic && window.haptic('success'); dailyPopup(r.reward, st.dailyStreak); renderAll(); }
  }
  function guestClaimDaily() {
    guestDerive(); const s = rawGet(); const today = irkToday(); if (s.dailyDate === today) return 0;
    const yest = new Date(Date.now() + 8 * 3600 * 1000 - 86400000).toISOString().slice(0, 10);
    s.dailyStreak = s.dailyDate === yest ? s.dailyStreak + 1 : 1; const rew = dailyReward(s.dailyStreak);
    s.balance += rew; s.totalEarned += rew; s.dailyDate = today; rawSave(s); return rew;
  }
  async function boost(type) {
    let ok = false;
    if (authed()) { try { const d = await api('/api/clicker/boost', { method: 'POST', body: JSON.stringify({ type }) }); if (!d.error) { st = d; ok = true; } } catch (_) {} }
    else { ok = guestBoost(type); if (ok) st = guestDerive(); }
    if (!ok) { flashMsg('Бусты на сегодня кончились'); return; }
    if (type === 'turbo') { turboUntil = Date.now() + TURBO_SEC * 1000; chord([880, 1320, 1760], 0.16); }
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
      .ck-ov{position:fixed;inset:0;z-index:9999;display:none;flex-direction:column;background:radial-gradient(120% 90% at 50% 0%,#3a2150,#160c28 72%);overflow:hidden;touch-action:manipulation;user-select:none;-webkit-user-select:none;color:#fff}
      .ck-ov.on{display:flex}.ck-ov.turbo{background:radial-gradient(120% 90% at 50% 0%,#5a2a2a,#2a0c1a 72%)}
      .ck-x{position:absolute;top:10px;right:10px;z-index:9;width:34px;height:34px;border:none;border-radius:50%;background:rgba(255,255,255,.15);color:#fff;font-size:18px;cursor:pointer}
      .ck-screen{flex:1;display:none;flex-direction:column;align-items:center;overflow:hidden}.ck-screen.on{display:flex}
      .ck-daily{margin-top:10px;background:linear-gradient(90deg,#ff8a3d,#ffd23f);color:#3a2150;font-weight:900;border:none;border-radius:16px;padding:9px 18px;font-size:13px;cursor:pointer;box-shadow:0 6px 16px rgba(255,160,40,.4)}
      .ck-lvl{margin-top:10px;color:#ffd23f;font-weight:900;font-size:14px}
      .ck-bal{display:flex;align-items:center;gap:8px;margin-top:2px;font-weight:900;font-size:34px;text-shadow:0 2px 8px rgba(0,0,0,.4)}
      .ck-prof{margin-top:3px;background:rgba(255,255,255,.1);padding:4px 12px;border-radius:20px;font-weight:800;font-size:12px;color:#7ed957}
      .ck-prog{width:78%;max-width:340px;margin-top:7px}.ck-prog__bar{height:7px;border-radius:6px;background:rgba(255,255,255,.16);overflow:hidden}.ck-prog__fill{height:100%;border-radius:6px;background:linear-gradient(90deg,#ffd23f,#ff9d33);transition:width .3s}.ck-prog__t{color:#cdbce8;font-size:10px;text-align:center;margin-top:3px}
      .ck-catwrap{position:relative;flex:1;width:100%;display:flex;align-items:center;justify-content:center}
      .ck-cat{width:58%;max-width:280px;cursor:pointer;transition:transform .07s;filter:drop-shadow(0 18px 26px rgba(0,0,0,.5));transform-origin:bottom center;-webkit-tap-highlight-color:transparent}
      .ck-cat.tap{transform:scale(.92)}.ck-cat.turbo{filter:drop-shadow(0 0 30px #ffb13d) drop-shadow(0 18px 26px rgba(0,0,0,.5))}
      .ck-hat{position:absolute;pointer-events:none;filter:drop-shadow(0 4px 6px rgba(0,0,0,.3))}
      .ck-combo{position:absolute;top:18%;left:50%;transform:translateX(-50%);font-weight:900;color:#ff7a3d;text-shadow:0 2px 8px rgba(0,0,0,.5);pointer-events:none;opacity:0;font-size:22px}
      .ck-combo.show{opacity:1}
      .ck-fx{position:absolute;inset:0;pointer-events:none;z-index:6;overflow:hidden}
      .ck-boosts{display:flex;gap:10px;margin:2px 0 8px}
      .ck-boost{display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.1);border:none;border-radius:14px;padding:8px 14px;color:#fff;font-weight:800;font-size:13px;cursor:pointer}
      .ck-boost:disabled{opacity:.4;cursor:default}
      .ck-energy{width:84%;max-width:360px;margin:0 0 14px}.ck-energy__row{display:flex;align-items:center;gap:8px;font-weight:800;font-size:13px;margin-bottom:5px}.ck-energy__bar{height:11px;border-radius:8px;background:rgba(255,255,255,.16);overflow:hidden}.ck-energy__fill{height:100%;border-radius:8px;background:linear-gradient(90deg,#4fd1ff,#7ed957);transition:width .25s}
      .ck-up{position:absolute;color:#ffd23f;font-weight:900;pointer-events:none;text-shadow:0 2px 5px rgba(0,0,0,.5);z-index:7}
      .ck-coin{position:absolute;z-index:7;pointer-events:none;font-size:22px}
      .ck-uphd{padding:14px 16px 6px;text-align:center;width:100%;box-sizing:border-box}.ck-uphd .b{font-weight:900;font-size:26px}.ck-uphd .p{color:#7ed957;font-weight:800;font-size:13px;margin-top:2px}
      .ck-uplist{flex:1;overflow:auto;padding:6px 12px 14px;width:100%;box-sizing:border-box}
      .ck-sect{color:#b9a7dd;font-weight:800;font-size:12px;margin:10px 4px 6px;text-transform:uppercase;letter-spacing:.4px}
      .ck-card{display:flex;align-items:center;gap:12px;background:rgba(255,255,255,.07);border-radius:16px;padding:12px;margin-bottom:9px}
      .ck-card__ic{font-size:28px;width:40px;text-align:center}.ck-card__b{flex:1;min-width:0}.ck-card__n{font-weight:800;font-size:15px}.ck-card__s{color:#b9a7dd;font-size:12px;margin-top:2px}
      .ck-card__buy{border:none;border-radius:12px;padding:10px 14px;font-weight:800;font-size:13px;background:#ffcf3f;color:#3a2150;cursor:pointer;white-space:nowrap}.ck-card__buy:disabled{background:rgba(255,255,255,.12);color:#8d7fae;cursor:default}
      .ck-row{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.06);border-radius:14px;padding:10px 12px;margin-bottom:7px}
      .ck-row .r{width:30px;font-weight:900;color:#ffd23f;text-align:center}.ck-row .n{flex:1;font-weight:700}.ck-row .v{font-weight:800;color:#7ed957;font-size:13px}.ck-row.me{background:rgba(255,210,63,.18)}
      .ck-nav{display:flex;border-top:1px solid rgba(255,255,255,.1)}
      .ck-nav__b{flex:1;border:none;background:transparent;color:#b9a7dd;padding:10px 0 13px;font-weight:800;font-size:12px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px}.ck-nav__b .i{font-size:19px}.ck-nav__b.on{color:#ffd23f}
      .ck-levelup{position:absolute;inset:0;z-index:8;display:flex;align-items:center;justify-content:center;pointer-events:none}.ck-levelup span{color:#fff;font-weight:900;font-size:28px;background:rgba(0,0,0,.45);padding:14px 22px;border-radius:18px;opacity:0}.ck-levelup span.show{animation:ckLU 1.6s ease-out}@keyframes ckLU{0%{opacity:0;transform:scale(.6)}20%{opacity:1;transform:scale(1.1)}80%{opacity:1}100%{opacity:0}}
      .ck-pop{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9;background:#2a1a44;border-radius:20px;padding:22px 24px;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.5);display:none;max-width:80%}.ck-pop.on{display:block}.ck-pop h3{margin:0 0 6px;font-size:20px}.ck-pop .v{font-size:30px;font-weight:900;color:#ffd23f;margin:8px 0}.ck-pop button{margin-top:8px;border:none;border-radius:14px;padding:12px 28px;font-weight:800;background:#ffcf3f;color:#3a2150;cursor:pointer}
    `;
    document.head.appendChild(s);
  }

  function build() {
    styles();
    ov = document.createElement('div'); ov.className = 'ck-ov';
    ov.innerHTML = `
      <button class="ck-x" id="ck-x">×</button>
      <div class="ck-screen on" id="ck-scr-cat">
        <button class="ck-daily" id="ck-daily" style="display:none"></button>
        <div class="ck-lvl" id="ck-lvl"></div>
        <div class="ck-bal">🪙 <span id="ck-bal">0</span></div>
        <div class="ck-prof" id="ck-prof">🏭 +0 / час</div>
        <div class="ck-prog"><div class="ck-prog__bar"><div class="ck-prog__fill" id="ck-prog"></div></div><div class="ck-prog__t" id="ck-progt"></div></div>
        <div class="ck-catwrap" id="ck-catwrap"><img class="ck-cat" id="ck-cat" draggable="false"/><img class="ck-hat" id="ck-hat" draggable="false" style="display:none"/><div class="ck-combo" id="ck-combo"></div></div>
        <div class="ck-boosts">
          <button class="ck-boost" id="ck-bt-turbo">🚀 Турбо <span id="ck-bt-turbo-n"></span></button>
          <button class="ck-boost" id="ck-bt-energy">⚡ Энергия <span id="ck-bt-energy-n"></span></button>
        </div>
        <div class="ck-energy"><div class="ck-energy__row" id="ck-enrow">⚡ <span id="ck-en">0</span> / <span id="ck-enmax">1000</span></div><div class="ck-energy__bar"><div class="ck-energy__fill" id="ck-enfill"></div></div></div>
      </div>
      <div class="ck-screen" id="ck-scr-up"><div class="ck-uphd"><div class="ck-bal" style="justify-content:center;font-size:26px">🪙 <span id="ck-bal2">0</span></div><div class="p" id="ck-prof2">🏭 +0 / час</div></div><div class="ck-uplist" id="ck-uplist"></div></div>
      <div class="ck-screen" id="ck-scr-tasks"><div class="ck-uphd"><div class="b">📋 Задания</div></div><div class="ck-uplist" id="ck-taskslist"></div></div>
      <div class="ck-screen" id="ck-scr-top"><div class="ck-uphd"><div class="b">🏆 Рейтинг</div><div class="p" id="ck-myrank"></div></div><div class="ck-uplist" id="ck-toplist"></div></div>
      <div class="ck-fx" id="ck-fx"></div>
      <div class="ck-levelup" id="ck-levelup"><span id="ck-levelup-t"></span></div>
      <div class="ck-pop" id="ck-pop"></div>
      <div class="ck-nav">
        <button class="ck-nav__b on" data-tab="cat"><span class="i">🐱</span>Котик</button>
        <button class="ck-nav__b" data-tab="up"><span class="i">⚡</span>Прокачка</button>
        <button class="ck-nav__b" data-tab="tasks"><span class="i">📋</span>Задания</button>
        <button class="ck-nav__b" data-tab="top"><span class="i">🏆</span>Рейтинг</button>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#ck-x').onclick = close;
    ov.querySelector('#ck-cat').addEventListener('pointerdown', onTap);
    ov.querySelector('#ck-daily').onclick = claimDaily;
    ov.querySelector('#ck-bt-turbo').onclick = () => boost('turbo');
    ov.querySelector('#ck-bt-energy').onclick = () => boost('energy');
    ov.querySelectorAll('.ck-nav__b').forEach(b => b.onclick = () => setTab(b.dataset.tab));
  }

  function setTab(t) {
    tab = t;
    ov.querySelector('#ck-scr-cat').classList.toggle('on', t === 'cat');
    ov.querySelector('#ck-scr-up').classList.toggle('on', t === 'up');
    ov.querySelector('#ck-scr-tasks').classList.toggle('on', t === 'tasks');
    ov.querySelector('#ck-scr-top').classList.toggle('on', t === 'top');
    ov.querySelectorAll('.ck-nav__b').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    if (t === 'up') renderUpgrades();
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
    if (!authed()) { const s = rawGet(); s.energy -= 1; s.balance += gain; s.totalEarned += gain; rawSave(s); }
    // комбо
    const now = performance.now(); combo = (now - comboT < 450) ? combo + 1 : 1; comboT = now;
    const cat = ov.querySelector('#ck-cat'); cat.classList.remove('tap'); void cat.offsetWidth; cat.classList.add('tap'); setTimeout(() => cat.classList.remove('tap'), 80);
    coinSfx(); window.haptic && window.haptic('light');
    flyUp(e.clientX, e.clientY, '+' + gain, Math.min(40, 22 + combo));
    if (combo >= 5) showCombo();
    if (combo >= 12 && combo % 3 === 0) coinShower();
    renderTop2();
  }
  function showCombo() { const el = ov.querySelector('#ck-combo'); el.textContent = '🔥 x' + combo; el.classList.add('show'); el.style.fontSize = Math.min(40, 20 + combo) + 'px'; }
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
    for (let i = 0; i < 8; i++) { const c = document.createElement('div'); c.className = 'ck-coin'; c.textContent = '🪙'; c.style.left = (Math.random() * w) + 'px'; c.style.top = '-30px'; c.style.transition = 'transform 1s ease-in, opacity 1s'; fx.appendChild(c); requestAnimationFrame(() => { c.style.transform = `translateY(${fx.clientHeight + 40}px) rotate(${(Math.random() - .5) * 360}deg)`; c.style.opacity = '0.2'; }); setTimeout(() => c.remove(), 1000); }
  }
  function flashMsg(text) { const fx = ov.querySelector('#ck-fx'); const el = document.createElement('div'); el.className = 'ck-up'; el.style.color = '#ff8a8a'; el.style.fontSize = '20px'; el.textContent = text; el.style.left = '50%'; el.style.top = '56%'; el.style.transform = 'translateX(-50%)'; el.style.transition = 'opacity .9s'; fx.appendChild(el); requestAnimationFrame(() => el.style.opacity = '0'); setTimeout(() => el.remove(), 900); }

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
    const prof = `🏭 +${fmt(st.profitPerHour)} / час`; ov.querySelector('#ck-prof').textContent = prof; ov.querySelector('#ck-prof2').textContent = prof;
    ov.querySelector('#ck-en').textContent = Math.floor(st.energy); ov.querySelector('#ck-enmax').textContent = st.energyMax;
    ov.querySelector('#ck-enfill').style.width = Math.min(100, st.energy / st.energyMax * 100) + '%';
    const nn = nextNeed(st.totalEarned), prog = ov.querySelector('#ck-prog'), progt = ov.querySelector('#ck-progt');
    if (nn) { const pct = Math.min(100, (st.totalEarned - lg.need) / (nn - lg.need) * 100); prog.style.width = pct + '%'; progt.textContent = `${fmt(st.totalEarned)} / ${fmt(nn)} 🪙 до ур. ${lg.level + 1}`; }
    else { prog.style.width = '100%'; progt.textContent = 'Максимальный уровень! 👑'; }
    // ежедневка
    const daily = ov.querySelector('#ck-daily');
    if (st.dailyAvailable) { daily.style.display = ''; daily.textContent = `🎁 Награда дня +${fmt(st.dailyNext)}`; } else daily.style.display = 'none';
    // бусты
    ov.querySelector('#ck-bt-turbo-n').textContent = '(' + st.boostTurboLeft + ')';
    ov.querySelector('#ck-bt-energy-n').textContent = '(' + st.boostEnergyLeft + ')';
    ov.querySelector('#ck-bt-turbo').disabled = st.boostTurboLeft <= 0;
    ov.querySelector('#ck-bt-energy').disabled = st.boostEnergyLeft <= 0 || st.energy >= st.energyMax;
    // турбо-вид
    const on = turboOn(); ov.classList.toggle('turbo', on); ov.querySelector('#ck-cat').classList.toggle('turbo', on);
    if (on) ov.querySelector('#ck-enrow').firstChild.textContent = '🚀 ТУРБО ×5! · ';
    else ov.querySelector('#ck-enrow').firstChild.textContent = '⚡ ';
    if (lg.level !== curLevel) { if (lg.level > curLevel) levelUp(lg); curLevel = lg.level; }
    applyCostume(lg);
  }
  function applyCostume(lg) {
    const cat = ov.querySelector('#ck-cat'), hat = ov.querySelector('#ck-hat');
    hat.style.display = 'none'; // шапки-наклейки убраны — костюм = смена всей картинки кота
    const src = A(lg.cat || 'idle.png');
    if (cat.getAttribute('src') !== src) cat.src = src;
  }
  function levelUp(lg) { chord([660, 880, 1175], 0.16); window.haptic && window.haptic('success'); coinShower(); const t = ov.querySelector('#ck-levelup-t'); t.textContent = '🎉 ' + lg.name + '!'; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show'); }

  function renderUpgrades() {
    if (!ov || !st) return; const list = ov.querySelector('#ck-uplist');
    const row = (icon, name, sub, price, dis, act, id) => `<div class="ck-card"><div class="ck-card__ic">${icon}</div><div class="ck-card__b"><div class="ck-card__n">${name}</div><div class="ck-card__s">${sub}</div></div><button class="ck-card__buy" data-act="${act}" data-id="${id || ''}" ${dis ? 'disabled' : ''}>🪙 ${fmt(price)}</button></div>`;
    let h = '<div class="ck-sect">Бусты</div>';
    h += row('👆', 'Мультитап', `+1 за тап · сейчас +${st.perTap}`, st.multitapPrice, st.balance < st.multitapPrice, 'multitap');
    h += row('🔋', 'Запас энергии', `+500 · сейчас ${st.energyMax}`, st.energyPrice, st.balance < st.energyPrice, 'energy');
    h += '<div class="ck-sect">Бизнесы — пассивный доход</div>';
    for (const c of st.cards) h += row(c.icon, c.name, `Ур. ${c.level} · +${fmt(c.profit)}/час`, c.price, st.balance < c.price, 'card', c.id);
    list.innerHTML = h;
    list.querySelectorAll('.ck-card__buy').forEach(b => b.onclick = () => buy(b.dataset.act, b.dataset.id || undefined));
  }
  async function renderTop() {
    const list = ov.querySelector('#ck-toplist'); const rank = ov.querySelector('#ck-myrank');
    if (!authed()) { list.innerHTML = '<div style="text-align:center;color:#b9a7dd;padding:30px 10px">Рейтинг доступен при входе через приложение «Мария» 🐱</div>'; rank.textContent = ''; return; }
    list.innerHTML = '<div style="text-align:center;color:#b9a7dd;padding:20px">Загрузка…</div>';
    const d = await loadTop();
    if (!d || !d.top) { list.innerHTML = '<div style="text-align:center;color:#b9a7dd;padding:20px">Пока пусто — будь первым!</div>'; return; }
    rank.textContent = d.myRank ? `Твоё место: #${d.myRank}` : '';
    list.innerHTML = d.top.map((r, i) => `<div class="ck-row${r.me ? ' me' : ''}"><div class="r">${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</div><div class="n">${(r.name || '').replace(/</g, '&lt;')}</div><div class="v">🪙 ${fmt(r.total)}</div></div>`).join('');
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
      if (d && !d.error) { st = d; if (d.refReward) { dailyPopupRaw('🎉 Бонус за приглашение', d.refReward); } }
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
    const t = TASKS.find(x => x.id === id); if (!t) return 0;
    guestDerive(); const s = rawGet(); if (s.tasksDone && s.tasksDone[id]) return 0;
    const list = guestTaskList(); const item = list.find(x => x.id === id); if (!item || !item.claimable) return 0;
    s.balance += t.reward; s.totalEarned += t.reward; s.tasksDone = s.tasksDone || {}; s.tasksDone[id] = 1; rawSave(s); return t.reward;
  }
  async function renderTasks() {
    const list = ov.querySelector('#ck-taskslist');
    const refCount = (st && st.referrals) || 0;
    const refBlock = `<div class="ck-card" style="background:linear-gradient(90deg,rgba(255,138,61,.25),rgba(255,210,63,.15))">
      <div class="ck-card__ic">👥</div><div class="ck-card__b"><div class="ck-card__n">Пригласи друзей</div>
      <div class="ck-card__s">Друзей: ${refCount} · +${fmt(REF_REFERRER)} 🪙 тебе и +${fmt(REF_INVITEE)} другу</div></div>
      <button class="ck-card__buy" id="ck-invite">Позвать</button></div>`;
    let tasks;
    if (authed()) { const d = await api('/api/clicker/tasks').catch(() => null); tasks = d && d.tasks; }
    else tasks = guestTaskList();
    if (!tasks) tasks = [];
    const rows = tasks.map(t => {
      let btn;
      if (t.done) btn = `<button class="ck-card__buy" disabled>✓ Готово</button>`;
      else if (t.type === 'link' && !(linkOpened[t.id])) btn = `<button class="ck-card__buy" data-open="${t.id}" data-link="${t.link || ''}">Открыть</button>`;
      else if (t.claimable) btn = `<button class="ck-card__buy" data-claim="${t.id}">+${fmt(t.reward)} 🪙</button>`;
      else btn = `<button class="ck-card__buy" disabled>🔒 +${fmt(t.reward)}</button>`;
      return `<div class="ck-card"><div class="ck-card__ic">${t.icon}</div><div class="ck-card__b"><div class="ck-card__n">${t.name}</div><div class="ck-card__s">Награда +${fmt(t.reward)} 🪙</div></div>${btn}</div>`;
    }).join('');
    list.innerHTML = '<div class="ck-sect">Друзья</div>' + refBlock + '<div class="ck-sect">Задания</div>' + rows;
    ov.querySelector('#ck-invite').onclick = shareRef;
    list.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { const id = b.dataset.open, link = b.dataset.link; if (link) { if (window.App && App.openExternal) App.openExternal(link); else window.open(link, '_blank'); } linkOpened[id] = true; setTimeout(renderTasks, 400); });
    list.querySelectorAll('[data-claim]').forEach(b => b.onclick = () => claimTask(b.dataset.claim));
  }
  async function claimTask(id) {
    let reward = 0;
    if (authed()) { const d = await api('/api/clicker/task', { method: 'POST', body: JSON.stringify({ id }) }).catch(() => null); if (d && !d.error) { st = d; reward = d.reward; } }
    else { reward = guestClaimTask(id); if (reward) st = guestDerive(); }
    if (reward) { chord([660, 880, 1320], 0.16); window.haptic && window.haptic('success'); dailyPopupRaw('✅ Задание выполнено', reward); renderAll(); renderTasks(); }
    else flashMsg('Пока недоступно');
  }
  function dailyPopupRaw(title, amount) { const pop = ov.querySelector('#ck-pop'); pop.innerHTML = `<h3>${title}</h3><div class="v">+${fmt(amount)} 🪙</div><button id="ck-pop-ok">Класс!</button>`; pop.classList.add('on'); pop.querySelector('#ck-pop-ok').onclick = () => pop.classList.remove('on'); }

  function dailyPopup(amount, streak) { const pop = ov.querySelector('#ck-pop'); pop.innerHTML = `<h3>🎁 Награда дня ${streak}</h3><div class="v">+${fmt(amount)} 🪙</div><div style="color:#b9a7dd;font-size:13px">Заходи каждый день — награда растёт!</div><button id="ck-pop-ok">Ура!</button>`; pop.classList.add('on'); pop.querySelector('#ck-pop-ok').onclick = () => pop.classList.remove('on'); }
  function passivePopup(amount) { if (!amount || amount <= 0) return; const pop = ov.querySelector('#ck-pop'); pop.innerHTML = `<h3>Пока тебя не было 😺</h3><div class="v">+${fmt(amount)} 🪙</div><div style="color:#b9a7dd;font-size:13px">Котик работал за тебя!</div><button id="ck-pop-ok">Забрать</button>`; pop.classList.add('on'); pop.querySelector('#ck-pop-ok').onclick = () => pop.classList.remove('on'); }

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
    ov.querySelector('#ck-cat').src = A('idle.png');
    setTab('cat'); renderAll();
    if (st.passiveEarned > 0) passivePopup(st.passiveEarned);
    lastTs = 0; syncT = 0; combo = 0; cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
  }
  function close() { cancelAnimationFrame(raf); flush(); if (ov) ov.classList.remove('on'); window.scrollUnlock && window.scrollUnlock(); }
  window.catClickOpen = open; window.catClickClose = close;
  window.addEventListener('resize', () => { if (ov && ov.classList.contains('on') && st) applyCostume(leagueFor(st.totalEarned)); });
})();

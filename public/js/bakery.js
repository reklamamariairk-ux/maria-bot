/* ═══════════════════════════════════════════════════════
   КОНДИТЕРСКАЯ — Hamster Kombat mechanics
   • Energy system
   • PPH cards in 4 categories
   • Rank progression
   • Daily combo bonus
   • Permanent + daily boosts
═══════════════════════════════════════════════════════ */

// ─ Data ─────────────────────────────────────────────
const HK_RANKS = [
  { name:'Стажёр',         need:0 },
  { name:'Ученик',         need:5000 },
  { name:'Пекарь',         need:50000 },
  { name:'Кондитер',       need:500000 },
  { name:'Шеф-кондитер',  need:5000000 },
  { name:'Мастер вкуса',  need:50000000 },
  { name:'Легенда',        need:500000000 },
  { name:'Сладкая Империя',need:5000000000 },
];

const HK_CATS = [
  { id:'recipes',   label:'🥘 Рецепты' },
  { id:'team',      label:'👥 Команда' },
  { id:'shop',      label:'🏪 Магазин' },
  { id:'marketing', label:'📣 Маркетинг' },
];

const HK_CARDS = [
  // РЕЦЕПТЫ
  { id:'vanilla',   cat:'recipes',   emoji:'🍦', name:'Ванильный торт',   baseCost:500,    costMult:2.2, basePph:50,    pphMult:1.3 },
  { id:'choco',     cat:'recipes',   emoji:'🍫', name:'Шоколадный торт',  baseCost:2000,   costMult:2.3, basePph:200,   pphMult:1.35 },
  { id:'honey',     cat:'recipes',   emoji:'🍯', name:'Медовик',          baseCost:8000,   costMult:2.5, basePph:800,   pphMult:1.4 },
  { id:'napoleon',  cat:'recipes',   emoji:'📜', name:'Наполеон',         baseCost:35000,  costMult:2.7, basePph:3500,  pphMult:1.45 },
  { id:'velvet',    cat:'recipes',   emoji:'🌹', name:'Красный бархат',   baseCost:150000, costMult:3.0, basePph:15000, pphMult:1.5 },
  // КОМАНДА
  { id:'intern',    cat:'team',      emoji:'👶', name:'Стажёр',           baseCost:800,    costMult:2.2, basePph:80,    pphMult:1.3 },
  { id:'bakerman',  cat:'team',      emoji:'👨‍🍳', name:'Пекарь',           baseCost:3000,   costMult:2.3, basePph:300,   pphMult:1.35 },
  { id:'decorator', cat:'team',      emoji:'🎨', name:'Декоратор',        baseCost:12000,  costMult:2.5, basePph:1200,  pphMult:1.4 },
  { id:'souschef',  cat:'team',      emoji:'🧑‍🍳', name:'Су-шеф',          baseCost:50000,  costMult:2.7, basePph:5000,  pphMult:1.45 },
  { id:'headchef',  cat:'team',      emoji:'⭐', name:'Шеф-кондитер',    baseCost:200000, costMult:3.0, basePph:20000, pphMult:1.5 },
  // МАГАЗИН
  { id:'showcase',  cat:'shop',      emoji:'🪟', name:'Витрина',          baseCost:1200,   costMult:2.2, basePph:120,   pphMult:1.3 },
  { id:'delivery',  cat:'shop',      emoji:'🛵', name:'Доставка',         baseCost:5000,   costMult:2.3, basePph:500,   pphMult:1.35 },
  { id:'shop2',     cat:'shop',      emoji:'🏬', name:'Второй магазин',   baseCost:20000,  costMult:2.5, basePph:2000,  pphMult:1.4 },
  { id:'franchise', cat:'shop',      emoji:'🔗', name:'Франшиза',         baseCost:80000,  costMult:2.7, basePph:8000,  pphMult:1.45 },
  { id:'network',   cat:'shop',      emoji:'🌐', name:'Торговая сеть',    baseCost:300000, costMult:3.0, basePph:30000, pphMult:1.5 },
  // МАРКЕТИНГ
  { id:'flyers',    cat:'marketing', emoji:'📄', name:'Листовки',         baseCost:600,    costMult:2.2, basePph:60,    pphMult:1.3 },
  { id:'social',    cat:'marketing', emoji:'📱', name:'Соцсети',          baseCost:2500,   costMult:2.3, basePph:250,   pphMult:1.35 },
  { id:'bloggers',  cat:'marketing', emoji:'🎬', name:'Блогеры',          baseCost:10000,  costMult:2.5, basePph:1000,  pphMult:1.4 },
  { id:'tv',        cat:'marketing', emoji:'📺', name:'ТВ-реклама',       baseCost:40000,  costMult:2.7, basePph:4000,  pphMult:1.45 },
  { id:'national',  cat:'marketing', emoji:'📡', name:'Нацкампания',      baseCost:160000, costMult:3.0, basePph:16000, pphMult:1.5 },
];

const HK_BOOSTS_PERM = [
  { id:'multitap',  name:'Мультитап',      emoji:'👆', maxLv:5,
    costs:[2000,10000,50000,200000,1000000],
    label: lv => `+${lv+1} за клик` },
  { id:'maxenergy', name:'Макс. энергия',  emoji:'🔋', maxLv:10,
    costs:[1000,5000,20000,80000,200000,500000,1500000,3000000,8000000,20000000],
    label: lv => `${(lv+1)*500+500} макс.` },
  { id:'recharge',  name:'Быстрый заряд',  emoji:'⚡', maxLv:5,
    costs:[5000,25000,100000,500000,2000000],
    label: lv => `+${(lv+1)*2}/сек` },
];

// ─ State ────────────────────────────────────────────
let hk = {
  coins: 0, total: 0,
  energy: 500, maxEnergy: 500, recharge: 3, tapPower: 1, pph: 0,
  cardLevels: {}, boostLevels: {},
  dailyRefills: 0, dailyTurbo: 0, lastDailyDate: '',
  turboEnd: 0,
  comboDate: '', comboDone: false,
  currentCat: 'recipes',
  interval: null,
};

// ─ Save / Load ──────────────────────────────────────
function hkSave() {
  localStorage.setItem('hk1', JSON.stringify({
    coins: hk.coins, total: hk.total, energy: hk.energy,
    cardLevels: hk.cardLevels, boostLevels: hk.boostLevels,
    dailyRefills: hk.dailyRefills, dailyTurbo: hk.dailyTurbo,
    lastDailyDate: hk.lastDailyDate,
    comboDate: hk.comboDate, comboDone: hk.comboDone,
  }));
}

function hkLoad() {
  try {
    const s = JSON.parse(localStorage.getItem('hk1') || '{}');
    Object.assign(hk, {
      coins: s.coins || 0, total: s.total || 0, energy: s.energy ?? 500,
      cardLevels: s.cardLevels || {}, boostLevels: s.boostLevels || {},
      dailyRefills: s.dailyRefills || 0, dailyTurbo: s.dailyTurbo || 0,
      lastDailyDate: s.lastDailyDate || '',
      comboDate: s.comboDate || '', comboDone: s.comboDone || false,
    });
  } catch {}
  // Reset daily limits
  const today = new Date().toDateString();
  if (hk.lastDailyDate !== today) {
    hk.dailyRefills = 0; hk.dailyTurbo = 0;
    hk.lastDailyDate = today;
  }
  hkCalc();
}

// ─ Calculations ─────────────────────────────────────
function hkCalc() {
  let pph = 0;
  HK_CARDS.forEach(c => {
    const lv = hk.cardLevels[c.id] || 0;
    for (let i = 0; i < lv; i++) pph += c.basePph * Math.pow(Math.min(c.pphMult, 2), Math.min(i, 50));
  });
  hk.pph = Math.ceil(pph);

  const mLv = hk.boostLevels['multitap']  || 0;
  const eLv = hk.boostLevels['maxenergy'] || 0;
  const rLv = hk.boostLevels['recharge']  || 0;
  hk.tapPower  = 1 + mLv;
  hk.maxEnergy = 500 + eLv * 500;
  hk.recharge  = 3 + rLv * 2;
  hk.energy    = Math.min(hk.energy, hk.maxEnergy);
}

function hkCardCost(card) {
  const lv = hk.cardLevels[card.id] || 0;
  const p = card.baseCost * Math.pow(Math.min(card.costMult, 3), Math.min(lv, 60));
  return isFinite(p) ? Math.ceil(p) : Number.MAX_SAFE_INTEGER;
}

function hkCardNextPph(card) {
  const lv = hk.cardLevels[card.id] || 0;
  return Math.ceil(card.basePph * Math.pow(Math.min(card.pphMult, 2), Math.min(lv, 50)));
}

function hkRank() {
  return [...HK_RANKS].reverse().find(r => hk.total >= r.need) || HK_RANKS[0];
}

function hkRankNext() {
  return HK_RANKS.find(r => hk.total < r.need);
}

// ─ Format ───────────────────────────────────────────
function hkFmt(n) {
  if (!isFinite(n)) return '∞';
  n = Math.floor(n);
  if (n >= 1e12) return (n/1e12).toFixed(1) + 'Т';
  if (n >= 1e9)  return (n/1e9).toFixed(1)  + 'Г';
  if (n >= 1e6)  return (n/1e6).toFixed(1)  + 'М';
  if (n >= 1e3)  return (n/1e3).toFixed(1)  + 'К';
  return n.toString();
}

// ─ Daily Combo ──────────────────────────────────────
function hkComboIds() {
  const today = new Date().toDateString();
  const seed  = today.split('').reduce((a,c) => a + c.charCodeAt(0), 0);
  const ids   = HK_CARDS.map(c => c.id);
  const pick  = i => ids[(seed * (i * 7 + 13) + i * 17) % ids.length];
  const combo = [...new Set([pick(1), pick(2), pick(3), pick(4)])].slice(0, 3);
  return combo;
}

function hkCheckCombo() {
  const today = new Date().toDateString();
  if (hk.comboDate === today || hk.comboDone) return;
  const ids = hkComboIds();
  if (ids.every(id => (hk.cardLevels[id] || 0) >= 1)) {
    hk.coins    += 500000;
    hk.total    += 500000;
    hk.comboDone = true;
    hk.comboDate = today;
    hkSave();
    hkShowToast('🎁 Дневное комбо! +500 000 🎂');
    hkUpdateTop();
  }
}

// ─ Tap ──────────────────────────────────────────────
function hkTap(e) {
  if (hk.energy < 1) {
    const cake = document.getElementById('hk-cake');
    if (cake) { cake.classList.remove('hk-shake'); void cake.offsetWidth; cake.classList.add('hk-shake'); }
    return;
  }
  const power = hk.tapPower * (hk.turboEnd > Date.now() ? 5 : 1);
  hk.energy = Math.max(0, hk.energy - 1);
  hk.coins += power;
  hk.total += power;

  // Floating number at tap position
  const area = document.getElementById('hk-cake-area');
  if (area) {
    const rect = area.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    const fl = document.createElement('div');
    fl.className = 'hk-float';
    fl.textContent = '+' + hkFmt(power);
    fl.style.left = (cx - rect.left) + 'px';
    fl.style.top  = (cy - rect.top)  + 'px';
    area.appendChild(fl);
    setTimeout(() => fl.remove(), 800);
  }

  // Cake pop
  const cake = document.getElementById('hk-cake');
  if (cake) { cake.classList.remove('hk-pop'); void cake.offsetWidth; cake.classList.add('hk-pop'); }

  hkCheckCombo();
  hkUpdateTop();
  hkUpdateEnergy();
}

// ─ Buy card ─────────────────────────────────────────
function hkBuyCard(id) {
  const card = HK_CARDS.find(c => c.id === id);
  if (!card) return;
  const cost = hkCardCost(card);
  if (!isFinite(cost) || hk.coins < cost) return;
  hk.coins -= cost;
  hk.cardLevels[id] = (hk.cardLevels[id] || 0) + 1;
  hkCalc(); hkSave(); hkCheckCombo();
  hkUpdateTop(); hkRenderCards(); hkUpdateComboBanner();
}

// ─ Buy boost (permanent) ────────────────────────────
function hkBuyBoost(id) {
  const boost = HK_BOOSTS_PERM.find(b => b.id === id);
  if (!boost) return;
  const lv = hk.boostLevels[id] || 0;
  if (lv >= boost.maxLv) return;
  const cost = boost.costs[lv];
  if (hk.coins < cost) return;
  hk.coins -= cost;
  hk.boostLevels[id] = lv + 1;
  hkCalc(); hkSave();
  hkUpdateTop(); hkRenderBoosts();
}

// ─ Daily boosts ─────────────────────────────────────
function hkUseRefill() {
  if (hk.dailyRefills >= 3) return;
  hk.energy = hk.maxEnergy;
  hk.dailyRefills++;
  hkSave(); hkUpdateEnergy(); hkRenderBoosts();
}

function hkUseTurbo() {
  if (hk.dailyTurbo >= 3) return;
  hk.turboEnd = Date.now() + 20000; // 20 sec
  hk.dailyTurbo++;
  hkSave(); hkRenderBoosts();
  setTimeout(() => hkRenderBoosts(), 20100);
}

// ─ Tabs ─────────────────────────────────────────────
function hkTab(name) {
  ['tap','mine','boost','earn'].forEach(t => {
    const el = document.getElementById('hk-' + t);
    const btn = document.getElementById('hk-btn-' + t);
    if (el)  el.style.display  = t === name ? '' : 'none';
    if (btn) btn.classList.toggle('hk-nb--active', t === name);
  });
  if (name === 'mine')  hkRenderCards();
  if (name === 'boost') hkRenderBoosts();
  if (name === 'earn')  hkRenderEarn();
}

function hkCat(cat) {
  hk.currentCat = cat;
  document.querySelectorAll('.hk-cat').forEach(b => b.classList.remove('hk-cat--active'));
  const active = document.querySelector(`[data-cat="${cat}"]`);
  if (active) active.classList.add('hk-cat--active');
  hkRenderCards();
}

// ─ Render: Top HUD ──────────────────────────────────
function hkUpdateTop() {
  const rank = hkRank();
  const next = hkRankNext();

  const rankEl = document.getElementById('hk-rank-name');
  if (rankEl) rankEl.textContent = rank.name;

  const coinsEl = document.getElementById('hk-coins');
  if (coinsEl) coinsEl.textContent = hkFmt(hk.coins);

  const pphEl = document.getElementById('hk-pph-val');
  if (pphEl) pphEl.textContent = hkFmt(hk.pph);

  // Rank progress bar
  const prog = document.getElementById('hk-rank-prog');
  if (prog && next) {
    const pct = Math.min(100, ((hk.total - rank.need) / (next.need - rank.need)) * 100);
    prog.style.width = pct + '%';
  } else if (prog) {
    prog.style.width = '100%';
  }

  const rankNextEl = document.getElementById('hk-rank-next');
  if (rankNextEl) rankNextEl.textContent = next ? 'до ' + hkFmt(next.need) : '🏆 Максимум!';
}

// ─ Render: Energy ───────────────────────────────────
function hkUpdateEnergy() {
  const fill = document.getElementById('hk-energy-fill');
  const txt  = document.getElementById('hk-energy-txt');
  const pct  = (hk.energy / hk.maxEnergy) * 100;
  if (fill) fill.style.width = pct + '%';
  if (txt)  txt.textContent  = Math.floor(hk.energy) + ' / ' + hk.maxEnergy;
}

// ─ Render: Cards ────────────────────────────────────
function hkUpdateComboBanner() {
  const banner = document.getElementById('hk-combo-banner');
  if (!banner) return;
  const today = new Date().toDateString();
  const done  = hk.comboDate === today && hk.comboDone;
  if (done) {
    banner.className = 'hk-combo-banner hk-combo-banner--done';
    banner.textContent = '✅ Дневное комбо получено! +500 000 🎂';
  } else {
    banner.className = 'hk-combo-banner';
    banner.innerHTML = '🎁 <b>Дневное комбо</b> — купи 3 карты дня и получи <b>500К</b>!';
  }
}

function hkRenderCards() {
  const wrap = document.getElementById('hk-cards');
  if (!wrap) return;
  wrap.innerHTML = '';
  const comboIds = hkComboIds();
  const today    = new Date().toDateString();
  const comboDone = hk.comboDate === today && hk.comboDone;

  HK_CARDS.filter(c => c.cat === hk.currentCat).forEach(card => {
    const lv     = hk.cardLevels[card.id] || 0;
    const cost   = hkCardCost(card);
    const gain   = hkCardNextPph(card);
    const can    = isFinite(cost) && hk.coins >= cost;
    const isCombo = comboIds.includes(card.id) && !comboDone;

    const div = document.createElement('div');
    div.className = 'hk-card' + (can ? ' hk-card--can' : '') + (isCombo ? ' hk-card--combo' : '');
    div.innerHTML = `
      ${isCombo ? '<div class="hk-card__combo-tag">🎁 Комбо</div>' : ''}
      <div class="hk-card__top">
        <div class="hk-card__emoji">${card.emoji}</div>
        <div class="hk-card__lv">ур. ${lv}</div>
      </div>
      <div class="hk-card__name">${card.name}</div>
      <div class="hk-card__pph">+${hkFmt(gain)}/час</div>
      <button class="hk-card__btn ${can ? 'hk-card__btn--on' : ''}"
        onclick="hkBuyCard('${card.id}')" ${can?'':'disabled'}>
        ${hkFmt(cost)} 🎂
      </button>`;
    wrap.appendChild(div);
  });
}

// ─ Render: Boosts ───────────────────────────────────
function hkRenderBoosts() {
  const daily = document.getElementById('hk-boosts-daily');
  const perm  = document.getElementById('hk-boosts-perm');
  if (!daily || !perm) return;

  // Daily boosts
  daily.innerHTML = '';
  const isTurbo = hk.turboEnd > Date.now();
  [{
    id:'refill', emoji:'⚡', name:'Полный заряд',
    desc:'Восстановить энергию до максимума',
    used: hk.dailyRefills, max: 3,
    action: 'hkUseRefill()',
    disabled: hk.dailyRefills >= 3,
  },{
    id:'turbo', emoji:'🚀', name:'Турбо',
    desc: isTurbo ? 'Активно! ×5 тапов' : '×5 тапов на 20 секунд',
    used: hk.dailyTurbo, max: 3,
    action: 'hkUseTurbo()',
    disabled: hk.dailyTurbo >= 3 || isTurbo,
  }].forEach(b => {
    const div = document.createElement('div');
    div.className = 'hk-boost-row' + (b.disabled ? '' : ' hk-boost-row--can');
    div.innerHTML = `
      <div class="hk-boost-row__ic">${b.emoji}</div>
      <div class="hk-boost-row__info">
        <div class="hk-boost-row__name">${b.name}</div>
        <div class="hk-boost-row__desc">${b.desc}</div>
      </div>
      <button class="hk-boost-row__btn ${b.disabled?'':'hk-boost-row__btn--on'}"
        onclick="${b.action}" ${b.disabled?'disabled':''}>
        ${b.disabled ? 'Использовано' : b.used + '/' + b.max + ' бесплатно'}
      </button>`;
    daily.appendChild(div);
  });

  // Permanent boosts
  perm.innerHTML = '';
  HK_BOOSTS_PERM.forEach(boost => {
    const lv  = hk.boostLevels[boost.id] || 0;
    const max = lv >= boost.maxLv;
    const cost = max ? null : boost.costs[lv];
    const can = !max && isFinite(cost) && hk.coins >= cost;
    const div = document.createElement('div');
    div.className = 'hk-boost-row' + (can ? ' hk-boost-row--can' : '');
    div.innerHTML = `
      <div class="hk-boost-row__ic">${boost.emoji}</div>
      <div class="hk-boost-row__info">
        <div class="hk-boost-row__name">${boost.name} <span class="hk-lv-tag">ур.${lv}</span></div>
        <div class="hk-boost-row__desc">${boost.label(lv)}</div>
      </div>
      <button class="hk-boost-row__btn ${can?'hk-boost-row__btn--on':''}"
        onclick="hkBuyBoost('${boost.id}')" ${(!can&&!max)?'disabled':''} ${max?'disabled':''}>
        ${max ? 'МАКС' : hkFmt(cost) + ' 🎂'}
      </button>`;
    perm.appendChild(div);
  });
}

// ─ Render: Earn ─────────────────────────────────────
const HK_TASKS = [
  { id:'t1', emoji:'🎂', name:'Испеки 1 000 тортов',   need:1000,   reward:5000,   type:'total' },
  { id:'t2', emoji:'🎂', name:'Испеки 10 000 тортов',  need:10000,  reward:50000,  type:'total' },
  { id:'t3', emoji:'🎂', name:'Испеки 100K тортов',    need:100000, reward:500000, type:'total' },
  { id:'t4', emoji:'⛏', name:'Купи 5 улучшений',      need:5,      reward:10000,  type:'cards' },
  { id:'t5', emoji:'⛏', name:'Купи 15 улучшений',     need:15,     reward:75000,  type:'cards' },
  { id:'t6', emoji:'⛏', name:'Купи 30 улучшений',     need:30,     reward:250000, type:'cards' },
  { id:'t7', emoji:'👆', name:'Достигни уровня Пекарь',need:50000,  reward:20000,  type:'rank' },
  { id:'t8', emoji:'👆', name:'Достигни Кондитера',    need:500000, reward:200000, type:'rank' },
];

function hkRenderEarn() {
  const wrap = document.getElementById('hk-tasks');
  if (!wrap) return;
  wrap.innerHTML = '';
  const totalCards = Object.values(hk.cardLevels).reduce((a,b)=>a+b, 0);

  HK_TASKS.forEach(task => {
    const done = hk.achieved ? hk.achieved[task.id] : false;
    const cur  = task.type === 'total' ? hk.total
               : task.type === 'cards' ? totalCards
               : hk.total;
    const pct  = Math.min(100, Math.floor((cur / task.need) * 100));
    const can  = !done && cur >= task.need;

    const div = document.createElement('div');
    div.className = 'hk-task' + (done ? ' hk-task--done' : can ? ' hk-task--ready' : '');
    div.innerHTML = `
      <div class="hk-task__ic">${task.emoji}</div>
      <div class="hk-task__info">
        <div class="hk-task__name">${task.name}</div>
        <div class="hk-task__reward">+${hkFmt(task.reward)} 🎂</div>
        ${!done ? `<div class="hk-task__bar"><div style="width:${pct}%"></div></div>` : ''}
      </div>
      ${can && !done ? `<button class="hk-task__btn" onclick="hkClaimTask('${task.id}',${task.reward})">Забрать</button>` : ''}
      ${done ? '<div class="hk-task__check">✅</div>' : ''}`;
    wrap.appendChild(div);
  });
}

function hkClaimTask(id, reward) {
  if (!hk.achieved) hk.achieved = {};
  if (hk.achieved[id]) return;
  hk.achieved[id] = true;
  hk.coins += reward;
  hk.total += reward;
  hkSave(); hkUpdateTop(); hkRenderEarn();
  hkShowToast('🎉 Задание выполнено! +' + hkFmt(reward) + ' 🎂');
}

// ─ Toast ─────────────────────────────────────────────
function hkShowToast(msg) {
  const area = document.getElementById('hk-cake-area') || document.getElementById('hk-tap');
  if (!area) return;
  const t = document.createElement('div');
  t.className = 'hk-toast';
  t.textContent = msg;
  area.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ─ Passive income floating bubble ───────────────────
function hkSpawnPassive() {
  const area = document.getElementById('hk-cake-area');
  if (!area) return;
  const perSec = hk.pph / 3600;
  if (perSec < 0.01) return;

  const label = '+' + hkFmt(Math.max(1, Math.round(perSec)));
  const fl = document.createElement('div');
  fl.className = 'hk-float hk-float--passive';
  fl.textContent = label;
  // random position across the whole area, avoid center (cake button)
  const side = Math.random() < 0.5 ? 'left' : 'right';
  fl.style.left = side === 'left'
    ? (5  + Math.random() * 30) + '%'
    : (65 + Math.random() * 25) + '%';
  fl.style.top  = (30 + Math.random() * 50) + '%';
  area.appendChild(fl);
  setTimeout(() => fl.remove(), 1200);
}

// ─ Tick ─────────────────────────────────────────────
function hkStartTick() {
  if (hk.interval) return;
  let tick = 0;
  hk.interval = setInterval(() => {
    // Recharge energy
    if (hk.energy < hk.maxEnergy) {
      hk.energy = Math.min(hk.maxEnergy, hk.energy + hk.recharge / 20);
    }
    // PPH income
    if (hk.pph > 0) {
      const gain = hk.pph / 3600 / 20;
      hk.coins += gain;
      hk.total += gain;
    }
    tick++;
    if (tick % 4  === 0) { hkUpdateTop(); hkUpdateEnergy(); }
    // Passive bubbles: 1 per second when PPH > 0
    if (tick % 20 === 0 && hk.pph > 0) hkSpawnPassive();
    if (tick % 80 === 0) hkSave();
  }, 50);
}

// ─ Boot ─────────────────────────────────────────────
function hkBoot() {
  hkLoad();
  hkUpdateTop();
  hkUpdateEnergy();
  hkUpdateComboBanner();
  hkStartTick();
  // Touch tap on cake
  const cake = document.getElementById('hk-cake');
  if (cake && !cake.dataset.bound) {
    cake.dataset.bound = '1';
    cake.addEventListener('touchstart', hkTap, { passive: true });
  }
}

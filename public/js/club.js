/* ── Club / Loyalty frontend ─────────────────────────────────────────────── */

const initData = window.Telegram?.WebApp?.initData ?? "";

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (initData) headers["Authorization"] = "tma " + initData;
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) {
    return { __unauthorized: true };
  }
  return res.json();
}

// Cached state
let CLUB_STATE = {
  user: null,
  phoneVerified: false,
  balance: { stars: 0, points: 0 },
  daily: { loginClaimedToday: false, currentStreak: 0, starsEarnedToday: 0, starCap: 300 },
  catalog: [],
  myRewards: [],
};

/* ── Header counters ─────────────────────────────────────────────────────── */
function renderHeaderCounters() {
  const el = document.getElementById("hdr-counters");
  if (!el) return;
  if (!CLUB_STATE.phoneVerified) {
    el.style.display = "none";
    return;
  }
  el.style.display = "flex";
  document.getElementById("hdr-stars").textContent = CLUB_STATE.balance.stars;
  document.getElementById("hdr-points").textContent = CLUB_STATE.balance.points;
}

function pulseCounter(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("pulse");
  void el.offsetWidth;
  el.classList.add("pulse");
}

/* ── Init ────────────────────────────────────────────────────────────────── */
async function clubInit() {
  if (!initData) {
    document.getElementById("club-no-tg").style.display = "block";
    document.getElementById("club-content").style.display = "none";
    return;
  }
  await refreshMe();
  await loadCatalog();
  renderClub();
}

async function refreshMe() {
  const me = await api("/api/me");
  if (me.__unauthorized || me.error) {
    document.getElementById("club-no-tg").style.display = "block";
    document.getElementById("club-content").style.display = "none";
    return;
  }
  CLUB_STATE.user = me.user;
  CLUB_STATE.phoneVerified = me.phoneVerified;
  CLUB_STATE.balance = me.balance;
  CLUB_STATE.daily = me.daily;
  renderHeaderCounters();
}

async function loadCatalog() {
  const items = await api("/api/rewards");
  CLUB_STATE.catalog = Array.isArray(items) ? items : [];
}

async function loadMyRewards() {
  const items = await api("/api/my-rewards");
  CLUB_STATE.myRewards = Array.isArray(items) ? items : [];
}

/* ── Render ──────────────────────────────────────────────────────────────── */
function renderClub() {
  document.getElementById("club-no-tg").style.display = "none";
  document.getElementById("club-content").style.display = "block";

  // Verification banner vs. main UI
  if (!CLUB_STATE.phoneVerified) {
    document.getElementById("club-verify-banner").style.display = "block";
    document.getElementById("club-main").style.display = "none";
    return;
  }
  document.getElementById("club-verify-banner").style.display = "none";
  document.getElementById("club-main").style.display = "block";

  renderHero();
  loadBirthdayPromo();
  renderDaily();
  renderLk();
  renderShop();
  renderMyRewardsBlock();
  renderReferral();
  loadSweetCheckWeek();

  // Восстановить состояние кнопки «Участвую»
  try {
    if (localStorage.getItem('maria_sc_joined') === '1') {
      const btn = document.getElementById('sc-join-btn');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '✅ Вы участвуете';
      }
    }
  } catch {}
}

async function loadSweetCheckWeek() {
  try {
    const r = await fetch('/api/sweet-check/active', {cache: 'no-store'});
    const d = await r.json();
    const top = document.getElementById('sc-week-top');
    const oldWrap = document.getElementById('sc-week');
    if (oldWrap) oldWrap.style.display = 'none';
    if (!top) return;
    if (!d?.active) { top.style.display = 'none'; return; }

    top.style.display = '';
    top.innerHTML = `
      <div class="sc-week-card" onclick="document.querySelector('#tab-club details.acc:nth-of-type(2)')?.setAttribute('open','')">
        <div class="sc-week-card__head">
          <span class="sc-week-card__tag">Задание этой недели</span>
          <span class="sc-week-card__dates">${escapeHtml(d.active.dates || '')}</span>
        </div>
        <div class="sc-week-card__h">${escapeHtml(d.active.name || 'Текущая неделя')}</div>
        ${d.active.task ? `<div class="sc-week-card__task">${escapeHtml(d.active.task)}</div>` : ''}
        ${d.active.reward ? `<div class="sc-week-card__reward"><span class="sc-week-card__rw-ic">🎟</span> ${escapeHtml(String(d.active.reward))}</div>` : ''}
      </div>`;
  } catch {}
}

function scJoin() {
  const btn = document.getElementById('sc-join-btn');
  if (!btn) return;
  btn.disabled = true;
  btn.innerHTML = '✅ Вы участвуете';
  // Toast
  const tg = window.Telegram?.WebApp;
  tg?.HapticFeedback?.notificationOccurred?.('success');
  if (tg?.showAlert) {
    tg.showAlert('Отлично! Делайте покупки в наших кафе — за каждое выполненное задание недели получите 5 билетов 🎟');
  } else {
    alert('Делайте покупки в кафе «Мария» — за каждое выполненное задание недели получите 5 билетов!');
  }
  // Сохраняем флаг в localStorage чтобы в следующий раз не показывать
  try { localStorage.setItem('maria_sc_joined', '1'); } catch {}
}
window.scJoin = scJoin;

function renderSweetCheckMy(data) {
  const oldWrap = document.getElementById('sc-my');
  if (oldWrap) oldWrap.style.display = 'none';

  const top = document.getElementById('sc-my-top');
  if (!top) return;
  top.style.display = '';

  const verified = !!CLUB_STATE?.phoneVerified;
  const tickets = Number(data?.tickets_count || 0);

  // Click handler — open Sweet Check accordion
  const openAcc = `document.querySelector('#tab-club details.acc:nth-of-type(2)')?.setAttribute('open','')`;

  // Состояние 1: не verified
  if (!verified) {
    top.innerHTML = `
      <div class="sc-top-card sc-top-card--teaser" onclick="document.querySelector('#tab-club details.acc:nth-of-type(2)')?.setAttribute('open','')">
        <div class="sc-top-card__row">
          <div class="sc-top-card__num sc-top-card__num--gift">📱</div>
          <div>
            <div class="sc-top-card__lb">Сладкий чек · iPhone 17</div>
            <div class="sc-top-card__h">Подтверди номер чтобы участвовать</div>
            <div class="sc-top-card__sub">Каждый чек становится билетом в квартальный розыгрыш</div>
          </div>
          <div class="sc-top-card__chev">›</div>
        </div>
      </div>`;
    return;
  }

  // Состояние 2: verified, 0 билетов
  if (tickets === 0) {
    top.innerHTML = `
      <div class="sc-top-card sc-top-card--teaser" onclick="${openAcc}">
        <div class="sc-top-card__row">
          <div class="sc-top-card__num sc-top-card__num--gift">🎁</div>
          <div>
            <div class="sc-top-card__lb">Сладкий чек · iPhone 17</div>
            <div class="sc-top-card__h">Получи первый билет</div>
            <div class="sc-top-card__sub">Купи нужный набор в кафе → +5 билетов на квартальный розыгрыш</div>
          </div>
          <div class="sc-top-card__chev">›</div>
        </div>
      </div>`;
    return;
  }

  // Состояние 3: verified + есть билеты
  const chance = tickets >= 10 ? 'Высокий шанс' : tickets >= 3 ? 'Хорошие шансы' : 'Шансы есть';
  top.innerHTML = `
    <div class="sc-top-card" onclick="${openAcc}">
      <div class="sc-top-card__row">
        <div class="sc-top-card__num">${tickets}</div>
        <div>
          <div class="sc-top-card__lb">${tickets === 1 ? 'Билет' : 'Билетов'} в розыгрыше</div>
          <div class="sc-top-card__h">${chance} на iPhone 17</div>
          <div class="sc-top-card__sub">Розыгрыш каждый квартал · купи нужный набор → +5 билетов</div>
        </div>
        <div class="sc-top-card__chev">›</div>
      </div>
    </div>`;
}

// День рождения — карточка-промо в клубе
async function loadBirthdayPromo() {
  const promo = document.getElementById('bday-promo');
  if (!promo) return;
  try {
    const data = await api('/api/me');
    if (!data || data.__unauthorized) { promo.style.display = 'none'; return; }
    // ДР указан → промо скрываем, chip показываем
    if (data.birthday) {
      promo.style.display = 'none';
      try { renderBdayChip(data.birthday); } catch (e) { console.error('[bday-chip]', e); }
      return;
    }
    // ДР не указан → промо показываем, chip скрываем
    promo.style.display = '';
    const chip = document.getElementById('hero-bday-chip');
    if (chip) chip.style.display = 'none';
  } catch {
    promo.style.display = 'none';
  }
}
async function saveBirthday() {
  const inp = document.getElementById('bday-input');
  const status = document.getElementById('bday-status');
  if (!inp || !inp.value) {
    if (status) status.textContent = 'Выбери дату из календаря';
    return;
  }
  if (status) status.textContent = '⏳ Сохраняем…';
  try {
    const res = await fetch('/api/birthday', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(window.Telegram?.WebApp?.initData ? { 'Authorization': 'tma ' + window.Telegram.WebApp.initData } : {})
      },
      body: JSON.stringify({ birthday: inp.value })
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      if (status) status.textContent = '✓ Сохранили — придёт подарок ко дню рождения';
      window.haptic?.('success');
      setTimeout(() => {
        const promo = document.getElementById('bday-promo');
        if (promo) promo.style.display = 'none';
      }, 2000);
    } else {
      if (status) status.textContent = data.error || 'Не получилось сохранить';
      window.haptic?.('error');
    }
  } catch {
    if (status) status.textContent = 'Сеть недоступна';
    window.haptic?.('error');
  }
}
window.saveBirthday = saveBirthday;
window.loadBirthdayPromo = loadBirthdayPromo;

async function renderLk() {
  const section = document.getElementById('lk-section');
  const card = document.getElementById('lk-card');
  if (!section || !card) return;

  card.innerHTML = '<div class="lk-card__loading">Загружаем баланс…</div>';
  section.style.display = '';

  try {
    const data = await api('/api/lk');
    renderSweetCheckMy(data);
    // Обновляем hero level progress (если LK дал year_spent)
    try { renderLevelProgress(data || {}); } catch (e) { console.error('[level]', e); }
    try { renderHeroStats(data || {}); } catch (e) { console.error('[stats]', e); }
    try { renderOnboarding(data || {}); } catch (e) { console.error('[onboard]', e); }
    if (data.__unauthorized || data.error) {
      section.style.display = 'none';
      return;
    }
    if (!data.configured) {
      // Эндпоинт ещё не настроен на сайте — секцию не показываем
      section.style.display = 'none';
      return;
    }
    if (!data.found) {
      card.innerHTML = `
        <div class="lk-card__title">Пока без покупок 🍰</div>
        <div class="lk-card__sub">Сделай первый заказ — и баллы появятся автоматически. Менеджер свяжется по подтверждённому номеру.</div>
        <button class="btn-full" onclick="switchTab('menu')">Перейти в меню →</button>`;
      return;
    }

    // Упрощённая LK-карточка — только баллы и последние заказы
    // (имя/уровень/год дублируют hero — там уже есть chip + progress + stats)
    const orders = Array.isArray(data.orders) ? data.orders : [];
    card.innerHTML = `
      <div class="lk-card__bal-block">
        <div class="lk-card__bal-num">${data.balance.toLocaleString('ru-RU')}</div>
        <div class="lk-card__bal-lb">баллов на сайте</div>
        <div class="lk-card__bal-hint">Доступно для оплаты до 30% от заказа</div>
      </div>
      ${orders.length ? `
        <div class="lk-card__orders">
          <div class="lk-card__tt">🛍 Последние заказы (${orders.length})</div>
          ${orders.slice(0, 3).map(renderOrderRow).join('')}
          ${orders.length > 3 ? `<button class="btn-outline" onclick="profOpenOrders?.()" style="margin-top:8px;width:100%">Все заказы (${orders.length}) →</button>` : ''}
        </div>` : ''}
    `;
    // Авто-link для номеров телефонов в LK
    window.linkifyPhones?.(card);
  } catch {
    section.style.display = 'none';
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function renderOrderRow(o) {
  const dateShort = String(o.date || '').slice(0, 10);
  const items = (o.items || []).slice(0, 2).map(i => `${i.qty}× ${i.name}`).join(', ');
  const more = (o.items || []).length > 2 ? ` +${o.items.length - 2}` : '';
  const statusCls = o.canceled ? 'lk-ord__st--cancel' : (o.paid ? 'lk-ord__st--paid' : '');
  // Можем повторить заказ если есть товары с id
  const itemsWithId = (o.items || []).filter(i => i.id || i.product_id);
  const canRepeat = itemsWithId.length > 0 && !o.canceled;
  // JSON для повтора (id+qty)
  const reorderData = JSON.stringify(itemsWithId.map(i => ({ id: i.id || i.product_id, qty: i.qty || 1, name: i.name, price: i.price }))).replace(/"/g, '&quot;');
  return `
    <div class="lk-ord">
      <div class="lk-ord__row">
        <span class="lk-ord__id">#${o.id}</span>
        <span class="lk-ord__dt">${escapeHtml(dateShort)}</span>
        <span class="lk-ord__sum">${Number(o.sum).toLocaleString('ru-RU')} ₽</span>
      </div>
      <div class="lk-ord__row">
        <span class="lk-ord__items">${escapeHtml(items)}${more}</span>
        <span class="lk-ord__st ${statusCls}">${escapeHtml(o.status || '')}</span>
      </div>
      ${canRepeat ? `<button class="lk-ord__repeat" data-haptic="medium" onclick='reorderItems(${reorderData})'>↻ Повторить заказ</button>` : ''}
    </div>`;
}

// Повтор заказа — кладёт все товары в корзину и открывает её
function reorderItems(items) {
  if (!Array.isArray(items) || !items.length) return;
  let added = 0;
  for (const it of items) {
    if (!it.id || !window.cartAdd) continue;
    window.cartAdd({ id: Number(it.id), name: it.name || `Товар #${it.id}`, price: Number(it.price) || 0, image: null });
    added++;
  }
  if (added > 0) {
    window.haptic?.('success');
    setTimeout(() => window.cartOpen?.(), 300);
  } else {
    window.haptic?.('error');
  }
}
window.reorderItems = reorderItems;

function renderHero() {
  const name = CLUB_STATE.user?.first_name || "Друг";
  document.getElementById("hero-name").textContent = name;
  document.getElementById("hero-stars").textContent = CLUB_STATE.balance.stars;
  document.getElementById("hero-points").textContent = CLUB_STATE.balance.points;

  const convertBtn = document.getElementById("hero-convert");
  convertBtn.style.display = CLUB_STATE.balance.stars >= 50 ? "" : "none";
}

// Уровни клуба: год.траты → имя/иконка/процент. Threshold = от какой суммы доступен.
const CLUB_LEVELS = [
  { name: "Друзья",         icon: "🤝", pct: 5,  threshold: 0      },
  { name: "Лучшие друзья",  icon: "💛", pct: 7,  threshold: 10000  },
  { name: "Семья",          icon: "❤️", pct: 10, threshold: 50000  },
];

function getCurrentLevel(yearSpent, lkLevelName) {
  // Если LK прислал имя уровня — пытаемся сопоставить
  if (lkLevelName) {
    const matched = CLUB_LEVELS.find((l) => l.name.toLowerCase() === String(lkLevelName).toLowerCase());
    if (matched) return matched;
  }
  // Иначе считаем по year_spent
  let cur = CLUB_LEVELS[0];
  for (const lv of CLUB_LEVELS) {
    if (yearSpent >= lv.threshold) cur = lv;
  }
  return cur;
}

function renderLevelProgress(data) {
  const yearSpent = Number(data?.year_spent ?? 0);
  const lkLevel = data?.level ?? null;
  const cur = getCurrentLevel(yearSpent, lkLevel);
  const idx = CLUB_LEVELS.indexOf(cur);
  const next = CLUB_LEVELS[idx + 1] || null;

  // Chip с текущим уровнем
  const ic = document.querySelector('.loy-hero__lvl-ic');
  const nm = document.getElementById('hero-level-name');
  const pc = document.getElementById('hero-level-pct');
  if (ic) ic.textContent = cur.icon;
  if (nm) nm.textContent = cur.name;
  if (pc) pc.textContent = cur.pct + '%';

  // Progress bar
  const wrap = document.getElementById('hero-progress');
  const fill = document.getElementById('hero-progress-fill');
  const txt = document.getElementById('hero-progress-txt');
  if (!wrap) return;

  if (!next) {
    // Достиг максимума
    wrap.style.display = '';
    if (fill) fill.style.width = '100%';
    if (txt) txt.innerHTML = `🏆 Максимальный уровень — кэшбэк ${cur.pct}%`;
    return;
  }

  const fromBase = next.threshold - cur.threshold;
  const earned = Math.max(0, yearSpent - cur.threshold);
  const pct = Math.min(100, Math.max(0, Math.round((earned / fromBase) * 100)));
  const toGo = Math.max(0, next.threshold - yearSpent);

  wrap.style.display = '';
  if (fill) fill.style.width = pct + '%';
  if (txt) {
    txt.innerHTML = toGo > 0
      ? `Ещё <b>${toGo.toLocaleString('ru-RU')} ₽</b> до уровня ${next.icon} ${next.name} (+${next.pct - cur.pct}% к кэшбэку)`
      : `Уровень ${next.icon} ${next.name} разблокирован!`;
  }
}
window.renderLevelProgress = renderLevelProgress;

// Рендерит inline-stats под hero (заказы · потрачено · билеты)
function renderHeroStats(data) {
  const wrap = document.getElementById('hero-stats');
  if (!wrap) return;
  if (!data || !data.configured || !data.found) {
    wrap.style.display = 'none';
    return;
  }
  const orders = Array.isArray(data.orders) ? data.orders.length : 0;
  const yearSpent = Number(data.year_spent ?? 0);
  const tickets = Number(data.tickets_count ?? 0);
  if (orders === 0 && yearSpent === 0 && tickets === 0) {
    wrap.style.display = 'none';
    return;
  }
  const ord = document.getElementById('hero-stat-orders');
  const sp = document.getElementById('hero-stat-spent');
  const tk = document.getElementById('hero-stat-tickets');
  if (ord) ord.innerHTML = `<b>${orders}</b><span>${plural(orders, ['заказ', 'заказа', 'заказов'])}</span>`;
  if (sp)  sp.innerHTML  = `<b>${yearSpent.toLocaleString('ru-RU')}</b><span>₽ за год</span>`;
  if (tk)  tk.innerHTML  = `<b>${tickets}</b><span>${plural(tickets, ['билет', 'билета', 'билетов'])}</span>`;
  wrap.style.display = '';
}
window.renderHeroStats = renderHeroStats;

// ДР-chip — показываем когда ДР указан, считаем дни до скидки (±5 дней от ДР)
function renderBdayChip(birthday) {
  const chip = document.getElementById('hero-bday-chip');
  if (!chip) return;
  if (!birthday) { chip.style.display = 'none'; return; }
  // birthday формат: "MM-DD" или "YYYY-MM-DD"
  const m = String(birthday).match(/^(?:\d{4}-)?(\d{2})-(\d{2})$/);
  if (!m) { chip.style.display = 'none'; return; }
  const month = Number(m[1]), day = Number(m[2]);
  const now = new Date();
  // Ближайший ДР (этот год или следующий)
  let target = new Date(now.getFullYear(), month - 1, day);
  if (target < now && (now - target) > 5 * 86400000) {
    target = new Date(now.getFullYear() + 1, month - 1, day);
  }
  // Активна ли скидка сейчас (±5 дней)
  const diffDays = Math.round((target - now) / 86400000);
  const monthName = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'][month - 1];
  const isActive = Math.abs(diffDays) <= 5 || (diffDays > 360 && diffDays <= 365 && Math.abs(365 - diffDays) <= 5);

  let html;
  if (isActive) {
    html = `<span class="loy-hero__bday-ic">🎂</span><b>Скидка активна!</b> · ДР ${day} ${monthName}`;
  } else if (diffDays >= 0 && diffDays <= 30) {
    html = `<span class="loy-hero__bday-ic">🎂</span>ДР ${day} ${monthName} · через ${diffDays} ${plural(diffDays, ['день', 'дня', 'дней'])}`;
  } else {
    html = `<span class="loy-hero__bday-ic">🎂</span>ДР: ${day} ${monthName}`;
  }
  chip.innerHTML = html;
  chip.style.display = '';
}
window.renderBdayChip = renderBdayChip;

// Onboarding для нового юзера (verified + 0 заказов)
function renderOnboarding(data) {
  const wrap = document.getElementById('club-onboarding');
  if (!wrap) return;
  const verified = !!CLUB_STATE?.phoneVerified;
  const orders = Array.isArray(data?.orders) ? data.orders.length : 0;
  // Показываем если verified И ещё нет заказов
  if (verified && orders === 0) {
    wrap.style.display = '';
  } else {
    wrap.style.display = 'none';
  }
}
window.renderOnboarding = renderOnboarding;

function renderDaily() {
  const d = CLUB_STATE.daily;
  const streak = Number(d.currentStreak ?? 0);
  document.getElementById("daily-streak").textContent = streak;

  const dots = document.getElementById("daily-dots");
  dots.innerHTML = "";

  // Прогресс в текущей семидневке (mod 7), но если streak >= 7 и кратно — показываем все 7 заполненными
  const filled = streak === 0 ? 0 : (streak % 7 === 0 ? 7 : streak % 7);
  const todayClaimed = !!d.loginClaimedToday;

  for (let i = 0; i < 7; i++) {
    const dot = document.createElement("div");
    let state = '';
    if (i < filled) state = 'ddot--done';
    else if (i === filled && !todayClaimed) state = 'ddot--today';
    // i > filled — будущие дни остаются пустыми
    dot.className = `ddot ${state}`;
    // Иконка/число внутри
    if (i < filled) dot.innerHTML = '<span class="ddot__check">✓</span>';
    else if (i === filled && !todayClaimed) dot.innerHTML = '<span class="ddot__num">+10</span>';
    else dot.innerHTML = `<span class="ddot__day">${i + 1}</span>`;
    dots.appendChild(dot);
  }

  const btn = document.getElementById("daily-claim-btn");
  if (todayClaimed) {
    btn.disabled = true;
    btn.textContent = "Сегодня уже получено ✓";
  } else {
    btn.disabled = false;
    btn.textContent = "Получить +10 💎";
  }

  // Обновляем hint — динамически в зависимости от стрика
  const hint = document.querySelector('.daily__hint');
  if (hint) {
    if (streak >= 30) {
      hint.textContent = '🔥 30+ дней — ты в зоне фанатиков. Продолжай!';
    } else if (streak >= 7) {
      const toThirty = 30 - streak;
      hint.textContent = `Ещё ${toThirty} ${plural(toThirty, ['день', 'дня', 'дней'])} до бонуса +400 💎`;
    } else {
      const toSeven = 7 - streak;
      hint.textContent = `Ещё ${toSeven} ${plural(toSeven, ['день', 'дня', 'дней'])} до бонуса +100 💎`;
    }
  }
}

// Плюрализация русских слов: 1 день / 2 дня / 5 дней
function plural(n, forms) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

// Рендер preview магазина наград — 2 ближайшие по достижимости + кнопка "Все"
function renderShop() {
  const wrap = document.getElementById("rewards-shop");
  if (!wrap) return;
  wrap.innerHTML = "";
  const points = CLUB_STATE.balance.points;
  const all = CLUB_STATE.catalog || [];
  if (all.length === 0) {
    wrap.innerHTML = '<div class="rcard__empty">Награды скоро появятся 🎁</div>';
    return;
  }

  // Сортируем: сперва доступные (хватает баллов), затем по cost asc — показываем самые "близкие"
  const sorted = [...all].sort((a, b) => {
    const aCan = points >= a.cost_points ? 0 : 1;
    const bCan = points >= b.cost_points ? 0 : 1;
    if (aCan !== bCan) return aCan - bCan;
    return a.cost_points - b.cost_points;
  });
  const preview = sorted.slice(0, 2);

  const grid = document.createElement('div');
  grid.className = 'rewards-grid';
  for (const r of preview) {
    const can = points >= r.cost_points;
    const card = document.createElement("div");
    card.className = "rcard" + (can ? "" : " rcard--locked");
    card.innerHTML = `
      <div class="rcard__title">${escapeHtml(r.title)}</div>
      <div class="rcard__sub">${escapeHtml(r.description ?? "")}</div>
      <div class="rcard__min">от ${r.min_order} ₽</div>
      <div class="rcard__cost">${r.cost_points} 💎</div>
      <button class="rcard__btn" ${can ? "" : "disabled"} data-id="${r.id}">
        ${can ? "Получить" : "Не хватает"}
      </button>
    `;
    card.querySelector(".rcard__btn").addEventListener("click", () => openRedeemModal(r));
    grid.appendChild(card);
  }
  wrap.appendChild(grid);

  if (all.length > 2) {
    const more = document.createElement('button');
    more.className = 'btn-outline rewards-shop__all';
    more.textContent = `Все награды (${all.length}) →`;
    more.onclick = () => openShopModal();
    wrap.appendChild(more);
  }
}

// Modal со всеми наградами
function openShopModal() {
  let modal = document.getElementById('shop-all-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'shop-all-modal';
    modal.className = 'cat-modal';
    modal.style.display = 'none';
    modal.onclick = (e) => { if (e.target === modal) closeShopModal(); };
    modal.innerHTML = `
      <div class="cat-modal__sheet">
        <button class="cat-modal__close" onclick="closeShopModal()">×</button>
        <div class="shop-modal__h">Магазин наград</div>
        <div class="shop-modal__sub">Меняй баллы 💎 на промокоды</div>
        <div class="shop-modal__list" id="shop-modal-list"></div>
      </div>`;
    document.body.appendChild(modal);
  }
  const list = modal.querySelector('#shop-modal-list');
  list.innerHTML = '';
  const points = CLUB_STATE.balance.points;
  for (const r of CLUB_STATE.catalog || []) {
    const can = points >= r.cost_points;
    const card = document.createElement('div');
    card.className = 'rcard' + (can ? '' : ' rcard--locked');
    card.innerHTML = `
      <div class="rcard__title">${escapeHtml(r.title)}</div>
      <div class="rcard__sub">${escapeHtml(r.description ?? '')}</div>
      <div class="rcard__min">от ${r.min_order} ₽</div>
      <div class="rcard__cost">${r.cost_points} 💎</div>
      <button class="rcard__btn" ${can ? '' : 'disabled'}>${can ? 'Получить' : 'Не хватает'}</button>`;
    card.querySelector('.rcard__btn').addEventListener('click', () => { closeShopModal(); openRedeemModal(r); });
    list.appendChild(card);
  }
  modal.style.display = 'flex';
  window.scrollLock?.();
}
window.openShopModal = openShopModal;
function closeShopModal() {
  const m = document.getElementById('shop-all-modal');
  if (m) m.style.display = 'none';
  window.scrollUnlock?.();
}
window.closeShopModal = closeShopModal;

async function renderMyRewardsBlock() {
  await loadMyRewards();
  const wrap = document.getElementById("my-rewards");
  const count = document.getElementById("my-rewards-count");
  count.textContent = CLUB_STATE.myRewards.length;
  if (CLUB_STATE.myRewards.length === 0) {
    wrap.innerHTML = `<div class="my-rewards__empty">Пока нет промокодов — заработай и купи в магазине наград выше</div>`;
    return;
  }
  wrap.innerHTML = CLUB_STATE.myRewards
    .map((r) => {
      const exp = new Date(r.expires_at).toLocaleDateString("ru-RU");
      const used = r.used_at ? `<span class="prom__used">использован</span>` : "";
      return `
        <div class="prom">
          <div class="prom__head">
            <span class="prom__title">${r.title}</span>
            <span class="prom__exp">до ${exp}</span>
          </div>
          <div class="prom__code">
            <span class="prom__codetxt">${r.promo_code}</span>
            <button class="prom__copy" data-code="${r.promo_code}">📋</button>
          </div>
          ${used}
        </div>`;
    })
    .join("");
  wrap.querySelectorAll(".prom__copy").forEach((b) =>
    b.addEventListener("click", () => {
      const code = b.dataset.code;
      navigator.clipboard?.writeText(code);
      b.textContent = "✓";
      setTimeout(() => (b.textContent = "📋"), 1200);
    })
  );
}

function renderReferral() {
  if (!CLUB_STATE.user) return;
  const link = `https://t.me/mariatortik_bot?start=ref_${CLUB_STATE.user.id}`;
  document.getElementById("ref-link").value = link;
}

/* ── Verification ────────────────────────────────────────────────────────── */
function startVerification() {
  const tg = window.Telegram?.WebApp;
  if (!tg) {
    alert("Откройте через Telegram");
    return;
  }
  if (typeof tg.requestContact !== "function") {
    tg.showAlert?.(
      "Подтверждение через приложение требует Telegram 6.9+. Откройте /start в боте — там кнопка «Поделиться номером»"
    );
    return;
  }
  tg.requestContact(async (sent, response) => {
    if (!sent && response?.status !== "sent") return;
    // Phone arrives via bot's contact handler. Poll /api/me for verification.
    document.getElementById("verify-status").textContent = "Сохраняем номер…";
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      await refreshMe();
      if (CLUB_STATE.phoneVerified) break;
    }
    if (CLUB_STATE.phoneVerified) {
      document.getElementById("verify-status").textContent = "";
      tg.HapticFeedback?.notificationOccurred?.("success");
      renderClub();
    } else {
      document.getElementById("verify-status").textContent =
        "Не пришёл контакт от Telegram. Попробуй ещё раз или открой /start в боте.";
    }
  });
}

/* ── Daily claim ─────────────────────────────────────────────────────────── */
async function claimDaily() {
  const btn = document.getElementById("daily-claim-btn");
  btn.disabled = true;
  const r = await api("/api/daily/claim", { method: "POST" });
  if (r.ok) {
    CLUB_STATE.balance = r.balance;
    CLUB_STATE.daily.loginClaimedToday = true;
    CLUB_STATE.daily.currentStreak = r.streakDays || CLUB_STATE.daily.currentStreak;
    pulseCounter("hdr-points");
    let msg = `+${r.pointsAwarded} 💎`;
    if (r.streakBonus) msg += ` (бонус за стрик: +${r.streakBonus} 💎)`;
    window.Telegram?.WebApp?.showPopup?.({ title: "Награда дня", message: msg, buttons: [{ type: "ok" }] }) ||
      alert(msg);
    renderHeaderCounters();
    renderHero();
    renderDaily();
    renderShop();
  } else {
    btn.textContent = r.reason === "already_claimed_today" ? "Сегодня уже получено ✓" : "Ошибка";
  }
}

/* ── Conversion modal ────────────────────────────────────────────────────── */
async function openConvertModal() {
  const tiers = await api("/api/conversion-tiers");
  const have = CLUB_STATE.balance.stars;
  const modal = document.getElementById("convert-modal");
  const optsWrap = document.getElementById("convert-options");
  optsWrap.innerHTML = tiers
    .map((t) => {
      const can = have >= t.stars;
      const ratio = t.stars > 0 ? Math.round((t.points / (t.stars * 0.1) - 100)) : 0; // % bonus over base 10:1
      return `
        <label class="ctier ${can ? "" : "ctier--off"}">
          <input type="radio" name="ctier" value="${t.stars}" ${can ? "" : "disabled"}/>
          <span class="ctier__txt">${t.stars} ⭐ → <b>${t.points} 💎</b>${ratio > 0 ? ` <em>+${ratio}%</em>` : ""}</span>
        </label>`;
    })
    .join("");
  document.getElementById("convert-have").textContent = have;
  modal.style.display = "flex";
}

function closeConvertModal() {
  document.getElementById("convert-modal").style.display = "none";
}

async function doConvert() {
  const sel = document.querySelector('#convert-options input[name="ctier"]:checked');
  if (!sel) return;
  const stars = Number(sel.value);
  const r = await api("/api/convert", { method: "POST", body: JSON.stringify({ stars }) });
  if (r.ok) {
    CLUB_STATE.balance = r.balance;
    pulseCounter("hdr-points");
    pulseCounter("hdr-stars");
    closeConvertModal();
    renderHeaderCounters();
    renderHero();
    renderShop();
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.("success");
  } else {
    alert(r.reason === "insufficient_stars" ? "Не хватает звёзд" : "Ошибка обмена");
  }
}

/* ── Redeem modal ────────────────────────────────────────────────────────── */
let CURRENT_REDEEM = null;
function openRedeemModal(reward) {
  CURRENT_REDEEM = reward;
  const m = document.getElementById("redeem-modal");
  document.getElementById("redeem-title").textContent = reward.title;
  document.getElementById("redeem-desc").textContent = reward.description ?? "";
  document.getElementById("redeem-min").textContent = `Мин. заказ: ${reward.min_order} ₽`;
  document.getElementById("redeem-cost").textContent = `Спишется: ${reward.cost_points} 💎`;
  document.getElementById("redeem-after").textContent =
    `Останется: ${CLUB_STATE.balance.points - reward.cost_points} 💎`;
  document.getElementById("redeem-result").style.display = "none";
  document.getElementById("redeem-confirm").style.display = "";
  m.style.display = "flex";
}

function closeRedeemModal() {
  document.getElementById("redeem-modal").style.display = "none";
  CURRENT_REDEEM = null;
}

async function doRedeem() {
  if (!CURRENT_REDEEM) return;
  const r = await api("/api/redeem", {
    method: "POST",
    body: JSON.stringify({ rewardId: CURRENT_REDEEM.id }),
  });
  if (r.ok) {
    CLUB_STATE.balance = r.balance;
    pulseCounter("hdr-points");
    document.getElementById("redeem-confirm").style.display = "none";
    document.getElementById("redeem-result").style.display = "";
    document.getElementById("redeem-code").textContent = r.promoCode;
    const exp = new Date(r.expiresAt).toLocaleDateString("ru-RU");
    document.getElementById("redeem-code-exp").textContent = `Действует до ${exp}`;
    renderHeaderCounters();
    renderHero();
    renderShop();
    renderMyRewardsBlock();
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.("success");
  } else {
    alert(r.reason === "insufficient" ? "Не хватает баллов" : "Ошибка получения");
  }
}

function copyRedeemCode() {
  const code = document.getElementById("redeem-code").textContent;
  navigator.clipboard?.writeText(code);
  document.getElementById("redeem-copy").textContent = "Скопировано ✓";
  setTimeout(() => (document.getElementById("redeem-copy").textContent = "Копировать"), 1500);
}

/* ── Referral ────────────────────────────────────────────────────────────── */
function shareReferral() {
  const link = document.getElementById("ref-link").value;
  const text = `Заходи в Marию — бот кондитерской «Мария» в Иркутске. Игры, скидки, бонусы 🎂`;
  const tg = window.Telegram?.WebApp;
  if (tg?.openTelegramLink) {
    tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
  } else {
    navigator.clipboard?.writeText(link);
    alert("Ссылка скопирована");
  }
}

/* ── History ─────────────────────────────────────────────────────────────── */
async function toggleHistory() {
  const wrap = document.getElementById("history-wrap");
  const list = document.getElementById("history-list");
  if (wrap.style.display === "none" || !wrap.style.display) {
    wrap.style.display = "block";
    list.innerHTML = "<div class='history-loading'>Загружаем…</div>";
    const rows = await api("/api/history");
    if (!Array.isArray(rows) || rows.length === 0) {
      list.innerHTML = "<div class='history-empty'>Пока операций нет</div>";
      return;
    }
    list.innerHTML = rows
      .map((r) => {
        const sign = r.amount > 0 ? "+" : "";
        const icon = r.kind === "star" ? "⭐" : "💎";
        const dt = new Date(r.created_at).toLocaleString("ru-RU", {
          day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
        });
        return `<div class="hrow"><span class="hrow__amt ${r.amount > 0 ? "pos" : "neg"}">${sign}${r.amount} ${icon}</span><span class="hrow__src">${SOURCE_LABELS[r.source] ?? r.source}</span><span class="hrow__dt">${dt}</span></div>`;
      })
      .join("");
  } else {
    wrap.style.display = "none";
  }
}

const SOURCE_LABELS = {
  daily_login: "Ежедневный вход",
  streak_7: "Стрик 7 дней",
  streak_30: "Стрик 30 дней",
  phone_verification: "Подтверждение номера",
  star_conversion: "Обмен звёзд",
  reward: "Покупка награды",
  referral: "Реферал",
  flappy_cake: "Flappy Cake",
  memory: "Memory",
  bakery: "Пекарня",
  record_bonus: "Новый рекорд",
  conversion: "Обмен на баллы",
};

/* ── Game integration ────────────────────────────────────────────────────── */
window.submitGameResult = async function (game, score) {
  if (!CLUB_STATE.phoneVerified) return null;
  const r = await api("/api/game-result", { method: "POST", body: JSON.stringify({ game, score }) });
  if (r && !r.error && r.balance) {
    CLUB_STATE.balance = r.balance;
    renderHeaderCounters();
    pulseCounter("hdr-stars");
  }
  return r;
};

/* ── Hooks ───────────────────────────────────────────────────────────────── */
window.clubInit = clubInit;
window.startVerification = startVerification;
window.claimDaily = claimDaily;
window.openConvertModal = openConvertModal;
window.closeConvertModal = closeConvertModal;
window.doConvert = doConvert;
window.openRedeemModal = openRedeemModal;
window.closeRedeemModal = closeRedeemModal;
window.doRedeem = doRedeem;
window.copyRedeemCode = copyRedeemCode;
window.shareReferral = shareReferral;
window.toggleHistory = toggleHistory;

document.addEventListener("DOMContentLoaded", () => {
  clubInit().catch((e) => console.error("[club init]", e));
});

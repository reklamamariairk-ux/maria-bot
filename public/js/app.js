/* ── Telegram ────────────────────────────────────────────────────────────── */
const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

function openSite(url) {
  if (tg) tg.openLink(url);
  else window.open(url, '_blank');
}

/* ── Магазины (модалка адресов) ─────────────────────────────────────────── */
let _shopsLoaded = false;

async function openShopsModal() {
  const m = document.getElementById('shops-modal');
  if (!m) return;
  m.style.display = 'flex';
  window.scrollLock?.();
  if (!_shopsLoaded) await loadShops();
}

async function loadShops() {
  const wrap = document.getElementById('shops-content');
  if (!wrap) return;
  try {
    const r = await fetch('/api/shops', {cache: 'no-store'});
    const d = await r.json();
    const shops = Array.isArray(d?.shops) ? d.shops : [];
    if (shops.length === 0) {
      wrap.innerHTML = `
        <div class="shops__h">📍 Кафе «Мария»</div>
        <div class="shops__sub">Иркутск + Ангарск</div>
        <div class="cat-empty" style="padding:30px 20px">Адреса временно недоступны. Скоро добавим.</div>
        <div class="shops__cta">
          <button class="btn-outline" onclick="openMaps()">🗺 Открыть на Яндекс.Картах</button>
          <a class="btn-full" href="tel:+73952504080">☎ +7 (3952) 50-40-80</a>
        </div>`;
      return;
    }
    // Группировка по городу
    const byCity = {};
    for (const s of shops) {
      const c = (s.city && String(s.city).trim()) || (/ангарск/i.test(s.address || '') ? 'Ангарск' : 'Иркутск');
      (byCity[c] ||= []).push(s);
    }
    const groups = Object.entries(byCity).map(([city, list]) => `
      <div class="shops__group">
        <div class="shops__city">${escA(city)}</div>
        ${list.map(s => `
          <div class="shop">
            <div class="shop__addr">${escA(s.address || s.name)}</div>
            ${s.hours ? `<div class="shop__t">🕐 ${escA(s.hours)}</div>` : ''}
          </div>`).join('')}
      </div>`).join('');
    wrap.innerHTML = `
      <div class="shops__h">📍 ${shops.length} ${shops.length === 1 ? 'кафе' : 'кафе'} «Мария»</div>
      <div class="shops__sub">в Иркутске${byCity['Ангарск'] ? ' и Ангарске' : ''}</div>
      ${groups}
      <div class="shops__cta">
        <button class="btn-outline" onclick="openMaps()">🗺 Открыть на Яндекс.Картах</button>
        <a class="btn-full" href="tel:+73952504080">☎ +7 (3952) 50-40-80</a>
      </div>`;
    // Если у магазинов есть телефоны в адресах — кликабельны
    window.linkifyPhones?.(wrap);
    _shopsLoaded = true;
  } catch (e) {
    wrap.innerHTML = `
      <div class="shops__h">📍 Кафе «Мария»</div>
      <div class="cat-empty" style="padding:30px 20px">Не удалось загрузить адреса.</div>
      <div class="shops__cta">
        <button class="btn-outline" onclick="openMaps()">🗺 Открыть на Яндекс.Картах</button>
        <a class="btn-full" href="tel:+73952504080">☎ +7 (3952) 50-40-80</a>
      </div>`;
  }
}

function escA(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function closeShopsModal() {
  const m = document.getElementById('shops-modal');
  if (m) m.style.display = 'none';
  window.scrollUnlock?.();
}
function openMaps() {
  const url = 'https://yandex.ru/maps/?text=Мария кондитерская Иркутск';
  if (tg?.openLink) tg.openLink(url);
  else window.open(url, '_blank');
}
window.openShopsModal = openShopsModal;
window.closeShopsModal = closeShopsModal;
window.openMaps = openMaps;

/* ── AI чат — модал, открывается с любой вкладки ───────────────────────── */
const AI_CHIP_POOL = {
  home: [
    'Что в наличии прямо сейчас?',
    'Какой торт месяца?',
    'Расскажи про Сладкий чек',
    'Как работает клуб?',
    'Самый популярный торт',
  ],
  menu: [
    'Что подойдёт на день рождения?',
    'Торт без сахара?',
    'Какие пироги есть с курицей?',
    'Что взять на 8 человек?',
    'Самый недорогой торт',
  ],
  club: [
    'Как получить больше баллов?',
    'Сколько у меня билетов?',
    'Какие награды доступны?',
    'Как пригласить друга?',
    'Что даёт уровень "Семья"?',
  ],
  fun: [
    'Как играть в пекарне?',
    'Сколько баллов даёт игра?',
    'Покажи лучший торт месяца',
  ],
  order: [
    'Сколько стоит торт на 10 человек?',
    'Можно ли с фотопечатью?',
    'За сколько дней заказывать?',
  ],
};

function getAiChips() {
  const activeTab = document.querySelector('.tab.active')?.id || 'tab-home';
  const key = activeTab.replace('tab-', '');
  const pool = AI_CHIP_POOL[key] || AI_CHIP_POOL.home;
  // Берём случайные 3 из пула
  const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, 3);
  return shuffled;
}

function refreshChatChips() {
  const wrap = document.getElementById('chat-chips');
  if (!wrap) return;
  // Не перезаписываем если уже идёт диалог
  const messages = document.getElementById('chat-messages');
  const userMsgs = messages ? messages.querySelectorAll('.msg--user').length : 0;
  if (userMsgs > 0) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';
  const chips = getAiChips();
  wrap.innerHTML = chips.map((c) =>
    `<button class="chip" data-haptic="light" onclick="usechip(this)">${c.replace(/[<>"']/g, '')}</button>`
  ).join('');
}

function openAiChat() {
  const m = document.getElementById('ai-chat-modal');
  if (!m) return;
  m.style.display = 'flex';
  document.body.classList.add('chat-open'); // dim background
  window.scrollLock?.();
  window.tgBack?.show(() => closeAiChat());
  refreshChatChips();
  // Персонализированное приветствие (один раз) + timestamp
  customizeChatWelcome();
  const firstBubble = document.querySelector('#chat-welcome .msg__bubble');
  if (firstBubble && !firstBubble.querySelector('.msg__time') && window.nowHM) {
    firstBubble.insertAdjacentHTML('beforeend', `<span class="msg__time">${window.nowHM()}</span>`);
  }
  setTimeout(() => document.getElementById('chat-input')?.focus(), 200);
  setTimeout(() => {
    const wrap = document.getElementById('chat-messages');
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
  }, 50);
}

// Welcome message — персонализация для verified юзера
async function customizeChatWelcome() {
  const txt = document.getElementById('chat-welcome-text');
  if (!txt || txt.dataset.customized === '1') return;
  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || '';
  if (!initData) return; // guest mode — оставить дефолт
  try {
    const r = await fetch('/api/me', { headers: { Authorization: 'tma ' + initData } });
    if (!r.ok) return;
    const me = await r.json();
    if (!me.phoneVerified) return;
    const name = me.user?.first_name || 'Анна';
    // Опционально проверим LK для cтат
    let stats = '';
    try {
      const lkRes = await fetch('/api/lk', { headers: { Authorization: 'tma ' + initData } });
      if (lkRes.ok) {
        const d = await lkRes.json();
        const lk = d?.data || {};
        if (lk.found) {
          const parts = [];
          if (lk.balance > 0) parts.push(`${Number(lk.balance).toLocaleString('ru-RU')} баллов`);
          if (Array.isArray(lk.orders) && lk.orders.length > 0) parts.push(`${lk.orders.length} ${lk.orders.length === 1 ? 'заказ' : lk.orders.length < 5 ? 'заказа' : 'заказов'}`);
          if (parts.length) stats = ` У тебя ${parts.join(' · ')}.`;
        }
      }
    } catch {}
    // Сохраняем timestamp если есть
    const time = txt.querySelector('.msg__time')?.outerHTML || '';
    txt.innerHTML = `Привет, ${name}! 👋 Я Маша. ${stats || ''} Помогу подобрать торт, повторить заказ или ответить про клуб.${time}`;
    txt.dataset.customized = '1';
  } catch {}
}
window.customizeChatWelcome = customizeChatWelcome;

function closeAiChat() {
  const m = document.getElementById('ai-chat-modal');
  if (m) m.style.display = 'none';
  document.body.classList.remove('chat-open');
  window.scrollUnlock?.();
  window.tgBack?.hide();
}
window.openAiChat = openAiChat;
window.closeAiChat = closeAiChat;

/* ── Торт месяца — динамика из каталога ─────────────────────────────────── */
let _cakeOfMonth = null;

async function loadCakeOfMonth() {
  try {
    const r = await fetch('/api/catalog/products?category=Торты&limit=80', {cache:'no-store'});
    const d = await r.json();
    const all = Array.isArray(d?.products) ? d.products : [];
    const candidates = all.filter(p => p.hit && p.image);
    if (candidates.length === 0) return;
    const c = candidates[0];
    _cakeOfMonth = c;

    const card = document.getElementById('promo-cake-of-month');
    if (!card) return;
    const nm = document.getElementById('promo-cake-name');
    const ds = document.getElementById('promo-cake-desc');
    const imgEl = document.getElementById('promo-feature-img');
    const countdownEl = document.getElementById('promo-countdown');
    if (nm) nm.textContent = c.name;
    if (ds) {
      const cleaned = (c.preview || '').replace(/\s+/g, ' ').trim();
      ds.textContent = cleaned
        ? (cleaned.length > 100 ? cleaned.substring(0, 98) + '…' : cleaned)
        : `Хит каталога — ${Number(c.priceNumber || c.price || 0).toLocaleString('ru-RU')} ₽`;
    }
    if (imgEl && c.image) {
      const proxied = `/img?u=${encodeURIComponent(c.image)}`;
      imgEl.style.backgroundImage = `url('${proxied}')`;
    }

    // Hero photo background — тоже используем this image
    const heroBg = document.getElementById('hero-bg');
    if (heroBg && c.image) {
      const proxied = `/img?u=${encodeURIComponent(c.image)}`;
      const img = new Image();
      img.onload = () => {
        heroBg.style.backgroundImage = `url('${proxied}')`;
        heroBg.classList.add('loaded');
      };
      img.src = proxied;
    }

    // Countdown до конца месяца
    if (countdownEl) {
      const now = new Date();
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      const daysLeft = Math.ceil((endOfMonth - now) / 86400000);
      if (daysLeft > 0) {
        const dayPlural = (n) => {
          const mod10 = n % 10, mod100 = n % 100;
          if (mod10 === 1 && mod100 !== 11) return 'день';
          if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';
          return 'дней';
        };
        countdownEl.textContent = `⏱ Акция действует ещё ${daysLeft} ${dayPlural(daysLeft)}`;
      }
    }
  } catch (e) { console.error('[cake-of-month]', e); }
}

function catOpenProductFromPromo() {
  if (_cakeOfMonth?.id && window.catOpenProduct) {
    window.catOpenProduct(_cakeOfMonth.id);
  } else {
    switchTab('menu');
  }
}
window.catOpenProductFromPromo = catOpenProductFromPromo;
window.loadCakeOfMonth = loadCakeOfMonth;

/* ── Хит недели — карусель на главной ───────────────────────────────────── */
async function loadHomeHits() {
  const wrap = document.getElementById('home-hits');
  if (!wrap) return;
  try {
    const r = await fetch('/api/catalog/products?limit=100', {cache:'no-store'});
    const d = await r.json();
    const all = Array.isArray(d?.products) ? d.products : [];
    const hits = all.filter(p => p.hit && p.image && p.id && (p.priceNumber || p.price)).slice(0, 8);
    if (hits.length === 0) {
      wrap.innerHTML = '';
      wrap.style.display = 'none';
      return;
    }
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    wrap.innerHTML = hits.map((p, i) => {
      const priceTxt = p.price || (p.priceNumber ? `${Number(p.priceNumber).toLocaleString('ru-RU')} ₽` : '');
      const loading = i < 3 ? 'eager' : 'lazy';
      const fp      = i < 2 ? 'high' : 'auto';
      return `
        <div class="hit-card" data-haptic="light" onclick="catOpenProduct(${p.id})">
          <div class="hit-card__img">
            <img src="/img?u=${encodeURIComponent(p.image)}" alt="${esc(p.name)}" loading="${loading}" decoding="async" fetchpriority="${fp}" onload="this.classList.add('loaded')">
            <span class="hit-card__badge">★ Хит</span>
          </div>
          <div class="hit-card__name">${esc(p.name)}</div>
          <div class="hit-card__price">${esc(priceTxt)}</div>
        </div>`;
    }).join('');
    if (window.IconInflate) window.IconInflate(wrap);
  } catch (e) {
    console.error('[home-hits]', e);
    wrap.innerHTML = '';
  }
}
window.loadHomeHits = loadHomeHits;

/* ── Tabs ────────────────────────────────────────────────────────────────── */
// 'fun' остаётся как доступная вкладка (открывается из Профиля), но в bottom-nav заменили на 'profile'
const TAB_ORDER = ['home','menu','club','profile','order'];
let _lastTab = 'home';
function switchTab(name) {
  // Определяем направление перехода (вправо/влево) для slide-анимации
  const fromIdx = TAB_ORDER.indexOf(_lastTab);
  const toIdx   = TAB_ORDER.indexOf(name);
  const back    = fromIdx > toIdx;
  _lastTab = name;
  document.querySelectorAll('.tab').forEach(t => { t.classList.remove('active'); t.classList.remove('tab-back'); });
  document.querySelectorAll('.nb').forEach(b => b.classList.remove('active'));
  const tab = document.getElementById('tab-' + name);
  if (tab) {
    if (back) tab.classList.add('tab-back');
    tab.classList.add('active');
  }
  const navBtn = document.getElementById('nav-' + name);
  navBtn?.classList.add('active');
  positionNavPill(navBtn);
  // FAB AI-чата теперь виден на ВСЕХ вкладках (модал поверх)
  const fab = document.getElementById('fab-ai');
  if (fab) fab.style.display = '';
  // Игры удалены — fun handler не нужен
  if (name === 'profile') {
    try { profileLoad?.(); } catch (e) { console.error('[profile]', e); }
  }
  // Haptic уже срабатывает через data-haptic="selection" на nav-кнопках —
  // дублировать selectionChanged здесь не нужно
  window.scrollTo(0, 0);
}

function positionNavPill(activeBtn) {
  const pill = document.getElementById('bnav-pill');
  if (!pill || !activeBtn) return;
  const navRect = activeBtn.parentElement.getBoundingClientRect();
  const btnRect = activeBtn.getBoundingClientRect();
  pill.style.width  = btnRect.width + 'px';
  pill.style.transform = `translateX(${btnRect.left - navRect.left}px)`;
}

window.addEventListener('load', () => {
  const active = document.querySelector('.bnav .nb.active');
  positionNavPill(active);
});
window.addEventListener('resize', () => {
  const active = document.querySelector('.bnav .nb.active');
  positionNavPill(active);
});

/* ── Sub-tabs (dead code, оставлен пустым для совместимости) ──────────── */
function showSubTab(name) {
  // Sub-tabs удалены — функция оставлена пустой на случай если её где-то вызовут
  ['games','chat'].forEach(n => {
    const el  = document.getElementById('subtab-content-' + n);
    const btn = document.getElementById('subtab-' + n);
    if (el)  el.style.display = n === name ? '' : 'none';
    if (btn) btn.classList.toggle('active', n === name);
  });
  if (name === 'chat') setTimeout(() => document.getElementById('chat-input')?.focus(), 120);
}

/* ── Chat chips ──────────────────────────────────────────────────────────── */
function usechip(btn) {
  usechipText(btn.textContent);
}
function usechipText(text) {
  const inp = document.getElementById('chat-input');
  if (!inp) return;
  inp.value = text;
  const chips = document.getElementById('chat-chips');
  if (chips) chips.style.display = 'none';
  const emptyCats = document.getElementById('chat-empty-cats');
  if (emptyCats) emptyCats.style.display = 'none';
  sendMessage();
}
window.usechipText = usechipText;

/* ── Partners ────────────────────────────────────────────────────────────── */
// Сохраняем полный список для модала
let _allPartners = [];

function renderPartnerCard(p) {
  const name = (p.name || '').replace(/</g,'&lt;');
  const desc = (p.desc || '').replace(/</g,'&lt;');
  const perk = (p.perk || '').replace(/</g,'&lt;');
  const url = p.url ? String(p.url).replace(/"/g, '&quot;') : '';
  const logoSrc = p.logo_url || '';
  const logoHtml = logoSrc
    ? `<img class="pcard__logo-img" src="${logoSrc.replace(/"/g,'&quot;')}" alt="" loading="lazy" onerror="this.style.display='none';this.parentElement.textContent='${p.emoji || '🎁'}'"/>`
    : `${p.emoji || '🎁'}`;
  return `
    <div class="pcard">
      <div class="pcard__logo">${logoHtml}</div>
      <div class="pcard__info">
        <div class="pcard__row">
          <div class="pcard__name">${name}</div>
          ${perk ? `<div class="pcard__badge">${perk}</div>` : ''}
        </div>
        <div class="pcard__desc">${desc}</div>
        ${url ? `<a class="pcard__btn" href="${url}" target="_blank" rel="noopener" data-haptic="light" onclick="window.Telegram?.WebApp?.openLink?.('${url}');event.preventDefault?.()">Перейти на сайт →</a>` : ''}
      </div>
    </div>`;
}

function renderPartners(list) {
  _allPartners = list || [];
  const el = document.getElementById('partners-list');
  const all = document.getElementById('partners-show-all');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<p style="text-align:center;color:var(--muted);padding:20px">Партнёры скоро появятся</p>';
    if (all) all.style.display = 'none';
    return;
  }
  // Preview: показываем первые 4
  const PREVIEW = 4;
  const preview = list.slice(0, PREVIEW);
  el.innerHTML = preview.map(renderPartnerCard).join('');
  if (all) {
    if (list.length > PREVIEW) {
      all.style.display = '';
      all.textContent = `Все партнёры (${list.length}) →`;
    } else {
      all.style.display = 'none';
    }
  }
}

// Modal со всеми партнёрами
function openPartnersModal() {
  let modal = document.getElementById('partners-all-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'partners-all-modal';
    modal.className = 'cat-modal';
    modal.style.display = 'none';
    modal.onclick = (e) => { if (e.target === modal) closePartnersModal(); };
    modal.innerHTML = `
      <div class="cat-modal__sheet">
        <button class="cat-modal__close" onclick="closePartnersModal()">×</button>
        <div class="partners-modal__h">Партнёры клуба</div>
        <p class="section-desc" style="text-align:center;padding-bottom:12px">По карте «Мария для своих» — привилегии у наших партнёров</p>
        <div class="partners-modal__list" id="partners-modal-list"></div>
      </div>`;
    document.body.appendChild(modal);
  }
  const list = modal.querySelector('#partners-modal-list');
  if (list) list.innerHTML = _allPartners.map(renderPartnerCard).join('');
  modal.style.display = 'flex';
  window.scrollLock?.();
}
window.openPartnersModal = openPartnersModal;
function closePartnersModal() {
  const m = document.getElementById('partners-all-modal');
  if (m) m.style.display = 'none';
  window.scrollUnlock?.();
}
window.closePartnersModal = closePartnersModal;

async function loadPartners() {
  try {
    const res = await fetch('/api/partners', { cache: 'no-store' });
    const data = await res.json();
    renderPartners(data.partners || []);
  } catch {
    renderPartners([]);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadPartners();
  loadCakeOfMonth();
  loadHomeHits();
  loadHomePersona();
});

// Persona block для verified юзера — приветствие + статистика + последний заказ
async function loadHomePersona() {
  const personaEl = document.getElementById('home-persona');
  if (!personaEl) return;
  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || '';
  if (!initData) { personaEl.style.display = 'none'; return; }
  try {
    // /api/me для базовой инфы
    const meRes = await fetch('/api/me', { headers: { Authorization: 'tma ' + initData } });
    if (!meRes.ok) { personaEl.style.display = 'none'; return; }
    const me = await meRes.json();
    if (!me.phoneVerified) { personaEl.style.display = 'none'; return; }

    // /api/lk для баланса и заказов
    const lkRes = await fetch('/api/lk', { headers: { Authorization: 'tma ' + initData } });
    const lkData = lkRes.ok ? await lkRes.json() : { data: {} };
    const lk = lkData?.data || {};

    // Greeting
    const name = me.user?.first_name || 'Друг';
    const hiEl = document.getElementById('home-persona-hi');
    if (hiEl) hiEl.textContent = `Привет, ${name}!`;

    // Stat row под именем
    const statEl = document.getElementById('home-persona-stat');
    if (statEl) {
      const parts = [];
      if (lk.balance > 0) parts.push(`${Number(lk.balance).toLocaleString('ru-RU')} баллов`);
      if (lk.tickets_count > 0) parts.push(`${lk.tickets_count} билет${lk.tickets_count === 1 ? '' : (lk.tickets_count < 5 ? 'а' : 'ов')}`);
      statEl.textContent = parts.join(' · ') || 'Участник клуба';
    }

    // Level chip
    const chipEl = document.getElementById('home-persona-chip');
    if (chipEl && window.getCurrentLevel) {
      const cur = window.getCurrentLevel(Number(lk.year_spent || 0), lk.level || null);
      chipEl.textContent = `${cur.name} · ${cur.pct}%`;
    }

    // Last order для re-order
    const orders = Array.isArray(lk.orders) ? lk.orders : [];
    const lastValid = orders.find((o) => !o.canceled && Array.isArray(o.items) && o.items.length > 0);
    const reorderEl = document.getElementById('home-persona-reorder');
    const itemsEl = document.getElementById('home-persona-reorder-items');
    if (lastValid && reorderEl && itemsEl) {
      const itemsTxt = lastValid.items.slice(0, 2).map((i) => `${i.qty}× ${i.name}`).join(', ');
      const more = lastValid.items.length > 2 ? ` +${lastValid.items.length - 2}` : '';
      itemsEl.textContent = itemsTxt + more;
      reorderEl.style.display = '';
      // Сохраняем last order глобально для profReorderLast (из profile.js)
      window._profileLastOrder = lastValid;
    }

    personaEl.style.display = '';
  } catch (e) {
    console.error('[home-persona]', e);
    personaEl.style.display = 'none';
  }
}
window.loadHomePersona = loadHomePersona;

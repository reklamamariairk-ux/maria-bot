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
  document.body.style.overflow = 'hidden';
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
  document.body.style.overflow = '';
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
function openAiChat() {
  const m = document.getElementById('ai-chat-modal');
  if (!m) return;
  m.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  window.tgBack?.show(() => closeAiChat());
  setTimeout(() => document.getElementById('chat-input')?.focus(), 200);
  // Прокрутка к низу истории
  setTimeout(() => {
    const wrap = document.getElementById('chat-messages');
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
  }, 50);
}
function closeAiChat() {
  const m = document.getElementById('ai-chat-modal');
  if (m) m.style.display = 'none';
  document.body.style.overflow = '';
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
    // Берём первый HIT-торт (Bitrix property HIT='Y' = «Наши предложения»)
    const candidates = all.filter(p => p.hit && p.image);
    if (candidates.length === 0) return;
    // Берём с самым свежим обновлением (или первого если SORT)
    const c = candidates[0];
    _cakeOfMonth = c;

    const card = document.getElementById('promo-cake-of-month');
    if (!card) return;
    const nm = document.getElementById('promo-cake-name');
    const ds = document.getElementById('promo-cake-desc');
    if (nm) nm.textContent = c.name;
    if (ds) {
      const cleaned = (c.preview || '').replace(/\s+/g, ' ').trim();
      ds.textContent = cleaned
        ? (cleaned.length > 90 ? cleaned.substring(0, 88) + '…' : cleaned)
        : `Хит каталога — ${Number(c.priceNumber || c.price || 0).toLocaleString('ru-RU')} ₽`;
    }
    if (c.image) {
      const proxied = `/img?u=${encodeURIComponent(c.image)}`;
      card.style.backgroundImage = `linear-gradient(180deg,rgba(214,31,55,.62) 0%,rgba(160,0,30,.95) 100%),url('${proxied}')`;
      card.style.backgroundSize = 'cover';
      card.style.backgroundPosition = 'center';
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
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nb').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name)?.classList.add('active');
  const navBtn = document.getElementById('nav-' + name);
  navBtn?.classList.add('active');
  positionNavPill(navBtn);
  // FAB AI-чата теперь виден на ВСЕХ вкладках (модал поверх)
  const fab = document.getElementById('fab-ai');
  if (fab) fab.style.display = '';
  if (name === 'fun' && !window._gamesInited) {
    window._gamesInited = true;
    initMemory();
    flappyInit();
    // Пекарня — по умолчанию открыта первой
    if (typeof hkBoot === 'function') {
      try { hkBoot(); } catch (e) { console.error('[hkBoot]', e); }
    }
  }
  if (window.Telegram?.WebApp?.HapticFeedback?.selectionChanged) {
    window.Telegram.WebApp.HapticFeedback.selectionChanged();
  }
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

/* ── Sub-tabs ────────────────────────────────────────────────────────────── */
function showSubTab(name) {
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
  const inp = document.getElementById('chat-input');
  if (!inp) return;
  inp.value = btn.textContent;
  document.getElementById('chat-chips').style.display = 'none';
  sendMessage();
}

/* ── Partners ────────────────────────────────────────────────────────────── */
function renderPartners(list) {
  const el = document.getElementById('partners-list');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<p style="text-align:center;color:var(--muted);padding:20px">Партнёры скоро появятся</p>';
    return;
  }
  el.innerHTML = list.map(p => `
    <div class="pcard">
      <div class="pcard__logo">${p.emoji}</div>
      <div class="pcard__info">
        <div class="pcard__name">${p.name}</div>
        <div class="pcard__desc">${(p.desc || '').replace(/</g,'&lt;')}</div>
      </div>
      <div class="pcard__badge">${p.perk}</div>
    </div>`).join('');
}

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
});

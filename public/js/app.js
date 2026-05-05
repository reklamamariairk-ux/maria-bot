/* ── Telegram ────────────────────────────────────────────────────────────── */
const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

function openSite(url) {
  if (tg) tg.openLink(url);
  else window.open(url, '_blank');
}

/* ── Магазины (модалка адресов) ─────────────────────────────────────────── */
function openShopsModal() {
  const m = document.getElementById('shops-modal');
  if (!m) return;
  m.style.display = 'flex';
  document.body.style.overflow = 'hidden';
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

/* ── AI чат — плавающая кнопка ─────────────────────────────────────────── */
function openAiChat() {
  switchTab('fun');
  showSubTab('chat');
  setTimeout(() => document.getElementById('chat-input')?.focus(), 200);
}
window.openAiChat = openAiChat;

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
    if (ds) ds.textContent = c.preview
      ? (c.preview.length > 90 ? c.preview.substring(0, 88) + '…' : c.preview)
      : `Хит каталога — ${Number(c.priceNumber || c.price || 0).toLocaleString('ru-RU')} ₽`;
    if (c.image) {
      card.style.backgroundImage = `linear-gradient(180deg,rgba(214,31,55,.62) 0%,rgba(160,0,30,.95) 100%),url('${c.image}')`;
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

/* ── Tabs ────────────────────────────────────────────────────────────────── */
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nb').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name)?.classList.add('active');
  const navBtn = document.getElementById('nav-' + name);
  navBtn?.classList.add('active');
  positionNavPill(navBtn);
  // FAB — скрыть на вкладке «Игры/Чат» (там сам чат)
  const fab = document.getElementById('fab-ai');
  if (fab) fab.style.display = name === 'fun' ? 'none' : '';
  if (name === 'fun' && !window._gamesInited) {
    window._gamesInited = true;
    initMemory();
    flappyInit();
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
});

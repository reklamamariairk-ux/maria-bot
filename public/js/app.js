/* ── Telegram ────────────────────────────────────────────────────────────── */
const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

function openSite(url) {
  if (tg) tg.openLink(url);
  else window.open(url, '_blank');
}

/* ── AI чат — плавающая кнопка ─────────────────────────────────────────── */
function openAiChat() {
  switchTab('fun');
  showSubTab('chat');
  setTimeout(() => document.getElementById('chat-input')?.focus(), 200);
}
window.openAiChat = openAiChat;

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

document.addEventListener('DOMContentLoaded', loadPartners);

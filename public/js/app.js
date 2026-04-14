/* ─── Telegram WebApp ───────────────────────────────────────────────────── */
const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

function openSite(url) {
  if (tg) {
    tg.openLink(url);
  } else {
    window.open(url, '_blank');
  }
}

/* ─── Tab switching ─────────────────────────────────────────────────────── */
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  const tab = document.getElementById('tab-' + name);
  const btn = document.getElementById('nav-' + name);
  if (tab) tab.classList.add('active');
  if (btn) btn.classList.add('active');

  if (name === 'fun' && !window._gamesInited) {
    window._gamesInited = true;
    initMemory();
  }
  window.scrollTo(0, 0);
}

/* ─── Sub-tabs (inside Fun tab) ─────────────────────────────────────────── */
function showSubTab(name) {
  ['games', 'chat'].forEach(n => {
    const el = document.getElementById('subtab-content-' + n);
    const btn = document.getElementById('subtab-' + n);
    if (el)  el.style.display  = n === name ? '' : 'none';
    if (btn) btn.classList.toggle('active', n === name);
  });
  if (name === 'chat') {
    setTimeout(() => document.getElementById('chat-input')?.focus(), 100);
  }
}

/* ─── Suggestion chips ──────────────────────────────────────────────────── */
function sendSuggestion(btn) {
  const input = document.getElementById('chat-input');
  if (!input) return;
  input.value = btn.textContent;
  btn.parentElement?.classList.add('hidden-suggestions');
  sendMessage();
}

/* ─── Partners (вызывается когда данные придут от владельца) ────────────── */
function renderPartners(partners) {
  const container = document.getElementById('partners-list');
  if (!container || !partners?.length) return;
  container.innerHTML = partners.map(p => `
    <div class="partner-card">
      <div class="partner-logo">${p.emoji || '🤝'}</div>
      <div class="partner-info">
        <div class="partner-name">${p.name}</div>
        <div class="partner-desc">${p.desc}</div>
      </div>
      <div class="partner-badge">${p.perk}</div>
    </div>
  `).join('');
}

/* ─── Init ──────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // Скрываем suggestion-bar после первого сообщения пользователя
  const suggestions = document.querySelector('.chat-suggestions');
  if (suggestions) {
    document.getElementById('chat-send')?.addEventListener('click', () => {
      setTimeout(() => suggestions.style.display = 'none', 300);
    });
  }
});

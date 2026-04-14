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

/* ─── Partners data ─────────────────────────────────────────────────────── */
const PARTNERS = [
  {
    emoji: '🔬',
    name: 'Лука Лаб',
    desc: 'Комплексная программа «ЧЕК АП от ЛукаЛаб» — лабораторная диагностика.\nСпециальная стоимость для клуба: 6 200 ₽ (вместо 9 539 ₽)\n⏳ До 31 мая 2026 г.',
    perk: '−35%',
  },
  {
    emoji: '✨',
    name: 'Деница',
    desc: 'Процедуры на аппарате ENDYMED — выгода от 7 500 до 16 000 ₽.\nЭксклюзивно для клуба «Мария для своих». При переходе к администратору — 3 варианта процедур.\n⏳ До 31 мая 2026 г.',
    perk: 'до −16 000 ₽',
  },
  {
    emoji: '💅',
    name: 'Гардо',
    desc: 'При записи на маникюр и педикюр — оформление и окрашивание бровей в подарок!\nСпециально для клуба «Мария для своих».\n⏳ До 31 мая 2026 г.',
    perk: '🎁 Брови',
  },
  {
    emoji: '🍣',
    name: 'Пряников',
    desc: 'При заказе на 1 600 ₽ — ролл «Филадельфия Фреш» в подарок!\nПромокод: «Вкус». Для клуба «Мария для своих».\n⏳ До 31 мая 2026 г.',
    perk: '🎁 Ролл',
  },
  {
    emoji: '🔧',
    name: 'СТО Просто',
    desc: 'Замена масла и масляного фильтра — работа бесплатно (обычная стоимость 1 450 ₽).\n* Запасные части и расходные материалы — по стоимости подрядчика.',
    perk: '−1 450 ₽',
  },
  {
    emoji: '🏨',
    name: 'Азатай',
    desc: 'Скидка на проживание для участников клуба «Мария для своих».',
    perk: '−10%',
  },
  {
    emoji: '🥊',
    name: 'Real Victory',
    desc: 'Скидка для участников клуба «Мария для своих» в понедельник–пятницу.',
    perk: '−30% пн–пт',
  },
  {
    emoji: '🌲',
    name: 'Тайга',
    desc: 'Постоянная скидка на номера, а также на сауну или хаммам (до 17:00).',
    perk: 'Номера −15%, сауна −10%',
  },
];

/* ─── Init ──────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  renderPartners(PARTNERS);

  const suggestions = document.querySelector('.chat-suggestions');
  if (suggestions) {
    document.getElementById('chat-send')?.addEventListener('click', () => {
      setTimeout(() => suggestions.style.display = 'none', 300);
    });
  }
});

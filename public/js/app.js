/* ── Telegram ────────────────────────────────────────────────────────────── */
const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

function openSite(url) {
  if (tg) tg.openLink(url);
  else window.open(url, '_blank');
}

/* ── Tabs ────────────────────────────────────────────────────────────────── */
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nb').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name)?.classList.add('active');
  const navBtn = document.getElementById('nav-' + name);
  navBtn?.classList.add('active');
  positionNavPill(navBtn);
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
const PARTNERS = [
  { emoji:'🔬', name:'Лука Лаб',     perk:'−35%',           desc:'Комплексная программа «ЧЕК АП от ЛукаЛаб»\nСтоимость для клуба: 6 200 ₽ (вместо 9 539 ₽)' },
  { emoji:'✨', name:'Деница',        perk:'до −16 000 ₽',   desc:'Процедуры на аппарате ENDYMED\nЭксклюзивно для клуба «Мария для своих»' },
  { emoji:'💅', name:'Гардо',         perk:'🎁 Брови',        desc:'При записи на маникюр и педикюр — оформление и окрашивание бровей в подарок' },
  { emoji:'🍣', name:'Пряников',      perk:'🎁 Ролл',         desc:'При заказе от 1 600 ₽ — ролл «Филадельфия Фреш» в подарок\nПромокод: «Вкус»' },
  { emoji:'🔧', name:'СТО Просто',   perk:'−1 450 ₽',        desc:'Замена масла и масляного фильтра — работа бесплатно\n* Запчасти по стоимости подрядчика' },
  { emoji:'🏨', name:'Азатай',        perk:'−10%',            desc:'Скидка на проживание для участников клуба' },
  { emoji:'🥊', name:'Real Victory', perk:'−30% пн–пт',      desc:'Скидка для участников клуба «Мария для своих» в будние дни' },
  { emoji:'🌲', name:'Тайга',         perk:'−15% / −10%',    desc:'Постоянная скидка на номера, сауну или хаммам (до 17:00)' },
];

function renderPartners(list) {
  const el = document.getElementById('partners-list');
  if (!el) return;
  el.innerHTML = list.map(p => `
    <div class="pcard">
      <div class="pcard__logo">${p.emoji}</div>
      <div class="pcard__info">
        <div class="pcard__name">${p.name}</div>
        <div class="pcard__desc">${p.desc}</div>
      </div>
      <div class="pcard__badge">${p.perk}</div>
    </div>`).join('');
}

document.addEventListener('DOMContentLoaded', () => renderPartners(PARTNERS));

/* ── Гид по подаркам — wizard «кому → событие → бюджет → варианты» ──── */

const GW_STATE = {
  step: 1,            // 1..4 + 5 (результат)
  recipient: '',      // 'child' | 'woman' | 'man' | 'group' | 'self'
  occasion: '',       // 'birthday' | 'wedding' | 'corporate' | 'thanks' | 'just'
  budget: '',         // '0-1000' | '1000-3000' | '3000-5000' | '5000+'
  diet: [],           // диета-теги
  results: [],
};

// Опции для каждого шага. recipientHints — список ключевых слов,
// который мы сопоставляем с whom[] и cake_type[] товаров.
const GW_RECIPIENTS = [
  { key: 'child',  emoji: '🧒', label: 'Ребёнку',            hints: ['ребёнок', 'детям', 'детск', 'мальчик', 'девочк'] },
  { key: 'woman',  emoji: '👩',  label: 'Женщине',            hints: ['женщин', 'девушк', 'маме', 'жене', 'подруге'] },
  { key: 'man',    emoji: '👨',  label: 'Мужчине',            hints: ['мужчин', 'муж', 'папе', 'брату', 'другу'] },
  { key: 'group',  emoji: '👨‍👩‍👧',  label: 'Компании / семье',    hints: ['компани', 'семь', 'гост'] },
  { key: 'self',   emoji: '😋', label: 'Себе',               hints: [] },
];

const GW_OCCASIONS = [
  { key: 'birthday',  emoji: '🎂', label: 'День рождения',     hints: ['день рожден', 'др', 'рожден'] },
  { key: 'wedding',   emoji: '💍', label: 'Свадьба / юбилей',  hints: ['свадьб', 'юбилей'] },
  { key: 'corporate', emoji: '🏢', label: 'Корпоратив / коллегам', hints: ['корпорат', 'коллег', 'офис'] },
  { key: 'thanks',    emoji: '🤝', label: 'Благодарность',     hints: ['благодарн', 'спасибо', 'подарок'] },
  { key: 'just',      emoji: '☕', label: 'Просто так / к чаю', hints: ['к чаю', 'чай', 'кофе'] },
];

const GW_BUDGETS = [
  { key: '0-1000',     label: 'до 1 000 ₽',    min: 0,    max: 1000 },
  { key: '1000-3000',  label: '1 — 3 000 ₽',  min: 1000, max: 3000 },
  { key: '3000-5000',  label: '3 — 5 000 ₽',  min: 3000, max: 5000 },
  { key: '5000+',      label: '5 000+ ₽',     min: 5000, max: Infinity },
];

const GW_DIETS = [
  { tag: 'sugar-free',   emoji: '🚫🍬', label: 'Без сахара' },
  { tag: 'gluten-free',  emoji: '🌾',   label: 'Без глютена' },
  { tag: 'vegan',        emoji: '🌱',   label: 'Веганский' },
  { tag: 'lactose-free', emoji: '🥛',   label: 'Без лактозы' },
  { tag: 'low-cal',      emoji: '⚡',   label: 'Лёгкий / ПП' },
  { tag: 'nut-free',     emoji: '🥜',   label: 'Без орехов' },
];

function openGiftWizard() {
  GW_STATE.step = 1;
  GW_STATE.recipient = '';
  GW_STATE.occasion = '';
  GW_STATE.budget = '';
  GW_STATE.diet = [];
  GW_STATE.results = [];
  ensureGiftWizardModal();
  renderGiftWizard();
  document.getElementById('gw-modal').style.display = 'flex';
  window.scrollLock?.();
  window.haptic?.('light');
}
window.openGiftWizard = openGiftWizard;

function closeGiftWizard() {
  const m = document.getElementById('gw-modal');
  if (m) m.style.display = 'none';
  window.scrollUnlock?.();
}
window.closeGiftWizard = closeGiftWizard;

function ensureGiftWizardModal() {
  if (document.getElementById('gw-modal')) return;
  const m = document.createElement('div');
  m.id = 'gw-modal';
  m.className = 'cat-modal';
  m.style.display = 'none';
  m.onclick = (e) => { if (e.target === m) closeGiftWizard(); };
  m.innerHTML = `
    <div class="cat-modal__sheet gw__sheet">
      <button class="cat-modal__close" onclick="closeGiftWizard()">×</button>
      <div class="gw__progress" id="gw-progress"></div>
      <div class="gw__body" id="gw-body"></div>
      <div class="gw__nav" id="gw-nav"></div>
    </div>`;
  document.body.appendChild(m);
}

function renderGiftWizard() {
  const totalSteps = 4;
  // Progress dots
  const prog = document.getElementById('gw-progress');
  if (prog) {
    let dots = '';
    for (let i = 1; i <= totalSteps; i++) {
      dots += `<span class="gw__dot ${i < GW_STATE.step ? 'gw__dot--done' : i === GW_STATE.step ? 'gw__dot--active' : ''}"></span>`;
    }
    prog.innerHTML = dots + (GW_STATE.step === 5 ? '' : `<span class="gw__step-num">${GW_STATE.step}/${totalSteps}</span>`);
  }
  const body = document.getElementById('gw-body');
  const nav  = document.getElementById('gw-nav');
  if (!body || !nav) return;

  switch (GW_STATE.step) {
    case 1: renderGwStep1(body); break;
    case 2: renderGwStep2(body); break;
    case 3: renderGwStep3(body); break;
    case 4: renderGwStep4(body); break;
    case 5: renderGwResults(body); break;
  }

  // Кнопки навигации
  if (GW_STATE.step === 5) {
    nav.innerHTML = `
      <button class="btn-outline" onclick="gwRestart()">↻ Заново</button>
      <button class="btn-full" onclick="closeGiftWizard()">Закрыть</button>`;
    return;
  }
  const backBtn = GW_STATE.step > 1
    ? `<button class="btn-outline" onclick="gwBack()">← Назад</button>`
    : `<button class="btn-outline" onclick="closeGiftWizard()">Отмена</button>`;
  // На шаге 4 (диета) — необязательный, поэтому Next всегда активен
  const canNext = GW_STATE.step === 4
    ? true
    : (GW_STATE.step === 1 ? !!GW_STATE.recipient
      : GW_STATE.step === 2 ? !!GW_STATE.occasion
      : GW_STATE.step === 3 ? !!GW_STATE.budget : false);
  const nextLabel = GW_STATE.step === 4 ? 'Показать варианты →' : 'Далее →';
  nav.innerHTML = `
    ${backBtn}
    <button class="btn-full" onclick="gwNext()" ${canNext ? '' : 'disabled'}>${nextLabel}</button>`;
}

function renderGwStep1(body) {
  body.innerHTML = `
    <div class="gw__h">Кому подарок?</div>
    <div class="gw__grid">
      ${GW_RECIPIENTS.map((r) => `
        <button class="gw__opt ${GW_STATE.recipient === r.key ? 'gw__opt--on' : ''}"
                data-haptic="selection" onclick="gwPick('recipient','${r.key}')">
          <div class="gw__opt-emoji">${r.emoji}</div>
          <div class="gw__opt-lbl">${r.label}</div>
        </button>`).join('')}
    </div>`;
}

function renderGwStep2(body) {
  body.innerHTML = `
    <div class="gw__h">По какому поводу?</div>
    <div class="gw__grid">
      ${GW_OCCASIONS.map((o) => `
        <button class="gw__opt ${GW_STATE.occasion === o.key ? 'gw__opt--on' : ''}"
                data-haptic="selection" onclick="gwPick('occasion','${o.key}')">
          <div class="gw__opt-emoji">${o.emoji}</div>
          <div class="gw__opt-lbl">${o.label}</div>
        </button>`).join('')}
    </div>`;
}

function renderGwStep3(body) {
  body.innerHTML = `
    <div class="gw__h">Бюджет?</div>
    <div class="gw__list">
      ${GW_BUDGETS.map((b) => `
        <button class="gw__list-opt ${GW_STATE.budget === b.key ? 'gw__list-opt--on' : ''}"
                data-haptic="selection" onclick="gwPick('budget','${b.key}')">
          <span>${b.label}</span>
          ${GW_STATE.budget === b.key ? '<span class="gw__check">✓</span>' : ''}
        </button>`).join('')}
    </div>`;
}

function renderGwStep4(body) {
  body.innerHTML = `
    <div class="gw__h">Особые требования?</div>
    <div class="gw__sub">Необязательно — можно пропустить</div>
    <div class="gw__chips">
      ${GW_DIETS.map((d) => `
        <button class="gw__chip ${GW_STATE.diet.includes(d.tag) ? 'gw__chip--on' : ''}"
                data-haptic="selection" onclick="gwToggleDiet('${d.tag}')">${d.emoji} ${d.label}</button>`).join('')}
    </div>`;
}

function renderGwResults(body) {
  const results = GW_STATE.results;
  if (results.length === 0) {
    body.innerHTML = `
      <div class="rv-empty" style="padding:30px 16px">
        <div class="rv-empty__ic">🤷</div>
        <div class="rv-empty__h">Ничего идеального не нашлось</div>
        <div class="rv-empty__s">Попробуй сменить бюджет или убрать требования. Или загляни в полный каталог.</div>
        <div class="empty-state__cta" style="margin-top:12px">
          <button class="btn-outline" onclick="closeGiftWizard();switchTab('menu')">Открыть каталог</button>
        </div>
      </div>`;
    return;
  }
  body.innerHTML = `
    <div class="gw__h">Мои подсказки 🎯</div>
    <div class="gw__sub">Подобрали по твоим параметрам</div>
    <div class="gw__results">
      ${results.map((p, idx) => {
        const priceTxt = p.price || (p.priceNumber ? `${Number(p.priceNumber).toLocaleString('ru-RU')} ₽` : '');
        const imgEl = p.image
          ? `<img class="gw__res-img" src="/img?u=${encodeURIComponent(p.image)}" alt="${escapeAttr(p.name)}" loading="lazy">`
          : '<span class="gw__res-noimg">🍰</span>';
        const badge = idx === 0
          ? '<span class="gw__res-badge">⭐ Топ выбор</span>'
          : idx === 1
            ? '<span class="gw__res-badge gw__res-badge--alt">Вариант 2</span>'
            : '<span class="gw__res-badge gw__res-badge--alt">Вариант 3</span>';
        return `
          <div class="gw__res-card" onclick="catOpenProduct(${p.id})">
            ${imgEl}
            ${badge}
            <div class="gw__res-info">
              <div class="gw__res-name">${escapeHtml(p.name)}</div>
              <div class="gw__res-price">${escapeHtml(priceTxt)}</div>
            </div>
            <button class="gw__res-add" data-haptic="medium" onclick="event.stopPropagation();gwAddToCart(${p.id})">+ В корзину</button>
          </div>`;
      }).join('')}
    </div>`;
}

function gwPick(field, value) {
  GW_STATE[field] = value;
  renderGiftWizard();
  window.haptic?.('selection');
  // Авто-переход к следующему шагу через секунду (UX-чувствительный — без задержки UI ощущается как двойной клик)
  setTimeout(() => { if (GW_STATE.step < 4) gwNext(); }, 250);
}
window.gwPick = gwPick;

function gwToggleDiet(tag) {
  const idx = GW_STATE.diet.indexOf(tag);
  if (idx >= 0) GW_STATE.diet.splice(idx, 1);
  else GW_STATE.diet.push(tag);
  renderGiftWizard();
  window.haptic?.('selection');
}
window.gwToggleDiet = gwToggleDiet;

function gwBack() {
  if (GW_STATE.step > 1) {
    GW_STATE.step--;
    renderGiftWizard();
    window.haptic?.('light');
  }
}
window.gwBack = gwBack;

async function gwNext() {
  if (GW_STATE.step < 4) {
    GW_STATE.step++;
    renderGiftWizard();
    window.haptic?.('light');
    return;
  }
  // step === 4 → готовим результаты
  GW_STATE.step = 5;
  document.getElementById('gw-body').innerHTML = '<div class="cat-loading">Подбираем…</div>';
  document.getElementById('gw-nav').innerHTML = '';
  try {
    await computeGwResults();
  } catch (e) {
    console.error('[gw]', e);
    GW_STATE.results = [];
  }
  renderGiftWizard();
  window.haptic?.('success');
}
window.gwNext = gwNext;

function gwRestart() {
  GW_STATE.step = 1;
  GW_STATE.recipient = '';
  GW_STATE.occasion = '';
  GW_STATE.budget = '';
  GW_STATE.diet = [];
  GW_STATE.results = [];
  renderGiftWizard();
}
window.gwRestart = gwRestart;

async function computeGwResults() {
  // Подгружаем кандидатов: применяем diet-фильтр на сервере (он эффективнее),
  // остальное считаем здесь.
  const dietQs = GW_STATE.diet.length > 0 ? '&diet=' + encodeURIComponent(GW_STATE.diet.join(',')) : '';
  const budget = GW_BUDGETS.find((b) => b.key === GW_STATE.budget);
  const recipientHints = GW_RECIPIENTS.find((r) => r.key === GW_STATE.recipient)?.hints || [];
  const occasionHints  = GW_OCCASIONS.find((o) => o.key === GW_STATE.occasion)?.hints || [];

  // Берём широкий набор — все Торты + Наборы (типичные подарочные категории)
  // Также добавим Десерты при низком бюджете
  const categories = budget && budget.max < 2000 ? ['Торты', 'Пирожные и десерты', 'Наборы'] : ['Торты', 'Наборы'];
  const all = [];
  for (const cat of categories) {
    try {
      const r = await fetch(`/api/catalog/products?category=${encodeURIComponent(cat)}&limit=100${dietQs}`, { cache: 'no-store' });
      const d = await r.json();
      if (Array.isArray(d?.products)) all.push(...d.products);
    } catch {}
  }
  // Дедуп по id
  const byId = new Map();
  for (const p of all) if (p.id) byId.set(p.id, p);
  let pool = [...byId.values()];

  // Фильтр по бюджету
  if (budget) {
    pool = pool.filter((p) => {
      const price = Number(p.priceNumber) || 0;
      if (price === 0) return true; // не отсекаем товары без цены
      return price >= budget.min && price <= budget.max;
    });
  }

  // Скоринг
  const norm = (s) => String(s || '').toLowerCase();
  const containsAny = (text, hints) => hints.some((h) => text.includes(h));

  for (const p of pool) {
    const occText = norm([...(p.occasion || [])].join(' '));
    const whomText = norm([...(p.whom || [])].join(' '));
    const nameText = norm(p.name);
    const previewText = norm(p.preview || '');
    const allText = occText + ' ' + whomText + ' ' + nameText + ' ' + previewText;

    let score = 0;
    if (p.hit) score += 3;
    if (recipientHints.length > 0 && containsAny(allText, recipientHints)) score += 4;
    if (occasionHints.length > 0  && containsAny(allText, occasionHints))  score += 5;
    if (Array.isArray(p.dietary) && p.dietary.length > 0 && GW_STATE.diet.length > 0) score += 2;
    // Для бюджета «до 1000» предпочитаем дешевле; для «5000+» — наоборот
    if (budget) {
      const price = Number(p.priceNumber) || 0;
      if (budget.key === '0-1000' && price > 0 && price < 700) score += 2;
      if (budget.key === '5000+' && price > 5500) score += 2;
    }
    p._gwScore = score;
  }

  pool.sort((a, b) => (b._gwScore || 0) - (a._gwScore || 0) || (Number(b.hit) - Number(a.hit)));
  GW_STATE.results = pool.slice(0, 3);
}

function gwAddToCart(productId) {
  const p = GW_STATE.results.find((x) => x.id === productId);
  if (!p || !window.cartAdd) return;
  window.cartAdd({
    id: p.id,
    name: p.name,
    price: p.price || p.priceNumber || 0,
    image: p.image || null,
  });
  window.haptic?.('success');
  // Visual feedback
  if (typeof event !== 'undefined') {
    const btn = event.target;
    if (btn) { btn.textContent = '✓ Добавлено'; setTimeout(() => { btn.textContent = '+ В корзину'; }, 1500); }
  }
}
window.gwAddToCart = gwAddToCart;

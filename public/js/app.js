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
  // По умолчанию — обычный режим (поиск/заказ). openMashaConfessor() переключит на confessor.
  if (!window._chatModeOverride) window.setChatMode?.('cake');
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
        const lk = (await lkRes.json()) || {};
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

// Sweet Confessor — открыть чат с Машей в эмпатичном режиме «расскажи как день»
function openMashaConfessor() {
  // Переключаем чат-режим до открытия — следующий запрос пойдёт с mode='confessor'
  window._chatModeOverride = true;
  window.setChatMode?.('confessor');
  openAiChat();
  // снимаем override чтобы следующее «обычное» открытие чата вернулось к cake
  setTimeout(() => { window._chatModeOverride = false; }, 100);
  // Заменяем дефолтный welcome на конфессор-приветствие (только в этой сессии)
  const txt = document.getElementById('chat-welcome-text');
  if (txt) {
    const time = txt.querySelector('.msg__time')?.outerHTML || '';
    txt.innerHTML = `Привет 🌙 Я Маша. Расскажи, как у тебя день? Подберу что-то под настроение, а не просто торт.${time}`;
    txt.dataset.customized = '1';
  }
}
window.openMashaConfessor = openMashaConfessor;

function closeAiChat() {
  const m = document.getElementById('ai-chat-modal');
  if (m) m.style.display = 'none';
  document.body.classList.remove('chat-open');
  window.scrollUnlock?.();
  window.tgBack?.hide();
}
window.openAiChat = openAiChat;
window.closeAiChat = closeAiChat;

/* ── Торт месяца — динамика из каталога ───────────────────────────────────
   ВАЖНО: «Торт месяца» это товар из 1С с реальной скидкой (discountPercent > 0).
   Никаких «−20% статика» — % берётся из catalog. Если в 1С нет товара
   со скидкой — _cakeOfMonth остаётся null и все промо-блоки скрываются.
*/
let _cakeOfMonth = null;

/** Скрывает все промо-блоки «Торт месяца» когда в 1С нет товара со скидкой */
function hideCakeOfMonthBlocks() {
  document.getElementById('promo-strip')?.style.setProperty('display', 'none');
  document.getElementById('promo-cake-of-month')?.style.setProperty('display', 'none');
  // bento hero-карточка — если нет торта со скидкой, кликать некуда, скрываем
  document.querySelector('.bento-card--hero')?.style.setProperty('display', 'none');
}

/** Прописывает реальную скидку из 1С в захардкоженные надписи «−20%» */
function applyCakeOfMonthCopy(c) {
  const pct = Number(c.discountPercent);
  if (!pct || pct <= 0) { hideCakeOfMonthBlocks(); return; }
  // bento-card hero sub
  const bentoSub = document.querySelector('.bento-card--hero .bento-card__sub');
  if (bentoSub) bentoSub.textContent = `−${pct}% всю неделю`;
  // promo-strip
  const stripT = document.getElementById('promo-strip-t');
  if (stripT) stripT.textContent = `🎂 Торт месяца −${pct}%`;
  // promo card badge (текст внутри .promo__badge)
  const badge = document.querySelector('#promo-cake-of-month .promo__badge');
  if (badge) badge.textContent = `−${pct}%`;
  // Club benefits: «Торт месяца −X% ежедневно» (сохраняем галочку ✓)
  const benefit = document.getElementById('club-benefit-cake-of-month');
  if (benefit) benefit.innerHTML = `<span class="cb-tick">✓</span> Торт месяца −${pct}% ежедневно`;
}

async function loadCakeOfMonth() {
  try {
    const r = await fetch('/api/catalog/products?category=Торты&limit=80', {cache:'no-store'});
    const d = await r.json();
    const all = Array.isArray(d?.products) ? d.products : [];
    // Реальный «Торт месяца» = товар со скидкой из 1С. hit + фото — желательны.
    const withDiscount = all.filter(p => Number(p.discountPercent) > 0 && p.image);
    if (withDiscount.length === 0) { hideCakeOfMonthBlocks(); return; }
    // приоритет: hit + наибольшая скидка
    withDiscount.sort((a, b) => {
      if (a.hit !== b.hit) return a.hit ? -1 : 1;
      return Number(b.discountPercent) - Number(a.discountPercent);
    });
    const c = withDiscount[0];
    _cakeOfMonth = c;
    applyCakeOfMonthCopy(c);

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

/* ── Sticky promo banner ─────────────────────────────────────────────────── */
function showPromoStrip() {
  const dismissedAt = Number(localStorage.getItem('maria_promo_strip_hide') || 0);
  if (dismissedAt && (Date.now() - dismissedAt) < 24 * 60 * 60 * 1000) return;
  const strip = document.getElementById('promo-strip');
  if (!strip) return;
  // Countdown до конца месяца
  const now = new Date();
  const eom = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const daysLeft = Math.ceil((eom - now) / 86400000);
  const dayPlural = (n) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'день';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'дня';
    return 'дней';
  };
  const c = document.getElementById('promo-strip-c');
  if (c) c.textContent = `⏱ ещё ${daysLeft} ${dayPlural(daysLeft)}`;
  strip.style.display = '';
  strip.onclick = (e) => {
    if (e.target.classList?.contains('promo-strip__x')) return;
    switchTab('home');
    setTimeout(() => {
      document.getElementById('promo-cake-of-month')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  };
}
function promoStripDismiss(e) {
  e?.stopPropagation();
  localStorage.setItem('maria_promo_strip_hide', String(Date.now()));
  const strip = document.getElementById('promo-strip');
  if (strip) strip.style.display = 'none';
  window.haptic?.('selection');
}
window.promoStripDismiss = promoStripDismiss;
window.showPromoStrip = showPromoStrip;

// Показываем после загрузки cake-of-month (с задержкой)
setTimeout(showPromoStrip, 2000);

/* ── Готовые наборы (preset bundles) ───────────────────────────────────── */
// Каждый bundle ищет товары в реальном каталоге по category + ключевым словам
const BUNDLE_CONFIG = {
  birthday: {
    title: 'На день рождения',
    items: [
      { category: 'Торты',                  matchAny: ['банан','шоколад','клубник','чизкейк'], qty: 1 },
      { category: 'Пирожные и десерты',     matchAny: ['эклер'],                                qty: 10 },
    ],
  },
  coffee: {
    title: 'Кофе-брейк',
    items: [
      { category: 'Пирожные и десерты',     matchAny: ['круассан','круасан'],                   qty: 5 },
      { category: 'Пирожные и десерты',     matchAny: ['печень','курабье','миндаль'],           qty: 3 },
    ],
  },
  gift: {
    title: 'Подарочный набор',
    items: [
      { category: 'Пирожные и десерты',     matchAny: ['макарон'],                              qty: 6 },
      { category: 'Пирожные и десерты',     matchAny: ['чизкейк','тарт'],                       qty: 1 },
    ],
  },
  mini: {
    title: 'На троих',
    items: [
      { category: 'Торты',                  matchAny: ['мини','небольш','компакт','маленьк'],   qty: 1 },
    ],
    fallback: { category: 'Торты',          matchAny: ['банан','шоколад'],                      qty: 1 },
  },
};

async function bundleAdd(key) {
  const cfg = BUNDLE_CONFIG[key];
  if (!cfg) return;
  // Подгружаем нужные категории
  const cats = [...new Set(cfg.items.map((x) => x.category))];
  const productPool = {};
  try {
    await Promise.all(cats.map(async (cat) => {
      const r = await fetch(`/api/catalog/products?category=${encodeURIComponent(cat)}&limit=80`, { cache: 'force-cache' });
      const d = await r.json();
      productPool[cat] = Array.isArray(d?.products) ? d.products : [];
    }));
  } catch (e) { console.error('[bundle]', e); }

  // Подбираем продукты для каждого слота
  const picked = [];
  for (const slot of cfg.items) {
    const pool = productPool[slot.category] || [];
    if (pool.length === 0) continue;
    let match = pool.find((p) => {
      const nm = (p.name || '').toLowerCase();
      return slot.matchAny.some((kw) => nm.includes(kw.toLowerCase()));
    });
    if (!match) match = pool[0]; // fallback: первый из категории
    if (match) picked.push({ ...match, _qty: slot.qty });
  }
  if (picked.length === 0) {
    if (cfg.fallback) {
      const pool = productPool[cfg.fallback.category] || [];
      const m = pool[0];
      if (m) picked.push({ ...m, _qty: cfg.fallback.qty });
    }
  }
  if (picked.length === 0) {
    window.haptic?.('error');
    alert('Не удалось собрать набор. Попробуй чуть позже.');
    return;
  }

  // Показываем preview-modal с возможностью «В корзину»
  showBundlePreview(cfg.title, picked);
}
window.bundleAdd = bundleAdd;

function showBundlePreview(title, items) {
  let modal = document.getElementById('bundle-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'bundle-modal';
    modal.className = 'cat-modal';
    modal.style.display = 'none';
    modal.onclick = (e) => { if (e.target === modal) bundleClose(); };
    document.body.appendChild(modal);
  }
  const total = items.reduce((s, it) => s + (Number(it.priceNumber || it.price) || 0) * it._qty, 0);
  const rows = items.map((it) => {
    const price = Number(it.priceNumber || it.price) || 0;
    const sum = price * it._qty;
    const img = it.image
      ? `<img src="/img?u=${encodeURIComponent(it.image)}" alt="" loading="lazy"/>`
      : `<span class="bundle-row__ph">🍰</span>`;
    return `
      <div class="bundle-row">
        <div class="bundle-row__img">${img}</div>
        <div class="bundle-row__body">
          <div class="bundle-row__name">${escAttrApp(it.name || '')}</div>
          <div class="bundle-row__meta">${it._qty} × ${price.toLocaleString('ru-RU')} ₽</div>
        </div>
        <div class="bundle-row__sum">${sum.toLocaleString('ru-RU')} ₽</div>
      </div>`;
  }).join('');
  modal.innerHTML = `
    <div class="cat-modal__sheet">
      <button class="cat-modal__close" onclick="bundleClose()">×</button>
      <div class="bundle-h">${escAttrApp(title)}</div>
      <div class="bundle-sub">Подобрано из текущего каталога</div>
      <div class="bundle-list">${rows}</div>
      <div class="bundle-total"><span>Итого:</span><b>${total.toLocaleString('ru-RU')} ₽</b></div>
      <button class="btn-full bundle-cta" onclick="bundleConfirm()">В корзину →</button>
    </div>`;
  modal.style.display = 'flex';
  window.scrollLock?.();
  window._currentBundle = items;
}

function bundleConfirm() {
  const items = window._currentBundle || [];
  if (items.length === 0) return;
  let added = 0;
  for (const it of items) {
    for (let i = 0; i < it._qty; i++) {
      window.cartAdd?.({ id: Number(it.id), name: it.name, price: Number(it.priceNumber || it.price) || 0, image: it.image });
      added++;
    }
  }
  bundleClose();
  if (added > 0) {
    window.haptic?.('success');
    setTimeout(() => window.cartOpen?.(), 200);
  }
}
window.bundleConfirm = bundleConfirm;

function bundleClose() {
  const m = document.getElementById('bundle-modal');
  if (m) m.style.display = 'none';
  window.scrollUnlock?.();
}
window.bundleClose = bundleClose;

function escAttrApp(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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
/* ── Stories viewer ──────────────────────────────────────────────────────── */
const STORIES_DATA = {
  promo: {
    emoji: '🎂',
    // title/sub проставляются динамически из _cakeOfMonth в renderStory()
    title: 'Торт месяца',
    sub: 'Загрузка…',
    ctaText: 'Заказать →',
    ctaAction: 'switchTab("menu");setTimeout(()=>catShowProducts?.("Торты"),200)',
  },
  sweet: {
    emoji: '📱',
    title: 'iPhone 17 Pro Max',
    sub: 'Каждый чек — билет в розыгрыш. Призы: MacBook, PS5, Apple Watch, JBL. Розыгрыш каждый квартал.',
    ctaText: 'Узнать про Сладкий чек',
    ctaAction: 'switchTab("club")',
  },
  club: {
    emoji: '💎',
    title: 'Кэшбэк до 10%',
    sub: 'Друзья 5% · Лучшие друзья 7% · Семья 10%. Оплачивай до 30% заказа баллами. День рождения −5% / −10% детям.',
    ctaText: 'Открыть клуб',
    ctaAction: 'switchTab("club")',
  },
  partners: {
    emoji: '🤝',
    title: '14 партнёров со скидками',
    sub: 'ЛукаЛаб −35% · Окулария −10% · Деница · Пряников и другие. Скидки для участников клуба.',
    ctaText: 'Посмотреть',
    ctaAction: 'switchTab("club");setTimeout(()=>document.querySelector(".club-partners")?.scrollIntoView({behavior:"smooth"}),300)',
  },
  cafes: {
    emoji: '🏬',
    title: '17 кафе по Иркутску',
    sub: 'Свежая выпечка каждый день. Заказ на самовывоз без доставки. Откуда удобно вам.',
    ctaText: 'Карта кафе',
    ctaAction: 'openShopsModal()',
  },
};
const STORIES_ORDER = ['promo','sweet','club','partners','cafes'];
let _storyIdx = 0;
let _storyTimer = null;

function openStory(key) {
  const idx = STORIES_ORDER.indexOf(key);
  if (idx < 0) return;
  _storyIdx = idx;
  let v = document.getElementById('story-viewer');
  if (!v) {
    v = document.createElement('div');
    v.id = 'story-viewer';
    v.className = 'story-viewer';
    v.innerHTML = `
      <div class="story-viewer__inner">
        <div class="story-viewer__bars" id="story-bars"></div>
        <button class="story-viewer__close" onclick="closeStory()">×</button>
        <div class="story-viewer__nav story-viewer__nav--prev" onclick="storyPrev()"></div>
        <div class="story-viewer__nav story-viewer__nav--next" onclick="storyNext()"></div>
        <div class="story-viewer__content" id="story-content"></div>
        <button class="story-viewer__cta" id="story-cta"></button>
      </div>`;
    document.body.appendChild(v);
  }
  v.style.display = 'flex';
  window.scrollLock?.();
  renderStory();
}
window.openStory = openStory;

function renderStory() {
  const data = STORIES_DATA[STORIES_ORDER[_storyIdx]];
  if (!data) return;
  const bars = document.getElementById('story-bars');
  if (bars) {
    bars.innerHTML = STORIES_ORDER.map((_, i) => {
      let cls = '';
      if (i < _storyIdx) cls = 'story-viewer__bar--done';
      else if (i === _storyIdx) cls = 'story-viewer__bar--active';
      return `<div class="story-viewer__bar ${cls}"><span class="story-viewer__bar-fill"></span></div>`;
    }).join('');
  }
  // Для promo story используем реальное фото торта месяца если есть
  const heroBlock = (STORIES_ORDER[_storyIdx] === 'promo' && _cakeOfMonth?.image)
    ? `<div class="story-viewer__photo" style="background-image:url('/img?u=${encodeURIComponent(_cakeOfMonth.image)}')"></div>`
    : `<div class="story-viewer__emoji">${data.emoji}</div>`;
  // Динамически подставим имя/цену/скидку из _cakeOfMonth (берётся из 1С)
  const isPromo = STORIES_ORDER[_storyIdx] === 'promo';
  const pct = Number(_cakeOfMonth?.discountPercent) || 0;
  const title = (isPromo && _cakeOfMonth?.name && pct > 0)
    ? `«${_cakeOfMonth.name}» со скидкой −${pct}%`
    : (isPromo && _cakeOfMonth?.name)
      ? _cakeOfMonth.name
      : data.title;
  const sub = (isPromo && _cakeOfMonth)
    ? `${(_cakeOfMonth.preview || '').slice(0, 80) || 'Хит каталога'} · ${Number(_cakeOfMonth.priceNumber || _cakeOfMonth.price || 0).toLocaleString('ru-RU')} ₽`
    : data.sub;
  document.getElementById('story-content').innerHTML = `
    ${heroBlock}
    <div class="story-viewer__title">${title}</div>
    <div class="story-viewer__sub">${sub}</div>`;
  const cta = document.getElementById('story-cta');
  cta.textContent = data.ctaText;
  cta.onclick = () => { closeStory(); setTimeout(() => { try { eval(data.ctaAction); } catch (e) { console.error(e); } }, 200); };
  // Auto-advance через 5 сек
  clearTimeout(_storyTimer);
  _storyTimer = setTimeout(() => storyNext(), 5000);
  // Force reflow для CSS animation
  requestAnimationFrame(() => bars?.querySelector('.story-viewer__bar--active .story-viewer__bar-fill')?.getBoundingClientRect());
}

function storyNext() {
  if (_storyIdx < STORIES_ORDER.length - 1) {
    _storyIdx++;
    renderStory();
  } else {
    closeStory();
  }
}
function storyPrev() {
  if (_storyIdx > 0) {
    _storyIdx--;
    renderStory();
  }
}
function closeStory() {
  const v = document.getElementById('story-viewer');
  if (v) v.style.display = 'none';
  clearTimeout(_storyTimer);
  window.scrollUnlock?.();
}
window.storyNext = storyNext;
window.storyPrev = storyPrev;
window.closeStory = closeStory;

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
  loadUpcomingHoliday();
  loadHomeClassics();
});

// ── Классика мамы — куратор-подбор ностальгических тортов ───────────────
const CLASSICS_NAMES = ['медовик', 'наполеон', 'птичье молоко', 'птичка', 'прага', 'зебра', 'сметанник', 'графские развалины', 'трюфель'];
const CLASSICS_STORY = `
<div class="classics-story">
  <div class="classics-story__lead">
    «Мария» начала с одной маленькой кондитерской в Иркутске в 1993 году. С первого дня —
    классические рецепты, ничего лишнего: натуральные сливки, мука высшего сорта,
    сгущёнка без сухого молока.
  </div>
  <div class="classics-story__h">Что сохранилось без изменений</div>
  <ul class="classics-story__list">
    <li><b>Медовик</b> — рецепт первого пекаря, медово-сметанные коржи, выпеченные индивидуально</li>
    <li><b>Зебра</b> — наш фирменный, светлые и тёмные слои, бестселлер 20+ лет</li>
    <li><b>Птичье молоко</b> — суфле на агар-агаре, как делали в советских ресторанах</li>
    <li><b>Наполеон</b> — слоёные коржи и заварной крем, без шортцатов</li>
    <li><b>Прага</b> — насыщенный шоколад с абрикосовой прослойкой</li>
  </ul>
  <div class="classics-story__foot">
    33 года в Иркутске · 17 кафе · 100 000+ клиентов клуба
  </div>
</div>`;

async function loadHomeClassics() {
  const wrap = document.getElementById('home-classics');
  if (!wrap) return;
  try {
    // Подгружаем категорию «Торты» и фильтруем по name match с CLASSICS_NAMES
    const r = await fetch('/api/catalog/products?category=Торты&limit=100', { cache: 'no-store' });
    const d = await r.json();
    const all = Array.isArray(d?.products) ? d.products : [];
    const classics = all.filter((p) => {
      const n = String(p.name || '').toLowerCase();
      return CLASSICS_NAMES.some((kw) => n.includes(kw));
    }).slice(0, 8);
    if (classics.length === 0) { wrap.style.display = 'none'; return; }
    wrap.innerHTML = classics.map((p) => {
      const priceTxt = p.price || (p.priceNumber ? `${Number(p.priceNumber).toLocaleString('ru-RU')} ₽` : '');
      const imgEl = p.image
        ? `<img class="hit-card__img" src="/img?u=${encodeURIComponent(p.image)}" alt="${escapeAttr(p.name)}" loading="lazy">`
        : '<span class="hit-card__noimg">🍰</span>';
      return `
        <div class="hit-card" data-haptic="light" onclick="haptic('light');catOpenProduct(${p.id})">
          ${imgEl}
          <div class="hit-card__name">${escapeHtml(p.name)}</div>
          <div class="hit-card__price">${escapeHtml(priceTxt)}</div>
        </div>`;
    }).join('');
    wrap.style.display = '';
  } catch (e) {
    console.error('[classics]', e);
    wrap.style.display = 'none';
  }
}
window.loadHomeClassics = loadHomeClassics;

function openClassicsStory() {
  let m = document.getElementById('classics-story-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'classics-story-modal';
    m.className = 'cat-modal';
    m.style.display = 'none';
    m.onclick = (e) => { if (e.target === m) closeClassicsStory(); };
    m.innerHTML = `
      <div class="cat-modal__sheet">
        <button class="cat-modal__close" onclick="closeClassicsStory()">×</button>
        <div class="classics-story__h-main">📖 Классика «Марии»</div>
        ${CLASSICS_STORY}
      </div>`;
    document.body.appendChild(m);
  }
  m.style.display = 'flex';
  window.scrollLock?.();
  window.haptic?.('light');
}
window.openClassicsStory = openClassicsStory;

function closeClassicsStory() {
  const m = document.getElementById('classics-story-modal');
  if (m) m.style.display = 'none';
  window.scrollUnlock?.();
}
window.closeClassicsStory = closeClassicsStory;

// ── Калькулятор порций ─────────────────────────────────────────────────────
// Грамм/гость для разных контекстов мероприятия (общепринятые ориентиры:
// «главное угощение» = тяжелее; «фуршет» = легче, потому что есть другая еда).
const PORTIONS_RATES = {
  main:    { adult: 150, kid: 100, hint: 'Если торт — гвоздь программы: 150 г/взрослый, 100 г/ребёнок' },
  dessert: { adult: 130, kid: 80,  hint: 'После основного стола: 130 г/взрослый, 80 г/ребёнок' },
  buffet:  { adult: 80,  kid: 60,  hint: 'На фуршете с другой едой: 80 г/взрослый, 60 г/ребёнок' },
};

const PORTIONS_STATE = {
  context: null, // 'order' (из формы заказа) | 'product' (из карточки торта) | null (справочно)
  adults: 6,
  kids: 0,
  ctx: 'dessert',
};

function pluralAdults(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'взрослый';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'взрослых';
  return 'взрослых';
}
function pluralKids(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'ребёнок';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'ребёнка';
  return 'детей';
}
function pluralPortions(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'порция';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'порции';
  return 'порций';
}

function openPortionsCalc(context) {
  PORTIONS_STATE.context = context || null;
  // При входе из формы «На заказ» — стартуем с уже введённого числа порций
  if (context === 'order') {
    const cur = Number(document.getElementById('of-portions')?.value || 0);
    if (cur > 0) { PORTIONS_STATE.adults = cur; PORTIONS_STATE.kids = 0; }
  }
  renderPortionsCalc();
  const m = document.getElementById('portions-modal');
  if (m) m.style.display = 'flex';
  window.haptic?.('light');
}
window.openPortionsCalc = openPortionsCalc;

function closePortionsCalc() {
  const m = document.getElementById('portions-modal');
  if (m) m.style.display = 'none';
}
window.closePortionsCalc = closePortionsCalc;

function portionsAdj(field, delta) {
  const max = field === 'adults' ? 100 : 50;
  PORTIONS_STATE[field] = Math.max(0, Math.min(max, (PORTIONS_STATE[field] || 0) + delta));
  renderPortionsCalc();
  window.haptic?.('selection');
}
window.portionsAdj = portionsAdj;

function portionsSetCtx(ctx) {
  if (!PORTIONS_RATES[ctx]) return;
  PORTIONS_STATE.ctx = ctx;
  renderPortionsCalc();
  window.haptic?.('selection');
}
window.portionsSetCtx = portionsSetCtx;

function portionsCalcWeight() {
  const r = PORTIONS_RATES[PORTIONS_STATE.ctx] || PORTIONS_RATES.dessert;
  const grams = PORTIONS_STATE.adults * r.adult + PORTIONS_STATE.kids * r.kid;
  return grams / 1000;
}

function renderPortionsCalc() {
  const ad = document.getElementById('portions-adults');
  const kd = document.getElementById('portions-kids');
  const wt = document.getElementById('portions-weight');
  const sm = document.getElementById('portions-summary');
  const hn = document.getElementById('portions-hint');
  if (!ad || !kd || !wt) return;
  ad.textContent = PORTIONS_STATE.adults;
  kd.textContent = PORTIONS_STATE.kids;
  document.querySelectorAll('#portions-modal .portions__chip').forEach((b) => {
    b.classList.toggle('portions__chip--on', b.dataset.ctx === PORTIONS_STATE.ctx);
  });
  const r = PORTIONS_RATES[PORTIONS_STATE.ctx] || PORTIONS_RATES.dessert;
  if (hn) hn.textContent = r.hint;
  const kg = portionsCalcWeight();
  // Округляем до 50 г (0.05 кг) — реалистичная гранулярность тортов в каталоге
  const rounded = Math.max(0.1, Math.round(kg * 20) / 20);
  // Формат: 1 / 1.5 / 1.05 — без хвостовых нулей
  wt.textContent = rounded % 1 === 0
    ? String(rounded)
    : rounded.toFixed(2).replace(/0$/, '').replace(/\.$/, '');
  // Summary
  const parts = [];
  if (PORTIONS_STATE.adults > 0) parts.push(`${PORTIONS_STATE.adults} ${pluralAdults(PORTIONS_STATE.adults)}`);
  if (PORTIONS_STATE.kids > 0)   parts.push(`${PORTIONS_STATE.kids} ${pluralKids(PORTIONS_STATE.kids)}`);
  if (sm) sm.textContent = parts.length ? 'для ' + parts.join(' + ') : 'выберите гостей';
  // CTA
  const cta = document.getElementById('portions-cta');
  if (cta) {
    const totalPpl = PORTIONS_STATE.adults + PORTIONS_STATE.kids;
    if (PORTIONS_STATE.context === 'order') {
      cta.textContent = totalPpl > 0
        ? `Применить · ${totalPpl} ${pluralPortions(totalPpl)} →`
        : 'Применить';
      cta.style.display = '';
      cta.disabled = totalPpl === 0;
    } else if (PORTIONS_STATE.context === 'product') {
      cta.textContent = 'Подобрать торт →';
      cta.style.display = '';
      cta.disabled = totalPpl === 0;
    } else {
      cta.style.display = 'none';
    }
  }
}

function portionsApply() {
  const totalPpl = PORTIONS_STATE.adults + PORTIONS_STATE.kids;
  if (totalPpl === 0) return;
  if (PORTIONS_STATE.context === 'order') {
    const inp = document.getElementById('of-portions');
    if (inp) {
      inp.value = totalPpl;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // Дописываем подсказку в комментарий, чтобы менеджер видел контекст
    const cmt = document.getElementById('of-comment');
    if (cmt) {
      const kg = portionsCalcWeight();
      const ctxLabel = { main: 'главное угощение', dessert: 'десерт после еды', buffet: 'фуршет' }[PORTIONS_STATE.ctx];
      const line = `📐 Калькулятор: ~${kg.toFixed(2).replace(/\.?0+$/, '')} кг (${PORTIONS_STATE.adults} взр + ${PORTIONS_STATE.kids} дет · ${ctxLabel})`;
      const existing = cmt.value.trim();
      // Не дублируем — заменяем старую строку калькулятора, если есть
      const cleaned = existing.split('\n').filter((l) => !l.startsWith('📐 Калькулятор:')).join('\n').trim();
      cmt.value = cleaned ? cleaned + '\n' + line : line;
    }
    window.haptic?.('success');
  } else if (PORTIONS_STATE.context === 'product') {
    // Открыть каталог тортов — юзер уже видел в модалке рекомендуемый вес,
    // пусть выберет подходящий из списка вручную. Фильтр по весу — отдельная задача.
    switchTab('menu');
    setTimeout(() => window.catShowProducts?.('Торты'), 200);
    window.haptic?.('success');
  }
  closePortionsCalc();
}
window.portionsApply = portionsApply;

// ── Ближайший праздник — карточка на главной с countdown ────────────────────
let _upcomingHoliday = null;
async function loadUpcomingHoliday() {
  const card = document.getElementById('promo-holiday');
  if (!card) return;
  try {
    const r = await fetch('/api/holidays/upcoming', { cache: 'no-store' });
    const d = await r.json();
    const h = d?.holiday;
    if (!h) { card.style.display = 'none'; return; }
    _upcomingHoliday = h;

    const nm = document.getElementById('promo-holiday-name');
    const cd = document.getElementById('promo-holiday-countdown');
    const ht = document.getElementById('promo-holiday-hint');
    const em = document.getElementById('promo-holiday-emoji');

    const dayPlural = (n) => {
      const m10 = n % 10, m100 = n % 100;
      if (m10 === 1 && m100 !== 11) return 'день';
      if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'дня';
      return 'дней';
    };
    if (nm) nm.textContent = `Скоро ${h.name}`;
    if (cd) cd.textContent = h.daysUntil === 0 ? 'сегодня' : `через ${h.daysUntil} ${dayPlural(h.daysUntil)}`;
    if (ht) ht.textContent = h.hint || 'Закажи заранее';
    if (em) em.textContent = h.emoji || '🎉';
    if (h.accent) card.style.setProperty('--holiday-accent', h.accent);
    card.style.display = '';
  } catch (e) {
    console.error('[holiday]', e);
    card.style.display = 'none';
  }
}
window.loadUpcomingHoliday = loadUpcomingHoliday;

function holidayOpenSelection() {
  haptic('light');
  if (!_upcomingHoliday) { switchTab('menu'); return; }
  switchTab('menu');
  // Через короткую паузу подставляем поисковый запрос в menu-search
  const q = _upcomingHoliday.searchQuery || _upcomingHoliday.name;
  setTimeout(() => {
    const inp = document.getElementById('menu-search');
    if (inp) {
      inp.value = q;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, 220);
}
window.holidayOpenSelection = holidayOpenSelection;

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
    const lk = lkRes.ok ? ((await lkRes.json()) || {}) : {};

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

    // Level chip + loyalty progress bar
    const chipEl = document.getElementById('home-persona-chip');
    if (chipEl && window.getCurrentLevel) {
      const yearSpent = Number(lk.year_spent || 0);
      const cur = window.getCurrentLevel(yearSpent, lk.level || null);
      chipEl.textContent = `${cur.name} · ${cur.pct}%`;
      const CLUB_LEVELS = window.CLUB_LEVELS || [];
      const idx = CLUB_LEVELS.findIndex((l) => l && l.name === cur?.name);
      const next = idx >= 0 ? CLUB_LEVELS[idx + 1] : null;
      const wrap   = document.getElementById('home-loyalty');
      const nameEl = document.getElementById('home-loyalty-name');
      const progEl = document.getElementById('home-loyalty-prog');
      const fillEl = document.getElementById('home-loyalty-fill');
      if (wrap) {
        wrap.style.display = '';
        if (nameEl) nameEl.textContent = `${cur.name} · кэшбэк ${cur.pct}%`;
        if (next) {
          const range = next.threshold - cur.threshold;
          const got   = Math.max(0, yearSpent - cur.threshold);
          const pct   = range > 0 ? Math.min(100, Math.max(2, Math.round(got / range * 100))) : 100;
          if (progEl) progEl.textContent = `до ${next.name}: ${Math.max(0, next.threshold - yearSpent).toLocaleString('ru-RU')} ₽`;
          if (fillEl) fillEl.style.width = pct + '%';
        } else {
          if (progEl) progEl.textContent = 'максимальный уровень';
          if (fillEl) fillEl.style.width = '100%';
        }
      }
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

/* Параллакс убран — конфликтовал с Ken Burns animation на hero__bg.
   Ken Burns (CSS keyframes) даёт достаточную cinematic motion. */

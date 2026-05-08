/* ── Catalog (Меню) ──────────────────────────────────────────────────────── */

const CATEGORY_ICONS = {
  'Торты':              '🎂',
  'Пироги':             '🥧',
  'Пирожные':           '🍰',
  'Пирожные и десерты': '🍰',
  'Наборы':             '🎁',
  'Торты на заказ':     '✨',
  'Для праздника':      '🎉',
  'Пасха':              '🐣',
  'Иркутск 1661':       '🏛',
  'Акции':              '🏷',
};

let CATALOG_STATE = {
  categories: [],
  loading: false,
  searchTimer: null,
  sort: 'default',     // default | price-asc | price-desc | popular
  priceMax: 0,         // 0 = без ограничения
  currentCategory: '', // для фильтрации повторно
  lastProducts: [],    // последний загруженный список
};

// Wishlist (избранное) — localStorage
const WISH_KEY = 'maria_wishlist_v1';
function wishLoad() {
  try { return JSON.parse(localStorage.getItem(WISH_KEY) || '[]'); }
  catch { return []; }
}
function wishSave(arr) {
  try { localStorage.setItem(WISH_KEY, JSON.stringify(arr)); } catch {}
}
function wishHas(id) {
  return wishLoad().includes(Number(id));
}
function wishToggle(id, btn) {
  const list = wishLoad();
  const n = Number(id);
  const idx = list.indexOf(n);
  if (idx >= 0) {
    list.splice(idx, 1);
    if (btn) btn.classList.remove('on');
    window.haptic?.('selection');
  } else {
    list.push(n);
    if (btn) btn.classList.add('on');
    window.haptic?.('success');
  }
  wishSave(list);
}
window.wishToggle = wishToggle;
window.wishHas = wishHas;

async function catLoadCategories() {
  if (CATALOG_STATE.loading) return;
  CATALOG_STATE.loading = true;
  try {
    const res = await fetch('/api/catalog/categories', { cache: 'no-store' });
    const data = await res.json();
    CATALOG_STATE.categories = data.categories || [];
    catRenderCategories();
    const updated = data.updated ? new Date(data.updated).toLocaleDateString('ru-RU') : '—';
    const status = document.getElementById('menu-status');
    if (status) status.textContent = `${data.total} позиций · обновлено ${updated}`;
  } catch (e) {
    console.error('[catalog]', e);
  }
  CATALOG_STATE.loading = false;
}

function catRenderCategories() {
  const wrap = document.getElementById('menu-categories');
  if (!wrap) return;
  // Скрываем fallback-категорию «Каталог» (товары без section_id) — их можно найти поиском
  const visible = CATALOG_STATE.categories.filter((c) => c.name !== 'Каталог' && c.count > 0);
  wrap.innerHTML = visible.map((c) => {
    const icon = CATEGORY_ICONS[c.name] || '🍮';
    const bg = c.sample
      ? `background-image:linear-gradient(180deg,rgba(255,255,255,.55) 0%,rgba(255,255,255,.92) 70%),url('${c.sample}');background-size:cover;background-position:center`
      : '';
    return `
      <button class="ccat" onclick="catShowProducts('${escapeAttr(c.name)}')" style="${bg}">
        <span class="ccat__ic">${icon}</span>
        <span class="ccat__name">${escapeHtml(c.name)}</span>
        <span class="ccat__count">${c.count}</span>
      </button>`;
  }).join('');
}

async function catShowProducts(category) {
  document.getElementById('menu-categories').style.display = 'none';
  document.getElementById('menu-products').style.display = '';
  document.getElementById('menu-bread').style.display = '';
  document.getElementById('menu-bread-name').textContent = category;
  document.getElementById('menu-empty').style.display = 'none';
  // Скрываем chip-фильтры в категории
  const chips = document.getElementById('menu-chips');
  if (chips) chips.style.display = 'none';
  CATALOG_STATE.currentCategory = category;

  const grid = document.getElementById('menu-products');
  // Skeleton loader — 6 placeholder-карточек
  grid.innerHTML = Array(6).fill(0).map(() => `
    <div class="pcard-pr-skel">
      <div class="pcard-pr-skel__img"></div>
      <div class="pcard-pr-skel__line pcard-pr-skel__line--w"></div>
      <div class="pcard-pr-skel__line pcard-pr-skel__line--n"></div>
    </div>`).join('');

  try {
    const res = await fetch('/api/catalog/products?category=' + encodeURIComponent(category) + '&limit=100');
    const data = await res.json();
    CATALOG_STATE.lastProducts = data.products || [];
    catRenderToolbarAndProducts();
  } catch {
    grid.innerHTML = '<div class="cat-empty">Не удалось загрузить. Попробуй позже.</div>';
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Применяем sort + price-фильтр к lastProducts и рендерим
function catRenderToolbarAndProducts() {
  let products = [...(CATALOG_STATE.lastProducts || [])];
  // Filter по цене
  if (CATALOG_STATE.priceMax > 0) {
    products = products.filter((p) => {
      const price = Number(p.priceNumber) || 0;
      return price > 0 && price <= CATALOG_STATE.priceMax;
    });
  }
  // Sort
  const s = CATALOG_STATE.sort;
  if (s === 'price-asc')  products.sort((a,b) => (a.priceNumber||0) - (b.priceNumber||0));
  if (s === 'price-desc') products.sort((a,b) => (b.priceNumber||0) - (a.priceNumber||0));
  if (s === 'popular')    products.sort((a,b) => Number(b.hit||0) - Number(a.hit||0));
  // Toolbar над сеткой
  const toolbar = catRenderToolbar(products.length);
  const grid = document.getElementById('menu-products');
  grid.innerHTML = toolbar + '<div class="cat-products-grid">' + catRenderProductsHtml(products) + '</div>';
  if (window.IconInflate) window.IconInflate(grid);
}

function catRenderToolbar(count) {
  const sortLabel = {
    'default':    'По умолчанию',
    'price-asc':  'Сначала дешевле',
    'price-desc': 'Сначала дороже',
    'popular':    'По популярности',
  }[CATALOG_STATE.sort] || 'По умолчанию';
  const priceLabel = CATALOG_STATE.priceMax > 0 ? `до ${CATALOG_STATE.priceMax.toLocaleString('ru-RU')} ₽` : 'Любая цена';
  return `
    <div class="cat-toolbar">
      <button class="cat-toolbar__btn" data-haptic="light" onclick="catSortMenu(this)">
        <span data-icon="sparkles" data-size="14"></span> ${sortLabel}
      </button>
      <button class="cat-toolbar__btn" data-haptic="light" onclick="catPriceMenu(this)">
        <span data-icon="coin" data-size="14"></span> ${priceLabel}
      </button>
      <span class="cat-toolbar__count">${count} ${count === 1 ? 'товар' : count < 5 ? 'товара' : 'товаров'}</span>
    </div>`;
}

function catSortMenu() {
  const opts = [
    ['default',    'По умолчанию'],
    ['price-asc',  'Сначала дешевле'],
    ['price-desc', 'Сначала дороже'],
    ['popular',    'По популярности'],
  ];
  const html = opts.map(([k, lb]) =>
    `<button class="popmenu__item${CATALOG_STATE.sort === k ? ' on' : ''}" onclick="catSetSort('${k}')">${lb}</button>`
  ).join('');
  catShowPopmenu('Сортировка', html);
}
function catSetSort(s) {
  CATALOG_STATE.sort = s;
  catClosePopmenu();
  catRenderToolbarAndProducts();
}
function catPriceMenu() {
  const opts = [
    [0,    'Любая цена'],
    [1000, 'до 1 000 ₽'],
    [2000, 'до 2 000 ₽'],
    [3000, 'до 3 000 ₽'],
    [5000, 'до 5 000 ₽'],
  ];
  const html = opts.map(([v, lb]) =>
    `<button class="popmenu__item${CATALOG_STATE.priceMax === v ? ' on' : ''}" onclick="catSetPriceMax(${v})">${lb}</button>`
  ).join('');
  catShowPopmenu('Цена', html);
}
function catSetPriceMax(v) {
  CATALOG_STATE.priceMax = v;
  catClosePopmenu();
  catRenderToolbarAndProducts();
}
function catShowPopmenu(title, innerHtml) {
  let m = document.getElementById('cat-popmenu');
  if (!m) {
    m = document.createElement('div');
    m.id = 'cat-popmenu';
    m.className = 'popmenu-overlay';
    m.onclick = (e) => { if (e.target === m) catClosePopmenu(); };
    document.body.appendChild(m);
  }
  m.innerHTML = `
    <div class="popmenu">
      <div class="popmenu__h">${title}</div>
      ${innerHtml}
    </div>`;
  m.style.display = 'flex';
}
function catClosePopmenu() {
  const m = document.getElementById('cat-popmenu');
  if (m) m.style.display = 'none';
}
window.catSortMenu = catSortMenu;
window.catPriceMenu = catPriceMenu;
window.catSetSort = catSetSort;
window.catSetPriceMax = catSetPriceMax;
window.catClosePopmenu = catClosePopmenu;

function catShowCategories() {
  document.getElementById('menu-categories').style.display = '';
  document.getElementById('menu-products').style.display = 'none';
  document.getElementById('menu-bread').style.display = 'none';
  document.getElementById('menu-empty').style.display = 'none';
  const chips = document.getElementById('menu-chips');
  if (chips) chips.style.display = '';
  const inp = document.getElementById('menu-search');
  if (inp) inp.value = '';
  const clear = document.getElementById('menu-search-clear');
  if (clear) clear.style.display = 'none';
  // Сбрасываем sort/filter
  CATALOG_STATE.sort = 'default';
  CATALOG_STATE.priceMax = 0;
  CATALOG_STATE.currentCategory = '';
}

function catRenderProducts(products) {
  // Используется search-flow (без toolbar)
  const wrap = document.getElementById('menu-products');
  if (!products.length) {
    const inp = document.getElementById('menu-search');
    const q = inp?.value?.trim() || '';
    wrap.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-state__ic"><span data-icon="search" data-size="28"></span></div>
        <div class="empty-state__h">${q ? 'Ничего не нашлось' : 'В этой категории пока пусто'}</div>
        <div class="empty-state__sub">${q ? `По запросу «${escapeHtml(q)}» товаров нет. Попробуй другой поиск.` : 'Загляни сюда позже — мы обновляем меню каждый день.'}</div>
        <div class="empty-state__cta">
          <button class="btn-outline" onclick="catShowCategories()">Все категории</button>
        </div>
      </div>`;
    document.getElementById('menu-empty').style.display = 'none';
    if (window.IconInflate) window.IconInflate(wrap);
    return;
  }
  document.getElementById('menu-empty').style.display = 'none';
  wrap.innerHTML = '<div class="cat-products-grid">' + catRenderProductsHtml(products) + '</div>';
  if (window.IconInflate) window.IconInflate(wrap);
  return;
}

function catRenderProductsHtml(products) {
  if (!products.length) return '';
  const wishList = wishLoad();
  return products.map((p, idx) => {
    const hasId = p.id != null && p.id > 0;
    const onClick = hasId
      ? `catOpenProduct(${p.id})`
      : `openSite('${escapeAttr(p.url || '')}')`;
    const priceNum = p.price ? parseInt(String(p.price).replace(/\D/g, ''), 10) : (p.priceNumber || 0);
    const priceTxt = p.price || (p.priceNumber ? `${Number(p.priceNumber).toLocaleString('ru-RU')} ₽` : '');
    const oldPriceTxt = p.oldPrice || (p.oldPriceNumber ? `${Number(p.oldPriceNumber).toLocaleString('ru-RU')} ₽` : '');
    const hasDiscount = p.discountPercent && p.discountPercent > 0;
    const hitBadge = hasDiscount
      ? `<span class="pcard-pr__hit pcard-pr__hit--sale">−${p.discountPercent}%</span>`
      : (p.hit ? '<span class="pcard-pr__hit">★ Хит</span>' : '');
    const weight   = p.weight ? `<span class="pcard-pr__w">${escapeHtml(p.weight)}</span>` : '';
    const addBtn = hasId && priceNum > 0
      ? `<button class="pcard-pr__add" aria-label="В корзину" onclick="event.stopPropagation();catQuickAdd(${p.id},this)">+</button>`
      : '';
    const wishBtn = hasId
      ? `<button class="pcard-pr__wish${wishList.includes(Number(p.id)) ? ' on' : ''}" aria-label="В избранное" onclick="event.stopPropagation();wishToggle(${p.id},this)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg></button>`
      : '';
    // Первые 6 — eager (видимы сразу), остальные — lazy
    const loading = idx < 6 ? 'eager' : 'lazy';
    const fetchpriority = idx < 4 ? 'high' : 'auto';
    const imgEl = p.image
      ? `<img class="pcard-pr__pic" src="/img?u=${encodeURIComponent(p.image)}" alt="${escapeAttr(p.name)}" loading="${loading}" decoding="async" fetchpriority="${fetchpriority}" onload="this.classList.add('loaded')" onerror="this.style.display='none'">`
      : '<span class="pcard-pr__noimg">🍰</span>';
    return `
      <div class="pcard-pr" onclick="${onClick}">
        <div class="pcard-pr__img">
          ${imgEl}
          ${hitBadge}
          ${wishBtn}
          ${addBtn}
        </div>
        <div class="pcard-pr__body">
          <div class="pcard-pr__name">${escapeHtml(p.name)}</div>
          ${weight}
          <div class="pcard-pr__row">
            <div class="pcard-pr__prices">
              <span class="pcard-pr__price">${escapeHtml(priceTxt)}</span>
              ${hasDiscount && oldPriceTxt ? `<span class="pcard-pr__old">${escapeHtml(oldPriceTxt)}</span>` : ''}
            </div>
            <span class="pcard-pr__cta">→</span>
          </div>
        </div>
      </div>`;
  }).join('');
}

async function catOpenProduct(id) {
  const modal = document.getElementById('cat-product-modal');
  const body  = document.getElementById('cat-product-body');
  if (!modal || !body) {
    return;
  }
  body.innerHTML = '<div class="cat-loading">Загружаем карточку…</div>';
  modal.style.display = 'flex';
  window.scrollLock?.();
  window.tgBack?.show(() => catCloseProduct());

  try {
    const res = await fetch('/api/catalog/product/' + encodeURIComponent(id));
    const data = await res.json();
    const p = data.product;
    if (!p) {
      body.innerHTML = '<div class="cat-empty">Товар не найден</div>';
      return;
    }

    const img = (p.images && p.images[0]) || p.image || '';
    const priceTxt = p.price ? `${Number(p.price).toLocaleString('ru-RU')} ₽` : '—';
    const oldPriceTxt = p.oldPrice ? `${Number(p.oldPrice).toLocaleString('ru-RU')} ₽` : '';
    const hasDiscount = p.discountPercent && p.discountPercent > 0;
    const desc = (p.description_text || p.preview || '').trim();
    const props = [];
    if (p.weight)  props.push(`<span><b>Вес:</b> ${escapeHtml(String(p.weight))}</span>`);
    if (p.persons) props.push(`<span><b>Персон:</b> ${escapeHtml(String(p.persons))}</span>`);
    const filling = (p.filling || []).join(', ');
    if (filling)   props.push(`<span><b>Начинка:</b> ${escapeHtml(filling)}</span>`);
    const types = [...(p.cake_type || []), ...(p.pie_type || []), ...(p.dessert_type || [])].join(', ');
    if (types)     props.push(`<span><b>Тип:</b> ${escapeHtml(types)}</span>`);

    body.innerHTML = `
      <button class="cat-modal__close" onclick="catCloseProduct()">×</button>
      <div class="cat-modal__hero">
        ${img ? `<img class="cat-modal__pic" src="/img?u=${encodeURIComponent(img)}" alt="${escapeAttr(p.name)}" loading="eager" decoding="async" fetchpriority="high">` : '<span class="pcard-pr__noimg" style="font-size:64px">🍰</span>'}
        ${p.hit ? '<span class="cat-modal__hit">★ Хит</span>' : ''}
      </div>
      <div class="cat-modal__title">${escapeHtml(p.name)}</div>
      <div class="cat-modal__price">
        ${escapeHtml(priceTxt)}
        ${hasDiscount && oldPriceTxt ? `<span class="cat-modal__old">${escapeHtml(oldPriceTxt)}</span> <span class="cat-modal__pct">−${p.discountPercent}%</span>` : ''}
      </div>
      ${props.length ? `<div class="cat-modal__props">${props.join('')}</div>` : ''}
      ${desc ? `<div class="cat-modal__desc">${escapeHtml(desc)}</div>` : ''}
      <div class="cat-modal__actions">
        <button class="btn-outline cat-modal__share" data-haptic="light" onclick="shareProduct(${p.id})" aria-label="Поделиться">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/></svg>
          Поделиться
        </button>
        <button class="btn-full" id="cat-modal-add">🛒 В корзину</button>
      </div>
    `;
    // Привязываем обработчик через addEventListener, чтобы не зависеть от inline-onclick (где нужно
    // экранировать ' " < > и т.п. в имени товара)
    const addBtn = document.getElementById('cat-modal-add');
    const productSnap = { id: p.id, name: p.name, price: p.price, image: img };
    if (addBtn) addBtn.onclick = () => { window.cartAdd?.(productSnap); catCloseProduct(); };
    // Нативная Telegram MainButton — для добавления в корзину одним тапом
    const priceLabel = p.price ? `Добавить в корзину · ${Number(p.price).toLocaleString('ru-RU')} ₽` : 'Добавить в корзину';
    window.tgMain?.show(priceLabel, () => {
      window.cartAdd?.(productSnap);
      catCloseProduct();
    });
  } catch (e) {
    body.innerHTML = '<div class="cat-empty">Ошибка загрузки</div>';
  }
}

function catCloseProduct() {
  const modal = document.getElementById('cat-product-modal');
  if (modal) modal.style.display = 'none';
  window.scrollUnlock?.();
  window.tgBack?.hide();
}

async function catSearch(query) {
  const q = (query || '').trim();
  if (!q) {
    catShowCategories();
    return;
  }
  document.getElementById('menu-categories').style.display = 'none';
  document.getElementById('menu-bread').style.display = 'none';
  document.getElementById('menu-products').style.display = '';
  document.getElementById('menu-empty').style.display = 'none';
  const wrap = document.getElementById('menu-products');
  wrap.innerHTML = '<div class="cat-loading">Ищем…</div>';

  try {
    const res = await fetch('/api/catalog/search?q=' + encodeURIComponent(q));
    const data = await res.json();
    catRenderProducts(data.products || []);
  } catch {
    wrap.innerHTML = '<div class="cat-empty">Ошибка поиска</div>';
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return String(s).replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', () => {
  const inp = document.getElementById('menu-search');
  const clear = document.getElementById('menu-search-clear');
  if (inp) {
    inp.addEventListener('input', () => {
      clearTimeout(CATALOG_STATE.searchTimer);
      const v = inp.value;
      clear.style.display = v ? '' : 'none';
      CATALOG_STATE.searchTimer = setTimeout(() => catSearch(v), 250);
    });
  }
  if (clear) {
    clear.addEventListener('click', () => {
      inp.value = '';
      clear.style.display = 'none';
      catShowCategories();
    });
  }
  catLoadCategories();
});

async function catQuickAdd(id, btn) {
  if (!id) return;
  window.haptic?.('medium');
  try {
    const res = await fetch('/api/catalog/product/' + encodeURIComponent(id));
    const data = await res.json();
    const p = data.product;
    if (!p || !p.price) {
      window.haptic?.('error');
      return;
    }
    const img = (p.images && p.images[0]) || p.image || '';
    cartAdd({ id: p.id, name: p.name, price: p.price, image: img });
    if (btn) {
      btn.classList.add('added');
      setTimeout(() => btn.classList.remove('added'), 800);
    }
  } catch (e) {
    console.error('[catQuickAdd]', e);
    window.haptic?.('error');
  }
}

function catChip(category) {
  const inp = document.getElementById('menu-search');
  if (inp) inp.value = '';
  const clear = document.getElementById('menu-search-clear');
  if (clear) clear.style.display = 'none';
  catShowProducts(category);
}
function catChipSearch(query) {
  const inp = document.getElementById('menu-search');
  if (inp) inp.value = query;
  const clear = document.getElementById('menu-search-clear');
  if (clear) clear.style.display = '';
  catSearch(query);
}

// «Настроение» — popmenu со списком типов (cake_type из каталога)
const MOOD_OPTIONS = [
  { code: 'Праздник - каждый день', label: '🎉 На праздник' },
  { code: 'Детский',                label: '👶 Детский' },
  { code: 'Домашний',               label: '🏠 Домашний' },
  { code: 'С сырным кремом',        label: '🧀 С сырным кремом' },
  { code: 'Сметанный',              label: '🥄 Сметанный' },
  { code: 'Шоколадный',             label: '🍫 Шоколадный' },
  { code: 'Фруктовый',              label: '🍇 Фруктовый' },
  { code: 'Бенто',                  label: '🍰 Бенто (мини)' },
  { code: 'Бисквитный',             label: '🎂 Бисквитный' },
  { code: 'Торты под заказ',        label: '🎨 Под заказ' },
];

function catMoodMenu() {
  const html = MOOD_OPTIONS.map(({ code, label }) =>
    `<button class="popmenu__item" onclick="catShowMood('${escapeAttr(code)}',&quot;${escapeAttr(label)}&quot;)">${label}</button>`
  ).join('');
  catShowPopmenu('Подбор по настроению', html);
}
window.catMoodMenu = catMoodMenu;

async function catShowMood(code, label) {
  catClosePopmenu();
  document.getElementById('menu-categories').style.display = 'none';
  document.getElementById('menu-products').style.display = '';
  document.getElementById('menu-bread').style.display = '';
  document.getElementById('menu-bread-name').textContent = label || `Настроение: ${code}`;
  document.getElementById('menu-empty').style.display = 'none';
  const chips = document.getElementById('menu-chips');
  if (chips) chips.style.display = 'none';
  CATALOG_STATE.currentCategory = `__mood:${code}`;

  const grid = document.getElementById('menu-products');
  grid.innerHTML = Array(6).fill(0).map(() => `
    <div class="pcard-pr-skel">
      <div class="pcard-pr-skel__img"></div>
      <div class="pcard-pr-skel__line pcard-pr-skel__line--w"></div>
      <div class="pcard-pr-skel__line pcard-pr-skel__line--n"></div>
    </div>`).join('');
  try {
    const r = await fetch('/api/catalog/products?limit=300');
    const d = await r.json();
    const all = d.products || [];
    const lc = code.toLowerCase();
    const matches = all.filter((p) =>
      Array.isArray(p.cake_type) && p.cake_type.some((t) => String(t).toLowerCase() === lc)
    );
    CATALOG_STATE.lastProducts = matches;
    if (matches.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__ic"><span data-icon="sparkles" data-size="28"></span></div>
          <div class="empty-state__h">Здесь пока ничего нет</div>
          <div class="empty-state__sub">В категории «${escapeHtml(label || code)}» нет товаров. Попробуй другой тип.</div>
          <div class="empty-state__cta"><button class="btn-outline" onclick="catShowCategories()">К каталогу</button></div>
        </div>`;
      if (window.IconInflate) window.IconInflate(grid);
    } else {
      catRenderToolbarAndProducts();
    }
  } catch {
    grid.innerHTML = '<div class="cat-empty">Не удалось загрузить.</div>';
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.catShowMood = catShowMood;

// Показать избранное — фильтр lastProducts по wishlist
async function catShowWishlist() {
  const ids = wishLoad();
  document.getElementById('menu-categories').style.display = 'none';
  document.getElementById('menu-products').style.display = '';
  document.getElementById('menu-bread').style.display = '';
  document.getElementById('menu-bread-name').textContent = 'Избранное';
  document.getElementById('menu-empty').style.display = 'none';
  const chips = document.getElementById('menu-chips');
  if (chips) chips.style.display = 'none';
  CATALOG_STATE.currentCategory = '__wishlist__';

  const grid = document.getElementById('menu-products');
  if (ids.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__ic" style="background:var(--red-xl);color:var(--red)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="32" height="32"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
        </div>
        <div class="empty-state__h">Пока ничего в избранном</div>
        <div class="empty-state__sub">Тапни на ♡ на любом товаре — он появится здесь, чтобы вернуться позже.</div>
        <div class="empty-state__cta">
          <button class="btn-outline" onclick="catShowCategories()">К каталогу</button>
        </div>
      </div>`;
    return;
  }
  grid.innerHTML = '<div class="cat-loading">Загружаем избранное…</div>';
  // Тянем все товары и фильтруем по id (быстрее чем отдельные запросы)
  try {
    const r = await fetch('/api/catalog/products?limit=300');
    const d = await r.json();
    const allProducts = (d.products || []).filter((p) => ids.includes(Number(p.id)));
    CATALOG_STATE.lastProducts = allProducts;
    catRenderToolbarAndProducts();
  } catch {
    grid.innerHTML = '<div class="cat-empty">Не удалось загрузить.</div>';
  }
}
window.catShowWishlist = catShowWishlist;

async function shareProduct(id) {
  // Ищем продукт сначала в lastProducts, затем тянем с сервера если не нашли
  let p = (CATALOG_STATE.lastProducts || []).find(x => Number(x.id) === Number(id));
  if (!p) {
    try {
      const r = await fetch('/api/catalog/product/' + encodeURIComponent(id));
      const d = await r.json();
      p = d.product;
    } catch {}
  }
  const url = p?.url || `https://www.maria-irk.ru/`;
  const text = p ? `${p.name} в кондитерской «Мария»` : 'Кондитерская «Мария»';
  const tg = window.Telegram?.WebApp;
  const shareLink = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  if (tg?.openTelegramLink) {
    tg.openTelegramLink(shareLink);
  } else if (navigator.share) {
    navigator.share({ url, text }).catch(() => {});
  } else {
    // Fallback — скопировать ссылку в clipboard
    navigator.clipboard?.writeText(url).then(() => {
      const t = document.createElement('div');
      t.textContent = '🔗 Ссылка скопирована';
      t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(20,15,15,.92);color:#fff;padding:10px 18px;border-radius:24px;z-index:9999;font-size:13px';
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 2000);
    });
  }
}
window.shareProduct = shareProduct;
window.catShowCategories = catShowCategories;
window.catShowProducts = catShowProducts;
window.catOpenProduct = catOpenProduct;
window.catCloseProduct = catCloseProduct;
window.catQuickAdd = catQuickAdd;
window.catChip = catChip;
window.catChipSearch = catChipSearch;

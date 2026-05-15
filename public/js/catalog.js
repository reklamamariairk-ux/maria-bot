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
  sort: 'default',
  priceMax: 0,
  currentCategory: '',
  lastProducts: [],
  visibleCount: 20, // pagination — сколько товаров показано сейчас
  pageSize: 20,
  diet: [], // активные диета-теги (мульти-выбор): ['vegan','sugar-free',...]
};
window.CATALOG_STATE = CATALOG_STATE;

// Диета-теги: server-tag → {icon, label, short}
// short — короткая версия для бейджа на карточке товара
const DIET_OPTIONS = [
  { tag: 'sugar-free',   icon: '🚫🍬', label: 'Без сахара',   short: 'Без сахара' },
  { tag: 'gluten-free',  icon: '🌾',   label: 'Без глютена',  short: 'Без глютена' },
  { tag: 'vegan',        icon: '🌱',   label: 'Веган',        short: 'Веган' },
  { tag: 'lactose-free', icon: '🥛',   label: 'Без лактозы',  short: 'Без лактозы' },
  { tag: 'low-cal',      icon: '⚡',   label: 'Лёгкий / ПП',  short: 'Лёгкий' },
  { tag: 'nut-free',     icon: '🥜',   label: 'Без орехов',   short: 'Без орехов' },
];
const DIET_BY_TAG = Object.fromEntries(DIET_OPTIONS.map((d) => [d.tag, d]));
window.DIET_OPTIONS = DIET_OPTIONS;
window.DIET_BY_TAG = DIET_BY_TAG;

// Форматирование веса: "1.250" → "1.25 кг", "0.800" → "800 г", "1" → "1 кг"
function fmtWeight(w) {
  if (!w) return '';
  const s = String(w).trim().replace(',', '.');
  const num = parseFloat(s);
  if (isNaN(num)) return s;
  if (num >= 1) return num.toFixed(num % 1 === 0 ? 0 : 2).replace(/\.?0+$/, '') + ' кг';
  return Math.round(num * 1000) + ' г';
}
window.fmtWeight = fmtWeight;

// Popular searches для suggested
const POPULAR_SEARCHES = ['шоколадный', 'медовик', 'наполеон', 'эклер', 'детский', 'без орехов', 'на день рождения', 'наборы'];

// Wishlist (избранное) — localStorage
const WISH_KEY = 'maria_wishlist_v1';
function wishLoad() {
  try { return JSON.parse(localStorage.getItem(WISH_KEY) || '[]'); }
  catch { return []; }
}
function wishSave(arr) {
  try { localStorage.setItem(WISH_KEY, JSON.stringify(arr)); } catch {}
  // Дебаунс-синк на бэкенд для push «снова в наличии»
  wishSyncDebounced(arr);
}
let _wishSyncT = null;
function wishSyncDebounced(ids) {
  if (_wishSyncT) clearTimeout(_wishSyncT);
  _wishSyncT = setTimeout(() => {
    const tg = window.Telegram?.WebApp;
    const initData = tg?.initData || '';
    if (!initData) return;
    fetch('/api/wishlist/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'tma ' + initData },
      body: JSON.stringify({ ids: (ids || []).map(Number).filter((x) => x > 0) }),
    }).catch(() => {});
  }, 800);
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
  // Скрываем технические/дублирующие категории:
  // - "Каталог" (fallback товары без section_id, мусор Bitrix)
  // - "Торты на заказ" (есть отдельная вкладка "На заказ" с формой)
  const HIDDEN = new Set(['Каталог', 'Торты на заказ']);
  const visible = CATALOG_STATE.categories.filter((c) => !HIDDEN.has(c.name) && c.count > 0);
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
  document.getElementById('menu-bread').style.display = 'none'; // старый bread больше не нужен — теперь sticky
  document.getElementById('menu-empty').style.display = 'none';
  // Скрываем chip-фильтры в категории
  const chips = document.getElementById('menu-chips');
  if (chips) chips.style.display = 'none';
  CATALOG_STATE.currentCategory = category;
  CATALOG_STATE.visibleCount = CATALOG_STATE.pageSize; // сброс pagination

  // Рендерим sticky category switcher + diet-chips
  catRenderStickyCats(category);
  catRenderDietChips();

  const grid = document.getElementById('menu-products');
  // Skeleton loader — 6 placeholder-карточек
  grid.innerHTML = Array(6).fill(0).map(() => `
    <div class="pcard-pr-skel">
      <div class="pcard-pr-skel__img"></div>
      <div class="pcard-pr-skel__line pcard-pr-skel__line--w"></div>
      <div class="pcard-pr-skel__line pcard-pr-skel__line--n"></div>
    </div>`).join('');

  try {
    const dietQs = (CATALOG_STATE.diet && CATALOG_STATE.diet.length)
      ? '&diet=' + encodeURIComponent(CATALOG_STATE.diet.join(','))
      : '';
    const res = await fetch('/api/catalog/products?category=' + encodeURIComponent(category) + '&limit=100' + dietQs);
    const data = await res.json();
    CATALOG_STATE.lastProducts = data.products || [];
    catRenderToolbarAndProducts();
  } catch {
    grid.innerHTML = '<div class="cat-empty">Не удалось загрузить. Попробуй позже.</div>';
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Sticky category switcher — горизонтальный chip-row над товарами
function catRenderStickyCats(active) {
  const wrap = document.getElementById('menu-stickycats');
  if (!wrap) return;
  const HIDDEN = new Set(['Каталог', 'Торты на заказ']);
  const cats = (CATALOG_STATE.categories || []).filter((c) => !HIDDEN.has(c.name) && c.count > 0);
  const allBtn = `<button class="sticky-cat" onclick="haptic('light');catShowCategories()">← Все</button>`;
  const chips = cats.map((c) => {
    const isActive = c.name === active;
    const icon = CATEGORY_ICONS[c.name] || '🍮';
    return `<button class="sticky-cat ${isActive ? 'sticky-cat--active' : ''}" data-haptic="light" onclick="haptic('light');catShowProducts('${escapeAttr(c.name)}')">${icon} ${escapeHtml(c.name)}</button>`;
  }).join('');
  wrap.innerHTML = allBtn + chips;
  wrap.style.display = '';
}

// Diet-chip row под sticky-cats — мульти-выбор, отображается в products view
function catRenderDietChips() {
  const wrap = document.getElementById('menu-dietchips');
  if (!wrap) return;
  const active = new Set(CATALOG_STATE.diet || []);
  // «Сбросить» появляется только если есть активные фильтры
  const resetBtn = active.size > 0
    ? `<button class="diet-chip diet-chip--reset" data-haptic="selection" onclick="catDietReset()">✕ Сбросить</button>`
    : '';
  const chips = DIET_OPTIONS.map((d) => {
    const on = active.has(d.tag);
    return `<button class="diet-chip ${on ? 'diet-chip--on' : ''}" data-haptic="selection" onclick="catDietToggle('${d.tag}')">${d.icon} ${escapeHtml(d.label)}</button>`;
  }).join('');
  wrap.innerHTML = resetBtn + chips;
  wrap.style.display = '';
}

function catDietToggle(tag) {
  const set = new Set(CATALOG_STATE.diet || []);
  if (set.has(tag)) set.delete(tag); else set.add(tag);
  CATALOG_STATE.diet = [...set];
  CATALOG_STATE.visibleCount = CATALOG_STATE.pageSize; // сброс пагинации
  catRenderDietChips();
  catReloadCurrentView();
  window.haptic?.('selection');
}
window.catDietToggle = catDietToggle;

function catDietReset() {
  CATALOG_STATE.diet = [];
  CATALOG_STATE.visibleCount = CATALOG_STATE.pageSize;
  catRenderDietChips();
  catReloadCurrentView();
  window.haptic?.('light');
}
window.catDietReset = catDietReset;

// Перезагрузить текущий view (категория или all-with-diet) с учётом обновлённого diet-фильтра
function catReloadCurrentView() {
  if (CATALOG_STATE.currentCategory) {
    catShowProducts(CATALOG_STATE.currentCategory);
  } else if (CATALOG_STATE.diet.length > 0) {
    catShowAllWithDiet();
  } else {
    catShowCategories();
  }
}

// «Для меня» — открывает popmenu с диета-фильтрами с главной страницы меню (без зайти в категорию)
function catDietMenu() {
  const active = new Set(CATALOG_STATE.diet || []);
  const html = DIET_OPTIONS.map((d) => {
    const on = active.has(d.tag);
    return `<button class="popmenu__item${on ? ' on' : ''}" onclick="catDietMenuPick('${d.tag}')">${d.icon} ${escapeHtml(d.label)}</button>`;
  }).join('') + (active.size > 0
    ? `<button class="popmenu__item popmenu__item--danger" onclick="catDietMenuClear()">✕ Сбросить</button>`
    : '');
  catShowPopmenu('Для меня', html);
}
window.catDietMenu = catDietMenu;

function catDietMenuPick(tag) {
  const set = new Set(CATALOG_STATE.diet || []);
  if (set.has(tag)) set.delete(tag); else set.add(tag);
  CATALOG_STATE.diet = [...set];
  catClosePopmenu();
  // Если есть фильтры — открываем все товары с применённым фильтром
  if (CATALOG_STATE.diet.length > 0) {
    catShowAllWithDiet();
  } else {
    catShowCategories();
  }
  window.haptic?.('selection');
}
window.catDietMenuPick = catDietMenuPick;

function catDietMenuClear() {
  CATALOG_STATE.diet = [];
  catClosePopmenu();
  catShowCategories();
}
window.catDietMenuClear = catDietMenuClear;

// Показать все товары из всех категорий с применённым diet-фильтром
async function catShowAllWithDiet() {
  document.getElementById('menu-categories').style.display = 'none';
  document.getElementById('menu-products').style.display = '';
  document.getElementById('menu-bread').style.display = 'none';
  document.getElementById('menu-empty').style.display = 'none';
  const chips = document.getElementById('menu-chips');
  if (chips) chips.style.display = 'none';
  CATALOG_STATE.currentCategory = ''; // нет конкретной категории
  CATALOG_STATE.visibleCount = CATALOG_STATE.pageSize;
  catRenderStickyCats(''); // sticky без активной
  catRenderDietChips();

  const grid = document.getElementById('menu-products');
  grid.innerHTML = Array(6).fill(0).map(() => `
    <div class="pcard-pr-skel">
      <div class="pcard-pr-skel__img"></div>
      <div class="pcard-pr-skel__line pcard-pr-skel__line--w"></div>
      <div class="pcard-pr-skel__line pcard-pr-skel__line--n"></div>
    </div>`).join('');

  try {
    const dietQs = CATALOG_STATE.diet.length ? '&diet=' + encodeURIComponent(CATALOG_STATE.diet.join(',')) : '';
    const res = await fetch('/api/catalog/products?limit=100' + dietQs);
    const data = await res.json();
    CATALOG_STATE.lastProducts = data.products || [];
    catRenderToolbarAndProducts();
  } catch {
    grid.innerHTML = '<div class="cat-empty">Не удалось загрузить</div>';
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.catShowAllWithDiet = catShowAllWithDiet;

// Применяем sort + price-фильтр + pagination к lastProducts и рендерим
function catRenderToolbarAndProducts() {
  let products = [...(CATALOG_STATE.lastProducts || [])];
  if (CATALOG_STATE.priceMax > 0) {
    products = products.filter((p) => {
      const price = Number(p.priceNumber) || 0;
      return price > 0 && price <= CATALOG_STATE.priceMax;
    });
  }
  const s = CATALOG_STATE.sort;
  if (s === 'price-asc')  products.sort((a,b) => (a.priceNumber||0) - (b.priceNumber||0));
  if (s === 'price-desc') products.sort((a,b) => (b.priceNumber||0) - (a.priceNumber||0));
  if (s === 'popular')    products.sort((a,b) => Number(b.hit||0) - Number(a.hit||0));
  // Pagination
  const total = products.length;
  const visible = Math.min(CATALOG_STATE.visibleCount, total);
  const pageProducts = products.slice(0, visible);
  const toolbar = catRenderToolbar(total);
  const grid = document.getElementById('menu-products');
  grid.innerHTML = toolbar + '<div class="cat-products-grid">' + catRenderProductsHtml(pageProducts) + '</div>';
  // Load-more sentinel
  const more = document.getElementById('menu-load-more');
  if (more) more.style.display = (visible < total) ? '' : 'none';
  if (window.IconInflate) window.IconInflate(grid);
  // Setup infinite scroll observer (once)
  catInitInfiniteScroll();
}

// Lazy load: show ещё page при достижении конца списка
let _ioObserver = null;
function catInitInfiniteScroll() {
  if (_ioObserver) return;
  const target = document.getElementById('menu-load-more');
  if (!target || !('IntersectionObserver' in window)) return;
  _ioObserver = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) catLoadMore();
    });
  }, { rootMargin: '200px' });
  _ioObserver.observe(target);
}

function catLoadMore() {
  const total = CATALOG_STATE.lastProducts?.length || 0;
  if (CATALOG_STATE.visibleCount >= total) return;
  CATALOG_STATE.visibleCount = Math.min(total, CATALOG_STATE.visibleCount + CATALOG_STATE.pageSize);
  catRenderToolbarAndProducts();
}
window.catLoadMore = catLoadMore;

// Плюрализация для "человек"
function pluralPersons(n) {
  if (!n) return '';
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'человека';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'человек';
  return 'человек';
}

// Detect allergens из описания/начинки/состава
function detectAllergens(p) {
  const text = [
    p.name || '', p.preview || '', p.description_text || '',
    ...(p.filling || []), ...(p.cake_type || [])
  ].join(' ').toLowerCase();
  const rules = [
    { kw: ['орех', 'фундук', 'миндал', 'фисташ', 'грецк', 'арахис', 'кешью'], icon: '🥜', label: 'Орехи' },
    { kw: ['молок', 'сливк', 'сметан', 'сыр', 'творог', 'йогурт', 'кефир'], icon: '🥛', label: 'Молочное' },
    { kw: ['яйц', 'белок', 'желток', 'безе', 'мерен'], icon: '🥚', label: 'Яйца' },
    { kw: ['мука', 'пшениц', 'злак', 'клейков', 'глютен'], icon: '🌾', label: 'Глютен' },
    { kw: ['шокол', 'какао'], icon: '🍫', label: 'Шоколад' },
    { kw: ['мёд', 'мед '], icon: '🍯', label: 'Мёд' },
  ];
  return rules.filter((r) => r.kw.some((k) => text.includes(k))).slice(0, 4);
}

// Quantity selector
function catQtyInc() {
  window._modalQty = Math.min(20, (window._modalQty || 1) + 1);
  catUpdateQtyUI();
}
function catQtyDec() {
  window._modalQty = Math.max(1, (window._modalQty || 1) - 1);
  catUpdateQtyUI();
}
function catUpdateQtyUI() {
  const valEl = document.getElementById('cat-modal-qty');
  const addBtn = document.getElementById('cat-modal-add');
  const qty = window._modalQty || 1;
  if (valEl) valEl.textContent = qty;
  if (addBtn) {
    const base = Number(addBtn.dataset.basePrice || 0);
    const total = base * qty;
    addBtn.textContent = total > 0 ? `В корзину · ${total.toLocaleString('ru-RU')} ₽` : 'В корзину';
  }
  // Update TG MainButton too
  const base = Number(window._modalBasePrice || 0);
  if (base > 0 && window.tgMain?.show) {
    window.tgMain.show(`Добавить · ${(base * qty).toLocaleString('ru-RU')} ₽`);
  }
  window.haptic?.('selection');
}
window.catQtyInc = catQtyInc;
window.catQtyDec = catQtyDec;

// Похожие товары (из той же категории) — render 3-4 thumbnails
function renderSimilarProducts(p) {
  const wrap = document.getElementById('cat-modal-similar');
  if (!wrap || !p?.category) return;
  // Берём из текущего CATALOG_STATE.lastProducts если совпадает категория
  let pool = (CATALOG_STATE.lastProducts || []).filter((x) =>
    x.category === p.category && x.id !== p.id && x.image
  );
  if (pool.length < 3) {
    // Fallback — все каталог из catalog cache
    const cache = window._catalogCache || {};
    pool = Object.values(cache).filter((x) => x.id !== p.id && x.image && x.category === p.category);
  }
  if (pool.length < 3) { wrap.innerHTML = ''; return; }
  // Random shuffle, берём 3
  const similar = pool.sort(() => 0.5 - Math.random()).slice(0, 3);
  wrap.innerHTML = `
    <div class="cat-modal__similar-h">Похожие товары</div>
    <div class="cat-modal__similar-grid">
      ${similar.map((s) => {
        const sPrice = s.price ? `${Number(s.price).toLocaleString('ru-RU')} ₽` : (s.priceNumber ? `${Number(s.priceNumber).toLocaleString('ru-RU')} ₽` : '');
        return `
          <div class="cat-modal__similar-item" onclick="catOpenProduct(${s.id})">
            <img src="/img?u=${encodeURIComponent(s.image)}" alt="${escapeAttr(s.name)}" loading="lazy"/>
            <div class="cat-modal__similar-name">${escapeHtml(s.name)}</div>
            <div class="cat-modal__similar-price">${escapeHtml(sPrice)}</div>
          </div>`;
      }).join('')}
    </div>`;
}

// Photo zoom modal — fullscreen
function catOpenPhotoZoom(src) {
  if (!src) return;
  let m = document.getElementById('photo-zoom-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'photo-zoom-modal';
    m.className = 'photo-zoom';
    m.onclick = () => catClosePhotoZoom();
    m.innerHTML = `<button class="photo-zoom__close" onclick="catClosePhotoZoom()">×</button><img id="photo-zoom-img" alt=""/>`;
    document.body.appendChild(m);
  }
  m.querySelector('#photo-zoom-img').src = src;
  m.style.display = 'flex';
  window.haptic?.('light');
}
window.catOpenPhotoZoom = catOpenPhotoZoom;
function catClosePhotoZoom() {
  const m = document.getElementById('photo-zoom-modal');
  if (m) m.style.display = 'none';
}
window.catClosePhotoZoom = catClosePhotoZoom;

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
  const sticky = document.getElementById('menu-stickycats');
  if (sticky) sticky.style.display = 'none';
  const dietWrap = document.getElementById('menu-dietchips');
  if (dietWrap) dietWrap.style.display = 'none';
  const more = document.getElementById('menu-load-more');
  if (more) more.style.display = 'none';
  const chips = document.getElementById('menu-chips');
  if (chips) chips.style.display = '';
  const inp = document.getElementById('menu-search');
  if (inp) inp.value = '';
  const clear = document.getElementById('menu-search-clear');
  if (clear) clear.style.display = 'none';
  // Сбрасываем sort/filter (diet оставляем — он управляется отдельно)
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
    const weight   = p.weight ? `<span class="pcard-pr__w">${escapeHtml(fmtWeight(p.weight))}</span>` : '';
    // Diet-бейджи на карточке (показываем до 2, чтобы не загромождать)
    const dietBadges = Array.isArray(p.dietary) && p.dietary.length > 0
      ? `<div class="pcard-pr__diet">${p.dietary.slice(0, 2).map((tag) => {
          const d = DIET_BY_TAG[tag];
          return d ? `<span class="pcard-pr__diet-chip">${d.icon} ${escapeHtml(d.short)}</span>` : '';
        }).join('')}</div>`
      : '';
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
          ${dietBadges}
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
  // Track recently viewed (последние 8 уникальных)
  try {
    const recent = JSON.parse(localStorage.getItem('maria_recent_viewed') || '[]');
    const numId = Number(id);
    const filtered = recent.filter((x) => Number(x) !== numId);
    filtered.unshift(numId);
    localStorage.setItem('maria_recent_viewed', JSON.stringify(filtered.slice(0, 8)));
  } catch {}
  body.innerHTML = '<div class="cat-loading">Загружаем карточку…</div>';
  modal.style.display = 'flex';
  window.scrollLock?.();
  window.tgBack?.show(() => catCloseProduct());

  try {
    const res = await fetch('/api/catalog/product/' + encodeURIComponent(id));
    const data = await res.json();
    const p = data.product;
    // Кэшируем для отображения thumbnails в Profile (Любимое / Недавно)
    if (p && p.id) {
      window._catalogCache = window._catalogCache || {};
      window._catalogCache[p.id] = p;
    }
    if (!p) {
      body.innerHTML = '<div class="cat-empty">Товар не найден</div>';
      return;
    }

    const img = (p.images && p.images[0]) || p.image || '';
    const priceTxt = p.price ? `${Number(p.price).toLocaleString('ru-RU')} ₽` : '—';
    const oldPriceTxt = p.oldPrice ? `${Number(p.oldPrice).toLocaleString('ru-RU')} ₽` : '';
    const hasDiscount = p.discountPercent && p.discountPercent > 0;
    const desc = (p.description_text || p.preview || '').trim();

    // Properties — Вес (форматированный), Персон, Начинка, Тип
    const props = [];
    if (p.weight)  props.push(`<span><b>Вес:</b> ${escapeHtml(fmtWeight(p.weight))}</span>`);
    if (p.persons) props.push(`<span><b>На:</b> ${escapeHtml(String(p.persons))} ${pluralPersons(Number(p.persons) || 0)}</span>`);
    const filling = (p.filling || []).join(', ');
    if (filling)   props.push(`<span><b>Начинка:</b> ${escapeHtml(filling)}</span>`);
    const types = [...(p.cake_type || []), ...(p.pie_type || []), ...(p.dessert_type || [])].join(', ');
    if (types)     props.push(`<span><b>Тип:</b> ${escapeHtml(types)}</span>`);

    // Калькулятор порций — кнопка для тортов (категория «Торты» или «Торты на заказ»)
    const isCake = /торт/i.test(String(p.category || ''));
    const portionsBtn = isCake
      ? `<button class="cat-modal__portions" data-haptic="light" onclick="event.stopPropagation();openPortionsCalc('product')">🧮 Сколько брать?</button>`
      : '';

    // Allergen chips — detect из описания/состава/начинки
    const allergens = detectAllergens(p);
    const allergenHtml = allergens.length ? `
      <div class="cat-modal__allergens">
        <div class="cat-modal__allergens-h">Содержит:</div>
        <div class="cat-modal__allergens-list">
          ${allergens.map((a) => `<span class="allerg-chip">${a.icon} ${a.label}</span>`).join('')}
        </div>
      </div>` : '';

    // Diet chips — «Подходит для:» (server-marked dietary)
    const dietTags = Array.isArray(p.dietary) ? p.dietary : [];
    const dietHtml = dietTags.length ? `
      <div class="cat-modal__allergens cat-modal__allergens--diet">
        <div class="cat-modal__allergens-h">Подходит для:</div>
        <div class="cat-modal__allergens-list">
          ${dietTags.map((tag) => {
            const d = DIET_BY_TAG[tag];
            return d ? `<span class="allerg-chip allerg-chip--diet">${d.icon} ${escapeHtml(d.label)}</span>` : '';
          }).join('')}
        </div>
      </div>` : '';

    body.innerHTML = `
      <button class="cat-modal__close" onclick="catCloseProduct()">×</button>
      <div class="cat-modal__hero" onclick="catOpenPhotoZoom('${img ? '/img?u=' + encodeURIComponent(img) : ''}')">
        ${img ? `<img class="cat-modal__pic" src="/img?u=${encodeURIComponent(img)}" alt="${escapeAttr(p.name)}" loading="eager" decoding="async" fetchpriority="high">` : '<span class="pcard-pr__noimg" style="font-size:64px">🍰</span>'}
        ${p.hit ? '<span class="cat-modal__hit">★ Хит</span>' : ''}
        ${hasDiscount ? `<span class="cat-modal__sale">−${p.discountPercent}%</span>` : ''}
      </div>
      <div class="cat-modal__title">${escapeHtml(p.name)}</div>
      <div class="cat-modal__price">
        ${escapeHtml(priceTxt)}
        ${hasDiscount && oldPriceTxt ? `<span class="cat-modal__old">${escapeHtml(oldPriceTxt)}</span> <span class="cat-modal__pct">−${p.discountPercent}%</span>` : ''}
      </div>
      ${props.length ? `<div class="cat-modal__props">${props.join('')}</div>` : ''}
      ${portionsBtn}
      ${dietHtml}
      ${allergenHtml}
      ${desc ? `<div class="cat-modal__desc">${escapeHtml(desc)}</div>` : ''}
      <div class="cat-modal__similar" id="cat-modal-similar"></div>
      <div class="cat-modal__actions">
        <div class="cat-modal__qty">
          <button class="cat-modal__qty-btn" onclick="catQtyDec()" aria-label="Меньше">−</button>
          <span class="cat-modal__qty-val" id="cat-modal-qty">1</span>
          <button class="cat-modal__qty-btn" onclick="catQtyInc()" aria-label="Больше">+</button>
        </div>
        <button class="cat-modal__share" data-haptic="light" onclick="shareProduct(${p.id})" aria-label="Поделиться">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/></svg>
        </button>
        <button class="btn-full cat-modal__add-main" id="cat-modal-add" data-base-price="${Number(p.price || 0)}">${p.price ? `В корзину · ${Number(p.price).toLocaleString('ru-RU')} ₽` : 'В корзину'}</button>
      </div>
    `;
    // Render similar products (3 из той же категории)
    renderSimilarProducts(p);

    // Quantity selector state
    window._modalQty = 1;
    window._modalBasePrice = Number(p.price || 0);

    const addBtn = document.getElementById('cat-modal-add');
    const productSnap = { id: p.id, name: p.name, price: p.price, image: img };
    if (addBtn) addBtn.onclick = () => {
      const qty = window._modalQty || 1;
      for (let i = 0; i < qty; i++) window.cartAdd?.(productSnap);
      catCloseProduct();
    };
    // Нативная Telegram MainButton с qty
    const priceLabel = p.price ? `Добавить · ${Number(p.price).toLocaleString('ru-RU')} ₽` : 'Добавить в корзину';
    window.tgMain?.show(priceLabel, () => {
      const qty = window._modalQty || 1;
      for (let i = 0; i < qty; i++) window.cartAdd?.(productSnap);
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
  // Скрываем suggested и sticky cats при активном поиске
  const sug = document.getElementById('menu-suggested');
  if (sug) sug.style.display = 'none';
  const sticky = document.getElementById('menu-stickycats');
  if (sticky) sticky.style.display = 'none';

  const wrap = document.getElementById('menu-products');
  wrap.innerHTML = '<div class="cat-loading">Ищем…</div>';

  try {
    const res = await fetch('/api/catalog/search?q=' + encodeURIComponent(q));
    const data = await res.json();
    const products = data.products || [];
    if (products.length === 0) {
      wrap.innerHTML = `
        <div class="cat-search-empty">
          <div class="cat-search-empty__ic">🔍</div>
          <div class="cat-search-empty__h">Ничего не нашлось по «${escapeHtml(q)}»</div>
          <div class="cat-search-empty__s">Попробуй другие слова или категорию</div>
          <button class="btn-outline" onclick="catClearSearch()">Сбросить поиск</button>
        </div>`;
      const more = document.getElementById('menu-load-more');
      if (more) more.style.display = 'none';
      return;
    }
    // Header с counter
    const counter = `<div class="cat-search-counter">По запросу <b>«${escapeHtml(q)}»</b> — ${products.length} ${products.length === 1 ? 'товар' : (products.length < 5 ? 'товара' : 'товаров')}</div>`;
    wrap.innerHTML = counter + '<div class="cat-products-grid">' + catRenderProductsHtml(products) + '</div>';
    const more = document.getElementById('menu-load-more');
    if (more) more.style.display = 'none';
  } catch {
    wrap.innerHTML = '<div class="cat-empty">Ошибка поиска</div>';
  }
}

// Suggested searches при focus на пустом поле
function catShowSuggested() {
  const wrap = document.getElementById('menu-suggested');
  if (!wrap) return;
  wrap.innerHTML = `
    <div class="cat-suggested__h">Популярное</div>
    <div class="cat-suggested__chips">
      ${POPULAR_SEARCHES.map((q) => `<button class="cat-suggested__chip" onclick="catRunSuggestedSearch('${escapeAttr(q)}')">${escapeHtml(q)}</button>`).join('')}
    </div>`;
  wrap.style.display = '';
}
function catHideSuggested() {
  const wrap = document.getElementById('menu-suggested');
  if (wrap) wrap.style.display = 'none';
}
function catRunSuggestedSearch(q) {
  const inp = document.getElementById('menu-search');
  if (!inp) return;
  inp.value = q;
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  catHideSuggested();
}

// Автокомплит по именам товаров — топ-5 через /api/catalog/search
let _acAbort = null;
async function catAutocomplete(query) {
  const dropEl = document.getElementById('menu-autocomplete');
  if (!dropEl) return;
  const q = (query || '').trim();
  if (q.length < 2) { dropEl.style.display = 'none'; return; }
  if (_acAbort) _acAbort.abort();
  _acAbort = new AbortController();
  let matches = [];
  try {
    const r = await fetch(`/api/catalog/search?q=${encodeURIComponent(q)}`, { signal: _acAbort.signal });
    const d = await r.json();
    matches = (Array.isArray(d?.products) ? d.products : []).slice(0, 5);
  } catch (e) { if (e.name === 'AbortError') return; }
  if (matches.length === 0) { dropEl.style.display = 'none'; return; }
  dropEl.innerHTML = matches.map((p) => {
    const img = p.image ? `<img src="/img?u=${encodeURIComponent(p.image)}" alt="" loading="lazy"/>` : '<span class="menu-ac__ph">🍰</span>';
    const price = Number(p.priceNumber || p.price) || 0;
    return `
      <button class="menu-ac__item" onclick="catOpenProduct?.(${p.id});catHideAutocomplete()">
        <div class="menu-ac__img">${img}</div>
        <div class="menu-ac__body">
          <div class="menu-ac__name">${escapeHtml(p.name || '')}</div>
          <div class="menu-ac__cat">${escapeHtml(p.category || '')}</div>
        </div>
        ${price ? `<div class="menu-ac__price">${price.toLocaleString('ru-RU')} ₽</div>` : ''}
      </button>`;
  }).join('');
  dropEl.style.display = '';
}
function catHideAutocomplete() {
  const dropEl = document.getElementById('menu-autocomplete');
  if (dropEl) dropEl.style.display = 'none';
}
window.catHideAutocomplete = catHideAutocomplete;
function catClearSearch() {
  const inp = document.getElementById('menu-search');
  if (inp) { inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true })); }
}
window.catRunSuggestedSearch = catRunSuggestedSearch;
window.catClearSearch = catClearSearch;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return String(s).replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', () => {
  // Стартовая синхронизация wishlist'a с бэком — на случай если юзер уже накидал избранное
  // до появления push-канала. Идемпотентно: бэк просто перепишет свою таблицу.
  setTimeout(() => {
    try {
      const ids = wishLoad();
      if (ids.length > 0) wishSyncDebounced(ids);
    } catch {}
  }, 2000);
  const inp = document.getElementById('menu-search');
  const clear = document.getElementById('menu-search-clear');
  if (inp) {
    inp.addEventListener('input', () => {
      clearTimeout(CATALOG_STATE.searchTimer);
      const v = inp.value;
      clear.style.display = v ? '' : 'none';
      if (!v) { catShowSuggested(); catHideAutocomplete(); }
      else catHideSuggested();
      // Автокомплит сразу — без debounce, локальный (по уже загруженному кэшу)
      catAutocomplete(v);
      // Полный поиск через 250ms
      CATALOG_STATE.searchTimer = setTimeout(() => catSearch(v), 250);
    });
    inp.addEventListener('blur', () => { setTimeout(catHideAutocomplete, 200); });
    inp.addEventListener('focus', () => {
      if (!inp.value) catShowSuggested();
    });
    inp.addEventListener('blur', () => {
      // Delay чтобы tap по suggested chip успел сработать
      setTimeout(() => catHideSuggested(), 200);
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

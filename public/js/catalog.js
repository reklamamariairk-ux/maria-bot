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
};

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

  const grid = document.getElementById('menu-products');
  grid.innerHTML = '<div class="cat-loading">Загружаем…</div>';

  try {
    const res = await fetch('/api/catalog/products?category=' + encodeURIComponent(category) + '&limit=100');
    const data = await res.json();
    catRenderProducts(data.products || []);
  } catch {
    grid.innerHTML = '<div class="cat-empty">Не удалось загрузить. Попробуй позже.</div>';
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function catShowCategories() {
  document.getElementById('menu-categories').style.display = '';
  document.getElementById('menu-products').style.display = 'none';
  document.getElementById('menu-bread').style.display = 'none';
  document.getElementById('menu-empty').style.display = 'none';
  const inp = document.getElementById('menu-search');
  if (inp) inp.value = '';
  document.getElementById('menu-search-clear').style.display = 'none';
}

function catRenderProducts(products) {
  const wrap = document.getElementById('menu-products');
  if (!products.length) {
    wrap.innerHTML = '';
    document.getElementById('menu-empty').style.display = '';
    return;
  }
  document.getElementById('menu-empty').style.display = 'none';
  wrap.innerHTML = products.map((p, idx) => {
    const hasId = p.id != null && p.id > 0;
    const onClick = hasId
      ? `catOpenProduct(${p.id})`
      : `openSite('${escapeAttr(p.url || '')}')`;
    const priceNum = p.price ? parseInt(String(p.price).replace(/\D/g, ''), 10) : (p.priceNumber || 0);
    const priceTxt = p.price || (p.priceNumber ? `${Number(p.priceNumber).toLocaleString('ru-RU')} ₽` : '');
    const hitBadge = p.hit ? '<span class="pcard-pr__hit">★ Хит</span>' : '';
    const weight   = p.weight ? `<span class="pcard-pr__w">${escapeHtml(p.weight)}</span>` : '';
    const addBtn = hasId && priceNum > 0
      ? `<button class="pcard-pr__add" aria-label="В корзину" onclick="event.stopPropagation();catQuickAdd(${p.id},this)">+</button>`
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
          ${addBtn}
        </div>
        <div class="pcard-pr__body">
          <div class="pcard-pr__name">${escapeHtml(p.name)}</div>
          ${weight}
          <div class="pcard-pr__row">
            <span class="pcard-pr__price">${escapeHtml(priceTxt)}</span>
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
  document.body.style.overflow = 'hidden';
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
      <div class="cat-modal__price">${escapeHtml(priceTxt)}</div>
      ${props.length ? `<div class="cat-modal__props">${props.join('')}</div>` : ''}
      ${desc ? `<div class="cat-modal__desc">${escapeHtml(desc)}</div>` : ''}
      <div class="cat-modal__actions">
        <button class="btn-full" onclick='cartAdd(${JSON.stringify({id:p.id,name:p.name,price:p.price,image:img}).replace(/"/g,"&quot;")});catCloseProduct()'>🛒 В корзину</button>
      </div>
    `;
    // Нативная Telegram MainButton — для добавления в корзину одним тапом
    const priceLabel = p.price ? `Добавить в корзину · ${Number(p.price).toLocaleString('ru-RU')} ₽` : 'Добавить в корзину';
    window.tgMain?.show(priceLabel, () => {
      window.cartAdd?.({ id: p.id, name: p.name, price: p.price, image: img });
      catCloseProduct();
    });
  } catch (e) {
    body.innerHTML = '<div class="cat-empty">Ошибка загрузки</div>';
  }
}

function catCloseProduct() {
  const modal = document.getElementById('cat-product-modal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
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

window.catShowCategories = catShowCategories;
window.catShowProducts = catShowProducts;
window.catOpenProduct = catOpenProduct;
window.catCloseProduct = catCloseProduct;
window.catQuickAdd = catQuickAdd;
window.catChip = catChip;
window.catChipSearch = catChipSearch;

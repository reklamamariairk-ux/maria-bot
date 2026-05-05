/* ── Catalog (Меню) ──────────────────────────────────────────────────────── */

const CATEGORY_ICONS = {
  'Торты':            '🎂',
  'Пироги':           '🥧',
  'Пирожные':         '🍰',
  'Наборы':           '🎁',
  'Торты на заказ':   '✨',
  'Для праздника':    '🎉',
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
  wrap.innerHTML = CATALOG_STATE.categories.map((c) => {
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
  wrap.innerHTML = products.map((p) => `
    <div class="pcard-pr" onclick="openSite('${escapeAttr(p.url)}')">
      <div class="pcard-pr__img" ${p.image ? `style="background-image:url('${escapeAttr(p.image)}')"` : ''}>
        ${p.image ? '' : '<span class="pcard-pr__noimg">🍰</span>'}
      </div>
      <div class="pcard-pr__body">
        <div class="pcard-pr__name">${escapeHtml(p.name)}</div>
        <div class="pcard-pr__row">
          <span class="pcard-pr__price">${escapeHtml(p.price || '')}</span>
          <span class="pcard-pr__cta">→</span>
        </div>
      </div>
    </div>`).join('');
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

window.catShowCategories = catShowCategories;
window.catShowProducts = catShowProducts;

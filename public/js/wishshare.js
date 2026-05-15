/* ── Wishlist Share — поделиться избранным с друзьями ─────────────────── */

// ── A. Создание share-link из своего wishlist ──────────────────────────────
async function shareWishlist() {
  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || '';
  if (!initData) {
    alert('Открой Mini App через Telegram, чтобы поделиться wishlist\'ом');
    return;
  }
  const wishlist = (window.wishLoad ? window.wishLoad() : []).map(Number).filter((n) => n > 0);
  if (wishlist.length === 0) {
    if (tg?.showAlert) tg.showAlert('Сначала добавь товары в избранное — нажми ♡ на карточке');
    else alert('Сначала добавь товары в избранное — нажми ♡ на карточке');
    return;
  }
  // Открываем модалку с вводом сообщения
  ensureWishShareModal();
  document.getElementById('wishshare-modal').style.display = 'flex';
  document.getElementById('wishshare-count').textContent = wishlist.length;
  document.getElementById('wishshare-link').style.display = 'none';
  document.getElementById('wishshare-create').style.display = '';
  document.getElementById('wishshare-msg').value = '';
  document.getElementById('wishshare-err').style.display = 'none';
  window.scrollLock?.();
  window.haptic?.('light');
}
window.shareWishlist = shareWishlist;

function closeWishShare() {
  const m = document.getElementById('wishshare-modal');
  if (m) m.style.display = 'none';
  window.scrollUnlock?.();
}
window.closeWishShare = closeWishShare;

function ensureWishShareModal() {
  if (document.getElementById('wishshare-modal')) return;
  const m = document.createElement('div');
  m.id = 'wishshare-modal';
  m.className = 'modal';
  m.style.display = 'none';
  m.onclick = (e) => { if (e.target === m) closeWishShare(); };
  m.innerHTML = `
    <div class="modal__sheet wishshare__sheet">
      <button class="cat-modal__close" onclick="closeWishShare()">×</button>
      <div class="wishshare__h">🎁 Поделиться wishlist'ом</div>
      <div class="wishshare__sub"><b id="wishshare-count">0</b> позиций в избранном</div>

      <div id="wishshare-create">
        <textarea class="rv-writer__text" id="wishshare-msg" placeholder="Привет! Вот что я бы хотел на ДР 🎂 (необязательно)" maxlength="200" rows="3"></textarea>

        <div class="wishshare__hint">
          Получатель откроет ссылку → увидит твой список и сможет заказать всё одной кнопкой
        </div>

        <div class="wishshare__actions">
          <button class="btn-outline" onclick="closeWishShare()">Отмена</button>
          <button class="btn-full" id="wishshare-submit" onclick="createWishShare()">Создать ссылку</button>
        </div>
        <div class="rv-writer__err" id="wishshare-err" style="display:none"></div>
      </div>

      <div id="wishshare-link" style="display:none">
        <div class="wishshare__link-box">
          <div class="wishshare__link-url" id="wishshare-link-url"></div>
          <button class="wishshare__link-copy" data-haptic="light" onclick="copyWishShareLink()">Копировать</button>
        </div>
        <div class="wishshare__hint" id="wishshare-link-hint">Ссылка действует 90 дней</div>
        <div class="wishshare__actions">
          <button class="btn-outline" onclick="closeWishShare()">Закрыть</button>
          <button class="btn-full" data-haptic="medium" onclick="shareWishShareLink()">Поделиться в Telegram</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(m);
}

let _lastWishShareUrl = '';

async function createWishShare() {
  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || '';
  const wishlist = (window.wishLoad ? window.wishLoad() : []).map(Number).filter((n) => n > 0);
  const message = (document.getElementById('wishshare-msg')?.value || '').trim().slice(0, 200);
  const errEl = document.getElementById('wishshare-err');
  const submitBtn = document.getElementById('wishshare-submit');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  if (!initData) {
    if (errEl) { errEl.textContent = 'Открой Mini App через Telegram'; errEl.style.display = ''; }
    return;
  }
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Создаём…'; }
  try {
    const r = await fetch('/api/wishlist/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'tma ' + initData },
      body: JSON.stringify({ product_ids: wishlist, message }),
    });
    if (r.status === 429) {
      if (errEl) { errEl.textContent = 'Слишком много ссылок за сутки. Попробуй завтра.'; errEl.style.display = ''; }
      return;
    }
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      const msg = data?.error === 'wishlist_empty' ? 'Wishlist пуст' : (data?.error || 'Не удалось создать ссылку');
      if (errEl) { errEl.textContent = msg; errEl.style.display = ''; }
      return;
    }
    const data = await r.json();
    _lastWishShareUrl = data.url || '';
    document.getElementById('wishshare-link-url').textContent = data.url;
    document.getElementById('wishshare-create').style.display = 'none';
    document.getElementById('wishshare-link').style.display = '';
    window.haptic?.('success');
  } catch (e) {
    if (errEl) { errEl.textContent = 'Ошибка сети'; errEl.style.display = ''; }
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Создать ссылку'; }
  }
}
window.createWishShare = createWishShare;

function copyWishShareLink() {
  if (!_lastWishShareUrl) return;
  // Fallback на legacy execCommand для iOS-Telegram, где navigator.clipboard может быть недоступен
  try {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(_lastWishShareUrl);
    } else {
      const t = document.createElement('textarea');
      t.value = _lastWishShareUrl;
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      document.body.removeChild(t);
    }
    const btn = document.querySelector('.wishshare__link-copy');
    if (btn) { btn.textContent = '✓ Скопировано'; setTimeout(() => { btn.textContent = 'Копировать'; }, 1500); }
    window.haptic?.('success');
  } catch {}
}
window.copyWishShareLink = copyWishShareLink;

function shareWishShareLink() {
  if (!_lastWishShareUrl) return;
  const tg = window.Telegram?.WebApp;
  const wishlist = (window.wishLoad ? window.wishLoad() : []).map(Number).filter((n) => n > 0);
  const ownerName = (tg?.initDataUnsafe?.user?.first_name || '').trim();
  const intro = ownerName ? `${ownerName} делится wishlist'ом` : 'Wishlist из кондитерской «Мария»';
  const body = `🎁 ${intro}\n${wishlist.length} ${wishlist.length === 1 ? 'позиция' : wishlist.length < 5 ? 'позиции' : 'позиций'} ждут заказа\n\nОткрой 👇`;
  // Telegram даёт нативный share через t.me/share/url?url=...&text=...
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(_lastWishShareUrl)}&text=${encodeURIComponent(body)}`;
  if (tg?.openTelegramLink) tg.openTelegramLink(shareUrl);
  else window.open(shareUrl, '_blank');
  window.haptic?.('medium');
}
window.shareWishShareLink = shareWishShareLink;

// ── B. Получение wishlist по коду (deep-link wish_XXXX) ────────────────────
async function openSharedWishlist(code) {
  const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
  if (!c) return;
  ensureSharedWishlistModal();
  const m = document.getElementById('shared-wishlist-modal');
  const body = document.getElementById('shared-wishlist-body');
  m.style.display = 'flex';
  body.innerHTML = '<div class="cat-loading">Загружаем wishlist…</div>';
  window.scrollLock?.();
  try {
    const r = await fetch(`/api/wishlist/share/${c}`, { cache: 'no-store' });
    if (r.status === 404) {
      body.innerHTML = `
        <div class="rv-empty" style="padding:30px 16px">
          <div class="rv-empty__ic">⏱</div>
          <div class="rv-empty__h">Ссылка просрочена или не найдена</div>
          <div class="rv-empty__s">Попроси отправителя создать новую</div>
        </div>`;
      return;
    }
    if (!r.ok) throw new Error('fetch_failed');
    const data = await r.json();
    renderSharedWishlist(data);
  } catch (e) {
    body.innerHTML = '<div class="cat-empty">Не удалось загрузить</div>';
  }
}
window.openSharedWishlist = openSharedWishlist;

function closeSharedWishlist() {
  const m = document.getElementById('shared-wishlist-modal');
  if (m) m.style.display = 'none';
  window.scrollUnlock?.();
}
window.closeSharedWishlist = closeSharedWishlist;

function ensureSharedWishlistModal() {
  if (document.getElementById('shared-wishlist-modal')) return;
  const m = document.createElement('div');
  m.id = 'shared-wishlist-modal';
  m.className = 'cat-modal';
  m.style.display = 'none';
  m.onclick = (e) => { if (e.target === m) closeSharedWishlist(); };
  m.innerHTML = `
    <div class="cat-modal__sheet">
      <button class="cat-modal__close" onclick="closeSharedWishlist()">×</button>
      <div id="shared-wishlist-body"></div>
    </div>`;
  document.body.appendChild(m);
}

function renderSharedWishlist(data) {
  const body = document.getElementById('shared-wishlist-body');
  if (!body) return;
  const owner = data.owner_name || 'Друг';
  const products = Array.isArray(data.products) ? data.products : [];
  const message = (data.message || '').trim();
  const total = products.reduce((sum, p) => sum + (Number(p.priceNumber) || Number(String(p.price || '').replace(/\D/g, '')) || 0), 0);

  const productsHtml = products.length > 0 ? `
    <div class="shared-wish__list">
      ${products.map((p) => {
        const priceTxt = p.price || (p.priceNumber ? `${Number(p.priceNumber).toLocaleString('ru-RU')} ₽` : '');
        const imgEl = p.image
          ? `<img class="shared-wish__img" src="/img?u=${encodeURIComponent(p.image)}" alt="${escapeAttr(p.name)}" loading="lazy">`
          : '<span class="shared-wish__noimg">🍰</span>';
        return `
          <div class="shared-wish__item" onclick="catOpenProduct(${p.id})">
            ${imgEl}
            <div class="shared-wish__info">
              <div class="shared-wish__name">${escapeHtml(p.name)}</div>
              <div class="shared-wish__price">${escapeHtml(priceTxt)}</div>
            </div>
            <button class="shared-wish__add" data-haptic="light" onclick="event.stopPropagation();sharedWishAddOne(${p.id})">+</button>
          </div>`;
      }).join('')}
    </div>` : `
    <div class="rv-empty" style="padding:30px 16px">
      <div class="rv-empty__ic">🍰</div>
      <div class="rv-empty__h">Все позиции из wishlist'а распроданы</div>
      <div class="rv-empty__s">Загляни в меню — наверняка найдётся похожее</div>
    </div>`;

  body.innerHTML = `
    <div class="shared-wish__head">
      <div class="shared-wish__title">🎁 ${escapeHtml(owner)} делится wishlist'ом</div>
      ${message ? `<div class="shared-wish__msg">${escapeHtml(message)}</div>` : ''}
      <div class="shared-wish__sub">${products.length} ${products.length === 1 ? 'позиция' : products.length < 5 ? 'позиции' : 'позиций'} · сумма ~ ${total.toLocaleString('ru-RU')} ₽</div>
    </div>
    ${productsHtml}
    ${products.length > 0 ? `
      <div class="shared-wish__actions">
        <button class="btn-outline" onclick="closeSharedWishlist()">Закрыть</button>
        <button class="btn-full" data-haptic="medium" onclick="sharedWishAddAll()">Добавить всё в корзину</button>
      </div>
    ` : ''}
  `;
  // Сохраняем продукты для add-all
  window._sharedWishProducts = products;
}

function sharedWishAddOne(productId) {
  const p = (window._sharedWishProducts || []).find((x) => x.id === productId);
  if (!p) return;
  if (window.cartAdd) {
    window.cartAdd({ id: p.id, name: p.name, price: p.price || p.priceNumber || 0, image: p.image });
    window.haptic?.('success');
  }
}
window.sharedWishAddOne = sharedWishAddOne;

function sharedWishAddAll() {
  const products = window._sharedWishProducts || [];
  if (products.length === 0) return;
  if (!window.cartAdd) return;
  for (const p of products) {
    window.cartAdd({ id: p.id, name: p.name, price: p.price || p.priceNumber || 0, image: p.image });
  }
  window.haptic?.('success');
  closeSharedWishlist();
  // Переход в каталог чтобы показать корзину/чекаут
  if (typeof window.switchTab === 'function') {
    window.switchTab('menu');
    setTimeout(() => window.cartOpen?.(), 250);
  }
}
window.sharedWishAddAll = sharedWishAddAll;

// ── C. Handle deep-link при старте Mini App ────────────────────────────────
function handleWishShareDeepLink() {
  const tg = window.Telegram?.WebApp;
  // start_param из ?startapp=wish_M3X7K2P9
  let startParam = tg?.initDataUnsafe?.start_param || '';
  // Fallback: URL ?wish=M3X7K2P9 (если открыли в браузере не через TG)
  if (!startParam) {
    try {
      const u = new URL(window.location.href);
      const wishParam = u.searchParams.get('wish');
      if (wishParam) startParam = 'wish_' + wishParam;
    } catch {}
  }
  if (!startParam || !startParam.startsWith('wish_')) return;
  const code = startParam.slice(5);
  if (!code) return;
  // Ждём чтобы catalog/cart успели инициализироваться, потом открываем
  setTimeout(() => openSharedWishlist(code), 400);
}
document.addEventListener('DOMContentLoaded', handleWishShareDeepLink);

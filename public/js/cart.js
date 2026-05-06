/* ── Корзина: храним в localStorage, оформляем через POST /api/order ────── */

const CART_KEY = 'maria_cart_v1';
const _cartInitData = window.Telegram?.WebApp?.initData ?? '';

function cartLoad() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function cartSave(items) {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
  } catch {}
  cartUpdateBadge();
}

function cartCount() {
  return cartLoad().reduce((s, it) => s + (Number(it.qty) || 0), 0);
}

function cartUpdateBadge() {
  const btn = document.getElementById('hdr-cart');
  const n = document.getElementById('hdr-cart-count');
  if (!btn || !n) return;
  const c = cartCount();
  n.textContent = c;
  btn.style.display = c > 0 ? '' : 'none';
}

function cartAdd(product) {
  const items = cartLoad();
  const existing = items.find((x) => Number(x.id) === Number(product.id));
  if (existing) {
    existing.qty = (Number(existing.qty) || 0) + 1;
  } else {
    items.push({
      id:    Number(product.id),
      name:  String(product.name || ''),
      price: Number(product.price || 0),
      image: product.image ? String(product.image) : null,
      qty:   1,
    });
  }
  cartSave(items);
  cartFlash(product.name);
  return items;
}

function cartFlash(productName) {
  const tg = window.Telegram?.WebApp;
  tg?.HapticFeedback?.notificationOccurred?.('success');
  // Простой toast
  let toast = document.getElementById('cart-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'cart-toast';
    toast.className = 'cart-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = `🛒 «${productName}» в корзине`;
  toast.classList.add('show');
  clearTimeout(window.__cartToastT);
  window.__cartToastT = setTimeout(() => toast.classList.remove('show'), 2000);
}

function cartSetQty(productId, qty) {
  const items = cartLoad();
  const it = items.find((x) => Number(x.id) === Number(productId));
  if (!it) return;
  if (qty <= 0) {
    cartSave(items.filter((x) => Number(x.id) !== Number(productId)));
  } else {
    it.qty = Number(qty);
    cartSave(items);
  }
  cartRender();
}

function cartRemove(productId) {
  cartSave(cartLoad().filter((x) => Number(x.id) !== Number(productId)));
  cartRender();
}

function cartClear() {
  cartSave([]);
  cartRender();
}

function cartTotal() {
  return cartLoad().reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
}

/* ── UI ──────────────────────────────────────────────────────────────────── */

function cartOpen() {
  const m = document.getElementById('cart-modal');
  if (!m) return;
  m.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  cartRender();
}

function cartClose() {
  const m = document.getElementById('cart-modal');
  if (m) m.style.display = 'none';
  document.body.style.overflow = '';
}

function cartRender(view) {
  const wrap = document.getElementById('cart-body');
  if (!wrap) return;
  const items = cartLoad();

  if (items.length === 0) {
    wrap.innerHTML = `
      <button class="cat-modal__close" onclick="cartClose()">×</button>
      <div class="cart-empty">
        <div class="cart-empty__ic">🛒</div>
        <div class="cart-empty__h">Корзина пуста</div>
        <div class="cart-empty__sub">Открой меню и выбери что-нибудь вкусное</div>
        <button class="btn-full" onclick="cartClose();switchTab('menu')">К меню →</button>
      </div>`;
    return;
  }

  if (view === 'checkout') {
    cartRenderCheckout();
    return;
  }

  const lines = items.map((it) => {
    const sum = (Number(it.price) || 0) * (Number(it.qty) || 0);
    const img = it.image
      ? `<div class="cart-i__img" style="background-image:url('${escAttr(it.image)}')"></div>`
      : `<div class="cart-i__img"><span style="opacity:.4;font-size:24px">🍰</span></div>`;
    return `
      <div class="cart-i" data-id="${it.id}">
        ${img}
        <div class="cart-i__body">
          <div class="cart-i__name">${escHtml(it.name)}</div>
          <div class="cart-i__sum">${Number(it.price).toLocaleString('ru-RU')} ₽ × ${it.qty} = <b>${sum.toLocaleString('ru-RU')} ₽</b></div>
          <div class="cart-i__qty">
            <button onclick="cartSetQty(${it.id}, ${it.qty - 1})">−</button>
            <span>${it.qty}</span>
            <button onclick="cartSetQty(${it.id}, ${it.qty + 1})">+</button>
            <button class="cart-i__del" onclick="cartRemove(${it.id})">Удалить</button>
          </div>
        </div>
      </div>`;
  }).join('');

  wrap.innerHTML = `
    <button class="cat-modal__close" onclick="cartClose()">×</button>
    <div class="cart-h">🛒 Корзина · ${cartCount()} шт.</div>
    <div class="cart-list">${lines}</div>
    <div class="cart-foot">
      <div class="cart-total">Итого: <b>${cartTotal().toLocaleString('ru-RU')} ₽</b></div>
      <button class="btn-outline" onclick="cartClear()">Очистить</button>
      <button class="btn-full" onclick="cartRender('checkout')">Оформить →</button>
    </div>
  `;
}

function cartRenderCheckout() {
  const wrap = document.getElementById('cart-body');
  if (!wrap) return;
  const tg = window.Telegram?.WebApp;
  const u = tg?.initDataUnsafe?.user;
  const defName = u ? `${u.first_name || ''} ${u.last_name || ''}`.trim() : '';
  const tomorrow = new Date(Date.now() + 86400000);
  const dd = String(tomorrow.getDate()).padStart(2, '0');
  const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const yy = tomorrow.getFullYear();
  const tomorrowStr = `${dd}.${mm}.${yy}`;

  wrap.innerHTML = `
    <button class="cat-modal__close" onclick="cartClose()">×</button>
    <div class="cart-h">📝 Оформление заказа</div>
    <div class="cart-form">
      <label>Имя <span style="color:var(--red)">*</span>
        <input id="co-name" type="text" placeholder="Как к вам обращаться" value="${escAttr(defName)}" />
      </label>
      <label>Телефон <span style="color:var(--red)">*</span>
        <input id="co-phone" type="tel" placeholder="+7 999 123-45-67" />
      </label>
      <label>Адрес доставки <span style="color:#aaa">(если самовывоз — оставь пустым)</span>
        <input id="co-address" type="text" placeholder="г Иркутск, ул ..." />
      </label>
      <label>Дата
        <input id="co-date" type="text" value="${tomorrowStr}" placeholder="dd.mm.yyyy" />
      </label>
      <label>Время
        <input id="co-time" type="text" placeholder="10:00–12:00" />
      </label>
      <label>Комментарий
        <textarea id="co-comment" rows="2" placeholder="Уточнения для менеджера"></textarea>
      </label>
      <div class="cart-form__hint">Менеджер позвонит для подтверждения. Оплата при получении.</div>
      <div class="cart-total" style="margin-top:8px">К оплате: <b>${cartTotal().toLocaleString('ru-RU')} ₽</b></div>
      <button class="btn-outline" onclick="cartRender()">← Назад в корзину</button>
      <button class="btn-full" onclick="cartSubmit()">Оформить заказ</button>
      <div class="cart-form__status" id="co-status"></div>
    </div>
  `;
}

async function cartSubmit() {
  const name    = document.getElementById('co-name')?.value?.trim() || '';
  const phone   = document.getElementById('co-phone')?.value?.trim() || '';
  const address = document.getElementById('co-address')?.value?.trim() || '';
  const date    = document.getElementById('co-date')?.value?.trim() || '';
  const time    = document.getElementById('co-time')?.value?.trim() || '';
  const comment = document.getElementById('co-comment')?.value?.trim() || '';
  const status  = document.getElementById('co-status');

  if (!name || !phone) {
    if (status) status.innerHTML = '<span style="color:var(--red)">Заполни имя и телефон</span>';
    return;
  }

  const items = cartLoad().map((it) => ({ id: Number(it.id), qty: Number(it.qty) }));
  if (items.length === 0) {
    if (status) status.innerHTML = '<span style="color:var(--red)">Корзина пуста</span>';
    return;
  }

  if (status) status.innerHTML = '⏳ Отправляем заказ…';

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (_cartInitData) headers['Authorization'] = 'tma ' + _cartInitData;
    const res = await fetch('/api/order', {
      method: 'POST', headers,
      body: JSON.stringify({
        name, phone, address, items,
        delivery_date: date, delivery_time: time, comment,
        useVerifiedPhone: !phone,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      const userMsg = data.message || data.error || 'Не удалось отправить заказ';
      if (status) status.innerHTML = `<span style="color:var(--red)">${escHtml(String(userMsg))}</span>`;
      console.error('[cart] order failed', res.status, data);
      return;
    }
    cartClear();
    document.getElementById('cart-body').innerHTML = `
      <button class="cat-modal__close" onclick="cartClose()">×</button>
      <div class="cart-success">
        <div class="cart-success__ic">🎉</div>
        <div class="cart-success__h">Заказ #${data.orderId} принят!</div>
        <div class="cart-success__sub">${escHtml(data.message || 'Менеджер свяжется для подтверждения')}</div>
        <div class="cart-total">Сумма: <b>${Number(data.total || 0).toLocaleString('ru-RU')} ₽</b></div>
        <button class="btn-full" onclick="cartClose()">Готово</button>
      </div>`;
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success');
  } catch (e) {
    if (status) status.innerHTML = `<span style="color:var(--red)">Сеть недоступна. Попробуй ещё раз.</span>`;
  }
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
function escAttr(s) {
  return String(s ?? '').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}

window.cartOpen = cartOpen;
window.cartClose = cartClose;
window.cartAdd = cartAdd;
window.cartSetQty = cartSetQty;
window.cartRemove = cartRemove;
window.cartClear = cartClear;
window.cartRender = cartRender;
window.cartSubmit = cartSubmit;

document.addEventListener('DOMContentLoaded', () => {
  cartUpdateBadge();
});

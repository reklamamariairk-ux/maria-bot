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
  const prev = Number(n.textContent) || 0;
  if (window.tweenNumber && prev !== c) {
    window.tweenNumber(n, prev, c, 350);
  } else {
    n.textContent = c;
  }
  btn.style.display = c > 0 ? '' : 'none';
  if (prev !== c) {
    btn.classList.add('cart-bump');
    setTimeout(() => btn.classList.remove('cart-bump'), 350);
  }
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
  window.haptic?.('success');
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

function cartClearConfirm() {
  const tg = window.Telegram?.WebApp;
  if (tg?.showConfirm) {
    tg.showConfirm('Очистить корзину?', (ok) => { if (ok) cartClear(); });
    return;
  }
  if (confirm('Очистить корзину?')) cartClear();
}
window.cartClearConfirm = cartClearConfirm;

function cartTotal() {
  return cartLoad().reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
}

/* ── UI ──────────────────────────────────────────────────────────────────── */

function cartOpen() {
  const m = document.getElementById('cart-modal');
  if (!m) return;
  m.style.display = 'flex';
  window.scrollLock?.();
  // Telegram BackButton — нативная "← назад" вверху TG
  window.tgBack?.show(() => cartClose());
  cartRender();
}

function cartClose() {
  const m = document.getElementById('cart-modal');
  if (m) m.style.display = 'none';
  window.scrollUnlock?.();
  window.tgBack?.hide();
  window.tgMain?.hide();
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
      ? `<div class="cart-i__img"><img src="/img?u=${encodeURIComponent(it.image)}" alt="" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover;display:block"></div>`
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
      <button class="btn-outline" onclick="cartClearConfirm()">Очистить</button>
      <button class="btn-full cart-foot__cta" onclick="cartRender('checkout')">Оформить →</button>
    </div>
  `;
  // Нативная Telegram MainButton — снизу, прилипает к клавиатуре
  const total = cartTotal().toLocaleString('ru-RU');
  window.tgMain?.show(`Оформить · ${total} ₽`, () => cartRender('checkout'));
}

// Сохранённые данные клиента для повторного оформления
const CHECKOUT_KEY = 'maria_checkout_v1';
function checkoutLoad() {
  try { return JSON.parse(localStorage.getItem(CHECKOUT_KEY) || '{}'); }
  catch { return {}; }
}
function checkoutSave(d) {
  try { localStorage.setItem(CHECKOUT_KEY, JSON.stringify(d)); } catch {}
}
function fmtDate(d) {
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
}
function dateLabel(offset) {
  const d = new Date(Date.now() + offset * 86400000);
  return fmtDate(d);
}

function cartRenderCheckout() {
  const wrap = document.getElementById('cart-body');
  if (!wrap) return;
  const tg = window.Telegram?.WebApp;
  const u = tg?.initDataUnsafe?.user;
  const tgName = u ? `${u.first_name || ''} ${u.last_name || ''}`.trim() : '';
  const saved = checkoutLoad();
  const defName    = saved.name    || tgName || '';
  const defPhone   = saved.phone   || '';
  const defAddress = saved.address || '';
  const defDate    = saved.date    || dateLabel(1); // завтра по умолчанию
  const defTime    = saved.time    || '';

  // Дата-чипы: сегодня/завтра/послезавтра/+5 дней
  const dateChips = [
    { v: dateLabel(0), label: 'Сегодня' },
    { v: dateLabel(1), label: 'Завтра' },
    { v: dateLabel(2), label: 'Послезавтра' },
    { v: dateLabel(5), label: '+5 дней' },
  ];
  const timeChips = ['10:00–12:00','12:00–14:00','14:00–16:00','16:00–18:00','18:00–20:00'];

  wrap.innerHTML = `
    <button class="cat-modal__close" onclick="cartClose()">×</button>
    <div class="cart-h">Оформление заказа</div>
    <div class="cart-form">
      <label>Имя <span class="lbl-req">*</span>
        <input id="co-name" type="text" placeholder="Как к вам обращаться" value="${escAttr(defName)}" autocomplete="name" />
      </label>
      <label>Телефон <span class="lbl-req">*</span>
        <input id="co-phone" type="tel" placeholder="+7 (999) 123-45-67" value="${escAttr(defPhone)}" inputmode="tel" autocomplete="tel" oninput="phoneMask(this)" />
      </label>
      <label>Адрес доставки <span class="lbl-hint">(пусто = самовывоз)</span>
        <input id="co-address" type="text" placeholder="г Иркутск, ул ..." value="${escAttr(defAddress)}" autocomplete="street-address" />
      </label>
      <label>Дата доставки</label>
      <div class="chip-group" id="co-date-chips">
        ${dateChips.map((c) => `<button type="button" class="chip-pick${c.v === defDate ? ' chip-pick--on' : ''}" data-haptic="selection" onclick="pickDate('${c.v}',this)">${c.label}<small>${c.v.slice(0,5)}</small></button>`).join('')}
      </div>
      <input id="co-date" type="hidden" value="${escAttr(defDate)}" />
      <label>Время доставки</label>
      <div class="chip-group" id="co-time-chips">
        ${timeChips.map((t) => `<button type="button" class="chip-pick${t === defTime ? ' chip-pick--on' : ''}" data-haptic="selection" onclick="pickTime('${t}',this)">${t}</button>`).join('')}
      </div>
      <input id="co-time" type="hidden" value="${escAttr(defTime)}" />
      <label>Комментарий
        <textarea id="co-comment" rows="2" placeholder="Уточнения для менеджера"></textarea>
      </label>
      <div class="cart-form__hint">Менеджер позвонит для подтверждения. Оплата при получении.</div>
      <div class="cart-total" style="margin-top:8px">К оплате: <b>${cartTotal().toLocaleString('ru-RU')} ₽</b></div>
      <button class="btn-outline" onclick="cartRender()">← Назад в корзину</button>
      <button class="btn-full cart-foot__cta" onclick="cartSubmit()">Оформить заказ</button>
      <div class="cart-form__status" id="co-status"></div>
    </div>
  `;
  const total = cartTotal().toLocaleString('ru-RU');
  window.tgMain?.show(`Подтвердить заказ · ${total} ₽`, () => cartSubmit());
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

  // Берём только корректные позиции — id > 0, qty > 0
  const rawItems = cartLoad();
  const items = rawItems
    .map((it) => ({ id: Number(it.id), qty: Number(it.qty) }))
    .filter((it) => it.id > 0 && it.qty > 0);
  if (items.length === 0) {
    const reason = rawItems.length > 0
      ? `В корзине ${rawItems.length} позиций, но ни одной с валидным id. Очистите корзину и добавьте товары заново.`
      : 'Корзина пуста';
    if (status) status.innerHTML = `<span style="color:var(--red)">${escHtml(reason)}</span>`;
    return;
  }

  if (status) status.innerHTML = '⏳ Отправляем заказ…';
  window.tgMain?.progress(true);

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
      const tech = data.error && data.error !== userMsg ? ` <small style="opacity:.6">[${escHtml(String(data.error))}]</small>` : '';
      if (status) status.innerHTML = `<span style="color:var(--red)">${escHtml(String(userMsg))}</span>${tech}`;
      window.haptic?.('error');
      window.tgMain?.progress(false);
      console.error('[cart] order failed', res.status, data);
      return;
    }
    // Запоминаем для будущих заказов
    checkoutSave({ name, phone, address, date, time });
    // Сохраняем последний заказ для возможности «повторить»
    try {
      const lastOrder = items.map((it) => {
        const cartItem = rawItems.find((x) => Number(x.id) === Number(it.id));
        return cartItem ? { id: it.id, qty: it.qty, name: cartItem.name, price: cartItem.price, image: cartItem.image } : null;
      }).filter(Boolean);
      localStorage.setItem('maria_last_order', JSON.stringify(lastOrder));
    } catch {}
    cartClear();
    window.tgMain?.hide();
    document.getElementById('cart-body').innerHTML = `
      <button class="cat-modal__close" onclick="cartClose()">×</button>
      <div class="cart-success">
        <div class="cart-success__ic">🎉</div>
        <div class="cart-success__h">Заказ #${data.orderId} принят!</div>
        <div class="cart-success__sub">${escHtml(data.message || 'Менеджер свяжется для подтверждения')}</div>
        <div class="cart-total">Сумма: <b>${Number(data.total || 0).toLocaleString('ru-RU')} ₽</b></div>
        <button class="btn-outline" data-haptic="medium" onclick="cartRepeatLast()">↻ Повторить такой же заказ</button>
        <button class="btn-full" onclick="cartClose()">Готово</button>
      </div>`;
    window.haptic?.('success');
  } catch (e) {
    if (status) status.innerHTML = `<span style="color:var(--red)">Сеть недоступна. Попробуй ещё раз.</span>`;
    window.haptic?.('error');
    window.tgMain?.progress(false);
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

/* ── Helpers: phoneMask, pickDate, pickTime ─────────────────────────────── */
function phoneMask(inp) {
  if (!inp) return;
  let v = inp.value.replace(/\D/g, '');
  if (v.startsWith('8')) v = '7' + v.slice(1);
  if (!v.startsWith('7')) v = '7' + v;
  v = v.slice(0, 11);
  let f = '+7';
  if (v.length > 1) f += ' (' + v.slice(1, 4);
  if (v.length >= 4) f += ') ';
  if (v.length >= 4) f += v.slice(4, 7);
  if (v.length >= 7) f += '-' + v.slice(7, 9);
  if (v.length >= 9) f += '-' + v.slice(9, 11);
  inp.value = f.trim();
}
function pickDate(val, btn) {
  document.getElementById('co-date').value = val;
  document.querySelectorAll('#co-date-chips .chip-pick').forEach((b) => b.classList.remove('chip-pick--on'));
  if (btn) btn.classList.add('chip-pick--on');
}
function pickTime(val, btn) {
  document.getElementById('co-time').value = val;
  document.querySelectorAll('#co-time-chips .chip-pick').forEach((b) => b.classList.remove('chip-pick--on'));
  if (btn) btn.classList.add('chip-pick--on');
}

// Восстановить последний заказ — кладём товары обратно в корзину
function cartRepeatLast() {
  let last;
  try { last = JSON.parse(localStorage.getItem('maria_last_order') || '[]'); } catch { return; }
  if (!Array.isArray(last) || last.length === 0) return;
  for (const it of last) {
    if (!it.id || !window.cartAdd) continue;
    cartAdd({ id: it.id, name: it.name, price: it.price, image: it.image });
  }
  window.haptic?.('success');
  cartRender();
}

window.cartRepeatLast = cartRepeatLast;
window.phoneMask = phoneMask;
window.pickDate = pickDate;
window.pickTime = pickTime;
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

/* ── Корзина: храним в localStorage, оформляем через POST /api/order ────── */

const CART_KEY = 'maria_cart_v1';

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
  cartSyncDebounced(items);
}
let _cartSyncT = null;
function cartSyncDebounced(items) {
  if (_cartSyncT) clearTimeout(_cartSyncT);
  _cartSyncT = setTimeout(() => {
    if (!App.isAuthed()) return;
    fetch('/api/cart/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...App.authHeader() },
      body: JSON.stringify({ items: Array.isArray(items) ? items.map((x) => ({ id: Number(x.id), qty: Number(x.qty)||0, price: Number(x.price)||0, name: x.name })) : [] }),
    }).catch(() => {});
  }, 1500);
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
  App.confirm('Очистить корзину?').then((ok) => { if (ok) cartClear(); });
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
  document.body.classList.add('cart-open'); // opaque overlay (фикс прозрачного фона)
  window.scrollLock?.();
  window.tgBack?.show(() => cartClose());
  cartRender();
}

function cartClose() {
  const m = document.getElementById('cart-modal');
  if (m) m.style.display = 'none';
  document.body.classList.remove('cart-open');
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

  // Хинты: cashback (по уровню клуба из LK), free delivery, min order
  const total = cartTotal();
  const FREE_DELIVERY_MIN = 1000;
  const MIN_ORDER = 300;
  // Уровень/процент берём из LK через window._cachedLkLevel (записывается club.js).
  // Если уровень неизвестен (не подключён клуб / нет verified phone) — показываем
  // диапазон 5-10%, а не конкретное число (никаких выдумок).
  const lvlPct = Number(window._cachedLkLevelPct) || 0;
  const cashback = lvlPct > 0 ? Math.round(total * lvlPct / 100) : 0;
  const remaining = Math.max(0, FREE_DELIVERY_MIN - total);
  const freeDeliveryHtml = remaining > 0
    ? `<div class="cart-hint cart-hint--info">🚚 Ещё <b>${remaining.toLocaleString('ru-RU')} ₽</b> до бесплатной доставки</div>`
    : `<div class="cart-hint cart-hint--success">✓ Доставка бесплатно</div>`;
  const cashbackHtml = total >= MIN_ORDER
    ? (lvlPct > 0
        ? `<div class="cart-hint cart-hint--bonus">💎 <b>+${cashback.toLocaleString('ru-RU')} ₽</b> кэшбэка после заказа (${lvlPct}%)</div>`
        : `<div class="cart-hint cart-hint--bonus">💎 Кэшбэк 5–10% баллами — подключи клуб в профиле</div>`)
    : '';
  const minOrderHtml = total < MIN_ORDER
    ? `<div class="cart-hint cart-hint--warn">⚠ Минимальный заказ ${MIN_ORDER} ₽ — добавьте ещё на ${(MIN_ORDER - total).toLocaleString('ru-RU')} ₽</div>`
    : '';
  const canCheckout = total >= MIN_ORDER;

  wrap.innerHTML = `
    <button class="cat-modal__close" onclick="cartClose()">×</button>
    <div class="cart-h">🛒 Корзина · ${cartCount()} шт.</div>
    <div class="cart-list">${lines}</div>
    <div class="cart-hints">
      ${freeDeliveryHtml}
      ${cashbackHtml}
      ${minOrderHtml}
    </div>
    <div class="cart-foot">
      <div class="cart-total">Итого: <b>${total.toLocaleString('ru-RU')} ₽</b></div>
      <button class="btn-outline" onclick="cartClearConfirm()">Очистить</button>
      <button class="btn-full cart-foot__cta" ${canCheckout ? '' : 'disabled style="opacity:.5;cursor:not-allowed"'} onclick="${canCheckout ? "cartRender('checkout')" : ''}">Оформить →</button>
    </div>
  `;
  // Нативная Telegram MainButton — снизу, прилипает к клавиатуре
  const totalLabel = total.toLocaleString('ru-RU');
  if (canCheckout) {
    window.tgMain?.show(`Оформить · ${totalLabel} ₽`, () => cartRender('checkout'));
  } else {
    window.tgMain?.hide?.();
  }
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
  const u = App.user();
  const tgName = u ? `${u.first_name || ''} ${u.last_name || ''}`.trim() : '';
  const saved = checkoutLoad();
  // Auto-fill адреса: 1) saved checkout 2) Profile default address 3) пусто
  const profileAddresses = (() => { try { return (typeof addrLoad === 'function') ? addrLoad() : []; } catch { return []; } })();
  const profileDefaultAddr = profileAddresses.find((a) => a.isDefault) || profileAddresses[0];
  const profileAddress = profileDefaultAddr?.address || (() => { try { return localStorage.getItem('maria_default_address') || ''; } catch { return ''; } })();
  const defName    = saved.name    || tgName || '';
  const defPhone   = saved.phone   || '';
  const defAddress = saved.address || profileAddress || '';
  const defDate    = saved.date    || dateLabel(1);
  const defTime    = saved.time    || '';
  const defType    = saved.deliveryType || (defAddress ? 'delivery' : 'delivery');
  const defShop    = saved.shopId  || '';
  const defGift    = saved.gift === true;
  const defPromo   = saved.promo   || '';

  // Items summary — compact list для checkout
  const items = cartLoad();
  const itemsHtml = items.map((it) => {
    const sum = (Number(it.price) || 0) * (Number(it.qty) || 0);
    const img = it.image
      ? `<img src="/img?u=${encodeURIComponent(it.image)}" alt="" loading="lazy"/>`
      : `<span class="co-sum__ph">🍰</span>`;
    return `
      <div class="co-sum__row">
        <div class="co-sum__img">${img}</div>
        <div class="co-sum__body">
          <div class="co-sum__name">${escHtml(it.name)}</div>
          <div class="co-sum__meta">${it.qty} × ${Number(it.price).toLocaleString('ru-RU')} ₽</div>
        </div>
        <div class="co-sum__price">${sum.toLocaleString('ru-RU')} ₽</div>
      </div>`;
  }).join('');

  // Дата-чипы
  const dateChips = [
    { v: dateLabel(0), label: 'Сегодня' },
    { v: dateLabel(1), label: 'Завтра' },
    { v: dateLabel(2), label: 'Послезавтра' },
    { v: dateLabel(5), label: '+5 дней' },
  ];
  const timeChips = ['10:00–12:00','12:00–14:00','14:00–16:00','16:00–18:00','18:00–20:00'];

  // Breakdown
  const subtotal = cartTotal();
  const FREE_DELIVERY_MIN = 1000;
  const deliveryFee = (defType === 'pickup' || subtotal >= FREE_DELIVERY_MIN) ? 0 : 250;
  const total = subtotal + deliveryFee;
  const cashback = Math.round(subtotal * 0.05);

  wrap.innerHTML = `
    <button class="cat-modal__close" onclick="cartClose()">×</button>
    <div class="cart-h">Оформление заказа</div>

    <!-- Summary заказа -->
    <details class="co-summary" open>
      <summary class="co-summary__head">
        <span>Состав заказа · ${items.length} ${items.length === 1 ? 'товар' : items.length < 5 ? 'товара' : 'товаров'}</span>
        <span class="co-summary__chev">▾</span>
      </summary>
      <div class="co-summary__list">${itemsHtml}</div>
    </details>

    <div class="cart-form">
      <!-- Самовывоз / Доставка tabs -->
      <div class="co-deltype">
        <button type="button" class="co-deltype__tab${defType === 'delivery' ? ' co-deltype__tab--on' : ''}" onclick="coSetDelType('delivery')">
          🚚 Доставка${deliveryFee === 0 ? ' · бесплатно' : ' · 250 ₽'}
        </button>
        <button type="button" class="co-deltype__tab${defType === 'pickup' ? ' co-deltype__tab--on' : ''}" onclick="coSetDelType('pickup')">
          🏬 Самовывоз · 0 ₽
        </button>
      </div>
      <input id="co-deltype" type="hidden" value="${escAttr(defType)}" />

      <label>Имя <span class="lbl-req">*</span>
        <input id="co-name" type="text" placeholder="Как к вам обращаться" value="${escAttr(defName)}" autocomplete="name" />
      </label>
      <label>Телефон <span class="lbl-req">*</span>
        <input id="co-phone" type="tel" placeholder="+7 (999) 123-45-67" value="${escAttr(defPhone)}" inputmode="tel" autocomplete="tel" oninput="phoneMask(this)" />
      </label>

      <!-- Адрес или Кафе (зависит от deltype) -->
      <div id="co-address-block" style="${defType === 'delivery' ? '' : 'display:none'}">
        ${profileAddresses.length >= 1 ? `
          <div class="co-addr-chips" role="tablist" aria-label="Сохранённые адреса">
            ${profileAddresses.map((a) => `
              <button type="button" class="co-addr-chip${defAddress === a.address ? ' co-addr-chip--on' : ''}" onclick="coPickSavedAddress('${escAttr(a.id)}')">
                ${escHtml(a.label || 'Адрес')}
              </button>`).join('')}
            <button type="button" class="co-addr-chip co-addr-chip--new" onclick="coAddNewAddress()">+ Новый</button>
          </div>` : ''}
        <label>Адрес доставки <span class="lbl-req">*</span>
          <input id="co-address" type="text" placeholder="г Иркутск, ул ..." value="${escAttr(defAddress)}" autocomplete="street-address" />
        </label>
      </div>
      <div id="co-shop-block" style="${defType === 'pickup' ? '' : 'display:none'}">
        <label>Кафе для самовывоза <span class="lbl-req">*</span>
          <button type="button" class="co-shop-btn" id="co-shop-btn" onclick="coOpenShopPicker()">${defShop ? escHtml(defShop) : 'Выберите кафе →'}</button>
        </label>
        <input id="co-shop" type="hidden" value="${escAttr(defShop)}" />
      </div>

      <label>Дата ${defType === 'pickup' ? 'самовывоза' : 'доставки'}</label>
      <div class="chip-group" id="co-date-chips">
        ${dateChips.map((c) => `<button type="button" class="chip-pick${c.v === defDate ? ' chip-pick--on' : ''}" data-haptic="selection" onclick="pickDate('${c.v}',this)">${c.label}<small>${c.v.slice(0,5)}</small></button>`).join('')}
      </div>
      <input id="co-date-picker" type="date" class="co-date-picker" value="${escAttr(defDate)}" min="${dateLabel(0)}" onchange="coPickCustomDate(this.value)" />
      <input id="co-date" type="hidden" value="${escAttr(defDate)}" />

      <label>Время</label>
      <div class="chip-group" id="co-time-chips">
        ${timeChips.map((t) => `<button type="button" class="chip-pick${t === defTime ? ' chip-pick--on' : ''}" data-haptic="selection" onclick="pickTime('${t}',this)">${t}</button>`).join('')}
      </div>
      <input id="co-time" type="hidden" value="${escAttr(defTime)}" />

      <!-- Подарочная упаковка checkbox -->
      <label class="co-checkbox">
        <input id="co-gift" type="checkbox" ${defGift ? 'checked' : ''} />
        <span class="co-checkbox__t">🎁 Подарочная упаковка</span>
        <span class="co-checkbox__s">Бесплатно, фирменная коробка с лентой</span>
      </label>

      <!-- Promo code field -->
      <label>Промокод <span class="lbl-hint">(если есть)</span>
        <div class="co-promo-row">
          <input id="co-promo" type="text" placeholder="Например, MARIA10" value="${escAttr(defPromo)}"
                 oninput="this.value=this.value.toUpperCase()" onblur="coValidatePromo()" autocapitalize="characters" autocomplete="off" />
          <button type="button" class="co-promo-apply" onclick="coValidatePromo()">Применить</button>
        </div>
        <div class="co-promo-status" id="co-promo-status" style="display:none"></div>
      </label>

      <label>Комментарий
        <textarea id="co-comment" rows="2" placeholder="Уточнения для менеджера"></textarea>
      </label>
      <div class="cart-form__hint">Менеджер позвонит для подтверждения. Оплата при получении.</div>

      <!-- Breakdown -->
      <div class="co-breakdown" data-subtotal="${subtotal}" data-delivery="${deliveryFee}">
        <div class="co-breakdown__row"><span>Товары</span><b>${subtotal.toLocaleString('ru-RU')} ₽</b></div>
        <div class="co-breakdown__row"><span>${defType === 'pickup' ? 'Самовывоз' : 'Доставка'}</span><b>${deliveryFee === 0 ? 'бесплатно' : deliveryFee.toLocaleString('ru-RU') + ' ₽'}</b></div>
        <div class="co-breakdown__row co-breakdown__row--discount" id="co-discount-row" style="display:none">
          <span>🎟 Промокод <span id="co-discount-code"></span></span>
          <b id="co-discount-val">−0 ₽</b>
        </div>
        ${cashback > 0 ? `<div class="co-breakdown__row co-breakdown__row--bonus"><span>💎 Кэшбэк (5%, после заказа)</span><b>+${cashback.toLocaleString('ru-RU')} ₽</b></div>` : ''}
        <div class="co-breakdown__row co-breakdown__row--total"><span>Итого</span><b id="co-total-val">${total.toLocaleString('ru-RU')} ₽</b></div>
      </div>

      <button class="btn-outline" onclick="cartRender()">← Назад в корзину</button>
      <button class="btn-full cart-foot__cta" onclick="cartSubmit()">Оформить заказ · ${total.toLocaleString('ru-RU')} ₽</button>
      <div class="cart-form__status" id="co-status"></div>
    </div>
  `;
  window.tgMain?.show(`Подтвердить · ${total.toLocaleString('ru-RU')} ₽`, () => cartSubmit());
}

// Применённый промокод — храним в cart-state, передаём в submit
window._coAppliedPromo = null;

async function coValidatePromo() {
  const inp = document.getElementById('co-promo');
  const status = document.getElementById('co-promo-status');
  const code = (inp?.value || '').trim().toUpperCase();
  if (!code) {
    coClearPromo();
    return;
  }
  if (status) {
    status.style.display = '';
    status.className = 'co-promo-status co-promo-status--checking';
    status.textContent = 'Проверяем…';
  }
  // Считаем cart_total из breakdown data-attrs
  const bd = document.querySelector('.co-breakdown');
  const subtotal = Number(bd?.dataset?.subtotal) || 0;
  const delivery = Number(bd?.dataset?.delivery) || 0;
  const cartTotal = subtotal + delivery;
  try {
    const r = await fetch('/api/promo/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...App.authHeader() },
      body: JSON.stringify({ code, cart_total: cartTotal }),
    });
    const data = await r.json();
    if (data?.ok) {
      window._coAppliedPromo = { code: data.code, discount: data.discount, description: data.description, type: data.type, value: data.value };
      coRenderDiscount(data);
      if (status) {
        status.className = 'co-promo-status co-promo-status--ok';
        status.textContent = `✓ ${data.description || code}: −${Number(data.discount || 0).toLocaleString('ru-RU')} ₽`;
      }
      // Сохраняем код в localStorage чтоб не вводить второй раз
      const saved = checkoutLoad();
      saved.promo = code;
      checkoutSave(saved);
      window.haptic?.('success');
    } else {
      window._coAppliedPromo = null;
      coClearDiscount();
      if (status) {
        status.className = 'co-promo-status co-promo-status--err';
        status.textContent = '✗ ' + (data?.message || 'Промокод не работает');
      }
      window.haptic?.('error');
    }
  } catch {
    if (status) {
      status.className = 'co-promo-status co-promo-status--err';
      status.textContent = '✗ Ошибка сети';
    }
  }
}
window.coValidatePromo = coValidatePromo;

function coClearPromo() {
  window._coAppliedPromo = null;
  coClearDiscount();
  const status = document.getElementById('co-promo-status');
  if (status) { status.style.display = 'none'; status.textContent = ''; }
}
window.coClearPromo = coClearPromo;

function coRenderDiscount(data) {
  const row = document.getElementById('co-discount-row');
  const valEl = document.getElementById('co-discount-val');
  const codeEl = document.getElementById('co-discount-code');
  const totalEl = document.getElementById('co-total-val');
  if (!row || !valEl || !totalEl) return;
  const discount = Number(data.discount || 0);
  if (discount <= 0) { coClearDiscount(); return; }
  row.style.display = '';
  valEl.textContent = `−${discount.toLocaleString('ru-RU')} ₽`;
  if (codeEl) codeEl.textContent = `(${data.code})`;
  // Пересчёт total
  const bd = document.querySelector('.co-breakdown');
  const subtotal = Number(bd?.dataset?.subtotal) || 0;
  const delivery = Number(bd?.dataset?.delivery) || 0;
  const newTotal = Math.max(0, subtotal + delivery - discount);
  totalEl.textContent = `${newTotal.toLocaleString('ru-RU')} ₽`;
  // Обновляем кнопку Telegram MainButton
  if (window.tgMain?.show) window.tgMain.show(`Подтвердить · ${newTotal.toLocaleString('ru-RU')} ₽`, () => cartSubmit());
}

function coClearDiscount() {
  const row = document.getElementById('co-discount-row');
  const totalEl = document.getElementById('co-total-val');
  if (row) row.style.display = 'none';
  if (totalEl) {
    const bd = document.querySelector('.co-breakdown');
    const subtotal = Number(bd?.dataset?.subtotal) || 0;
    const delivery = Number(bd?.dataset?.delivery) || 0;
    const total = subtotal + delivery;
    totalEl.textContent = `${total.toLocaleString('ru-RU')} ₽`;
    if (window.tgMain?.show) window.tgMain.show(`Подтвердить · ${total.toLocaleString('ru-RU')} ₽`, () => cartSubmit());
  }
}

// Переключение Доставка/Самовывоз
function coSetDelType(type) {
  const hiddenInput = document.getElementById('co-deltype');
  if (hiddenInput) hiddenInput.value = type;
  // Сохраняем
  const saved = checkoutLoad();
  saved.deliveryType = type;
  checkoutSave(saved);
  // Re-render checkout
  cartRenderCheckout();
  window.haptic?.('selection');
}
window.coSetDelType = coSetDelType;

// Saved address chips → подставить в input
function coPickSavedAddress(id) {
  const list = (typeof addrLoad === 'function') ? addrLoad() : [];
  const a = list.find((x) => x.id === id);
  if (!a) return;
  const input = document.getElementById('co-address');
  if (input) {
    input.value = a.address || '';
    const saved = checkoutLoad();
    saved.address = a.address;
    checkoutSave(saved);
  }
  document.querySelectorAll('.co-addr-chip').forEach((c) => c.classList.remove('co-addr-chip--on'));
  const btn = document.querySelector(`.co-addr-chip[onclick*="${id}"]`);
  if (btn) btn.classList.add('co-addr-chip--on');
  window.haptic?.('selection');
}
window.coPickSavedAddress = coPickSavedAddress;

function coAddNewAddress() {
  const label = prompt('Название (например, Дом / Работа / Бабушка):');
  if (!label) return;
  const address = prompt('Адрес (Иркутск, ул. X, кв Y):');
  if (!address) return;
  const list = (typeof addrLoad === 'function') ? addrLoad() : [];
  const isFirst = list.length === 0;
  list.push({
    id: 'a_' + Date.now(),
    label: label.trim(),
    address: address.trim(),
    isDefault: isFirst,
  });
  try {
    localStorage.setItem('maria_addresses_v1', JSON.stringify(list));
    const def = list.find((a) => a.isDefault) || list[0];
    if (def) localStorage.setItem('maria_default_address', def.address);
  } catch {}
  const input = document.getElementById('co-address');
  if (input) {
    input.value = address.trim();
    const saved = checkoutLoad();
    saved.address = address.trim();
    checkoutSave(saved);
  }
  cartRenderCheckout();
  window.haptic?.('success');
}
window.coAddNewAddress = coAddNewAddress;

// Custom date picker (beyond chips)
function coPickCustomDate(v) {
  const hidden = document.getElementById('co-date');
  if (hidden) hidden.value = v;
  // Снимаем active со всех chip
  document.querySelectorAll('#co-date-chips .chip-pick').forEach((c) => c.classList.remove('chip-pick--on'));
  window.haptic?.('selection');
}
window.coPickCustomDate = coPickCustomDate;

// Выбор кафе для самовывоза
// Haversine distance в км между двумя точками
function _haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

let _shopPickerData = null;
let _userLoc = null;

async function coOpenShopPicker() {
  let modal = document.getElementById('shop-picker-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'shop-picker-modal';
    modal.className = 'cat-modal';
    modal.style.display = 'none';
    modal.onclick = (e) => { if (e.target === modal) coCloseShopPicker(); };
    modal.innerHTML = `
      <div class="cat-modal__sheet">
        <button class="cat-modal__close" onclick="coCloseShopPicker()">×</button>
        <div class="shop-picker__h">Выберите кафе</div>
        <button class="shop-picker__geo" id="shop-picker-geo" onclick="coRequestLocation()">📍 Найти ближайшее</button>
        <div class="shop-picker__list" id="shop-picker-list"><div class="cat-loading">Загружаем адреса…</div></div>
      </div>`;
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  // Грузим реальные кафе из /api/shops с кешем
  if (!_shopPickerData) {
    try {
      const r = await fetch('/api/shops', { cache: 'force-cache' });
      const d = await r.json();
      _shopPickerData = Array.isArray(d?.shops) ? d.shops : [];
    } catch { _shopPickerData = []; }
  }
  if (_shopPickerData.length === 0) {
    // Fallback на хардкод
    _shopPickerData = [
      { id: 'lenina-1', address: 'ул. Ленина, 1', name: 'ул. Ленина, 1' },
      { id: 'karla-marksa-24', address: 'ул. Карла Маркса, 24', name: 'ул. Карла Маркса, 24' },
      { id: 'sovetskaya-58', address: 'ул. Советская, 58', name: 'ул. Советская, 58' },
    ];
  }
  renderShopPicker();
}
window.coOpenShopPicker = coOpenShopPicker;

function renderShopPicker() {
  const list = document.querySelector('#shop-picker-list');
  if (!list) return;
  let shops = (_shopPickerData || []).slice();
  // Сортируем по дистанции если есть user location
  if (_userLoc) {
    shops = shops
      .map((s) => {
        const rawLat = s.lat ?? s.latitude ?? null;
        const rawLon = s.lon ?? s.longitude ?? null;
        const lat = Number(rawLat);
        const lon = Number(rawLon);
        // Считаем дистанцию только если координаты реальные (не null, не 0,0)
        const valid = Number.isFinite(lat) && Number.isFinite(lon)
          && Math.abs(lat) > 0.1 && Math.abs(lon) > 0.1;
        let dist = valid ? _haversineKm(_userLoc.lat, _userLoc.lon, lat, lon) : null;
        // Если кафе оказалось > 500 км — координаты явно мусорные
        if (dist != null && dist > 500) dist = null;
        return { ...s, _dist: dist };
      })
      .sort((a, b) => {
        if (a._dist == null && b._dist == null) return 0;
        if (a._dist == null) return 1;
        if (b._dist == null) return -1;
        return a._dist - b._dist;
      });
  }
  list.innerHTML = shops.map((s) => {
    const label = s.address || s.name || '';
    let distTxt = '';
    if (s._dist != null) {
      if (s._dist < 0.1) {
        // < 100m скорее всего fallback на центр города, не показываем
        distTxt = '';
      } else if (s._dist < 1) {
        distTxt = `<span class="shop-picker__dist">${Math.round(s._dist * 1000)} м</span>`;
      } else {
        distTxt = `<span class="shop-picker__dist">${s._dist.toFixed(1)} км</span>`;
      }
    }
    return `
      <button class="shop-picker__item" onclick="coPickShop('${escAttr(label)}')">
        <div class="shop-picker__pin">📍</div>
        <div class="shop-picker__body">
          <div class="shop-picker__name">${escHtml(label)}</div>
          <div class="shop-picker__area">${escHtml(s.area || s.city || s.hours || '')}</div>
        </div>
        ${distTxt}
      </button>`;
  }).join('');
}

function coRequestLocation() {
  const btn = document.getElementById('shop-picker-geo');
  if (!navigator.geolocation) {
    if (btn) btn.textContent = 'Геолокация не поддерживается';
    return;
  }
  if (btn) btn.textContent = '⏳ Получаем геолокацию…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      _userLoc = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      window.haptic?.('success');
      renderShopPicker();
      if (btn) {
        // Проверяем, есть ли вообще кафе с валидными координатами
        const hasAnyDist = (_shopPickerData || []).some((s) => {
          const lat = Number(s.lat ?? s.latitude);
          const lon = Number(s.lon ?? s.longitude);
          return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) > 0.1 && Math.abs(lon) > 0.1;
        });
        if (hasAnyDist) {
          btn.textContent = '✓ Отсортировано по близости';
          btn.classList.add('shop-picker__geo--ok');
        } else {
          btn.textContent = 'У кафе пока нет координат — сортировка скоро';
          btn.style.color = '#86868b';
        }
      }
    },
    () => {
      if (btn) btn.textContent = '📍 Доступ к геолокации запрещён';
    },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
  );
}
window.coRequestLocation = coRequestLocation;
function coCloseShopPicker() {
  const m = document.getElementById('shop-picker-modal');
  if (m) m.style.display = 'none';
}
window.coCloseShopPicker = coCloseShopPicker;
function coPickShop(name) {
  const hidden = document.getElementById('co-shop');
  const btn = document.getElementById('co-shop-btn');
  if (hidden) hidden.value = name;
  if (btn) btn.textContent = name;
  const saved = checkoutLoad();
  saved.shopId = name;
  checkoutSave(saved);
  coCloseShopPicker();
  window.haptic?.('selection');
}
window.coPickShop = coPickShop;

async function cartSubmit() {
  const name    = document.getElementById('co-name')?.value?.trim() || '';
  const phone   = document.getElementById('co-phone')?.value?.trim() || '';
  const deltype = document.getElementById('co-deltype')?.value?.trim() || 'delivery';
  const address = document.getElementById('co-address')?.value?.trim() || '';
  const shop    = document.getElementById('co-shop')?.value?.trim() || '';
  const date    = document.getElementById('co-date')?.value?.trim() || '';
  const time    = document.getElementById('co-time')?.value?.trim() || '';
  const gift    = !!document.getElementById('co-gift')?.checked;
  const promo   = document.getElementById('co-promo')?.value?.trim() || '';
  const comment = document.getElementById('co-comment')?.value?.trim() || '';
  const status  = document.getElementById('co-status');

  if (!name || !phone) {
    if (status) status.innerHTML = '<span style="color:var(--red)">Заполни имя и телефон</span>';
    return;
  }
  // Validation: для доставки нужен адрес, для самовывоза — кафе
  if (deltype === 'delivery' && !address) {
    if (status) status.innerHTML = '<span style="color:var(--red)">Укажите адрес доставки</span>';
    return;
  }
  if (deltype === 'pickup' && !shop) {
    if (status) status.innerHTML = '<span style="color:var(--red)">Выберите кафе для самовывоза</span>';
    return;
  }
  // Объединяем комментарий с дополнительной инфой
  const applied = window._coAppliedPromo;
  const promoNote = applied
    ? `🎟 Промокод ${applied.code} — СКИДКА ${Number(applied.discount).toLocaleString('ru-RU')} ₽ (${applied.description || ''})`
    : (promo ? `Промокод (не применён): ${promo}` : '');
  const extraNote = [
    gift ? '🎁 Подарочная упаковка' : '',
    promoNote,
    deltype === 'pickup' ? `Самовывоз: ${shop}` : '',
  ].filter(Boolean).join('\n');
  const fullComment = [comment, extraNote].filter(Boolean).join('\n');

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
    const headers = { 'Content-Type': 'application/json', ...App.authHeader() };
    // Address: для самовывоза передаём название кафе как address (backend остаётся unchanged)
    const finalAddress = deltype === 'pickup' ? `Самовывоз · ${shop}` : address;
    const res = await fetch('/api/order', {
      method: 'POST', headers,
      body: JSON.stringify({
        name, phone, address: finalAddress, items,
        delivery_date: date, delivery_time: time, comment: fullComment,
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
    // Регистрируем использование промокода (если применён)
    if (window._coAppliedPromo?.code) {
      try {
        fetch('/api/promo/use', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...App.authHeader() },
          body: JSON.stringify({ code: window._coAppliedPromo.code, order_id: String(data.orderId || '') }),
        }).catch(() => {});
      } catch {}
      window._coAppliedPromo = null;
    }
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

// escHtml/escAttr — алиасы на глобальные из utils.js (escapeHtml/escapeAttr).
const escHtml = window.escapeHtml;
const escAttr = window.escapeAttr;

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

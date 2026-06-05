/* ── Карта впечатлений — пост-заказная оценка ─────────────────────── */

const OR_STATE = {
  orderId: '',
  rating: 5,
  text: '',
  existing: null, // { rating, text, created_at }
};

const OR_LABELS = {
  1: '😞 Очень плохо',
  2: '😕 Плохо',
  3: '😐 Нормально',
  4: '🙂 Хорошо',
  5: '🤩 Отлично',
};

async function openOrderRating(orderId) {
  const id = String(orderId || '').trim();
  if (!id) return;
  OR_STATE.orderId = id;
  OR_STATE.rating = 5;
  OR_STATE.text = '';
  OR_STATE.existing = null;
  ensureOrderRatingModal();
  // Подгружаем существующую оценку (если уже оценивал — покажем как edit)
  if (App.isAuthed()) {
    try {
      const r = await fetch(`/api/order-rating/${encodeURIComponent(id)}`, {
        headers: { ...App.authHeader() }, cache: 'no-store',
      });
      if (r.ok) {
        const data = await r.json();
        if (data?.rating) {
          OR_STATE.existing = data.rating;
          OR_STATE.rating = data.rating.rating;
          OR_STATE.text = data.rating.text || '';
        }
      }
    } catch {}
  }
  renderOrderRating();
  document.getElementById('order-rating-modal').style.display = 'flex';
  window.scrollLock?.();
  window.haptic?.('light');
}
window.openOrderRating = openOrderRating;

function closeOrderRating() {
  const m = document.getElementById('order-rating-modal');
  if (m) m.style.display = 'none';
  window.scrollUnlock?.();
}
window.closeOrderRating = closeOrderRating;

function ensureOrderRatingModal() {
  if (document.getElementById('order-rating-modal')) return;
  const m = document.createElement('div');
  m.id = 'order-rating-modal';
  m.className = 'modal';
  m.style.display = 'none';
  m.onclick = (e) => { if (e.target === m) closeOrderRating(); };
  m.innerHTML = `
    <div class="modal__sheet rv-writer__sheet">
      <button class="cat-modal__close" onclick="closeOrderRating()">×</button>
      <div class="rv-writer__h" id="or-h">Как тебе заказ?</div>
      <div class="rv-writer__sub" id="or-sub">Заказ #—</div>

      <div class="rv-writer__rating" id="or-rating"></div>
      <div class="rv-writer__rating-lbl" id="or-rating-lbl">Отлично</div>

      <textarea class="rv-writer__text" id="or-text" placeholder="Что понравилось? Что можно улучшить? (необязательно)" maxlength="500" rows="3"></textarea>
      <div class="rv-writer__counter"><span id="or-counter">0</span> / 500</div>

      <div class="rv-writer__actions">
        <button class="btn-outline" onclick="closeOrderRating()">Позже</button>
        <button class="btn-full" id="or-submit" onclick="submitOrderRating()">Отправить</button>
      </div>
      <div class="rv-writer__err" id="or-err" style="display:none"></div>
    </div>`;
  document.body.appendChild(m);
}

function renderOrderRating() {
  const subEl = document.getElementById('or-sub');
  if (subEl) {
    const prefix = OR_STATE.existing ? 'Изменить оценку заказа' : 'Заказ';
    subEl.textContent = `${prefix} №${OR_STATE.orderId}`;
  }
  // Звёзды
  const ratingEl = document.getElementById('or-rating');
  if (ratingEl) {
    ratingEl.innerHTML = [1, 2, 3, 4, 5].map((i) => {
      const on = i <= OR_STATE.rating;
      return `<button class="rv-writer__star ${on ? 'rv-writer__star--on' : ''}"
                      data-haptic="selection" onclick="orSetRating(${i})" aria-label="${i} ★">${on ? '★' : '☆'}</button>`;
    }).join('');
  }
  const lblEl = document.getElementById('or-rating-lbl');
  if (lblEl) lblEl.textContent = OR_LABELS[OR_STATE.rating] || '';
  const textEl = document.getElementById('or-text');
  if (textEl) {
    textEl.value = OR_STATE.text;
    if (!textEl._hooked) {
      textEl.addEventListener('input', () => {
        OR_STATE.text = textEl.value.slice(0, 500);
        const c = document.getElementById('or-counter');
        if (c) c.textContent = OR_STATE.text.length;
      });
      textEl._hooked = true;
    }
  }
  const c = document.getElementById('or-counter');
  if (c) c.textContent = (OR_STATE.text || '').length;
}

function orSetRating(r) {
  OR_STATE.rating = Math.max(1, Math.min(5, Number(r) || 5));
  renderOrderRating();
  window.haptic?.('selection');
}
window.orSetRating = orSetRating;

async function submitOrderRating() {
  const errEl = document.getElementById('or-err');
  const submitBtn = document.getElementById('or-submit');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  if (!App.isAuthed()) {
    if (errEl) { errEl.textContent = 'Открой Mini App через Telegram'; errEl.style.display = ''; }
    return;
  }
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Отправляем…'; }
  try {
    const r = await fetch('/api/order-rating', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...App.authHeader() },
      body: JSON.stringify({
        order_id: OR_STATE.orderId,
        rating: OR_STATE.rating,
        text: OR_STATE.text,
      }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      if (errEl) { errEl.textContent = data?.error || 'Не удалось отправить'; errEl.style.display = ''; }
      return;
    }
    window.haptic?.('success');
    closeOrderRating();
    App.alert('Спасибо! Твоя оценка очень важна 💚');
  } catch {
    if (errEl) { errEl.textContent = 'Ошибка сети'; errEl.style.display = ''; }
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Отправить'; }
  }
}
window.submitOrderRating = submitOrderRating;

// Handle deep-link при старте Mini App: ?startapp=rate_<orderId>
function handleOrderRatingDeepLink() {
  const startParam = App.startParam();
  if (!startParam || !startParam.startsWith('rate_')) return;
  const orderId = startParam.slice(5);
  if (!orderId) return;
  setTimeout(() => openOrderRating(orderId), 400);
}
document.addEventListener('DOMContentLoaded', handleOrderRatingDeepLink);

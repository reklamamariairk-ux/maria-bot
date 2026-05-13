// Order tab — заявка на индивидуальный торт

let _orderPhotos = []; // массив dataURL до 3 шт
const ORDER_PHOTO_MAX = 3;

// Auto-fill из TG user + Профиль + сохранённые данные корзины
async function orderAutoFill() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('maria_checkout_v1') || '{}'); } catch {}
  const tg = window.Telegram?.WebApp?.initDataUnsafe?.user;
  const tgName = tg ? `${tg.first_name || ''} ${tg.last_name || ''}`.trim() : '';

  // Локальные fallback из localStorage / TG
  const nameEl = document.getElementById('of-name');
  const phoneEl = document.getElementById('of-phone');
  const dateEl = document.getElementById('of-date');
  if (nameEl && !nameEl.value) nameEl.value = saved.name || tgName || '';
  if (phoneEl && !phoneEl.value) phoneEl.value = saved.phone || '';

  // Date min — today+2 (48 часов на индивидуальный торт)
  if (dateEl) {
    const minDate = new Date(); minDate.setDate(minDate.getDate() + 2);
    const iso = minDate.toISOString().slice(0, 10);
    dateEl.min = iso;
    if (!dateEl.value) dateEl.value = iso;
  }

  // Auto-fill из /api/me (телефон маскированный — невозможно вернуть, но имя — да)
  const initData = window.Telegram?.WebApp?.initData || '';
  if (initData) {
    try {
      const r = await fetch('/api/me', { headers: { Authorization: 'tma ' + initData } });
      if (r.ok) {
        const me = await r.json();
        if (me.user?.first_name && nameEl && !nameEl.value) nameEl.value = me.user.first_name;
        // Phone из БД мы не показываем (только маскированный) — оставляем placeholder
      }
    } catch {}
  }
}
window.orderAutoFill = orderAutoFill;

// Chip single-pick (один из группы)
function ofPickChip(btn, hiddenId) {
  const group = btn.parentElement;
  group.querySelectorAll('.of-chip').forEach((c) => c.classList.remove('of-chip--on'));
  btn.classList.add('of-chip--on');
  const hidden = document.getElementById(hiddenId);
  if (hidden) hidden.value = btn.dataset.val || btn.textContent.trim();
  window.haptic?.('selection');
}
window.ofPickChip = ofPickChip;

// Chip multi-pick (множественный выбор — для начинки)
function ofToggleChip(btn, hiddenId) {
  btn.classList.toggle('of-chip--on');
  const group = btn.parentElement;
  const selected = [...group.querySelectorAll('.of-chip.of-chip--on')]
    .map((c) => c.dataset.val || c.textContent.trim());
  const hidden = document.getElementById(hiddenId);
  if (hidden) hidden.value = selected.join(', ');
  window.haptic?.('selection');
}
window.ofToggleChip = ofToggleChip;

// Порций ±/presets
function ofPortionsInc() {
  const inp = document.getElementById('of-portions');
  if (!inp) return;
  inp.value = Math.min(500, Math.max(1, (Number(inp.value) || 0) + 1));
  window.haptic?.('selection');
}
function ofPortionsDec() {
  const inp = document.getElementById('of-portions');
  if (!inp) return;
  inp.value = Math.max(1, (Number(inp.value) || 0) - 1);
  window.haptic?.('selection');
}
function ofSetPortions(n) {
  const inp = document.getElementById('of-portions');
  if (inp) inp.value = n;
  window.haptic?.('selection');
}
window.ofPortionsInc = ofPortionsInc;
window.ofPortionsDec = ofPortionsDec;
window.ofSetPortions = ofSetPortions;

// Multi-photo: до 3 шт
function orderPhotoAdd(input) {
  const files = input.files;
  if (!files || files.length === 0) return;
  const remaining = ORDER_PHOTO_MAX - _orderPhotos.length;
  const toProcess = [...files].slice(0, remaining);
  let processed = 0;
  toProcess.forEach((file) => {
    if (file.size > 4 * 1024 * 1024) {
      alert(`Фото "${file.name}" слишком большое (>4 MB). Пропускаем.`);
      processed++;
      if (processed === toProcess.length) finalizePhotos();
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 800;
        let w = img.width, h = img.height;
        if (w > h && w > maxDim) { h = h * maxDim / w; w = maxDim; }
        else if (h > maxDim) { w = w * maxDim / h; h = maxDim; }
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = cv.toDataURL('image/jpeg', 0.78);
        _orderPhotos.push(dataUrl);
        processed++;
        if (processed === toProcess.length) finalizePhotos();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
  input.value = '';
}
window.orderPhotoAdd = orderPhotoAdd;

function finalizePhotos() {
  // Render grid + сохранить в hidden JSON
  const grid = document.getElementById('of-photos-grid');
  const dataField = document.getElementById('of-photo-data');
  if (!grid) return;
  // Очистка (кроме add-кнопки)
  grid.querySelectorAll('.of-photo-cell:not(.of-photo-add)').forEach((c) => c.remove());
  _orderPhotos.forEach((url, idx) => {
    const cell = document.createElement('div');
    cell.className = 'of-photo-cell of-photo-cell--filled';
    cell.innerHTML = `
      <img src="${url}" alt="референс ${idx + 1}"/>
      <button type="button" class="of-photo-rm" onclick="orderPhotoRemove(${idx})" aria-label="Удалить">×</button>`;
    grid.insertBefore(cell, grid.querySelector('.of-photo-add'));
  });
  // Скрываем "+" если уже 3
  const addBtn = grid.querySelector('.of-photo-add');
  if (addBtn) addBtn.style.display = _orderPhotos.length >= ORDER_PHOTO_MAX ? 'none' : '';
  // Сохраняем JSON
  if (dataField) dataField.value = JSON.stringify(_orderPhotos);
  window.haptic?.('success');
}

function orderPhotoRemove(idx) {
  _orderPhotos.splice(idx, 1);
  finalizePhotos();
  window.haptic?.('selection');
}
window.orderPhotoRemove = orderPhotoRemove;

async function submitOrder(e) {
  e.preventDefault();

  const name        = document.getElementById('of-name').value.trim();
  const phone       = document.getElementById('of-phone').value.trim();
  const occasion    = document.getElementById('of-occasion')?.value || '';
  const style       = document.getElementById('of-style')?.value || '';
  const filling     = document.getElementById('of-filling')?.value || '';
  const budget      = document.getElementById('of-budget')?.value || '';
  const delivery    = document.getElementById('of-delivery')?.value || 'delivery';
  const date        = document.getElementById('of-date').value;
  const portions    = document.getElementById('of-portions').value;
  const comment     = document.getElementById('of-comment').value.trim();
  const terms       = document.getElementById('of-terms')?.checked;
  const photos      = _orderPhotos.slice(0, ORDER_PHOTO_MAX);

  const btn = document.getElementById('of-submit');
  const msg = document.getElementById('of-msg');

  if (phone.replace(/\D/g, '').length < 10) {
    showOrderMsg(msg, false, '❌ Укажи корректный номер телефона');
    window.haptic?.('error');
    return;
  }
  if (!terms) {
    showOrderMsg(msg, false, '⚠ Подтвердите согласие с условиями');
    window.haptic?.('error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Отправляем…';
  msg.style.display = 'none';
  window.tgMain?.progress(true);

  // Структурированное описание + комментарий
  const structParts = [
    occasion && `Повод: ${occasion}`,
    style && `Стиль: ${style}`,
    filling && `Начинка: ${filling}`,
    budget && `Бюджет: ${budget}`,
    delivery === 'pickup' && 'Самовывоз',
  ].filter(Boolean);
  const description = structParts.join(' · ');

  try {
    const res = await fetch('/api/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, phone, description, date, portions, comment,
        photo: photos[0] || '', // backend пока поддерживает 1 photo
        photos, // если backend будет multiple support
      }),
    });
    const data = await res.json();

    if (res.ok) {
      // Сохраняем данные клиента
      try {
        const prev = JSON.parse(localStorage.getItem('maria_checkout_v1') || '{}');
        localStorage.setItem('maria_checkout_v1', JSON.stringify({ ...prev, name, phone }));
      } catch {}
      window.haptic?.('success');
      // Confirmation modal вместо inline message
      showOrderConfirmModal();
      // Сброс формы
      document.getElementById('order-form').reset();
      _orderPhotos = []; finalizePhotos();
      // Сбрасываем chip-выбор
      document.querySelectorAll('#tab-order .of-chip--on').forEach((c) => c.classList.remove('of-chip--on'));
      // Восстанавливаем default delivery=true
      const defBtn = document.querySelector('#of-delivery-chips .of-chip[data-val="delivery"]');
      if (defBtn) defBtn.classList.add('of-chip--on');
      document.getElementById('of-delivery').value = 'delivery';
      // Default portions=8
      const port = document.getElementById('of-portions');
      if (port) port.value = 8;
    } else {
      throw new Error(data.error || 'Ошибка сервера');
    }
  } catch (err) {
    showOrderMsg(msg, false, '❌ ' + (err.message || 'Не удалось отправить заявку. Попробуйте ещё раз.'));
    window.haptic?.('error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Отправить заявку →';
    window.tgMain?.progress(false);
  }
}
window.submitOrder = submitOrder;

function showOrderMsg(el, ok, text) {
  if (!el) return;
  el.className = 'of-msg ' + (ok ? 'of-msg--ok' : 'of-msg--err');
  el.textContent = text;
  el.style.display = 'block';
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Confirmation modal — success state после submit
function showOrderConfirmModal() {
  let modal = document.getElementById('order-confirm-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'order-confirm-modal';
    modal.className = 'cat-modal';
    modal.style.display = 'none';
    modal.onclick = (e) => { if (e.target === modal) closeOrderConfirmModal(); };
    modal.innerHTML = `
      <div class="cat-modal__sheet" style="max-width:380px;text-align:center;padding:28px 24px">
        <div style="font-size:56px;line-height:1;margin-bottom:14px">🎂</div>
        <div style="font-family:'Playfair Display',serif;font-size:22px;font-weight:700;color:var(--text);letter-spacing:-.4px;margin-bottom:8px">Заявка принята!</div>
        <div style="font-size:14px;color:var(--muted);line-height:1.5;margin-bottom:18px">
          Менеджер свяжется по телефону в течение <b>1 часа</b> для уточнения деталей.<br>
          Готовый торт ждёт вас через <b>48 часов</b> после согласования.
        </div>
        <button class="btn-full" onclick="closeOrderConfirmModal()" style="margin-bottom:8px">Понятно</button>
        <button class="btn-outline" onclick="closeOrderConfirmModal();switchTab('menu')">Посмотреть готовые торты</button>
      </div>`;
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  window.scrollLock?.();
}
function closeOrderConfirmModal() {
  const m = document.getElementById('order-confirm-modal');
  if (m) m.style.display = 'none';
  window.scrollUnlock?.();
}
window.closeOrderConfirmModal = closeOrderConfirmModal;

// Auto-fill при загрузке вкладки
if (document.readyState !== 'loading') orderAutoFill();
else document.addEventListener('DOMContentLoaded', orderAutoFill);

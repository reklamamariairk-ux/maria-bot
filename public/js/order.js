// Auto-fill из сохранённых данных корзины
function orderAutoFill() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('maria_checkout_v1') || '{}'); } catch {}
  const tg = window.Telegram?.WebApp?.initDataUnsafe?.user;
  const tgName = tg ? `${tg.first_name || ''} ${tg.last_name || ''}`.trim() : '';
  const fields = {
    'of-name':  saved.name  || tgName || '',
    'of-phone': saved.phone || '',
  };
  for (const [id, val] of Object.entries(fields)) {
    const el = document.getElementById(id);
    if (el && !el.value && val) el.value = val;
  }
}

async function submitOrder(e) {
  e.preventDefault();

  const name      = document.getElementById('of-name').value.trim();
  const phone     = document.getElementById('of-phone').value.trim();
  const description = document.getElementById('of-desc').value.trim();
  const date      = document.getElementById('of-date').value;
  const portions  = document.getElementById('of-portions').value;
  const comment   = document.getElementById('of-comment').value.trim();
  const photo     = document.getElementById('of-photo-data')?.value || '';

  const btn = document.getElementById('of-submit');
  const msg = document.getElementById('of-msg');

  if (phone.replace(/\D/g, '').length < 10) {
    msg.className = 'of-msg of-msg--err';
    msg.textContent = '❌ Укажи корректный номер телефона';
    msg.style.display = 'block';
    window.haptic?.('error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Отправляем…';
  msg.style.display = 'none';
  window.tgMain?.progress(true);

  try {
    const res = await fetch('/api/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, description, date, portions, comment, photo }),
    });
    const data = await res.json();

    if (res.ok) {
      // Сохраняем данные клиента для следующего раза
      try {
        const prev = JSON.parse(localStorage.getItem('maria_checkout_v1') || '{}');
        localStorage.setItem('maria_checkout_v1', JSON.stringify({ ...prev, name, phone }));
      } catch {}
      msg.className = 'of-msg of-msg--ok';
      msg.textContent = '✅ Заявка принята! Менеджер свяжется с вами в ближайшее время.';
      msg.style.display = 'block';
      document.getElementById('order-form').reset();
      const preview = document.getElementById('of-photo-preview');
      if (preview) { preview.style.display = 'none'; preview.querySelector('img').src = ''; }
      window.haptic?.('success');
    } else {
      throw new Error(data.error || 'Ошибка сервера');
    }
  } catch (err) {
    msg.className = 'of-msg of-msg--err';
    msg.textContent = '❌ ' + (err.message || 'Не удалось отправить заявку. Попробуйте ещё раз.');
    msg.style.display = 'block';
    window.haptic?.('error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Отправить заявку →';
    window.tgMain?.progress(false);
    msg.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// Фото референса — конвертируем в data-url и шлём в comment
function orderPhotoChange(input) {
  const file = input.files && input.files[0];
  const preview = document.getElementById('of-photo-preview');
  const dataField = document.getElementById('of-photo-data');
  const previewImg = preview?.querySelector('img');
  if (!file) {
    if (preview) preview.style.display = 'none';
    if (dataField) dataField.value = '';
    return;
  }
  if (file.size > 4 * 1024 * 1024) {
    alert('Фото слишком большое (>4 MB). Сожми и попробуй ещё раз.');
    input.value = '';
    return;
  }
  // Resize & compress: рисуем в canvas 600px, выгружаем JPEG quality 0.8
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
      if (dataField) dataField.value = dataUrl;
      if (previewImg) {
        previewImg.src = dataUrl;
        preview.style.display = '';
      }
      window.haptic?.('selection');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

window.submitOrder = submitOrder;
window.orderPhotoChange = orderPhotoChange;
window.orderAutoFill = orderAutoFill;

// Auto-fill при загрузке вкладки
if (document.readyState !== 'loading') orderAutoFill();
else document.addEventListener('DOMContentLoaded', orderAutoFill);

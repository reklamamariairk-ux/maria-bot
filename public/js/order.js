async function submitOrder(e) {
  e.preventDefault();

  const name      = document.getElementById('of-name').value.trim();
  const phone     = document.getElementById('of-phone').value.trim();
  const description = document.getElementById('of-desc').value.trim();
  const date      = document.getElementById('of-date').value;
  const portions  = document.getElementById('of-portions').value;
  const comment   = document.getElementById('of-comment').value.trim();

  const btn = document.getElementById('of-submit');
  const msg = document.getElementById('of-msg');

  btn.disabled = true;
  btn.textContent = 'Отправляем…';
  msg.style.display = 'none';

  try {
    const res = await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, description, date, portions, comment }),
    });
    const data = await res.json();

    if (res.ok) {
      msg.className = 'of-msg of-msg--ok';
      msg.textContent = '✅ Заявка принята! Менеджер свяжется с вами в ближайшее время.';
      msg.style.display = 'block';
      document.getElementById('order-form').reset();
    } else {
      throw new Error(data.error || 'Ошибка сервера');
    }
  } catch (err) {
    msg.className = 'of-msg of-msg--err';
    msg.textContent = '❌ ' + (err.message || 'Не удалось отправить заявку. Попробуйте ещё раз.');
    msg.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Отправить заявку →';
    msg.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

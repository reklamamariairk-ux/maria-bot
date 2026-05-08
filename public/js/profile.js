/* ─── Profile tab ───────────────────────────────────────────────────────── */
let _profileLoaded = false;
let _profileData = null;

async function profileLoad(force) {
  if (_profileLoaded && !force) return _profileData;
  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData ?? "";
  if (!initData) {
    // Не открыто через Telegram — показываем гостевой режим
    profileRenderGuest();
    return null;
  }
  try {
    const r = await fetch('/api/me', { headers: { Authorization: 'tma ' + initData } });
    if (!r.ok) throw new Error('fetch /api/me failed');
    const data = await r.json();
    _profileData = data;
    _profileLoaded = true;
    profileRender(data);
    // Подгружаем заказы (LK) — отдельно, не блокируем рендер
    profileLoadOrdersCount();
    return data;
  } catch (e) {
    console.error('[profile] load:', e);
    profileRenderGuest();
    return null;
  }
}
window.profileLoad = profileLoad;

function profileRender(data) {
  const u = data.user || {};
  const av = document.getElementById('prof-av');
  const nameEl = document.getElementById('prof-name');
  const phoneEl = document.getElementById('prof-phone');
  const balanceEl = document.getElementById('prof-stat-balance');
  const ticketsEl = document.getElementById('prof-stat-tickets');
  const editBday = document.getElementById('prof-edit-bday');

  // Аватар: первая буква имени (или 👤)
  if (av && u.first_name) av.textContent = u.first_name[0]?.toUpperCase() || '👤';
  if (nameEl) nameEl.textContent = u.first_name || (u.username ? '@' + u.username : 'Гость');

  if (phoneEl) {
    if (data.phoneVerified) {
      phoneEl.innerHTML = '<span style="color:#16a34a">✓ Телефон подтверждён</span>';
    } else {
      phoneEl.innerHTML = '<a href="#" onclick="event.preventDefault();switchTab(\'club\')" style="color:var(--red);text-decoration:none">Подтвердите телефон в клубе →</a>';
    }
  }

  if (balanceEl && data.balance) {
    balanceEl.textContent = (data.balance.points ?? 0).toLocaleString('ru-RU');
  }
  if (ticketsEl && data.balance) {
    ticketsEl.textContent = (data.balance.tickets ?? 0);
  }

  // Если ДР не указан — показываем кнопку редактирования
  if (editBday) {
    editBday.style.display = data.birthday ? 'none' : 'flex';
  }
}

function profileRenderGuest() {
  const nameEl = document.getElementById('prof-name');
  const phoneEl = document.getElementById('prof-phone');
  const balanceEl = document.getElementById('prof-stat-balance');
  const ticketsEl = document.getElementById('prof-stat-tickets');
  if (nameEl) nameEl.textContent = 'Гость';
  if (phoneEl) phoneEl.textContent = 'Открой через Telegram, чтобы войти в клуб';
  if (balanceEl) balanceEl.textContent = '—';
  if (ticketsEl) ticketsEl.textContent = '—';
}

async function profileLoadOrdersCount() {
  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData ?? "";
  if (!initData) return;
  try {
    const r = await fetch('/api/lk', { headers: { Authorization: 'tma ' + initData } });
    if (!r.ok) return;
    const data = await r.json();
    const orders = Array.isArray(data?.data?.orders) ? data.data.orders : [];
    const ordersEl = document.getElementById('prof-stat-orders');
    if (ordersEl) ordersEl.textContent = orders.length;
    _profileData = { ..._profileData, orders };
  } catch {}
}

async function profOpenOrders() {
  const wrap = document.getElementById('prof-orders');
  const list = document.getElementById('prof-orders-list');
  if (!wrap || !list) return;
  wrap.style.display = 'block';
  // Скрываем основной контент профиля чтобы не дублировать
  document.querySelectorAll('#tab-profile > :not(#prof-orders)').forEach((el) => {
    el.dataset._wasDisplay = el.style.display || '';
    el.style.display = 'none';
  });

  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData ?? "";
  if (!initData) {
    list.innerHTML = '<div class="cat-empty">Открой через Telegram, чтобы видеть заказы.</div>';
    return;
  }

  list.innerHTML = '<div class="cat-loading">Загружаем заказы…</div>';
  try {
    const r = await fetch('/api/lk', { headers: { Authorization: 'tma ' + initData } });
    const data = await r.json();
    const d = data?.data || {};
    if (!d.configured) {
      list.innerHTML = '<div class="cat-empty">Личный кабинет ещё не настроен. Заглядывай позже.</div>';
      return;
    }
    if (!d.found) {
      list.innerHTML = '<div class="cat-empty">Привяжи номер в клубе — и здесь появятся твои заказы с сайта.</div>';
      return;
    }
    const orders = Array.isArray(d.orders) ? d.orders : [];
    if (orders.length === 0) {
      list.innerHTML = '<div class="cat-empty">Заказов пока нет. Загляни в меню!</div>';
      return;
    }
    list.innerHTML = orders.slice(0, 20).map((o) => {
      const items = Array.isArray(o.items) ? o.items.slice(0, 3).map((i) => `${i.qty}× ${i.name}`).join(', ') : '';
      const more = (o.items?.length ?? 0) > 3 ? ` +${o.items.length - 3}` : '';
      const sum = o.sum ? Number(o.sum).toLocaleString('ru-RU') + ' ₽' : '';
      const status = o.status || '';
      const paid = o.paid ? '<span style="color:#16a34a">✓ оплачен</span>' : '';
      return `
        <div class="prof-order">
          <div class="prof-order__head">
            <span class="prof-order__num">№ ${escAttr(String(o.id || ''))}</span>
            <span class="prof-order__date">${escAttr(o.date || '')}</span>
          </div>
          <div class="prof-order__items">${escAttr(items)}${more}</div>
          <div class="prof-order__foot">
            <span class="prof-order__sum">${escAttr(sum)}</span>
            <span class="prof-order__status">${escAttr(status)} ${paid}</span>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = '<div class="cat-empty">Не удалось загрузить заказы. Попробуйте позже.</div>';
  }
}
window.profOpenOrders = profOpenOrders;

function profCloseOrders() {
  const wrap = document.getElementById('prof-orders');
  if (wrap) wrap.style.display = 'none';
  document.querySelectorAll('#tab-profile > :not(#prof-orders)').forEach((el) => {
    el.style.display = el.dataset._wasDisplay ?? '';
    delete el.dataset._wasDisplay;
  });
}
window.profCloseOrders = profCloseOrders;

function profEditBday() {
  // Простой диалог через TG showAlert или нативный prompt
  const tg = window.Telegram?.WebApp;
  const ask = (cb) => {
    const v = prompt('Когда у тебя день рождения? (ДД.ММ или ДД.ММ.ГГГГ)');
    if (v) cb(v);
  };
  ask(async (raw) => {
    const m = raw.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/);
    if (!m) {
      tg?.showAlert?.('Введи в формате ДД.ММ, например 14.07') || alert('Введи в формате ДД.ММ');
      return;
    }
    const dd = m[1].padStart(2, '0'), mm = m[2].padStart(2, '0'), yy = m[3] ?? '';
    const date = yy ? `${yy}-${mm}-${dd}` : `${mm}-${dd}`;
    try {
      const r = await fetch('/api/birthday', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'tma ' + (tg?.initData ?? '') },
        body: JSON.stringify({ birthday: date }),
      });
      if (r.ok) {
        tg?.showAlert?.('Сохранено! 🎂') || alert('Сохранено!');
        profileLoad(true);
      }
    } catch {}
  });
}
window.profEditBday = profEditBday;

function escAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

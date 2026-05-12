/* ─── Profile tab ───────────────────────────────────────────────────────── */
let _profileLoaded = false;
let _profileData = null;

async function profileLoad(force) {
  if (_profileLoaded && !force) return _profileData;
  // Инфлейтим SVG-иконки в Профиле (chevronRight на каждой строке + badgeCheck)
  if (window.IconInflate) {
    const tab = document.getElementById('tab-profile');
    if (tab) window.IconInflate(tab);
  }
  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData ?? "";
  if (!initData) {
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
  const joinedEl = document.getElementById('prof-joined');
  const balanceEl = document.getElementById('prof-stat-balance');
  const ticketsEl = document.getElementById('prof-stat-tickets');
  const verifiedBadge = document.getElementById('prof-verified-badge');

  // Аватар: первая буква имени или ?
  if (av) av.textContent = u.first_name?.[0]?.toUpperCase() || '?';
  if (nameEl) nameEl.textContent = u.first_name || (u.username ? '@' + u.username : 'Гость');

  // Verified badge — blue checkmark рядом с именем
  if (verifiedBadge) verifiedBadge.style.display = data.phoneVerified ? 'inline-flex' : 'none';

  if (phoneEl) {
    if (data.phoneVerified) {
      phoneEl.textContent = 'Участник клуба';
    } else {
      phoneEl.innerHTML = '<a href="#" onclick="event.preventDefault();switchTab(\'club\')">Подтвердите телефон в клубе →</a>';
    }
  }

  // Дата регистрации: "В клубе с янв 2024"
  if (joinedEl) {
    if (data.joinedAt) {
      const d = new Date(data.joinedAt);
      if (!isNaN(d.getTime())) {
        const months = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
        joinedEl.textContent = `В клубе с ${months[d.getMonth()]} ${d.getFullYear()}`;
        joinedEl.style.display = '';
      } else {
        joinedEl.style.display = 'none';
      }
    } else {
      joinedEl.style.display = 'none';
    }
  }

  // Личные данные (раздел "Личные данные")
  const infoName = document.getElementById('prof-info-name');
  const infoPhone = document.getElementById('prof-info-phone');
  const infoBday = document.getElementById('prof-info-bday');
  if (infoName) infoName.textContent = u.first_name || (u.username ? '@' + u.username : '—');
  if (infoPhone) {
    if (data.phoneVerified && data.phoneMasked) {
      infoPhone.textContent = data.phoneMasked;
      infoPhone.style.color = 'var(--ap-ink)';
    } else if (data.phoneVerified) {
      infoPhone.textContent = 'подтверждён';
      infoPhone.style.color = '#16a34a';
    } else {
      infoPhone.textContent = 'подтвердить';
      infoPhone.style.color = 'var(--ap-red)';
    }
  }
  if (infoBday) {
    if (data.birthday) {
      const m = String(data.birthday).match(/^(?:\d{4}-)?(\d{2})-(\d{2})$/);
      if (m) {
        const day = Number(m[2]);
        const monthName = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'][Number(m[1]) - 1];
        infoBday.textContent = `${day} ${monthName}`;
        infoBday.style.color = 'var(--ap-ink)';
      } else {
        infoBday.textContent = String(data.birthday);
      }
    } else {
      infoBday.textContent = 'указать';
      infoBday.style.color = 'var(--ap-red)';
    }
  }

  // Баллы и билеты заполняются из LK (см. profileLoadOrdersCount)
  if (balanceEl) balanceEl.textContent = '—';
  if (ticketsEl) ticketsEl.textContent = '—';
}

function profileRenderGuest() {
  const av = document.getElementById('prof-av');
  const nameEl = document.getElementById('prof-name');
  const phoneEl = document.getElementById('prof-phone');
  const joinedEl = document.getElementById('prof-joined');
  const balanceEl = document.getElementById('prof-stat-balance');
  const ticketsEl = document.getElementById('prof-stat-tickets');
  const ordersEl = document.getElementById('prof-stat-orders');
  const verifiedBadge = document.getElementById('prof-verified-badge');
  const infoName = document.getElementById('prof-info-name');
  const infoPhone = document.getElementById('prof-info-phone');
  const infoBday = document.getElementById('prof-info-bday');
  if (av) av.textContent = '?';
  if (nameEl) nameEl.textContent = 'Гость';
  if (phoneEl) phoneEl.textContent = 'Открой через Telegram, чтобы войти в клуб';
  if (joinedEl) joinedEl.style.display = 'none';
  if (verifiedBadge) verifiedBadge.style.display = 'none';
  if (balanceEl) balanceEl.textContent = '—';
  if (ticketsEl) ticketsEl.textContent = '—';
  if (ordersEl) ordersEl.textContent = '—';
  if (infoName) infoName.textContent = '—';
  if (infoPhone) { infoPhone.textContent = 'не подтверждён'; infoPhone.style.color = 'var(--ap-grey)'; }
  if (infoBday) { infoBday.textContent = 'указать'; infoBday.style.color = 'var(--ap-red)'; }
}

async function profileLoadOrdersCount() {
  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData ?? "";
  if (!initData) return;
  try {
    const r = await fetch('/api/lk', { headers: { Authorization: 'tma ' + initData } });
    if (!r.ok) return;
    const data = await r.json();
    const lk = data?.data || {};
    const orders = Array.isArray(lk.orders) ? lk.orders : [];

    // Заполняем все 3 stat'а из LK (Bitrix-данные единственный источник)
    const ordersEl = document.getElementById('prof-stat-orders');
    const balanceEl = document.getElementById('prof-stat-balance');
    const ticketsEl = document.getElementById('prof-stat-tickets');
    if (ordersEl) ordersEl.textContent = orders.length;
    if (balanceEl) balanceEl.textContent = lk.found ? Number(lk.balance ?? 0).toLocaleString('ru-RU') : '—';
    if (ticketsEl) ticketsEl.textContent = lk.found ? (lk.tickets_count ?? 0) : '—';

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
    const fmtDate = window.formatRelativeDate || ((s) => s);
    const statusInfo = window.orderStatusInfo || (() => ({ label: '', cls: 'ord-tag--neutral' }));
    list.innerHTML = orders.slice(0, 20).map((o) => {
      const items = Array.isArray(o.items) ? o.items.slice(0, 3).map((i) => `${i.qty}× ${i.name}`).join(', ') : '';
      const more = (o.items?.length ?? 0) > 3 ? ` +${o.items.length - 3}` : '';
      const sum = o.sum ? Number(o.sum).toLocaleString('ru-RU') + ' ₽' : '';
      const status = statusInfo(o.status, o.paid);
      const dateText = fmtDate(o.date);
      return `
        <div class="prof-order">
          <div class="prof-order__head">
            <span class="prof-order__num">№ ${escAttr(String(o.id || ''))}</span>
            <span class="prof-order__date">${escAttr(dateText)}</span>
          </div>
          ${items ? `<div class="prof-order__items">${escAttr(items)}${more}</div>` : ''}
          <div class="prof-order__foot">
            <span class="prof-order__sum">${escAttr(sum)}</span>
            <span class="ord-tag ${o.canceled ? 'ord-tag--cancelled' : status.cls}">${escAttr(o.canceled ? '✗ Отменён' : status.label)}</span>
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

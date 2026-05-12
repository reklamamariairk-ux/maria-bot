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
// Экспорт для прямого вызова из тестов/моков
const _profileRenderRef = profileRender;
window.profileRender = _profileRenderRef;

function profileRender(data) {
  const u = data.user || {};
  const avInit = document.getElementById('prof-av-init');
  const avImg = document.getElementById('prof-av-img');
  const nameEl = document.getElementById('prof-name');
  const phoneEl = document.getElementById('prof-phone');
  const joinedEl = document.getElementById('prof-joined');
  const activityEl = document.getElementById('prof-activity');
  const balanceEl = document.getElementById('prof-stat-balance');
  const ticketsEl = document.getElementById('prof-stat-tickets');
  const verifiedBadge = document.getElementById('prof-verified-badge');

  // Аватар: photo_url из Telegram → fallback на инициал
  const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
  const photoUrl = tgUser?.photo_url || data.photoUrl;
  if (avInit) avInit.textContent = u.first_name?.[0]?.toUpperCase() || '?';
  if (avImg) {
    if (photoUrl) {
      avImg.src = photoUrl;
      avImg.style.display = '';
      avImg.onerror = () => { avImg.style.display = 'none'; };
    } else {
      avImg.style.display = 'none';
    }
  }
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

  // Активность: запусков · last seen
  if (activityEl) {
    const launches = Number(data.launchCount || 0);
    if (launches > 0) {
      activityEl.textContent = `${launches} ${pluralLaunch(launches)}`;
      activityEl.style.display = '';
    } else {
      activityEl.style.display = 'none';
    }
  }

  // ЛИЧНЫЕ ДАННЫЕ — Имя / Телефон (masked) / ДР
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

  // Destructive row "Отвязать телефон" виден только верифицированным
  const destrEl = document.getElementById('prof-destructive');
  if (destrEl) destrEl.style.display = data.phoneVerified ? '' : 'none';

  // Wishlist count
  const wishEl = document.getElementById('prof-info-wishcount');
  if (wishEl) {
    try {
      const wish = JSON.parse(localStorage.getItem('maria_wishlist') || '[]');
      wishEl.textContent = Array.isArray(wish) ? wish.length : 0;
    } catch { wishEl.textContent = 0; }
  }

  // Адрес доставки из localStorage
  const addrEl = document.getElementById('prof-info-address');
  if (addrEl) {
    const addr = localStorage.getItem('maria_default_address') || '';
    if (addr) {
      addrEl.textContent = addr.length > 28 ? addr.slice(0, 26) + '…' : addr;
      addrEl.style.color = 'var(--ap-ink)';
    } else {
      addrEl.textContent = 'указать';
      addrEl.style.color = 'var(--ap-red)';
    }
  }

  // Mini level-chip (если уровень есть в LK)
  // (заполняется в profileLoadOrdersCount после LK fetch)
}

function pluralLaunch(n) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'запуск';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'запуска';
  return 'запусков';
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

    // Mini level-chip в hero (если есть year_spent)
    const chipEl = document.getElementById('prof-level-chip');
    const nameChipEl = document.getElementById('prof-level-name');
    const progEl = document.getElementById('prof-level-prog');
    if (chipEl && lk.found && window.getCurrentLevel) {
      const cur = window.getCurrentLevel(Number(lk.year_spent || 0), lk.level || null);
      const CLUB_LEVELS = window.CLUB_LEVELS || [];
      const idx = CLUB_LEVELS.findIndex((l) => l && l.name === cur?.name);
      const next = idx >= 0 ? CLUB_LEVELS[idx + 1] : null;
      if (nameChipEl) nameChipEl.textContent = `${cur.name} · ${cur.pct}%`;
      if (progEl) {
        if (next) {
          const toGo = Math.max(0, next.threshold - Number(lk.year_spent || 0));
          progEl.textContent = `до ${next.name}: ${toGo.toLocaleString('ru-RU')} ₽`;
        } else {
          progEl.textContent = 'максимум';
        }
      }
      chipEl.style.display = '';
    } else if (chipEl) {
      chipEl.style.display = 'none';
    }

    _profileData = { ..._profileData, orders };
  } catch {}
}

// Wishlist preview — переключаемся в каталог с открытым избранным
function profOpenWishlist() {
  if (typeof window.switchTab === 'function') {
    window.switchTab('menu');
    setTimeout(() => { try { window.catShowWishlist?.(); } catch {} }, 250);
  }
}
window.profOpenWishlist = profOpenWishlist;

// Адрес доставки — простой prompt с сохранением в localStorage
function profEditAddress() {
  const tg = window.Telegram?.WebApp;
  const current = localStorage.getItem('maria_default_address') || '';
  const v = prompt('Адрес доставки по умолчанию:', current);
  if (v === null) return;
  const trimmed = String(v).trim();
  if (trimmed.length > 0) {
    localStorage.setItem('maria_default_address', trimmed);
  } else {
    localStorage.removeItem('maria_default_address');
  }
  tg?.HapticFeedback?.notificationOccurred?.('success');
  profileLoad(true);
}
window.profEditAddress = profEditAddress;

// Поделиться приложением через TG share-link
function profShareApp() {
  const tg = window.Telegram?.WebApp;
  const botName = 'mariatortik_bot'; // имя нашего бота
  const url = `https://t.me/${botName}`;
  const text = 'Кондитерская «Мария» — закажи торты, получай кэшбэк, участвуй в розыгрыше iPhone';
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  if (tg?.openTelegramLink) tg.openTelegramLink(shareUrl);
  else if (navigator.share) navigator.share({ title: 'Мария', text, url }).catch(()=>{});
  else window.open(shareUrl, '_blank');
}
window.profShareApp = profShareApp;

// Modal «О приложении» / Privacy / Terms
const ABOUT_CONTENT = {
  privacy: {
    title: 'Политика конфиденциальности',
    html: `<p>Мы собираем минимум данных, необходимых для работы программы лояльности и оформления заказов:</p>
      <h3>Какие данные мы используем</h3>
      <p>• Имя из Telegram-профиля<br>• Номер телефона (только при подтверждении в клубе)<br>• История заказов с сайта maria-irk.ru<br>• День рождения (если вы его указали)</p>
      <h3>Кому передаём</h3>
      <p>Только нашим внутренним системам: сайту maria-irk.ru, Bitrix24 для обработки заказов, базе клуба «Мария для своих». Третьим лицам не передаём.</p>
      <h3>Хранение</h3>
      <p>Данные хранятся столько, сколько вы пользуетесь приложением. Удалить телефон можно через «Отвязать» в Профиле.</p>`
  },
  terms: {
    title: 'Условия использования',
    html: `<p>Используя приложение, вы соглашаетесь с правилами кондитерской «Мария»:</p>
      <h3>Программа лояльности</h3>
      <p>• Кэшбэк начисляется баллами на сайте maria-irk.ru (5–10% в зависимости от уровня)<br>• Баллами можно оплатить до 30% заказа<br>• Скидки в День рождения активны ±5 дней<br>• Скидки и бонусы не суммируются</p>
      <h3>Сладкий чек</h3>
      <p>Билеты в розыгрыш начисляются за выполнение еженедельных заданий в кафе. Розыгрыш каждый квартал среди всех участников клуба.</p>
      <h3>Заказы</h3>
      <p>Минимальный заказ для бесплатной доставки — 1000 ₽. Сроки изготовления индивидуальных тортов — от 24 часов.</p>`
  },
  about: {
    title: 'О кондитерской «Мария»',
    html: `<p>Кондитерская «Мария» работает в Иркутске с 1993 года — 33 года на рынке.</p>
      <h3>17 кафе</h3>
      <p>Сеть кафе по всему городу. Свежая выпечка каждый день, традиционные рецепты + современные десерты.</p>
      <h3>Производство</h3>
      <p>Собственная фабрика, мастера-кондитеры, индивидуальные торты под заказ. Доставка по Иркутску.</p>
      <h3>Контакты</h3>
      <p>Сайт: <a href="https://maria-irk.ru" target="_blank">maria-irk.ru</a><br>Телефон: <a href="tel:+73952504080">+7 (3952) 50-40-80</a></p>`
  }
};
function profOpenAbout(section) {
  const data = ABOUT_CONTENT[section];
  if (!data) return;
  let modal = document.getElementById('about-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'about-modal';
    modal.className = 'cat-modal';
    modal.style.display = 'none';
    modal.onclick = (e) => { if (e.target === modal) profCloseAbout(); };
    modal.innerHTML = `
      <div class="cat-modal__sheet">
        <button class="cat-modal__close" onclick="profCloseAbout()">×</button>
        <div class="about-modal__body" id="about-modal-body"></div>
      </div>`;
    document.body.appendChild(modal);
  }
  const body = modal.querySelector('#about-modal-body');
  body.innerHTML = `<h2>${data.title}</h2>${data.html}`;
  modal.style.display = 'flex';
  window.scrollLock?.();
}
window.profOpenAbout = profOpenAbout;
function profCloseAbout() {
  const m = document.getElementById('about-modal');
  if (m) m.style.display = 'none';
  window.scrollUnlock?.();
}
window.profCloseAbout = profCloseAbout;

// Отвязать телефон
function profUnverifyConfirm() {
  const tg = window.Telegram?.WebApp;
  const msg = 'Отвязать телефон? Вы перестанете получать кэшбэк и баллы, билеты Sweet Check будут заморожены.';
  if (tg?.showConfirm) {
    tg.showConfirm(msg, async (ok) => { if (ok) await profUnverifyDo(); });
  } else if (confirm(msg)) {
    profUnverifyDo();
  }
}
window.profUnverifyConfirm = profUnverifyConfirm;
async function profUnverifyDo() {
  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData ?? '';
  if (!initData) return;
  try {
    const r = await fetch('/api/unverify-phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'tma ' + initData },
    });
    if (r.ok) {
      tg?.showAlert?.('Телефон отвязан.') || alert('Телефон отвязан.');
      profileLoad(true);
    } else {
      tg?.showAlert?.('Не удалось отвязать. Попробуй позже.') || alert('Не удалось отвязать.');
    }
  } catch {
    tg?.showAlert?.('Ошибка сети.') || alert('Ошибка сети.');
  }
}

// Notification preferences — сохраняем в localStorage (UI-фичей, backend TBD)
function profInitNotificationPrefs() {
  const inputs = document.querySelectorAll('#tab-profile input[data-pref]');
  inputs.forEach((inp) => {
    const key = inp.dataset.pref;
    const stored = localStorage.getItem('maria_pref_' + key);
    if (stored !== null) inp.checked = stored === '1';
    inp.addEventListener('change', () => {
      localStorage.setItem('maria_pref_' + key, inp.checked ? '1' : '0');
      const tg = window.Telegram?.WebApp;
      tg?.HapticFeedback?.selectionChanged?.();
    });
  });
}
document.addEventListener('DOMContentLoaded', () => {
  profInitNotificationPrefs();
});

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

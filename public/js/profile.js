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
    // Подгружаем реферальный код в фоне (для отображения в sub-tekst)
    profLoadReferral?.();
    // Подгружаем настройки уведомлений
    profLoadNotifyPrefs?.();
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

  // Аватар: photo_url из Telegram → fallback на coloured gradient с инициалом
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
  // Coloured gradient на основе hash имени (как iMessage)
  const avEl = document.getElementById('prof-av');
  if (avEl && !photoUrl) {
    const name = u.first_name || u.username || 'guest';
    let h = 0;
    for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
    const hue = Math.abs(h % 360);
    avEl.style.background = `linear-gradient(135deg, hsl(${hue}, 65%, 60%), hsl(${(hue + 40) % 360}, 70%, 50%))`;
    avEl.style.color = '#fff';
  } else if (avEl) {
    avEl.style.background = '';
    avEl.style.color = '';
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

  // Адрес доставки — берём из multi-address списка (с миграцией)
  const addrEl = document.getElementById('prof-info-address');
  if (addrEl) {
    const list = (typeof addrLoad === 'function') ? addrLoad() : [];
    const def = list.find((a) => a.isDefault) || list[0];
    if (def) {
      const more = list.length > 1 ? ` · +${list.length - 1}` : '';
      const text = (def.label || def.address || '') + more;
      addrEl.textContent = text.length > 28 ? text.slice(0, 26) + '…' : text;
      addrEl.style.color = 'var(--ap-ink)';
    } else {
      addrEl.textContent = 'указать';
      addrEl.style.color = 'var(--ap-red)';
    }
  }

  // Mini level-chip (если уровень есть в LK)
  // (заполняется в profileLoadOrdersCount после LK fetch)

  // Completion meter — обновляем при каждом render
  try { renderProfileCompletion(data); } catch (e) { console.error('[completion]', e); }
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
    const fillEl = document.getElementById('prof-level-fill');
    if (chipEl && lk.found && window.getCurrentLevel) {
      const yearSpent = Number(lk.year_spent || 0);
      const cur = window.getCurrentLevel(yearSpent, lk.level || null);
      const CLUB_LEVELS = window.CLUB_LEVELS || [];
      const idx = CLUB_LEVELS.findIndex((l) => l && l.name === cur?.name);
      const next = idx >= 0 ? CLUB_LEVELS[idx + 1] : null;
      if (nameChipEl) nameChipEl.textContent = `${cur.name} · кэшбэк ${cur.pct}%`;
      if (next) {
        const range = next.threshold - cur.threshold;
        const got   = Math.max(0, yearSpent - cur.threshold);
        const pct   = range > 0 ? Math.min(100, Math.max(2, Math.round(got / range * 100))) : 100;
        if (progEl) progEl.textContent = `до ${next.name}: ${Math.max(0, next.threshold - yearSpent).toLocaleString('ru-RU')} ₽`;
        if (fillEl) fillEl.style.width = pct + '%';
      } else {
        if (progEl) progEl.textContent = 'максимальный уровень';
        if (fillEl) fillEl.style.width = '100%';
      }
      chipEl.style.display = '';
    } else if (chipEl) {
      chipEl.style.display = 'none';
    }

    // Decorative blocks (achievements/gallery/categories) удалены из UI v6
    // Quick re-order — теперь первый row в АКТИВНОСТЬ
    try { renderReorderCard(orders); } catch (e) { console.error('[reorder]', e); }
    try { renderProfileCompletion(_profileData); } catch (e) { console.error('[completion]', e); }

    // QR-card row visibility (только для verified)
    const qrRow = document.getElementById('prof-card-row');
    if (qrRow) qrRow.style.display = _profileData?.phoneVerified ? '' : 'none';

    // Wishlist thumbnails (первые 4 товара)
    try {
      const wish = JSON.parse(localStorage.getItem('maria_wishlist') || '[]');
      const wishCount = renderProductThumbs('prof-wish-thumbs', wish, 4);
      const wishCountEl = document.getElementById('prof-info-wishcount');
      if (wishCountEl) wishCountEl.textContent = wish.length;
      // Если wishlist пустой — скрываем thumbs container (val уже покажет 0)
    } catch {}

    // Recently viewed thumbnails (последние 4)
    try {
      const recent = JSON.parse(localStorage.getItem('maria_recent_viewed') || '[]');
      const recentRow = document.getElementById('prof-recent-row');
      if (recent.length > 0 && recentRow) {
        recentRow.style.display = '';
        renderProductThumbs('prof-recent-thumbs', recent, 4);
      } else if (recentRow) {
        recentRow.style.display = 'none';
      }
    } catch {}

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

// Recently viewed — открыть последний просмотренный
function profOpenRecent() {
  try {
    const recent = JSON.parse(localStorage.getItem('maria_recent_viewed') || '[]');
    if (recent.length && window.catOpenProduct) {
      window.switchTab('menu');
      setTimeout(() => { try { window.catOpenProduct(recent[0]); } catch {} }, 250);
    }
  } catch {}
}
window.profOpenRecent = profOpenRecent;

// Рендер thumbnails для Любимое / Недавно
function renderProductThumbs(containerId, ids, maxCount = 4) {
  const el = document.getElementById(containerId);
  if (!el) return 0;
  if (!Array.isArray(ids) || ids.length === 0) {
    el.innerHTML = '';
    return 0;
  }
  // Поиск товаров в catalog state (загружен в catalog.js)
  const catState = window.CATALOG_STATE;
  const products = catState?.products || [];
  // Также LAST_VIEWED_PRODUCTS из catalog кэша
  const cache = window._catalogCache || {};
  const found = ids.slice(0, maxCount).map((id) => {
    return products.find((p) => Number(p.id) === Number(id)) || cache[id] || null;
  }).filter(Boolean);

  el.innerHTML = found.map((p) => {
    const img = (p.images && p.images[0]) || p.image || '';
    return img
      ? `<span class="prof-thumb"><img src="/img?u=${encodeURIComponent(img)}" alt="" loading="lazy"/></span>`
      : `<span class="prof-thumb prof-thumb--ph">🍰</span>`;
  }).join('');
  return found.length;
}

// QR-карточка клуба — modal с QR (через api.qrserver.com)
function profOpenQrCard() {
  const tg = window.Telegram?.WebApp;
  const tgUser = tg?.initDataUnsafe?.user;
  const userId = _profileData?.user?.id || tgUser?.id || 0;
  // Verified-check: либо есть данные с сервера, либо есть TG user — даём показать карту
  const verified = _profileData?.phoneVerified ?? !!tgUser?.id;
  if (!verified) {
    try { tg?.showAlert?.('Подтверди номер в Клубе чтобы получить карточку'); } catch { alert('Подтверди номер в Клубе'); }
    return;
  }
  if (!userId) return;
  let modal = document.getElementById('prof-qr-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'prof-qr-modal';
    modal.className = 'cat-modal';
    modal.style.display = 'none';
    modal.onclick = (e) => { if (e.target === modal) profCloseQr(); };
    modal.innerHTML = `
      <div class="cat-modal__sheet prof-qr">
        <button class="cat-modal__close" onclick="profCloseQr()">×</button>
        <div class="prof-qr__h">Карточка клуба</div>
        <div class="prof-qr__sub">Покажи кассиру в кафе</div>
        <div class="prof-qr__img" id="prof-qr-img"></div>
        <div class="prof-qr__name" id="prof-qr-name"></div>
        <div class="prof-qr__id" id="prof-qr-id"></div>
        <div class="prof-qr__hint">Кэшбэк начисляется автоматически</div>
      </div>`;
    document.body.appendChild(modal);
  }
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=10&data=maria-club:${userId}&color=0a0a0a&bgcolor=ffffff`;
  modal.querySelector('#prof-qr-img').innerHTML = `<img src="${qrUrl}" alt="QR" width="240" height="240"/>`;
  modal.querySelector('#prof-qr-name').textContent = _profileData?.user?.first_name || 'Клуб «Мария»';
  modal.querySelector('#prof-qr-id').textContent = `№ ${userId}`;
  modal.style.display = 'flex';
  window.scrollLock?.();
  // Haptic при открытии
  window.haptic?.('medium');
}
window.profOpenQrCard = profOpenQrCard;
function profCloseQr() {
  const m = document.getElementById('prof-qr-modal');
  if (m) m.style.display = 'none';
  window.scrollUnlock?.();
}
window.profCloseQr = profCloseQr;

// Profile completion meter — 4 чекпойнта (photo убран — юзер не может изменить из app)
function renderProfileCompletion(data) {
  const wrap = document.getElementById('prof-completion');
  if (!wrap) return;
  // Если пользователь dismissed — больше не показываем
  if (localStorage.getItem('maria_completion_dismissed') === '1') {
    wrap.style.display = 'none';
    return;
  }
  const checks = [
    { key: 'phone', label: 'телефон', done: !!data?.phoneVerified },
    { key: 'bday',  label: 'день рождения', done: !!data?.birthday },
    { key: 'address', label: 'адрес доставки', done: (typeof addrLoad === 'function') ? addrLoad().length > 0 : !!localStorage.getItem('maria_default_address') },
    { key: 'wishlist', label: 'избранное', done: (() => { try { return JSON.parse(localStorage.getItem('maria_wishlist') || '[]').length > 0; } catch { return false; } })() },
  ];
  const doneCount = checks.filter((c) => c.done).length;
  const pct = Math.round((doneCount / checks.length) * 100);
  const missing = checks.find((c) => !c.done);

  const pctEl = document.getElementById('prof-completion-pct');
  const fillEl = document.getElementById('prof-completion-fill');
  const hintEl = document.getElementById('prof-completion-hint');
  if (pctEl) pctEl.textContent = pct + '%';
  if (fillEl) fillEl.style.width = pct + '%';
  if (hintEl) {
    if (missing) {
      const cta = {
        phone: 'подтверди телефон → +5% кэшбэк',
        bday: 'укажи ДР → −5% скидка',
        address: 'укажи адрес → быстрый чекаут',
        wishlist: 'добавь товары в избранное',
      }[missing.key] || `укажи ${missing.label}`;
      hintEl.textContent = cta;
    } else {
      hintEl.textContent = 'Готово! 🎉';
    }
  }
  // Показываем только если меньше 100%
  wrap.style.display = pct < 100 ? '' : 'none';
}
window.renderProfileCompletion = renderProfileCompletion;

// Dismiss completion meter (close button) — больше не показываем
function profDismissCompletion() {
  try { localStorage.setItem('maria_completion_dismissed', '1'); } catch {}
  const wrap = document.getElementById('prof-completion');
  if (wrap) wrap.style.display = 'none';
}
window.profDismissCompletion = profDismissCompletion;

// Quick re-order — теперь как первый row в АКТИВНОСТЬ
function renderReorderCard(orders) {
  const container = document.getElementById('prof-reorder-row-container');
  if (!container) return;
  if (!Array.isArray(orders) || orders.length === 0) {
    container.innerHTML = '';
    return;
  }
  const last = orders.find((o) => !o.canceled && Array.isArray(o.items) && o.items.length > 0);
  if (!last) {
    container.innerHTML = '';
    return;
  }
  const itemsCount = last.items.length;
  const itemsTxt = last.items.slice(0, 2).map((i) => `${i.qty}× ${i.name}`).join(', ');
  const more = itemsCount > 2 ? ` +${itemsCount - 2}` : '';
  const sumTxt = last.sum ? Number(last.sum).toLocaleString('ru-RU') + ' ₽' : '';
  const dateRel = formatRelativeDate?.(last.date) || '';

  // Inline action row в стиле iOS Settings (matches остальные prof-row)
  container.innerHTML = `
    <button class="prof-row prof-row--accent" data-haptic="medium" onclick="profReorderLast()">
      <span class="prof-row__ic prof-row__ic--accent"><span data-icon="history" data-size="18"></span></span>
      <span class="prof-row__t">Повторить заказ</span>
      <span class="prof-row__sub">${escAttr(itemsTxt + more)}${dateRel ? ' · ' + escAttr(dateRel) : ''}${sumTxt ? ' · ' + escAttr(sumTxt) : ''}</span>
      <span class="prof-row__chev"><span data-icon="chevronRight" data-size="14"></span></span>
    </button>`;
  // Кэшируем заказ для последующего повтора
  window._profileLastOrder = last;
  // Инфлейтим SVG-иконки в новой row
  if (window.IconInflate) window.IconInflate(container);
}
window.renderReorderCard = renderReorderCard;

// Действие "Повторить заказ" из кэшированного last-order
function profReorderLast() {
  const last = window._profileLastOrder;
  if (!last || !Array.isArray(last.items)) return;
  const items = last.items.filter((i) => i.id || i.product_id);
  if (typeof window.reorderItems === 'function') {
    window.reorderItems(items.map((i) => ({ id: i.id || i.product_id, qty: i.qty || 1, name: i.name, price: i.price })));
  }
}
window.profReorderLast = profReorderLast;

// Photo gallery — thumbnails недавних заказанных товаров
function renderPhotoGallery(orders) {
  const wrap = document.getElementById('prof-gallery');
  const row = document.getElementById('prof-gallery-row');
  if (!wrap || !row) return;
  if (!Array.isArray(orders) || orders.length === 0) {
    wrap.style.display = 'none';
    return;
  }
  // Собираем уникальные products из последних 5 заказов
  const cache = window._catalogCache || {};
  const seen = new Set();
  const products = [];
  for (const o of orders.slice(0, 5)) {
    for (const i of (o.items || [])) {
      const id = i.id || i.product_id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const cached = cache[id];
      products.push({ id, name: i.name, image: cached?.image || (cached?.images && cached.images[0]) || '' });
      if (products.length >= 8) break;
    }
    if (products.length >= 8) break;
  }
  if (products.length === 0) {
    wrap.style.display = 'none';
    return;
  }
  row.innerHTML = products.map((p) => {
    const img = p.image
      ? `<img src="/img?u=${encodeURIComponent(p.image)}" alt="${escAttr(p.name || '')}" loading="lazy"/>`
      : `<span class="prof-gallery__ph">🍰</span>`;
    return `<button class="prof-gallery__item" data-haptic="light" onclick="haptic('light');catOpenProduct?.(${p.id})">${img}</button>`;
  }).join('');
  wrap.style.display = '';
}
window.renderPhotoGallery = renderPhotoGallery;

// Categories breakdown — для каждого ordered item ищем category в catalog
function renderCategoriesBreakdown(orders) {
  const wrap = document.getElementById('prof-cats');
  const list = document.getElementById('prof-cats-list');
  if (!wrap || !list) return;
  if (!Array.isArray(orders) || orders.length < 3) {
    wrap.style.display = 'none';
    return;
  }
  const cache = window._catalogCache || {};
  const cats = {};
  let total = 0;
  for (const o of orders) {
    for (const i of (o.items || [])) {
      const id = i.id || i.product_id;
      const cached = id ? cache[id] : null;
      const cat = cached?.category || 'Другое';
      cats[cat] = (cats[cat] || 0) + (Number(i.qty) || 1);
      total += Number(i.qty) || 1;
    }
  }
  if (total === 0) { wrap.style.display = 'none'; return; }
  const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const icons = { 'Торты': '🍰', 'Пироги': '🥧', 'Пирожные и десерты': '🥐', 'Наборы': '🎁', 'Для праздника': '🎉', 'Другое': '🍪' };
  list.innerHTML = sorted.map(([name, count]) => {
    const pct = Math.round((count / total) * 100);
    return `
      <div class="prof-cat">
        <div class="prof-cat__ic">${icons[name] || '🍪'}</div>
        <div class="prof-cat__body">
          <div class="prof-cat__row">
            <span class="prof-cat__name">${escAttr(name)}</span>
            <span class="prof-cat__pct">${pct}%</span>
          </div>
          <div class="prof-cat__bar"><span class="prof-cat__fill" style="width:${pct}%"></span></div>
        </div>
      </div>`;
  }).join('');
  wrap.style.display = '';
}
window.renderCategoriesBreakdown = renderCategoriesBreakdown;

// Achievements — вычисляем badges из имеющихся данных
function renderAchievements(data, orders) {
  const wrap = document.getElementById('prof-ach');
  const list = document.getElementById('prof-ach-list');
  if (!wrap || !list) return;
  const ach = [];
  const joinedDays = data?.joinedAt
    ? Math.floor((Date.now() - new Date(data.joinedAt).getTime()) / 86400000)
    : 0;
  if (joinedDays >= 365) ach.push({ ic:'🏆', t:'Год+ в клубе' });
  else if (joinedDays >= 90) ach.push({ ic:'🎉', t:'3+ месяца' });
  else if (joinedDays >= 30) ach.push({ ic:'✨', t:'Новичок' });

  const ordersCount = Array.isArray(orders) ? orders.length : 0;
  if (ordersCount >= 25) ach.push({ ic:'🛍', t:'25+ заказов' });
  else if (ordersCount >= 10) ach.push({ ic:'🛒', t:'10+ заказов' });
  else if (ordersCount >= 5) ach.push({ ic:'⭐', t:'5 заказов' });

  const launches = Number(data?.launchCount || 0);
  if (launches >= 100) ach.push({ ic:'🔥', t:'100+ запусков' });
  else if (launches >= 50) ach.push({ ic:'💯', t:'50+ запусков' });

  if (data?.phoneVerified) ach.push({ ic:'✓', t:'Verified' });
  if (data?.birthday) ach.push({ ic:'🎂', t:'ДР указан' });

  // ДР рядом (±14 дней)
  if (data?.birthday) {
    const m = String(data.birthday).match(/^(?:\d{4}-)?(\d{2})-(\d{2})$/);
    if (m) {
      const month = Number(m[1]), day = Number(m[2]);
      const now = new Date();
      let target = new Date(now.getFullYear(), month - 1, day);
      if (target < now) target = new Date(now.getFullYear() + 1, month - 1, day);
      const dd = Math.round((target - now) / 86400000);
      if (dd >= 0 && dd <= 14) ach.push({ ic:'🎁', t:'ДР скоро' });
    }
  }

  if (ach.length === 0) {
    wrap.style.display = 'none';
    return;
  }
  list.innerHTML = ach.map((a) => `
    <div class="prof-ach__item">
      <div class="prof-ach__ic">${a.ic}</div>
      <div class="prof-ach__t">${a.t}</div>
    </div>`).join('');
  wrap.style.display = '';
}
window.renderAchievements = renderAchievements;

/* ── Multiple addresses ─────────────────────────────────────────────────── */
const ADDR_KEY = 'maria_addresses_v1';
function addrLoad() {
  try {
    const v = JSON.parse(localStorage.getItem(ADDR_KEY) || '[]');
    if (Array.isArray(v) && v.length > 0) return v;
    // Migration: подтянуть из старого single-address ключа
    const legacy = localStorage.getItem('maria_default_address');
    if (legacy) return [{ id: 'home', label: '🏠 Дом', address: legacy, isDefault: true }];
    return [];
  } catch { return []; }
}
function addrSave(list) {
  try {
    localStorage.setItem(ADDR_KEY, JSON.stringify(list));
    // Поддерживаем легаси-ключ синхронизированным для backward-compat
    const def = list.find((a) => a.isDefault) || list[0];
    if (def) localStorage.setItem('maria_default_address', def.address);
    else localStorage.removeItem('maria_default_address');
  } catch {}
}
function addrGetDefault() {
  const list = addrLoad();
  return list.find((a) => a.isDefault) || list[0] || null;
}
window.addrLoad = addrLoad;
window.addrGetDefault = addrGetDefault;

// Адрес доставки — modal со списком saved addresses
function profEditAddress() {
  profOpenAddressList();
}
function profOpenAddressList() {
  let modal = document.getElementById('addr-list-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'addr-list-modal';
    modal.className = 'cat-modal';
    modal.style.display = 'none';
    modal.onclick = (e) => { if (e.target === modal) profCloseAddressList(); };
    modal.innerHTML = `
      <div class="cat-modal__sheet">
        <button class="cat-modal__close" onclick="profCloseAddressList()">×</button>
        <div class="addr-list__h">Адреса доставки</div>
        <div class="addr-list" id="addr-list-items"></div>
        <button class="btn-full addr-list__add" onclick="profAddAddress()">+ Новый адрес</button>
      </div>`;
    document.body.appendChild(modal);
  }
  renderAddressList();
  modal.style.display = 'flex';
  window.scrollLock?.();
}
window.profOpenAddressList = profOpenAddressList;
window.profCloseAddressList = () => {
  const m = document.getElementById('addr-list-modal');
  if (m) m.style.display = 'none';
  window.scrollUnlock?.();
  profileLoad(true); // обновим address в Профиле
};

function renderAddressList() {
  const wrap = document.getElementById('addr-list-items');
  if (!wrap) return;
  const list = addrLoad();
  if (list.length === 0) {
    wrap.innerHTML = '<div class="addr-empty">Пока нет адресов. Добавь первый →</div>';
    return;
  }
  wrap.innerHTML = list.map((a, i) => `
    <div class="addr-item ${a.isDefault ? 'addr-item--default' : ''}">
      <div class="addr-item__body" onclick="profSetDefaultAddress('${a.id}')">
        <div class="addr-item__label">${escAttr(a.label || 'Адрес')}${a.isDefault ? ' <span class="addr-item__badge">по умолч.</span>' : ''}</div>
        <div class="addr-item__address">${escAttr(a.address || '')}</div>
      </div>
      <button class="addr-item__edit" onclick="profEditOneAddress('${a.id}')" aria-label="Редактировать">✎</button>
      <button class="addr-item__del" onclick="profDeleteAddress('${a.id}')" aria-label="Удалить">×</button>
    </div>`).join('');
}

function profAddAddress() {
  const label = prompt('Название (например, Дом / Работа / Бабушка):');
  if (!label) return;
  const address = prompt('Адрес (Иркутск, ул. X, кв Y):');
  if (!address) return;
  const list = addrLoad();
  const isFirst = list.length === 0;
  list.push({
    id: 'a_' + Date.now(),
    label: label.trim(),
    address: address.trim(),
    isDefault: isFirst,
  });
  addrSave(list);
  renderAddressList();
  window.haptic?.('success');
}
window.profAddAddress = profAddAddress;

function profEditOneAddress(id) {
  const list = addrLoad();
  const a = list.find((x) => x.id === id);
  if (!a) return;
  const newLabel = prompt('Название:', a.label);
  if (newLabel === null) return;
  const newAddress = prompt('Адрес:', a.address);
  if (newAddress === null) return;
  a.label = newLabel.trim();
  a.address = newAddress.trim();
  addrSave(list);
  renderAddressList();
}
window.profEditOneAddress = profEditOneAddress;

function profDeleteAddress(id) {
  const tg = window.Telegram?.WebApp;
  const ask = (cb) => tg?.showConfirm ? tg.showConfirm('Удалить адрес?', cb) : cb(confirm('Удалить адрес?'));
  ask((ok) => {
    if (!ok) return;
    let list = addrLoad();
    const wasDef = list.find((a) => a.id === id)?.isDefault;
    list = list.filter((a) => a.id !== id);
    if (wasDef && list.length > 0) list[0].isDefault = true;
    addrSave(list);
    renderAddressList();
    window.haptic?.('selection');
  });
}
window.profDeleteAddress = profDeleteAddress;

function profSetDefaultAddress(id) {
  const list = addrLoad();
  list.forEach((a) => { a.isDefault = a.id === id; });
  addrSave(list);
  renderAddressList();
  window.haptic?.('selection');
}
window.profSetDefaultAddress = profSetDefaultAddress;

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

/* ── Referral code ─────────────────────────────────────────────────────────── */
let _referralCache = null;
async function profLoadReferral() {
  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || '';
  if (!initData) return null;
  if (_referralCache) return _referralCache;
  try {
    const r = await fetch('/api/referral/me', { headers: { Authorization: 'tma ' + initData } });
    if (!r.ok) return null;
    _referralCache = await r.json();
    const subEl = document.getElementById('prof-ref-sub');
    if (subEl && _referralCache?.code) {
      const usedTxt = _referralCache.used > 0 ? ` · ${_referralCache.used} перешли` : '';
      subEl.textContent = `Твой код: ${_referralCache.code}${usedTxt}`;
    }
    return _referralCache;
  } catch { return null; }
}
window.profLoadReferral = profLoadReferral;

async function profOpenReferral() {
  const data = await profLoadReferral();
  if (!data?.code) {
    alert('Не удалось загрузить реферальный код. Попробуй позже.');
    return;
  }
  let modal = document.getElementById('ref-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'ref-modal';
    modal.className = 'cat-modal';
    modal.style.display = 'none';
    modal.onclick = (e) => { if (e.target === modal) profCloseReferral(); };
    document.body.appendChild(modal);
  }
  const shareText = `Заходи в кондитерскую «Мария» по моему коду ${data.code} — оба получим 200 ₽ на следующий заказ.`;
  const tgShare = `https://t.me/share/url?url=${encodeURIComponent(data.share_url)}&text=${encodeURIComponent(shareText)}`;
  modal.innerHTML = `
    <div class="cat-modal__sheet">
      <button class="cat-modal__close" onclick="profCloseReferral()">×</button>
      <div class="ref-h">Приведи друга — <span class="ref-h__sum">200 ₽</span></div>
      <div class="ref-sub">Когда друг сделает первый заказ — вы оба получите 200 ₽ на бонусный счёт.</div>
      <div class="ref-code-box">
        <div class="ref-code-box__lbl">Твой код</div>
        <div class="ref-code-box__code" id="ref-code-val">${escAttr(data.code)}</div>
        <button class="ref-code-box__copy" onclick="profCopyReferralCode()">Скопировать</button>
      </div>
      <div class="ref-stat">${data.used > 0 ? `Уже перешли по твоему коду: <b>${data.used}</b>` : 'Ещё никто не перешёл — будь первым, кто поделится'}</div>
      <a class="btn-full ref-share-btn" href="${escAttr(tgShare)}" target="_blank" rel="noopener">📤 Поделиться через Telegram</a>
    </div>`;
  modal.style.display = 'flex';
  window.scrollLock?.();
}
window.profOpenReferral = profOpenReferral;

function profCloseReferral() {
  const m = document.getElementById('ref-modal');
  if (m) m.style.display = 'none';
  window.scrollUnlock?.();
}
window.profCloseReferral = profCloseReferral;

function profCopyReferralCode() {
  const v = document.getElementById('ref-code-val')?.textContent || '';
  if (!v) return;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(v).then(() => {
      window.haptic?.('success');
      const btn = document.querySelector('.ref-code-box__copy');
      if (btn) { const t = btn.textContent; btn.textContent = '✓ Скопирован'; setTimeout(() => { btn.textContent = t; }, 1500); }
    }).catch(() => {});
  } else {
    const r = document.createRange(); r.selectNodeContents(document.getElementById('ref-code-val'));
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  }
}
window.profCopyReferralCode = profCopyReferralCode;

/* ── Notification preferences ─────────────────────────────────────────────── */
let _notifyPrefs = { marketing_promo: true, marketing_rewards: true };
async function profLoadNotifyPrefs() {
  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || '';
  if (!initData) return;
  try {
    const r = await fetch('/api/notify-prefs', { headers: { Authorization: 'tma ' + initData } });
    if (!r.ok) return;
    _notifyPrefs = await r.json();
    renderNotifyToggles();
  } catch {}
}
window.profLoadNotifyPrefs = profLoadNotifyPrefs;

function renderNotifyToggles() {
  const promo   = document.getElementById('prof-toggle-promo');
  const rewards = document.getElementById('prof-toggle-rewards');
  if (promo)   promo.setAttribute('data-on',   _notifyPrefs.marketing_promo   ? 'true' : 'false');
  if (rewards) rewards.setAttribute('data-on', _notifyPrefs.marketing_rewards ? 'true' : 'false');
}

async function profToggleNotify(key) {
  const next = !_notifyPrefs[key];
  _notifyPrefs[key] = next;
  renderNotifyToggles();
  window.haptic?.('selection');
  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || '';
  if (!initData) return;
  try {
    const r = await fetch('/api/notify-prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'tma ' + initData },
      body: JSON.stringify({ [key]: next }),
    });
    if (r.ok) _notifyPrefs = await r.json();
    renderNotifyToggles();
  } catch {}
}
window.profToggleNotify = profToggleNotify;

// Modal «О приложении» / Privacy / Terms / FAQ / Whatsnew
const ABOUT_CONTENT = {
  faq: {
    title: 'Частые вопросы',
    html: `
      <h3>Как использовать баллы?</h3>
      <p>Баллы начисляются автоматически после заказов на сайте maria-irk.ru. При оформлении заказа можно оплатить ими до 30% суммы.</p>
      <h3>Где забрать заказ?</h3>
      <p>Выбираете кафе из 17 точек при оформлении или заказываете доставку (бесплатно от 1 000 ₽).</p>
      <h3>Как отменить заказ?</h3>
      <p>Позвоните +7 (3952) 50-40-80 не позже чем за 4 часа до готовности (для индивидуальных тортов — за 24 часа).</p>
      <h3>Что такое «Сладкий чек»?</h3>
      <p>Лотерея с призами iPhone 17 / MacBook / PS5 / Apple Watch. Каждый чек даёт билет — чем больше билетов, тем выше шанс выиграть. Розыгрыш каждый квартал.</p>
      <h3>Как изменить телефон?</h3>
      <p>В Профиле → «Отвязать телефон» → пере-подтвердите новый в Клубе.</p>
      <h3>Где найти индивидуальный торт?</h3>
      <p>Вкладка «На заказ» в нижнем меню. Заполните форму — менеджер свяжется в течение часа.</p>`
  },
  whatsnew: {
    title: 'Что нового',
    html: `
      <h3>v1.0.1 (актуальная)</h3>
      <p>• Новый Профиль в стиле Apple Wallet<br>• Клубная QR-карточка для кафе<br>• Бейджи достижений<br>• Уведомления preferences<br>• Список последних заказов с статусами</p>
      <h3>v1.0.0</h3>
      <p>• Telegram Mini App запущен<br>• Программа лояльности «Мария для своих»<br>• Каталог с 250 товарами<br>• AI-ассистент Маша<br>• 14 партнёров клуба</p>`
  },
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

// Legal modal — объединённая страница с табами (About / Privacy / Terms)
function profOpenLegal() {
  let modal = document.getElementById('legal-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'legal-modal';
    modal.className = 'cat-modal';
    modal.style.display = 'none';
    modal.onclick = (e) => { if (e.target === modal) profCloseLegal(); };
    modal.innerHTML = `
      <div class="cat-modal__sheet">
        <button class="cat-modal__close" onclick="profCloseLegal()">×</button>
        <div class="legal-modal">
          <div class="legal-modal__tabs">
            <button class="legal-tab legal-tab--active" data-tab="about">О компании</button>
            <button class="legal-tab" data-tab="privacy">Политика</button>
            <button class="legal-tab" data-tab="terms">Условия</button>
          </div>
          <div class="about-modal__body" id="legal-modal-body"></div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    // Обработчики tabs
    modal.querySelectorAll('.legal-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        modal.querySelectorAll('.legal-tab').forEach((t) => t.classList.remove('legal-tab--active'));
        tab.classList.add('legal-tab--active');
        renderLegalTabContent(tab.dataset.tab);
      });
    });
  }
  renderLegalTabContent('about');
  modal.style.display = 'flex';
  window.scrollLock?.();
}
window.profOpenLegal = profOpenLegal;
function profCloseLegal() {
  const m = document.getElementById('legal-modal');
  if (m) m.style.display = 'none';
  window.scrollUnlock?.();
}
window.profCloseLegal = profCloseLegal;
function renderLegalTabContent(tab) {
  const body = document.getElementById('legal-modal-body');
  const data = ABOUT_CONTENT[tab];
  if (body && data) body.innerHTML = `<h2>${data.title}</h2>${data.html}`;
}

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

/* ── Platform bridge: Telegram WebApp + VK Mini Apps + МАКС ──────────────────
   Детекция платформы:
     - VK:    в location.search есть vk_app_id (launch params от VK)
     - TG:    window.Telegram.WebApp.initData непустой
     - max:   window.WebApp.initData непустой (бридж МАКС st.max.ru/js/max-web-app.js,
              API — почти клон Telegram WebApp; скрипт подключён в html рядом с TG)
     - guest: обычный браузер (дев-режим / телефонная обёртка)

   Экспортирует (как раньше):
     window.haptic, window.tgMain, window.tgBack, window.scrollLock/Unlock,
     window.linkifyPhones, window.tweenNumber, CSS-переменные --tg-*

   Новый единый API (используйте его, а не window.Telegram напрямую):
     App.platform               'tg' | 'vk' | 'guest'
     App.ready()                Promise — дождаться init (VK: SDK + user info)
     App.authHeader()           объект заголовков для fetch
     App.isAuthed()             bool
     App.user()                 {id, first_name, last_name, username, photo_url} | null
     App.startParam()           deep-link параметр (tg start_param | vk hash | ?wish/?rate_order)
     App.confirm(msg)           Promise<boolean>
     App.alert(msg)             Promise<void>
     App.share(url, text)       нативный share текущей платформы
     App.openExternal(url)      внешняя ссылка
     App.allowMessages()        VK: запрос разрешения сообщений сообщества
     App.verifyPhoneVk()        VK: GetPhoneNumber → POST /api/vk/verify-phone
     App.main / App.back        = tgMain / tgBack
     App.close()                закрыть Mini App (TG close / VK VKWebAppClose; guest no-op)
*/
(function(){
  // ─── Детекция платформы ────────────────────────────────────────────────────
  const _search = new URLSearchParams(location.search);
  const IS_VK = _search.has('vk_app_id');
  const tg = !IS_VK ? window.Telegram?.WebApp : null;
  // МАКС: его бридж кладёт window.WebApp (без window.Telegram-неймспейса)
  const mx = !IS_VK && !tg?.initData ? window.WebApp : null;
  const IS_MAX = Boolean(mx?.initData);
  const PLATFORM = IS_VK ? 'vk' : (tg?.initData ? 'tg' : IS_MAX ? 'max' : 'guest');

  // VK state
  let _vkBridge = null;          // vkBridge global после загрузки SDK
  let _vkUser = null;            // кэш VKWebAppGetUserInfo
  let _vkConfig = null;          // {app_id, group_id} c /api/vk/config
  let _readyPromise = null;

  // ─── Telegram init + тема ──────────────────────────────────────────────────
  if (tg) {
    try {
      tg.ready(); tg.expand();
      // Не даём частым вертикальным тапам/микросвайпам свернуть Mini App.
      // Внутренняя прокрутка страниц при этом продолжает работать.
      if (typeof tg.disableVerticalSwipes === 'function') tg.disableVerticalSwipes();
    } catch {}
  }
  if (mx) {
    try { mx.ready?.(); mx.expand?.(); } catch {}
  }

  function applyTheme() {
    // Mini App всегда в light — это бренд-решение «премиум-белое».
    // Dark-режим оставлен в CSS (html.tg-dark) только для дев-теста через ?dark=1.
    const tp = (tg && tg.themeParams) || {};
    const root = document.documentElement;
    const url = new URL(window.location.href);
    const force = url.searchParams.get('dark');
    const isDark = force === '1';   // только явный ?dark=1; всё остальное — light

    // Brand-цвета — одни и те же в light/dark и на всех платформах
    root.style.setProperty('--tg-link-color',         '#d61f37');
    root.style.setProperty('--tg-button-color',       '#d61f37');
    root.style.setProperty('--tg-button-text-color',  '#ffffff');

    if (isDark) {
      root.classList.add('tg-dark');
      root.classList.remove('tg-light');
      ['--tg-bg-color','--tg-secondary-bg-color','--tg-section-bg-color','--tg-text-color','--tg-hint-color']
        .forEach((p) => root.style.removeProperty(p));
      try { tg?.setHeaderColor?.('#160409'); } catch {}
      try { tg?.setBackgroundColor?.('#160409'); } catch {}
    } else {
      root.classList.add('tg-light');
      root.classList.remove('tg-dark');
      root.style.setProperty('--tg-bg-color',           '#ffffff');
      root.style.setProperty('--tg-secondary-bg-color', '#ffffff');
      root.style.setProperty('--tg-section-bg-color',   '#ffffff');
      root.style.setProperty('--tg-text-color',         tp.text_color || '#130008');
      root.style.setProperty('--tg-hint-color',         tp.hint_color || '#8b949e');
      try { tg?.setHeaderColor?.('#ffffff'); } catch {}
      try { tg?.setBackgroundColor?.('#ffffff'); } catch {}
    }
  }
  applyTheme();
  if (tg) tg.onEvent?.('themeChanged', applyTheme);

  // ─── VK init (lazy SDK c CDN) ──────────────────────────────────────────────
  function loadVkSdk() {
    return new Promise((resolve) => {
      if (window.vkBridge) { resolve(window.vkBridge); return; }
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/@vkontakte/vk-bridge/dist/browser.min.js';
      s.onload = () => resolve(window.vkBridge || null);
      s.onerror = () => resolve(null);
      document.head.appendChild(s);
    });
  }

  async function initVk() {
    _vkBridge = await loadVkSdk();
    if (!_vkBridge) return;
    // VK иногда отдаёт iframe раньше, чем готов host bridge. Не считаем
    // приложение инициализированным после первого отказа — повторяем запрос.
    let initialized = false;
    for (let attempt = 0; attempt < 3 && !initialized; attempt++) {
      try {
        await _vkBridge.send('VKWebAppInit', {});
        initialized = true;
      } catch {
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
      }
    }
    if (!initialized) return;
    // Имя/аватар — для приветствия, share-текстов и x-vk-user (display-only)
    try { _vkUser = await _vkBridge.send('VKWebAppGetUserInfo', {}); } catch {}
    // app_id/group_id с бэка (для share-ссылок и AllowMessagesFromGroup)
    try {
      const r = await fetch('/api/vk/config');
      if (r.ok) _vkConfig = await r.json();
    } catch {}
  }

  function ready() {
    if (!_readyPromise) {
      _readyPromise = IS_VK ? initVk() : Promise.resolve();
    }
    return _readyPromise;
  }
  if (IS_VK) ready(); // стартуем сразу, не дожидаясь вызова

  // ─── Haptic ────────────────────────────────────────────────────────────────
  window.haptic = function(kind) {
    if (IS_VK) {
      if (!_vkBridge) return;
      try {
        if (kind === 'success' || kind === 'error' || kind === 'warning')
          _vkBridge.send('VKWebAppTapticNotificationOccurred', { type: kind });
        else if (kind === 'selection')
          _vkBridge.send('VKWebAppTapticSelectionChanged', {});
        else
          _vkBridge.send('VKWebAppTapticImpactOccurred', { style: kind || 'light' });
      } catch {}
      return;
    }
    // TG и МАКС — одинаковый HapticFeedback API
    const h = window.Telegram?.WebApp?.HapticFeedback || (IS_MAX && mx?.HapticFeedback);
    if (!h) return;
    try {
      if (kind === 'success' || kind === 'error' || kind === 'warning') h.notificationOccurred(kind);
      else if (kind === 'selection') h.selectionChanged();
      else h.impactOccurred(kind || 'light');
    } catch {}
  };

  // Авто-haptic на тапах: data-haptic="light|medium|heavy|success|selection"
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-haptic]');
    if (t) window.haptic(t.dataset.haptic);
  }, { capture: true });

  // ─── MainButton ────────────────────────────────────────────────────────────
  // TG: нативная кнопка Telegram. VK/guest: DOM-фоллбек — sticky-кнопка над BNav.
  function domMainButton() {
    let el = document.getElementById('pf-main-btn');
    if (!el) {
      el = document.createElement('button');
      el.id = 'pf-main-btn';
      el.style.cssText = [
        'position:fixed', 'left:12px', 'right:12px', 'z-index:980',
        'padding:14px 16px', 'border:none', 'border-radius:14px',
        'background:var(--tg-button-color,#d61f37)', 'color:var(--tg-button-text-color,#fff)',
        'font:600 16px/1.2 inherit', 'box-shadow:0 6px 20px rgba(214,31,55,.35)',
        'display:none', 'cursor:pointer',
      ].join(';');
      document.body.appendChild(el);
    }
    // над нижней навигацией (если есть)
    const nav = document.querySelector('.bnav');
    const navH = nav ? nav.offsetHeight : 0;
    el.style.bottom = (navH + 10) + 'px';
    return el;
  }

  window.tgMain = {
    show(text, onClick, opts = {}) {
      const mb = !IS_VK && window.Telegram?.WebApp?.MainButton;
      if (mb) {
        try {
          mb.setText(text);
          if (opts.color) mb.color = opts.color;
          if (opts.textColor) mb.textColor = opts.textColor;
          if (this._onClick) { try { mb.offClick(this._onClick); } catch {} }
          this._onClick = () => { window.haptic?.('medium'); onClick && onClick(); };
          mb.onClick(this._onClick);
          if (opts.disabled) mb.disable(); else mb.enable();
          if (opts.progress) mb.showProgress(false); else mb.hideProgress();
          mb.show();
          return true;
        } catch { return false; }
      }
      // VK/guest: DOM-фоллбек
      try {
        const el = domMainButton();
        el.textContent = text;
        el.disabled = Boolean(opts.disabled);
        el.onclick = () => { window.haptic?.('medium'); onClick && onClick(); };
        el.style.display = 'block';
        return true;
      } catch { return false; }
    },
    hide() {
      const mb = !IS_VK && window.Telegram?.WebApp?.MainButton;
      if (mb) {
        try {
          if (this._onClick) { try { mb.offClick(this._onClick); } catch {} this._onClick = null; }
          mb.hide();
        } catch {}
        return;
      }
      const el = document.getElementById('pf-main-btn');
      if (el) el.style.display = 'none';
    },
    progress(on) {
      const mb = !IS_VK && window.Telegram?.WebApp?.MainButton;
      if (mb) { try { on ? mb.showProgress(false) : mb.hideProgress(); } catch {} return; }
      const el = document.getElementById('pf-main-btn');
      if (el) { el.disabled = Boolean(on); el.style.opacity = on ? '.6' : '1'; }
    },
    setText(text) {
      const mb = !IS_VK && window.Telegram?.WebApp?.MainButton;
      if (mb) { try { mb.setText(text); } catch {} return; }
      const el = document.getElementById('pf-main-btn');
      if (el) el.textContent = text;
    },
  };

  // ─── BackButton — в VK нативной нет; коллеров вне TG сейчас нет, no-op ─────
  window.tgBack = {
    show(onBack) {
      const bb = !IS_VK && window.Telegram?.WebApp?.BackButton;
      if (!bb) return false;
      try {
        if (this._onClick) { try { bb.offClick(this._onClick); } catch {} }
        this._onClick = () => { window.haptic?.('light'); onBack && onBack(); };
        bb.onClick(this._onClick);
        bb.show();
        return true;
      } catch { return false; }
    },
    hide() {
      const bb = !IS_VK && window.Telegram?.WebApp?.BackButton;
      if (!bb) return;
      try {
        if (this._onClick) { try { bb.offClick(this._onClick); } catch {} this._onClick = null; }
        bb.hide();
      } catch {}
    },
  };

  // ─── Единый App API ────────────────────────────────────────────────────────
  const App = {
    platform: PLATFORM,
    ready,

    isAuthed() {
      return PLATFORM === 'tg' ? Boolean(tg?.initData) : PLATFORM === 'max' ? Boolean(mx?.initData) : PLATFORM === 'vk';
    },

    authHeader() {
      if (PLATFORM === 'tg' && tg?.initData) {
        return { Authorization: 'tma ' + tg.initData };
      }
      if (PLATFORM === 'max' && mx?.initData) {
        return { Authorization: 'max ' + mx.initData };
      }
      if (PLATFORM === 'vk') {
        const h = { Authorization: 'vk ' + location.search.slice(1) };
        if (_vkUser) {
          // Display-only имя (бэк НЕ доверяет ему для security)
          try { h['x-vk-user'] = JSON.stringify({ first_name: _vkUser.first_name, last_name: _vkUser.last_name }); } catch {}
        }
        return h;
      }
      return {};
    },

    user() {
      if (PLATFORM === 'tg' || PLATFORM === 'max') {
        const u = (PLATFORM === 'max' ? mx : tg)?.initDataUnsafe?.user;
        return u ? { id: u.id, first_name: u.first_name, last_name: u.last_name, username: u.username, photo_url: u.photo_url } : null;
      }
      if (PLATFORM === 'vk') {
        const id = Number(_search.get('vk_user_id')) || undefined;
        if (_vkUser) return { id, first_name: _vkUser.first_name, last_name: _vkUser.last_name, photo_url: _vkUser.photo_200 || _vkUser.photo_100 };
        return id ? { id } : null;
      }
      return null;
    },

    initDataLength() {
      if (PLATFORM === 'tg') return String(tg?.initData || '').length;
      if (PLATFORM === 'max') return String(mx?.initData || '').length;
      if (PLATFORM === 'vk') return location.search.length;
      return 0;
    },

    haptic(kind) { window.haptic(kind); },

    requestContact(callback) {
      const host = PLATFORM === 'max' ? mx : PLATFORM === 'tg' ? tg : null;
      if (!host || typeof host.requestContact !== 'function') return false;
      try { host.requestContact(callback); return true; } catch { return false; }
    },

    showPopup(params) {
      const host = PLATFORM === 'max' ? mx : PLATFORM === 'tg' ? tg : null;
      if (!host || typeof host.showPopup !== 'function') return false;
      try { host.showPopup(params); return true; } catch { return false; }
    },

    startParam() {
      let sp = '';
      if (PLATFORM === 'tg') sp = tg?.initDataUnsafe?.start_param || '';
      else if (PLATFORM === 'max') sp = mx?.initDataUnsafe?.start_param || '';
      else if (PLATFORM === 'vk') {
        try { sp = decodeURIComponent((location.hash || '').replace(/^#/, '')); } catch { sp = (location.hash || '').slice(1); }
      }
      if (!sp) {
        // Универсальные URL-фоллбеки (исторические, работают на всех платформах)
        const u = new URL(window.location.href);
        const wish = u.searchParams.get('wish');
        const rate = u.searchParams.get('rate_order');
        if (wish) sp = 'wish_' + wish;
        else if (rate) sp = 'rate_' + rate;
      }
      // только безопасные символы deep-link'ов
      return /^[\w-]{1,64}$/.test(sp) ? sp : '';
    },

    confirm(msg) {
      return new Promise((resolve) => {
        if (PLATFORM === 'tg' && tg?.showConfirm) {
          try { tg.showConfirm(msg, (ok) => resolve(Boolean(ok))); return; } catch {}
        }
        resolve(window.confirm(msg));
      });
    },

    alert(msg) {
      return new Promise((resolve) => {
        if (PLATFORM === 'tg' && tg?.showAlert) {
          try { tg.showAlert(msg, () => resolve()); return; } catch {}
        }
        window.alert(msg);
        resolve();
      });
    },

    share(url, text) {
      if (PLATFORM === 'vk' && _vkBridge) {
        // VKWebAppShare шарит ссылку; текст юзер допишет сам
        _vkBridge.send('VKWebAppShare', { link: url }).catch(() => {});
        return;
      }
      if (PLATFORM === 'tg' && tg?.openTelegramLink) {
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text || '')}`;
        try { tg.openTelegramLink(shareUrl); return; } catch {}
      }
      if (PLATFORM === 'max' && mx) {
        // шаринг внутри МАКС; при отказе — системный share ниже
        try { if (mx.shareMaxContent) { mx.shareMaxContent({ text: (text ? text + '\n' : '') + url }); return; } } catch {}
        try { if (mx.shareContent) { mx.shareContent({ text: (text ? text + '\n' : '') + url }); return; } } catch {}
      }
      if (navigator.share) { navigator.share({ url, text }).catch(() => {}); return; }
      try { navigator.clipboard?.writeText(url + (text ? '\n' + text : '')); } catch {}
    },

    openExternal(url) {
      if (PLATFORM === 'tg' && tg?.openLink) { try { tg.openLink(url); return; } catch {} }
      if (PLATFORM === 'max' && mx?.openLink) { try { mx.openLink(url); return; } catch {} }
      window.open(url, '_blank', 'noopener');
    },

    /** Ссылка на само приложение текущей платформы (для «поделиться приложением»). */
    async appLink() {
      if (PLATFORM === 'vk') {
        await ready();
        const appId = _vkConfig?.app_id;
        if (appId) return 'https://vk.com/app' + appId;
      }
      return 'https://t.me/mariatortik_bot';
    },

    /** VK: запрос «разрешить сообщения от сообщества» (для пушей). */
    async allowMessages() {
      if (PLATFORM !== 'vk' || !_vkBridge) return false;
      await ready();
      const groupId = Number(_vkConfig?.group_id) || 0;
      if (!groupId) return false;
      try {
        const r = await _vkBridge.send('VKWebAppAllowMessagesFromGroup', { group_id: groupId });
        return Boolean(r?.result);
      } catch { return false; }
    },

    /** VK: верификация телефона — GetPhoneNumber → серверная проверка sign. */
    async verifyPhoneVk() {
      if (PLATFORM !== 'vk' || !_vkBridge) return { ok: false, error: 'not_vk' };
      await ready();
      let res;
      try {
        res = await _vkBridge.send('VKWebAppGetPhoneNumber', {});
      } catch (e) {
        return { ok: false, error: 'denied' };
      }
      if (!res?.phone_number || !res?.sign) return { ok: false, error: 'no_phone' };
      try {
        const r = await fetch('/api/vk/verify-phone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...App.authHeader() },
          body: JSON.stringify({ phone_number: res.phone_number, sign: res.sign }),
        });
        return await r.json();
      } catch {
        return { ok: false, error: 'network' };
      }
    },

    /** Закрыть Mini App (используется pure-режимом game.html). Гость — no-op. */
    close() {
      if (PLATFORM === 'tg' && tg?.close) { try { tg.close(); return; } catch {} }
      if (PLATFORM === 'max' && mx?.close) { try { mx.close(); return; } catch {} }
      if (PLATFORM === 'vk' && _vkBridge) { _vkBridge.send('VKWebAppClose', { status: 'success' }).catch(() => {}); }
    },

    main: window.tgMain,
    back: window.tgBack,
  };
  window.App = App;

  // ─── Scroll Lock ───────────────────────────────────────────────────────────
  // Безшовное открытие модалок — фиксируем body, не теряя позицию скролла.
  let _scrollLockY = 0;
  let _scrollLockCount = 0;  // счётчик вложенных модалок
  window.scrollLock = function() {
    _scrollLockCount++;
    if (_scrollLockCount > 1) return;
    _scrollLockY = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.style.position = 'fixed';
    document.body.style.top = -_scrollLockY + 'px';
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
  };
  window.scrollUnlock = function() {
    _scrollLockCount = Math.max(0, _scrollLockCount - 1);
    if (_scrollLockCount > 0) return;
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    window.scrollTo(0, _scrollLockY);
  };

  // ─── Auto-linkify phones — оборачивает любые +7-номера в текстовых нодах
  // в кликабельные tel:-ссылки. Применять к динамическому контенту.
  const PHONE_RE = /(\+?7|8)[\s\-().]*(\d{3,4})[\s\-().]*(\d{2,3})[\s\-().]*(\d{2})[\s\-().]*(\d{2})/g;
  window.linkifyPhones = function(root) {
    if (!root || !root.querySelectorAll) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        const tag = p.tagName;
        if (tag === 'A' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
        if (!PHONE_RE.test(n.nodeValue || '')) { PHONE_RE.lastIndex = 0; return NodeFilter.FILTER_REJECT; }
        PHONE_RE.lastIndex = 0;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    let n; while ((n = walker.nextNode())) nodes.push(n);
    for (const node of nodes) {
      const text = node.nodeValue;
      const frag = document.createDocumentFragment();
      let last = 0;
      text.replace(PHONE_RE, (match, p1, p2, p3, p4, p5, offset) => {
        if (offset > last) frag.appendChild(document.createTextNode(text.slice(last, offset)));
        const a = document.createElement('a');
        const digits = '7' + p2 + p3 + p4 + p5;
        a.href = 'tel:+' + digits;
        a.className = 'auto-tel';
        a.dataset.haptic = 'light';
        a.textContent = match;
        frag.appendChild(a);
        last = offset + match.length;
      });
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    }
  };

  // ─── Tween number (rolling odometer) ───────────────────────────────────────
  window.tweenNumber = function(el, from, to, dur) {
    if (!el) return;
    from = Number(from) || 0; to = Number(to) || 0;
    const start = performance.now();
    const duration = dur || 420;
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    function step(now){
      const t = Math.min(1, (now - start) / duration);
      const v = Math.round(from + (to - from) * ease(t));
      el.textContent = v.toLocaleString('ru-RU');
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  };
})();

/* ── Telegram WebApp bridge ──────────────────────────────────────────────────
   - Подхватывает themeParams и проставляет CSS-переменные:
     --tg-bg, --tg-text, --tg-hint, --tg-link, --tg-btn, --tg-btn-text,
     --tg-secondary-bg, --tg-card, --tg-section-bg
   - Включает class="tg-dark" на html, если colorScheme = dark
   - Экспортирует window.haptic('light'|'medium'|'heavy'|'success'|'error'|'warning')
   - Экспортирует window.tweenNumber(el, from, to, dur)
*/
(function(){
  const tg = window.Telegram?.WebApp;
  if (tg) {
    try { tg.ready(); tg.expand(); } catch {}

    function applyTheme() {
      // Уважаем Telegram colorScheme (light/dark). Брендовая цветовая
      // схема — красно-золотые акценты — остаётся одна в обоих режимах;
      // меняются только фон/поверхности через токены в style.css.
      const tp = tg.themeParams || {};
      const root = document.documentElement;
      // Поддержка ?dark=1 / ?dark=0 для дев-тестирования без смены TG-настроек
      const url = new URL(window.location.href);
      const force = url.searchParams.get('dark');
      const isDark = force === '1' ? true : force === '0' ? false : (tg.colorScheme === 'dark');

      // Brand-цвета — одни и те же в light/dark
      root.style.setProperty('--tg-link-color',         '#d61f37');
      root.style.setProperty('--tg-button-color',       '#d61f37');
      root.style.setProperty('--tg-button-text-color',  '#ffffff');

      if (isDark) {
        root.classList.add('tg-dark');
        root.classList.remove('tg-light');
        // Очищаем light-overrides — CSS html.tg-dark выставит warm bordeaux
        ['--tg-bg-color','--tg-secondary-bg-color','--tg-section-bg-color','--tg-text-color','--tg-hint-color']
          .forEach((p) => root.style.removeProperty(p));
        try { tg.setHeaderColor?.('#160409'); } catch {}
        try { tg.setBackgroundColor?.('#160409'); } catch {}
      } else {
        root.classList.add('tg-light');
        root.classList.remove('tg-dark');
        root.style.setProperty('--tg-bg-color',           '#ffffff');
        root.style.setProperty('--tg-secondary-bg-color', '#ffffff');
        root.style.setProperty('--tg-section-bg-color',   '#ffffff');
        root.style.setProperty('--tg-text-color',         tp.text_color || '#130008');
        root.style.setProperty('--tg-hint-color',         tp.hint_color || '#8b949e');
        try { tg.setHeaderColor?.('#ffffff'); } catch {}
        try { tg.setBackgroundColor?.('#ffffff'); } catch {}
      }
    }
    applyTheme();
    tg.onEvent?.('themeChanged', applyTheme);
  } else {
    // не TMA — fallback на light
    document.documentElement.classList.add('tg-light');
  }

  // ─── Haptic ────────────────────────────────────────────────────────────────
  window.haptic = function(kind) {
    const h = window.Telegram?.WebApp?.HapticFeedback;
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

  // ─── MainButton — нативная закреплённая кнопка снизу ──────────────────────
  // Использование: tgMain.show('Оформить · 1 200 ₽', () => cartSubmit());
  window.tgMain = {
    show(text, onClick, opts = {}) {
      const mb = window.Telegram?.WebApp?.MainButton;
      if (!mb) return false;
      try {
        mb.setText(text);
        if (opts.color) mb.color = opts.color;
        if (opts.textColor) mb.textColor = opts.textColor;
        // удаляем предыдущие хендлеры (Telegram не предоставляет removeEventListener)
        if (this._onClick) {
          try { mb.offClick(this._onClick); } catch {}
        }
        this._onClick = () => { window.haptic?.('medium'); onClick && onClick(); };
        mb.onClick(this._onClick);
        if (opts.disabled) mb.disable(); else mb.enable();
        if (opts.progress) mb.showProgress(false); else mb.hideProgress();
        mb.show();
        return true;
      } catch { return false; }
    },
    hide() {
      const mb = window.Telegram?.WebApp?.MainButton;
      if (!mb) return;
      try {
        if (this._onClick) { try { mb.offClick(this._onClick); } catch {} this._onClick = null; }
        mb.hide();
      } catch {}
    },
    progress(on) {
      const mb = window.Telegram?.WebApp?.MainButton;
      if (!mb) return;
      try { on ? mb.showProgress(false) : mb.hideProgress(); } catch {}
    },
    setText(text) {
      const mb = window.Telegram?.WebApp?.MainButton;
      try { mb && mb.setText(text); } catch {}
    },
  };

  // ─── BackButton — нативная кнопка «назад» в шапке Telegram ─────────────────
  window.tgBack = {
    show(onBack) {
      const bb = window.Telegram?.WebApp?.BackButton;
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
      const bb = window.Telegram?.WebApp?.BackButton;
      if (!bb) return;
      try {
        if (this._onClick) { try { bb.offClick(this._onClick); } catch {} this._onClick = null; }
        bb.hide();
      } catch {}
    },
  };

  // ─── Scroll Lock ───────────────────────────────────────────────────────────
  // Безшовное открытие модалок — фиксируем body, не теряя позицию скролла.
  // Раньше использовали body.style.overflow = 'hidden', что вызывало:
  //   1) на десктопе — сдвиг контента вправо (исчезает скроллбар)
  //   2) на iOS Safari — прыжок sticky-хедера и проскролл фона
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
  // window.linkifyPhones(document.getElementById('shops-content'))
  // ────────────────────────────────────────────────────────────────────────────
  const PHONE_RE = /(\+?7|8)[\s\-().]*(\d{3,4})[\s\-().]*(\d{2,3})[\s\-().]*(\d{2})[\s\-().]*(\d{2})/g;
  window.linkifyPhones = function(root) {
    if (!root || !root.querySelectorAll) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        // Игнорируем text внутри <a>, <input>, <textarea>, <script>
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

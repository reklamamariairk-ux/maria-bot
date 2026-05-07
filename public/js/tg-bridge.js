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
      const tp = tg.themeParams || {};
      const root = document.documentElement;
      const set = (k, fallback) => { if (tp[k]) root.style.setProperty('--tg-'+k.replace(/_/g,'-'), tp[k]); else if (fallback) root.style.setProperty('--tg-'+k.replace(/_/g,'-'), fallback); };
      set('bg_color',          '#fdf8f9');
      set('text_color',        '#130008');
      set('hint_color',        '#8b949e');
      set('link_color',        '#d61f37');
      set('button_color',      '#d61f37');
      set('button_text_color', '#ffffff');
      set('secondary_bg_color','#ffffff');
      set('section_bg_color',  '#ffffff');
      set('header_bg_color',   tp.bg_color || '#fdf8f9');

      const isDark = (tg.colorScheme === 'dark');
      root.classList.toggle('tg-dark', isDark);
      root.classList.toggle('tg-light', !isDark);
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

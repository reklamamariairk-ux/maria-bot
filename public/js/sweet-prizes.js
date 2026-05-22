/* ── Sweet Check prizes loader ──────────────────────────────────────────────
   Грузит data/sweet-check-prizes.json (через /api/sweet-check/prizes) и
   рендерит во все места UI где раньше призы были hardcoded:
   - #home-club-chip-sub  (главная chip)
   - #ob-step-prizes      (onboarding step)
   - #sweet-prizes-list   (детальный grid в клубе)
   - club.js renderSweetCheckPanel — вызывает window.SWEET_PRIZES для prize-list
   - app.js stories sweet — вызывает window.SWEET_PRIZES для title/sub
*/
(function(){
  const PLACE_EMOJI = { 1: '🥇', 2: '🥈', 3: '🥉' };

  function render(cfg) {
    if (!cfg || !Array.isArray(cfg.prizes)) return;
    window.SWEET_PRIZES = cfg;
    const namesOnly = cfg.prizes.map(p => p.name);
    const top3 = namesOnly.slice(0, 3).join(', ');

    // #home-club-chip-sub: «Кэшбэк до 10% · билет в розыгрыш <headline_name>»
    const homeSub = document.getElementById('home-club-chip-sub');
    if (homeSub && cfg.headline_name) {
      homeSub.textContent = `Кэшбэк до 10% · билет в розыгрыш ${cfg.headline_name}`;
    }

    // #ob-step-prizes: «<top3> — разыгрываем каждый квартал»
    const obSub = document.getElementById('ob-step-prizes');
    if (obSub && namesOnly.length > 0) {
      obSub.textContent = `${top3} — ${cfg.quarter_label.toLowerCase()}`;
    }

    // #sweet-prizes-list: полный grid
    const list = document.getElementById('sweet-prizes-list');
    if (list) {
      list.innerHTML = cfg.prizes.map(p => {
        const place = PLACE_EMOJI[p.place] || '🥉';
        const sub = p.sub ? `<div class="prize__sub">${escapeHtml(p.sub)}</div>` : '';
        return `<div class="prize prize--${p.place}">
          <div class="prize__place">${place}</div>
          <div class="prize__icon">${p.emoji}</div>
          <div class="prize__name">${escapeHtml(p.name)}</div>
          ${sub}
        </div>`;
      }).join('');
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  async function loadAndRender() {
    try {
      const r = await fetch('/api/sweet-check/prizes', { cache: 'no-store' });
      if (!r.ok) return;
      const cfg = await r.json();
      render(cfg);
      // Если club tab уже отрендерил scp__top — перерисовать с актуальными призами
      if (typeof window.renderSweetCheckMy === 'function') {
        try { window.renderSweetCheckMy(window._lastLkData || {}); } catch {}
      }
    } catch (e) { console.warn('[sweet-prizes]', e); }
  }

  window.loadSweetPrizes = loadAndRender;
  if (document.readyState !== 'loading') loadAndRender();
  else document.addEventListener('DOMContentLoaded', loadAndRender);
})();

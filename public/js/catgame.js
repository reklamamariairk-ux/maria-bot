/* ── Игра «Котик ловит пироги» ────────────────────────────────────────────
 * Ловилка на canvas. Кот (один спрайт) внизу, ловит падающие пироги
 * (реальные фото из каталога 1С). Очки → звёзды (бэкенд /api/game-result,
 * дневной кап + личный рекорд). Работает в TG и VK, гость может играть.
 * ───────────────────────────────────────────────────────────────────────── */
(function () {
  const PURE = document.documentElement.classList.contains('ck-pure');
  const GAME_KEY = 'cat_catch';
  const CAT_SRC = '/assets/images/cat-mascot-cut.png';
  const LIVES = 3;
  const PTS_PER_PIE = 10;

  let overlay, canvas, ctx, raf;
  let opening = false;
  let catImg = null;
  let pieImgs = [];           // загруженные картинки пирогов
  const view = { w: 0, h: 0 }; // кэш размеров канваса (не дёргать getBoundingClientRect в loop)
  const state = {
    running: false, score: 0, lives: LIVES, best: 0,
    catX: 0, catW: 96, catH: 116, floorY: 0,
    items: [], spawnT: 0, spawnEvery: 900, speed: 1, t0: 0, last: 0,
  };
  try { state.best = +localStorage.getItem('cg_best') || 0; } catch (_) {}

  // ── Загрузка ассетов ──────────────────────────────────────────────────────
  function loadImg(src) {
    return new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = src;
    });
  }
  async function loadPies() {
    if (pieImgs.length) return;
    try {
      const r = await fetch('/api/catalog/products?limit=24');
      const d = await r.json();
      const withImg = (d.products || []).filter(p => p.image).slice(0, 14);
      // приоритет пирогам
      withImg.sort((a, b) => (/pie|пирог/i.test(b.section_code || b.name || '') ? 1 : 0) - (/pie|пирог/i.test(a.section_code || a.name || '') ? 1 : 0));
      const picks = withImg.slice(0, 6);
      const loaded = await Promise.all(picks.map(p => loadImg('/img?u=' + encodeURIComponent(p.image))));
      pieImgs = loaded.filter(Boolean).map((im, i) => ({ im, id: picks[i].id, name: picks[i].name }));
    } catch (_) {}
  }

  // ── UI ──────────────────────────────────────────────────────────────────
  function ensureStyles() {
    if (document.getElementById('catgame-css')) return;
    const s = document.createElement('style');
    s.id = 'catgame-css';
    s.textContent = `
      .cg-ov{position:fixed;inset:0;z-index:9999;background:linear-gradient(180deg,#fff5e8 0%,#ffe6cf 60%,#ffd9b3 100%);display:none;flex-direction:column;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;}
      .cg-ov.on{display:flex}
      .cg-top{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;font-weight:800;color:#7a3b12}
      .cg-top .cg-score{font-size:22px}
      .cg-top .cg-lives{font-size:18px;letter-spacing:2px}
      .cg-x{position:relative;background:rgba(255,255,255,.7);border:none;border-radius:50%;width:36px;height:36px;font-size:20px;color:#7a3b12;cursor:pointer}
      .cg-x::after{content:'';position:absolute;inset:-6px}
      .cg-canvas{flex:1;display:block;width:100%}
      .cg-panel{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;background:rgba(255,245,232,.92);backdrop-filter:blur(2px)}
      .cg-panel.on{display:flex}
      .cg-panel h2{margin:0;font-size:26px;color:#7a3b12;font-weight:900}
      .cg-panel p{margin:0;color:#9a5a2a;font-size:15px;line-height:1.4;max-width:300px}
      .cg-big{font-size:46px}
      .cg-stars{font-size:18px;font-weight:800;color:#d61f37}
      .cg-btn{appearance:none;border:none;border-radius:16px;padding:14px 26px;font-size:17px;font-weight:800;cursor:pointer;background:#d61f37;color:#fff;box-shadow:0 6px 18px rgba(214,31,55,.35)}
      .cg-btn:active{transform:scale(.96)}
      .cg-btn--ghost{background:#fff;color:#7a3b12;box-shadow:0 4px 12px rgba(0,0,0,.08)}
      .cg-row{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
      .cg-hint{position:absolute;left:0;right:0;bottom:18px;text-align:center;color:#b06a36;font-size:13px;pointer-events:none}
    `;
    document.head.appendChild(s);
  }

  function buildOverlay() {
    ensureStyles();
    overlay = document.createElement('div');
    overlay.className = 'cg-ov';
    overlay.innerHTML = `
      <div class="cg-top">
        <div class="cg-score">🥧 <span id="cg-score">0</span></div>
        <div class="cg-lives" id="cg-lives">❤️❤️❤️</div>
        <button class="cg-x" id="cg-x" aria-label="Закрыть">×</button>
      </div>
      <canvas class="cg-canvas" id="cg-canvas"></canvas>
      <div class="cg-hint" id="cg-hint">Веди котика пальцем — лови пироги!</div>
      <div class="cg-panel" id="cg-panel"></div>
    `;
    document.body.appendChild(overlay);
    canvas = overlay.querySelector('#cg-canvas');
    ctx = canvas.getContext('2d');
    overlay.querySelector('#cg-x').onclick = close;

    // управление
    const move = (clientX) => {
      const rect = canvas.getBoundingClientRect();
      state.catX = Math.max(state.catW / 2, Math.min(rect.width - state.catW / 2, clientX - rect.left));
    };
    canvas.addEventListener('pointermove', (e) => { if (state.running) move(e.clientX); });
    canvas.addEventListener('pointerdown', (e) => {
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {} // палец за краем не теряет кота
      move(e.clientX);
    });
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    view.w = rect.width; view.h = rect.height;
    state.floorY = rect.height - 8;
    state.catX = state.catX
      ? Math.max(state.catW / 2, Math.min(rect.width - state.catW / 2, state.catX))
      : rect.width / 2;
  }

  // ── Игровой цикл ──────────────────────────────────────────────────────────
  function spawn() {
    const size = 46 + Math.random() * 14;
    const golden = Math.random() < 0.08;
    state.items.push({
      x: size + Math.random() * (view.w - size * 2),
      y: -size, size,
      vy: (1.6 + Math.random() * 1.2) * state.speed,
      img: pieImgs.length ? pieImgs[(Math.random() * pieImgs.length) | 0] : null,
      golden,
    });
  }

  function loop(ts) {
    if (!state.running) return;
    // кап ~60fps (на 120Гц-экранах не ускоряем спавн-логику)
    if (state.last && ts - state.last < 15) { raf = requestAnimationFrame(loop); return; }
    if (!state.last) state.last = ts;
    const dt = Math.min(40, ts - state.last); state.last = ts;

    // спавн
    state.spawnT += dt;
    if (state.spawnT >= state.spawnEvery) { state.spawnT = 0; spawn(); }

    // сложность растёт
    state.speed = 1 + state.score / 400;
    state.spawnEvery = Math.max(420, 900 - state.score / 2);

    ctx.clearRect(0, 0, view.w, view.h);

    // предметы
    const catTop = state.floorY - state.catH;
    for (let i = state.items.length - 1; i >= 0; i--) {
      const it = state.items[i];
      it.y += it.vy * dt / 16;
      // поймал? (предмет в зоне кота у пола)
      if (it.y + it.size / 2 >= catTop + 18 && Math.abs(it.x - state.catX) < state.catW / 2) {
        const pts = it.golden ? PTS_PER_PIE * 5 : PTS_PER_PIE;
        state.score += pts;
        state.items.splice(i, 1);
        window.haptic?.('light');
        bumpScore(it.golden);
        continue;
      }
      // упал мимо
      if (it.y - it.size / 2 > state.floorY) {
        state.items.splice(i, 1);
        loseLife();
        if (!state.running) return; // gameOver внутри loseLife — не продолжаем тик
        continue;
      }
      drawItem(it);
    }
    drawCat();
    raf = requestAnimationFrame(loop);
  }

  function drawItem(it) {
    if (it.golden) {
      ctx.save();
      ctx.shadowColor = '#ffcc33'; ctx.shadowBlur = 16;
    }
    if (it.img && it.img.im) {
      const s = it.size;
      ctx.save();
      ctx.beginPath();
      ctx.arc(it.x, it.y, s / 2, 0, Math.PI * 2);
      ctx.closePath(); ctx.clip();
      ctx.drawImage(it.img.im, it.x - s / 2, it.y - s / 2, s, s);
      ctx.restore();
      ctx.strokeStyle = it.golden ? '#ffb300' : 'rgba(255,255,255,.85)';
      ctx.lineWidth = it.golden ? 3 : 2;
      ctx.beginPath(); ctx.arc(it.x, it.y, it.size / 2, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.font = `${it.size}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(it.golden ? '🌟' : '🥧', it.x, it.y);
    }
    if (it.golden) ctx.restore();
  }

  function drawCat() {
    if (!catImg) {
      ctx.font = '64px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText('🐱', state.catX, state.floorY);
      return;
    }
    const w = state.catW, h = state.catH;
    ctx.drawImage(catImg, state.catX - w / 2, state.floorY - h, w, h);
  }

  function bumpScore(golden) {
    const el = document.getElementById('cg-score');
    if (el) { el.textContent = String(state.score); el.style.transform = 'scale(1.25)'; el.style.color = golden ? '#ffb300' : ''; setTimeout(() => { el.style.transform = ''; el.style.color = ''; }, 140); }
  }
  function renderLives() {
    const el = document.getElementById('cg-lives');
    if (el) el.textContent = '❤️'.repeat(state.lives) + '🖤'.repeat(LIVES - state.lives);
  }
  function loseLife() {
    if (!state.running || state.lives <= 0) return; // два промаха в одном тике → один gameOver
    state.lives--;
    window.haptic?.('error');
    renderLives();
    if (state.lives <= 0) gameOver();
  }

  // ── Старт / конец ──────────────────────────────────────────────────────────
  function startRound() {
    cancelAnimationFrame(raf); // не плодить второй rAF-цикл
    state.score = 0; state.lives = LIVES; state.items = [];
    state.spawnT = 0; state.spawnEvery = 900; state.speed = 1; state.last = 0;
    document.getElementById('cg-score').textContent = '0';
    renderLives();
    document.getElementById('cg-panel').classList.remove('on');
    document.getElementById('cg-hint').style.display = '';
    resize();
    state.running = true;
    raf = requestAnimationFrame(loop);
  }

  // сигнал таймаута для fetch (5с), с фолбэком для старых webview
  function timeoutSignal(ms) {
    if (AbortSignal.timeout) return AbortSignal.timeout(ms);
    const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal;
  }

  // отправка результата — панель уже показана, дописываем строку награды
  async function postResult(panel) {
    const line = panel.querySelector('#cg-reward');
    if (!line) return;
    try {
      const r = await fetch('/api/game-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...App.authHeader() },
        body: JSON.stringify({ game: GAME_KEY, score: state.score }),
        signal: timeoutSignal(5000),
      });
      const d = await r.json();
      let rewardLine = '';
      if (PURE) {
        // pure-режим: без клубных звёзд/CTA в UI, рекорд уже показан в тексте выше
      } else if (d.gated) rewardLine = '🔓 Подтверди номер в Профиле — и за игру будут капать звёзды.';
      else if (d.starsAwarded > 0) rewardLine = `⭐ +${d.starsAwarded} ${d.capped ? '(дневной лимит достигнут)' : ''}`;
      else if (d.capped) rewardLine = '⭐ Дневной лимит звёзд достигнут — рекорд засчитан!';
      if (!PURE && typeof d.balance?.stars === 'number') rewardLine += rewardLine ? ` · всего ⭐ ${d.balance.stars}` : `Всего ⭐ ${d.balance.stars}`;
      if (rewardLine) { line.textContent = rewardLine; line.style.display = ''; }
    } catch (_) {
      line.textContent = 'Не удалось сохранить результат';
      line.style.display = '';
    }
  }

  function gameOver() {
    state.running = false;
    cancelAnimationFrame(raf);
    const panel = document.getElementById('cg-panel');
    document.getElementById('cg-hint').style.display = 'none';
    const isRecord = state.score > state.best;
    if (isRecord) {
      state.best = state.score;
      try { localStorage.setItem('cg_best', String(state.best)); } catch (_) {}
    }
    window.haptic?.(isRecord ? 'success' : 'warning');

    const authed = !!window.App?.isAuthed?.();
    // панель сразу, награду допишем после ответа сервера
    let rewardLine = (!authed && !PURE) ? 'Открой игру через приложение «Марии» — и за рекорды будут звёзды.' : '';
    panel.innerHTML = `
      <div class="cg-big">${isRecord ? '🏆' : '🐱'}</div>
      <h2>${isRecord ? 'Новый рекорд!' : 'Игра окончена'}</h2>
      <p>Котик собрал <b>${state.score}</b> очков${state.best ? ` · рекорд ${state.best}` : ''}.</p>
      <p class="cg-stars" id="cg-reward" ${rewardLine ? '' : 'style="display:none"'}>${rewardLine}</p>
      <div class="cg-row">
        <button class="cg-btn" id="cg-again">Ещё раз 🥧</button>
        <button class="cg-btn cg-btn--ghost" id="cg-share">Похвастаться</button>
      </div>
      <div class="cg-row"><button class="cg-btn cg-btn--ghost" id="cg-close2">В меню</button></div>
    `;
    panel.classList.add('on');
    if (authed) postResult(panel);
    panel.querySelector('#cg-again').onclick = startRound;
    panel.querySelector('#cg-close2').onclick = close;
    panel.querySelector('#cg-share').onclick = () => {
      const link = window.App?.appLink?.() || 'https://t.me/mariatortik_bot';
      const txt = `Я набрал ${state.score} очков в игре «Котик ловит пироги» от кондитерской «Мария» 🐱🥧 Побей мой рекорд! ${link}`;
      if (window.App?.share) App.share(txt); else if (navigator.share) navigator.share({ text: txt }).catch(() => {});
    };
  }

  // ── Публичный API ──────────────────────────────────────────────────────────
  async function open() {
    if (opening || (overlay && overlay.classList.contains('on'))) return; // даблтап по «Играть»
    opening = true;
    try {
      if (!overlay) buildOverlay();
      overlay.classList.add('on');
      window.scrollLock?.();
      if (!catImg) catImg = await loadImg(CAT_SRC);
      await loadPies();
    } finally { opening = false; }
    if (!overlay.classList.contains('on')) return; // закрыли, пока грузились ассеты — не плодим зомби-игру
    requestAnimationFrame(() => {
      if (!overlay.classList.contains('on')) return;
      resize(); startRound();
    });
  }
  function close() {
    state.running = false;
    cancelAnimationFrame(raf);
    if (overlay) overlay.classList.remove('on');
    window.scrollUnlock?.();
  }
  window.catGameOpen = open;
  window.catGameClose = close;
  window.addEventListener('resize', () => { if (overlay && overlay.classList.contains('on')) resize(); });
})();

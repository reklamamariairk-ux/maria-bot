/* ── «Драг-заезд» — полноэкранный оверлей поверх кликера, canvas-анимация заезда ──
 * Спека: docs/superpowers/specs/2026-07-15-drag-race-design.md (раздел «Клиент»).
 * Отдельный always-on режим поверх голубятни/тюнинга — НЕ трогает недельную гонку
 * (catdove.js::raceHtml/openRaceBreedPicker остаются как были, просто рядом кнопка входа).
 * API: window.CatDrag = { open(api, breed) } — api — тот же fetch-хелпер catclick.js
 * (initData-заголовки), передаётся из catdove.js (apiRef) при клике «🏁 Драг-заезд».
 * Тосты — window.ckFlash; синхронизация энергии/баланса кликера после заезда —
 * window.ckSyncState (мост в catclick.js рядом с window.ckApi); чтение текущего
 * баланса/энергии для UI (дизейбл ставок/старта) — window.ckBalance()/window.ckEnergy().
 * Своя CSS-неймспейс cd-drag-* с собственными бренд-переменными (копия .ck-ov) —
 * оверлей монтируется прямо в <body>, не полагается на DOM-вложенность в .ck-ov.
 * Исход заезда решает ТОЛЬКО сервер (POST /race) — reactionMs тут лишь честно
 * измеряется и отправляется, клиент не доверенный (см. спеку «Античит»).
 * ──────────────────────────────────────────────────────────────────────────────── */
(function () {
  // Мини-каталог пород только для отображения (имя/рамка редкости карточки) — зеркало
  // catdove.js::BREEDS / src/pigeons.ts::PIGEON_BREEDS. Мощность/финиш/места — всегда
  // из ответа сервера, тут чистая косметика превью-карточек.
  const BREED_META = {
    sizar: { name: 'Сизарь', rarity: 'common' },
    belobok: { name: 'Белобокий', rarity: 'common' },
    ryaboy: { name: 'Рябой', rarity: 'common' },
    chubaty: { name: 'Чубатый', rarity: 'common' },
    vanil: { name: 'Ванильный', rarity: 'rare' },
    shoko: { name: 'Шоколадный', rarity: 'rare' },
    karamel: { name: 'Карамельный', rarity: 'rare' },
    yagodny: { name: 'Ягодный', rarity: 'rare' },
    pochtar: { name: 'Иркутский почтарь', rarity: 'epic' },
    baikal: { name: 'Байкальский гонец', rarity: 'epic' },
    kurier: { name: 'Ночной курьер', rarity: 'epic' },
    vozhak: { name: 'Вожак стаи', rarity: 'epic' },
    svadebny: { name: 'Свадебный', rarity: 'epic' },
    imeninny: { name: 'Именинный', rarity: 'epic' },
    snezhny: { name: 'Снежный', rarity: 'epic' },
    zolotoy: { name: 'Золотой голубь Василия', rarity: 'legendary' },
    champion: { name: 'Чемпион', rarity: 'legendary' },
  };
  const STAKE_PRESETS = [500, 2000, 10000]; // зеркало src/drag.ts::STAKE_PRESETS
  const DRAG_ENERGY_COST = 250;             // зеркало src/drag.ts::DRAG_ENERGY_COST

  const esc = (s) => (window.escapeHtml ? window.escapeHtml(s) : String(s == null ? '' : s));
  const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('ru-RU');
  const num = (n) => { const v = Number(n); return Number.isFinite(v) ? v : 0; };
  function flash(msg) { if (window.ckFlash) window.ckFlash(msg); }
  function haptic(k) { window.haptic && window.haptic(k); }
  function meta(breed) { return BREED_META[breed] || { name: String(breed || ''), rarity: 'common' }; }
  function artSrc(breed) { return `/img/pigeons/${encodeURIComponent(breed)}.webp?v=1`; }
  function artTag(breed) {
    return `<img src="${artSrc(breed)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span style="display:none;align-items:center;justify-content:center;width:100%;height:100%;font-size:22px">🕊️</span>`;
  }

  const ERR_REASON = {
    no_energy: 'Не хватает энергии — подожди восстановления',
    not_enough_coins: 'Не хватает монет на ставку',
    not_owned: 'Птица не найдена',
    bad_stake: 'Такая ставка не годится',
    bad_mode: 'Такой режим не годится',
  };

  // ── состояние оверлея (модульный синглтон — открыт максимум один заезд разом) ───
  let ov = null, apiRef = null, session = 0, resizeHandler = null;
  let curBreed = null, mode = 'training', stake = STAKE_PRESETS[0];
  let opponentsPreview = null; // null=грузится, []=подобрать не удалось (не блокирует старт — сервер подберёт сам)
  let raceBusy = false, step = 'setup'; // setup | race | result

  // canvas / анимация заезда
  let canvas = null, ctx = null, raf = 0, dpr = 1, cssW = 0, cssH = 0;
  const artCache = {}; // переживает open()/close() — переиспользуем уже загруженные спрайты
  let phase = 'idle';  // idle | go | animating | done
  let t0 = 0, raceStartTs = 0, raceData = null, animScale = 1;
  let tapZoneEl = null, tapCaptured = false;
  let countdownTimers = [];

  function loadArt(breed) {
    let rec = artCache[breed];
    if (rec) return rec;
    const img = new Image();
    rec = { img, ok: null };
    img.onload = () => { rec.ok = true; };
    img.onerror = () => { rec.ok = false; };
    img.src = artSrc(breed);
    artCache[breed] = rec;
    return rec;
  }
  function clearTimers() { countdownTimers.forEach((t) => clearTimeout(t)); countdownTimers = []; }
  function stopLoop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
  function removeTapZone() { if (tapZoneEl) { tapZoneEl.removeEventListener('pointerdown', onTap); tapZoneEl = null; } }

  // ── стили (свой неймспейс, собственные CSS-переменные — оверлей висит в body,
  // не внутри .ck-ov, поэтому переменные бренда объявлены заново на своём корне) ──
  function styles() {
    if (document.getElementById('catdrag-css')) return;
    const s = document.createElement('style'); s.id = 'catdrag-css';
    s.textContent = `
      .cd-drag-ov{--gold:#f0c24e;--gold-l:#ffe39c;--cream:#eee7dd;--ink:#f1ece6;--muted:#9aa0ab;--panel:rgba(255,255,255,.06);--line:rgba(255,255,255,.1);
        position:fixed;inset:0;z-index:10050;display:flex;flex-direction:column;
        background:radial-gradient(130% 100% at 50% -10%,#2c2320 0%,#1a1413 52%,#0e0a09 100%);
        color:var(--ink);font-family:'Nunito','Mulish',system-ui,sans-serif;
        opacity:0;pointer-events:none;transition:opacity .22s ease-out;
        touch-action:manipulation;user-select:none;-webkit-user-select:none}
      .cd-drag-ov.on{opacity:1;pointer-events:auto}
      .cd-drag-hd{flex:none;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 14px 6px}
      .cd-drag-t{font-weight:800;font-size:16px;color:var(--cream)}
      .cd-drag-x{width:32px;height:32px;flex:none;border:1px solid var(--line);border-radius:50%;background:rgba(0,0,0,.28);color:var(--cream);font-size:15px;cursor:pointer}
      .cd-drag-body{flex:1;min-height:0;overflow-y:auto;padding:6px 14px calc(16px + env(safe-area-inset-bottom,0px))}
      .cd-drag-my{display:flex;align-items:center;gap:12px;background:var(--panel);border:2px solid var(--gold);border-radius:16px;padding:11px 12px;margin-bottom:14px;box-shadow:0 3px 12px rgba(238,191,82,.15)}
      .cd-drag-my__art{width:52px;height:52px;flex:none;border-radius:12px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.22)}
      .cd-drag-my__art img{width:86%;height:86%;object-fit:contain}
      .cd-drag-my__b{flex:1;min-width:0}
      .cd-drag-my__n{font-weight:800;font-size:14.5px;color:var(--gold-l)}
      .cd-drag-my__p{font-size:12px;color:var(--muted);margin-top:2px}
      .cd-drag-sect{color:var(--muted);font-weight:700;font-size:11px;margin:12px 2px 7px;text-transform:uppercase;letter-spacing:.6px}
      .cd-drag-seg{display:flex;gap:6px;background:rgba(0,0,0,.24);border-radius:13px;padding:4px}
      .cd-drag-seg__b{flex:1;text-align:center;padding:10px 6px;border-radius:10px;font-weight:700;font-size:13px;color:var(--muted);cursor:pointer;background:transparent;border:none}
      .cd-drag-seg__b.on{background:var(--panel);color:var(--gold-l);box-shadow:0 0 0 1px var(--line) inset}
      .cd-drag-stakes{display:flex;gap:8px;margin-top:10px}
      .cd-drag-stake{flex:1;text-align:center;padding:10px 4px;border-radius:12px;border:2px solid var(--line);background:var(--panel);color:var(--ink);font-weight:800;font-size:13px;cursor:pointer}
      .cd-drag-stake.on{border-color:var(--gold);color:var(--gold-l);box-shadow:0 0 8px rgba(238,191,82,.28)}
      .cd-drag-stake:disabled{opacity:.4;cursor:default}
      .cd-drag-oppgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
      .cd-drag-card{background:var(--panel);border:2px solid var(--line);border-radius:13px;padding:8px 4px;text-align:center;box-sizing:border-box}
      .cd-drag-card[data-r="common"]{border-color:rgba(141,146,156,.55)}
      .cd-drag-card[data-r="rare"]{border-color:#b8813f}
      .cd-drag-card[data-r="epic"]{border-color:#9070c2}
      .cd-drag-card[data-r="legendary"]{border-color:var(--gold);box-shadow:0 0 8px rgba(238,191,82,.28)}
      .cd-drag-card__art{width:100%;aspect-ratio:1;border-radius:9px;margin:0 auto 5px;display:flex;align-items:center;justify-content:center;background:rgba(238,191,82,.08);overflow:hidden}
      .cd-drag-card__art img{width:78%;height:78%;object-fit:contain}
      .cd-drag-card__n{font-weight:700;font-size:9.5px;color:var(--ink);line-height:1.2;min-height:2.2em;display:flex;align-items:center;justify-content:center}
      .cd-drag-card__p{font-size:10px;color:var(--gold-l);font-weight:800;margin-top:2px}
      .cd-drag-hint{font-size:11.5px;color:var(--muted);text-align:center;margin:10px 2px 0;line-height:1.5}
      .cd-drag-cta{width:100%;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:7px;border:1px solid #ffe9b3;border-radius:14px;padding:14px;font-weight:800;font-size:15px;background:linear-gradient(180deg,#ffe7a6,#eebf52 56%,#cf9a36);color:#5a2028;cursor:pointer;margin-top:16px;min-height:48px}
      .cd-drag-cta:disabled{background:rgba(255,255,255,.07);color:var(--muted);border-color:transparent;cursor:default}
      .cd-drag-race{position:relative;flex:1;display:flex;flex-direction:column;padding:0 10px 10px}
      .cd-drag-canvas{width:100%;display:block;border-radius:14px;background:#120d0b}
      .cd-drag-tap{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;pointer-events:none}
      .cd-drag-cd{font-family:'Nunito',sans-serif;font-weight:900;color:var(--gold-l);text-shadow:0 4px 18px rgba(0,0,0,.6);animation:cdDragPop .5s ease-out}
      .cd-drag-cd--num{font-size:64px}
      .cd-drag-cd--go{font-size:48px;color:#9be7a8}
      @keyframes cdDragPop{0%{opacity:0;transform:scale(.5)}55%{opacity:1;transform:scale(1.12)}100%{opacity:1;transform:scale(1)}}
      .cd-drag-tapline{font-size:14px;font-weight:800;color:var(--cream);background:rgba(0,0,0,.42);border-radius:12px;padding:8px 16px;animation:cdDragPulse 1s ease-in-out infinite}
      @keyframes cdDragPulse{0%,100%{opacity:.7}50%{opacity:1}}
      .cd-drag-result{position:absolute;left:10px;right:10px;bottom:10px;background:linear-gradient(180deg,#2e1119,#1d0a11);border:1px solid var(--line);border-radius:18px;padding:18px;text-align:center;box-shadow:0 -10px 30px rgba(0,0,0,.5)}
      .cd-drag-place{font-family:'Nunito',sans-serif;font-weight:900;font-size:26px;color:var(--gold-l)}
      .cd-drag-reward{font-size:16px;font-weight:800;margin-top:6px;color:var(--muted)}
      .cd-drag-reward.pos{color:#9be7a8}
      .cd-drag-reward.neg{color:#e5847d}
      .cd-drag-resrow{display:flex;gap:8px;margin-top:14px}
      .cd-drag-resbtn{flex:1;border:1px solid #ffe9b3;border-radius:12px;padding:11px;font-weight:800;font-size:13px;background:linear-gradient(180deg,#ffe7a6,#eebf52 56%,#cf9a36);color:#5a2028;cursor:pointer}
      .cd-drag-resbtn--ghost{background:rgba(255,255,255,.07);color:var(--ink);border-color:var(--line)}
      @media (prefers-reduced-motion:reduce){.cd-drag-cd{animation:none}.cd-drag-tapline{animation:none}}
    `;
    document.head.appendChild(s);
  }

  // ── превью-карточка соперника/своей птицы (сет-грид на экране настройки) ────────
  function cardHtml(breed, power, bot) {
    const m = meta(breed);
    return `<div class="cd-drag-card" data-r="${esc(m.rarity)}">
      <div class="cd-drag-card__art">${artTag(breed)}</div>
      <div class="cd-drag-card__n">${bot ? 'Соперник' : esc(m.name)}</div>
      <div class="cd-drag-card__p">⚡ ${Math.round(num(power))}</div>
    </div>`;
  }

  // ── экран настройки (порода/режим/ставка/превью соперников) ────────────────────
  function setupHtml() {
    const m = meta(curBreed);
    const energy = typeof window.ckEnergy === 'function' ? num(window.ckEnergy()) : null;
    const balance = typeof window.ckBalance === 'function' ? num(window.ckBalance()) : null;
    const lowEnergy = energy !== null && energy < DRAG_ENERGY_COST;
    const oppHtml = opponentsPreview === null
      ? `<div class="cd-drag-oppgrid">${[0, 1, 2].map(() => `<div class="cd-drag-card"><div class="cd-drag-card__art"></div><div class="cd-drag-card__n">…</div></div>`).join('')}</div>`
      : (opponentsPreview.length
        ? `<div class="cd-drag-oppgrid">${opponentsPreview.map((o) => cardHtml(o.breed, o.power, !!o.bot)).join('')}</div>`
        : `<div class="cd-drag-hint">Соперников подберём прямо на старте.</div>`);
    const stakesHtml = mode === 'bet'
      ? `<div class="cd-drag-stakes">${STAKE_PRESETS.map((v) => `<button class="cd-drag-stake${v === stake ? ' on' : ''}" data-stake="${v}" ${balance !== null && v > balance ? 'disabled' : ''}>${fmt(v)}</button>`).join('')}</div>`
      : '';
    const canStart = opponentsPreview !== null && !lowEnergy;
    return `<div class="cd-drag-hd"><div class="cd-drag-t">🏁 Драг-заезд</div><button class="cd-drag-x" id="cd-drag-x">×</button></div>
      <div class="cd-drag-body">
        <div class="cd-drag-my">
          <div class="cd-drag-my__art">${artTag(curBreed)}</div>
          <div class="cd-drag-my__b"><div class="cd-drag-my__n">${esc(m.name)}</div><div class="cd-drag-my__p">Твой боец на старте</div></div>
        </div>
        <div class="cd-drag-sect">Режим</div>
        <div class="cd-drag-seg">
          <button class="cd-drag-seg__b${mode === 'training' ? ' on' : ''}" data-mode="training">Тренировка</button>
          <button class="cd-drag-seg__b${mode === 'bet' ? ' on' : ''}" data-mode="bet">💰 Ставка</button>
        </div>
        ${stakesHtml}
        <div class="cd-drag-sect">Соперники</div>
        ${oppHtml}
        <div class="cd-drag-hint">Заезд стоит ${DRAG_ENERGY_COST} энергии.${lowEnergy ? ' Сейчас энергии не хватает — подожди восстановления.' : ''}</div>
        <button class="cd-drag-cta" id="cd-drag-start" ${canStart ? '' : 'disabled'}>Старт!</button>
      </div>`;
  }

  function renderSetup() {
    step = 'setup'; phase = 'idle'; raceData = null;
    if (!ov) return;
    ov.innerHTML = setupHtml();
    wireSetup();
  }
  function wireSetup() {
    const x = ov.querySelector('#cd-drag-x'); if (x) x.onclick = close;
    ov.querySelectorAll('[data-mode]').forEach((el) => { el.onclick = () => { mode = el.dataset.mode === 'bet' ? 'bet' : 'training'; renderSetup(); }; });
    ov.querySelectorAll('[data-stake]').forEach((el) => { el.onclick = () => { stake = num(el.dataset.stake); renderSetup(); }; });
    const startBtn = ov.querySelector('#cd-drag-start'); if (startBtn) startBtn.onclick = onStart;
  }

  async function loadOpponents(mySession) {
    const d = await apiRef('/api/pigeons/drag/opponents', { method: 'POST', body: JSON.stringify({ breed: curBreed }) }).catch(() => null);
    if (mySession !== session || !ov) return; // оверлей закрыт/переоткрыт — не трогаем DOM
    opponentsPreview = (d && Array.isArray(d.opponents)) ? d.opponents : [];
    if (step === 'setup') renderSetup();
  }

  // ── старт: экран заезда (canvas) + отсчёт 3-2-1-GO ──────────────────────────────
  async function onStart() {
    if (raceBusy || step !== 'setup') return; // busy-guard: пока идёт заезд/сеттап переоткрыт — повторный клик игнорируем
    if (mode === 'bet' && STAKE_PRESETS.indexOf(stake) === -1) { flash('Выбери ставку'); return; }
    haptic('medium');
    renderRaceScreen();
    runCountdown();
  }

  function renderRaceScreen() {
    step = 'race';
    if (!ov) return;
    ov.innerHTML = `<div class="cd-drag-hd"><div class="cd-drag-t">🏁 Драг-заезд</div><button class="cd-drag-x" id="cd-drag-x">×</button></div>
      <div class="cd-drag-race" id="cd-drag-race">
        <canvas class="cd-drag-canvas" id="cd-drag-canvas"></canvas>
        <div class="cd-drag-tap" id="cd-drag-tap"></div>
      </div>`;
    const x = ov.querySelector('#cd-drag-x'); if (x) x.onclick = close;
    canvas = ov.querySelector('#cd-drag-canvas');
    ctx = canvas.getContext('2d');
    setupCanvasSize();
    raceStartTs = 0; phase = 'idle';
    stopLoop();
    raf = requestAnimationFrame(tick);
  }

  function setupCanvasSize() {
    if (!canvas || !ctx) return;
    const wrap = canvas.parentElement;
    cssW = (wrap && wrap.clientWidth) || 320;
    const lanes = (raceData && Array.isArray(raceData.racers)) ? raceData.racers.length : (previewRacers().length || 4);
    cssH = Math.max(200, lanes * 62 + 24);
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function previewRacers() {
    const mine = { breed: curBreed, me: true };
    const opps = (opponentsPreview || []).map((o) => ({ breed: o.breed, me: false }));
    return [mine, ...opps];
  }

  // ── отрисовка трассы: 4 (или N) дорожек, спрайты голубей интерполированы по frac[0..1] ──
  function drawTrack(list, positions) {
    if (!ctx || !cssW || !cssH) return;
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = '#120d0b'; ctx.fillRect(0, 0, cssW, cssH);
    const n = list.length || 1;
    const laneH = cssH / n;
    const trackStart = 40, trackEnd = cssW - 46;
    for (let i = 0; i < n; i++) {
      const y = i * laneH;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,.035)' : 'rgba(255,255,255,.015)';
      ctx.fillRect(0, y, cssW, laneH);
    }
    ctx.strokeStyle = 'rgba(240,194,78,.55)';
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(trackStart, 0); ctx.lineTo(trackStart, cssH); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#f0c24e';
    for (let yy = 4; yy < cssH; yy += 11) ctx.fillRect(trackEnd, yy, 4, 6);
    list.forEach((r, i) => {
      const y = i * laneH + laneH / 2;
      const frac = positions[i] || 0;
      const x = trackStart + 16 + frac * (trackEnd - trackStart - 32);
      drawPigeon(r.breed, x, y, laneH * 0.7, !!r.me);
    });
  }
  function drawPigeon(breed, x, y, size, isMe) {
    const rec = loadArt(breed);
    ctx.save();
    if (isMe) { ctx.shadowColor = 'rgba(240,194,78,.85)'; ctx.shadowBlur = 12; }
    if (rec.ok) {
      ctx.drawImage(rec.img, x - size / 2, y - size / 2, size, size);
    } else {
      ctx.fillStyle = isMe ? '#f0c24e' : '#5b6472';
      ctx.beginPath(); ctx.arc(x, y, size / 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    if (isMe) {
      ctx.fillStyle = '#ffe39c'; ctx.font = '700 10px Nunito, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('ты', x, y + size / 2 + 12);
    }
  }

  function tick(ts) {
    if (!ov || !ctx) { raf = 0; return; }
    if (phase === 'animating' && raceData) {
      if (!raceStartTs) raceStartTs = ts;
      const elapsedSec = (ts - raceStartTs) / 1000;
      const scaledElapsed = elapsedSec / animScale;
      let allDone = true;
      const positions = raceData.racers.map((r) => {
        const ft = num(r.finishT);
        const frac = ft > 0 ? Math.min(1, scaledElapsed / ft) : 1;
        if (frac < 1) allDone = false;
        return frac;
      });
      drawTrack(raceData.racers, positions);
      if (!allDone) { raf = requestAnimationFrame(tick); return; }
      raf = 0; phase = 'done';
      setTimeout(() => { if (ov && step === 'race') renderResult(); }, 450);
      return;
    }
    // countdown/idle/go — статичная картинка на старте (моя птица + превью соперников)
    const list = previewRacers();
    drawTrack(list, list.map(() => 0));
    raf = requestAnimationFrame(tick);
  }

  // ── отсчёт 3-2-1-GO → замер реакции по первому тапу ─────────────────────────────
  function runCountdown() {
    clearTimers();
    const setTap = (html) => { const el = ov && ov.querySelector('#cd-drag-tap'); if (el) el.innerHTML = html; };
    setTap('<div class="cd-drag-cd cd-drag-cd--num">3</div>');
    countdownTimers.push(setTimeout(() => setTap('<div class="cd-drag-cd cd-drag-cd--num">2</div>'), 650));
    countdownTimers.push(setTimeout(() => setTap('<div class="cd-drag-cd cd-drag-cd--num">1</div>'), 1300));
    countdownTimers.push(setTimeout(() => {
      setTap('<div class="cd-drag-cd cd-drag-cd--go">СТАРТ!</div><div class="cd-drag-tapline">Тапни как можно быстрее!</div>');
      armTap();
    }, 1950));
  }
  function armTap() {
    tapCaptured = false;
    phase = 'go';
    t0 = performance.now();
    tapZoneEl = ov && ov.querySelector('#cd-drag-race');
    if (tapZoneEl) tapZoneEl.addEventListener('pointerdown', onTap, { passive: true });
    // Защита от зависания (игрок не тапнул) — сервер всё равно клампит reactionMs до 3000мс,
    // так что авто-тап на таймауте не даёт нечестного преимущества/проигрыша сверх этого.
    countdownTimers.push(setTimeout(() => onTap(), 3000));
  }
  function onTap() {
    if (tapCaptured || phase !== 'go') return; // busy-guard: второй тап/повторный таймер игнорируется
    tapCaptured = true;
    const reactionMs = performance.now() - t0;
    removeTapZone();
    const el = ov && ov.querySelector('#cd-drag-tap'); if (el) el.innerHTML = '<div class="cd-drag-tapline">Финиш считает сервер…</div>';
    phase = 'submitting';
    submitRace(reactionMs);
  }

  async function submitRace(reactionMs) {
    if (raceBusy) return; // busy-guard: не даём повторный POST, пока первый не ответил
    raceBusy = true;
    const mySession = session;
    const body = { breed: curBreed, mode, reactionMs: Math.round(reactionMs) };
    if (mode === 'bet') body.stake = stake;
    const d = await apiRef('/api/pigeons/drag/race', { method: 'POST', body: JSON.stringify(body) }).catch(() => null);
    raceBusy = false;
    const ok = !!(d && d.ok && Array.isArray(d.racers));
    // Синхронизируем баланс/энергию кликера сразу, как только знаем ответ — деньги/энергия
    // уже списаны на сервере независимо от того, закрыл ли игрок оверлей, пока ждал ответ.
    if (ok && typeof window.ckSyncState === 'function') window.ckSyncState({ balance: d.newBalance, energy: d.newEnergy });
    if (mySession !== session || !ov) return; // оверлей закрыт/переоткрыт, пока ждали ответ — DOM не трогаем
    if (!ok) {
      flash(ERR_REASON[d && d.error] || 'Не получилось запустить заезд');
      if (d && d.error === 'not_owned') { close(); return; }
      renderSetup();
      return;
    }
    haptic('medium');
    raceData = d;
    const maxFinishT = d.racers.reduce((m, r) => Math.max(m, num(r.finishT)), 0.5);
    const displayDur = Math.min(5, Math.max(1.6, maxFinishT)); // нормируем реальную длину анимации в приятный диапазон
    animScale = displayDur / maxFinishT;
    raceStartTs = 0;
    phase = 'animating';
    setupCanvasSize(); // число дорожек теперь берём из raceData.racers (могло отличаться от превью)
    const el = ov.querySelector('#cd-drag-tap'); if (el) el.innerHTML = '';
  }

  // ── итоговая плашка (место + выигрыш/потеря для ставки) ─────────────────────────
  function renderResult() {
    step = 'result';
    if (!ov || !raceData) return;
    const mine = raceData.racers.find((r) => r.me);
    const place = num(raceData.myPlace) || (mine ? num(mine.place) : 0);
    const isBet = mode === 'bet';
    const reward = num(raceData.reward);
    const race = ov.querySelector('#cd-drag-race');
    if (!race) return;
    const panel = document.createElement('div');
    panel.className = 'cd-drag-result';
    panel.innerHTML = `
      <div class="cd-drag-place">${place || '—'} место</div>
      ${isBet
        ? `<div class="cd-drag-reward ${reward > 0 ? 'pos' : reward < 0 ? 'neg' : ''}">${reward > 0 ? '+' : ''}${fmt(reward)} монет</div>`
        : `<div class="cd-drag-reward">Тренировка — без ставок</div>`}
      <div class="cd-drag-resrow">
        <button class="cd-drag-resbtn" id="cd-drag-again">Ещё раз</button>
        <button class="cd-drag-resbtn cd-drag-resbtn--ghost" id="cd-drag-done">Закрыть</button>
      </div>`;
    race.appendChild(panel);
    const again = panel.querySelector('#cd-drag-again');
    if (again) again.onclick = () => { opponentsPreview = null; renderSetup(); loadOpponents(session); };
    const done = panel.querySelector('#cd-drag-done');
    if (done) done.onclick = close;
  }

  // ── публичный API ────────────────────────────────────────────────────────────
  function open(api, breed) {
    if (!api || !breed) return;
    apiRef = api; curBreed = breed; mode = 'training'; stake = STAKE_PRESETS[0];
    opponentsPreview = null; raceBusy = false; phase = 'idle'; raceData = null;
    session++;
    const mySession = session;
    styles();
    if (!ov) { ov = document.createElement('div'); ov.className = 'cd-drag-ov'; document.body.appendChild(ov); }
    renderSetup();
    requestAnimationFrame(() => { if (ov) ov.classList.add('on'); });
    haptic('light');
    if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    resizeHandler = () => { if (canvas && document.body.contains(canvas)) setupCanvasSize(); };
    window.addEventListener('resize', resizeHandler);
    loadOpponents(mySession);
  }

  function close() {
    clearTimers(); stopLoop(); removeTapZone();
    if (resizeHandler) { window.removeEventListener('resize', resizeHandler); resizeHandler = null; }
    session++; // инвалидирует зависшие fetch/countdown-колбэки прежнего открытия
    const el = ov; ov = null; canvas = null; ctx = null;
    if (el) { el.classList.remove('on'); setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 240); }
    raceBusy = false; phase = 'idle'; step = 'setup'; raceData = null;
  }

  window.CatDrag = { open };
})();

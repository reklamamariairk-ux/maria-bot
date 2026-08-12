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
  const plu = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return (a > 10 && a < 20) ? many : (b > 1 && b < 5) ? few : (b === 1) ? one : many; };
  function flash(msg) { if (window.ckFlash) window.ckFlash(msg); }
  function haptic(k) { window.haptic && window.haptic(k); }
  function meta(breed) { return BREED_META[breed] || { name: String(breed || ''), rarity: 'common' }; }
  function artSrc(breed) { return `/img/pigeons/${encodeURIComponent(breed)}.webp?v=2`; }
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
  let curBreed = null, mode = 'training', stake = STAKE_PRESETS[0]; // mode: training | bet | qualify
  let friendRace = null;
  let qualifyData = null, qualifyDone = null, qualifySucceeded = false; // отборочный полёт недельной гонки
  let myPower = null;          // мощность моего голубя из ответа /opponents (null=ещё не знаем)
  let opponentsPreview = null; // null=грузится, []=подобрать не удалось (не блокирует старт — сервер подберёт сам)
  let raceBusy = false, step = 'setup'; // setup | race | result

  // canvas / анимация заезда
  let canvas = null, ctx = null, raf = 0, dpr = 1, cssW = 0, cssH = 0;
  const artCache = {}; // переживает open()/close() — переиспользуем уже загруженные спрайты
  let phase = 'idle';  // idle | go | animating | done
  let t0 = 0, raceStartTs = 0, raceData = null, animScale = 1;
  let tapZoneEl = null, tapCaptured = false;
  let countdownTimers = [];

  // ── сцена: арт-слои, pre-render-тайлы, частицы (пулы переживают заезды) ────────
  const layerCache = {};          // sky/city: {img, ok} — как artCache, живёт между open()
  let tiles = null;               // pre-render под текущий размер: {W,H,groundTop,sky,city,vignette,roadGrad}
  const START_PAD = 46;           // мировой отступ старта — голуби на решётке целиком в кадре
  const POOL_MAX = 80;
  const dust = [];                // пул частиц пыли/пёрышек (переиспользуем объекты)
  let speedLines = null;          // штрихи скорости (пересоздаются на заезд)
  let confetti = null;            // конфетти финиша (только моё 1 место)
  let shakeT0 = -1;               // встряска камеры на СТАРТ
  let lastTickTs = 0;
  let reducedMotion = false;
  try { reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { /* не критично */ }

  function loadLayer(name) {
    let rec = layerCache[name];
    if (rec) return rec;
    const img = new Image();
    rec = { img, ok: null };
    img.onload = () => { rec.ok = true; tiles = null; };   // слой доехал — пересобрать тайлы
    img.onerror = () => { rec.ok = false; };
    img.src = `/img/drag/${name}.webp?v=1`;
    layerCache[name] = rec;
    return rec;
  }

  // полётные спрайт-листы (горизонтальная полоса квадратных кадров, позы отсортированы
  // «крылья вверх → вниз» — играем пинг-понгом). Нет файла → статичный спрайт как раньше.
  const flyCache = {};
  function loadFly(breed) {
    let rec = flyCache[breed];
    if (rec) return rec;
    const img = new Image();
    rec = { img, ok: null, frames: 0 };
    img.onload = () => { rec.frames = Math.max(1, Math.round(img.width / img.height)); rec.ok = rec.frames >= 2; };
    img.onerror = () => { rec.ok = false; };
    img.src = `/img/pigeons/fly/${encodeURIComponent(breed)}.webp?v=5`;
    flyCache[breed] = rec;
    return rec;
  }

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
  // Тап-зона с переключаемым обработчиком: у v2-запуска их три (свипы/фальстарт/реакция).
  let tapHandler = null, tapReleaseHandler = null;
  function addTapZone(handler) {
    removeTapZone();
    tapZoneEl = ov && ov.querySelector('#cd-drag-race');
    tapHandler = handler;
    if (tapZoneEl) tapZoneEl.addEventListener('pointerdown', handler, { passive: true });
  }
  function addTapReleaseZone(handler) {
    tapReleaseHandler = handler;
    if (!tapZoneEl || !handler) return;
    tapZoneEl.addEventListener('pointerup', handler, { passive: true });
    tapZoneEl.addEventListener('pointercancel', handler, { passive: true });
    tapZoneEl.addEventListener('pointerleave', handler, { passive: true });
  }
  function removeTapZone() {
    if (tapZoneEl && tapHandler) tapZoneEl.removeEventListener('pointerdown', tapHandler);
    if (tapZoneEl && tapReleaseHandler) {
      tapZoneEl.removeEventListener('pointerup', tapReleaseHandler);
      tapZoneEl.removeEventListener('pointercancel', tapReleaseHandler);
      tapZoneEl.removeEventListener('pointerleave', tapReleaseHandler);
    }
    tapZoneEl = null; tapHandler = null; tapReleaseHandler = null;
  }
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
      .cd-drag-my__art{width:52px;height:52px;flex:none;border-radius:12px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 34%,rgba(141,146,156,.30),rgba(141,146,156,.04) 76%)}
      .cd-drag-my__art[data-r="rare"]{background:radial-gradient(circle at 50% 34%,rgba(184,129,63,.34),rgba(184,129,63,.05) 76%)}
      .cd-drag-my__art[data-r="epic"]{background:radial-gradient(circle at 50% 34%,rgba(144,112,194,.34),rgba(144,112,194,.05) 76%)}
      .cd-drag-my__art[data-r="legendary"]{background:radial-gradient(circle at 50% 34%,rgba(240,194,78,.36),rgba(240,194,78,.06) 76%)}
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
      .cd-drag-card__art{width:100%;aspect-ratio:1;border-radius:9px;margin:0 auto 5px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:radial-gradient(circle at 50% 34%,rgba(141,146,156,.30),rgba(141,146,156,.04) 76%)}
      .cd-drag-card[data-r="rare"] .cd-drag-card__art{background:radial-gradient(circle at 50% 34%,rgba(184,129,63,.34),rgba(184,129,63,.05) 76%)}
      .cd-drag-card[data-r="epic"] .cd-drag-card__art{background:radial-gradient(circle at 50% 34%,rgba(144,112,194,.34),rgba(144,112,194,.05) 76%)}
      .cd-drag-card[data-r="legendary"] .cd-drag-card__art{background:radial-gradient(circle at 50% 34%,rgba(240,194,78,.36),rgba(240,194,78,.06) 76%)}
      .cd-drag-card__art img{width:78%;height:78%;object-fit:contain}
      .cd-drag-card__n{font-weight:700;font-size:9.5px;color:var(--ink);line-height:1.2;min-height:2.2em;display:flex;align-items:center;justify-content:center}
      .cd-drag-card__p{font-size:10px;color:var(--gold-l);font-weight:800;margin-top:2px}
      .cd-drag-hint{font-size:11.5px;color:var(--muted);text-align:center;margin:10px 2px 0;line-height:1.5}
      .cd-drag-cta{width:100%;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:7px;border:1px solid #ffe9b3;border-radius:14px;padding:14px;font-weight:800;font-size:15px;background:linear-gradient(180deg,#ffe7a6,#eebf52 56%,#cf9a36);color:#5a2028;cursor:pointer;margin-top:16px;min-height:48px}
      .cd-drag-cta:disabled{background:rgba(255,255,255,.07);color:var(--muted);border-color:transparent;cursor:default}
      .cd-drag-race{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;padding:0 10px 10px}
      .cd-drag-canvas{display:block;border-radius:14px;background:#120d0b}
      .cd-drag-tap{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;pointer-events:none}
      .cd-drag-cd{font-family:'Nunito',sans-serif;font-weight:900;color:var(--gold-l);text-shadow:0 4px 18px rgba(0,0,0,.6);animation:cdDragPop .5s ease-out}
      .cd-drag-cd--num{font-size:64px}
      .cd-drag-cd--go{font-size:44px;color:#9be7a8}
      @keyframes cdDragPop{0%{opacity:0;transform:scale(.5)}55%{opacity:1;transform:scale(1.12)}100%{opacity:1;transform:scale(1)}}
      .cd-drag-treewrap{display:flex;align-items:center;gap:20px;animation:cdDragPop .4s ease-out}
      .cd-drag-tree{display:flex;flex-direction:column;gap:7px;background:rgba(18,10,7,.78);border:1px solid var(--line);border-radius:14px;padding:10px 9px;box-shadow:0 6px 18px rgba(0,0,0,.4)}
      .cd-drag-tree i{width:16px;height:16px;border-radius:50%;background:#3a2a24;box-shadow:inset 0 0 4px rgba(0,0,0,.55)}
      .cd-drag-tree i.r.on{background:#e5484d;box-shadow:0 0 10px rgba(229,72,77,.85)}
      .cd-drag-tree i.g.on{background:#43c465;box-shadow:0 0 12px rgba(67,196,101,.9)}
      .cd-drag-tapline{font-size:14px;font-weight:800;color:var(--cream);background:rgba(0,0,0,.42);border-radius:12px;padding:8px 16px;animation:cdDragPulse 1s ease-in-out infinite}
      @keyframes cdDragPulse{0%,100%{opacity:.7}50%{opacity:1}}
      /* ── v2 «Идеальный запуск»: шкала-тахометр прогрева/форсажа ── */
      .cd-drag-rev{display:flex;flex-direction:column;align-items:center;gap:10px;animation:cdDragPop .35s ease-out}
      .cd-drag-rev__t{font-family:'Nunito',sans-serif;font-weight:900;font-size:22px;color:var(--gold-l);text-shadow:0 3px 14px rgba(0,0,0,.65)}
      .cd-drag-revbar{position:relative;width:min(320px,82vw);height:22px;border-radius:12px;background:rgba(12,7,5,.82);border:1px solid var(--line);box-shadow:inset 0 2px 6px rgba(0,0,0,.5)}
      .cd-drag-revzone{position:absolute;top:2px;bottom:2px;border-radius:9px;background:linear-gradient(180deg,#ffe7a6,#eebf52);opacity:.92;box-shadow:0 0 12px rgba(240,194,78,.55)}
      .cd-drag-revneedle{position:absolute;top:-5px;bottom:-5px;width:4px;border-radius:2px;background:#fff;box-shadow:0 0 8px rgba(255,255,255,.8);will-change:transform}
      .cd-drag-grade{font-family:'Nunito',sans-serif;font-weight:900;font-size:26px;text-shadow:0 3px 14px rgba(0,0,0,.7);animation:cdDragPop .4s ease-out}
      .cd-drag-grade--perfect{color:#9be7a8}
      .cd-drag-grade--good{color:var(--gold-l)}
      .cd-drag-grade--miss{color:#e5847d}
      .cd-drag-false{font-size:13px;font-weight:800;color:#e5847d;background:rgba(0,0,0,.5);border-radius:10px;padding:6px 12px;animation:cdDragPop .3s ease-out}
      .cd-drag-tapfly{display:flex;flex-direction:column;align-items:center;gap:9px;animation:cdDragPop .3s ease-out}
      .cd-drag-tapbig{font-family:'Nunito',sans-serif;font-weight:900;font-size:24px;color:var(--gold-l);text-shadow:0 3px 14px rgba(0,0,0,.7)}
      .cd-drag-tapcount{font-family:'Nunito',sans-serif;font-weight:900;font-size:38px;color:var(--cream);text-shadow:0 3px 12px rgba(0,0,0,.75);line-height:1}
      .cd-drag-tapcount.pop{animation:cdDragPop .12s ease-out}
      .cd-drag-tapgauge{width:210px;max-width:70vw;height:16px;border-radius:10px;background:rgba(0,0,0,.45);overflow:hidden;box-shadow:inset 0 1px 3px rgba(0,0,0,.55)}
      .cd-drag-tapgauge__fill{height:100%;width:0;border-radius:10px;background:linear-gradient(90deg,var(--gold),#ffd76a)}
      .cd-drag-tapring{width:210px;max-width:70vw;height:5px;border-radius:4px;background:linear-gradient(90deg,#9be7a8,var(--gold-l));transition:width .1s linear}
      .cd-drag-launch{font-size:11.5px;color:var(--muted);margin-top:8px}
      .cd-drag-result{position:absolute;left:10px;right:10px;bottom:10px;background:linear-gradient(180deg,rgba(46,17,25,.96),rgba(29,10,17,.97));border:1px solid var(--line);border-radius:18px;padding:14px 18px 18px;text-align:center;box-shadow:0 -10px 30px rgba(0,0,0,.5)}
      .cd-drag-podium{display:flex;align-items:flex-end;justify-content:center;gap:12px;margin:2px 0 10px}
      .cd-drag-pod{display:flex;flex-direction:column;align-items:center;gap:3px}
      .cd-drag-pod img{width:46px;height:46px;object-fit:contain;filter:drop-shadow(0 3px 5px rgba(0,0,0,.45))}
      .cd-drag-pod.me img{filter:drop-shadow(0 0 9px rgba(240,194,78,.9))}
      .cd-drag-pod__base{width:58px;border-radius:8px 8px 4px 4px;display:flex;align-items:flex-start;justify-content:center;font-weight:900;font-size:14px;color:#3a2413;padding-top:3px}
      .cd-drag-pod--1 .cd-drag-pod__base{height:50px;background:linear-gradient(180deg,#ffe7a6,#eebf52)}
      .cd-drag-pod--2 .cd-drag-pod__base{height:36px;background:linear-gradient(180deg,#d9dade,#a7abb5)}
      .cd-drag-pod--3 .cd-drag-pod__base{height:28px;background:linear-gradient(180deg,#d9a26a,#b8813f)}
      .cd-drag-pod__n{font-size:9px;color:var(--muted);max-width:62px;line-height:1.15;text-align:center}
      .cd-drag-place{font-family:'Nunito',sans-serif;font-weight:900;font-size:26px;color:var(--gold-l)}
      .cd-drag-reward{font-size:16px;font-weight:800;margin-top:6px;color:var(--muted)}
      .cd-drag-reward.pos{color:#9be7a8}
      .cd-drag-reward.neg{color:#e5847d}
      .cd-drag-error{font-size:14px;font-weight:800;color:#e5847d;line-height:1.35;margin:6px 0 2px}
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
      <div class="cd-drag-card__p">🏁 ${Math.round(num(power))}</div>
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
        ? `<div class="cd-drag-oppgrid">${opponentsPreview.map((o) => cardHtml(o.breed, o.cruise ?? o.power, !!o.bot)).join('')}</div>`
        : `<div class="cd-drag-hint">Соперников подберём прямо на старте.</div>`);
    const modeHtml = friendRace
      ? `<div class="cd-drag-hint">Гонка с другом: <b>${esc(friendRace.name || 'Друг')}</b> · без ставки</div>`
      : `<div class="cd-drag-sect">Режим</div>
        <div class="cd-drag-seg">
          <button class="cd-drag-seg__b${mode === 'training' ? ' on' : ''}" data-mode="training">Тренировка</button>
          <button class="cd-drag-seg__b${mode === 'bet' ? ' on' : ''}" data-mode="bet">💰 Ставка</button>
        </div>`;
    const stakesHtml = !friendRace && mode === 'bet'
      ? `<div class="cd-drag-stakes">${STAKE_PRESETS.map((v) => `<button class="cd-drag-stake${v === stake ? ' on' : ''}" data-stake="${v}" ${balance !== null && v > balance ? 'disabled' : ''}>${fmt(v)}</button>`).join('')}</div>`
      : '';
    const canStart = opponentsPreview !== null && !lowEnergy;
    return `<div class="cd-drag-hd"><div class="cd-drag-t">🏁 Драг-заезд</div><button class="cd-drag-x" id="cd-drag-x">×</button></div>
      <div class="cd-drag-body">
        <div class="cd-drag-my">
          <div class="cd-drag-my__art" data-r="${esc(m.rarity)}">${artTag(curBreed)}</div>
          <div class="cd-drag-my__b"><div class="cd-drag-my__n">${esc(m.name)}</div><div class="cd-drag-my__p">${myPower !== null ? `Гоночный темп: 🏁 ${Math.round(myPower)}` : 'Твой боец на старте'}</div></div>
        </div>
        ${modeHtml}
        ${stakesHtml}
        <div class="cd-drag-sect">Соперники</div>
        ${oppHtml}
        <div class="cd-drag-sect">Как победить</div>
        <div class="cd-drag-hint" style="text-align:left">Перед стартом будет короткий разгон — <b>тапай как можно больше</b>. Чем больше разгон, тем быстрее голубь летит на трассе. Что решает исход:<br>• <b>Скорость</b> — базовый темп голубя<br>• <b>Выносливость</b> — тапы считаются сильнее, до максимума нужно меньше тапать<br>• <b>Удача</b> — меньше случайности, результат стабильнее<br>Качай эти статы в <b>Тюнинге</b> (⚙ в карточке породы), а звёзды (корм дублями) и редкость поднимают базу.</div>
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
    ov.querySelectorAll('[data-mode]').forEach((el) => { el.onclick = () => { const nextMode = el.dataset.mode === 'bet' ? 'bet' : 'training'; if (nextMode === mode) return; mode = nextMode; opponentsPreview = null; renderSetup(); loadOpponents(session); }; });
    ov.querySelectorAll('[data-stake]').forEach((el) => { el.onclick = () => { stake = num(el.dataset.stake); renderSetup(); }; });
    const startBtn = ov.querySelector('#cd-drag-start'); if (startBtn) startBtn.onclick = onStart;
  }

  async function loadOpponents(mySession) {
    const oppUrl = friendRace ? '/api/pigeons/drag/friend-opponents' : '/api/pigeons/drag/opponents';
    const oppBody = friendRace ? { breed: curBreed, friendChat: friendRace.chat } : { breed: curBreed, mode };
    const d = await apiRef(oppUrl, { method: 'POST', body: JSON.stringify(oppBody) }).catch(() => null);
    if (mySession !== session || !ov) return; // оверлей закрыт/переоткрыт — не трогаем DOM
    opponentsPreview = (d && Array.isArray(d.opponents)) ? d.opponents : [];
    myPower = (d && typeof d.myPower === 'number') ? d.myPower : myPower;
    opponentsPreview.forEach((o) => loadFly(o.breed)); // прогреваем полётные листы к старту
    if (step === 'setup') renderSetup();
  }

  // ── старт: экран заезда (canvas) + отсчёт 3-2-1-GO ──────────────────────────────
  async function onStart() {
    if (raceBusy || step !== 'setup') return; // busy-guard: пока идёт заезд/сеттап переоткрыт — повторный клик игнорируем
    if (mode === 'bet' && STAKE_PRESETS.indexOf(stake) === -1) { flash('Выбери ставку'); return; }
    haptic('medium');
    renderRaceScreen();
    startLaunch();
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
    // свежий заезд — сброс эффектов (пулы переиспользуем, но частицы гасим)
    for (let i = 0; i < dust.length; i++) dust[i].on = false;
    speedLines = null; confetti = null; shakeT0 = -1; lastTickTs = 0;
    stopLoop();
    raf = requestAnimationFrame(tick);
  }

  function setupCanvasSize() {
    if (!canvas || !ctx) return;
    const wrap = canvas.parentElement; // .cd-drag-race, padding 0 10px 10px
    cssW = Math.max(280, ((wrap && wrap.clientWidth) || 340) - 20);
    cssH = Math.max(300, ((wrap && wrap.clientHeight) || 430) - 10);
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    tiles = null; // размер сменился — pre-render-тайлы пересобрать
  }

  function previewRacers() {
    const mine = { breed: curBreed, me: true };
    const opps = (opponentsPreview || []).map((o) => ({ breed: o.breed, me: false }));
    return [mine, ...opps];
  }

  // ── сайд-скролл-сцена: закатные арт-слои + камера за лидером + бегущие голуби ──
  // Мир длиннее экрана (worldLen); worldX(frac)=START_PAD+frac*(worldL-START_PAD), финиш на
  // worldL. Камера держит лидера у ~40% ширины и в конце останавливается так, чтобы арка
  // финиша стояла на ~72% ширины — все голуби в кадре. Слои sky(×0.2)/city(×0.5) — webp,
  // pre-render в зеркальный тайл (бесшовный цикл); при отсутствии файла — процедурный
  // fallback того же слоя. На кадр — только drawImage/заливки → держит 60fps.
  function worldLen() { return Math.max(cssW * 2.2, cssW + 240); }
  function worldX(frac, worldL) { return START_PAD + frac * (worldL - START_PAD); }

  function buildTiles() {
    const W = cssW, H = cssH;
    const groundTop = Math.round(H * 0.40);
    tiles = { W, H, groundTop };
    const sky = loadLayer('sky'), city = loadLayer('city');
    if (sky.ok) {
      const h = groundTop + 12;
      const w = Math.max(1, Math.round(sky.img.width * (h / sky.img.height)));
      const c = document.createElement('canvas'); c.width = w * 2; c.height = h;
      const g = c.getContext('2d');
      g.drawImage(sky.img, 0, 0, w, h);
      g.save(); g.translate(w * 2, 0); g.scale(-1, 1); g.drawImage(sky.img, 0, 0, w, h); g.restore();
      tiles.sky = c;
    }
    if (city.ok) {
      // город НЕ зеркалим (вывеска «МАРИЯ» читаемая) — тайлим внахлёст: тёмные силуэты
      // на перекрытии сливаются в union, шва не видно
      const h = Math.min(Math.round(groundTop * 0.85), Math.round(H * 0.36));
      const w = Math.max(1, Math.round(city.img.width * (h / city.img.height)));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(city.img, 0, 0, w, h);
      tiles.city = c;
      tiles.cityStep = Math.max(1, w - 28);
    }
    // асфальт: тёплый градиент глубины (дальняя кромка темнее)
    const rg = ctx.createLinearGradient(0, groundTop, 0, H);
    rg.addColorStop(0, '#1d1210'); rg.addColorStop(0.25, '#241711'); rg.addColorStop(1, '#2d1e15');
    tiles.roadGrad = rg;
    // виньетка — один pre-render на кадр целиком
    const v = document.createElement('canvas'); v.width = Math.max(1, W); v.height = Math.max(1, H);
    const vg = v.getContext('2d');
    const grad = vg.createRadialGradient(W / 2, H * 0.46, Math.min(W, H) * 0.44, W / 2, H * 0.5, Math.max(W, H) * 0.8);
    grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(10,5,3,.42)');
    vg.fillStyle = grad; vg.fillRect(0, 0, W, H);
    tiles.vignette = v;
  }

  function drawTile(cnv, scroll, y, step) {
    const tw = step || cnv.width;
    const off = ((scroll % tw) + tw) % tw;
    for (let x = -off; x < cssW; x += tw) ctx.drawImage(cnv, Math.round(x), y);
  }
  function drawSkyFallback(scroll, groundTop) {
    if (!tiles.skyGrad) {
      const g = ctx.createLinearGradient(0, 0, 0, groundTop + 10);
      g.addColorStop(0, '#8a5a52'); g.addColorStop(0.45, '#c98a54'); g.addColorStop(1, '#f2bf6e');
      tiles.skyGrad = g;
    }
    ctx.fillStyle = tiles.skyGrad; ctx.fillRect(0, 0, cssW, groundTop + 2);
    const spacing = 230;
    ctx.fillStyle = 'rgba(255,232,190,.30)';
    for (let k = Math.floor(scroll / spacing) - 1; k * spacing - scroll < cssW + spacing; k++) {
      const x = k * spacing - scroll + 40, y = 22 + (((k % 3) + 3) % 3) * 16;
      ctx.beginPath();
      ctx.ellipse(x, y, 30, 15, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 24, y + 5, 22, 11, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  function drawCityFallback(scroll, groundTop) {
    const spacing = 88;
    for (let k = Math.floor(scroll / spacing) - 1; k * spacing - scroll < cssW + spacing; k++) {
      const x = k * spacing - scroll, hh = 30 + (((k * 37) % 40) + 40) % 40;
      ctx.fillStyle = 'rgba(44,26,18,.88)';
      ctx.fillRect(x, groundTop - hh, 62, hh);
      ctx.fillStyle = 'rgba(255,215,122,.5)';
      const wn = (((k % 3) + 3) % 3) + 1;
      for (let w = 0; w < wn; w++) ctx.fillRect(x + 8 + w * 16, groundTop - hh + 8, 5, 7);
    }
  }

  function drawScene(list, fracs, ts) {
    if (!ctx || !cssW || !cssH) return;
    if (!tiles || tiles.W !== cssW || tiles.H !== cssH) buildTiles();
    const W = cssW, H = cssH, worldL = worldLen();
    const leaderFrac = fracs.length ? Math.max.apply(null, fracs) : 0;
    const camEnd = Math.max(0, worldL - W * 0.72);
    const camX = Math.max(0, Math.min(camEnd, worldX(leaderFrac, worldL) - W * 0.4));
    const groundTop = tiles.groundTop;

    ctx.save();
    if (shakeT0 > 0 && !reducedMotion) {
      const st = ts - shakeT0;
      if (st >= 0 && st < 250) {
        const k = 3 * (1 - st / 250);
        ctx.translate(Math.sin(ts * 0.09) * k, Math.cos(ts * 0.117) * k);
      }
    }

    if (tiles.sky) drawTile(tiles.sky, camX * 0.2, 0); else drawSkyFallback(camX * 0.2, groundTop);
    if (tiles.city) drawTile(tiles.city, camX * 0.5, groundTop - tiles.city.height, tiles.cityStep); else drawCityFallback(camX * 0.5, groundTop);

    // асфальт + золотая кромка горизонта
    ctx.fillStyle = tiles.roadGrad; ctx.fillRect(0, groundTop, W, H - groundTop);
    ctx.fillStyle = 'rgba(240,194,78,.18)'; ctx.fillRect(0, groundTop, W, 2);

    const n = list.length || 1;
    const laneArea = H - groundTop - 6, laneH = laneArea / n;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,235,205,.03)' : 'rgba(0,0,0,.10)';
      ctx.fillRect(0, groundTop + i * laneH, W, laneH);
    }
    drawLaneDashes(camX, groundTop, laneArea, n, W);

    // стартовая решётка (видна пока камера у старта)
    const startX = START_PAD - camX - 26;
    if (startX > -10 && startX < W) {
      ctx.fillStyle = 'rgba(244,237,226,.5)'; ctx.fillRect(startX, groundTop, 3, laneArea);
      ctx.fillStyle = 'rgba(244,237,226,.22)'; ctx.fillRect(startX + 6, groundTop, 3, laneArea);
    }

    const finishX = worldL - camX;
    if (finishX <= W + 60) drawFinishArch(finishX, groundTop, laneArea);

    if (phase === 'animating' && !reducedMotion) drawSpeedLines(ts);

    // позиции голубей: сначала пыль (за спрайтами), потом сами спрайты
    const pos = [];
    list.forEach((r, i) => {
      const size = Math.min(laneH * 0.85, 64);
      const y = groundTop + i * laneH + laneH * 0.56;
      const frac = fracs[i];
      let x = worldX(frac, worldL) - camX;
      if (frac >= 1) x = finishX + 24 + size * 0.34 + (i % 2) * 9; // финишировали — стоим ЗА чекер-лентой, в кадре
      const running = phase === 'animating' && frac < 1;
      const ft = raceData && raceData.racers && raceData.racers[i] ? num(raceData.racers[i].finishT) : 0;
      pos.push({ r, i, x, y, size, frac, running, sp: ft > 0 ? Math.min(1, 2.2 / ft) : 0 });
      if (running && !reducedMotion && Math.random() < 0.85) {
        spawnDust(x - size * 0.42, y + size * 0.3, !!r.me);
        if (r.me && Math.random() < 0.35) spawnDust(x - size * 0.5, y + size * 0.18, true);
      }
    });
    stepDust(ts);
    drawDust();
    pos.forEach((p) => {
      drawPigeon(p.r.breed, p.x, p.y, p.size, !!p.r.me, ts, p.running, p.sp, p.i);
      const place = raceData && raceData.racers && raceData.racers[p.i] ? num(raceData.racers[p.i].place) : 0;
      if (p.frac >= 1 && place) drawPlaceBadge(p.x, p.y - p.size * 0.78, place, !!p.r.me);
    });

    if (confetti) { stepConfetti(ts); drawConfetti(); }
    ctx.restore();

    ctx.drawImage(tiles.vignette, 0, 0);
    if (phase === 'animating' || phase === 'done') drawProgressBar(list, fracs);
    lastTickTs = ts;
  }

  function drawLaneDashes(scroll, top, area, n, W) {
    const laneH = area / n, spacing = 46, dashW = 20, off = ((scroll % spacing) + spacing) % spacing;
    ctx.fillStyle = 'rgba(240,194,78,.20)';
    for (let i = 1; i < n; i++) {
      const y = top + i * laneH - 1;
      for (let x = -off; x < W; x += spacing) ctx.fillRect(x, y, dashW, 2);
    }
  }
  function drawFinishArch(x, top, area) {
    // чекер-лента поперёк дорожек + табличка «ФИНИШ» на стойке
    const sq = 8;
    for (let yy = top; yy < top + area; yy += sq) {
      const row = Math.floor((yy - top) / sq);
      for (let c = 0; c < 2; c++) {
        ctx.fillStyle = ((row + c) % 2 === 0) ? 'rgba(244,237,226,.92)' : 'rgba(26,18,14,.92)';
        ctx.fillRect(x + c * sq, yy, sq, Math.min(sq, top + area - yy));
      }
    }
    ctx.fillStyle = '#3a2413'; ctx.fillRect(x + 6, top - 30, 4, 30);
    ctx.fillStyle = '#e5484d';
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x - 22, top - 44, 60, 18, 5); ctx.fill(); }
    else ctx.fillRect(x - 22, top - 44, 60, 18);
    ctx.fillStyle = '#fff'; ctx.font = '800 9px Nunito, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('ФИНИШ', x + 8, top - 31.5);
  }

  function drawPigeon(breed, x, y, size, isMe, ts, running, speedNorm, laneIdx) {
    // тень на земле (без боба)
    ctx.fillStyle = 'rgba(0,0,0,.32)';
    ctx.beginPath(); ctx.ellipse(x, y + size * 0.44, size * 0.36, size * 0.11, 0, 0, Math.PI * 2); ctx.fill();
    const wing = ts / 85 + laneIdx * 1.7;
    const bob = running ? Math.sin(wing) * size * 0.08 : 0;
    const fly = running ? loadFly(breed) : null;
    if (fly && fly.ok) {
      // Покадровый взмах: пинг-понг по позам, темп чуть быстрее у быстрых. Кадр 0 у части
      // полётных листов — поза ПОКОЯ (крылья сложены, напр. zolotoy): прогон через неё в
      // пинг-понге давал «качание вперёд-назад» у такого голубя. Анимируем только лётные
      // кадры 1..n-1 (кадр 0 пропускаем — где он лётный, теряем лишь один кадр взмаха).
      const n = fly.frames;
      const usable = Math.max(1, n - 1);
      const period = usable > 1 ? 2 * usable - 2 : 1;
      const stepMs = 52 - 14 * (speedNorm || 0);
      const k = Math.floor(ts / stepMs + laneIdx * 2.3) % period;
      const frame = 1 + (k < usable ? k : period - k);
      const cell = fly.img.height;
      const drawSize = size * 1.18; // в полётных кадрах тело меньше ячейки (размах крыльев)
      const tilt = 0.04 + 0.06 * (speedNorm || 0);
      ctx.save();
      ctx.translate(x, y + bob);
      ctx.rotate(tilt);         // полётный арт уже смотрит вправо — без флипа
      if (isMe) { ctx.shadowColor = 'rgba(240,194,78,.85)'; ctx.shadowBlur = 12; }
      ctx.drawImage(fly.img, frame * cell, 0, cell, cell, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
      ctx.restore();
    } else {
      const squash = running ? 1 + 0.05 * Math.sin(wing + Math.PI / 2) : 1;
      const tilt = running ? (0.06 + 0.1 * (speedNorm || 0)) : 0;
      const rec = loadArt(breed);
      ctx.save();
      ctx.translate(x, y + bob);
      ctx.scale(-1, 1);         // статичный арт смотрит влево — разворачиваем по ходу движения
      ctx.rotate(-tilt);        // в зеркальных координатах нос «вниз-вперёд»
      ctx.scale(1, squash);
      if (isMe) { ctx.shadowColor = 'rgba(240,194,78,.85)'; ctx.shadowBlur = 12; }
      if (rec.ok) {
        ctx.drawImage(rec.img, -size / 2, -size / 2, size, size);
      } else {
        ctx.fillStyle = isMe ? '#f0c24e' : '#5b6472';
        ctx.beginPath(); ctx.arc(0, 0, size / 2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    if (isMe) {
      ctx.fillStyle = '#ffe39c'; ctx.font = '700 10px Nunito, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('ты', x, y + bob - size / 2 - 5);
    }
  }
  function drawPlaceBadge(x, y, place, isMe) {
    ctx.save();
    ctx.fillStyle = isMe ? '#f0c24e' : 'rgba(244,237,226,.94)';
    ctx.strokeStyle = 'rgba(26,18,14,.6)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3a2413'; ctx.font = '900 11px Nunito, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(place), x, y + 0.5);
    ctx.restore();
    ctx.textBaseline = 'alphabetic';
  }
  function drawProgressBar(list, fracs) {
    const y = 13, x0 = 16, x1 = cssW - 26;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    // чекер-флажок финиша
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#f4ede2' : '#1a120e';
      ctx.fillRect(x1 + 6 + c * 4, y - 6 + r * 4, 4, 4);
    }
    let meDot = null;
    list.forEach((r, i) => {
      const dx = x0 + Math.min(1, fracs[i]) * (x1 - x0);
      if (r.me) { meDot = dx; return; }
      ctx.fillStyle = 'rgba(216,206,194,.85)';
      ctx.beginPath(); ctx.arc(dx, y, 3.2, 0, Math.PI * 2); ctx.fill();
    });
    if (meDot !== null) {
      ctx.fillStyle = '#f0c24e'; ctx.strokeStyle = 'rgba(58,36,19,.8)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(meDot, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  // ── частицы: пыль/пёрышки (пул), спидлайны, конфетти ───────────────────────────
  function spawnDust(x, y, gold) {
    let p = null;
    for (let i = 0; i < dust.length; i++) if (!dust[i].on) { p = dust[i]; break; }
    if (!p) {
      if (dust.length >= POOL_MAX) return;
      p = {}; dust.push(p);
    }
    p.on = true; p.x = x; p.y = y;
    p.vx = -(50 + Math.random() * 90); p.vy = -(6 + Math.random() * 26);
    p.t0 = 0; p.life = 380 + Math.random() * 320; p.k = 1;
    p.r = 1.4 + Math.random() * 2.4; p.gold = !!gold;
  }
  function stepDust(ts) {
    const dt = lastTickTs ? Math.min(50, ts - lastTickTs) : 16;
    for (let i = 0; i < dust.length; i++) {
      const p = dust[i];
      if (!p.on) continue;
      if (!p.t0) p.t0 = ts;
      const age = ts - p.t0;
      if (age > p.life) { p.on = false; continue; }
      p.k = 1 - age / p.life;
      p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000;
    }
  }
  function drawDust() {
    for (let i = 0; i < dust.length; i++) {
      const p = dust[i];
      if (!p.on) continue;
      ctx.globalAlpha = 0.5 * p.k;
      ctx.fillStyle = p.gold ? '#f0c24e' : '#d6ba96';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function drawSpeedLines(ts) {
    if (!speedLines) {
      speedLines = [];
      for (let i = 0; i < 10; i++) speedLines.push({ x: Math.random() * cssW, y: Math.random() * cssH, len: 40 + Math.random() * 50, sp: 520 + Math.random() * 420 });
    }
    const dt = lastTickTs ? Math.min(50, ts - lastTickTs) : 16;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,236,200,.10)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (let i = 0; i < speedLines.length; i++) {
      const l = speedLines[i];
      l.x -= l.sp * dt / 1000;
      if (l.x + l.len < 0) { l.x = cssW + Math.random() * 80; l.y = Math.random() * cssH; }
      ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(l.x + l.len, l.y); ctx.stroke();
    }
    ctx.restore();
  }
  function startConfetti() {
    if (reducedMotion) return;
    confetti = [];
    const colors = ['#f0c24e', '#ffe39c', '#eee7dd', '#c96f7f'];
    for (let i = 0; i < 54; i++) {
      confetti.push({
        x: Math.random() * cssW, y: -12 - Math.random() * cssH * 0.4,
        vx: -30 + Math.random() * 60, vy: 90 + Math.random() * 130,
        w: 3 + Math.random() * 3.5, rot: Math.random() * Math.PI, vr: -3 + Math.random() * 6,
        c: colors[i % colors.length],
      });
    }
  }
  function stepConfetti(ts) {
    const dt = lastTickTs ? Math.min(50, ts - lastTickTs) : 16;
    let alive = 0;
    for (let i = 0; i < confetti.length; i++) {
      const p = confetti[i];
      p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000; p.rot += p.vr * dt / 1000;
      p.vy += 60 * dt / 1000;
      if (p.y < cssH + 14) alive++;
    }
    if (!alive) confetti = null;
  }
  function drawConfetti() {
    if (!confetti) return;
    for (let i = 0; i < confetti.length; i++) {
      const p = confetti[i];
      if (p.y >= cssH + 14) continue;
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.w / 3, p.w, p.w / 1.5);
      ctx.restore();
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
        // Показ прогресса со степенью 1.6: моменты финиша не меняются (t=ft → 1),
        // но в середине заезда поле визуально кучнее — развязка смещается к концу
        // (фидбек «не напряжённая»).
        const frac = ft > 0 ? Math.min(1, Math.pow(scaledElapsed / ft, 1.6)) : 1;
        if (frac < 1) allDone = false;
        return frac;
      });
      drawScene(raceData.racers, positions, ts);
      if (!allDone) { raf = requestAnimationFrame(tick); return; }
      phase = 'done';
      if (num(raceData.myPlace) === 1) startConfetti();
      setTimeout(() => { if (ov && step === 'race') renderResult(); }, 650);
      raf = requestAnimationFrame(tick);
      return;
    }
    if (phase === 'done' && raceData) {
      // финальный кадр: все у арки; пока живут конфетти/пыль — дорисовываем
      drawScene(raceData.racers, raceData.racers.map(() => 1), ts);
      raf = confetti || dust.some((p) => p.on) ? requestAnimationFrame(tick) : 0;
      return;
    }
    // countdown/idle/go — стартовая решётка (моя птица + превью соперников), мир статичен
    const list = previewRacers();
    drawScene(list, list.map(() => 0), ts);
    raf = requestAnimationFrame(tick);
  }

  // ── v2 «Идеальный запуск»: прогрев → форсаж → ёлка-реакция ──────────────────────
  // (спека 2026-07-30-drag-launch-mechanic-v2). Три честно измеренных инпута; исход
  // по-прежнему решает только сервер (POST /race c body.skill).
  const REV_HALF_MS = 300;          // зеркало src/drag.ts::REV_HALF — для оценок «Идеально/Хорошо»
  // v2.1 (фидбек юзера 30.07): свип ОДИН («Форсаж» убран — «после этого опять тапать»),
  // стрелка медленнее (700→1100мс на полсвипа — «стрелка слишком быстрая»).
  const REV_STAGES = [
    { key: 'rev1', title: 'Прогрев', half: 1100 }, // полсвипа стрелки, мс
  ];
  const ZONE_CENTER = 0.65, ZONE_HALF = 0.15; // золотая зона у «красной черты» тахометра
  let launchInput = null, revRaf = 0, revStage = 0, revT0 = 0, revDone = false, falseFlashTs = 0;
  // v3 «Тап-заезд» (спека 2026-08-04): состояние предстарта. count/reaction меряет клиент,
  // исход считает сервер (POST /race c body.tap). durationMs зеркалит TAP_WINDOW src/drag.ts.
  const TAP_WINDOW_MS_C = 5000;   // = src/drag.ts::TAP_WINDOW_MS
  const TAP_GAUGE_FULL = 40;      // тапов до полного гейджа (косметика; реальную цель со стаминой считает сервер)
  const MAX_DRAG_TAP_POINTERS = 3;
  const dragTapPointers = new Set();
  let tapCount = 0, tapFirstMs = -1, tapWinT0 = 0, tapRaf = 0;

  function stopRevLoop() { if (revRaf) { cancelAnimationFrame(revRaf); revRaf = 0; } }
  function stopTapLoop() { if (tapRaf) { cancelAnimationFrame(tapRaf); tapRaf = 0; } }
  function clearDragTapPointers() { dragTapPointers.clear(); }
  function releaseFlyTapPointer(e) { if (e && e.pointerId != null) dragTapPointers.delete(e.pointerId); }
  function setTapHtml(html) { const el = ov && ov.querySelector('#cd-drag-tap'); if (el) el.innerHTML = html; }

  function startLaunch() {
    clearTimers();
    // дефолты = худший результат этапа; каждый тап перезаписывает свой
    launchInput = { rev1: REV_HALF_MS * 2, reactionMs: 3000 };
    revStage = 0;
    // Недельная заявка (qualify) — прежний «Идеальный запуск» (крутилка → реакция), её
    // launchSkill не трогаем. Драг (training/bet) — сначала предстартерный разгон тапами.
    if (mode === 'qualify') { runRevStage(); return; }
    t0 = performance.now();
    phase = 'prestart';
    startTapWindow();
  }
  function revFrac(now) {
    const k = ((now - revT0) / REV_STAGES[revStage].half) % 2;
    return k < 1 ? k : 2 - k; // пинг-понг 0→1→0
  }
  function runRevStage() {
    const stage = REV_STAGES[revStage];
    const zoneLeft = (ZONE_CENTER - ZONE_HALF) * 100, zoneW = ZONE_HALF * 2 * 100;
    setTapHtml(`<div class="cd-drag-rev">
      <div class="cd-drag-rev__t">${stage.title}</div>
      <div class="cd-drag-revbar"><div class="cd-drag-revzone" style="left:${zoneLeft}%;width:${zoneW}%"></div><div class="cd-drag-revneedle" id="cd-drag-needle"></div></div>
      <div class="cd-drag-tapline">Тапни в золотой зоне!</div>
    </div>`);
    const needle = ov && ov.querySelector('#cd-drag-needle');
    const bar = ov && ov.querySelector('.cd-drag-revbar');
    revDone = false;
    revT0 = performance.now();
    phase = 'rev';
    const loop = () => {
      if (!ov || revDone || phase !== 'rev') { revRaf = 0; return; }
      if (needle && bar) needle.style.transform = `translateX(${(revFrac(performance.now()) * (bar.clientWidth - 4)).toFixed(1)}px)`;
      revRaf = requestAnimationFrame(loop);
    };
    revRaf = requestAnimationFrame(loop);
    addTapZone(onRevTap);
    // не тапнул за ~3 пинг-понга → худший результат этапа, едем дальше (не виснем)
    countdownTimers.push(setTimeout(() => { if (!revDone && phase === 'rev') finishRevStage(REV_HALF_MS * 2); }, stage.half * 6 + 400));
  }
  function onRevTap() {
    if (phase !== 'rev' || revDone) return;
    finishRevStage(Math.round((revFrac(performance.now()) - ZONE_CENTER) * REV_STAGES[revStage].half));
  }
  function finishRevStage(offsetMs) {
    revDone = true;
    stopRevLoop();
    removeTapZone();
    launchInput[REV_STAGES[revStage].key] = offsetMs;
    const acc = Math.max(0, 1 - Math.abs(offsetMs) / REV_HALF_MS);
    const grade = acc >= 0.9 ? ['perfect', 'Идеально!'] : acc >= 0.6 ? ['good', 'Хорошо!'] : acc > 0 ? ['miss', offsetMs < 0 ? 'Рано!' : 'Поздно!'] : ['miss', 'Мимо!'];
    haptic(acc >= 0.6 ? 'medium' : 'light');
    setTapHtml(`<div class="cd-drag-grade cd-drag-grade--${grade[0]}">${grade[1]}</div>`);
    revStage++;
    countdownTimers.push(setTimeout(() => {
      if (!ov || step !== 'race') return;
      if (revStage < REV_STAGES.length) runRevStage(); else runCountdown();
    }, 620));
  }

  // ── ёлка 3-2-1-зелёный → реакция (фальстарт больше НЕ молчит) ──────────────────
  function treeHtml(reds, go) {
    let h = '<div class="cd-drag-tree">';
    for (let i = 0; i < 3; i++) h += `<i class="r${i < reds ? ' on' : ''}"></i>`;
    h += `<i class="g${go ? ' on' : ''}"></i></div>`;
    return h;
  }
  function onFalseStart() {
    // тап до зелёного: раньше молча игнорировался → игрок думал, что уже нажал,
    // и получал авто-3000мс (та самая жалоба «прокачанный, а все обогнали»)
    const now = performance.now();
    if (now - falseFlashTs < 450) return;
    falseFlashTs = now;
    haptic('light');
    const box = ov && ov.querySelector('#cd-drag-tap .cd-drag-falsebox');
    if (box) { box.innerHTML = '<div class="cd-drag-false">Рано! Жди зелёный свет</div>'; setTimeout(() => { if (box.parentNode) box.innerHTML = ''; }, 700); }
  }
  function runCountdown() {
    phase = 'countdown';
    const stepHtml = (reds, num) => `<div class="cd-drag-treewrap">${treeHtml(reds, false)}<div class="cd-drag-cd cd-drag-cd--num">${num}</div></div><div class="cd-drag-falsebox"></div>`;
    setTapHtml(stepHtml(1, 3));
    addTapZone(onFalseStart);
    countdownTimers.push(setTimeout(() => setTapHtml(stepHtml(2, 2)), 650));
    countdownTimers.push(setTimeout(() => setTapHtml(stepHtml(3, 1)), 1300));
    countdownTimers.push(setTimeout(() => {
      setTapHtml(`<div class="cd-drag-treewrap">${treeHtml(3, true)}<div class="cd-drag-cd cd-drag-cd--go">СТАРТ!</div></div><div class="cd-drag-tapline">Тапни как можно быстрее!</div>`);
      armTap();
    }, 1950));
  }
  function armTap() {
    shakeT0 = performance.now(); // встряска камеры на СТАРТ (в reduced-motion не рисуется)
    t0 = performance.now();
    phase = 'go';
    tapCaptured = false;
    addTapZone(onTap);
    // Защита от зависания (игрок не тапнул) — сервер всё равно клампит reactionMs до 3000мс,
    // так что авто-тап на таймауте не даёт нечестного преимущества/проигрыша сверх этого.
    countdownTimers.push(setTimeout(() => onTap(), 3000));
  }
  // qualify: одиночная реакция → заявка недели
  function onTap() {
    if (tapCaptured || phase !== 'go') return; // busy-guard: второй тап/повторный таймер игнорируется
    tapCaptured = true;
    launchInput.reactionMs = Math.round(performance.now() - t0);
    removeTapZone();
    setTapHtml('<div class="cd-drag-tapline">Финиш считает сервер…</div>');
    phase = 'submitting';
    submitRace();
  }

  // ── v3 предстартовый разгон: чем больше тапов, тем выше скорость на трассе ──────
  function startTapWindow() {
    tapCount = 0; tapFirstMs = -1;
    tapWinT0 = performance.now();
    setTapHtml(`<div class="cd-drag-tapfly">
      <div class="cd-drag-tapbig">РАЗГОН! Тапай!</div>
      <div class="cd-drag-tapcount" id="cd-tapcount">0</div>
      <div class="cd-drag-tapgauge"><div class="cd-drag-tapgauge__fill" id="cd-tapfill"></div></div>
      <div class="cd-drag-tapring" id="cd-tapring"></div>
    </div>`);
    addTapZone(onFlyTap);
    addTapReleaseZone(releaseFlyTapPointer);
    const loop = () => {
      if (!ov || (phase !== 'prestart' && phase !== 'go')) { tapRaf = 0; return; }
      const left = Math.max(0, TAP_WINDOW_MS_C - (performance.now() - tapWinT0));
      const ring = ov.querySelector('#cd-tapring');
      if (ring) ring.style.width = ((left / TAP_WINDOW_MS_C) * 100).toFixed(1) + '%';
      tapRaf = requestAnimationFrame(loop);
    };
    tapRaf = requestAnimationFrame(loop);
    countdownTimers.push(setTimeout(closeTapWindow, TAP_WINDOW_MS_C));
  }
  function onFlyTap(e) {
    if (phase !== 'prestart' && phase !== 'go') return;
    if (e && e.pointerId != null) {
      if (!dragTapPointers.has(e.pointerId) && dragTapPointers.size >= MAX_DRAG_TAP_POINTERS) return;
      dragTapPointers.add(e.pointerId);
    }
    if (tapFirstMs < 0) tapFirstMs = Math.round(performance.now() - t0); // первый тап разгона
    tapCount++;
    haptic('light');
    const cnt = ov && ov.querySelector('#cd-tapcount');
    if (cnt) { cnt.textContent = tapCount; cnt.classList.remove('pop'); void cnt.offsetWidth; cnt.classList.add('pop'); }
    const fill = ov && ov.querySelector('#cd-tapfill');
    if (fill) fill.style.width = Math.min(100, (tapCount / TAP_GAUGE_FULL) * 100).toFixed(0) + '%';
  }
  function closeTapWindow() {
    if (phase !== 'prestart' && phase !== 'go') return; // guard: уже закрыто/оверлей сменился
    phase = 'submitting';
    stopTapLoop();
    clearDragTapPointers();
    removeTapZone();
    setTapHtml('<div class="cd-drag-tapline">Финиш считает сервер…</div>');
    submitRace();
  }

  // ── Отборочный полёт недельной гонки: очки решает сервер, анимация — против
  // РЕАЛЬНЫХ заявок дивизиона этой недели (standings из ответа /race/enter). ──
  const DIV_NAME = { gold: 'Золото', silver: 'Серебро', bronze: 'Бронза' };
  function buildQualifyRace(d) {
    const others = (Array.isArray(d.standings) ? d.standings : []).filter((s) => !s.me).slice(0, 3);
    const field = [{ breed: curBreed, score: num(d.score), me: true }, ...others.map((s) => ({ breed: s.breed, score: num(s.score), me: false }))];
    const maxScore = field.reduce((m, f) => Math.max(m, f.score), 0);
    // очки → время: лидер ~2.1с, каждый недостающий балл +15мс (кап разрыва 1.4с)
    const racers = field.map((f) => ({
      breed: f.breed, me: f.me, bot: false,
      finishT: 2.1 + Math.min(1.4, (maxScore - f.score) * 0.015),
    }));
    const ranked = racers.slice().sort((a, b) => a.finishT - b.finishT);
    racers.forEach((r) => { r.place = ranked.indexOf(r) + 1; });
    return { racers, myPlace: racers.find((r) => r.me).place };
  }
  async function submitQualify(mySession) {
    const d = await apiRef('/api/pigeons/race/enter', { method: 'POST', body: JSON.stringify({ breed: curBreed, skill: launchInput }) }).catch(() => null);
    if (mySession !== session || !ov) return;
    raceBusy = false;
    if (!d || !d.ok) {
      flash(d && d.error === 'already' ? 'Ты уже заявлял голубя на этой неделе' : d && d.error === 'disabled' ? 'Гонка сейчас недоступна' : 'Не получилось заявить');
      close();
      return;
    }
    qualifySucceeded = true;
    qualifyData = d;
    haptic('medium');
    raceData = buildQualifyRace(d);
    raceData.racers.forEach((r) => loadFly(r.breed));
    const maxFinishT = raceData.racers.reduce((m, r) => Math.max(m, num(r.finishT)), 0.5);
    const displayDur = Math.min(7, Math.max(4.5, maxFinishT * 2.4));
    animScale = displayDur / maxFinishT;
    raceStartTs = 0;
    phase = 'animating';
    setupCanvasSize();
    setTapHtml('');
  }

  async function submitRace() {
    if (raceBusy) return; // busy-guard: не даём повторный POST, пока первый не ответил
    raceBusy = true;
    const mySession = session;
    if (mode === 'qualify') { submitQualify(mySession); return; }
    // v3 «Тап-заезд»: шлём число тапов перед стартом + первый тап + длительность окна.
    // Сервер клампит (clampTapCount) и считает tap-навык со стаминой. reactionMs
    // дублируем на верхнем уровне — совместимость со старым бэком до деплоя (легаси-формула).
    const body = {
      breed: curBreed, mode: friendRace ? 'training' : mode,
      tap: { count: tapCount, reactionMs: tapFirstMs < 0 ? 3000 : tapFirstMs, durationMs: TAP_WINDOW_MS_C },
      reactionMs: tapFirstMs < 0 ? 3000 : tapFirstMs,
    };
    if (!friendRace && mode === 'bet') body.stake = stake;
    const d = await apiRef('/api/pigeons/drag/race', { method: 'POST', body: JSON.stringify(body) }).catch(() => null);
    const ok = !!(d && d.ok && Array.isArray(d.racers));
    // ВАЖНО: стейл-ответ прошлого открытия НЕ должен трогать состояние нового. Если оверлей
    // закрыли/переоткрыли, пока запрос был в полёте (mySession!==session) — не сбрасываем
    // raceBusy (это флаг уже другого, актуального запроса) и не синхронизируем баланс/энергию
    // (window.ckSyncState устаревшим снапшотом затёр бы свежий баланс кликера — тот самый баг).
    if (mySession !== session || !ov) return;
    raceBusy = false;
    // Синхронизируем баланс/энергию кликера, как только знаем ответ — деньги/энергия уже
    // списаны на сервере; актуальность проверена выше (это ответ текущего открытия).
    if (ok && typeof window.ckSyncState === 'function') window.ckSyncState({ balance: d.newBalance, energy: d.newEnergy });
    if (!ok) {
      renderRaceError(d && d.error);
      return;
    }
    haptic('medium');
    raceData = d;
    d.racers.forEach((r) => loadFly(r.breed)); // те же соперники, что в превью (сервер кэширует набор старта)
    const maxFinishT = d.racers.reduce((m, r) => Math.max(m, num(r.finishT)), 0.5);
    // v2.1: заезд дольше (фидбек «слишком быстрая и не напряжённая») — ~5-7с реального времени
    const displayDur = Math.min(7, Math.max(4.5, maxFinishT * 2.4));
    animScale = displayDur / maxFinishT;
    raceStartTs = 0;
    phase = 'animating';
    setupCanvasSize(); // число дорожек теперь берём из raceData.racers (могло отличаться от превью)
    const el = ov.querySelector('#cd-drag-tap'); if (el) el.innerHTML = '';
  }

  // ── ошибка старта без резкого возврата в настройки ──────────────────────────────
  function renderRaceError(reason) {
    phase = 'error';
    stopLoop(); stopTapLoop(); removeTapZone(); clearTimers();
    const race = ov && ov.querySelector('#cd-drag-race');
    const msg = ERR_REASON[reason] || 'Не получилось запустить заезд';
    flash(msg);
    if (!race) { renderSetup(); return; }
    const tap = ov.querySelector('#cd-drag-tap'); if (tap) tap.innerHTML = '';
    race.querySelectorAll('.cd-drag-result').forEach((el) => el.remove());
    const panel = document.createElement('div');
    panel.className = 'cd-drag-result';
    panel.innerHTML = `
      <div class="cd-drag-place">Заезд не стартовал</div>
      <div class="cd-drag-error">${esc(msg)}</div>
      <div class="cd-drag-launch">Проверь энергию и попробуй снова.</div>
      <div class="cd-drag-resrow">
        <button class="cd-drag-resbtn" id="cd-drag-back">К настройкам</button>
        <button class="cd-drag-resbtn cd-drag-resbtn--ghost" id="cd-drag-done">Закрыть</button>
      </div>`;
    race.appendChild(panel);
    const back = panel.querySelector('#cd-drag-back');
    if (back) back.onclick = () => { opponentsPreview = null; renderSetup(); loadOpponents(session); };
    const done = panel.querySelector('#cd-drag-done');
    if (done) done.onclick = close;
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
    // мини-подиум топ-3 (2-1-3), мой голубь подсвечен
    const byPlace = raceData.racers.slice().sort((a, b) => num(a.place) - num(b.place)).slice(0, 3);
    const podOrder = [byPlace[1], byPlace[0], byPlace[2]].filter(Boolean);
    const podHtml = podOrder.map((r) => `<div class="cd-drag-pod cd-drag-pod--${num(r.place)}${r.me ? ' me' : ''}">
        <img src="${artSrc(r.breed)}" alt="" onerror="this.style.display='none'">
        <div class="cd-drag-pod__base">${num(r.place)}</div>
        <div class="cd-drag-pod__n">${r.me ? 'Ты' : esc(meta(r.breed).name)}</div>
      </div>`).join('');
    const isQ = mode === 'qualify' && qualifyData;
    const panel = document.createElement('div');
    panel.className = 'cd-drag-result';
    panel.innerHTML = isQ ? `
      <div class="cd-drag-podium">${podHtml}</div>
      <div class="cd-drag-place">${fmt(qualifyData.score)} ${plu(num(qualifyData.score), 'очко', 'очка', 'очков')}</div>
      <div class="cd-drag-reward">${qualifyData.myPlace ? `${qualifyData.myPlace}-е место из ${num(qualifyData.total)} · ${DIV_NAME[qualifyData.division] || ''}` : (DIV_NAME[qualifyData.division] || '')}</div>
      <div class="cd-drag-launch">Заявка принята · одна попытка в неделю · итоги в ночь на понедельник</div>
      <div class="cd-drag-resrow">
        <button class="cd-drag-resbtn" id="cd-drag-done">Отлично!</button>
      </div>` : `
      <div class="cd-drag-podium">${podHtml}</div>
      <div class="cd-drag-place">${place || '—'} место</div>
      ${isBet
        ? `<div class="cd-drag-reward ${reward > 0 ? 'pos' : reward < 0 ? 'neg' : ''}">${reward > 0 ? '+' : ''}${fmt(reward)} ${plu(Math.abs(num(reward)), 'монета', 'монеты', 'монет')}</div>`
        : `<div class="cd-drag-reward">Тренировка — без ставок</div>`}
      ${raceData.mySkill ? (raceData.mySkill.taps != null
        ? `<div class="cd-drag-launch">Тапов: ${num(raceData.mySkill.taps)} · разгон ${Math.round(num(raceData.mySkill.tapAcc) * 100)}% · первый тап ${(num(raceData.mySkill.reactionMs) / 1000).toFixed(2)} с</div>`
        : `<div class="cd-drag-launch">Запуск: прогрев ${Math.round(num(raceData.mySkill.rev1) * 100)}% · старт ${(num(raceData.mySkill.reactionMs) / 1000).toFixed(2)} с</div>`) : ''}
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
    apiRef = api; curBreed = breed; mode = 'training'; stake = STAKE_PRESETS[0]; friendRace = null;
    opponentsPreview = null; myPower = null; raceBusy = false; phase = 'idle'; raceData = null;
    qualifyData = null; qualifyDone = null; qualifySucceeded = false;
    session++;
    const mySession = session;
    loadFly(curBreed); // полётный лист своей птицы — заранее
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


  function openFriend(api, breed, friendChat, friendName) {
    if (!api || !breed || !friendChat) return;
    apiRef = api; curBreed = breed; mode = 'training'; stake = STAKE_PRESETS[0];
    friendRace = { chat: Number(friendChat), name: friendName || 'Друг' };
    opponentsPreview = null; myPower = null; raceBusy = false; phase = 'idle'; raceData = null;
    qualifyData = null; qualifyDone = null; qualifySucceeded = false;
    session++;
    const mySession = session;
    loadFly(curBreed);
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
  // Отборочный полёт недельной гонки: без сеттапа (режим/ставка не нужны) — сразу
  // сцена + запуск. onDone дёргается после закрытия, если заявка прошла (обновить
  // голубятню). Ошибка «already»/«disabled» — flash и закрытие.
  function openQualify(api, breed, onDone) {
    if (!api || !breed) return;
    apiRef = api; curBreed = breed; mode = 'qualify'; stake = STAKE_PRESETS[0]; friendRace = null;
    opponentsPreview = []; myPower = null; raceBusy = false; phase = 'idle'; raceData = null;
    qualifyData = null; qualifyDone = typeof onDone === 'function' ? onDone : null; qualifySucceeded = false;
    session++;
    loadFly(curBreed);
    styles();
    if (!ov) { ov = document.createElement('div'); ov.className = 'cd-drag-ov'; document.body.appendChild(ov); }
    renderRaceScreen();
    const t = ov.querySelector('.cd-drag-t'); if (t) t.textContent = '🕊️ Отборочный полёт';
    requestAnimationFrame(() => { if (ov) ov.classList.add('on'); });
    haptic('medium');
    if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    resizeHandler = () => { if (canvas && document.body.contains(canvas)) setupCanvasSize(); };
    window.addEventListener('resize', resizeHandler);
    startLaunch();
  }

  function close() {
    clearTimers(); stopLoop(); stopRevLoop(); stopTapLoop(); clearDragTapPointers(); removeTapZone();
    if (resizeHandler) { window.removeEventListener('resize', resizeHandler); resizeHandler = null; }
    session++; // инвалидирует зависшие fetch/countdown-колбэки прежнего открытия
    const el = ov; ov = null; canvas = null; ctx = null;
    if (el) { el.classList.remove('on'); setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 240); }
    raceBusy = false; phase = 'idle'; step = 'setup'; raceData = null;
    const cb = qualifySucceeded ? qualifyDone : null;
    qualifyData = null; qualifyDone = null; qualifySucceeded = false; mode = 'training'; friendRace = null;
    if (cb) setTimeout(cb, 0);
  }

  window.CatDrag = { open, openFriend, openQualify };
})();

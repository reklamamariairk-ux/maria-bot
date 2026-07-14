/* ── «Коллекция голубей» — альбом/сеты/звёзды/витрина ─────────────────────────
 * Сегмент «Коллекция» вкладки dove в catclick.js (сегмент «Помощники» — карточки
 * бизнесов, это отдельная существующая механика, catdove.js её не трогает).
 * Каталог пород — зеркало src/pigeons.ts::PIGEON_BREEDS/PIGEON_SETS/starTarget —
 * менять синхронно с сервером.
 * API: window.CatDove = { mount(container, api), refreshBadge() }.
 * mount вызывается catclick.js один раз при первом открытии сегмента «Коллекция»;
 * api — fetch-хелпер catclick (тот же initData-заголовок), передан аргументом
 * (и продублирован в window.ckApi catclick.js — на случай отдельного вызова).
 * Тосты об ошибках — через window.ckFlash (catclick.js::flashMsg), если нет —
 * молча (не должно случиться, catdove.js всегда грузится вместе с catclick.js).
 * ───────────────────────────────────────────────────────────────────────────── */
(function () {
  // 4 сета × 4 + «Чемпион» вне сетов (только приз гонки) — зеркало src/pigeons.ts::PIGEON_BREEDS
  const BREEDS = [
    { id: "sizar",    name: "Сизарь",             set: "city",  rarity: "common" },
    { id: "belobok",  name: "Белобокий",          set: "city",  rarity: "common" },
    { id: "ryaboy",   name: "Рябой",              set: "city",  rarity: "common" },
    { id: "chubaty",  name: "Чубатый",            set: "city",  rarity: "common" },
    { id: "vanil",    name: "Ванильный",          set: "sweet", rarity: "rare" },
    { id: "shoko",    name: "Шоколадный",         set: "sweet", rarity: "rare" },
    { id: "karamel",  name: "Карамельный",        set: "sweet", rarity: "rare" },
    { id: "yagodny",  name: "Ягодный",            set: "sweet", rarity: "rare" },
    { id: "pochtar",  name: "Иркутский почтарь",  set: "post",  rarity: "epic" },
    { id: "baikal",   name: "Байкальский гонец",  set: "post",  rarity: "epic" },
    { id: "kurier",   name: "Ночной курьер",      set: "post",  rarity: "epic" },
    { id: "vozhak",   name: "Вожак стаи",         set: "post",  rarity: "epic" },
    { id: "svadebny", name: "Свадебный",          set: "fest",  rarity: "epic" },
    { id: "imeninny", name: "Именинный",          set: "fest",  rarity: "epic" },
    { id: "snezhny",  name: "Снежный",            set: "fest",  rarity: "epic" },
    { id: "zolotoy",  name: "Золотой голубь Василия", set: "fest", rarity: "legendary" },
    { id: "champion", name: "Чемпион",            set: "",      rarity: "legendary" }, // не дропается
  ];
  const BY_ID = new Map(BREEDS.map(b => [b.id, b]));
  const SETS = [
    { id: "city",  name: "Городские",        reward: 25000 },
    { id: "sweet", name: "Кондитерские",     reward: 50000 },
    { id: "post",  name: "Почтовые легенды", reward: 75000 },
    { id: "fest",  name: "Праздничные",      reward: 100000 },
  ];
  // Звёзды: сколько дублей скормить до следующей. ★1→★2 = 3, ★2→★3 = 5, ★3 = кап. Зеркало src/pigeons.ts::starTarget
  const starTarget = (stars) => stars === 1 ? 3 : stars === 2 ? 5 : null;
  const MAX_SHOWCASE = 3;

  const fmt = (n) => { n = Number(n) || 0; return Math.round(n).toLocaleString('ru-RU'); };
  const num = (n) => { n = Number(n); return Number.isFinite(n) ? n : 0; };

  function svg(inner, s) { return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`; }
  // Плейсхолдер до готового арта: тот же силуэт голубя, что ICON.dove в catclick — своя
  // копия тут, catdove.js работает как отдельный модуль без чтения приватных функций catclick.
  const DOVE_ICON = (s) => svg('<path d="M21 7c-1.2.8-2.2.9-3 .4-1.6-1-4-.6-5.5 1.2C11 10.4 8.6 11.4 5 11.4c1.3 1.8 3.6 2.7 6 2.2-.9 2.2-2.7 3.6-5 4 2.3 1.4 5.5 1.4 8-.6 2-1.6 3-4 3-6.6 0-.9.4-1.7 1.2-2.2M8.5 18 7 21M12.5 17.5 12 21"/>', s || 26);
  const COIN_ICON = (s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><use href="#ckSymCoin"/></svg>`;

  function authed() { return !!(window.App && App.isAuthed && App.isAuthed()); }
  const PURE = () => document.documentElement.classList.contains('ck-pure');
  function flash(msg) { if (window.ckFlash) window.ckFlash(msg); }
  function haptic(k) { window.haptic && window.haptic(k); }

  let container = null, apiRef = null, data = null, busy = false;

  // ── стили (свой блок, не трогаем catclick-css — переменные --gold-*/--muted/--panel/
  // --line/--ink/--cream каскадируются от .ck-ov, наш контейнер лежит внутри него) ──
  function styles() {
    if (document.getElementById('catdove-css')) return;
    const s = document.createElement('style'); s.id = 'catdove-css';
    s.textContent = `
      .cd-root{padding:2px 2px 4px}
      .cd-summary{text-align:center;color:var(--muted);font-size:13px;margin:0 0 12px;line-height:1.5}
      .cd-summary b{color:var(--gold-l)}
      .cd-sect-t{color:var(--muted);font-weight:700;font-size:11px;margin:4px 4px 7px;text-transform:uppercase;letter-spacing:.7px}
      .cd-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:14px}
      .cd-card{position:relative;background:var(--panel);border:2px solid var(--line);border-radius:13px;padding:6px 4px 8px;text-align:center;cursor:pointer;opacity:0;animation:cdIn .3s ease-out forwards;box-sizing:border-box}
      .cd-card:not(.cd-locked):active{transform:scale(.96)}
      @keyframes cdIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
      .cd-card[data-r="common"]{border-color:rgba(141,146,156,.55)}
      .cd-card[data-r="rare"]{border-color:#b8813f}
      .cd-card[data-r="epic"]{border-color:#9070c2}
      .cd-card[data-r="legendary"]{border-color:var(--gold);box-shadow:0 0 10px rgba(238,191,82,.3)}
      .cd-card.cd-locked{cursor:default}
      .cd-art{position:relative;width:100%;aspect-ratio:1;border-radius:10px;margin:0 auto 6px;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,rgba(238,191,82,.14),rgba(238,191,82,.03));overflow:hidden}
      .cd-art img{width:82%;height:82%;object-fit:contain;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
      .cd-art svg{width:50%;height:50%;color:var(--gold-l)}
      .cd-card.cd-locked .cd-art img,.cd-card.cd-locked .cd-art svg{filter:brightness(0);opacity:.15}
      .cd-cnt{position:absolute;top:4px;right:5px;font-size:9.5px;font-weight:800;color:var(--gold-l);background:rgba(0,0,0,.42);border-radius:8px;padding:1px 5px;z-index:2}
      .cd-n{font-weight:700;font-size:10px;color:var(--ink);line-height:1.2;min-height:2.3em;display:flex;align-items:center;justify-content:center}
      .cd-card.cd-locked .cd-n{color:var(--muted)}
      .cd-stars{font-size:9.5px;color:var(--gold);letter-spacing:1px;margin-top:1px}
      .cd-stars .off{color:rgba(255,255,255,.16)}
      .cd-week{position:absolute;top:-6px;left:-6px;background:linear-gradient(90deg,#ffe7a6,#f0c24e);color:#5a2028;font-size:7.5px;font-weight:900;padding:3px 5px;border-radius:7px;box-shadow:0 2px 6px rgba(0,0,0,.3);z-index:3;white-space:nowrap}
      .cd-showtag{position:absolute;bottom:-4px;left:50%;transform:translateX(-50%);background:rgba(238,191,82,.92);color:#3a230c;font-size:8px;font-weight:900;border-radius:6px;padding:1px 5px;z-index:2;white-space:nowrap}
      .cd-champ{display:flex;align-items:center;gap:12px;background:linear-gradient(90deg,rgba(255,231,166,.14),rgba(238,191,82,.04));border:2px solid var(--gold);border-radius:16px;padding:11px 12px;margin-bottom:16px;box-shadow:0 3px 12px rgba(238,191,82,.18);cursor:pointer}
      .cd-champ:active{transform:scale(.98)}
      .cd-champ__art{width:56px;height:56px;flex:none;border-radius:13px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.22)}
      .cd-champ__art img{width:88%;height:88%;object-fit:contain}
      .cd-champ__art svg{width:60%;height:60%;color:var(--gold-l)}
      .cd-champ__b{flex:1;min-width:0}
      .cd-champ__n{font-weight:800;font-size:15px;color:var(--gold-l)}
      .cd-champ__s{font-size:12px;color:var(--muted);margin-top:2px}
      .cd-setrow{display:flex;align-items:center;gap:10px;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px 12px;margin-bottom:8px}
      .cd-setrow__n{flex:1;min-width:0}
      .cd-setrow__n b{font-weight:700;font-size:13.5px;color:var(--ink);display:block}
      .cd-setrow__p{font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums;margin-top:2px}
      .cd-setrow__done{flex:none;font-size:11.5px;font-weight:800;color:#9be7a8;white-space:nowrap}
      .cd-claimbtn{flex:none;display:inline-flex;align-items:center;gap:5px;border:1px solid #ffe9b3;border-radius:12px;padding:9px 13px;font-weight:800;font-size:12px;background:linear-gradient(180deg,#ffe7a6,#eebf52 56%,#cf9a36);color:#5a2028;cursor:pointer;white-space:nowrap;min-height:38px}
      .cd-claimbtn:disabled{opacity:.6;cursor:default}
      .cd-scrim{position:fixed;inset:0;z-index:9400;background:rgba(10,6,5,.5);display:none}
      .cd-scrim.on{display:block}
      .cd-sheet{position:fixed;left:0;right:0;bottom:0;z-index:9401;background:linear-gradient(180deg,#2e1119,#1d0a11);border-radius:20px 20px 0 0;padding:18px 18px calc(18px + env(safe-area-inset-bottom,0px));box-shadow:0 -14px 44px rgba(0,0,0,.5);transform:translateY(100%);transition:transform .22s ease-out}
      .cd-sheet.on{transform:translateY(0)}
      .cd-sheet__hd{display:flex;align-items:center;justify-content:space-between;gap:10px}
      .cd-sheet__t{font-family:'Nunito',sans-serif;font-weight:800;font-size:17px;color:var(--cream)}
      .cd-sheet__x{width:30px;height:30px;flex:none;border:1px solid var(--line);border-radius:50%;background:rgba(0,0,0,.28);color:var(--cream);font-size:15px;cursor:pointer}
      .cd-sheet__stars{font-size:17px;color:var(--gold);letter-spacing:3px;margin:8px 0 14px}
      .cd-sheet__act{width:100%;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:7px;border:1px solid #ffe9b3;border-radius:14px;padding:13px;font-weight:800;font-size:14px;background:linear-gradient(180deg,#ffe7a6,#eebf52 56%,#cf9a36);color:#5a2028;cursor:pointer;margin-bottom:10px;min-height:44px}
      .cd-sheet__act:disabled{background:rgba(255,255,255,.07);color:var(--muted);border-color:transparent;cursor:default}
      .cd-sheet__act--on{background:linear-gradient(180deg,#9be7a8,#48bb78);color:#0b2e17;border-color:#9be7a8}
      .cd-sheet__hint{font-size:11.5px;color:var(--muted);text-align:center;margin:-4px 0 10px}
      .cd-pop-scrim{position:fixed;inset:0;z-index:9500;background:rgba(10,6,5,.55);display:none;align-items:center;justify-content:center}
      .cd-pop-scrim.on{display:flex}
      .cd-pop{background:linear-gradient(180deg,#2e1119,#1d0a11);border:1px solid var(--line);border-radius:20px;padding:24px;text-align:center;box-shadow:0 18px 50px rgba(0,0,0,.6);max-width:82%}
      .cd-pop h3{margin:0 0 6px;font-family:'Nunito',sans-serif;font-weight:700;font-size:19px;color:var(--cream)}
      .cd-pop .v{font-family:'Nunito',sans-serif;font-size:30px;font-weight:700;color:var(--gold-l);margin:10px 0;display:inline-flex;align-items:center;gap:8px}
      .cd-pop button{margin-top:8px;border:1px solid #ffe9b3;border-radius:14px;padding:12px 26px;font-weight:800;background:linear-gradient(180deg,#ffe7a6,#eebf52 56%,#cf9a36);color:#5a2028;cursor:pointer}
      .cd-empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:30px 18px;color:var(--muted)}
      .cd-empty__ic{width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(238,191,82,.08);border:1px solid var(--line);color:var(--gold);margin-bottom:12px}
      .cd-empty__t{font-weight:800;font-size:15px;color:var(--cream);margin-bottom:4px}
      .cd-empty__s{font-size:12.5px;line-height:1.5;max-width:240px}
      .cd-skrow{display:flex;align-items:center;gap:10px;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px 12px;margin-bottom:7px}
      .cd-sk{position:relative;overflow:hidden;background:rgba(255,255,255,.05);border-radius:8px}
      .cd-sk::after{content:'';position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,rgba(255,255,255,.10),transparent);animation:cdShim 1.2s ease-in-out infinite}
      @keyframes cdShim{100%{transform:translateX(100%)}}
      @media (prefers-reduced-motion:reduce){.cd-card{animation:none;opacity:1}.cd-sk::after{animation:none}}
    `;
    document.head.appendChild(s);
  }

  function emptyState(title, sub) {
    return `<div class="cd-empty"><div class="cd-empty__ic">${DOVE_ICON(28)}</div><div class="cd-empty__t">${title}</div><div class="cd-empty__s">${sub}</div></div>`;
  }
  function skeleton() {
    let rows = '';
    for (let i = 0; i < 3; i++) rows += `<div class="cd-skrow"><span class="cd-sk" style="width:24px;height:24px;border-radius:50%;flex:none"></span><span class="cd-sk" style="height:12px;flex:1"></span></div>`;
    return `<div class="cd-root"><div class="cd-sk" style="height:36px;border-radius:12px;margin-bottom:14px"></div>${rows}</div>`;
  }

  // ── данные ────────────────────────────────────────────────────────────────
  async function load() {
    if (!apiRef || !authed()) { data = null; return; }
    const d = await apiRef('/api/pigeons').catch(() => null);
    if (!d || !Array.isArray(d.inventory)) { data = null; return; }
    const invMap = {};
    d.inventory.forEach((r) => { invMap[r.breed] = { count: num(r.count), stars: num(r.stars) || 1, showcase: num(r.showcase) }; });
    data = { sets: Array.isArray(d.sets) ? d.sets : [], invMap, weekBreed: d.weekBreed || null };
  }

  function showcaseOrder() {
    // breeds с showcase>0, отсортированные по позиции (1..3)
    const arr = Object.keys(data.invMap)
      .map(id => ({ id, pos: data.invMap[id].showcase }))
      .filter(x => x.pos > 0)
      .sort((a, b) => a.pos - b.pos)
      .map(x => x.id);
    return arr;
  }

  // ── рендер ────────────────────────────────────────────────────────────────
  function cardHtml(b) {
    const inv = data.invMap[b.id];
    const owned = !!inv && inv.count > 0;
    const week = data.weekBreed === b.id;
    const artSrc = `/img/pigeons/${b.id}.webp?v=1`;
    const art = `<img src="${artSrc}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span style="display:none;align-items:center;justify-content:center;width:100%;height:100%">${DOVE_ICON(30)}</span>`;
    if (!owned) {
      return `<div class="cd-card cd-locked" data-r="${b.rarity}" data-breed="${b.id}">
        ${week ? '<span class="cd-week">Неделя</span>' : ''}
        <div class="cd-art">${art}</div>
        <div class="cd-n">???</div>
      </div>`;
    }
    const stars = Math.max(1, Math.min(3, num(inv.stars)));
    const starHtml = '★'.repeat(stars) + `<span class="off">${'★'.repeat(3 - stars)}</span>`;
    return `<div class="cd-card" data-r="${b.rarity}" data-breed="${b.id}">
      ${week ? '<span class="cd-week">Неделя</span>' : ''}
      <span class="cd-cnt">×${num(inv.count)}</span>
      <div class="cd-art">${art}</div>
      <div class="cd-n">${b.name}</div>
      <div class="cd-stars">${starHtml}</div>
      ${inv.showcase > 0 ? '<span class="cd-showtag">витрина</span>' : ''}
    </div>`;
  }

  function championHtml() {
    const b = BY_ID.get('champion');
    const inv = data.invMap.champion;
    if (!inv || inv.count <= 0) return '';
    const artSrc = `/img/pigeons/champion.webp?v=1`;
    const art = `<img src="${artSrc}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span style="display:none;align-items:center;justify-content:center;width:100%;height:100%">${DOVE_ICON(30)}</span>`;
    return `<div class="cd-champ" data-breed="champion">
      <div class="cd-champ__art">${art}</div>
      <div class="cd-champ__b">
        <div class="cd-champ__n">${b.name} ${'★'.repeat(Math.max(1, Math.min(3, num(inv.stars))))}</div>
        <div class="cd-champ__s">Приз гонки стаи · ×${num(inv.count)}${inv.showcase > 0 ? ' · на витрине' : ''}</div>
      </div>
    </div>`;
  }

  function setRowHtml(setDef) {
    const s = (data.sets || []).find(x => x.id === setDef.id) || { owned: 0, claimed: false };
    const owned = num(s.owned), full = owned >= 4;
    let action;
    if (s.claimed) action = '<span class="cd-setrow__done">Получено ✓</span>';
    else if (full) action = `<button class="cd-claimbtn" data-claim="${setDef.id}">${COIN_ICON(14)} Забрать ${fmt(setDef.reward)}</button>`;
    else action = '';
    return `<div class="cd-setrow">
      <div class="cd-setrow__n"><b>${setDef.name}</b><div class="cd-setrow__p">${owned}/4 собрано</div></div>
      ${action}
    </div>`;
  }

  function render() {
    if (!container) return;
    if (!authed()) {
      container.innerHTML = emptyState('Коллекция закрыта', PURE()
        ? 'Открой игру в Telegram — собирай голубей-помощников и получай награды за сеты.'
        : 'Войди через приложение «Мария» — собирай голубей и получай награды за сеты.');
      return;
    }
    if (!data) {
      container.innerHTML = emptyState('Не удалось загрузить', 'Проверь связь и открой «Коллекцию» ещё раз.');
      return;
    }
    const ownedCount = BREEDS.filter(b => b.id !== 'champion' && data.invMap[b.id] && data.invMap[b.id].count > 0).length;
    const grid = BREEDS.filter(b => b.id !== 'champion').map(cardHtml).join('');
    const sets = SETS.map(setRowHtml).join('');
    container.innerHTML = `<div class="cd-root">
      <div class="cd-summary">Собери коллекцию голубей — <b>${ownedCount}/16</b>. Голуби падают за тапы и покупки, «порода недели» выпадает чаще.</div>
      <div class="cd-grid">${grid}</div>
      ${championHtml()}
      <div class="cd-sect-t">Сеты</div>
      ${sets}
      <div class="cd-scrim" id="cd-scrim"></div>
      <div class="cd-sheet" id="cd-sheet"></div>
      <div class="cd-pop-scrim" id="cd-pop-scrim"><div class="cd-pop" id="cd-pop"></div></div>
    </div>`;
    wire();
  }

  function wire() {
    container.querySelectorAll('.cd-card:not(.cd-locked)').forEach(el => {
      el.onclick = () => openSheet(el.dataset.breed);
    });
    const champ = container.querySelector('.cd-champ');
    if (champ) champ.onclick = () => openSheet('champion');
    container.querySelectorAll('[data-claim]').forEach(el => {
      el.onclick = () => claimSetAct(el.dataset.claim, el);
    });
    const scrim = container.querySelector('#cd-scrim');
    if (scrim) scrim.onclick = closeSheet;
  }

  // ── шит действий (звёзды/витрина) ───────────────────────────────────────────
  function closeSheet() {
    const sc = container.querySelector('#cd-scrim'), sh = container.querySelector('#cd-sheet');
    if (sc) sc.classList.remove('on');
    if (sh) { sh.classList.remove('on'); sh.innerHTML = ''; }
  }

  function openSheet(breedId) {
    const b = BY_ID.get(breedId), inv = data.invMap[breedId];
    if (!b || !inv || inv.count <= 0) return;
    haptic('light');
    const stars = Math.max(1, Math.min(3, num(inv.stars)));
    const need = starTarget(stars);
    const spare = inv.count - 1;
    const feedEnabled = need != null && spare >= need;
    const feedLabel = need == null
      ? 'Максимум звёзд достигнут'
      : `Скормить дубли (${need}) → ${'★'.repeat(stars + 1)}`;
    const isShown = inv.showcase > 0;
    const curShowcase = showcaseOrder();
    const showcaseFull = curShowcase.length >= MAX_SHOWCASE && !isShown;
    const showLabel = isShown ? 'Убрать с витрины' : (showcaseFull ? `На витрине уже ${MAX_SHOWCASE}/${MAX_SHOWCASE}` : 'На витрину');
    const sc = container.querySelector('#cd-scrim'), sh = container.querySelector('#cd-sheet');
    if (!sc || !sh) return;
    sh.innerHTML = `
      <div class="cd-sheet__hd"><div class="cd-sheet__t">${b.name}</div><button class="cd-sheet__x" id="cd-sheet-x">×</button></div>
      <div class="cd-sheet__stars">${'★'.repeat(stars)}<span style="color:rgba(255,255,255,.18)">${'★'.repeat(3 - stars)}</span></div>
      <button class="cd-sheet__act" id="cd-feed" ${feedEnabled ? '' : 'disabled'}>${feedLabel}</button>
      ${need != null && !feedEnabled ? `<div class="cd-sheet__hint">Нужно ${need} запасных (сейчас ${Math.max(0, spare)})</div>` : ''}
      <button class="cd-sheet__act${isShown ? ' cd-sheet__act--on' : ''}" id="cd-show" ${(!isShown && showcaseFull) ? 'disabled' : ''}>${showLabel}</button>
    `;
    sc.classList.add('on');
    requestAnimationFrame(() => sh.classList.add('on'));
    sh.querySelector('#cd-sheet-x').onclick = closeSheet;
    const feedBtn = sh.querySelector('#cd-feed');
    if (feedBtn && feedEnabled) feedBtn.onclick = () => feedAct(breedId, feedBtn);
    const showBtn = sh.querySelector('#cd-show');
    if (showBtn && !showBtn.disabled) showBtn.onclick = () => showcaseAct(breedId, isShown, showBtn);
  }

  const FEED_REASON = { not_owned: 'Птица не найдена', max_stars: 'Максимум звёзд', not_enough_dupes: 'Не хватает запасных дублей' };
  async function feedAct(breedId, btn) {
    if (busy) return; busy = true; if (btn) btn.disabled = true;
    try {
      const d = await apiRef('/api/pigeons/feed', { method: 'POST', body: JSON.stringify({ breed: breedId }) }).catch(() => null);
      if (d && d.ok) {
        data.invMap[breedId].stars = num(d.stars) || data.invMap[breedId].stars;
        data.invMap[breedId].count -= num(d.spent) || 0;
        haptic('medium');
        closeSheet();
        render();
      } else {
        flash(FEED_REASON[d && d.error] || 'Не получилось скормить дубли');
        if (btn) btn.disabled = false;
      }
    } finally { busy = false; }
  }

  const SHOW_REASON = { bad_input: 'Можно не больше трёх на витрине', unknown_breed: 'Неизвестная порода', not_owned: 'Птица не найдена' };
  async function showcaseAct(breedId, wasShown, btn) {
    if (busy) return; busy = true; if (btn) btn.disabled = true;
    try {
      let breeds = showcaseOrder();
      if (wasShown) breeds = breeds.filter(id => id !== breedId);
      else { if (breeds.length >= MAX_SHOWCASE) { flash(`На витрине уже ${MAX_SHOWCASE}/${MAX_SHOWCASE}`); return; } breeds = breeds.concat([breedId]); }
      const d = await apiRef('/api/pigeons/showcase', { method: 'POST', body: JSON.stringify({ breeds }) }).catch(() => null);
      if (d && d.ok) {
        Object.keys(data.invMap).forEach(id => { data.invMap[id].showcase = 0; });
        breeds.forEach((id, i) => { if (data.invMap[id]) data.invMap[id].showcase = i + 1; });
        haptic('light');
        closeSheet();
        render();
      } else {
        flash(SHOW_REASON[d && d.error] || 'Не получилось обновить витрину');
        if (btn) btn.disabled = false;
      }
    } finally { busy = false; }
  }

  // ── попап награды сета ───────────────────────────────────────────────────
  const CLAIM_REASON = { unknown_set: 'Такого сета нет', incomplete: 'Сет ещё не собран', already: 'Уже получено' };
  function closeRewardPopup() { const s = container.querySelector('#cd-pop-scrim'); if (s) s.classList.remove('on'); }
  function rewardPopup(amount) {
    const s = container.querySelector('#cd-pop-scrim'), p = container.querySelector('#cd-pop');
    if (!s || !p) return;
    p.innerHTML = `<h3>${DOVE_ICON(20)} Сет собран!</h3><div class="v">${COIN_ICON(26)} +${fmt(amount)}</div><button id="cd-pop-ok">Класс!</button>`;
    s.classList.add('on');
    s.onclick = (e) => { if (e.target === s) closeRewardPopup(); };
    p.querySelector('#cd-pop-ok').onclick = closeRewardPopup;
  }
  async function claimSetAct(setId, btn) {
    if (busy) return; busy = true; if (btn) btn.disabled = true;
    try {
      const d = await apiRef('/api/pigeons/set-claim', { method: 'POST', body: JSON.stringify({ set: setId }) }).catch(() => null);
      if (d && d.ok) {
        const s = data.sets.find(x => x.id === setId); if (s) s.claimed = true;
        haptic('medium');
        render();
        rewardPopup(d.reward);
      } else {
        flash(CLAIM_REASON[d && d.error] || 'Не получилось забрать награду');
        if (btn) btn.disabled = false;
      }
    } finally { busy = false; }
  }

  // ── публичный API ────────────────────────────────────────────────────────
  async function mount(el, api) {
    container = el; apiRef = api || window.ckApi;
    styles();
    container.innerHTML = skeleton();
    await load();
    render();
  }

  async function refreshBadge() {
    const api = apiRef || window.ckApi;
    if (!api || !authed()) return;
    const d = await api('/api/pigeons').catch(() => null);
    if (d && window.ckUpdateDoveBadge) window.ckUpdateDoveBadge(num(d.unreadMail));
  }

  window.CatDove = { mount, refreshBadge };
})();

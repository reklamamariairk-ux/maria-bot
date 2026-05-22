/* ── 3D-style gradient SVG icons ──────────────────────────────────────────────
   Объёмные «3D» иконки для hero-блоков и premium-карточек. Векторные (SVG),
   с linear/radial gradients и SVG-фильтрами для soft shadow + inner highlight.
   Каждая использует бренд-палитру (red/gold/cream) и читается крупным размером
   (48-96px). Для мелких служебных иконок (nav-bar, chips) продолжаем использовать
   Lucide stroke из icons.js.

   Использование:
     window.Icon3D('cake', 80) → строка SVG
     <span data-icon-3d="cake" data-size="64"></span> — авто-замена при загрузке

   Все иконки имеют уникальный id градиента (icon3d-${name}) — чтобы при
   нескольких иконках на странице фильтры не конфликтовали.
*/
(function(){
  // Общие defs (фильтры shadow + блик) — один раз на каждую иконку через uid'ы
  function defs(name) {
    return `
      <defs>
        <filter id="i3d-${name}-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="1.2"/>
          <feOffset dx="0" dy="1.5"/>
          <feComponentTransfer><feFuncA type="linear" slope="0.35"/></feComponentTransfer>
          <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <linearGradient id="i3d-${name}-red" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#ff5c75"/>
          <stop offset="50%" stop-color="#d61f37"/>
          <stop offset="100%" stop-color="#8a0d20"/>
        </linearGradient>
        <linearGradient id="i3d-${name}-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#fbe084"/>
          <stop offset="50%" stop-color="#c89232"/>
          <stop offset="100%" stop-color="#6e4a18"/>
        </linearGradient>
        <linearGradient id="i3d-${name}-cream" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#fff8ea"/>
          <stop offset="100%" stop-color="#e6cf9c"/>
        </linearGradient>
        <radialGradient id="i3d-${name}-shine" cx="35%" cy="25%" r="40%">
          <stop offset="0%" stop-color="rgba(255,255,255,.55)"/>
          <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
        </radialGradient>
      </defs>`;
  }

  const ICONS = {
    // Торт — золотой корпус + красный крем + свеча с пламенем
    cake: (n) => `
      ${defs(n)}
      <g filter="url(#i3d-${n}-shadow)">
        <!-- основание-блюдо -->
        <ellipse cx="50" cy="82" rx="38" ry="6" fill="url(#i3d-${n}-cream)"/>
        <!-- нижний ярус -->
        <path d="M14 76 Q14 60 22 58 H78 Q86 60 86 76 V80 Q86 84 78 84 H22 Q14 84 14 80 Z" fill="url(#i3d-${n}-gold)"/>
        <!-- крем по верху нижнего яруса -->
        <path d="M14 60 Q22 54 30 60 Q38 54 50 60 Q62 54 70 60 Q78 54 86 60 V62 Q78 64 70 62 Q62 64 50 62 Q38 64 30 62 Q22 64 14 62 Z" fill="url(#i3d-${n}-red)"/>
        <!-- верхний ярус -->
        <path d="M28 56 Q28 42 36 40 H64 Q72 42 72 56 V58 Q72 60 64 60 H36 Q28 60 28 58 Z" fill="url(#i3d-${n}-gold)"/>
        <!-- свеча -->
        <rect x="48" y="22" width="4" height="18" rx="1" fill="url(#i3d-${n}-cream)"/>
        <!-- пламя -->
        <path d="M50 12 Q46 18 47 22 Q50 26 53 22 Q54 18 50 12 Z" fill="#ffb347"/>
        <ellipse cx="50" cy="18" rx="1.5" ry="3" fill="#fff8d6"/>
        <!-- блик глянца -->
        <ellipse cx="38" cy="50" rx="20" ry="6" fill="url(#i3d-${n}-shine)" opacity=".7"/>
      </g>`,

    // Бриллиант / алмаз клуба — gold + красные грани
    diamond: (n) => `
      ${defs(n)}
      <g filter="url(#i3d-${n}-shadow)">
        <!-- верхняя crown -->
        <path d="M30 30 L50 18 L70 30 L60 40 L40 40 Z" fill="url(#i3d-${n}-gold)"/>
        <path d="M30 30 L40 40 L20 38 Z" fill="#a86d18"/>
        <path d="M70 30 L60 40 L80 38 Z" fill="#a86d18"/>
        <!-- pavilion -->
        <path d="M20 38 L40 40 L60 40 L80 38 L50 82 Z" fill="url(#i3d-${n}-red)"/>
        <!-- грани pavilion -->
        <path d="M40 40 L50 82 L20 38 Z" fill="rgba(0,0,0,.18)"/>
        <path d="M60 40 L80 38 L50 82 Z" fill="rgba(255,255,255,.12)"/>
        <!-- блик -->
        <path d="M34 32 L42 26 L48 36 L40 38 Z" fill="rgba(255,255,255,.65)"/>
      </g>`,

    // Подарок — красная коробка с золотой лентой
    gift: (n) => `
      ${defs(n)}
      <g filter="url(#i3d-${n}-shadow)">
        <!-- основание коробки -->
        <rect x="16" y="40" width="68" height="42" rx="4" fill="url(#i3d-${n}-red)"/>
        <!-- крышка -->
        <rect x="14" y="36" width="72" height="14" rx="3" fill="url(#i3d-${n}-red)"/>
        <!-- вертикальная лента -->
        <rect x="46" y="36" width="8" height="46" fill="url(#i3d-${n}-gold)"/>
        <!-- горизонтальная лента -->
        <rect x="14" y="42" width="72" height="6" fill="url(#i3d-${n}-gold)"/>
        <!-- бант -->
        <path d="M50 30 Q38 18 32 26 Q30 32 38 34 L50 36 Z" fill="url(#i3d-${n}-gold)"/>
        <path d="M50 30 Q62 18 68 26 Q70 32 62 34 L50 36 Z" fill="url(#i3d-${n}-gold)"/>
        <circle cx="50" cy="32" r="4" fill="url(#i3d-${n}-gold)"/>
        <!-- блик на крышке -->
        <ellipse cx="32" cy="42" rx="14" ry="3" fill="url(#i3d-${n}-shine)" opacity=".8"/>
      </g>`,

    // Кубок — золотой с красным камнем
    trophy: (n) => `
      ${defs(n)}
      <g filter="url(#i3d-${n}-shadow)">
        <!-- база -->
        <rect x="32" y="76" width="36" height="8" rx="2" fill="url(#i3d-${n}-gold)"/>
        <rect x="40" y="68" width="20" height="10" fill="url(#i3d-${n}-gold)"/>
        <!-- стояк-чаша -->
        <path d="M30 22 L70 22 L66 56 Q66 64 50 64 Q34 64 34 56 Z" fill="url(#i3d-${n}-gold)"/>
        <!-- ушки сбоку -->
        <path d="M30 26 Q22 26 22 36 Q22 46 32 48" fill="none" stroke="#a86d18" stroke-width="3" stroke-linecap="round"/>
        <path d="M70 26 Q78 26 78 36 Q78 46 68 48" fill="none" stroke="#a86d18" stroke-width="3" stroke-linecap="round"/>
        <!-- красный камень в центре -->
        <circle cx="50" cy="40" r="9" fill="url(#i3d-${n}-red)"/>
        <circle cx="48" cy="38" r="3" fill="rgba(255,255,255,.5)"/>
        <!-- блик на корпусе -->
        <path d="M36 26 Q38 28 38 50 Q38 56 42 60" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="2"/>
      </g>`,

    // Сердце — красный градиент с бликом
    heart: (n) => `
      ${defs(n)}
      <g filter="url(#i3d-${n}-shadow)">
        <path d="M50 84 C50 84 14 60 14 36 C14 24 22 16 32 16 C40 16 46 20 50 26 C54 20 60 16 68 16 C78 16 86 24 86 36 C86 60 50 84 50 84 Z" fill="url(#i3d-${n}-red)"/>
        <!-- блик -->
        <ellipse cx="34" cy="32" rx="10" ry="6" fill="url(#i3d-${n}-shine)" opacity=".9" transform="rotate(-25 34 32)"/>
      </g>`,

    // Sparkles / звёзды — золотые с блеском
    sparkles: (n) => `
      ${defs(n)}
      <g filter="url(#i3d-${n}-shadow)">
        <!-- большая звезда -->
        <path d="M50 14 L56 38 L80 44 L56 50 L50 74 L44 50 L20 44 L44 38 Z" fill="url(#i3d-${n}-gold)"/>
        <!-- маленькая -->
        <path d="M76 18 L78 26 L86 28 L78 30 L76 38 L74 30 L66 28 L74 26 Z" fill="url(#i3d-${n}-gold)"/>
        <!-- блик -->
        <ellipse cx="42" cy="32" rx="6" ry="3" fill="rgba(255,255,255,.6)" opacity=".9" transform="rotate(-20 42 32)"/>
      </g>`,

    // Корона — золотая с красным камнем
    crown: (n) => `
      ${defs(n)}
      <g filter="url(#i3d-${n}-shadow)">
        <path d="M14 36 L26 60 L40 38 L50 62 L60 38 L74 60 L86 36 L82 76 L18 76 Z" fill="url(#i3d-${n}-gold)"/>
        <rect x="18" y="74" width="64" height="6" rx="2" fill="#8b6420"/>
        <!-- камни на вершинах -->
        <circle cx="14" cy="36" r="4" fill="url(#i3d-${n}-red)"/>
        <circle cx="50" cy="32" r="5" fill="url(#i3d-${n}-red)"/>
        <circle cx="86" cy="36" r="4" fill="url(#i3d-${n}-red)"/>
        <!-- блик -->
        <path d="M22 50 L30 56 L34 50 Z" fill="rgba(255,255,255,.4)"/>
      </g>`,

    // Огонь / fire — красно-оранжевый с золотым ядром
    fire: (n) => `
      ${defs(n)}
      <g filter="url(#i3d-${n}-shadow)">
        <!-- внешнее пламя -->
        <path d="M50 12 C42 26 28 32 28 50 C28 68 38 84 50 84 C62 84 72 68 72 50 C72 38 64 30 60 22 C58 28 52 22 50 12 Z" fill="url(#i3d-${n}-red)"/>
        <!-- внутреннее пламя -->
        <path d="M50 30 C44 42 38 50 38 62 C38 74 44 80 50 80 C56 80 62 74 62 62 C62 52 56 48 54 40 C52 44 51 38 50 30 Z" fill="url(#i3d-${n}-gold)"/>
        <!-- ядро -->
        <ellipse cx="50" cy="68" rx="6" ry="10" fill="#fff8d6"/>
      </g>`,
  };

  function svg(name, size) {
    const fn = ICONS[name];
    if (!fn) return '';
    const s = Math.round(size || 64);
    const uid = `${name}-${Math.random().toString(36).slice(2, 8)}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 100 100" class="ic3d">${fn(uid)}</svg>`;
  }

  window.Icon3D = svg;

  // Авто-замена: <span data-icon-3d="cake" data-size="64"></span> → 3D SVG
  function inflate(root) {
    (root || document).querySelectorAll('[data-icon-3d]').forEach((el) => {
      if (el.dataset.icon3dRendered) return;
      const name = el.dataset.icon3d;
      const size = el.dataset.size || 64;
      el.innerHTML = svg(name, size);
      el.dataset.icon3dRendered = '1';
    });
  }
  if (document.readyState !== 'loading') inflate();
  else document.addEventListener('DOMContentLoaded', () => inflate());

  // Для динамических вставок
  window.Icon3DInflate = inflate;
})();

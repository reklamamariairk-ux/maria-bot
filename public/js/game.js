/* ═══════════════════════════════════════════════════════
   MEMORY GAME
═══════════════════════════════════════════════════════ */
const MEMORY_ICONS = ['🎂','🍰','🧁','🍩','🍪','🍫','🍬','🍭'];

let memFlipped = [], memMatched = 0, memMoves = 0, memLocked = false;

function initMemory() {
  const grid = document.getElementById('memory-grid');
  if (!grid) return;
  grid.innerHTML = '';
  memFlipped = []; memMatched = 0; memMoves = 0; memLocked = false;
  document.getElementById('memory-moves').textContent = '0';
  document.getElementById('memory-pairs').textContent = '0';

  const deck = [...MEMORY_ICONS, ...MEMORY_ICONS].sort(() => Math.random() - .5);
  deck.forEach((icon) => {
    const card = document.createElement('div');
    card.className = 'memory-card';
    card.dataset.icon = icon;
    card.innerHTML = `<span class="front">${icon}</span><span class="back">🎀</span>`;
    card.addEventListener('click', () => flipCard(card));
    grid.appendChild(card);
  });
}

function flipCard(card) {
  if (memLocked || card.classList.contains('flipped') || card.classList.contains('matched')) return;
  if (memFlipped.length >= 2) return;
  card.classList.add('flipped');
  memFlipped.push(card);
  if (memFlipped.length === 2) {
    memMoves++;
    document.getElementById('memory-moves').textContent = memMoves;
    checkMatch();
  }
}

function checkMatch() {
  const [a, b] = memFlipped;
  if (a.dataset.icon === b.dataset.icon) {
    a.classList.add('matched'); b.classList.add('matched');
    memMatched++;
    document.getElementById('memory-pairs').textContent = memMatched;
    memFlipped = [];
    if (memMatched === MEMORY_ICONS.length)
      setTimeout(() => alert(`🎉 Победа за ${memMoves} ходов!`), 200);
  } else {
    memLocked = true;
    setTimeout(() => {
      a.classList.remove('flipped'); b.classList.remove('flipped');
      memFlipped = []; memLocked = false;
    }, 900);
  }
}

/* ═══════════════════════════════════════════════════════
   GAME SELECTOR
═══════════════════════════════════════════════════════ */
function showGame(name) {
  document.getElementById('game-memory').style.display = name === 'memory' ? '' : 'none';
  document.getElementById('game-flappy').style.display = name === 'flappy' ? '' : 'none';
  document.getElementById('btn-memory').classList.toggle('active', name === 'memory');
  document.getElementById('btn-flappy').classList.toggle('active', name === 'flappy');
  if (name !== 'flappy') flappyStop();
}

/* ═══════════════════════════════════════════════════════
   FLAPPY CAKE
═══════════════════════════════════════════════════════ */
const FLAPPY_CAKE  = '🎂';
const FLAPPY_GAP   = 120;   // высота зазора между трубами
const FLAPPY_SPEED = 2.2;   // скорость труб (px/frame)
const FLAPPY_GRAV  = 0.38;  // сила притяжения
const FLAPPY_JUMP  = -7;    // импульс прыжка
const PIPE_W       = 52;    // ширина трубы
const PIPE_DIST    = 220;   // расстояние между трубами

let flappyCvs, flappyCtx;
let flappyRAF = null;
let flappyState = 'idle'; // idle | playing | dead

let cake, pipes, flappyScore, flappyBest;

function flappyInit() {
  flappyCvs = document.getElementById('flappy-canvas');
  if (!flappyCvs) return;

  // Растягиваем canvas под реальный размер элемента
  const rect = flappyCvs.getBoundingClientRect();
  flappyCvs.width  = rect.width  || 320;
  flappyCvs.height = rect.height || 340;
  flappyCtx = flappyCvs.getContext('2d');

  flappyBest = Number(localStorage.getItem('flappy_best') || 0);
  document.getElementById('flappy-best').textContent = flappyBest;

  flappyCvs.addEventListener('click',      flappyTap);
  flappyCvs.addEventListener('touchstart', flappyTap, { passive: true });

  flappyReset();
  flappyLoop();
}

function flappyReset() {
  const W = flappyCvs.width, H = flappyCvs.height;
  cake = { x: W * 0.22, y: H / 2, vy: 0, r: 20 };
  pipes = [];
  flappyScore = 0;
  document.getElementById('flappy-score').textContent = '0';
  flappyState = 'idle';
  spawnPipe();
}

function flappyStart() {
  if (!flappyCvs) { flappyInit(); return; }
  flappyReset();
  if (!flappyRAF) flappyLoop();
}

function flappyStop() {
  if (flappyRAF) { cancelAnimationFrame(flappyRAF); flappyRAF = null; }
}

function flappyTap(e) {
  e.stopPropagation();
  if (flappyState === 'dead') { flappyReset(); return; }
  flappyState = 'playing';
  cake.vy = FLAPPY_JUMP;
}

function spawnPipe() {
  const W = flappyCvs.width, H = flappyCvs.height;
  const minTop = 40, maxTop = H - FLAPPY_GAP - 40;
  const topH = minTop + Math.random() * (maxTop - minTop);
  pipes.push({ x: W + 10, topH, passed: false });
}

function flappyLoop() {
  flappyRAF = requestAnimationFrame(flappyLoop);
  flappyDraw();
  if (flappyState === 'playing') flappyUpdate();
}

function flappyUpdate() {
  const W = flappyCvs.width, H = flappyCvs.height;

  // Физика торта
  cake.vy += FLAPPY_GRAV;
  cake.y  += cake.vy;

  // Трубы
  for (let i = pipes.length - 1; i >= 0; i--) {
    pipes[i].x -= FLAPPY_SPEED;

    // Новая труба
    if (i === pipes.length - 1 && pipes[i].x < W - PIPE_DIST) spawnPipe();

    // Счёт
    if (!pipes[i].passed && pipes[i].x + PIPE_W < cake.x) {
      pipes[i].passed = true;
      flappyScore++;
      document.getElementById('flappy-score').textContent = flappyScore;
      if (flappyScore > flappyBest) {
        flappyBest = flappyScore;
        localStorage.setItem('flappy_best', flappyBest);
        document.getElementById('flappy-best').textContent = flappyBest;
      }
    }

    // Удалить за экраном
    if (pipes[i].x + PIPE_W < 0) { pipes.splice(i, 1); continue; }

    // Коллизия
    const bottomY = pipes[i].topH + FLAPPY_GAP;
    if (
      cake.x + cake.r - 6 > pipes[i].x &&
      cake.x - cake.r + 6 < pipes[i].x + PIPE_W &&
      (cake.y - cake.r + 4 < pipes[i].topH || cake.y + cake.r - 4 > bottomY)
    ) {
      flappyDie();
      return;
    }
  }

  // Пол / потолок
  if (cake.y + cake.r > H || cake.y - cake.r < 0) {
    flappyDie();
  }
}

function flappyDie() {
  flappyState = 'dead';
}

function flappyDraw() {
  const W = flappyCvs.width, H = flappyCvs.height;
  const ctx = flappyCtx;

  // Фон — небо
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#87CEEB');
  sky.addColorStop(1, '#c9eeff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Земля
  ctx.fillStyle = '#8B6914';
  ctx.fillRect(0, H - 18, W, 18);
  ctx.fillStyle = '#5a8f3c';
  ctx.fillRect(0, H - 22, W, 6);

  // Трубы
  ctx.fillStyle = '#5cba2e';
  ctx.strokeStyle = '#3d8a1a';
  ctx.lineWidth = 2;
  pipes.forEach(p => {
    const capH = 14, capW = PIPE_W + 8;
    const capX = p.x - 4;

    // Верхняя труба
    ctx.fillStyle = '#5cba2e';
    ctx.fillRect(p.x, 0, PIPE_W, p.topH);
    ctx.fillStyle = '#4da024';
    ctx.fillRect(capX, p.topH - capH, capW, capH);
    ctx.strokeRect(p.x, 0, PIPE_W, p.topH);
    ctx.strokeRect(capX, p.topH - capH, capW, capH);

    // Нижняя труба
    const botY = p.topH + FLAPPY_GAP;
    ctx.fillStyle = '#5cba2e';
    ctx.fillRect(p.x, botY, PIPE_W, H - botY);
    ctx.fillStyle = '#4da024';
    ctx.fillRect(capX, botY, capW, capH);
    ctx.strokeStyle = '#3d8a1a';
    ctx.strokeRect(p.x, botY, PIPE_W, H - botY);
    ctx.strokeRect(capX, botY, capW, capH);
  });

  // Торт (emoji)
  ctx.font = `${cake.r * 2}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Небольшой наклон по скорости
  ctx.save();
  ctx.translate(cake.x, cake.y);
  ctx.rotate(Math.max(-0.4, Math.min(0.4, cake.vy * 0.05)));
  ctx.fillText(FLAPPY_CAKE, 0, 0);
  ctx.restore();

  // Оверлей при смерти
  if (flappyState === 'dead') {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 22px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Игра окончена', W / 2, H / 2 - 28);
    ctx.font = '16px Inter, sans-serif';
    ctx.fillText(`Счёт: ${flappyScore}`, W / 2, H / 2 + 4);
    ctx.fillStyle = '#fce8eb';
    ctx.font = '13px Inter, sans-serif';
    ctx.fillText('Нажмите, чтобы начать заново', W / 2, H / 2 + 34);
  }

  // Подсказка до старта
  if (flappyState === 'idle') {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Нажмите, чтобы начать!', W / 2, H / 2);
    ctx.font = '14px Inter, sans-serif';
    ctx.fillText('Тапайте, чтобы лететь 🎂', W / 2, H / 2 + 28);
  }
}

// Автоинициализация при загрузке игры
document.addEventListener('DOMContentLoaded', () => {
  // Инициализируем flappy только когда секция показана
  const observer = new MutationObserver(() => {
    const canvas = document.getElementById('flappy-canvas');
    if (canvas && canvas.offsetParent !== null && !flappyCvs) {
      flappyInit();
    }
  });
  const funTab = document.getElementById('tab-fun');
  if (funTab) observer.observe(funTab, { attributes: true, attributeFilter: ['class'] });
});

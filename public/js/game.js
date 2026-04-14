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
  deck.forEach((icon, i) => {
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
   CATCH GAME
═══════════════════════════════════════════════════════ */
const GOOD_ITEMS = ['🎂','🍰','🧁','🍩','🍪','🎁'];
const BAD_ITEMS  = ['💣','🐛'];

let catchScore = 0, catchLives = 3, catchRunning = false;
let catchTimers = [], playerPct = 50;

function showGame(name) {
  document.getElementById('game-memory').style.display = name === 'memory' ? '' : 'none';
  document.getElementById('game-catch').style.display  = name === 'catch'  ? '' : 'none';
  document.getElementById('btn-memory').classList.toggle('active', name === 'memory');
  document.getElementById('btn-catch').classList.toggle('active', name === 'catch');
  if (name !== 'catch') stopCatch();
}

function startCatch() {
  stopCatch();
  catchScore = 0; catchLives = 3; catchRunning = true;
  document.getElementById('catch-score').textContent = '0';
  document.getElementById('catch-lives').textContent = '3';

  const overlay = document.getElementById('catch-overlay');
  if (overlay) overlay.classList.add('hidden');

  // Вешаем на document — работает даже если палец вышел за арену
  document.addEventListener('touchmove', onTouch, { passive: false });
  document.addEventListener('mousemove', onMouse);

  dropLoop();
}

function stopCatch() {
  catchRunning = false;
  catchTimers.forEach(clearTimeout); catchTimers = [];
  document.getElementById('catch-arena')?.querySelectorAll('.catch-item').forEach(e => e.remove());
  document.removeEventListener('touchmove', onTouch);
  document.removeEventListener('mousemove', onMouse);
}

function dropLoop() {
  if (!catchRunning) return;
  spawnItem();
  const delay = Math.max(500, 1400 - catchScore * 10);
  catchTimers.push(setTimeout(dropLoop, delay));
}

function spawnItem() {
  const arena = document.getElementById('catch-arena');
  if (!arena) return;
  const isBad = Math.random() < .15;
  const icon  = isBad
    ? BAD_ITEMS[Math.floor(Math.random() * BAD_ITEMS.length)]
    : GOOD_ITEMS[Math.floor(Math.random() * GOOD_ITEMS.length)];
  const speed = Math.max(1000, 2800 - catchScore * 12);
  const left  = 5 + Math.random() * 85;

  const el = document.createElement('div');
  el.className = 'catch-item';
  el.textContent = icon;
  el.style.cssText = `left:${left}%;animation-duration:${speed}ms`;
  arena.appendChild(el);

  const timer = setTimeout(() => {
    if (!el.parentNode) return;
    const ir = el.getBoundingClientRect();
    const pr = document.getElementById('catch-player')?.getBoundingClientRect();
    if (pr && ir.bottom >= pr.top && ir.left < pr.right && ir.right > pr.left) {
      if (isBad) loseLife();
      else { catchScore++; document.getElementById('catch-score').textContent = catchScore; }
    } else {
      if (!isBad) loseLife();
    }
    el.remove();
  }, speed);
  catchTimers.push(timer);
}

function loseLife() {
  catchLives--;
  document.getElementById('catch-lives').textContent = catchLives;
  if (catchLives <= 0) {
    stopCatch();
    const overlay = document.getElementById('catch-overlay');
    if (overlay) {
      overlay.classList.remove('hidden');
      overlay.querySelector('.catch-overlay__text').textContent = `Очки: ${catchScore}`;
    }
  }
}

function onMouse(e) {
  if (!catchRunning) return;
  const arena = document.getElementById('catch-arena');
  if (!arena) return;
  const r = arena.getBoundingClientRect();
  movePlayer((e.clientX - r.left) / r.width * 100);
}
function onTouch(e) {
  if (!catchRunning) return;
  e.preventDefault();
  const arena = document.getElementById('catch-arena');
  if (!arena) return;
  const r = arena.getBoundingClientRect();
  movePlayer((e.touches[0].clientX - r.left) / r.width * 100);
}
function movePlayer(pct) {
  playerPct = Math.max(4, Math.min(92, pct));
  const p = document.getElementById('catch-player');
  if (p) p.style.left = playerPct + '%';
}

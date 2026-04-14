/* ═══════════════════════════════════════════════════════
   MEMORY GAME — найди все пары сладостей
═══════════════════════════════════════════════════════ */
const MEMORY_ICONS = ["🎂","🍰","🧁","🍩","🍪","🍫","🍬","🍭"];

let memoryCards   = [];
let memoryFlipped = [];
let memoryMatched = 0;
let memoryMoves   = 0;
let memoryLocked  = false;

function initMemory() {
  const grid = document.getElementById("memory-grid");
  grid.innerHTML = "";
  memoryFlipped = [];
  memoryMatched = 0;
  memoryMoves   = 0;
  memoryLocked  = false;
  document.getElementById("memory-moves").textContent = "0";
  document.getElementById("memory-pairs").textContent = "0";

  // Дублируем и перемешиваем
  const deck = [...MEMORY_ICONS, ...MEMORY_ICONS]
    .sort(() => Math.random() - 0.5);

  memoryCards = deck.map((icon, i) => {
    const card = document.createElement("div");
    card.className = "memory-card";
    card.dataset.icon = icon;
    card.dataset.index = String(i);
    card.innerHTML = `<span class="front">${icon}</span><span class="back">🍬</span>`;
    card.addEventListener("click", () => flipCard(card));
    grid.appendChild(card);
    return card;
  });
}

function flipCard(card) {
  if (memoryLocked) return;
  if (card.classList.contains("flipped")) return;
  if (card.classList.contains("matched")) return;
  if (memoryFlipped.length >= 2) return;

  card.classList.add("flipped");
  memoryFlipped.push(card);

  if (memoryFlipped.length === 2) {
    memoryMoves++;
    document.getElementById("memory-moves").textContent = memoryMoves;
    checkMemoryMatch();
  }
}

function checkMemoryMatch() {
  const [a, b] = memoryFlipped;
  if (a.dataset.icon === b.dataset.icon) {
    a.classList.add("matched");
    b.classList.add("matched");
    memoryMatched++;
    document.getElementById("memory-pairs").textContent = memoryMatched;
    memoryFlipped = [];
    if (memoryMatched === MEMORY_ICONS.length) {
      setTimeout(() => alert(`🎉 Победа! Ходов: ${memoryMoves}`), 200);
    }
  } else {
    memoryLocked = true;
    setTimeout(() => {
      a.classList.remove("flipped");
      b.classList.remove("flipped");
      memoryFlipped = [];
      memoryLocked  = false;
    }, 900);
  }
}

/* ═══════════════════════════════════════════════════════
   CATCH GAME — лови падающие тортики
═══════════════════════════════════════════════════════ */
const CATCH_ITEMS  = ["🎂","🍰","🧁","🍩","🍪"];
const CATCH_BOMBS  = ["💣"];
const ARENA_ID     = "catch-arena";
const PLAYER_ID    = "catch-player";

let catchScore   = 0;
let catchLives   = 3;
let catchRunning = false;
let catchTimers  = [];
let playerLeft   = 50; // percent
let playerW      = 0;
let arenaW       = 0;
let arenaH       = 0;
let dragStartX   = null;
let dragPlayerX  = null;

function showGame(name) {
  document.getElementById("game-memory").style.display = name === "memory" ? "block" : "none";
  document.getElementById("game-catch").style.display  = name === "catch"  ? "block" : "none";
  document.getElementById("btn-memory").classList.toggle("active", name === "memory");
  document.getElementById("btn-catch").classList.toggle("active", name === "catch");
}

function startCatch() {
  stopCatch();
  catchScore   = 0;
  catchLives   = 3;
  catchRunning = true;

  document.getElementById("catch-score").textContent = "0";
  document.getElementById("catch-lives").textContent = "3";
  document.getElementById("catch-start-msg").style.display = "none";

  const arena  = document.getElementById(ARENA_ID);
  const player = document.getElementById(PLAYER_ID);
  arenaW = arena.clientWidth;
  arenaH = arena.clientHeight;
  playerW = player.clientWidth || 40;

  // Управление: тач + мышь
  arena.addEventListener("touchmove",  onTouchMove,  { passive: false });
  arena.addEventListener("mousemove",  onMouseMove);

  // Спавн объектов
  scheduleDrop();
}

function stopCatch() {
  catchRunning = false;
  catchTimers.forEach(t => clearTimeout(t));
  catchTimers = [];
  const arena = document.getElementById(ARENA_ID);
  arena.querySelectorAll(".catch-item").forEach(el => el.remove());
  arena.removeEventListener("touchmove", onTouchMove);
  arena.removeEventListener("mousemove", onMouseMove);
}

function scheduleDrop() {
  if (!catchRunning) return;
  dropItem();
  const delay = Math.max(600, 1500 - catchScore * 8);
  catchTimers.push(setTimeout(scheduleDrop, delay));
}

function dropItem() {
  const arena = document.getElementById(ARENA_ID);
  if (!arena) return;

  const isBomb  = Math.random() < 0.15;
  const icon    = isBomb
    ? CATCH_BOMBS[0]
    : CATCH_ITEMS[Math.floor(Math.random() * CATCH_ITEMS.length)];
  const speed   = Math.max(1200, 3000 - catchScore * 15); // ms
  const leftPct = 5 + Math.random() * 85;

  const el = document.createElement("div");
  el.className  = "catch-item";
  el.textContent = icon;
  el.style.left  = leftPct + "%";
  el.style.animationDuration = speed + "ms";
  el.dataset.bomb = String(isBomb);
  arena.appendChild(el);

  // Проверяем пересечение с корзиной по завершении анимации
  const timer = setTimeout(() => {
    if (!el.parentNode) return;
    const itemRect   = el.getBoundingClientRect();
    const playerEl   = document.getElementById(PLAYER_ID);
    const playerRect = playerEl?.getBoundingClientRect();

    if (playerRect &&
        itemRect.bottom >= playerRect.top &&
        itemRect.left   < playerRect.right &&
        itemRect.right  > playerRect.left) {
      // Поймали!
      if (isBomb) {
        loseLife();
      } else {
        catchScore++;
        document.getElementById("catch-score").textContent = catchScore;
        el.style.animation = "none";
        el.style.fontSize  = "14px";
        el.style.opacity   = "0";
        el.style.transition = "opacity .2s";
      }
    } else {
      // Не поймали торт → теряем жизнь
      if (!isBomb) loseLife();
    }
    el.remove();
  }, speed);

  catchTimers.push(timer);
}

function loseLife() {
  catchLives--;
  document.getElementById("catch-lives").textContent = catchLives;
  if (catchLives <= 0) {
    stopCatch();
    setTimeout(() => {
      alert(`💔 Игра окончена!\nОчки: ${catchScore}\n\nНажмите «Старт» чтобы играть снова`);
      document.getElementById("catch-start-msg").style.display = "flex";
    }, 100);
  }
}

// Управление игроком
function onMouseMove(e) {
  if (!catchRunning) return;
  const arena   = document.getElementById(ARENA_ID);
  const rect    = arena.getBoundingClientRect();
  const relX    = e.clientX - rect.left;
  movePlayer(relX / rect.width * 100);
}

function onTouchMove(e) {
  if (!catchRunning) return;
  e.preventDefault();
  const arena = document.getElementById(ARENA_ID);
  const rect  = arena.getBoundingClientRect();
  const touch = e.touches[0];
  const relX  = touch.clientX - rect.left;
  movePlayer(relX / rect.width * 100);
}

function movePlayer(pct) {
  const clamped = Math.max(3, Math.min(93, pct));
  playerLeft = clamped;
  const player = document.getElementById(PLAYER_ID);
  if (player) player.style.left = clamped + "%";
}

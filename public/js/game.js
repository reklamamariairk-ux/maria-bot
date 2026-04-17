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
  deck.forEach(icon => {
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
   FLAPPY CAKE v2 — Modern Rewrite
   • Delta-time physics (frame-rate independent)
   • HiDPI / retina support
   • Modern brand-styled graphics
   • Particles + clouds
═══════════════════════════════════════════════════════ */

// — Physics (all in logical px / second) —
const FC = {
  GRAVITY:    1100,   // px/s²
  JUMP:       -450,   // px/s on tap
  SPEED:      150,    // pipe speed px/s
  GAP:        165,    // gap between pipes
  PIPE_W:     58,     // pipe width
  PIPE_DIST:  310,    // horizontal distance between pipes
  CAKE_R:     19,     // collision radius
};

let fc = {
  cvs: null, ctx: null, dpr: 1,
  raf: null, state: 'idle',
  cake: {}, pipes: [], particles: [], clouds: [],
  score: 0, best: 0,
  lastTime: 0,
};

// ─ Init ─────────────────────────────────────────────
function flappyInit() {
  fc.cvs = document.getElementById('flappy-canvas');
  if (!fc.cvs) return;

  fc.dpr = Math.min(window.devicePixelRatio || 1, 3);
  const rect = fc.cvs.getBoundingClientRect();
  const W = rect.width  || 320;
  const H = rect.height || 380;

  fc.cvs.width  = W * fc.dpr;
  fc.cvs.height = H * fc.dpr;
  fc.cvs.style.width  = W + 'px';
  fc.cvs.style.height = H + 'px';

  fc.ctx = fc.cvs.getContext('2d');
  fc.ctx.scale(fc.dpr, fc.dpr);

  fc.best = Number(localStorage.getItem('flappy_best2') || 0);
  document.getElementById('flappy-best').textContent = fc.best;

  fc.cvs.addEventListener('click',      fcTap);
  fc.cvs.addEventListener('touchstart', fcTap, { passive: true });

  fcBuildClouds();
  fcReset();
  fc.lastTime = performance.now();
  fcLoop(fc.lastTime);
}

function fcW() { return fc.cvs.width  / fc.dpr; }
function fcH() { return fc.cvs.height / fc.dpr; }

// ─ Clouds ───────────────────────────────────────────
function fcBuildClouds() {
  fc.clouds = [];
  const W = fcW(), H = fcH();
  for (let i = 0; i < 5; i++) {
    fc.clouds.push({
      x: Math.random() * W,
      y: 30 + Math.random() * (H * 0.45),
      r: 22 + Math.random() * 28,
      speed: 14 + Math.random() * 18,
    });
  }
}

// ─ Reset ────────────────────────────────────────────
function fcReset() {
  const W = fcW(), H = fcH();
  fc.cake = { x: W * 0.22, y: H * 0.45, vy: 0 };
  fc.pipes = [];
  fc.particles = [];
  fc.score = 0;
  fc.state = 'idle';
  document.getElementById('flappy-score').textContent = '0';
  fcSpawnPipe();
}

function flappyStart() {
  if (!fc.cvs) { flappyInit(); return; }
  fcReset();
  if (!fc.raf) {
    fc.lastTime = performance.now();
    fcLoop(fc.lastTime);
  }
}

function flappyStop() {
  if (fc.raf) { cancelAnimationFrame(fc.raf); fc.raf = null; }
}

// ─ Input ────────────────────────────────────────────
function fcTap(e) {
  e.stopPropagation();
  if (fc.state === 'dead') { fcReset(); return; }
  fc.state = 'playing';
  fc.cake.vy = FC.JUMP;
  // Burst particles on jump
  for (let i = 0; i < 5; i++) {
    fc.particles.push({
      x: fc.cake.x, y: fc.cake.y,
      vx: (Math.random() - 0.5) * 120,
      vy: -80 - Math.random() * 120,
      life: 1, size: 4 + Math.random() * 4,
      color: Math.random() > 0.5 ? '#f7c948' : '#ff6b8a',
    });
  }
}

// ─ Pipe ─────────────────────────────────────────────
function fcSpawnPipe() {
  const H = fcH(), W = fcW();
  const min = 55, max = H - FC.GAP - 55 - 28;
  const topH = min + Math.random() * (max - min);
  fc.pipes.push({ x: W + 20, topH, passed: false });
}

// ─ Update ───────────────────────────────────────────
function fcUpdate(dt) {
  const W = fcW(), H = fcH();
  const GROUND = H - 28;

  // Cake physics
  fc.cake.vy += FC.GRAVITY * dt;
  fc.cake.y  += fc.cake.vy  * dt;

  // Clouds
  fc.clouds.forEach(c => {
    c.x -= c.speed * dt;
    if (c.x + c.r * 2 < 0) c.x = W + c.r;
  });

  // Particles
  fc.particles = fc.particles.filter(p => {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 600 * dt;
    p.life -= dt * 2.5;
    return p.life > 0;
  });

  // Pipes
  for (let i = fc.pipes.length - 1; i >= 0; i--) {
    fc.pipes[i].x -= FC.SPEED * dt;

    // Spawn next pipe
    if (i === fc.pipes.length - 1 && fc.pipes[i].x < W - FC.PIPE_DIST) fcSpawnPipe();

    // Score
    if (!fc.pipes[i].passed && fc.pipes[i].x + FC.PIPE_W < fc.cake.x) {
      fc.pipes[i].passed = true;
      fc.score++;
      document.getElementById('flappy-score').textContent = fc.score;
      if (fc.score > fc.best) {
        fc.best = fc.score;
        localStorage.setItem('flappy_best2', fc.best);
        document.getElementById('flappy-best').textContent = fc.best;
      }
      // Score burst
      for (let j = 0; j < 12; j++) {
        const ang = (j / 12) * Math.PI * 2;
        fc.particles.push({
          x: fc.pipes[i].x + FC.PIPE_W / 2,
          y: fc.pipes[i].topH + FC.GAP / 2,
          vx: Math.cos(ang) * (80 + Math.random() * 100),
          vy: Math.sin(ang) * (80 + Math.random() * 100),
          life: 1, size: 5 + Math.random() * 5,
          color: j % 2 === 0 ? '#f7c948' : '#d61f37',
        });
      }
    }

    // Remove off-screen
    if (fc.pipes[i].x + FC.PIPE_W < 0) { fc.pipes.splice(i, 1); continue; }

    // Collision
    const botY = fc.pipes[i].topH + FC.GAP;
    const r = FC.CAKE_R - 4;
    if (
      fc.cake.x + r > fc.pipes[i].x &&
      fc.cake.x - r < fc.pipes[i].x + FC.PIPE_W &&
      (fc.cake.y - r < fc.pipes[i].topH || fc.cake.y + r > botY)
    ) { fcDie(); return; }
  }

  // Floor / ceiling
  if (fc.cake.y + FC.CAKE_R > GROUND || fc.cake.y - FC.CAKE_R < 0) fcDie();
}

function fcDie() {
  fc.state = 'dead';
  // Explosion particles
  for (let i = 0; i < 20; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 100 + Math.random() * 250;
    fc.particles.push({
      x: fc.cake.x, y: fc.cake.y,
      vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - 100,
      life: 1, size: 6 + Math.random() * 8,
      color: ['#f7c948','#d61f37','#ff6b8a','#fff'][Math.floor(Math.random()*4)],
    });
  }
}

// ─ Draw ─────────────────────────────────────────────
function fcDraw() {
  const ctx = fc.ctx;
  const W = fcW(), H = fcH();
  const GROUND = H - 28;

  // Sky gradient
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0,   '#e8f4fd');
  sky.addColorStop(0.6, '#fdf0f8');
  sky.addColorStop(1,   '#fde8ec');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Clouds
  fc.clouds.forEach(c => {
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(255,255,255,0.9)';
    ctx.shadowBlur = 10;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -0.5; dy <= 0.5; dy += 0.5) {
        ctx.beginPath();
        ctx.arc(c.x + dx * c.r * 0.6, c.y + dy * c.r * 0.4, c.r * (0.7 + Math.abs(dx)*0.1), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  });

  // Pipes
  fc.pipes.forEach(p => {
    const botY = p.topH + FC.GAP;
    const capH = 18, capW = FC.PIPE_W + 12, capX = p.x - 6, r = 8;

    // Top pipe body
    const gTop = ctx.createLinearGradient(p.x, 0, p.x + FC.PIPE_W, 0);
    gTop.addColorStop(0,   '#e8304a');
    gTop.addColorStop(0.4, '#d61f37');
    gTop.addColorStop(1,   '#a8182c');
    ctx.fillStyle = gTop;
    fcRoundRect(ctx, p.x, 0, FC.PIPE_W, p.topH, [0,0,0,0]);
    ctx.fill();

    // Top pipe cap
    const gCap1 = ctx.createLinearGradient(capX, 0, capX + capW, 0);
    gCap1.addColorStop(0, '#f7c948');
    gCap1.addColorStop(1, '#e8a030');
    ctx.fillStyle = gCap1;
    fcRoundRect(ctx, capX, p.topH - capH, capW, capH, [0,0,r,r]);
    ctx.fill();

    // Bottom pipe body
    const gBot = ctx.createLinearGradient(p.x, 0, p.x + FC.PIPE_W, 0);
    gBot.addColorStop(0,   '#e8304a');
    gBot.addColorStop(0.4, '#d61f37');
    gBot.addColorStop(1,   '#a8182c');
    ctx.fillStyle = gBot;
    fcRoundRect(ctx, p.x, botY, FC.PIPE_W, H - botY, [0,0,0,0]);
    ctx.fill();

    // Bottom pipe cap
    const gCap2 = ctx.createLinearGradient(capX, 0, capX + capW, 0);
    gCap2.addColorStop(0, '#f7c948');
    gCap2.addColorStop(1, '#e8a030');
    ctx.fillStyle = gCap2;
    fcRoundRect(ctx, capX, botY, capW, capH, [r,r,0,0]);
    ctx.fill();

    // Highlight stripe on pipes
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#fff';
    ctx.fillRect(p.x + 6, 0, 8, p.topH);
    ctx.fillRect(p.x + 6, botY, 8, H - botY);
    ctx.restore();
  });

  // Ground
  const gnd = ctx.createLinearGradient(0, GROUND, 0, H);
  gnd.addColorStop(0, '#d61f37');
  gnd.addColorStop(1, '#a8182c');
  ctx.fillStyle = gnd;
  ctx.fillRect(0, GROUND, W, H - GROUND);
  // Ground stripe
  ctx.fillStyle = '#f7c948';
  ctx.fillRect(0, GROUND, W, 3);

  // Particles
  fc.particles.forEach(p => {
    ctx.save();
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  // Cake
  if (fc.state !== 'dead') {
    ctx.save();
    ctx.translate(fc.cake.x, fc.cake.y);
    const angle = Math.max(-0.45, Math.min(0.45, fc.cake.vy * 0.0012));
    ctx.rotate(angle);
    // Glow
    ctx.shadowColor = 'rgba(247,201,72,0.7)';
    ctx.shadowBlur = 18;
    ctx.font = `${FC.CAKE_R * 2.1}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎂', 0, 0);
    ctx.restore();
  }

  // ── Overlays ────────────────────────────────────
  if (fc.state === 'idle') {
    fcDrawCard(ctx, W, H,
      '🎂', 'Flappy Cake',
      'Тапните чтобы начать!', null
    );
  }

  if (fc.state === 'dead') {
    fcDrawCard(ctx, W, H,
      '💥', 'Игра окончена',
      `Счёт: ${fc.score}`,
      fc.score >= fc.best && fc.score > 0 ? '🏆 Новый рекорд!' : `Рекорд: ${fc.best}`
    );
  }
}

function fcRoundRect(ctx, x, y, w, h, radii) {
  const [tl, tr, br, bl] = radii;
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
  ctx.lineTo(x, y + tl);
  ctx.quadraticCurveTo(x, y, x + tl, y);
  ctx.closePath();
}

function fcDrawCard(ctx, W, H, icon, title, line1, line2) {
  const cw = 220, ch = line2 ? 150 : 130;
  const cx = (W - cw) / 2, cy = (H - ch) / 2;

  // Backdrop blur simulation
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#1a0010';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // Card
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 24;
  ctx.fillStyle = '#fff';
  fcRoundRect(ctx, cx, cy, cw, ch, [20,20,20,20]);
  ctx.fill();
  ctx.restore();

  // Accent top bar
  const grad = ctx.createLinearGradient(cx, cy, cx + cw, cy);
  grad.addColorStop(0, '#d61f37');
  grad.addColorStop(1, '#e8a030');
  ctx.fillStyle = grad;
  fcRoundRect(ctx, cx, cy, cw, 5, [20,20,0,0]);
  ctx.fill();

  ctx.textAlign = 'center';

  // Icon
  ctx.font = '28px serif';
  ctx.fillText(icon, W / 2, cy + 36);

  // Title
  ctx.fillStyle = '#111';
  ctx.font = 'bold 17px Inter, sans-serif';
  ctx.fillText(title, W / 2, cy + 68);

  // Line 1
  ctx.fillStyle = '#d61f37';
  ctx.font = 'bold 15px Inter, sans-serif';
  ctx.fillText(line1, W / 2, cy + 92);

  // Line 2
  if (line2) {
    ctx.fillStyle = '#e8a030';
    ctx.font = '13px Inter, sans-serif';
    ctx.fillText(line2, W / 2, cy + 114);
  }

  // Hint
  ctx.fillStyle = '#999';
  ctx.font = '12px Inter, sans-serif';
  ctx.fillText('Нажмите для продолжения', W / 2, cy + ch - 14);
}

// ─ Loop ─────────────────────────────────────────────
function fcLoop(ts) {
  fc.raf = requestAnimationFrame(fcLoop);
  const dt = Math.min((ts - fc.lastTime) / 1000, 0.05); // cap at 50ms
  fc.lastTime = ts;

  if (fc.state === 'playing' || fc.state === 'dead') {
    if (fc.state === 'playing') fcUpdate(dt);
    else {
      // keep particles alive after death
      fc.particles = fc.particles.filter(p => {
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vy += 600 * dt; p.life -= dt * 1.8;
        return p.life > 0;
      });
      fc.clouds.forEach(c => {
        c.x -= c.speed * dt;
        if (c.x + c.r * 2 < 0) c.x = fcW() + c.r;
      });
    }
  }

  fcDraw();
}

// ─ Auto-init ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initMemory();

  const observer = new MutationObserver(() => {
    const canvas = document.getElementById('flappy-canvas');
    if (canvas && canvas.offsetParent !== null && !fc.cvs) flappyInit();
  });
  const funTab = document.getElementById('tab-fun');
  if (funTab) observer.observe(funTab, { attributes: true, attributeFilter: ['class'] });

  // Pause when page hidden
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flappyStop();
    else if (fc.cvs && fc.state !== 'idle') {
      fc.lastTime = performance.now();
      if (!fc.raf) fcLoop(fc.lastTime);
    }
  });
});

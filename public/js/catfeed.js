/* ── «Накорми Котика» 2.0 — на движке Phaser 3 ────────────────────────────────
 * 60-сек фрэнзи с настоящей сочностью: частицы (сердечки/искры/крошки) с физикой,
 * свечение кота, тряска экрана + вспышка на комбо, плавный squash, смена póz
 * (рот→жуёт→рад). Очки → звёзды (cat_feed). Phaser грузится лениво при открытии.
 * Ассеты: /assets/images/cat/{idle,open,chew,happy,hungry,full}.png + bakery-bg.jpg
 * ───────────────────────────────────────────────────────────────────────────── */
(function () {
  const GAME_KEY = 'cat_feed';
  const DUR = 60;
  const ASSET = (s) => `/assets/images/cat/${s}.png`;
  const STATES = ['idle', 'open', 'chew', 'happy', 'hungry', 'full'];

  let root, game, pies = [];     // pies: [{key,name,id}]
  let best = 0;
  let audio;

  // ── Звук (WebAudio-синтез, без файлов) ───────────────────────────────────────
  function ac() { if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {} } return audio; }
  function tone(f, d, t, g, slide) { const a = ac(); if (!a) return; const o = a.createOscillator(), gn = a.createGain(); o.type = t || 'sine'; o.frequency.value = f; if (slide) o.frequency.exponentialRampToValueAtTime(slide, a.currentTime + d); gn.gain.value = g || 0.16; gn.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + d); o.connect(gn); gn.connect(a.destination); o.start(); o.stop(a.currentTime + d); }
  function sfxChomp() { const a = ac(); if (!a) return; const buf = a.createBuffer(1, a.sampleRate * 0.12, a.sampleRate); const ch = buf.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 2); const s = a.createBufferSource(); s.buffer = buf; const g = a.createGain(); g.gain.value = 0.25; g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.12); const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; s.connect(f); f.connect(g); g.connect(a.destination); s.start(); tone(180, 0.1, 'sine', 0.12, 90); }
  function sfxHappy() { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'triangle', 0.15), i * 70)); }
  function sfxGold() { [659, 880, 1047, 1319].forEach((f, i) => setTimeout(() => tone(f, 0.2, 'triangle', 0.17), i * 55)); }
  function sfxPop() { tone(440, 0.07, 'square', 0.1, 720); }

  // ── Ленивая загрузка Phaser ───────────────────────────────────────────────────
  function lazyPhaser() {
    return new Promise((res, rej) => {
      if (window.Phaser) return res();
      const s = document.createElement('script');
      s.src = '/js/vendor/phaser.min.js';
      s.onload = () => res(); s.onerror = () => rej(new Error('phaser load failed'));
      document.head.appendChild(s);
    });
  }
  async function loadCatalogPies() {
    if (pies.length) return;
    try {
      const r = await fetch('/api/catalog/products?limit=24');
      const d = await r.json();
      const picks = (d.products || []).filter(p => p.image).slice(0, 8);
      pies = picks.map((p, i) => ({ key: 'pie' + i, url: '/img?u=' + encodeURIComponent(p.image), name: p.name, id: p.id }));
    } catch (_) {}
  }

  // ── Сцена ─────────────────────────────────────────────────────────────────────
  function makeScene() {
    return class FeedScene extends Phaser.Scene {
      constructor() { super('feed'); }
      preload() {
        this.load.image('bg', '/assets/images/cat/bakery-bg.jpg');
        STATES.forEach(s => this.load.image(s, ASSET(s)));
        pies.forEach(p => this.load.image(p.key, p.url));
      }
      create() {
        const W = this.scale.width, H = this.scale.height;
        this.st = { score: 0, combo: 0, lastFeed: -9999, fed: 0, running: false, tEnd: 0 };

        // фон cover
        const bg = this.add.image(W / 2, H / 2, 'bg');
        const bs = Math.max(W / bg.width, H / bg.height); bg.setScale(bs);
        this.add.rectangle(W / 2, H / 2, W, H, 0x3a1f0a, 0.12);
        this.bg = bg;

        // текстуры частиц из эмодзи
        this.makeEmojiTexture('heart', '❤️');
        this.makeEmojiTexture('star', '⭐');
        this.makeEmojiTexture('spark', '✨');
        this.makeCrumbTexture('crumb');

        // свечение под котом (аддитивное)
        this.glow = this.add.image(W / 2, H * 0.46, 'spark').setScale(10).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD).setTint(0xffcf6a);

        // кот
        this.catBaseY = H * 0.46;
        this.cat = this.add.image(W / 2, this.catBaseY, 'idle');
        const cw = Math.min(W * 0.5, 240); this.catScale = cw / this.cat.width;
        this.cat.setScale(this.catScale);
        this.tweens.add({ targets: this.cat, scaleY: this.catScale * 0.97, scaleX: this.catScale * 1.02, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

        // ambient искры
        this.add.particles(0, 0, 'spark', { x: { min: 0, max: W }, y: H + 10, lifespan: 4000, speedY: { min: -25, max: -60 }, scale: { start: 0.25, end: 0 }, alpha: { start: 0.5, end: 0 }, frequency: 350, blendMode: 'ADD' });

        // эмиттеры эффектов кормления
        this.pHeart = this.add.particles(0, 0, 'heart', { lifespan: 900, speed: { min: 60, max: 180 }, angle: { min: 230, max: 310 }, gravityY: -40, scale: { start: 0.7, end: 0 }, alpha: { start: 1, end: 0 }, rotate: { min: -40, max: 40 }, emitting: false });
        this.pCrumb = this.add.particles(0, 0, 'crumb', { lifespan: 700, speed: { min: 80, max: 220 }, angle: { min: 250, max: 290 }, gravityY: 600, scale: { start: 1, end: 0.4 }, alpha: { start: 1, end: 0 }, emitting: false });
        this.pStar = this.add.particles(0, 0, 'star', { lifespan: 1000, speed: { min: 100, max: 260 }, scale: { start: 0.9, end: 0 }, alpha: { start: 1, end: 0 }, blendMode: 'ADD', emitting: false });

        // UI
        this.scoreT = this.add.text(W / 2, 64, '0', { fontFamily: 'Arial', fontSize: '40px', fontStyle: '900', color: '#ffffff' }).setOrigin(0.5).setShadow(0, 3, 'rgba(0,0,0,.45)', 6);
        this.timeT = this.add.text(W - 16, 22, '0:60', { fontFamily: 'Arial', fontSize: '22px', fontStyle: '900', color: '#ffffff' }).setOrigin(1, 0).setShadow(0, 2, 'rgba(0,0,0,.4)', 4);
        this.barBg = this.add.rectangle(16, 30, W - 120, 12, 0xffffff, 0.5).setOrigin(0, 0.5);
        this.bar = this.add.rectangle(16, 30, W - 120, 12, 0xff9d33).setOrigin(0, 0.5);
        this.comboT = this.add.text(W / 2, H * 0.32, '', { fontFamily: 'Arial', fontSize: '34px', fontStyle: '900', color: '#ffd23f' }).setOrigin(0.5).setShadow(0, 3, 'rgba(0,0,0,.5)', 6).setAlpha(0);
        this.hintT = this.add.text(W / 2, H - 150, 'Тащи пироги Котику в рот! 🐱', { fontFamily: 'Arial', fontSize: '15px', color: '#ffffff', fontStyle: '700' }).setOrigin(0.5).setShadow(0, 2, 'rgba(0,0,0,.4)', 4);

        // тарелка
        this.plateY = H - 70;
        this.plate = [];
        this.input.on('drag', (p, obj, dx, dy) => { obj.x = dx; obj.y = dy; });
        this.input.on('dragend', (p, obj) => this.onDrop(obj));

        // отсчёт
        this.countdown(() => { this.st.running = true; this.st.tEnd = this.time.now + DUR * 1000; this.fillPlate(); });
        window._cfScene = this; // dev/test hook
      }

      makeEmojiTexture(key, ch) { if (this.textures.exists(key)) return; const c = document.createElement('canvas'); c.width = c.height = 56; const x = c.getContext('2d'); x.font = '46px serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(ch, 28, 30); this.textures.addCanvas(key, c); }
      makeCrumbTexture(key) { if (this.textures.exists(key)) return; const c = document.createElement('canvas'); c.width = c.height = 12; const x = c.getContext('2d'); x.fillStyle = '#c98a4a'; x.beginPath(); x.arc(6, 6, 5, 0, 7); x.fill(); this.textures.addCanvas(key, c); }

      countdown(done) {
        const W = this.scale.width, H = this.scale.height;
        const t = this.add.text(W / 2, H / 2, '3', { fontFamily: 'Arial', fontSize: '120px', fontStyle: '900', color: '#fff' }).setOrigin(0.5).setShadow(0, 4, 'rgba(0,0,0,.5)', 12).setDepth(50);
        let n = 3;
        const step = () => {
          t.setText(n > 0 ? String(n) : 'НЯМ!'); t.setScale(0.5); t.setAlpha(1);
          this.tweens.add({ targets: t, scale: 1.2, duration: 400, ease: 'Back.out' });
          this.tweens.add({ targets: t, alpha: 0, delay: 350, duration: 300 });
          n > 0 ? sfxPop() : sfxHappy();
          if (n > 0) { n--; this.time.delayedCall(700, step); }
          else this.time.delayedCall(450, () => { t.destroy(); done(); });
        };
        step();
      }

      fillPlate() { while (this.plate.length < 4) this.addPie(); }
      addPie() {
        const W = this.scale.width;
        const slots = this.plate.length;
        const gold = Math.random() < 0.12;
        const key = pies.length ? pies[(Math.random() * pies.length) | 0].key : null;
        let pie;
        if (key) { pie = this.add.image(0, this.plateY, key); pie.setScale(64 / Math.max(pie.width, pie.height)); }
        else { pie = this.add.text(0, this.plateY, '🥧', { fontSize: '46px' }).setOrigin(0.5); }
        pie.gold = gold;
        if (gold) { pie.setTint ? pie.setTint(0xfff0b0) : 0; this.tweens.add({ targets: pie, angle: 8, duration: 500, yoyo: true, repeat: -1 }); }
        // позиция: ряд внизу
        const n = this.plate.length + 1;
        pie.setData('home', true);
        pie.setInteractive({ draggable: true, useHandCursor: true });
        this.input.setDraggable(pie);
        this.plate.push(pie);
        this.layoutPlate();
        // лёгкое появление
        pie.setScale((pie.scaleX || 1) * 0.2); this.tweens.add({ targets: pie, scaleX: pie.scaleX / 0.2, scaleY: pie.scaleY / 0.2, duration: 250, ease: 'Back.out' });
        return pie;
      }
      layoutPlate() {
        const W = this.scale.width; const gap = 78; const startX = W / 2 - (this.plate.length - 1) * gap / 2;
        this.plate.forEach((p, i) => { if (!p.dragging) { p.x = startX + i * gap; p.y = this.plateY; } });
      }

      onDrop(obj) {
        if (!this.st.running) { this.returnPie(obj); return; }
        const d = Phaser.Math.Distance.Between(obj.x, obj.y, this.cat.x, this.cat.y - this.cat.displayHeight * 0.15);
        if (d < this.cat.displayWidth * 0.55) { this.feed(obj.gold, obj.x, obj.y); this.plate = this.plate.filter(p => p !== obj); obj.destroy(); this.fillPlate(); }
        else this.returnPie(obj);
      }
      returnPie(obj) { this.tweens.add({ targets: obj, x: obj.x, duration: 1 }); this.layoutPlate(); }

      feed(gold, x, y) {
        const now = this.time.now;
        this.st.combo = (now - this.st.lastFeed < 1500) ? this.st.combo + 1 : 1;
        this.st.lastFeed = now; this.st.fed++;
        const gain = (gold ? 50 : 10) * this.st.combo;
        this.st.score += gain;
        this.scoreT.setText(String(this.st.score));
        this.popText(this.scoreT, 1.25);

        // кот ест: рот → жуёт → рад
        this.cat.setTexture('open'); gold ? sfxGold() : sfxChomp(); window.haptic?.('light');
        this.squash();
        const mx = this.cat.x, my = this.cat.y - this.cat.displayHeight * 0.12;
        this.pHeart.emitParticleAt(mx, my, gold ? 14 : 7);
        this.pCrumb.emitParticleAt(mx, my, 6);
        if (gold) this.pStar.emitParticleAt(mx, my, 16);
        this.glowPulse(gold);
        this.time.delayedCall(150, () => this.cat.setTexture('chew'));
        this.time.delayedCall(400, () => { this.cat.setTexture('happy'); if (this.st.combo >= 3 || gold) sfxHappy(); });
        this.time.delayedCall(900, () => { if (this.st.running) this.cat.setTexture('idle'); });

        // комбо-эскалация
        if (this.st.combo >= 2) {
          this.comboT.setText('x' + this.st.combo + ' комбо!'); this.popText(this.comboT, 1.3, true); sfxPop();
          const k = Math.min(this.st.combo, 8);
          this.cameras.main.shake(120 + k * 15, 0.002 + k * 0.0007);
          if (this.st.combo >= 4) this.cameras.main.flash(120, 255, 240, 180);
          if (this.st.combo >= 4) this.pStar.emitParticleAt(mx, my, this.st.combo * 2);
        }
      }
      squash() {
        this.tweens.killTweensOf(this.cat);
        const b = this.catScale;
        this.cat.setScale(b);
        this.tweens.add({ targets: this.cat, scaleX: b * 1.18, scaleY: b * 0.85, duration: 110, yoyo: true, ease: 'Quad.out', onComplete: () => { this.cat.setScale(b); this.tweens.add({ targets: this.cat, scaleY: b * 0.97, scaleX: b * 1.02, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.inOut' }); } });
      }
      glowPulse(gold) { this.glow.setPosition(this.cat.x, this.cat.y).setTint(gold ? 0xffe07a : 0xffcf6a); this.tweens.killTweensOf(this.glow); this.glow.setAlpha(0.55).setScale(6); this.tweens.add({ targets: this.glow, alpha: 0, scale: 12, duration: 500, ease: 'Quad.out' }); }
      popText(t, sc, fade) { this.tweens.killTweensOf(t); if (fade) { t.setAlpha(1); t.y = this.scale.height * 0.32; t.setScale(0.6); this.tweens.add({ targets: t, scale: sc, duration: 180, ease: 'Back.out' }); this.tweens.add({ targets: t, alpha: 0, y: t.y - 40, delay: 250, duration: 450 }); } else { const base = 1; t.setScale(sc); this.tweens.add({ targets: t, scale: base, duration: 200, ease: 'Quad.out' }); } }

      update() {
        if (!this.st.running) return;
        const left = Math.max(0, (this.st.tEnd - this.time.now) / 1000);
        this.timeT.setText('0:' + String(Math.ceil(left)).padStart(2, '0'));
        this.bar.width = (this.scale.width - 120) * (left / DUR);
        // лёгкий параллакс фона по времени
        this.bg.y = this.scale.height / 2 + Math.sin(this.time.now / 1800) * 4;
        if (left <= 0) this.endGame();
      }

      async endGame() {
        this.st.running = false;
        this.cat.setTexture('full'); sfxHappy(); window.haptic?.('success');
        const isRec = this.st.score > best; if (isRec) best = this.st.score;
        window._cfResult = { score: this.st.score, fed: this.st.fed, best, isRec };
        showResult();
      }
    };
  }

  // ── HTML-оверлей (close + результат) ─────────────────────────────────────────
  function ensureStyles() {
    if (document.getElementById('cf2-css')) return;
    const s = document.createElement('style'); s.id = 'cf2-css';
    s.textContent = `
      .cf2-root{position:fixed;inset:0;z-index:9999;display:none;background:#f3e2cf}
      .cf2-root.on{display:block}
      .cf2-root canvas{display:block}
      .cf2-x{position:absolute;top:12px;left:12px;z-index:3;width:38px;height:38px;border:none;border-radius:50%;background:rgba(0,0,0,.28);color:#fff;font-size:20px;cursor:pointer}
      .cf2-panel{position:absolute;inset:0;z-index:5;display:none;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:26px;text-align:center;background:rgba(40,20,8,.55);backdrop-filter:blur(3px)}
      .cf2-panel.on{display:flex}
      .cf2-panel h2{margin:0;color:#fff;font-size:28px;font-weight:900;text-shadow:0 3px 8px rgba(0,0,0,.4)}
      .cf2-panel p{margin:0;color:#ffe9d2;font-size:16px}
      .cf2-big{font-size:60px}
      .cf2-btn{border:none;border-radius:16px;padding:14px 28px;font-size:17px;font-weight:800;cursor:pointer;background:#ff7a2d;color:#fff;box-shadow:0 6px 18px rgba(255,122,45,.45)}
      .cf2-btn--g{background:rgba(255,255,255,.92);color:#7a3b12}
      .cf2-row{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
    `;
    document.head.appendChild(s);
  }

  async function showResult() {
    const r = window._cfResult || { score: 0, fed: 0, best: 0, isRec: false };
    let reward = '';
    if (window.App?.isAuthed?.()) {
      try {
        const resp = await fetch('/api/game-result', { method: 'POST', headers: { 'Content-Type': 'application/json', ...App.authHeader() }, body: JSON.stringify({ game: GAME_KEY, score: r.score }) });
        const d = await resp.json();
        if (d.gated) reward = '🔓 Подтверди номер в Профиле — и за игру будут звёзды.';
        else if (d.starsAwarded > 0) reward = `⭐ +${d.starsAwarded}${d.capped ? ' (дневной лимит)' : ''}`;
        else if (d.capped) reward = '⭐ Дневной лимит звёзд достигнут — рекорд засчитан!';
        if (typeof d.balance?.stars === 'number') reward += (reward ? ' · ' : '') + `всего ⭐ ${d.balance.stars}`;
      } catch (_) {}
    } else reward = 'Открой через приложение «Марии» — и получай звёзды за рекорды.';
    const panel = root.querySelector('.cf2-panel');
    panel.innerHTML = `
      <div class="cf2-big">${r.isRec ? '🏆' : '😻'}</div>
      <h2>${r.isRec ? 'Новый рекорд!' : 'Вкусно!'}</h2>
      <p>Котик объелся на <b>${r.score}</b> очков (${r.fed} пирогов)${r.best ? ` · рекорд ${r.best}` : ''}.</p>
      ${reward ? `<p style="color:#ffd23f;font-weight:800">${reward}</p>` : ''}
      <div class="cf2-row"><button class="cf2-btn" id="cf2-again">Ещё раз 🍰</button><button class="cf2-btn cf2-btn--g" id="cf2-share">Похвастаться</button></div>
      <div class="cf2-row"><button class="cf2-btn cf2-btn--g" id="cf2-close2">В меню</button></div>`;
    panel.classList.add('on');
    panel.querySelector('#cf2-again').onclick = () => { panel.classList.remove('on'); restart(); };
    panel.querySelector('#cf2-close2').onclick = close;
    panel.querySelector('#cf2-share').onclick = () => { const link = window.App?.appLink?.() || 'https://t.me/mariatortik_bot'; const txt = `Я накормил Котика на ${r.score} очков в игре кондитерской «Мария» 🐱🍰 Побей мой рекорд! ${link}`; if (window.App?.share) App.share(txt); else if (navigator.share) navigator.share({ text: txt }).catch(() => {}); };
  }

  function restart() { if (game) { game.scene.stop('feed'); game.scene.start('feed'); } }

  // ── Публичный API ─────────────────────────────────────────────────────────────
  async function open() {
    ensureStyles();
    if (!root) {
      root = document.createElement('div'); root.className = 'cf2-root';
      root.innerHTML = `<button class="cf2-x">×</button><div class="cf2-panel"></div>`;
      document.body.appendChild(root);
      root.querySelector('.cf2-x').onclick = close;
    }
    root.classList.add('on'); window.scrollLock?.();
    ac();
    try { await lazyPhaser(); } catch (e) { alert('Не удалось загрузить игру, попробуй ещё раз'); close(); return; }
    await loadCatalogPies();
    root.querySelector('.cf2-panel').classList.remove('on');
    if (game) { game.destroy(true); game = null; }
    game = new Phaser.Game({
      type: Phaser.AUTO, parent: root, transparent: false, backgroundColor: '#f3e2cf',
      scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
      scene: makeScene(),
    });
  }
  function close() { if (game) { game.destroy(true); game = null; } if (root) root.classList.remove('on'); window.scrollUnlock?.(); }
  window.catFeedOpen = open;
  window.catFeedClose = close;
})();

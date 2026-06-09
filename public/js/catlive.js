/* ── ТЕСТ «живого» кота на видео ──────────────────────────────────────────────
 * Полноэкранный зацикленный клип кота. Тык по коту → подпрыгивает + мурчит (звук)
 * + сердечки. Проверяем, читается ли «живость» (image-to-video подход без аниматора).
 * ───────────────────────────────────────────────────────────────────────────── */
(function () {
  let ov, vid, audio;

  function ac() { if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {} } return audio; }
  function purr() {
    const a = ac(); if (!a) return;
    // низкое «мурчание»: пульсирующий низкий тон
    const o = a.createOscillator(), g = a.createGain(), lfo = a.createOscillator(), lg = a.createGain();
    o.type = 'sawtooth'; o.frequency.value = 55;
    lfo.frequency.value = 26; lg.gain.value = 18; lfo.connect(lg); lg.connect(o.frequency);
    g.gain.value = 0.0001; g.gain.exponentialRampToValueAtTime(0.13, a.currentTime + 0.06); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 1.1);
    const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320;
    o.connect(f); f.connect(g); g.connect(a.destination); lfo.start(); o.start(); o.stop(a.currentTime + 1.15); lfo.stop(a.currentTime + 1.15);
  }
  function meow() { const a = ac(); if (!a) return;[ [620, 0], [520, 0.12] ].forEach(([fr, d]) => setTimeout(() => { const o = a.createOscillator(), g = a.createGain(); o.type = 'triangle'; o.frequency.value = fr; o.frequency.exponentialRampToValueAtTime(fr * 0.8, a.currentTime + 0.18); g.gain.value = 0.12; g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.22); o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + 0.24); }, d * 1000)); }

  function styles() {
    if (document.getElementById('catlive-css')) return;
    const s = document.createElement('style'); s.id = 'catlive-css';
    s.textContent = `
      .cl-ov{position:fixed;inset:0;z-index:9999;display:none;background:#1a1109;overflow:hidden;touch-action:manipulation}
      .cl-ov.on{display:block}
      .cl-vid{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform-origin:bottom center;transition:transform .12s}
      .cl-vid.bounce{animation:clBounce .5s ease-out}
      @keyframes clBounce{0%{transform:scale(1)}25%{transform:scale(1.05,.94)}55%{transform:scale(.99,1.02)}100%{transform:scale(1)}}
      .cl-x{position:absolute;top:12px;right:12px;z-index:5;width:38px;height:38px;border:none;border-radius:50%;background:rgba(0,0,0,.4);color:#fff;font-size:20px;cursor:pointer}
      .cl-hint{position:absolute;left:0;right:0;bottom:34px;text-align:center;color:#fff;font-weight:800;font-size:16px;text-shadow:0 2px 6px rgba(0,0,0,.6);z-index:4;pointer-events:none}
      .cl-fx{position:absolute;inset:0;z-index:4;pointer-events:none;overflow:hidden}
      .cl-tag{position:absolute;top:12px;left:12px;z-index:5;background:rgba(0,0,0,.4);color:#ffd23f;font-weight:800;font-size:12px;padding:6px 10px;border-radius:10px}
    `;
    document.head.appendChild(s);
  }

  function build() {
    styles();
    ov = document.createElement('div'); ov.className = 'cl-ov';
    ov.innerHTML = `
      <video class="cl-vid" id="cl-vid" src="/assets/cat-clips/idle.mp4" muted loop playsinline preload="auto"></video>
      <div class="cl-fx" id="cl-fx"></div>
      <div class="cl-tag">🎬 тест «живого» кота</div>
      <button class="cl-x" id="cl-x">×</button>
      <div class="cl-hint">Погладь котика — потрогай его 🐾</div>
    `;
    document.body.appendChild(ov);
    vid = ov.querySelector('#cl-vid');
    ov.querySelector('#cl-x').onclick = close;
    const onTap = (e) => {
      ac();
      vid.classList.remove('bounce'); void vid.offsetWidth; vid.classList.add('bounce');
      purr(); if (Math.random() < 0.5) meow();
      window.haptic?.('light');
      const r = ov.getBoundingClientRect();
      hearts((e.clientX || r.width / 2), (e.clientY || r.height / 2));
    };
    vid.addEventListener('pointerdown', onTap);
  }

  function hearts(x, y) {
    const fx = ov.querySelector('#cl-fx');
    for (let i = 0; i < 7; i++) {
      const h = document.createElement('div');
      h.textContent = ['❤️', '💛', '😻'][i % 3];
      h.style.cssText = 'position:absolute;font-size:26px;pointer-events:none;transition:transform 1.1s ease-out,opacity 1.1s';
      h.style.left = (x - 14) + 'px'; h.style.top = (y - 14) + 'px';
      fx.appendChild(h);
      requestAnimationFrame(() => { h.style.transform = `translate(${(Math.random() - .5) * 120}px,-${90 + Math.random() * 80}px) scale(${0.8 + Math.random() * 0.7})`; h.style.opacity = '0'; });
      setTimeout(() => h.remove(), 1200);
    }
  }

  function open() {
    if (!ov) build();
    ov.classList.add('on'); window.scrollLock?.();
    vid.currentTime = 0; const pr = vid.play(); if (pr && pr.catch) pr.catch(() => {});
  }
  function close() { if (vid) vid.pause(); if (ov) ov.classList.remove('on'); window.scrollUnlock?.(); }
  window.catLiveOpen = open;
  window.catLiveClose = close;
})();

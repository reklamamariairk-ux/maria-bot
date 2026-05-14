/* ── Game zone: Wheel + Streak + Secret-of-day ────────────────────────────── */

const _gameAuth = () => {
  const tg = window.Telegram?.WebApp;
  return tg?.initData ? { Authorization: 'tma ' + tg.initData } : null;
};

/* ── Streak ──────────────────────────────────────────────────────────────── */
async function streakInit() {
  const card = document.getElementById('streak-card');
  if (!card) return;
  const auth = _gameAuth();
  if (!auth) return;
  // Touch — отметить визит (idempotent)
  try {
    const r = await fetch('/api/streak/touch', { method: 'POST', headers: auth });
    if (!r.ok) return;
    const data = await r.json();
    renderStreak(data.currentStreak || 0);
    if (data.reachedReward) {
      window.haptic?.('success');
      setTimeout(() => alert('🎉 Streak 7 дней! Бесплатный десерт ждёт в твоих наградах.'), 600);
    }
  } catch {}
}
function renderStreak(cur) {
  const card = document.getElementById('streak-card');
  if (!card) return;
  card.style.display = '';
  const cntEl = document.getElementById('streak-day-cnt');
  if (cntEl) cntEl.textContent = String(cur);
  const dotsEl = document.getElementById('streak-dots');
  if (dotsEl) {
    dotsEl.innerHTML = Array.from({ length: 7 }).map((_, i) =>
      `<span class="streak-dot${i < cur ? ' streak-dot--on' : ''}${i === cur - 1 ? ' streak-dot--cur' : ''}">${i + 1}</span>`
    ).join('');
  }
  const hintEl = document.getElementById('streak-hint');
  if (hintEl) {
    if (cur >= 7) hintEl.textContent = '🎉 Streak 7 дней — десерт твой!';
    else if (cur >= 5) hintEl.textContent = `Ещё ${7 - cur} ${7 - cur === 1 ? 'день' : 'дня'} — и десерт твой`;
    else hintEl.textContent = 'Заходи 7 дней подряд — бесплатный десерт';
  }
}
window.streakInit = streakInit;

/* ── Secret of the Day ───────────────────────────────────────────────────── */
async function secretOfDayInit() {
  const card = document.getElementById('secret-card');
  if (!card) return;
  try {
    const r = await fetch('/api/secret-of-day', { cache: 'no-store' });
    const d = await r.json();
    const s = d?.secret;
    if (!s || !s.product) return;
    const product = s.product;
    const price = Number(product.priceNumber || product.price) || 0;
    const discounted = Math.round(price * (100 - s.discountPct) / 100);
    const img = product.image
      ? `<img src="/img?u=${encodeURIComponent(product.image)}" alt="" loading="lazy"/>`
      : `<span class="secret-card__ph">🎂</span>`;
    document.getElementById('secret-card-body').innerHTML = `
      <div class="secret-card__img">${img}</div>
      <div class="secret-card__txt">
        <div class="secret-card__name">${String(product.name || '').replace(/</g,'&lt;')}</div>
        <div class="secret-card__price">
          <span class="secret-card__old">${price.toLocaleString('ru-RU')} ₽</span>
          <span class="secret-card__new">${discounted.toLocaleString('ru-RU')} ₽</span>
          <span class="secret-card__off">−${s.discountPct}%</span>
        </div>
      </div>
      <button class="secret-card__cta" onclick="event.stopPropagation();catOpenProduct?.(${product.id})">→</button>`;
    card.style.display = '';
    // Live countdown
    secretCountdown(s.expiresAt);
    window._secretProductId = product.id;
  } catch (e) { console.warn('[secret-of-day]', e); }
}
function secretCountdown(expiresIso) {
  const el = document.getElementById('secret-card-count');
  if (!el) return;
  const tick = () => {
    const left = new Date(expiresIso).getTime() - Date.now();
    if (left <= 0) {
      el.textContent = 'обновится скоро';
      return;
    }
    const h = Math.floor(left / 3600000);
    const m = Math.floor((left % 3600000) / 60000);
    el.textContent = h > 0 ? `до конца дня · ${h}ч ${m}мин` : `остался ${m} мин`;
    setTimeout(tick, 60000);
  };
  tick();
}
function secretOpen() {
  if (window._secretProductId && window.catOpenProduct) {
    window.catOpenProduct(window._secretProductId);
  }
}
window.secretOpen = secretOpen;
window.secretOfDayInit = secretOfDayInit;

/* ── Wheel of Fortune ────────────────────────────────────────────────────── */
let _wheelData = null;

async function wheelStatus() {
  const auth = _gameAuth();
  if (!auth) return null;
  try {
    const r = await fetch('/api/wheel/status', { headers: auth });
    if (!r.ok) return null;
    _wheelData = await r.json();
    const subEl = document.getElementById('wheel-card-sub');
    const btnEl = document.getElementById('wheel-card-btn');
    if (_wheelData.canSpin) {
      if (subEl) subEl.textContent = 'Доступен спин — крути один раз в день';
      if (btnEl) {
        btnEl.textContent = 'Крутить →';
        btnEl.disabled = false;
        btnEl.classList.remove('wheel-card__btn--off');
      }
    } else {
      if (subEl && _wheelData.lastPrize) subEl.textContent = `Сегодня: ${_wheelData.lastPrize.emoji} ${_wheelData.lastPrize.label}`;
      if (btnEl) {
        btnEl.textContent = 'Завтра';
        btnEl.disabled = true;
        btnEl.classList.add('wheel-card__btn--off');
      }
    }
    return _wheelData;
  } catch { return null; }
}
window.wheelStatus = wheelStatus;

async function wheelOpen() {
  if (!_wheelData) await wheelStatus();
  if (!_wheelData) {
    alert('Открой Mini App через @mariatortik_bot чтобы крутить колесо.');
    return;
  }
  let modal = document.getElementById('wheel-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'wheel-modal';
    modal.className = 'wheel-modal';
    modal.style.display = 'none';
    modal.onclick = (e) => { if (e.target === modal) wheelClose(); };
    document.body.appendChild(modal);
  }
  const prizes = _wheelData.prizes || [];
  const segPath = (i, total, r = 140) => {
    const ang = 2 * Math.PI / total;
    const a1 = -Math.PI/2 + i * ang;
    const a2 = -Math.PI/2 + (i + 1) * ang;
    const x1 = (r + Math.cos(a1) * r).toFixed(2);
    const y1 = (r + Math.sin(a1) * r).toFixed(2);
    const x2 = (r + Math.cos(a2) * r).toFixed(2);
    const y2 = (r + Math.sin(a2) * r).toFixed(2);
    return `M${r} ${r} L${x1} ${y1} A${r} ${r} 0 0 1 ${x2} ${y2} Z`;
  };
  const colors = ['#d61f37','#f8a51b','#ec4267','#34c759','#5856d6','#ff9500','#af52de','#0066cc'];
  const segs = prizes.map((p, i) => {
    const ang = 360 / prizes.length;
    const labelAng = -90 + i * ang + ang / 2;
    const labelR = 90;
    const lx = (140 + Math.cos(labelAng * Math.PI / 180) * labelR).toFixed(2);
    const ly = (140 + Math.sin(labelAng * Math.PI / 180) * labelR).toFixed(2);
    return `
      <path d="${segPath(i, prizes.length, 140)}" fill="${colors[i % colors.length]}" stroke="#fff" stroke-width="1.5"/>
      <text x="${lx}" y="${ly}" fill="#fff" font-size="22" text-anchor="middle" dominant-baseline="central">${p.emoji}</text>
    `;
  }).join('');
  modal.innerHTML = `
    <div class="wheel-modal__sheet">
      <button class="wheel-modal__close" onclick="wheelClose()">×</button>
      <div class="wheel-modal__h">🎡 Колесо удачи</div>
      <div class="wheel-modal__sub">Один спин в день · удача каждый раз новая</div>
      <div class="wheel-modal__container">
        <div class="wheel-modal__pointer">▼</div>
        <svg id="wheel-svg" class="wheel-modal__svg" viewBox="0 0 280 280">
          <g id="wheel-rotation">${segs}</g>
          <circle cx="140" cy="140" r="22" fill="#fff" stroke="#d61f37" stroke-width="3"/>
          <text x="140" y="140" text-anchor="middle" dominant-baseline="central" font-size="22">🎂</text>
        </svg>
      </div>
      <button class="btn-full wheel-modal__cta" id="wheel-spin-btn" onclick="wheelSpin()">${_wheelData.canSpin ? 'Крутить →' : 'Уже крутил сегодня'}</button>
      <div class="wheel-modal__result" id="wheel-result"></div>
    </div>`;
  modal.style.display = 'flex';
  window.scrollLock?.();
  if (!_wheelData.canSpin && _wheelData.lastPrize) {
    document.getElementById('wheel-spin-btn').disabled = true;
    const lp = _wheelData.lastPrize;
    document.getElementById('wheel-result').innerHTML = `
      <div class="wheel-result__emoji">${lp.emoji}</div>
      <div class="wheel-result__lbl">${lp.label}</div>
      <div class="wheel-result__sub">Возвращайся завтра за новым спином</div>`;
  }
}
window.wheelOpen = wheelOpen;

function wheelClose() {
  const m = document.getElementById('wheel-modal');
  if (m) m.style.display = 'none';
  window.scrollUnlock?.();
}
window.wheelClose = wheelClose;

async function wheelSpin() {
  const btn = document.getElementById('wheel-spin-btn');
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  btn.textContent = 'Крутится…';
  const auth = _gameAuth();
  if (!auth) { wheelClose(); return; }
  let resp;
  try {
    const r = await fetch('/api/wheel/spin', { method: 'POST', headers: auth });
    resp = await r.json();
  } catch {
    btn.textContent = 'Ошибка — попробуй снова';
    btn.disabled = false;
    return;
  }
  if (resp.alreadySpunToday) {
    btn.textContent = 'Уже крутил';
    btn.disabled = true;
    return;
  }
  const prizes = _wheelData.prizes || [];
  const idx = resp.prizeIndex;
  if (idx < 0 || !prizes[idx]) {
    btn.textContent = 'Ошибка';
    return;
  }
  // Анимация: 5 полных оборотов + позиция на нужном секторе
  const ang = 360 / prizes.length;
  const target = 360 * 5 + (360 - idx * ang - ang / 2);
  const g = document.getElementById('wheel-rotation');
  if (g) {
    g.style.transition = 'transform 4s cubic-bezier(.18, .55, .15, 1)';
    g.style.transformOrigin = '140px 140px';
    g.style.transform = `rotate(${target}deg)`;
  }
  setTimeout(() => {
    window.haptic?.('success');
    const prize = resp.prize;
    document.getElementById('wheel-result').innerHTML = `
      <div class="wheel-result__emoji wheel-result__emoji--anim">${prize.emoji}</div>
      <div class="wheel-result__lbl">${prize.label}</div>
      <div class="wheel-result__sub">${prize.kind === 'nothing' ? 'Не повезло — крутни завтра' : 'Награда добавлена · применится в следующем заказе'}</div>`;
    btn.style.display = 'none';
    setTimeout(wheelStatus, 500);
  }, 4100);
}
window.wheelSpin = wheelSpin;

/* ── Init on app load ─────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    secretOfDayInit();
    streakInit();
    wheelStatus();
  }, 1500);
});

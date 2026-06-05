/* ── Отзывы и рейтинг товаров ─────────────────────────────────────────── */

const REVIEWS_CACHE = {}; // productId → { reviews, stats, mine }
const REVIEWS_BATCH_CACHE = {}; // productId → { count, avg } (для карточек грида)

function reviewsStars(rating, size) {
  const r = Math.round(Number(rating) || 0);
  const px = size || 14;
  let html = '';
  for (let i = 1; i <= 5; i++) {
    const filled = i <= r;
    html += `<span class="rv-star ${filled ? 'rv-star--on' : ''}" style="font-size:${px}px">${filled ? '★' : '☆'}</span>`;
  }
  return html;
}
window.reviewsStars = reviewsStars;

function reviewsFmtAvg(avg) {
  const v = Number(avg) || 0;
  if (v === 0) return '0';
  return v.toFixed(1).replace(/\.0$/, '');
}

function reviewsPluralize(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'отзыв';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'отзыва';
  return 'отзывов';
}

function reviewsRelTime(iso) {
  try {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1)   return 'только что';
    if (diffMin < 60)  return `${diffMin} мин назад`;
    const h = Math.floor(diffMin / 60);
    if (h < 24)        return `${h} ч назад`;
    const days = Math.floor(h / 24);
    if (days < 30)     return `${days} ${days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'} назад`;
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return ''; }
}

async function loadReviews(productId) {
  const pid = Number(productId);
  if (!pid) return null;
  try {
    const r = await fetch(`/api/reviews/${pid}`, {
      headers: { ...App.authHeader() },
      cache: 'no-store',
    });
    if (!r.ok) return null;
    const data = await r.json();
    REVIEWS_CACHE[pid] = data;
    return data;
  } catch (e) {
    console.error('[reviews]', e);
    return null;
  }
}
window.loadReviews = loadReviews;

// Подгружает batch-статистику для списка товаров и кэширует
async function loadReviewsStatsBatch(productIds) {
  const ids = (productIds || []).map(Number).filter((n) => n > 0);
  if (ids.length === 0) return {};
  try {
    const r = await fetch('/api/reviews/stats-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_ids: ids }),
    });
    if (!r.ok) return {};
    const data = await r.json();
    const stats = data?.stats || {};
    for (const [k, v] of Object.entries(stats)) REVIEWS_BATCH_CACHE[k] = v;
    return stats;
  } catch { return {}; }
}
window.loadReviewsStatsBatch = loadReviewsStatsBatch;

function reviewsRenderBlock(productId, opts) {
  const data = REVIEWS_CACHE[productId];
  if (!data) return '<div class="rv-block rv-block--loading">Загрузка отзывов…</div>';
  const { reviews, stats, mine } = data;
  const canWrite = App.isAuthed();

  const limit = opts?.preview ? 3 : reviews.length;
  const shown = reviews.slice(0, limit);
  const writeBtnLabel = mine ? '✎ Изменить мой отзыв' : '✎ Написать отзыв';

  // Distribution bars (5★ ... 1★)
  const total = stats.count || 0;
  const distHtml = total > 0 ? `
    <div class="rv-dist">
      ${[5, 4, 3, 2, 1].map((s) => {
        const cnt = stats.distribution[s] || 0;
        const pct = total > 0 ? Math.round((cnt / total) * 100) : 0;
        return `
          <div class="rv-dist-row">
            <span class="rv-dist-row__lbl">${s}★</span>
            <div class="rv-dist-row__bar"><span class="rv-dist-row__fill" style="width:${pct}%"></span></div>
            <span class="rv-dist-row__cnt">${cnt}</span>
          </div>`;
      }).join('')}
    </div>` : '';

  const summaryHtml = total > 0 ? `
    <div class="rv-summary">
      <div class="rv-summary__big">
        <div class="rv-summary__avg">${reviewsFmtAvg(stats.avg)}</div>
        <div class="rv-summary__stars">${reviewsStars(stats.avg, 16)}</div>
        <div class="rv-summary__cnt">${total} ${reviewsPluralize(total)}</div>
      </div>
      ${distHtml}
    </div>` : `
    <div class="rv-empty">
      <div class="rv-empty__ic">★</div>
      <div class="rv-empty__h">Пока нет отзывов</div>
      <div class="rv-empty__s">${canWrite ? 'Будь первым — расскажи о товаре' : 'Открой через Telegram, чтобы оставить отзыв'}</div>
    </div>`;

  const listHtml = shown.length > 0 ? `
    <div class="rv-list">
      ${shown.map((r) => `
        <div class="rv-item">
          <div class="rv-item__head">
            <span class="rv-item__author">${escapeHtml(r.author_name || 'Гость')}</span>
            <span class="rv-item__stars">${reviewsStars(r.rating, 12)}</span>
            <span class="rv-item__time">${escapeHtml(reviewsRelTime(r.created_at))}</span>
          </div>
          ${r.text ? `<div class="rv-item__text">${escapeHtml(r.text)}</div>` : ''}
        </div>`).join('')}
    </div>` : '';

  const writeBtn = canWrite ? `
    <button class="rv-write-btn" data-haptic="light" onclick="openReviewWriter(${productId})">${writeBtnLabel}</button>
  ` : '';

  return `
    <div class="rv-block" data-pid="${productId}">
      <div class="rv-block__h">Отзывы</div>
      ${summaryHtml}
      ${listHtml}
      ${writeBtn}
    </div>`;
}
window.reviewsRenderBlock = reviewsRenderBlock;

// Подгрузить отзывы и впрыснуть в DOM-плейсхолдер (#rv-placeholder-{pid})
async function reviewsInjectInto(productId) {
  const ph = document.getElementById(`rv-placeholder-${productId}`);
  if (!ph) return;
  await loadReviews(productId);
  ph.innerHTML = reviewsRenderBlock(productId);
}
window.reviewsInjectInto = reviewsInjectInto;

/* ── Модалка написания отзыва ────────────────────────────────────────────── */
const REVIEW_WRITER_STATE = {
  productId: 0,
  rating: 5,
  text: '',
};

function openReviewWriter(productId) {
  const pid = Number(productId);
  if (!pid) return;
  REVIEW_WRITER_STATE.productId = pid;
  // Если есть мой отзыв — стартуем с его значений (редактирование)
  const cached = REVIEWS_CACHE[pid];
  const mine = cached?.mine;
  REVIEW_WRITER_STATE.rating = mine?.rating || 5;
  REVIEW_WRITER_STATE.text = mine?.text || '';
  ensureReviewWriterModal();
  renderReviewWriter();
  document.getElementById('review-writer-modal').style.display = 'flex';
  window.scrollLock?.();
  window.haptic?.('light');
}
window.openReviewWriter = openReviewWriter;

function closeReviewWriter() {
  const m = document.getElementById('review-writer-modal');
  if (m) m.style.display = 'none';
  window.scrollUnlock?.();
}
window.closeReviewWriter = closeReviewWriter;

function ensureReviewWriterModal() {
  if (document.getElementById('review-writer-modal')) return;
  const m = document.createElement('div');
  m.id = 'review-writer-modal';
  m.className = 'modal';
  m.style.display = 'none';
  m.onclick = (e) => { if (e.target === m) closeReviewWriter(); };
  m.innerHTML = `
    <div class="modal__sheet rv-writer__sheet">
      <button class="cat-modal__close" onclick="closeReviewWriter()">×</button>
      <div class="rv-writer__h">Ваш отзыв</div>
      <div class="rv-writer__sub">Оцените и опишите впечатления</div>

      <div class="rv-writer__rating" id="rv-writer-rating"></div>
      <div class="rv-writer__rating-lbl" id="rv-writer-rating-lbl">Отлично</div>

      <textarea class="rv-writer__text" id="rv-writer-text" placeholder="Что понравилось? Что можно улучшить?" maxlength="500"></textarea>
      <div class="rv-writer__counter"><span id="rv-writer-counter">0</span> / 500</div>

      <div class="rv-writer__actions">
        <button class="btn-outline" onclick="closeReviewWriter()">Отмена</button>
        <button class="btn-full" id="rv-writer-submit" onclick="submitReview()">Опубликовать</button>
      </div>
      <div class="rv-writer__err" id="rv-writer-err" style="display:none"></div>
      <button class="rv-writer__delete" id="rv-writer-delete" onclick="deleteMyReview()" style="display:none">Удалить мой отзыв</button>
    </div>`;
  document.body.appendChild(m);
}

const RATING_LABELS = {
  1: 'Очень плохо',
  2: 'Плохо',
  3: 'Нормально',
  4: 'Хорошо',
  5: 'Отлично',
};

function renderReviewWriter() {
  const rating = REVIEW_WRITER_STATE.rating;
  // Рендер 5 кликабельных звёзд
  const ratingEl = document.getElementById('rv-writer-rating');
  if (ratingEl) {
    ratingEl.innerHTML = [1, 2, 3, 4, 5].map((i) => {
      const filled = i <= rating;
      return `<button class="rv-writer__star ${filled ? 'rv-writer__star--on' : ''}" data-haptic="selection" onclick="setReviewRating(${i})" aria-label="${i} ★">${filled ? '★' : '☆'}</button>`;
    }).join('');
  }
  const lblEl = document.getElementById('rv-writer-rating-lbl');
  if (lblEl) lblEl.textContent = RATING_LABELS[rating] || '';
  const textEl = document.getElementById('rv-writer-text');
  if (textEl) textEl.value = REVIEW_WRITER_STATE.text;
  const counterEl = document.getElementById('rv-writer-counter');
  if (counterEl) counterEl.textContent = (REVIEW_WRITER_STATE.text || '').length;
  // Кнопка удалить — только если есть мой отзыв в кэше
  const deleteBtn = document.getElementById('rv-writer-delete');
  const mine = REVIEWS_CACHE[REVIEW_WRITER_STATE.productId]?.mine;
  if (deleteBtn) deleteBtn.style.display = mine ? '' : 'none';
  // Hook input
  if (textEl && !textEl._hooked) {
    textEl.addEventListener('input', () => {
      REVIEW_WRITER_STATE.text = textEl.value.slice(0, 500);
      if (counterEl) counterEl.textContent = REVIEW_WRITER_STATE.text.length;
    });
    textEl._hooked = true;
  }
}

function setReviewRating(r) {
  REVIEW_WRITER_STATE.rating = Math.max(1, Math.min(5, Number(r) || 5));
  renderReviewWriter();
  window.haptic?.('selection');
}
window.setReviewRating = setReviewRating;

async function submitReview() {
  const pid = REVIEW_WRITER_STATE.productId;
  const rating = REVIEW_WRITER_STATE.rating;
  const text = (REVIEW_WRITER_STATE.text || '').trim();
  const errEl = document.getElementById('rv-writer-err');
  const submitBtn = document.getElementById('rv-writer-submit');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  if (!App.isAuthed()) {
    if (errEl) { errEl.textContent = 'Открой через Telegram чтобы оставить отзыв'; errEl.style.display = ''; }
    return;
  }
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Публикуем…'; }
  try {
    const r = await fetch('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...App.authHeader() },
      body: JSON.stringify({ product_id: pid, rating, text }),
    });
    if (r.status === 429) {
      if (errEl) { errEl.textContent = 'Слишком много новых отзывов за сутки. Попробуй завтра.'; errEl.style.display = ''; }
      return;
    }
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      if (errEl) { errEl.textContent = data?.error || 'Не удалось опубликовать'; errEl.style.display = ''; }
      return;
    }
    window.haptic?.('success');
    closeReviewWriter();
    // Перезагружаем отзывы и перерисовываем блок
    await reviewsInjectInto(pid);
  } catch (e) {
    if (errEl) { errEl.textContent = 'Ошибка сети'; errEl.style.display = ''; }
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Опубликовать'; }
  }
}
window.submitReview = submitReview;

async function deleteMyReview() {
  const pid = REVIEW_WRITER_STATE.productId;
  const mine = REVIEWS_CACHE[pid]?.mine;
  if (!mine?.id) return;
  if (!App.isAuthed()) return;
  if (!(await App.confirm('Удалить ваш отзыв?'))) return;
  try {
    await fetch(`/api/reviews/${mine.id}`, {
      method: 'DELETE',
      headers: { ...App.authHeader() },
    });
    window.haptic?.('success');
    closeReviewWriter();
    await reviewsInjectInto(pid);
  } catch {}
}
window.deleteMyReview = deleteMyReview;

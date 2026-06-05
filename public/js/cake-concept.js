/* ─── AI-конструктор торта на заказ ─────────────────────────────────────────
   Юзер описывает торт текстом → backend генерирует 3 концепт-картинки через
   DALL-E 3 → выбирает понравившийся → отправляется в Bitrix24 как лид.
*/

let _conceptResults = null; // массив {url, variant} после генерации
let _conceptPrompt = '';

function openCakeConceptModal() {
  let m = document.getElementById('concept-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'concept-modal';
    m.className = 'cat-modal';
    m.style.display = 'none';
    m.onclick = (e) => { if (e.target === m) closeCakeConceptModal(); };
    document.body.appendChild(m);
  }
  m.innerHTML = `
    <div class="cat-modal__sheet">
      <button class="cat-modal__close" onclick="closeCakeConceptModal()">×</button>
      <div class="concept-h">
        <div class="concept-h__t">Опиши торт мечты</div>
        <div class="concept-h__sub">AI нарисует 3 концепт-варианта. Выбери один и отправь менеджеру.</div>
      </div>
      <div class="concept-body" id="concept-body">
        <textarea id="concept-prompt" class="concept-input"
          placeholder="Например: торт для дочки 5 лет, любит единорогов, голубой с радугой, на день рождения"
          maxlength="500" rows="4"></textarea>
        <div class="concept-hint">
          <span>Чем подробнее опишешь — тем точнее результат.</span>
          <span class="concept-cnt" id="concept-cnt">0/500</span>
        </div>
        <button class="btn-full concept-generate-btn" onclick="generateConcept()">
          <span data-icon="sparkles" data-size="18"></span> Сгенерировать
        </button>
        <div class="concept-cost-hint">Один запрос — 3 варианта, генерация ~30 сек</div>
      </div>
    </div>`;
  m.style.display = 'flex';
  window.scrollLock?.();
  window.tgBack?.show(() => closeCakeConceptModal());
  // Inflate icons inside modal
  window.IconInflate?.(m);
  // Counter
  const input = document.getElementById('concept-prompt');
  const cnt = document.getElementById('concept-cnt');
  if (input && cnt) {
    input.addEventListener('input', () => {
      cnt.textContent = `${input.value.length}/500`;
    });
    setTimeout(() => input.focus(), 200);
  }
}
window.openCakeConceptModal = openCakeConceptModal;

function closeCakeConceptModal() {
  const m = document.getElementById('concept-modal');
  if (m) m.style.display = 'none';
  window.scrollUnlock?.();
  window.tgBack?.hide();
}
window.closeCakeConceptModal = closeCakeConceptModal;

async function generateConcept() {
  const input = document.getElementById('concept-prompt');
  const prompt = (input?.value || '').trim();
  if (prompt.length < 5) {
    if (input) {
      input.style.borderColor = 'var(--red)';
      setTimeout(() => { input.style.borderColor = ''; }, 1500);
    }
    return;
  }
  _conceptPrompt = prompt;

  const body = document.getElementById('concept-body');
  if (!body) return;
  // Skeleton-state — генерация на стороне Pollinations может занять до минуты
  body.innerHTML = `
    <div class="concept-loading">
      <div class="concept-loading__title">🎨 Маша рисует твой торт…</div>
      <div class="concept-loading__sub">Картинки могут появляться по одной. До минуты, можно отвлечься на чай ☕</div>
      <div class="concept-skel-grid">
        <div class="concept-skel"></div>
        <div class="concept-skel"></div>
        <div class="concept-skel"></div>
      </div>
    </div>`;

  try {
    const headers = { 'Content-Type': 'application/json', ...App.authHeader() };
    const r = await fetch('/api/cake-concept/generate', {
      method: 'POST', headers,
      body: JSON.stringify({ prompt }),
    });
    const data = await r.json();
    if (!r.ok || !data.ok) {
      const msg = data.message || data.error || 'Не получилось';
      body.innerHTML = `
        <div class="concept-error">
          <div class="concept-error__t">⚠ ${msg}</div>
          <button class="btn-outline" onclick="openCakeConceptModal()">← Попробовать ещё раз</button>
        </div>`;
      return;
    }
    _conceptResults = data.concepts || [];
    renderConceptResults();
  } catch (e) {
    body.innerHTML = `
      <div class="concept-error">
        <div class="concept-error__t">⚠ Нет соединения. Проверь интернет и попробуй снова.</div>
        <button class="btn-outline" onclick="openCakeConceptModal()">← Назад</button>
      </div>`;
  }
}
window.generateConcept = generateConcept;

function renderConceptResults() {
  const body = document.getElementById('concept-body');
  if (!body || !_conceptResults?.length) return;
  const cards = _conceptResults.map((c, i) => `
    <button class="concept-result" onclick="pickConcept(${i})">
      <img src="${c.url}" alt="${c.variant}" loading="lazy" onload="this.classList.add('loaded')"/>
      <span class="concept-result__lbl">${c.variant}</span>
    </button>
  `).join('');
  body.innerHTML = `
    <div class="concept-results-h">Выбери понравившийся вариант:</div>
    <div class="concept-results-grid">${cards}</div>
    <button class="btn-outline concept-retry" onclick="openCakeConceptModal()">↻ Сгенерировать другие</button>
    <div class="concept-disclaimer">Это концепт-картинка. Реальный торт может слегка отличаться — кондитер уточнит детали при подтверждении.</div>
  `;
}

function pickConcept(idx) {
  const c = _conceptResults?.[idx];
  if (!c) return;
  // Открыть форму "Отправить менеджеру"
  const body = document.getElementById('concept-body');
  if (!body) return;
  body.innerHTML = `
    <div class="concept-submit-h">Отлично! Отправим этот концепт менеджеру.</div>
    <div class="concept-submit-preview">
      <img src="${c.url}" alt="${c.variant}"/>
      <div class="concept-submit-label">${c.variant}</div>
    </div>
    <form class="concept-submit-form" onsubmit="submitConcept(event, ${idx})">
      <div class="of-group">
        <label class="of-label">Имя <span class="lbl-req">*</span></label>
        <input class="of-input" id="cs-name" type="text" required placeholder="Иван"/>
      </div>
      <div class="of-group">
        <label class="of-label">Телефон <span class="lbl-req">*</span></label>
        <input class="of-input" id="cs-phone" type="tel" required placeholder="+7 (___) ___-__-__"
          inputmode="tel" oninput="window.phoneMask?.(this)"/>
      </div>
      <div class="of-group">
        <label class="of-label">Дата события (опционально)</label>
        <input class="of-input" id="cs-date" type="date"/>
      </div>
      <div class="of-group">
        <label class="of-label">На сколько гостей</label>
        <input class="of-input" id="cs-persons" type="number" min="1" max="500" placeholder="8"/>
      </div>
      <div class="of-group">
        <label class="of-label">Комментарий</label>
        <textarea class="of-input" id="cs-comment" rows="2" placeholder="Что важно учесть"></textarea>
      </div>
      <button class="btn-full" type="submit">Отправить менеджеру</button>
      <button type="button" class="btn-outline concept-back" onclick="renderConceptResults()">← Вернуться к выбору</button>
    </form>
  `;
  // Try to prefill from previous order form if user already filled it
  try {
    const prevName = document.getElementById('of-name')?.value;
    const prevPhone = document.getElementById('of-phone')?.value;
    if (prevName) document.getElementById('cs-name').value = prevName;
    if (prevPhone) document.getElementById('cs-phone').value = prevPhone;
  } catch {}
}
window.pickConcept = pickConcept;
window.renderConceptResults = renderConceptResults;

async function submitConcept(e, idx) {
  e.preventDefault();
  const c = _conceptResults?.[idx];
  if (!c) return;
  const name = document.getElementById('cs-name')?.value.trim();
  const phone = document.getElementById('cs-phone')?.value.trim();
  const date = document.getElementById('cs-date')?.value;
  const persons = document.getElementById('cs-persons')?.value;
  const comment = document.getElementById('cs-comment')?.value.trim();
  if (!name || !phone) return;

  const btn = e.target.querySelector('button[type="submit"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Отправляем…'; }

  try {
    const headers = { 'Content-Type': 'application/json', ...App.authHeader() };
    const r = await fetch('/api/cake-concept/submit', {
      method: 'POST', headers,
      body: JSON.stringify({
        prompt: _conceptPrompt,
        image_url: c.url,
        variant: c.variant,
        name, phone,
        event_date: date,
        persons,
        comment,
      }),
    });
    const data = await r.json();
    const body = document.getElementById('concept-body');
    if (r.ok && data.ok) {
      window.haptic?.('success');
      if (body) body.innerHTML = `
        <div class="concept-success">
          <div class="concept-success__ic">✅</div>
          <div class="concept-success__t">Заявка отправлена!</div>
          <div class="concept-success__sub">Менеджер свяжется с тобой в течение 1 часа.<br/>Концепт уже у него на экране.</div>
          <button class="btn-full" onclick="closeCakeConceptModal()">Закрыть</button>
        </div>`;
    } else {
      window.haptic?.('error');
      if (btn) { btn.disabled = false; btn.textContent = 'Отправить менеджеру'; }
      alert(data.message || data.error || 'Не удалось отправить. Позвони +7 (3952) 50-40-80.');
    }
  } catch {
    window.haptic?.('error');
    if (btn) { btn.disabled = false; btn.textContent = 'Отправить менеджеру'; }
    alert('Нет соединения. Проверь интернет.');
  }
}
window.submitConcept = submitConcept;

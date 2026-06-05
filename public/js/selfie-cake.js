/* ─── AI-портрет на торте по селфи ───────────────────────────────────────
   Юзер загружает фото → Pollinations img2img делает 3 концепта «ты как
   сахарная фигурка на торте». Можно сохранить, поделиться, заказать.
*/

let _selfieResults = null;

function openSelfieCakeModal() {
  let m = document.getElementById('selfie-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'selfie-modal';
    m.className = 'cat-modal';
    m.style.display = 'none';
    m.onclick = (e) => { if (e.target === m) closeSelfieCakeModal(); };
    document.body.appendChild(m);
  }
  m.innerHTML = `
    <div class="cat-modal__sheet">
      <button class="cat-modal__close" onclick="closeSelfieCakeModal()">×</button>
      <div class="selfie-h">
        <div class="selfie-h__t">AI-портрет на торте 🎂</div>
        <div class="selfie-h__sub">Загрузи селфи — AI нарисует тебя как сахарную фигурку</div>
      </div>
      <div class="selfie-body" id="selfie-body">
        <label class="selfie-upload">
          <input type="file" accept="image/*" id="selfie-input" hidden onchange="onSelfieSelected(event)"/>
          <div class="selfie-upload__inner">
            <div class="selfie-upload__ic">📸</div>
            <div class="selfie-upload__t">Выбрать фото</div>
            <div class="selfie-upload__sub">JPG или PNG, до 6 МБ</div>
          </div>
        </label>
        <div class="selfie-tips">
          <div class="selfie-tip">✨ Чем чётче лицо — тем лучше результат</div>
          <div class="selfie-tip">🤫 Фото не сохраняется навсегда — удалится автоматически через 2 часа</div>
        </div>
      </div>
    </div>`;
  m.style.display = 'flex';
  window.scrollLock?.();
  window.tgBack?.show(() => closeSelfieCakeModal());
  window.IconInflate?.(m);
}
window.openSelfieCakeModal = openSelfieCakeModal;

function closeSelfieCakeModal() {
  const m = document.getElementById('selfie-modal');
  if (m) m.style.display = 'none';
  window.scrollUnlock?.();
  window.tgBack?.hide();
}
window.closeSelfieCakeModal = closeSelfieCakeModal;

async function onSelfieSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    alert('Это не картинка. Выбери JPG или PNG.');
    return;
  }
  if (file.size > 6 * 1024 * 1024) {
    alert('Файл больше 6 МБ. Выбери поменьше или сожми.');
    return;
  }

  const body = document.getElementById('selfie-body');
  if (!body) return;

  // Превью + индикатор загрузки
  const previewUrl = URL.createObjectURL(file);
  body.innerHTML = `
    <div class="selfie-preview">
      <img src="${previewUrl}" alt="preview"/>
      <div class="selfie-preview__overlay">
        <div class="selfie-preview__t">🎨 AI рисует твой портрет…</div>
        <div class="selfie-preview__sub">До минуты, не закрывай экран</div>
      </div>
    </div>
    <div class="concept-skel-grid">
      <div class="concept-skel"></div>
      <div class="concept-skel"></div>
      <div class="concept-skel"></div>
    </div>`;

  // Сжимаем + base64
  try {
    const b64 = await fileToBase64(file, 1024); // resize to 1024
    const headers = { 'Content-Type': 'application/json', ...App.authHeader() };

    const r = await fetch('/api/selfie-cake', {
      method: 'POST', headers,
      body: JSON.stringify({ image_b64: b64 }),
    });
    const data = await r.json();
    if (!r.ok || !data.ok) {
      body.innerHTML = `
        <div class="concept-error">
          <div class="concept-error__t">⚠ ${data.message || data.error || 'Не получилось'}</div>
          <button class="btn-outline" onclick="openSelfieCakeModal()">← Попробовать снова</button>
        </div>`;
      URL.revokeObjectURL(previewUrl);
      return;
    }
    _selfieResults = data.variants || [];
    renderSelfieResults();
  } catch (e) {
    body.innerHTML = `
      <div class="concept-error">
        <div class="concept-error__t">⚠ Нет соединения. Проверь интернет.</div>
        <button class="btn-outline" onclick="openSelfieCakeModal()">← Назад</button>
      </div>`;
  }
}
window.onSelfieSelected = onSelfieSelected;

function renderSelfieResults() {
  const body = document.getElementById('selfie-body');
  if (!body || !_selfieResults?.length) return;
  const cards = _selfieResults.map((v, i) => `
    <button class="concept-result" onclick="pickSelfieResult(${i})">
      <img src="${v.url}" alt="${v.variant}" loading="lazy" onload="this.classList.add('loaded')"/>
      <span class="concept-result__lbl">${v.variant}</span>
    </button>
  `).join('');
  body.innerHTML = `
    <div class="concept-results-h">Выбери любимый — поделись или сделай тортом:</div>
    <div class="concept-results-grid">${cards}</div>
    <button class="btn-outline concept-retry" onclick="openSelfieCakeModal()">↻ Загрузить другое селфи</button>
    <div class="concept-disclaimer">Это художественная интерпретация. AI не делает копий лиц — он создаёт сахарного персонажа «по мотивам».</div>
  `;
}

function pickSelfieResult(idx) {
  const v = _selfieResults?.[idx];
  if (!v) return;
  const body = document.getElementById('selfie-body');
  if (!body) return;
  body.innerHTML = `
    <div class="selfie-pick">
      <img class="selfie-pick__img" src="${v.url}" alt="${v.variant}"/>
      <div class="selfie-pick__lbl">${v.variant}</div>
      <div class="selfie-pick__actions">
        <a class="btn-full" href="${v.url}" download="maria-cake-portrait.jpg" target="_blank" rel="noopener">
          📥 Скачать
        </a>
        <button class="btn-outline" onclick="shareSelfie(${idx})">📤 Поделиться</button>
        <button class="btn-outline" onclick="orderSelfieAsCake(${idx})">🎂 Заказать торт с этим</button>
      </div>
      <button type="button" class="btn-outline concept-back" onclick="renderSelfieResults()">← К выбору</button>
    </div>`;
}
window.pickSelfieResult = pickSelfieResult;
window.renderSelfieResults = renderSelfieResults;

function shareSelfie(idx) {
  const v = _selfieResults?.[idx];
  if (!v) return;
  // Нативный share текущей платформы (TG/VK/браузер)
  App.share(v.url, 'Смотри, я в виде торта от Марии 🎂');
}
window.shareSelfie = shareSelfie;

function orderSelfieAsCake(idx) {
  const v = _selfieResults?.[idx];
  if (!v) return;
  // Открываем существующий cake-concept flow с предзаполненным image_url
  if (window.openCakeConceptModal) {
    closeSelfieCakeModal();
    // Триггерим cake-concept с готовой картинкой — переиспользуем submit-form
    setTimeout(() => {
      window._conceptResults = [{ url: v.url, variant: 'AI-портрет: ' + v.variant }];
      window._conceptPrompt = 'AI-портрет на торте по селфи';
      window.openCakeConceptModal();
      // Через тик подменяем результат на нашу картинку
      setTimeout(() => window.pickConcept?.(0), 50);
    }, 300);
  }
}
window.orderSelfieAsCake = orderSelfieAsCake;

// Resize клиентом перед отправкой — экономим трафик и облегчаем работу AI
function fileToBase64(file, maxSize = 1024) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => { img.src = e.target.result; };
    reader.onerror = reject;
    img.onload = () => {
      const ratio = Math.min(maxSize / img.width, maxSize / img.height, 1);
      const w = Math.round(img.width * ratio);
      const h = Math.round(img.height * ratio);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      // JPEG 85% — хорошее качество при разумном размере
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

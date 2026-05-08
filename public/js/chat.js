/* ─── Chat ───────────────────────────────────────────────────────────────── */
// Восстанавливаем историю чата из sessionStorage — сохраняется на время сессии
const CHAT_KEY = 'maria_chat_history_v1';
let chatHistory = [];
try {
  const saved = sessionStorage.getItem(CHAT_KEY);
  if (saved) {
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed)) chatHistory = parsed;
  }
} catch {}

const CHAT_HISTORY_MAX = 100; // 50 пар user+assistant — длинная сессия
const _chatInitData = window.Telegram?.WebApp?.initData ?? "";

function trimChatHistory() {
  if (chatHistory.length > CHAT_HISTORY_MAX) {
    chatHistory.splice(0, chatHistory.length - CHAT_HISTORY_MAX);
  }
  try { sessionStorage.setItem(CHAT_KEY, JSON.stringify(chatHistory)); } catch {}
}

function clearChat() {
  const tg = window.Telegram?.WebApp;
  const doClear = () => {
    chatHistory = [];
    try { sessionStorage.removeItem(CHAT_KEY); } catch {}
    const wrap = document.getElementById('chat-messages');
    if (wrap) {
      wrap.innerHTML = `
        <div class="msg msg--bot fade-in">
          <div class="msg__avatar">🍰</div>
          <div class="msg__bubble">Привет! Чем могу помочь? <span class="msg__time">${nowHM()}</span></div>
        </div>`;
    }
    if (window.refreshChatChips) window.refreshChatChips();
    window.haptic?.('selection');
  };
  if (tg?.showConfirm) tg.showConfirm('Очистить историю чата?', (ok) => { if (ok) doClear(); });
  else if (confirm('Очистить историю чата?')) doClear();
}
window.clearChat = clearChat;

function handleChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

async function sendMessage() {
  const input   = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  const text    = input.value.trim();
  if (!text) return;

  document.querySelector('.chat-suggestions')?.style && (document.querySelector('.chat-suggestions').style.display = 'none');
  // Скрываем chip-suggestions после первого сообщения
  const chipsWrap = document.getElementById('chat-chips');
  if (chipsWrap) chipsWrap.style.display = 'none';

  input.value = '';
  appendMessage('user', text);
  chatHistory.push({ role: 'user', content: text });
  trimChatHistory();

  sendBtn.disabled = true;
  const typing = appendTyping();

  // Streaming-первый: пытаемся через SSE; если не поддерживается — fallback на /api/chat
  const supportsStream = typeof TextDecoder !== 'undefined' && typeof ReadableStream !== 'undefined';
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (_chatInitData) headers['Authorization'] = 'tma ' + _chatInitData;

    if (supportsStream) {
      const ok = await streamChat(headers, typing);
      if (ok) return;
      // Если стрим упал на сетевом уровне — типинг уже снят, делаем fallback
    }

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({ messages: chatHistory }),
    });
    typing.remove();
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      appendMessage('bot', err.error ?? 'Ошибка сервера. Попробуйте позже.');
      return;
    }
    const data = await res.json();
    const reply = data.text ?? '';
    chatHistory.push({ role: 'assistant', content: reply });
    trimChatHistory();
    appendMessage('bot', reply, data.products);
    applyCartActions(data.cart_actions, data.products);
  } catch {
    typing.remove();
    appendMessage('bot', '⚠️ Нет соединения. Проверьте интернет.');
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
}

// Применяет cart_actions от AI к корзине
function applyCartActions(cartActions, products) {
  if (!Array.isArray(cartActions) || !cartActions.length || !window.cartAdd) return;
  for (const a of cartActions) {
    if (a.action === 'add' && a.id) {
      const fromList = (products || []).find(p => Number(p.id) === Number(a.id));
      window.cartAdd({
        id:    a.id,
        name:  a.name || fromList?.name || `Товар #${a.id}`,
        price: fromList?.price || 0,
        image: fromList?.image || null,
      });
    }
  }
}

// SSE-чат: возвращает true если успешно (даже с error event), false при сетевом сбое
async function streamChat(headers, typing) {
  const wrap = document.getElementById('chat-messages');
  let bubble = null;        // <div> с текстом ассистента
  let bubbleText = '';      // накопленный текст (без HTML)
  let cardsContainer = null;// добавим в конце по products
  let createdBubble = false;

  const ensureBubble = () => {
    if (createdBubble) return;
    typing.remove();
    const div = document.createElement('div');
    const prev = wrap.lastElementChild;
    const grouped = prev && prev.classList.contains('msg--bot');
    div.className = `msg msg--bot fade-in${grouped ? ' msg--grouped' : ''}`;
    div.innerHTML = '<div class="msg__avatar">🍰</div><div class="msg__bubble"></div>';
    bubble = div.querySelector('.msg__bubble');
    wrap.appendChild(div);
    wrap.scrollTop = wrap.scrollHeight;
    createdBubble = true;
  };

  let res;
  try {
    res = await fetch('/api/chat-stream', {
      method: 'POST',
      headers,
      body: JSON.stringify({ messages: chatHistory }),
    });
  } catch {
    return false;
  }
  if (!res.ok || !res.body) {
    typing.remove();
    const err = await res.json().catch(() => ({}));
    appendMessage('bot', err.error ?? 'Ошибка сервера.');
    return true;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let finalProducts = [];
  let finalCart = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n\n')) !== -1) {
        const evt = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        for (const line of evt.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          let parsed;
          try { parsed = JSON.parse(data); } catch { continue; }
          if (parsed.type === 'delta') {
            ensureBubble();
            bubbleText += parsed.text;
            bubble.innerHTML = esc(bubbleText).replace(/\n/g, '<br>');
            wrap.scrollTop = wrap.scrollHeight;
          } else if (parsed.type === 'tool') {
            // Лёгкий статус-индикатор — пока без UI, но можно расширить
          } else if (parsed.type === 'final') {
            ensureBubble();
            // Итоговый текст (заменяем — на случай если delta потерялась)
            if (parsed.text) {
              bubbleText = parsed.text;
              bubble.innerHTML = esc(bubbleText).replace(/\n/g, '<br>');
            }
            finalProducts = parsed.products || [];
            finalCart = parsed.cart_actions || [];
            // Timestamp в углу, потом карточки
            bubble.insertAdjacentHTML('beforeend', `<span class="msg__time">${nowHM()}</span>`);
            if (finalProducts.length) {
              const grid = renderProductGrid(finalProducts);
              if (grid) bubble.insertAdjacentHTML('beforeend', grid);
            }
            window.linkifyPhones?.(bubble.parentElement);
            wrap.scrollTop = wrap.scrollHeight;
          } else if (parsed.type === 'error') {
            typing.remove();
            if (createdBubble) {
              bubbleText = parsed.message || 'Ошибка.';
              bubble.innerHTML = esc(bubbleText);
            } else {
              appendMessage('bot', parsed.message || 'Ошибка.');
            }
          }
        }
      }
    }
  } catch {
    if (!createdBubble) typing.remove();
    appendMessage('bot', '⚠️ Соединение прервано.');
    return true;
  }

  if (createdBubble && bubbleText) {
    chatHistory.push({ role: 'assistant', content: bubbleText });
    trimChatHistory();
  }
  applyCartActions(finalCart, finalProducts);
  return true;
}

// Рендер сетки карточек товаров (используется в стрим-режиме)
function renderProductGrid(products) {
  if (!Array.isArray(products) || !products.length) return '';
  const cards = products.slice(0, 6).map((p) => {
    const id = p.id;
    const onClick = id && window.catOpenProduct ? `catOpenProduct(${id})` : `openSite('${escAttr(p.url || '')}')`;
    const priceTxt = p.price != null ? `${Number(p.price).toLocaleString('ru-RU')} ₽` : '';
    const img = p.image || '';
    const imgEl = img
      ? `<img class="ai-pcard__pic" src="/img?u=${encodeURIComponent(img)}" alt="${escAttr(p.name||'')}" loading="lazy" decoding="async">`
      : '<span style="font-size:24px;opacity:.5">🍰</span>';
    return `
      <div class="ai-pcard" onclick="${onClick}">
        <div class="ai-pcard__img">${imgEl}${p.hit ? '<span class="ai-pcard__hit">★</span>' : ''}</div>
        <div class="ai-pcard__body">
          <div class="ai-pcard__name">${esc(p.name || '')}</div>
          <div class="ai-pcard__price">${esc(priceTxt)}</div>
        </div>
      </div>`;
  }).join('');
  return `<div class="ai-pgrid">${cards}</div>`;
}

function appendMessage(role, text, products) {
  const wrap = document.getElementById('chat-messages');
  const div  = document.createElement('div');
  // Группировка: если предыдущее сообщение того же автора — не показываем аватар, ужимаем gap
  const prev = wrap.lastElementChild;
  const grouped = prev && prev.classList.contains('msg') && prev.classList.contains(`msg--${role}`);
  div.className = `msg msg--${role} fade-in${grouped ? ' msg--grouped' : ''}`;
  const avatar = role === 'bot' ? '<div class="msg__avatar">🍰</div>' : '';
  const cardsHtml = renderProductGrid(products);
  const timeHtml = `<span class="msg__time">${nowHM()}</span>`;
  div.innerHTML = `${avatar}<div class="msg__bubble">${esc(text).replace(/\n/g,'<br>')}${timeHtml}${cardsHtml}</div>`;
  window.linkifyPhones?.(div);
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}

function nowHM() {
  const d = new Date();
  return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
}

function escAttr(s) {
  return String(s ?? '').replace(/'/g,'&#39;').replace(/"/g,'&quot;');
}

function appendTyping() {
  const wrap = document.getElementById('chat-messages');
  const div  = document.createElement('div');
  const prev = wrap.lastElementChild;
  const grouped = prev && prev.classList.contains('msg--bot');
  div.className = `msg msg--bot fade-in${grouped ? ' msg--grouped' : ''}`;
  div.innerHTML = '<div class="msg__avatar">🍰</div><div class="msg__bubble msg__bubble--typing"><span class="typing-dots"><i></i><i></i><i></i></span></div>';
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}

function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ─── Voice input ─────────────────────────────────────────────────────────── */
let _voiceRecorder = null;
let _voiceChunks = [];
let _voiceStream = null;
let _voiceMaxTimer = null;

function _voiceMime() {
  // Подбираем MIME, который поддерживает MediaRecorder (приоритет — webm/opus, дальше mp4/m4a)
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  for (const m of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return '';
}

async function toggleVoice() {
  const tg = window.Telegram?.WebApp;
  const btn = document.getElementById('chat-mic');
  if (!btn) return;

  // Если уже записываем — останавливаем
  if (_voiceRecorder && _voiceRecorder.state === 'recording') {
    try { _voiceRecorder.stop(); } catch {}
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    if (tg?.showAlert) tg.showAlert('Ваш браузер не поддерживает запись голоса.');
    else alert('Ваш браузер не поддерживает запись голоса.');
    return;
  }

  try {
    _voiceStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch {
    if (tg?.showAlert) tg.showAlert('Нет доступа к микрофону. Разреши в настройках.');
    else alert('Нет доступа к микрофону. Разреши в настройках.');
    return;
  }

  const mime = _voiceMime();
  try {
    _voiceRecorder = mime ? new MediaRecorder(_voiceStream, { mimeType: mime }) : new MediaRecorder(_voiceStream);
  } catch {
    _voiceStream.getTracks().forEach(t => t.stop());
    if (tg?.showAlert) tg.showAlert('Запись недоступна.');
    return;
  }

  _voiceChunks = [];
  _voiceRecorder.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) _voiceChunks.push(ev.data); };
  _voiceRecorder.onstop = onVoiceStop;

  _voiceRecorder.start();
  btn.classList.add('is-recording');
  btn.setAttribute('aria-label', 'Остановить запись');
  window.haptic?.('light');

  // Авто-стоп через 30 секунд (страховка от забытой записи)
  _voiceMaxTimer = setTimeout(() => {
    if (_voiceRecorder && _voiceRecorder.state === 'recording') {
      try { _voiceRecorder.stop(); } catch {}
    }
  }, 30_000);
}
window.toggleVoice = toggleVoice;

async function onVoiceStop() {
  const btn = document.getElementById('chat-mic');
  if (btn) {
    btn.classList.remove('is-recording');
    btn.setAttribute('aria-label', 'Голосовой ввод');
  }
  if (_voiceMaxTimer) { clearTimeout(_voiceMaxTimer); _voiceMaxTimer = null; }
  // Останавливаем поток (отпускает индикатор микрофона в браузере)
  if (_voiceStream) {
    _voiceStream.getTracks().forEach(t => t.stop());
    _voiceStream = null;
  }

  const chunks = _voiceChunks; _voiceChunks = [];
  if (!chunks.length) return;
  const mime = chunks[0].type || 'audio/webm';
  const blob = new Blob(chunks, { type: mime });

  // Меньше 0.4 сек — точно мусор/нажатие
  if (blob.size < 4000) return;

  const input = document.getElementById('chat-input');
  const prevPlaceholder = input?.placeholder;
  if (input) { input.placeholder = 'Распознаём…'; input.disabled = true; }

  try {
    const headers = { 'Content-Type': mime };
    if (_chatInitData) headers['Authorization'] = 'tma ' + _chatInitData;
    const res = await fetch('/api/transcribe', { method: 'POST', headers, body: blob });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err.error || 'Не удалось распознать голос.';
      const tg = window.Telegram?.WebApp;
      if (tg?.showAlert) tg.showAlert(msg); else alert(msg);
      return;
    }
    const data = await res.json();
    const text = (data.text || '').trim();
    if (!text) {
      const tg = window.Telegram?.WebApp;
      if (tg?.showAlert) tg.showAlert('Голос не распознан. Попробуй ещё раз.');
      return;
    }
    if (input) {
      // Дописываем к текущему тексту (если что-то уже было набрано)
      input.value = input.value ? (input.value.trimEnd() + ' ' + text) : text;
      input.focus();
    }
    window.haptic?.('selection');
  } catch {
    const tg = window.Telegram?.WebApp;
    if (tg?.showAlert) tg.showAlert('Ошибка распознавания.'); else alert('Ошибка распознавания.');
  } finally {
    if (input) { input.placeholder = prevPlaceholder || 'Напишите вопрос…'; input.disabled = false; }
  }
}

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

const CHAT_HISTORY_MAX = 40; // 20 пар user+assistant — достаточно для длинного диалога
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
          <div class="msg__av">🍰</div>
          <div class="msg__bbl">Привет! Чем могу помочь?</div>
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

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (_chatInitData) headers['Authorization'] = 'tma ' + _chatInitData;
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

    const data  = await res.json();
    const reply = data.text ?? '';
    chatHistory.push({ role: 'assistant', content: reply });
    trimChatHistory();
    appendMessage('bot', reply, data.products);

    // Если AI добавил товары в корзину — применяем
    if (Array.isArray(data.cart_actions) && data.cart_actions.length && window.cartAdd) {
      for (const a of data.cart_actions) {
        if (a.action === 'add' && a.id) {
          // Найдём детали в products чтобы добавить корректно
          const fromList = (data.products || []).find(p => Number(p.id) === Number(a.id));
          window.cartAdd({
            id:    a.id,
            name:  a.name || fromList?.name || `Товар #${a.id}`,
            price: fromList?.price || 0,
            image: fromList?.image || null,
          });
        }
      }
    }
  } catch {
    typing.remove();
    appendMessage('bot', '⚠️ Нет соединения. Проверьте интернет.');
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
}

function appendMessage(role, text, products) {
  const wrap = document.getElementById('chat-messages');
  const div  = document.createElement('div');
  div.className = `msg msg--${role} fade-in`;
  const avatar = role === 'bot' ? '<div class="msg__avatar">🍰</div>' : '';
  let cardsHtml = '';
  if (Array.isArray(products) && products.length) {
    const cards = products.slice(0, 6).map((p) => {
      const id = p.id;
      const onClick = id && window.catOpenProduct
        ? `catOpenProduct(${id})`
        : `openSite('${escAttr(p.url || '')}')`;
      const priceTxt = p.price != null ? `${Number(p.price).toLocaleString('ru-RU')} ₽` : '';
      const img = p.image || '';
      const imgEl = img
        ? `<img class="ai-pcard__pic" src="/img?u=${encodeURIComponent(img)}" alt="${escAttr(p.name||'')}" loading="lazy" decoding="async">`
        : '<span style="font-size:24px;opacity:.5">🍰</span>';
      return `
        <div class="ai-pcard" onclick="${onClick}">
          <div class="ai-pcard__img">
            ${imgEl}
            ${p.hit ? '<span class="ai-pcard__hit">★</span>' : ''}
          </div>
          <div class="ai-pcard__body">
            <div class="ai-pcard__name">${esc(p.name || '')}</div>
            <div class="ai-pcard__price">${esc(priceTxt)}</div>
          </div>
        </div>`;
    }).join('');
    cardsHtml = `<div class="ai-pgrid">${cards}</div>`;
  }
  div.innerHTML = `${avatar}<div class="msg__bubble">${esc(text).replace(/\n/g,'<br>')}${cardsHtml}</div>`;
  // Превращаем телефоны в кликабельные ссылки в ответе AI
  window.linkifyPhones?.(div);
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}

function escAttr(s) {
  return String(s ?? '').replace(/'/g,'&#39;').replace(/"/g,'&quot;');
}

function appendTyping() {
  const wrap = document.getElementById('chat-messages');
  const div  = document.createElement('div');
  div.className = 'msg msg--bot fade-in';
  div.innerHTML = '<div class="msg__avatar">🍰</div><div class="msg__bubble" style="color:#aaa;font-style:italic">Печатает…</div>';
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}

function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

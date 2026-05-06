/* ─── Chat ───────────────────────────────────────────────────────────────── */
const chatHistory = [];
const CHAT_HISTORY_MAX = 12; // ограничиваем — 6 пар user+assistant, чтобы не упираться в токен-лимит Groq
const _chatInitData = window.Telegram?.WebApp?.initData ?? "";

function trimChatHistory() {
  if (chatHistory.length > CHAT_HISTORY_MAX) {
    chatHistory.splice(0, chatHistory.length - CHAT_HISTORY_MAX);
  }
}

function handleChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

async function sendMessage() {
  const input   = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  const text    = input.value.trim();
  if (!text) return;

  document.querySelector('.chat-suggestions')?.style && (document.querySelector('.chat-suggestions').style.display = 'none');

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
      return `
        <div class="ai-pcard" onclick="${onClick}">
          <div class="ai-pcard__img" ${img ? `style="background-image:url('${escAttr(img)}')"` : ''}>
            ${img ? '' : '<span style="font-size:24px;opacity:.5">🍰</span>'}
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

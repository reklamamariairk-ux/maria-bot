/* ─── Chat ───────────────────────────────────────────────────────────────── */
const chatHistory = [];

function handleChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

async function sendMessage() {
  const input   = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  const text    = input.value.trim();
  if (!text) return;

  // Скрываем подсказки
  document.querySelector('.chat-suggestions')?.style && (document.querySelector('.chat-suggestions').style.display = 'none');

  input.value = '';
  appendMessage('user', text);
  chatHistory.push({ role: 'user', content: text });

  sendBtn.disabled = true;
  const typing = appendTyping();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    appendMessage('bot', reply);
  } catch {
    typing.remove();
    appendMessage('bot', '⚠️ Нет соединения. Проверьте интернет.');
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
}

function appendMessage(role, text) {
  const wrap = document.getElementById('chat-messages');
  const div  = document.createElement('div');
  div.className = `msg msg--${role} fade-in`;
  const avatar = role === 'bot' ? '<div class="msg__avatar">🍰</div>' : '';
  div.innerHTML = `${avatar}<div class="msg__bubble">${esc(text).replace(/\n/g,'<br>')}</div>`;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
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

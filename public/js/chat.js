/* ─── AI Chat ────────────────────────────────────────────────────────────── */
const chatHistory = []; // { role: "user"|"assistant", content: string }

function handleChatKey(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

async function sendMessage() {
  const input  = document.getElementById("chat-input");
  const sendBtn = document.getElementById("chat-send");
  const text   = input.value.trim();
  if (!text) return;

  input.value = "";
  appendMessage("user", text);
  chatHistory.push({ role: "user", content: text });

  sendBtn.disabled = true;
  const typingEl = appendTyping();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: chatHistory }),
    });

    typingEl.remove();

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      appendMessage("bot", err.error ?? "Ошибка сервера. Попробуйте позже.");
      return;
    }

    const data = await res.json();
    const reply = data.text ?? "";
    chatHistory.push({ role: "assistant", content: reply });
    appendMessage("bot", reply);
  } catch {
    typingEl.remove();
    appendMessage("bot", "Нет соединения с сервером. Проверьте интернет.");
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
}

function appendMessage(role, text) {
  const wrap = document.getElementById("chat-messages");
  const div  = document.createElement("div");
  div.className = `msg msg--${role} fade-in`;
  div.innerHTML = `<div class="msg__bubble">${escapeHtml(text).replace(/\n/g, "<br>")}</div>`;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}

function appendTyping() {
  const wrap = document.getElementById("chat-messages");
  const div  = document.createElement("div");
  div.className = "msg msg--bot msg__typing fade-in";
  div.innerHTML = `<div class="msg__bubble">⌛ Печатает…</div>`;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

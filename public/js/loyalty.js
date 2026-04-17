// ─── Личный кабинет ──────────────────────────────────────────────────────────

function lkFormatPhone(input) {
  let v = input.value.replace(/\D/g, "");
  if (v.startsWith("8")) v = "7" + v.slice(1);
  if (v.length > 0 && !v.startsWith("7")) v = "7" + v;
  v = v.slice(0, 11);
  let out = "";
  if (v.length > 0)  out = "+7";
  if (v.length > 1)  out += " (" + v.slice(1, 4);
  if (v.length >= 4) out += ") " + v.slice(4, 7);
  if (v.length >= 7) out += "-" + v.slice(7, 9);
  if (v.length >= 9) out += "-" + v.slice(9, 11);
  input.value = out;
}

async function lkLookup() {
  const raw = document.getElementById("lk-phone")?.value ?? "";
  const digits = raw.replace(/\D/g, "");
  const errEl = document.getElementById("lk-error");

  if (digits.length < 11) {
    errEl.textContent = "Введите полный номер телефона";
    errEl.style.display = "block";
    return;
  }
  errEl.style.display = "none";

  const btn = document.getElementById("lk-btn");
  btn.disabled = true;
  btn.textContent = "…";

  try {
    const res = await fetch("/api/loyalty/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: digits }),
    });
    const data = await res.json();
    btn.disabled = false;
    btn.textContent = "Найти";

    if (data.found === false) {
      errEl.textContent = "Номер не найден в программе лояльности";
      errEl.style.display = "block";
      return;
    }
    if (data.error) {
      errEl.textContent = data.error === "not_ready"
        ? "Сервис временно недоступен — попробуйте позже"
        : "Ошибка. Попробуйте позже";
      errEl.style.display = "block";
      return;
    }

    lkShowCabinet(data);
  } catch {
    btn.disabled = false;
    btn.textContent = "Найти";
    errEl.textContent = "Ошибка соединения. Попробуйте позже";
    errEl.style.display = "block";
  }
}

function lkShowCabinet(data) {
  document.getElementById("lk-enter").style.display = "none";
  document.getElementById("lk-cabinet").style.display = "block";

  document.getElementById("lk-name").textContent = data.name || "Участник клуба";
  document.getElementById("lk-level").textContent = data.level || "Мария для своих";
  document.getElementById("lk-balance").textContent =
    data.balance != null ? data.balance + " баллов" : "—";

  // Билеты
  const list = document.getElementById("lk-tickets-list");
  const empty = document.getElementById("lk-tickets-empty");
  list.innerHTML = "";

  const tickets = data.tickets || [];
  if (tickets.length === 0) {
    empty.style.display = "block";
  } else {
    empty.style.display = "none";
    tickets.forEach((t, i) => {
      const el = document.createElement("div");
      el.className = "lk-ticket";
      el.innerHTML = `
        <div class="lk-ticket__num">Билет #${t.id || (i + 1)}</div>
        <div class="lk-ticket__name">${t.name || "Сладкий чек"}</div>
        <div class="lk-ticket__date">${t.date || ""}</div>
      `;
      list.appendChild(el);
    });
  }
}

function lkReset() {
  document.getElementById("lk-cabinet").style.display = "none";
  document.getElementById("lk-enter").style.display = "block";
  document.getElementById("lk-phone").value = "";
  document.getElementById("lk-error").style.display = "none";
}

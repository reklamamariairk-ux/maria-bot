// ─── Loyalty: телефон → SMS → баланс ────────────────────────────────────────

let loyPhone = "";

function loyFormatPhone(input) {
  let v = input.value.replace(/\D/g, "");
  if (v.startsWith("8")) v = "7" + v.slice(1);
  if (!v.startsWith("7") && v.length > 0) v = "7" + v;
  v = v.slice(0, 11);
  let out = "";
  if (v.length > 0) out = "+7";
  if (v.length > 1) out += " (" + v.slice(1, 4);
  if (v.length >= 4) out += ") " + v.slice(4, 7);
  if (v.length >= 7) out += "-" + v.slice(7, 9);
  if (v.length >= 9) out += "-" + v.slice(9, 11);
  input.value = out;
}

function loyShowError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.style.display = "block";
}

function loyHideError(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "none";
}

function loySetLoading(btnEl, loading) {
  if (!btnEl) return;
  btnEl.disabled = loading;
  btnEl.textContent = loading ? "…" : btnEl.dataset.label || btnEl.textContent;
}

async function loyRequestCode() {
  loyHideError("loy-error");
  const raw = document.getElementById("loy-phone")?.value ?? "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 11) {
    loyShowError("loy-error", "Введите полный номер телефона");
    return;
  }
  loyPhone = digits;
  const btn = document.querySelector("#loy-step-phone .loy-btn");
  if (btn) { btn.dataset.label = "Получить код"; btn.disabled = true; btn.textContent = "…"; }
  try {
    const res = await fetch("/api/loyalty/send-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: loyPhone }),
    });
    const data = await res.json();
    if (btn) { btn.disabled = false; btn.textContent = "Получить код"; }
    if (data.ok) {
      document.getElementById("loy-step-phone").style.display = "none";
      document.getElementById("loy-step-code").style.display = "block";
      setTimeout(() => document.getElementById("loy-code")?.focus(), 100);
    } else {
      loyShowError("loy-error", data.message || "Ошибка. Попробуйте ещё раз");
    }
  } catch {
    if (btn) { btn.disabled = false; btn.textContent = "Получить код"; }
    loyShowError("loy-error", "Ошибка соединения. Попробуйте позже");
  }
}

async function loyVerifyCode() {
  loyHideError("loy-error2");
  const code = (document.getElementById("loy-code")?.value ?? "").trim();
  if (code.length < 4) {
    loyShowError("loy-error2", "Введите код из СМС");
    return;
  }
  const btn = document.querySelector("#loy-step-code .loy-btn");
  if (btn) { btn.dataset.label = "Проверить"; btn.disabled = true; btn.textContent = "…"; }
  try {
    const res = await fetch("/api/loyalty/verify-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: loyPhone, code }),
    });
    const data = await res.json();
    if (btn) { btn.disabled = false; btn.textContent = "Проверить"; }
    if (data.ok) {
      loyShowResult(data.data || {});
    } else {
      loyShowError("loy-error2", data.message || "Неверный код");
    }
  } catch {
    if (btn) { btn.disabled = false; btn.textContent = "Проверить"; }
    loyShowError("loy-error2", "Ошибка соединения. Попробуйте позже");
  }
}

function loyShowResult(d) {
  document.getElementById("loy-step-code").style.display = "none";
  document.getElementById("loy-step-result").style.display = "block";
  const nameEl = document.getElementById("loy-name");
  const levelEl = document.getElementById("loy-level");
  const balEl = document.getElementById("loy-balance");
  const cashEl = document.getElementById("loy-cashback");
  if (nameEl) nameEl.textContent = d.name || "";
  if (levelEl) levelEl.textContent = d.level ? "Уровень: " + d.level : "";
  if (balEl) balEl.textContent = d.balance || "Нет данных";
  if (cashEl) cashEl.textContent = d.cashback ? "Кэшбэк: " + d.cashback : "";
}

function loyBack() {
  loyHideError("loy-error2");
  document.getElementById("loy-step-code").style.display = "none";
  document.getElementById("loy-step-phone").style.display = "block";
}

function loyReset() {
  loyPhone = "";
  document.getElementById("loy-step-result").style.display = "none";
  document.getElementById("loy-step-phone").style.display = "block";
  const phoneInput = document.getElementById("loy-phone");
  if (phoneInput) phoneInput.value = "";
}

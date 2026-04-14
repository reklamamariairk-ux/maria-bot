/* ─── Telegram WebApp init ──────────────────────────────────────────────── */
if (window.Telegram?.WebApp) {
  const tg = window.Telegram.WebApp;
  tg.ready();
  tg.expand();
  // Подхватываем тему Telegram если есть
  if (tg.colorScheme === "dark") {
    document.documentElement.style.setProperty("--bg", "#1c1c1e");
    document.documentElement.style.setProperty("--surface", "#2c2c2e");
    document.documentElement.style.setProperty("--text", "#f2f2f7");
    document.documentElement.style.setProperty("--text-muted", "#aeaeb2");
  }
}

/* ─── Tab switching ─────────────────────────────────────────────────────── */
function switchTab(name) {
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));

  const tab = document.getElementById("tab-" + name);
  const btn = document.getElementById("nav-" + name);
  if (tab) tab.classList.add("active");
  if (btn) btn.classList.add("active");

  // Запускаем память при первом открытии вкладки игр
  if (name === "games" && !window._gamesInited) {
    window._gamesInited = true;
    initMemory();
  }
}

/* ─── Home helpers ──────────────────────────────────────────────────────── */
let _salesVisible = false;
let _contactsVisible = false;

function showSales() {
  const el = document.getElementById("sales-section");
  _salesVisible = !_salesVisible;
  el.style.display = _salesVisible ? "block" : "none";
  if (_salesVisible) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function showContacts() {
  const el = document.getElementById("contacts-section");
  _contactsVisible = !_contactsVisible;
  el.style.display = _contactsVisible ? "block" : "none";
  if (_contactsVisible) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

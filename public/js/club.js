/* ── Club / Loyalty frontend ─────────────────────────────────────────────── */

const initData = window.Telegram?.WebApp?.initData ?? "";

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (initData) headers["Authorization"] = "tma " + initData;
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) {
    return { __unauthorized: true };
  }
  return res.json();
}

// Cached state
let CLUB_STATE = {
  user: null,
  phoneVerified: false,
  balance: { stars: 0, points: 0 },
  daily: { loginClaimedToday: false, currentStreak: 0, starsEarnedToday: 0, starCap: 300 },
  catalog: [],
  myRewards: [],
};

/* ── Header counters ─────────────────────────────────────────────────────── */
function renderHeaderCounters() {
  const el = document.getElementById("hdr-counters");
  if (!el) return;
  if (!CLUB_STATE.phoneVerified) {
    el.style.display = "none";
    return;
  }
  el.style.display = "flex";
  document.getElementById("hdr-stars").textContent = CLUB_STATE.balance.stars;
  document.getElementById("hdr-points").textContent = CLUB_STATE.balance.points;
}

function pulseCounter(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("pulse");
  void el.offsetWidth;
  el.classList.add("pulse");
}

/* ── Init ────────────────────────────────────────────────────────────────── */
async function clubInit() {
  if (!initData) {
    document.getElementById("club-no-tg").style.display = "block";
    document.getElementById("club-content").style.display = "none";
    return;
  }
  await refreshMe();
  await loadCatalog();
  renderClub();
}

async function refreshMe() {
  const me = await api("/api/me");
  if (me.__unauthorized || me.error) {
    document.getElementById("club-no-tg").style.display = "block";
    document.getElementById("club-content").style.display = "none";
    return;
  }
  CLUB_STATE.user = me.user;
  CLUB_STATE.phoneVerified = me.phoneVerified;
  CLUB_STATE.balance = me.balance;
  CLUB_STATE.daily = me.daily;
  renderHeaderCounters();
}

async function loadCatalog() {
  const items = await api("/api/rewards");
  CLUB_STATE.catalog = Array.isArray(items) ? items : [];
}

async function loadMyRewards() {
  const items = await api("/api/my-rewards");
  CLUB_STATE.myRewards = Array.isArray(items) ? items : [];
}

/* ── Render ──────────────────────────────────────────────────────────────── */
function renderClub() {
  document.getElementById("club-no-tg").style.display = "none";
  document.getElementById("club-content").style.display = "block";

  // Verification banner vs. main UI
  if (!CLUB_STATE.phoneVerified) {
    document.getElementById("club-verify-banner").style.display = "block";
    document.getElementById("club-main").style.display = "none";
    return;
  }
  document.getElementById("club-verify-banner").style.display = "none";
  document.getElementById("club-main").style.display = "block";

  renderHero();
  renderDaily();
  renderLk();
  renderShop();
  renderMyRewardsBlock();
  renderReferral();
}

async function renderLk() {
  const section = document.getElementById('lk-section');
  const card = document.getElementById('lk-card');
  if (!section || !card) return;

  card.innerHTML = '<div class="lk-card__loading">Загружаем данные с maria-irk.ru…</div>';
  section.style.display = '';

  try {
    const data = await api('/api/lk');
    if (data.__unauthorized || data.error) {
      section.style.display = 'none';
      return;
    }
    if (!data.configured) {
      // Эндпоинт ещё не настроен на сайте — секцию не показываем
      section.style.display = 'none';
      return;
    }
    if (!data.found) {
      card.innerHTML = `
        <div class="lk-card__title">Аккаунта на maria-irk.ru не нашли</div>
        <div class="lk-card__sub">Зарегистрируйся на сайте по этому же номеру — и баллы синхронизируются.</div>
        <button class="btn-outline" onclick="openSite('https://www.maria-irk.ru/auth/?register=yes')">Зарегистрироваться →</button>`;
      return;
    }

    const tickets = (data.tickets || []).slice(0, 3);
    const ticketsCount = Number(data.tickets_count || tickets.length || 0);
    const orders = Array.isArray(data.orders) ? data.orders : [];
    card.innerHTML = `
      <div class="lk-card__row">
        <div>
          <div class="lk-card__name">${escapeHtml(data.name || 'Участник клуба')}</div>
          <div class="lk-card__level">${escapeHtml(data.level || 'Друзья')}</div>
        </div>
        <div class="lk-card__bal">
          <div class="lk-card__bal-num">${data.balance.toLocaleString('ru-RU')}</div>
          <div class="lk-card__bal-lb">баллов</div>
        </div>
      </div>
      ${data.year_spent ? `<div class="lk-card__year">За 12 мес: <b>${data.year_spent.toLocaleString('ru-RU')} ₽</b></div>` : ''}
      ${tickets.length ? `
        <div class="lk-card__tickets">
          <div class="lk-card__tt">🧾 Билеты «Сладкого чека»</div>
          ${tickets.map((t) => `
            <div class="lk-ti">
              <span class="lk-ti__num">#${escapeHtml(String(t.id))}</span>
              <span class="lk-ti__nm">${escapeHtml(t.name || 'Сладкий чек')}</span>
              <span class="lk-ti__dt">${escapeHtml(String(t.date || '').slice(0, 10))}</span>
            </div>`).join('')}
        </div>` : (ticketsCount > 0 ? `
        <div class="lk-card__tickets">
          <div class="lk-card__tt">🧾 Билеты «Сладкого чека»: <b>${ticketsCount}</b></div>
        </div>` : '')}
      ${orders.length ? `
        <div class="lk-card__orders">
          <div class="lk-card__tt">🛍 Мои заказы (${orders.length})</div>
          ${orders.slice(0, 5).map(renderOrderRow).join('')}
          ${orders.length > 5 ? `<div class="lk-ord-more">…и ещё ${orders.length - 5}</div>` : ''}
        </div>` : ''}
      <button class="btn-outline" onclick="openSite('https://www.maria-irk.ru/personal/')">Открыть полный кабинет →</button>
    `;
  } catch {
    section.style.display = 'none';
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function renderOrderRow(o) {
  const dateShort = String(o.date || '').slice(0, 10);
  const items = (o.items || []).slice(0, 2).map(i => `${i.qty}× ${i.name}`).join(', ');
  const more = (o.items || []).length > 2 ? ` +${o.items.length - 2}` : '';
  const statusCls = o.canceled ? 'lk-ord__st--cancel' : (o.paid ? 'lk-ord__st--paid' : '');
  return `
    <div class="lk-ord">
      <div class="lk-ord__row">
        <span class="lk-ord__id">#${o.id}</span>
        <span class="lk-ord__dt">${escapeHtml(dateShort)}</span>
        <span class="lk-ord__sum">${Number(o.sum).toLocaleString('ru-RU')} ₽</span>
      </div>
      <div class="lk-ord__row">
        <span class="lk-ord__items">${escapeHtml(items)}${more}</span>
        <span class="lk-ord__st ${statusCls}">${escapeHtml(o.status || '')}</span>
      </div>
    </div>`;
}

function renderHero() {
  const name = CLUB_STATE.user?.first_name || "Друг";
  document.getElementById("hero-name").textContent = name;
  document.getElementById("hero-stars").textContent = CLUB_STATE.balance.stars;
  document.getElementById("hero-points").textContent = CLUB_STATE.balance.points;

  const convertBtn = document.getElementById("hero-convert");
  convertBtn.style.display = CLUB_STATE.balance.stars >= 50 ? "" : "none";
}

function renderDaily() {
  const d = CLUB_STATE.daily;
  document.getElementById("daily-streak").textContent = d.currentStreak;
  const dots = document.getElementById("daily-dots");
  dots.innerHTML = "";
  const filled = Math.min(d.currentStreak % 7 || (d.currentStreak >= 7 ? 7 : 0), 7);
  for (let i = 0; i < 7; i++) {
    const dot = document.createElement("span");
    dot.className = "ddot " + (i < filled ? "ddot--on" : "");
    dots.appendChild(dot);
  }
  const btn = document.getElementById("daily-claim-btn");
  if (d.loginClaimedToday) {
    btn.disabled = true;
    btn.textContent = "Сегодня уже получено ✓";
  } else {
    btn.disabled = false;
    btn.textContent = "Получить +10 💎";
  }
}

function renderShop() {
  const wrap = document.getElementById("rewards-shop");
  wrap.innerHTML = "";
  const points = CLUB_STATE.balance.points;
  CLUB_STATE.catalog.forEach((r) => {
    const can = points >= r.cost_points;
    const card = document.createElement("div");
    card.className = "rcard" + (can ? "" : " rcard--locked");
    card.innerHTML = `
      <div class="rcard__title">${r.title}</div>
      <div class="rcard__sub">${r.description ?? ""}</div>
      <div class="rcard__min">от ${r.min_order} ₽</div>
      <div class="rcard__cost">${r.cost_points} 💎</div>
      <button class="rcard__btn" ${can ? "" : "disabled"} data-id="${r.id}">
        ${can ? "Получить" : "Не хватает"}
      </button>
    `;
    card.querySelector(".rcard__btn").addEventListener("click", () => openRedeemModal(r));
    wrap.appendChild(card);
  });
}

async function renderMyRewardsBlock() {
  await loadMyRewards();
  const wrap = document.getElementById("my-rewards");
  const count = document.getElementById("my-rewards-count");
  count.textContent = CLUB_STATE.myRewards.length;
  if (CLUB_STATE.myRewards.length === 0) {
    wrap.innerHTML = `<div class="my-rewards__empty">Пока нет промокодов — заработай и купи в магазине наград выше</div>`;
    return;
  }
  wrap.innerHTML = CLUB_STATE.myRewards
    .map((r) => {
      const exp = new Date(r.expires_at).toLocaleDateString("ru-RU");
      const used = r.used_at ? `<span class="prom__used">использован</span>` : "";
      return `
        <div class="prom">
          <div class="prom__head">
            <span class="prom__title">${r.title}</span>
            <span class="prom__exp">до ${exp}</span>
          </div>
          <div class="prom__code">
            <span class="prom__codetxt">${r.promo_code}</span>
            <button class="prom__copy" data-code="${r.promo_code}">📋</button>
          </div>
          ${used}
        </div>`;
    })
    .join("");
  wrap.querySelectorAll(".prom__copy").forEach((b) =>
    b.addEventListener("click", () => {
      const code = b.dataset.code;
      navigator.clipboard?.writeText(code);
      b.textContent = "✓";
      setTimeout(() => (b.textContent = "📋"), 1200);
    })
  );
}

function renderReferral() {
  if (!CLUB_STATE.user) return;
  const link = `https://t.me/mariatortik_bot?start=ref_${CLUB_STATE.user.id}`;
  document.getElementById("ref-link").value = link;
}

/* ── Verification ────────────────────────────────────────────────────────── */
function startVerification() {
  const tg = window.Telegram?.WebApp;
  if (!tg) {
    alert("Откройте через Telegram");
    return;
  }
  if (typeof tg.requestContact !== "function") {
    tg.showAlert?.(
      "Подтверждение через приложение требует Telegram 6.9+. Откройте /start в боте — там кнопка «Поделиться номером»"
    );
    return;
  }
  tg.requestContact(async (sent, response) => {
    if (!sent && response?.status !== "sent") return;
    // Phone arrives via bot's contact handler. Poll /api/me for verification.
    document.getElementById("verify-status").textContent = "Сохраняем номер…";
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      await refreshMe();
      if (CLUB_STATE.phoneVerified) break;
    }
    if (CLUB_STATE.phoneVerified) {
      document.getElementById("verify-status").textContent = "";
      tg.HapticFeedback?.notificationOccurred?.("success");
      renderClub();
    } else {
      document.getElementById("verify-status").textContent =
        "Не пришёл контакт от Telegram. Попробуй ещё раз или открой /start в боте.";
    }
  });
}

/* ── Daily claim ─────────────────────────────────────────────────────────── */
async function claimDaily() {
  const btn = document.getElementById("daily-claim-btn");
  btn.disabled = true;
  const r = await api("/api/daily/claim", { method: "POST" });
  if (r.ok) {
    CLUB_STATE.balance = r.balance;
    CLUB_STATE.daily.loginClaimedToday = true;
    CLUB_STATE.daily.currentStreak = r.streakDays || CLUB_STATE.daily.currentStreak;
    pulseCounter("hdr-points");
    let msg = `+${r.pointsAwarded} 💎`;
    if (r.streakBonus) msg += ` (бонус за стрик: +${r.streakBonus} 💎)`;
    window.Telegram?.WebApp?.showPopup?.({ title: "Награда дня", message: msg, buttons: [{ type: "ok" }] }) ||
      alert(msg);
    renderHeaderCounters();
    renderHero();
    renderDaily();
    renderShop();
  } else {
    btn.textContent = r.reason === "already_claimed_today" ? "Сегодня уже получено ✓" : "Ошибка";
  }
}

/* ── Conversion modal ────────────────────────────────────────────────────── */
async function openConvertModal() {
  const tiers = await api("/api/conversion-tiers");
  const have = CLUB_STATE.balance.stars;
  const modal = document.getElementById("convert-modal");
  const optsWrap = document.getElementById("convert-options");
  optsWrap.innerHTML = tiers
    .map((t) => {
      const can = have >= t.stars;
      const ratio = t.stars > 0 ? Math.round((t.points / (t.stars * 0.1) - 100)) : 0; // % bonus over base 10:1
      return `
        <label class="ctier ${can ? "" : "ctier--off"}">
          <input type="radio" name="ctier" value="${t.stars}" ${can ? "" : "disabled"}/>
          <span class="ctier__txt">${t.stars} ⭐ → <b>${t.points} 💎</b>${ratio > 0 ? ` <em>+${ratio}%</em>` : ""}</span>
        </label>`;
    })
    .join("");
  document.getElementById("convert-have").textContent = have;
  modal.style.display = "flex";
}

function closeConvertModal() {
  document.getElementById("convert-modal").style.display = "none";
}

async function doConvert() {
  const sel = document.querySelector('#convert-options input[name="ctier"]:checked');
  if (!sel) return;
  const stars = Number(sel.value);
  const r = await api("/api/convert", { method: "POST", body: JSON.stringify({ stars }) });
  if (r.ok) {
    CLUB_STATE.balance = r.balance;
    pulseCounter("hdr-points");
    pulseCounter("hdr-stars");
    closeConvertModal();
    renderHeaderCounters();
    renderHero();
    renderShop();
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.("success");
  } else {
    alert(r.reason === "insufficient_stars" ? "Не хватает звёзд" : "Ошибка обмена");
  }
}

/* ── Redeem modal ────────────────────────────────────────────────────────── */
let CURRENT_REDEEM = null;
function openRedeemModal(reward) {
  CURRENT_REDEEM = reward;
  const m = document.getElementById("redeem-modal");
  document.getElementById("redeem-title").textContent = reward.title;
  document.getElementById("redeem-desc").textContent = reward.description ?? "";
  document.getElementById("redeem-min").textContent = `Мин. заказ: ${reward.min_order} ₽`;
  document.getElementById("redeem-cost").textContent = `Спишется: ${reward.cost_points} 💎`;
  document.getElementById("redeem-after").textContent =
    `Останется: ${CLUB_STATE.balance.points - reward.cost_points} 💎`;
  document.getElementById("redeem-result").style.display = "none";
  document.getElementById("redeem-confirm").style.display = "";
  m.style.display = "flex";
}

function closeRedeemModal() {
  document.getElementById("redeem-modal").style.display = "none";
  CURRENT_REDEEM = null;
}

async function doRedeem() {
  if (!CURRENT_REDEEM) return;
  const r = await api("/api/redeem", {
    method: "POST",
    body: JSON.stringify({ rewardId: CURRENT_REDEEM.id }),
  });
  if (r.ok) {
    CLUB_STATE.balance = r.balance;
    pulseCounter("hdr-points");
    document.getElementById("redeem-confirm").style.display = "none";
    document.getElementById("redeem-result").style.display = "";
    document.getElementById("redeem-code").textContent = r.promoCode;
    const exp = new Date(r.expiresAt).toLocaleDateString("ru-RU");
    document.getElementById("redeem-code-exp").textContent = `Действует до ${exp}`;
    renderHeaderCounters();
    renderHero();
    renderShop();
    renderMyRewardsBlock();
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.("success");
  } else {
    alert(r.reason === "insufficient" ? "Не хватает баллов" : "Ошибка получения");
  }
}

function copyRedeemCode() {
  const code = document.getElementById("redeem-code").textContent;
  navigator.clipboard?.writeText(code);
  document.getElementById("redeem-copy").textContent = "Скопировано ✓";
  setTimeout(() => (document.getElementById("redeem-copy").textContent = "Копировать"), 1500);
}

/* ── Referral ────────────────────────────────────────────────────────────── */
function shareReferral() {
  const link = document.getElementById("ref-link").value;
  const text = `Заходи в Marию — бот кондитерской «Мария» в Иркутске. Игры, скидки, бонусы 🎂`;
  const tg = window.Telegram?.WebApp;
  if (tg?.openTelegramLink) {
    tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
  } else {
    navigator.clipboard?.writeText(link);
    alert("Ссылка скопирована");
  }
}

/* ── History ─────────────────────────────────────────────────────────────── */
async function toggleHistory() {
  const wrap = document.getElementById("history-wrap");
  const list = document.getElementById("history-list");
  if (wrap.style.display === "none" || !wrap.style.display) {
    wrap.style.display = "block";
    list.innerHTML = "<div class='history-loading'>Загружаем…</div>";
    const rows = await api("/api/history");
    if (!Array.isArray(rows) || rows.length === 0) {
      list.innerHTML = "<div class='history-empty'>Пока операций нет</div>";
      return;
    }
    list.innerHTML = rows
      .map((r) => {
        const sign = r.amount > 0 ? "+" : "";
        const icon = r.kind === "star" ? "⭐" : "💎";
        const dt = new Date(r.created_at).toLocaleString("ru-RU", {
          day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
        });
        return `<div class="hrow"><span class="hrow__amt ${r.amount > 0 ? "pos" : "neg"}">${sign}${r.amount} ${icon}</span><span class="hrow__src">${SOURCE_LABELS[r.source] ?? r.source}</span><span class="hrow__dt">${dt}</span></div>`;
      })
      .join("");
  } else {
    wrap.style.display = "none";
  }
}

const SOURCE_LABELS = {
  daily_login: "Ежедневный вход",
  streak_7: "Стрик 7 дней",
  streak_30: "Стрик 30 дней",
  phone_verification: "Подтверждение номера",
  star_conversion: "Обмен звёзд",
  reward: "Покупка награды",
  referral: "Реферал",
  flappy_cake: "Flappy Cake",
  memory: "Memory",
  bakery: "Пекарня",
  record_bonus: "Новый рекорд",
  conversion: "Обмен на баллы",
};

/* ── Game integration ────────────────────────────────────────────────────── */
window.submitGameResult = async function (game, score) {
  if (!CLUB_STATE.phoneVerified) return null;
  const r = await api("/api/game-result", { method: "POST", body: JSON.stringify({ game, score }) });
  if (r && !r.error && r.balance) {
    CLUB_STATE.balance = r.balance;
    renderHeaderCounters();
    pulseCounter("hdr-stars");
  }
  return r;
};

/* ── Hooks ───────────────────────────────────────────────────────────────── */
window.clubInit = clubInit;
window.startVerification = startVerification;
window.claimDaily = claimDaily;
window.openConvertModal = openConvertModal;
window.closeConvertModal = closeConvertModal;
window.doConvert = doConvert;
window.openRedeemModal = openRedeemModal;
window.closeRedeemModal = closeRedeemModal;
window.doRedeem = doRedeem;
window.copyRedeemCode = copyRedeemCode;
window.shareReferral = shareReferral;
window.toggleHistory = toggleHistory;

document.addEventListener("DOMContentLoaded", () => {
  clubInit().catch((e) => console.error("[club init]", e));
});

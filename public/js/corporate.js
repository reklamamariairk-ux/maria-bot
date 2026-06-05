/* ── Корпоративные заказы (B2B) ───────────────────────────────────────── */

const CORP_STATE = {
  event_type: '',
  budget: '',
  extras: new Set(),
};

const CORP_EVENT_TYPES = [
  { val: 'Корпоратив',         emoji: '🎉' },
  { val: 'ДР сотрудника',      emoji: '🎂' },
  { val: 'Презентация',        emoji: '📊' },
  { val: 'Подарки партнёрам',  emoji: '🤝' },
  { val: 'Праздник в офисе',   emoji: '🏢' },
  { val: 'Другое',             emoji: '✨' },
];

const CORP_BUDGETS = [
  'до 10 000 ₽',
  '10 — 30 000 ₽',
  '30 — 50 000 ₽',
  '50 — 100 000 ₽',
  '100 000+ ₽',
];

const CORP_EXTRAS = [
  { val: 'Логотип на упаковке',     emoji: '🖋' },
  { val: 'Доставка к точному часу', emoji: '⏰' },
  { val: 'Меню по согласованию',    emoji: '📝' },
  { val: 'Закрывающие документы',   emoji: '📄' },
  { val: 'Брендирование',           emoji: '🎨' },
];

function openCorpForm() {
  ensureCorpModal();
  // Сброс состояния
  CORP_STATE.event_type = '';
  CORP_STATE.budget = '';
  CORP_STATE.extras = new Set();
  renderCorpForm();
  document.getElementById('corp-modal').style.display = 'flex';
  window.scrollLock?.();
  window.haptic?.('light');
}
window.openCorpForm = openCorpForm;

function closeCorpForm() {
  const m = document.getElementById('corp-modal');
  if (m) m.style.display = 'none';
  window.scrollUnlock?.();
}
window.closeCorpForm = closeCorpForm;

function ensureCorpModal() {
  if (document.getElementById('corp-modal')) return;
  const m = document.createElement('div');
  m.id = 'corp-modal';
  m.className = 'cat-modal';
  m.style.display = 'none';
  m.onclick = (e) => { if (e.target === m) closeCorpForm(); };
  m.innerHTML = `
    <div class="cat-modal__sheet corp__sheet">
      <button class="cat-modal__close" onclick="closeCorpForm()">×</button>
      <div class="corp__h">🏢 Корпоративный заказ</div>
      <div class="corp__sub">Менеджер свяжется в течение 2 часов в рабочее время</div>

      <form class="corp__form" id="corp-form" onsubmit="submitCorpForm(event)">
        <div class="corp__row">
          <label class="corp__lbl">Компания</label>
          <input class="corp__inp" id="corp-company" type="text" placeholder="ООО «Ромашка»" autocomplete="organization"/>
        </div>

        <div class="corp__row">
          <label class="corp__lbl">Контактное лицо <span class="corp__req">*</span></label>
          <input class="corp__inp" id="corp-contact" type="text" placeholder="ФИО" required autocomplete="name"/>
        </div>

        <div class="corp__row corp__row--two">
          <div class="corp__col">
            <label class="corp__lbl">Телефон <span class="corp__req">*</span></label>
            <input class="corp__inp" id="corp-phone" type="tel" placeholder="+7 (___) ___-__-__" required autocomplete="tel" inputmode="tel" oninput="phoneMask && phoneMask(this)"/>
          </div>
          <div class="corp__col">
            <label class="corp__lbl">Email</label>
            <input class="corp__inp" id="corp-email" type="email" placeholder="manager@company.ru" autocomplete="email"/>
          </div>
        </div>

        <div class="corp__row corp__row--col">
          <label class="corp__lbl">Тип события</label>
          <div class="corp__chips" id="corp-event-chips"></div>
        </div>

        <div class="corp__row corp__row--two">
          <div class="corp__col">
            <label class="corp__lbl">Гостей</label>
            <input class="corp__inp" id="corp-people" type="number" min="1" max="2000" value="30" inputmode="numeric"/>
          </div>
          <div class="corp__col">
            <label class="corp__lbl">Дата</label>
            <input class="corp__inp" id="corp-date" type="date"/>
          </div>
        </div>

        <div class="corp__row corp__row--two">
          <div class="corp__col">
            <label class="corp__lbl">Время</label>
            <input class="corp__inp" id="corp-time" type="time"/>
          </div>
          <div class="corp__col">
            <label class="corp__lbl">Бюджет</label>
            <select class="corp__inp" id="corp-budget">
              <option value="">— уточним —</option>
              ${CORP_BUDGETS.map((b) => `<option value="${b}">${b}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="corp__row corp__row--col">
          <label class="corp__lbl">Адрес доставки</label>
          <input class="corp__inp" id="corp-address" type="text" placeholder="г. Иркутск, ул. ..." autocomplete="street-address"/>
        </div>

        <div class="corp__row corp__row--col">
          <label class="corp__lbl">Доп. услуги</label>
          <div class="corp__chips" id="corp-extras-chips"></div>
        </div>

        <div class="corp__row corp__row--col">
          <label class="corp__lbl">Комментарий</label>
          <textarea class="corp__inp corp__textarea" id="corp-comment" rows="3" placeholder="Особые пожелания, специфика мероприятия…"></textarea>
        </div>

        <div class="corp__actions">
          <button type="button" class="btn-outline" onclick="closeCorpForm()">Отмена</button>
          <button type="submit" class="btn-full" id="corp-submit">Отправить заявку →</button>
        </div>
        <div class="rv-writer__err" id="corp-err" style="display:none"></div>
      </form>
    </div>`;
  document.body.appendChild(m);
}

function renderCorpForm() {
  const ev = document.getElementById('corp-event-chips');
  if (ev) {
    ev.innerHTML = CORP_EVENT_TYPES.map((t) => `
      <button type="button" class="corp__chip ${CORP_STATE.event_type === t.val ? 'corp__chip--on' : ''}"
              data-haptic="selection" onclick="corpPickEvent('${escapeAttr(t.val)}')">${t.emoji} ${escapeHtml(t.val)}</button>
    `).join('');
  }
  const ex = document.getElementById('corp-extras-chips');
  if (ex) {
    ex.innerHTML = CORP_EXTRAS.map((e) => `
      <button type="button" class="corp__chip ${CORP_STATE.extras.has(e.val) ? 'corp__chip--on' : ''}"
              data-haptic="selection" onclick="corpToggleExtra('${escapeAttr(e.val)}')">${e.emoji} ${escapeHtml(e.val)}</button>
    `).join('');
  }
}

function corpPickEvent(val) {
  CORP_STATE.event_type = val;
  renderCorpForm();
  window.haptic?.('selection');
}
window.corpPickEvent = corpPickEvent;

function corpToggleExtra(val) {
  if (CORP_STATE.extras.has(val)) CORP_STATE.extras.delete(val);
  else CORP_STATE.extras.add(val);
  renderCorpForm();
  window.haptic?.('selection');
}
window.corpToggleExtra = corpToggleExtra;

async function submitCorpForm(e) {
  e.preventDefault();
  const company = document.getElementById('corp-company')?.value.trim() || '';
  const contact = document.getElementById('corp-contact')?.value.trim() || '';
  const phone   = document.getElementById('corp-phone')?.value.trim() || '';
  const email   = document.getElementById('corp-email')?.value.trim() || '';
  const people  = Number(document.getElementById('corp-people')?.value) || 0;
  const date    = document.getElementById('corp-date')?.value || '';
  const time    = document.getElementById('corp-time')?.value || '';
  const address = document.getElementById('corp-address')?.value.trim() || '';
  const comment = document.getElementById('corp-comment')?.value.trim() || '';
  const budget  = document.getElementById('corp-budget')?.value || '';
  const errEl = document.getElementById('corp-err');
  const submitBtn = document.getElementById('corp-submit');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

  if (!contact || !phone) {
    if (errEl) { errEl.textContent = 'Заполни контактное лицо и телефон'; errEl.style.display = ''; }
    return;
  }

  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Отправляем…'; }
  try {
    const r = await fetch('/api/lead-corporate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company, contact_name: contact, phone, email,
        event_type: CORP_STATE.event_type, people, budget,
        date, time, address,
        extras: [...CORP_STATE.extras],
        comment,
      }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      if (errEl) { errEl.textContent = data?.error || 'Не удалось отправить'; errEl.style.display = ''; }
      return;
    }
    window.haptic?.('success');
    closeCorpForm();
    App.alert('✅ Заявка отправлена! Менеджер свяжется в течение 2 часов.');
  } catch {
    if (errEl) { errEl.textContent = 'Ошибка сети'; errEl.style.display = ''; }
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Отправить заявку →'; }
  }
}
window.submitCorpForm = submitCorpForm;

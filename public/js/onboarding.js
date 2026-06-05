/* ─── Cinematic onboarding «33 года Марии» ──────────────────────────────────
   Показывается один раз на новом устройстве — 3 swipeable экрана с историей
   бренда. Параллакс + zoom на смене панели. Сохраняем флаг в localStorage.
*/

const ONBOARDING_KEY = 'maria_onboarding_seen_v1';

const ONBOARDING_PANELS = [
  {
    year: '1992',
    headline: 'Маша начала с маленькой кухни',
    body: 'Один противень, один рецепт Медовика — и желание накормить весь Иркутск.',
    photo: '/assets/onboarding/1992.jpg', // если файла нет — fallback на gradient
    tone: 'sepia',
  },
  {
    year: '2008',
    headline: 'Первое кафе на Ленина',
    body: 'Когда люди начали приезжать через весь город — мы поняли, что нужны стены.',
    photo: '/assets/onboarding/2008.jpg',
    tone: 'classic',
  },
  {
    year: '2026',
    headline: '17 кафе. И всё ещё рецепты Марии',
    body: 'Современная Россия выбирает «домашнее». Мы держим это слово 33 года.',
    photo: '/assets/onboarding/2026.jpg',
    tone: 'now',
  },
];

function shouldShowOnboarding() {
  try {
    return !localStorage.getItem(ONBOARDING_KEY);
  } catch { return false; }
}

function markOnboardingSeen() {
  try { localStorage.setItem(ONBOARDING_KEY, '1'); } catch {}
}

function openOnboarding() {
  if (document.getElementById('onboarding')) return;
  const root = document.createElement('div');
  root.id = 'onboarding';
  root.className = 'onb';
  root.innerHTML = `
    <div class="onb__track" id="onb-track">
      ${ONBOARDING_PANELS.map((p, i) => `
        <div class="onb__panel onb__panel--${p.tone}" data-idx="${i}">
          <div class="onb__photo" style="background-image: url('${p.photo}')"></div>
          <div class="onb__vignette"></div>
          <div class="onb__content">
            <div class="onb__year">${p.year}</div>
            <div class="onb__h">${p.headline}</div>
            <div class="onb__body">${p.body}</div>
          </div>
        </div>
      `).join('')}
    </div>
    <button class="onb__skip" onclick="closeOnboarding()" aria-label="Пропустить">Пропустить</button>
    <div class="onb__dots" id="onb-dots">
      ${ONBOARDING_PANELS.map((_, i) => `<span class="onb__dot${i === 0 ? ' is-active' : ''}" data-idx="${i}"></span>`).join('')}
    </div>
    <div class="onb__nav">
      <button class="onb__cta" id="onb-cta" onclick="onboardingNext()">Далее →</button>
    </div>
  `;
  document.body.appendChild(root);
  document.body.style.overflow = 'hidden';
  setupOnboardingScroll();
  // Haptic on launch
  window.haptic?.('light');
}
window.openOnboarding = openOnboarding;

function closeOnboarding() {
  const r = document.getElementById('onboarding');
  if (r) {
    r.classList.add('onb--closing');
    setTimeout(() => r.remove(), 350);
  }
  document.body.style.overflow = '';
  markOnboardingSeen();
  window.haptic?.('success');
}
window.closeOnboarding = closeOnboarding;

let _onbIdx = 0;
function setupOnboardingScroll() {
  const track = document.getElementById('onb-track');
  if (!track) return;
  // Считаем активную панель по скроллу (CSS scroll-snap делает работу)
  let timeout;
  track.addEventListener('scroll', () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      const w = track.clientWidth;
      const idx = Math.round(track.scrollLeft / w);
      if (idx !== _onbIdx) {
        _onbIdx = idx;
        updateOnboardingState();
        window.haptic?.('selection');
      }
    }, 80);
  }, { passive: true });
}

function updateOnboardingState() {
  const dots = document.querySelectorAll('#onb-dots .onb__dot');
  dots.forEach((d, i) => d.classList.toggle('is-active', i === _onbIdx));
  const cta = document.getElementById('onb-cta');
  if (cta) {
    cta.textContent = _onbIdx === ONBOARDING_PANELS.length - 1 ? 'Начать ✨' : 'Далее →';
  }
}

function onboardingNext() {
  if (_onbIdx >= ONBOARDING_PANELS.length - 1) {
    closeOnboarding();
    return;
  }
  const track = document.getElementById('onb-track');
  if (track) {
    track.scrollTo({ left: (_onbIdx + 1) * track.clientWidth, behavior: 'smooth' });
  }
}
window.onboardingNext = onboardingNext;

// Авто-запуск на новом устройстве
document.addEventListener('DOMContentLoaded', () => {
  if (shouldShowOnboarding()) {
    setTimeout(openOnboarding, 350);
  }
  vkFirstLaunchExtras();
});

/* ── VK-специфика первого запуска ────────────────────────────────────────────
   1) Просим разрешение на сообщения сообщества (один раз) — без него не
      работают пуши: статусы заказов, ДР, праздники.
   2) Редимим реферальный код из hash (#ref_MARIA-XXX) — в TG это делает бот
      на /start, в VK бот-команд нет, делаем с фронта. Сервер дедупит по юзеру. */
function vkFirstLaunchExtras() {
  if (window.App?.platform !== 'vk') return;

  // Реферальный deep-link
  try {
    const sp = App.startParam();
    if (sp && sp.startsWith('ref_') && !localStorage.getItem('maria_vk_ref_done')) {
      fetch('/api/referral/use', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...App.authHeader() },
        body: JSON.stringify({ code: sp.slice(4) }),
      }).then((r) => {
        // 400 = свой код/уже использовал — тоже не повторяем
        if (r.ok || r.status === 400) try { localStorage.setItem('maria_vk_ref_done', '1'); } catch {}
      }).catch(() => {});
    }
  } catch {}

  // Разрешение сообщений — после онбординга/первой паузы, один раз
  try {
    if (!localStorage.getItem('maria_vk_msg_asked_v1')) {
      const ask = () => {
        App.allowMessages().finally(() => {
          try { localStorage.setItem('maria_vk_msg_asked_v1', '1'); } catch {}
        });
      };
      // Не наслаиваемся на онбординг: ждём его закрытия либо 4с
      const delay = shouldShowOnboarding() ? 1000 : 4000;
      const timer = setInterval(() => {
        if (!document.getElementById('onboarding')) {
          clearInterval(timer);
          setTimeout(ask, 800);
        }
      }, delay);
    }
  } catch {}
}

// Дев-toggle для теста: ?onboarding=1 принудительно показывает
try {
  const u = new URL(window.location.href);
  if (u.searchParams.get('onboarding') === '1') {
    setTimeout(openOnboarding, 100);
  }
  if (u.searchParams.get('onboarding') === 'reset') {
    try { localStorage.removeItem(ONBOARDING_KEY); } catch {}
  }
} catch {}

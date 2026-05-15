// Календарь ключевых праздников и pre-order push.
//
// Each holiday triggers a one-time push N days before the date, where N is
// preorderDays. Dates are computed for the current year (or next year if
// the date has already passed). The frontend reads /api/holidays/upcoming
// to render the «Скоро праздник» card on Home.

export interface Holiday {
  id: string;            // stable key: 'women-day', 'new-year', ...
  name: string;          // human-readable
  emoji: string;
  /** Месяц 1..12 (январь = 1) */
  month: number;
  /** День месяца 1..31 */
  day: number;
  /** За сколько дней до даты делать pre-order push */
  preorderDays: number;
  /** Текст body для push (без эмодзи в начале — добавим автоматически) */
  pushBody: (daysBefore: number) => string;
  /** Подсказка для карточки на главной */
  hint: string;
  /** Категория или поисковый запрос для подборки */
  searchQuery?: string;
  /** Accent цвет для карточки (CSS-color) */
  accent?: string;
}

// Список захардкожен для повторяющихся каждый год дат.
// Пасха/Масленица плавают — для них нужны явные даты по годам, добавим позже.
export const HOLIDAYS: Holiday[] = [
  {
    id: "new-year",
    name: "Новый год",
    emoji: "🎄",
    month: 12, day: 31,
    preorderDays: 10,
    hint: "Праздничные торты, наборы, корпоративы",
    searchQuery: "новогодний",
    accent: "#0a6b34",
    pushBody: (d) => `До Нового года ${d} ${pluralDay(d)}. Праздничные торты и наборы лучше заказать сейчас — на 31 декабря всегда аншлаг. Открой Mini App и выбери своё 🎄`,
  },
  {
    id: "valentine",
    name: "День святого Валентина",
    emoji: "💝",
    month: 2, day: 14,
    preorderDays: 5,
    hint: "Десерты-сердечки, бенто-торты «I love you»",
    searchQuery: "сердце",
    accent: "#d61f37",
    pushBody: (d) => `Через ${d} ${pluralDay(d)} — 14 февраля. Бенто-сердечки и наборы на двоих делаем под заказ. Заходи в Mini App 💝`,
  },
  {
    id: "defender",
    name: "23 февраля",
    emoji: "🎖",
    month: 2, day: 23,
    preorderDays: 5,
    hint: "Торты «Защитнику», брутальные наборы",
    searchQuery: "23 февраля",
    accent: "#2c4a3e",
    pushBody: (d) => `23 февраля через ${d} ${pluralDay(d)}. Для пап, мужей и сыновей — мужские торты и наборы. Успей заказать в Mini App 🎖`,
  },
  {
    id: "women-day",
    name: "8 марта",
    emoji: "🌷",
    month: 3, day: 8,
    preorderDays: 7,
    hint: "Букеты-тортики, нежные десерты",
    searchQuery: "8 марта",
    accent: "#e88aa8",
    pushBody: (d) => `8 марта уже через ${d} ${pluralDay(d)}. Торты-букеты и нежные наборы лучше брать заранее — на 8-е будет очередь. Открой Mini App 🌷`,
  },
  {
    id: "victory",
    name: "9 мая",
    emoji: "🎗",
    month: 5, day: 9,
    preorderDays: 5,
    hint: "Праздничные торты к семейному столу",
    searchQuery: "9 мая",
    accent: "#9c6a06",
    pushBody: (d) => `9 мая через ${d} ${pluralDay(d)}. Праздничный торт к семейному столу — закажи заранее 🎗`,
  },
  {
    id: "children-day",
    name: "День защиты детей",
    emoji: "🧒",
    month: 6, day: 1,
    preorderDays: 5,
    hint: "Детские торты, наборы со скидкой",
    searchQuery: "детский",
    accent: "#f0a020",
    pushBody: (d) => `1 июня — День защиты детей, осталось ${d} ${pluralDay(d)}. Детские торты делаем за 48 часов. Открой Mini App 🧒`,
  },
  {
    id: "knowledge",
    name: "1 сентября",
    emoji: "🎒",
    month: 9, day: 1,
    preorderDays: 5,
    hint: "Тортики к первому звонку и линейке",
    searchQuery: "школа",
    accent: "#8a4a82",
    pushBody: (d) => `1 сентября через ${d} ${pluralDay(d)}. Тортики к первому звонку и угощения в школу — закажи в Mini App 🎒`,
  },
];

function pluralDay(n: number): string {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "дня";
  return "дней";
}

// Преобразовать праздник в конкретную дату (ближайшую: текущий год или следующий)
export interface HolidayOccurrence {
  holiday: Holiday;
  date: Date;          // в полночь UTC
  year: number;
  daysUntil: number;   // целое число дней от сегодня
}

/** Сегодня в Иркутске (UTC+8), в полночь */
function todayIrkutskUtc(now = new Date()): Date {
  // Иркутск UTC+8. Полночь Иркутска = 16:00 UTC предыдущего дня.
  // Для расчёта «сколько дней до» используем полночь в Иркутске,
  // которая соответствует UTC timestamp T = midnight Irkutsk = midnight UTC same day - 8h.
  const utcMs = now.getTime();
  const irkMs = utcMs + 8 * 3600 * 1000;
  const irkDate = new Date(irkMs);
  // Полночь Иркутска в виде UTC date (год/месяц/день берём от irkDate, час=0)
  return new Date(Date.UTC(irkDate.getUTCFullYear(), irkDate.getUTCMonth(), irkDate.getUTCDate()));
}

function holidayDateUtc(h: Holiday, year: number): Date {
  return new Date(Date.UTC(year, h.month - 1, h.day));
}

export function getHolidayOccurrence(h: Holiday, now = new Date()): HolidayOccurrence {
  const today = todayIrkutskUtc(now);
  const thisYear = today.getUTCFullYear();
  let date = holidayDateUtc(h, thisYear);
  if (date.getTime() < today.getTime()) {
    date = holidayDateUtc(h, thisYear + 1);
  }
  const daysUntil = Math.round((date.getTime() - today.getTime()) / (24 * 3600 * 1000));
  return { holiday: h, date, year: date.getUTCFullYear(), daysUntil };
}

/** Все праздники, отсортированные по близости. Возвращает occurrences. */
export function getUpcomingHolidays(now = new Date()): HolidayOccurrence[] {
  return HOLIDAYS
    .map((h) => getHolidayOccurrence(h, now))
    .sort((a, b) => a.daysUntil - b.daysUntil);
}

/** Ближайший праздник в окне до 60 дней (для карточки на главной) */
export function getNextHoliday(now = new Date()): HolidayOccurrence | null {
  const list = getUpcomingHolidays(now);
  const next = list.find((o) => o.daysUntil >= 0 && o.daysUntil <= 60);
  return next ?? null;
}

/** Праздники, для которых сегодня нужно отправить pre-order push */
export function getHolidaysToPushToday(now = new Date()): HolidayOccurrence[] {
  return getUpcomingHolidays(now).filter((o) => o.daysUntil === o.holiday.preorderDays);
}

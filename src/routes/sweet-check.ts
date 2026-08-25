/**
 * Sweet Check routes — недели заданий + призы лотереи.
 * Источники: `data/sweet-check-weeks.json`, `data/sweet-check-prizes.json`.
 *
 * Эндпоинты:
 * - GET  /api/sweet-check/active    — активная/следующая неделя
 * - GET  /api/sweet-check/prizes    — конфиг призов
 * - POST /api/admin/sweet-check/reload         — hot-reload недель (admin)
 * - POST /api/admin/sweet-check-prizes/reload  — hot-reload призов (admin)
 *
 * Loaders с кэшем; на ошибку чтения файла — fallback на хардкод.
 */

import { Router } from "express";
import * as fs from "fs";
import * as path from "path";
import { rateLimit, requireAdminRole, requireAdminToken } from "../middleware";
import { log } from "../logger";

const router = Router();

// ── Недели заданий ─────────────────────────────────────────────────────────
interface SweetWeek {
  from: string; to: string; name: string; task: string; reward: string;
}
const WEEKS_FALLBACK: SweetWeek[] = [
  { from: "2026-04-13", to: "2026-04-19", name: "Неделя 4 · Старт",         task: "Купи набор «Семейный»", reward: "5 билетов" },
  { from: "2026-04-20", to: "2026-04-26", name: "Неделя 5 · Сезон ягод",    task: "Купи 2 пирога с ягодной начинкой", reward: "5 билетов" },
  { from: "2026-04-27", to: "2026-05-03", name: "Неделя 6 · Капкейки",      task: "Купи 4 капкейка любых вкусов", reward: "5 билетов" },
  { from: "2026-05-04", to: "2026-05-10", name: "Неделя 7 · Подарок другу", task: "Купи бенто-торт + капкейк или десерт в стакане", reward: "5 билетов" },
];
const WEEKS_FILE = path.join(__dirname, "..", "..", "data", "sweet-check-weeks.json");
let _weeksCache: SweetWeek[] | null = null;

function loadSweetCheckWeeks(): SweetWeek[] {
  if (_weeksCache) return _weeksCache;
  try {
    if (fs.existsSync(WEEKS_FILE)) {
      const raw = fs.readFileSync(WEEKS_FILE, "utf-8");
      const data = JSON.parse(raw) as { weeks?: SweetWeek[] };
      if (Array.isArray(data.weeks) && data.weeks.length > 0) {
        _weeksCache = data.weeks;
        return _weeksCache;
      }
    }
  } catch (e) {
    log.error({ err: e }, "[sweet-check] weeks load failed");
  }
  _weeksCache = WEEKS_FALLBACK;
  return _weeksCache;
}

router.get("/api/sweet-check/active", rateLimit(60), (_req, res) => {
  const weeks = loadSweetCheckWeeks();
  // Иркутск = UTC+8; недели заданы по местному календарю.
  const now = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const active = weeks.find((w) => w.from <= now && now <= w.to) ?? null;
  const next   = weeks.find((w) => w.from > now) ?? null;
  const fmt = (d: string) => { const [y, m, dd] = d.split("-"); return `${dd}.${m}.${y}`; };
  res.json({
    active: active ? { ...active, dates: `${fmt(active.from)} — ${fmt(active.to)}` } : null,
    next:   next   ? { ...next,   dates: `${fmt(next.from)} — ${fmt(next.to)}` }     : null,
    period: { from: weeks[0]?.from, to: weeks.at(-1)?.to },
  });
});

router.post("/api/admin/sweet-check/reload", requireAdminToken, requireAdminRole("operator"), (_req, res) => {
  _weeksCache = null;
  const weeks = loadSweetCheckWeeks();
  res.json({ ok: true, total: weeks.length, first: weeks[0]?.from, last: weeks.at(-1)?.to });
});

// ── Призы лотереи ──────────────────────────────────────────────────────────
interface SweetPrize { place: number; emoji: string; name: string; sub?: string }
interface SweetPrizesConfig { quarter_label: string; headline_name: string; prizes: SweetPrize[] }

const PRIZES_FALLBACK: SweetPrizesConfig = {
  quarter_label: "Розыгрыш каждый квартал",
  headline_name: "Лотерея с призами",
  prizes: [],
};
const PRIZES_FILE = path.join(__dirname, "..", "..", "data", "sweet-check-prizes.json");
let _prizesCache: SweetPrizesConfig | null = null;

function loadSweetCheckPrizes(): SweetPrizesConfig {
  if (_prizesCache) return _prizesCache;
  try {
    if (fs.existsSync(PRIZES_FILE)) {
      const raw = fs.readFileSync(PRIZES_FILE, "utf-8");
      const data = JSON.parse(raw) as SweetPrizesConfig;
      if (Array.isArray(data.prizes)) {
        _prizesCache = data;
        return _prizesCache;
      }
    }
  } catch (e) {
    log.error({ err: e }, "[sweet-check] prizes load failed");
  }
  _prizesCache = PRIZES_FALLBACK;
  return _prizesCache;
}

router.get("/api/sweet-check/prizes", rateLimit(60), (_req, res) => {
  res.json(loadSweetCheckPrizes());
});

router.post("/api/admin/sweet-check-prizes/reload", requireAdminToken, requireAdminRole("operator"), (_req, res) => {
  _prizesCache = null;
  const cfg = loadSweetCheckPrizes();
  res.json({ ok: true, total: cfg.prizes.length, headline: cfg.headline_name });
});

// Также экспортируем loaders — на случай если src/index.ts нужно вызвать
// (например buildSaleText ссылается на призы).
export { loadSweetCheckWeeks, loadSweetCheckPrizes };
export default router;

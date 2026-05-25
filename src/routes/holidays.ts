/**
 * Holidays routes — публичные эндпоинты праздничного календаря.
 *
 * Эндпоинты:
 * - GET /api/holidays/upcoming — ближайший праздник для карточки на главной.
 *
 * `/api/admin/holidays/push` (ручной триггер pushHolidayPreorder) остался в
 * src/index.ts — там доступ к push-функции; вынесем когда переедет push-волна.
 */

import { Router } from "express";
import { rateLimit } from "../middleware";
import { getNextHoliday } from "../holidays";

const router = Router();

router.get("/api/holidays/upcoming", rateLimit(60), (_req, res) => {
  const next = getNextHoliday();
  if (!next) {
    res.json({ holiday: null });
    return;
  }
  res.json({
    holiday: {
      id: next.holiday.id,
      name: next.holiday.name,
      emoji: next.holiday.emoji,
      hint: next.holiday.hint,
      accent: next.holiday.accent,
      searchQuery: next.holiday.searchQuery,
      date: next.date.toISOString().slice(0, 10),
      daysUntil: next.daysUntil,
      preorderDays: next.holiday.preorderDays,
    },
  });
});

export default router;

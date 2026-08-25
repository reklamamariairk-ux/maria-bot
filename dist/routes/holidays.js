"use strict";
/**
 * Holidays routes — публичные эндпоинты праздничного календаря.
 *
 * Эндпоинты:
 * - GET /api/holidays/upcoming — ближайший праздник для карточки на главной.
 *
 * `/api/admin/holidays/push` (ручной триггер pushHolidayPreorder) остался в
 * src/index.ts — там доступ к push-функции; вынесем когда переедет push-волна.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const middleware_1 = require("../middleware");
const holidays_1 = require("../holidays");
const router = (0, express_1.Router)();
router.get("/api/holidays/upcoming", (0, middleware_1.rateLimit)(60), (_req, res) => {
    const next = (0, holidays_1.getNextHoliday)();
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
exports.default = router;

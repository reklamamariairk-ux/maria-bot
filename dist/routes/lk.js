"use strict";
/**
 * LK routes — личный кабинет с сайта maria-irk.ru через Bitrix API.
 *
 * Эндпоинты:
 * - GET /api/lk — баланс баллов + история заказов + level + tickets count
 *                  (требует verified phone; 502 если Bitrix недоступен)
 *
 * Все 4 потребителя на фронте читают response плоско (см. fix `c58b570` от
 * 22.05) — формат: { found, name, level, balance, year_spent, orders, ... }.
 * Не оборачивать в { data: ... }.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const lk_1 = require("../lk");
const middleware_1 = require("../middleware");
const auth_1 = require("../auth");
const logger_1 = require("../logger");
const router = (0, express_1.Router)();
router.get("/api/lk", auth_1.requireTgUser, (0, middleware_1.rateLimit)(30), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        const result = await (0, lk_1.fetchLk)(u.id);
        if (!result.ok) {
            const code = result.reason === "phone_not_verified" ? 403 : 502;
            res.status(code).json({ error: result.reason });
            return;
        }
        res.json(result.data);
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "/api/lk failed");
        res.status(500).json({ error: "internal" });
    }
});
exports.default = router;

"use strict";
/**
 * Secret of the Day route — рекомендация дня.
 *
 * GET /api/secret-of-day — возвращает выбранный товар (cron ставит каждое утро).
 *
 * Cron rotateSecretOfDay() остался в src/index.ts — он зависит от catalog
 * mutation pattern (тоже там). Перенесётся вместе с cron-волной.
 *
 * Factory принимает getCatalog — нужен для подмешивания product detail.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSecretOfDayRouter = createSecretOfDayRouter;
const express_1 = require("express");
const db_1 = require("../db");
const middleware_1 = require("../middleware");
const logger_1 = require("../logger");
function createSecretOfDayRouter(getCatalog) {
    const router = (0, express_1.Router)();
    router.get("/api/secret-of-day", (0, middleware_1.rateLimit)(60), async (_req, res) => {
        try {
            const s = await (0, db_1.getSecretOfDay)();
            if (!s) {
                res.json({ secret: null });
                return;
            }
            const product = getCatalog().find((p) => p.id === s.productId);
            res.json({
                secret: {
                    productId: s.productId,
                    discountPct: s.discountPct,
                    expiresAt: s.expiresAt,
                    product: product || null,
                },
            });
        }
        catch (e) {
            logger_1.log.error({ err: e }, "[secret-of-day]");
            res.status(500).json({ error: "internal" });
        }
    });
    return router;
}

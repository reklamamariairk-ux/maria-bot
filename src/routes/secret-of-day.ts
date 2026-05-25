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

import { Router } from "express";
import { getSecretOfDay } from "../db";
import type { Product } from "../scraper";
import { rateLimit } from "../middleware";
import { log } from "../logger";

export function createSecretOfDayRouter(getCatalog: () => Product[]): Router {
  const router = Router();

  router.get("/api/secret-of-day", rateLimit(60), async (_req, res) => {
    try {
      const s = await getSecretOfDay();
      if (!s) { res.json({ secret: null }); return; }
      const product = getCatalog().find((p) => p.id === s.productId);
      res.json({
        secret: {
          productId: s.productId,
          discountPct: s.discountPct,
          expiresAt: s.expiresAt,
          product: product || null,
        },
      });
    } catch (e) {
      log.error({ err: e }, "[secret-of-day]");
      res.status(500).json({ error: "internal" });
    }
  });

  return router;
}

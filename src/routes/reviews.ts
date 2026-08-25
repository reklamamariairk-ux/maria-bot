/**
 * Reviews routes — отзывы пользователей на товары.
 *
 * Эндпоинты:
 * - GET    /api/reviews/:pid          публичный (с rate-limit), отдаёт reviews + stats
 *                                      + mine (если есть Telegram-auth)
 * - POST   /api/reviews               upsert (UNIQUE product_id + chat_id), 5/сутки
 * - DELETE /api/reviews/:id           удалить свой
 * - POST   /api/reviews/stats-batch   агрегаты для пачки product_ids
 * - POST   /api/admin/reviews/:id/hide   модерация (admin)
 *
 * Зависит от существования товара в каталоге — каталог передаётся через
 * factory (`createReviewsRouter`), чтобы избежать circular dep.
 */

import { Router } from "express";
import {
  getReviewsForProduct,
  getReviewStats,
  getReviewStatsBatch,
  getMyReview,
  upsertReview,
  deleteMyReview,
  setReviewHidden,
  countReviewsLast24h,
} from "../db";
import type { Product } from "../scraper";
import { rateLimit, requireAdminRole, requireAdminToken } from "../middleware";
import { optionalUser, requireTgUser, getTgUser, tryGetTgUser } from "../auth";
import { log } from "../logger";

export function createReviewsRouter(getCatalog: () => Product[]): Router {
  const router = Router();

  router.get("/api/reviews/:pid", optionalUser, rateLimit(60), async (req, res) => {
    const pid = Number(req.params.pid);
    if (!pid) { res.status(400).json({ error: "bad_pid" }); return; }
    const limit  = Math.min(Number(req.query.limit ?? 20), 50);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);
    try {
      const [reviews, stats] = await Promise.all([
        getReviewsForProduct(pid, limit, offset),
        getReviewStats(pid),
      ]);
      const tgUser = tryGetTgUser(req);
      let mine: unknown = null;
      if (tgUser) mine = await getMyReview(pid, tgUser.id);
      res.json({ reviews, stats, mine });
    } catch (e) {
      log.error({ err: e, pid }, "[reviews/:pid]");
      res.status(500).json({ error: "internal" });
    }
  });

  // POST новый/обновлённый отзыв (upsert: UNIQUE(product_id, chat_id))
  router.post("/api/reviews", requireTgUser, rateLimit(3), async (req, res) => {
    const u = getTgUser(req)!;
    const body = req.body as { product_id?: unknown; rating?: unknown; text?: unknown };
    const productId = Number(body.product_id);
    const rating    = Number(body.rating);
    const text      = String(body.text ?? "").trim().slice(0, 500);
    if (!productId) { res.status(400).json({ error: "product_id_required" }); return; }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      res.status(400).json({ error: "rating_must_be_1_to_5" }); return;
    }
    // Товар должен существовать (защита от мусора)
    if (!getCatalog().find((p) => p.id === productId)) {
      res.status(404).json({ error: "product_not_found" }); return;
    }
    // Rate-limit: max 5 новых отзывов в сутки (update своего — не считается)
    try {
      const existing = await getMyReview(productId, u.id);
      if (!existing) {
        const todayCount = await countReviewsLast24h(u.id);
        if (todayCount >= 5) {
          res.status(429).json({ error: "rate_limit_exceeded", limit: 5 });
          return;
        }
      }
      const authorName = (u.first_name || "").trim().slice(0, 60) || null;
      const review = await upsertReview(productId, u.id, rating, text, authorName);
      res.json({ ok: true, review });
    } catch (e) {
      log.error({ err: e, productId, chatId: u.id }, "[reviews POST]");
      res.status(500).json({ error: "internal" });
    }
  });

  // DELETE свой отзыв
  router.delete("/api/reviews/:id", requireTgUser, async (req, res) => {
    const u = getTgUser(req)!;
    const id = Number(req.params.id);
    if (!id) { res.status(400).json({ error: "bad_id" }); return; }
    try {
      const ok = await deleteMyReview(id, u.id);
      res.json({ ok });
    } catch (e) {
      log.error({ err: e, id, chatId: u.id }, "[reviews DELETE]");
      res.status(500).json({ error: "internal" });
    }
  });

  // POST batch — статистика для списка товаров
  router.post("/api/reviews/stats-batch", rateLimit(60), async (req, res) => {
    const ids = (req.body as { product_ids?: unknown })?.product_ids;
    if (!Array.isArray(ids)) { res.status(400).json({ error: "product_ids_required" }); return; }
    const productIds = ids.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 200);
    try {
      const map = await getReviewStatsBatch(productIds);
      const stats: Record<string, { count: number; avg: number }> = {};
      for (const [pid, s] of map.entries()) stats[String(pid)] = s;
      res.json({ stats });
    } catch (e) {
      log.error({ err: e, count: productIds.length }, "[reviews stats-batch]");
      res.status(500).json({ error: "internal" });
    }
  });

  // Админ: скрыть/показать отзыв (модерация)
  router.post("/api/admin/reviews/:id/hide", requireAdminToken, requireAdminRole("operator"), async (req, res) => {
    const id = Number(req.params.id);
    if (!id) { res.status(400).json({ error: "bad_id" }); return; }
    const hidden = (req.body as { hidden?: boolean })?.hidden !== false; // по умолчанию hide=true
    const ok = await setReviewHidden(id, hidden);
    res.json({ ok, hidden });
  });

  return router;
}

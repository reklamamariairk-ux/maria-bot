/**
 * Order rating routes — оценка заказа после выполнения.
 *
 * Эндпоинты:
 * - GET  /api/order-rating/:orderId — текущая оценка (для отображения «уже оценили»)
 * - POST /api/order-rating          — upsert оценки (1-5 + опц. text)
 */

import { Router } from "express";
import { getOrderRating, upsertOrderRating } from "../db";
import { rateLimit } from "../middleware";
import { requireTgUser, getTgUser } from "../auth";
import { log } from "../logger";

const router = Router();

router.get("/api/order-rating/:orderId", requireTgUser, async (req, res) => {
  const u = getTgUser(req)!;
  const orderId = String(req.params.orderId || "").trim().slice(0, 64);
  if (!orderId) { res.status(400).json({ error: "bad_order_id" }); return; }
  try {
    const rating = await getOrderRating(u.id, orderId);
    res.json({ rating });
  } catch (e) {
    log.error({ err: e, chatId: u.id, orderId }, "[order-rating GET]");
    res.status(500).json({ error: "internal" });
  }
});

router.post("/api/order-rating", requireTgUser, rateLimit(5), async (req, res) => {
  const u = getTgUser(req)!;
  const body = req.body as { order_id?: unknown; rating?: unknown; text?: unknown };
  const orderId = String(body.order_id ?? "").trim().slice(0, 64);
  const rating  = Number(body.rating);
  const text    = String(body.text ?? "").trim().slice(0, 500);
  if (!orderId) { res.status(400).json({ error: "order_id_required" }); return; }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    res.status(400).json({ error: "rating_must_be_1_to_5" }); return;
  }
  try {
    const saved = await upsertOrderRating(u.id, orderId, rating, text);
    res.json({ ok: true, rating: saved });
  } catch (e) {
    log.error({ err: e, chatId: u.id, orderId, rating }, "[order-rating POST]");
    res.status(500).json({ error: "internal" });
  }
});

export default router;

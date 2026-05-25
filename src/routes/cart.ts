/**
 * Cart route — синхронизация снимка корзины для cart-abandonment push.
 *
 * - POST /api/cart/sync — items[] → пишем в cart_snapshots (или удаляем если пусто).
 *                          Cron-задача через 24h отправит push если корзина не дошла
 *                          до заказа.
 */

import { Router } from "express";
import { saveCartSnapshot, clearCartSnapshot } from "../db";
import { requireTgUser, getTgUser } from "../auth";
import { log } from "../logger";

const router = Router();

router.post("/api/cart/sync", requireTgUser, async (req, res) => {
  const u = getTgUser(req)!;
  const body = req.body as { items?: Array<{ id: number; qty: number; price?: number; name?: string }> };
  const items = Array.isArray(body.items)
    ? body.items.filter((i) => i && Number(i.id) > 0 && Number(i.qty) > 0)
    : [];
  try {
    if (items.length === 0) {
      await clearCartSnapshot(u.id);
    } else {
      const totalSum = items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
      await saveCartSnapshot(u.id, items, totalSum);
    }
    res.json({ ok: true });
  } catch (e) {
    log.error({ err: e, chatId: u.id, count: items.length }, "[cart/sync]");
    res.status(500).json({ error: "internal" });
  }
});

export default router;

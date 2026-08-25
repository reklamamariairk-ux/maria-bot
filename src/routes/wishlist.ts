/**
 * Wishlist routes — список «нравится» + поделиться + back-in-stock подписка.
 *
 * - POST /api/wishlist/share        — создать share-link (требует tma auth, 10/сутки)
 * - GET  /api/wishlist/share/:code  — публичная страница shared wishlist
 *                                      (+ инкрементим opens, не блокирующее)
 * - POST /api/wishlist/sync         — синк wishlist пользователя (для back-in-stock push)
 *
 * Принимает getter каталога — для подмешивания product detail в GET share.
 */

import { Router } from "express";
import {
  countWishlistSharesLast24h,
  createWishlistShare,
  getWishlistShare,
  incrementWishlistShareOpens,
  wishlistSync,
} from "../db";
import type { Product } from "../scraper";
import { rateLimit } from "../middleware";
import { requireTgUser, getTgUser } from "../auth";
import { miniAppLink } from "../links";
import { log } from "../logger";

export function createWishlistRouter(getCatalog: () => Product[]): Router {
  const router = Router();

  router.post("/api/wishlist/share", requireTgUser, rateLimit(5), async (req, res) => {
    const u = getTgUser(req)!;
    const body = req.body as { product_ids?: unknown; message?: unknown };
    const ids = Array.isArray(body.product_ids)
      ? (body.product_ids as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 30)
      : [];
    if (ids.length === 0) {
      res.status(400).json({ error: "wishlist_empty" });
      return;
    }
    const message = String(body.message ?? "").trim().slice(0, 200);
    try {
      const todayCount = await countWishlistSharesLast24h(u.id);
      if (todayCount >= 10) {
        res.status(429).json({ error: "rate_limit_exceeded", limit: 10 });
        return;
      }
      const ownerName = (u.first_name || "").trim().slice(0, 60) || null;
      const share = await createWishlistShare(u.id, ownerName, ids, message);
      // Deep-link на платформу владельца (TG: ?startapp=, VK: #hash)
      const url = miniAppLink(u.id, `wish_${share.short_code}`);
      res.json({
        ok: true,
        code: share.short_code,
        url,
        expires_at: share.expires_at,
        product_count: ids.length,
      });
    } catch (e) {
      log.error({ err: e, chatId: u.id, count: ids.length }, "[wishlist/share POST]");
      res.status(500).json({ error: "internal" });
    }
  });

  router.get("/api/wishlist/share/:code", rateLimit(30), async (req, res) => {
    const code = String(req.params.code || "").toUpperCase().slice(0, 16);
    if (!/^[A-Z0-9]+$/.test(code)) {
      res.status(400).json({ error: "bad_code" });
      return;
    }
    try {
      const share = await getWishlistShare(code);
      if (!share) {
        res.status(404).json({ error: "not_found_or_expired" });
        return;
      }
      // Подмешиваем product detail из in-memory каталога
      const catalog = getCatalog();
      const products = share.product_ids
        .map((pid) => catalog.find((p) => p.id === pid))
        .filter((p): p is Product => Boolean(p));
      incrementWishlistShareOpens(code).catch(() => {});
      res.json({
        code: share.short_code,
        owner_name: share.owner_name,
        message: share.message,
        expires_at: share.expires_at,
        products,
      });
    } catch (e) {
      log.error({ err: e, code }, "[wishlist/share GET]");
      res.status(500).json({ error: "internal" });
    }
  });

  router.post("/api/wishlist/sync", requireTgUser, rateLimit(30), async (req, res) => {
    const u = getTgUser(req)!;
    const ids = Array.isArray(req.body?.ids)
      ? [...new Set((req.body.ids as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 500)
      : [];
    try {
      await wishlistSync(u.id, ids);
      res.json({ ok: true, count: ids.length });
    } catch (e) {
      log.error({ err: e, chatId: u.id, count: ids.length }, "[wishlist/sync]");
      res.status(500).json({ error: "internal" });
    }
  });

  return router;
}

/**
 * Promo routes — валидация и учёт промокодов.
 *
 * Эндпоинты:
 * - POST /api/promo/validate — проверка кода + cart_total → применимая скидка
 *                              (НЕ списывает использование).
 * - POST /api/promo/use      — записать использование (вызывается фронтом
 *                              после успешного создания заказа).
 *
 * /api/admin/promo/reload остался в src/index.ts (он рядом с другими reload-ами).
 */

import { Router } from "express";
import { validatePromoSync, findPromo } from "../promo";
import { hasUserUsedPromo, countPromoUses, recordPromoUse } from "../db";
import { rateLimit } from "../middleware";
import { tryGetTgUser } from "../auth";
import { log } from "../logger";

const router = Router();

// Validate — проверяет существование, срок, min_order, one_per_user, max_uses_total.
// Возвращает применимую скидку в ₽. Не списывает использование (это делает /api/order).
router.post("/api/promo/validate", rateLimit(20), async (req, res) => {
  const body = req.body as { code?: unknown; cart_total?: unknown };
  const code = String(body.code ?? "").trim();
  const cartTotal = Number(body.cart_total) || 0;
  if (!code) { res.status(400).json({ ok: false, reason: "code_required" }); return; }

  const sync = validatePromoSync({ code, cart_total: cartTotal });
  if (!sync.result.ok || !sync.promo) {
    // Возвращаем расширенный reason для UI
    const r = sync.result;
    const promo = sync.promo;
    const min = promo?.min_order || 0;
    const ext: Record<string, unknown> = { ...r };
    if (r.reason === "min_order_not_met" && min > 0) {
      ext.min_order = min;
      ext.message = `Минимальная сумма заказа: ${min.toLocaleString("ru-RU")} ₽`;
    } else if (r.reason === "expired") {
      ext.message = "Срок действия истёк";
    } else if (r.reason === "not_found") {
      ext.message = "Промокод не найден";
    }
    res.json(ext);
    return;
  }
  const promo = sync.promo;

  // Async-checks: one_per_user + max_uses_total
  try {
    const tgUser = tryGetTgUser(req);
    if (promo.one_per_user && tgUser) {
      const used = await hasUserUsedPromo(tgUser.id, promo.code);
      if (used) {
        res.json({ ok: false, reason: "already_used", message: "Ты уже применял этот промокод" });
        return;
      }
    }
    if (promo.max_uses_total != null) {
      const cnt = await countPromoUses(promo.code);
      if (cnt >= promo.max_uses_total) {
        res.json({ ok: false, reason: "max_uses_reached", message: "Лимит активаций исчерпан" });
        return;
      }
    }
    res.json(sync.result);
  } catch (e) {
    log.error({ err: e, code }, "[promo/validate]");
    res.status(500).json({ ok: false, reason: "internal" });
  }
});

// Записать использование промокода (вызывает frontend после успешного создания заказа)
router.post("/api/promo/use", rateLimit(10), async (req, res) => {
  const body = req.body as { code?: unknown; order_id?: unknown };
  const code = String(body.code ?? "").trim().toUpperCase();
  const orderId = body.order_id != null ? String(body.order_id).slice(0, 64) : null;
  if (!code) { res.status(400).json({ error: "code_required" }); return; }
  // Проверим что код существует (защита от мусорных записей)
  if (!findPromo(code)) { res.status(404).json({ error: "code_not_found" }); return; }
  const tgUser = tryGetTgUser(req);
  try {
    await recordPromoUse(code, tgUser?.id ?? null, orderId);
    res.json({ ok: true });
  } catch (e) {
    log.error({ err: e, code, orderId, chatId: tgUser?.id }, "[promo/use]");
    res.status(500).json({ error: "internal" });
  }
});

export default router;

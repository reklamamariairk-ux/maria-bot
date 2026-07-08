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
import { hasUserUsedPromo, countPromoUses, recordPromoUse, findUserReward, markUserRewardUsed } from "../db";
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
      // Анти-коллизия: общий код имеет приоритет; только при not_found ищем персональный
      const tgUser2 = tryGetTgUser(req);
      if (tgUser2) {
        try {
          const ur = await findUserReward(tgUser2.id, code);
          if (ur) {
            const todayIrk = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
            if (ur.used_at) { res.json({ ok: false, reason: "already_used", message: "Награда уже использована" }); return; }
            if (new Date(ur.expires_at).toISOString().slice(0, 10) < todayIrk) { res.json({ ok: false, reason: "expired", message: "Срок действия истёк" }); return; }
            if (ur.reward_type !== "percent" && ur.reward_type !== "amount") {
              res.json({ ok: false, reason: "show_at_cashier", message: "Награду выдаёт кассир — покажите код на кассе" }); return;
            }
            if (ur.min_order && cartTotal < ur.min_order) {
              res.json({ ok: false, reason: "min_order_not_met", min_order: ur.min_order, message: `Минимальная сумма заказа: ${ur.min_order.toLocaleString("ru-RU")} ₽` }); return;
            }
            const discount = ur.reward_type === "percent" ? Math.floor(cartTotal * (ur.discount_value! / 100)) : Math.min(ur.discount_value!, cartTotal);
            res.json({ ok: true, code: code.toUpperCase(), type: ur.reward_type, value: ur.discount_value, discount, description: ur.title });
            return;
          }
        } catch (e) {
          log.error({ err: e, code }, "[promo/validate] user_reward lookup");
        }
      }
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
  const tgUser = tryGetTgUser(req);
  // Проверим что код существует (защита от мусорных записей)
  if (!findPromo(code)) {
    // Анти-коллизия: только если нет в promo-codes.json — ищем персональный user_rewards
    if (tgUser) {
      try {
        const ur = await findUserReward(tgUser.id, code);
        if (ur) {
          if (ur.reward_type !== "percent" && ur.reward_type !== "amount") {
            res.json({ ok: true }); return; // free_item — кассир гасит, не списываем онлайн
          }
          await markUserRewardUsed(code, tgUser.id, orderId); res.json({ ok: true }); return;
        }
      } catch (e) {
        log.error({ err: e, code, orderId, chatId: tgUser.id }, "[promo/use] user_reward");
        res.status(500).json({ error: "internal" }); return;
      }
    }
    res.status(404).json({ error: "code_not_found" }); return;
  }
  try {
    await recordPromoUse(code, tgUser?.id ?? null, orderId);
    res.json({ ok: true });
  } catch (e) {
    log.error({ err: e, code, orderId, chatId: tgUser?.id }, "[promo/use]");
    res.status(500).json({ error: "internal" });
  }
});

export default router;

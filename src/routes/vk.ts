/**
 * VK-специфичные API endpoints.
 *
 * POST /api/vk/verify-phone — верификация телефона VK-юзера.
 * Фронт вызывает VKWebAppGetPhoneNumber → VK возвращает { phone_number, sign },
 * где sign = SHA256(AppID + ApiSecret + UserID + "phone_number" + value).
 * Сервер проверяет подпись СВОИМ ключом → телефону можно верить.
 *
 * ⚠️ Безопасность: trust-the-client endpoint /api/verify-phone был сознательно
 * удалён в audit 15.05 — этот криптографически верифицирован (аналог TG :contact).
 * Бонус начисляется тот же, что и в TG-флоу (BONUS_VERIFY_PHONE внутри verifyPhone).
 */

import { Router } from "express";
import { requireUser, getUser } from "../auth";
import { verifyVkPhoneSign } from "../auth-vk";
import { verifyPhone } from "../club";
import { rateLimit } from "../middleware";
import { log } from "../logger";

export function createVkRouter(): Router {
  const router = Router();

  // Публичная конфигурация для фронт-бриджа (share-ссылки, AllowMessagesFromGroup).
  // app_id и group_id — публичные значения, секретов здесь нет.
  router.get("/api/vk/config", (_req, res) => {
    res.json({
      app_id: process.env.VK_APP_ID ?? null,
      group_id: process.env.VK_GROUP_ID ?? null,
    });
  });

  router.post("/api/vk/verify-phone", requireUser, rateLimit(10), async (req, res) => {
    const u = getUser(req)!;
    if (u.platform !== "vk") {
      res.status(400).json({ error: "vk_only" });
      return;
    }
    const body = req.body as { phone_number?: unknown; sign?: unknown };
    const phone = String(body.phone_number ?? "").replace(/[^\d+]/g, "");
    const sign = String(body.sign ?? "");
    if (!phone || phone.replace(/\D/g, "").length < 10 || !sign) {
      res.status(400).json({ error: "phone_and_sign_required" });
      return;
    }
    // Подпись считается от СЫРОГО значения из VKWebAppGetPhoneNumber —
    // проверяем оригинал, не нормализованный
    if (!verifyVkPhoneSign(String(body.phone_number), u.platformId, sign)) {
      log.warn({ chatId: u.id }, "[vk verify-phone] bad sign");
      res.status(403).json({ error: "bad_sign" });
      return;
    }
    try {
      const result = await verifyPhone(u.id, phone);
      res.json({
        ok: true,
        alreadyVerified: result.alreadyVerified,
        bonusAwarded: result.bonusAwarded,
      });
    } catch (e) {
      log.error({ err: e, chatId: u.id }, "[vk verify-phone]");
      res.status(500).json({ error: "internal" });
    }
  });

  return router;
}

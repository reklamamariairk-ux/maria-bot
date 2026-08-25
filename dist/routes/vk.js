"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createVkRouter = createVkRouter;
const express_1 = require("express");
const auth_1 = require("../auth");
const auth_vk_1 = require("../auth-vk");
const club_1 = require("../club");
const middleware_1 = require("../middleware");
const logger_1 = require("../logger");
function createVkRouter() {
    const router = (0, express_1.Router)();
    // Публичная конфигурация для фронт-бриджа (share-ссылки, AllowMessagesFromGroup).
    // app_id и group_id — публичные значения, секретов здесь нет.
    router.get("/api/vk/config", (_req, res) => {
        res.json({
            app_id: process.env.VK_APP_ID ?? null,
            group_id: process.env.VK_GROUP_ID ?? null,
        });
    });
    router.post("/api/vk/verify-phone", auth_1.requireUser, (0, middleware_1.rateLimit)(10), async (req, res) => {
        const u = (0, auth_1.getUser)(req);
        if (u.platform !== "vk") {
            res.status(400).json({ error: "vk_only" });
            return;
        }
        const body = req.body;
        const phone = String(body.phone_number ?? "").replace(/[^\d+]/g, "");
        const sign = String(body.sign ?? "");
        if (!phone || phone.replace(/\D/g, "").length < 10 || !sign) {
            res.status(400).json({ error: "phone_and_sign_required" });
            return;
        }
        // Подпись считается от СЫРОГО значения из VKWebAppGetPhoneNumber —
        // проверяем оригинал, не нормализованный
        if (!(0, auth_vk_1.verifyVkPhoneSign)(String(body.phone_number), u.platformId, sign)) {
            logger_1.log.warn({ chatId: u.id }, "[vk verify-phone] bad sign");
            res.status(403).json({ error: "bad_sign" });
            return;
        }
        try {
            const result = await (0, club_1.verifyPhone)(u.id, phone);
            res.json({
                ok: true,
                alreadyVerified: result.alreadyVerified,
                bonusAwarded: result.bonusAwarded,
            });
        }
        catch (e) {
            logger_1.log.error({ err: e, chatId: u.id }, "[vk verify-phone]");
            res.status(500).json({ error: "internal" });
        }
    });
    return router;
}

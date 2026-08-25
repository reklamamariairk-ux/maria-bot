"use strict";
/**
 * VK Callback API — входящие события от сообщества.
 *
 * POST /vk/callback:
 * - confirmation  → отдаём VK_CONFIRMATION_CODE (строка подтверждения сервера)
 * - message_new   → регистрируем подписчика + отвечаем кнопкой «Открыть приложение»
 *                   (аналог TG catch-all «Откройте Mini App»); сам факт письма
 *                   сообществу = юзер разрешил ему отвечать → flag true
 * - message_allow → vk_messages_allowed = true (разрешил уведомления)
 * - message_deny  → vk_messages_allowed = false (запретил — пуши скипаются)
 *
 * Защита: secret из настроек Callback API + проверка group_id.
 * Без VK_CALLBACK_SECRET / VK_CONFIRMATION_CODE роут отвечает 404 (TG-only).
 * На все события отвечаем "ok" быстро — VK ретраит при не-ok.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createVkCallbackRouter = createVkCallbackRouter;
const express_1 = require("express");
const middleware_1 = require("../middleware");
const db_1 = require("../db");
const platform_1 = require("../platform");
const logger_1 = require("../logger");
const VK_CALLBACK_SECRET = process.env.VK_CALLBACK_SECRET ?? "";
const VK_CONFIRMATION_CODE = process.env.VK_CONFIRMATION_CODE ?? "";
const VK_GROUP_ID = Number(process.env.VK_GROUP_ID ?? 0);
const VK_APP_ID = process.env.VK_APP_ID ?? "";
const VK_WELCOME = `Добро пожаловать в кондитерскую «Мария»! 🍰

В нашем приложении: каталог тортов и десертов, ИИ-кондитер Маша, клуб с бонусами и заказ в пару кликов. Жмите кнопку ниже 👇`;
/** Клавиатура с кнопкой открытия Mini App (inline). */
function appKeyboard() {
    if (!VK_APP_ID)
        return undefined;
    return JSON.stringify({
        inline: true,
        buttons: [[{
                    action: {
                        type: "open_app",
                        app_id: Number(VK_APP_ID),
                        owner_id: VK_GROUP_ID ? -VK_GROUP_ID : undefined,
                        label: "🍰 Открыть приложение",
                        hash: "from_chat",
                    },
                }]],
    });
}
function createVkCallbackRouter(vkSender) {
    const router = (0, express_1.Router)();
    const configured = Boolean(VK_CALLBACK_SECRET && VK_CONFIRMATION_CODE);
    router.post("/vk/callback", async (req, res) => {
        if (!configured) {
            res.status(404).end();
            return;
        }
        const body = req.body;
        // Секрет и group_id — отбрасываем чужие/поддельные события
        if (!(0, middleware_1.safeEq)(body.secret, VK_CALLBACK_SECRET) || (VK_GROUP_ID && body.group_id !== VK_GROUP_ID)) {
            logger_1.log.warn({ type: body.type, group: body.group_id }, "[vk callback] bad secret/group");
            res.status(403).end();
            return;
        }
        if (body.type === "confirmation") {
            res.send(VK_CONFIRMATION_CODE);
            return;
        }
        // VK ждёт "ok" быстро; обработку делаем после ответа (best-effort)
        res.send("ok");
        try {
            switch (body.type) {
                case "message_new": {
                    const fromId = body.object?.message?.from_id;
                    if (!fromId || fromId <= 0)
                        return; // сообщения от сообществ игнорируем
                    const internalId = (0, platform_1.toInternalId)("vk", fromId);
                    await (0, db_1.addSubscriber)(internalId, undefined, undefined).catch(() => { });
                    // Письмо сообществу = диалог открыт, отвечать можно
                    await (0, db_1.setVkMessagesAllowed)(internalId, true).catch(() => { });
                    await vkSender.send(fromId, VK_WELCOME, appKeyboard());
                    break;
                }
                case "message_allow": {
                    const userId = body.object?.user_id;
                    if (userId)
                        await (0, db_1.setVkMessagesAllowed)((0, platform_1.toInternalId)("vk", userId), true);
                    break;
                }
                case "message_deny": {
                    const userId = body.object?.user_id;
                    if (userId)
                        await (0, db_1.setVkMessagesAllowed)((0, platform_1.toInternalId)("vk", userId), false);
                    break;
                }
            }
        }
        catch (e) {
            logger_1.log.warn({ type: body.type, err: e.message }, "[vk callback]");
        }
    });
    return router;
}

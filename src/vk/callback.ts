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

import { Router, type Request, type Response } from "express";
import { safeEq } from "../middleware";
import { addSubscriber, setVkMessagesAllowed } from "../db";
import { toInternalId } from "../platform";
import type { VkSender } from "./sender";
import { log } from "../logger";

const VK_CALLBACK_SECRET = process.env.VK_CALLBACK_SECRET ?? "";
const VK_CONFIRMATION_CODE = process.env.VK_CONFIRMATION_CODE ?? "";
const VK_GROUP_ID = Number(process.env.VK_GROUP_ID ?? 0);
const VK_APP_ID = process.env.VK_APP_ID ?? "";

const VK_WELCOME = `Добро пожаловать в кондитерскую «Мария»! 🍰

В нашем приложении: каталог тортов и десертов, ИИ-кондитер Маша, клуб с бонусами и заказ в пару кликов. Жмите кнопку ниже 👇`;

/** Клавиатура с кнопкой открытия Mini App (inline). */
function appKeyboard(): string | undefined {
  if (!VK_APP_ID) return undefined;
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

export function createVkCallbackRouter(vkSender: VkSender): Router {
  const router = Router();
  const configured = Boolean(VK_CALLBACK_SECRET && VK_CONFIRMATION_CODE);

  router.post("/vk/callback", async (req: Request, res: Response) => {
    if (!configured) {
      res.status(404).end();
      return;
    }
    const body = req.body as {
      type?: string;
      group_id?: number;
      secret?: string;
      object?: { message?: { from_id?: number; text?: string }; user_id?: number };
    };

    // Секрет и group_id — отбрасываем чужие/поддельные события
    if (!safeEq(body.secret, VK_CALLBACK_SECRET) || (VK_GROUP_ID && body.group_id !== VK_GROUP_ID)) {
      log.warn({ type: body.type, group: body.group_id }, "[vk callback] bad secret/group");
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
          if (!fromId || fromId <= 0) return; // сообщения от сообществ игнорируем
          const internalId = toInternalId("vk", fromId);
          await addSubscriber(internalId, undefined, undefined).catch(() => {});
          // Письмо сообществу = диалог открыт, отвечать можно
          await setVkMessagesAllowed(internalId, true).catch(() => {});
          await vkSender.send(fromId, VK_WELCOME, appKeyboard());
          break;
        }
        case "message_allow": {
          const userId = body.object?.user_id;
          if (userId) await setVkMessagesAllowed(toInternalId("vk", userId), true);
          break;
        }
        case "message_deny": {
          const userId = body.object?.user_id;
          if (userId) await setVkMessagesAllowed(toInternalId("vk", userId), false);
          break;
        }
      }
    } catch (e) {
      log.warn({ type: body.type, err: (e as Error).message }, "[vk callback]");
    }
  });

  return router;
}

/**
 * Отправка сообщений VK-юзерам от имени сообщества (messages.send).
 *
 * Требует VK_GROUP_TOKEN (ключ сообщества со scope messages) и согласия юзера
 * на сообщения от сообщества (VKWebAppAllowMessagesFromGroup / кнопка
 * «Разрешить уведомления»). Ошибки 901/902/936 («нельзя писать юзеру») —
 * норма, аналог «юзер заблокировал бота» в TG: тихо возвращаем false.
 *
 * VK не понимает Markdown — текст прогоняется через stripMarkdown.
 * Без VK_GROUP_TOKEN сендер не сконфигурирован: send() всегда false.
 */

import crypto from "crypto";
import { stripMarkdown } from "../links";
import { log } from "../logger";

const VK_API = "https://api.vk.com/method";
const VK_API_VERSION = "5.199";

export interface VkSender {
  configured: boolean;
  /** vkUserId — РОДНОЙ VK id (не internal). Возвращает true если доставлено. */
  send(vkUserId: number, text: string): Promise<boolean>;
}

// Коды ошибок messages.send, означающие «юзер не разрешил/запретил сообщения»
const NOT_ALLOWED_CODES = new Set([900, 901, 902, 936]);

export function createVkSender(): VkSender {
  const token = process.env.VK_GROUP_TOKEN ?? "";
  if (!token) {
    return { configured: false, send: async () => false };
  }
  return {
    configured: true,
    async send(vkUserId, text) {
      try {
        const params = new URLSearchParams({
          user_id: String(vkUserId),
          message: stripMarkdown(text),
          random_id: String(crypto.randomInt(1, 2 ** 31)),
          access_token: token,
          v: VK_API_VERSION,
        });
        const res = await fetch(`${VK_API}/messages.send`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        });
        const json = (await res.json()) as { response?: unknown; error?: { error_code?: number; error_msg?: string } };
        if (json.error) {
          if (!NOT_ALLOWED_CODES.has(json.error.error_code ?? 0)) {
            log.warn({ vkUserId, code: json.error.error_code, msg: json.error.error_msg }, "[vk send]");
          }
          return false;
        }
        return true;
      } catch (e) {
        log.warn({ vkUserId, err: (e as Error).message }, "[vk send]");
        return false;
      }
    },
  };
}

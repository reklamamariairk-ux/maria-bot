/**
 * Push-notification сервис — smart wrapper над отправкой сообщений юзеру.
 *
 * С VK-порта роутит по платформе получателя (см. platform.ts):
 * - TG (internalId < 2e12) → bot.api.sendMessage
 * - VK (internalId ≥ 2e12) → vkSender (messages.send от сообщества, plain text)
 *
 * sendPushSafely учитывает:
 * - per-user notification prefs (marketing_promo / marketing_rewards / transactional)
 * - quiet hours
 * - daily 5/sutki + weekly 1/неделю лимиты
 * - dead-tokens auto-cleanup (blocked / forbidden / chat not found игнорируются)
 *
 * sendRaw — та же платформо-маршрутизация БЕЗ квот/prefs: для транзакционных
 * сообщений и админ-рассылок, которые раньше дёргали bot.api.sendMessage напрямую.
 * ⚠️ Прямые bot.api.sendMessage(chatId) по сохранённому chat_id ЗАПРЕЩЕНЫ —
 * chat_id может оказаться VK-юзером.
 *
 * Factory `createPushService(bot, vkSender?)` — bot reference из startup.
 * Тестам можно мокать `bot.api.sendMessage` / vkSender.send.
 */

import type { Bot } from "grammy";
import { canSendNotification, logNotification, NotificationKind, getVkMessagesAllowed } from "./db";
import { isVkId, toPlatformId } from "./platform";
import type { VkSender } from "./vk/sender";
import { log } from "./logger";

export interface PushService {
  sendPushSafely: (
    chatId: number,
    kind: NotificationKind,
    text: string,
    opts?: { parse_mode?: "Markdown" | "HTML" }
  ) => Promise<boolean>;
  /** Платформо-роутинг без квот/prefs (транзакционные и админ-сообщения). */
  sendRaw: (
    chatId: number,
    text: string,
    opts?: { parse_mode?: "Markdown" | "HTML" }
  ) => Promise<boolean>;
}

export function createPushService(bot: Bot, vkSender?: VkSender): PushService {
  async function sendRaw(
    chatId: number,
    text: string,
    opts?: { parse_mode?: "Markdown" | "HTML" }
  ): Promise<boolean> {
    if (isVkId(chatId)) {
      if (!vkSender?.configured) return false;
      // Явный запрет сообщений от сообщества (message_deny) — не дёргаем API
      const allowed = await getVkMessagesAllowed(chatId).catch(() => null);
      if (allowed === false) return false;
      return vkSender.send(toPlatformId(chatId), text);
    }
    try {
      await bot.api.sendMessage(chatId, text, opts?.parse_mode ? { parse_mode: opts.parse_mode } : undefined);
      return true;
    } catch (e) {
      const msg = (e as Error).message || "";
      // Юзер заблокировал бот / удалил чат — это норма, не error
      if (!/blocked|forbidden|chat not found/i.test(msg)) {
        log.warn({ chatId, err: msg }, "[push raw]");
      }
      return false;
    }
  }

  return {
    sendRaw,
    async sendPushSafely(chatId, kind, text, opts) {
      const gate = await canSendNotification(chatId, kind)
        .catch(() => ({ ok: false as const, reason: "db_error" }));
      if (!gate.ok) {
        log.debug({ chatId, kind, reason: gate.reason }, "[push skipped]");
        return false;
      }
      const ok = await sendRaw(chatId, text, { parse_mode: opts?.parse_mode ?? "Markdown" });
      if (ok) await logNotification(chatId, kind).catch(() => {});
      return ok;
    },
  };
}

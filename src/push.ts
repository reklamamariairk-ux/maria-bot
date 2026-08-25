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
import { reserveNotification, completeNotificationReservation, NotificationKind, getVkMessagesAllowed } from "./db";
import { isVkId, isMaxId, toPlatformId } from "./platform";
import type { VkSender } from "./vk/sender";
import { log } from "./logger";

export interface PushService {
  sendPushSafely: (
    chatId: number,
    kind: NotificationKind,
    text: string,
    opts?: { parse_mode?: "Markdown" | "HTML"; dedupeKey?: string }
  ) => Promise<boolean>;
  /** Платформо-роутинг без квот/prefs (транзакционные и админ-сообщения). */
  sendRaw: (
    chatId: number,
    text: string,
    opts?: { parse_mode?: "Markdown" | "HTML"; dedupeKey?: string }
  ) => Promise<boolean>;
}

export function createPushService(bot: Bot, vkSender?: VkSender): PushService {
  async function deliverRaw(
    chatId: number,
    text: string,
    opts?: { parse_mode?: "Markdown" | "HTML" }
  ): Promise<boolean> {
    // МАКС: своего sender'а пока нет (Bot API botapi.max.ru, появится после
    // регистрации бота «Марии»). Молча скипаем, НЕ роняя вызывающий код.
    if (isMaxId(chatId)) {
      log.debug({ chatId }, "[push] max-платформа: sender не настроен, скип");
      return false;
    }
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
    async sendRaw(chatId, text, opts) {
      if (!opts?.dedupeKey) return deliverRaw(chatId, text, opts);
      const reservation = await reserveNotification(chatId, "transactional", opts.dedupeKey)
        .catch(() => ({ ok: false as const, reason: "db_error" }));
      if (!reservation.ok || !reservation.token) return false;
      const ok = await deliverRaw(chatId, text, opts);
      await completeNotificationReservation(reservation.token, ok)
        .catch((e) => log.warn({ chatId, err: (e as Error).message }, "[raw push reservation complete]"));
      return ok;
    },
    async sendPushSafely(chatId, kind, text, opts) {
      const reservation = await reserveNotification(chatId, kind, opts?.dedupeKey)
        .catch(() => ({ ok: false as const, reason: "db_error" }));
      if (!reservation.ok || !reservation.token) {
        log.debug({ chatId, kind, reason: reservation.reason }, "[push skipped]");
        return false;
      }
      const ok = await deliverRaw(chatId, text, { parse_mode: opts?.parse_mode ?? "Markdown" });
      await completeNotificationReservation(reservation.token, ok)
        .catch((e) => log.warn({ chatId, kind, err: (e as Error).message }, "[push reservation complete]"));
      return ok;
    },
  };
}

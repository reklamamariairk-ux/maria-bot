/**
 * Push-notification сервис — smart wrapper над bot.api.sendMessage.
 *
 * Учитывает:
 * - per-user notification prefs (marketing_promo / marketing_rewards / transactional)
 * - quiet hours
 * - daily 5/sutki + weekly 1/неделю лимиты
 * - dead-tokens auto-cleanup (blocked / forbidden / chat not found игнорируются)
 *
 * Factory `createPushService(bot)` чтобы передавать bot reference из startup.
 * Без bot — нельзя инициализировать. Тестам можно мокать `bot.api.sendMessage`.
 */

import type { Bot } from "grammy";
import { canSendNotification, logNotification, NotificationKind } from "./db";
import { log } from "./logger";

export interface PushService {
  sendPushSafely: (
    chatId: number,
    kind: NotificationKind,
    text: string,
    opts?: { parse_mode?: "Markdown" | "HTML" }
  ) => Promise<boolean>;
}

export function createPushService(bot: Bot): PushService {
  return {
    async sendPushSafely(chatId, kind, text, opts) {
      const gate = await canSendNotification(chatId, kind)
        .catch(() => ({ ok: false as const, reason: "db_error" }));
      if (!gate.ok) {
        log.debug({ chatId, kind, reason: gate.reason }, "[push skipped]");
        return false;
      }
      try {
        await bot.api.sendMessage(chatId, text, { parse_mode: opts?.parse_mode ?? "Markdown" });
        await logNotification(chatId, kind).catch(() => {});
        return true;
      } catch (e) {
        const msg = (e as Error).message || "";
        // Юзер заблокировал бот / удалил чат — это норма, не error
        if (!/blocked|forbidden|chat not found/i.test(msg)) {
          log.warn({ chatId, kind, err: msg }, "[push]");
        }
        return false;
      }
    },
  };
}

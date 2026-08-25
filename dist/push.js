"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPushService = createPushService;
const db_1 = require("./db");
const platform_1 = require("./platform");
const logger_1 = require("./logger");
function createPushService(bot, vkSender) {
    async function deliverRaw(chatId, text, opts) {
        // МАКС: своего sender'а пока нет (Bot API botapi.max.ru, появится после
        // регистрации бота «Марии»). Молча скипаем, НЕ роняя вызывающий код.
        if ((0, platform_1.isMaxId)(chatId)) {
            logger_1.log.debug({ chatId }, "[push] max-платформа: sender не настроен, скип");
            return false;
        }
        if ((0, platform_1.isVkId)(chatId)) {
            if (!vkSender?.configured)
                return false;
            // Явный запрет сообщений от сообщества (message_deny) — не дёргаем API
            const allowed = await (0, db_1.getVkMessagesAllowed)(chatId).catch(() => null);
            if (allowed === false)
                return false;
            return vkSender.send((0, platform_1.toPlatformId)(chatId), text);
        }
        try {
            await bot.api.sendMessage(chatId, text, opts?.parse_mode ? { parse_mode: opts.parse_mode } : undefined);
            return true;
        }
        catch (e) {
            const msg = e.message || "";
            // Юзер заблокировал бот / удалил чат — это норма, не error
            if (!/blocked|forbidden|chat not found/i.test(msg)) {
                logger_1.log.warn({ chatId, err: msg }, "[push raw]");
            }
            return false;
        }
    }
    return {
        async sendRaw(chatId, text, opts) {
            if (!opts?.dedupeKey)
                return deliverRaw(chatId, text, opts);
            const reservation = await (0, db_1.reserveNotification)(chatId, "transactional", opts.dedupeKey)
                .catch(() => ({ ok: false, reason: "db_error" }));
            if (!reservation.ok || !reservation.token)
                return false;
            const ok = await deliverRaw(chatId, text, opts);
            await (0, db_1.completeNotificationReservation)(reservation.token, ok)
                .catch((e) => logger_1.log.warn({ chatId, err: e.message }, "[raw push reservation complete]"));
            return ok;
        },
        async sendPushSafely(chatId, kind, text, opts) {
            const reservation = await (0, db_1.reserveNotification)(chatId, kind, opts?.dedupeKey)
                .catch(() => ({ ok: false, reason: "db_error" }));
            if (!reservation.ok || !reservation.token) {
                logger_1.log.debug({ chatId, kind, reason: reservation.reason }, "[push skipped]");
                return false;
            }
            const ok = await deliverRaw(chatId, text, { parse_mode: opts?.parse_mode ?? "Markdown" });
            await (0, db_1.completeNotificationReservation)(reservation.token, ok)
                .catch((e) => logger_1.log.warn({ chatId, kind, err: e.message }, "[push reservation complete]"));
            return ok;
        },
    };
}

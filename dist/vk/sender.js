"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createVkSender = createVkSender;
const crypto_1 = __importDefault(require("crypto"));
const links_1 = require("../links");
const logger_1 = require("../logger");
const VK_API = "https://api.vk.com/method";
const VK_API_VERSION = "5.199";
// Коды ошибок messages.send, означающие «юзер не разрешил/запретил сообщения»
const NOT_ALLOWED_CODES = new Set([900, 901, 902, 936]);
function createVkSender() {
    const token = process.env.VK_GROUP_TOKEN ?? "";
    if (!token) {
        return { configured: false, send: async () => false };
    }
    return {
        configured: true,
        async send(vkUserId, text, keyboard) {
            try {
                const params = new URLSearchParams({
                    user_id: String(vkUserId),
                    message: (0, links_1.stripMarkdown)(text),
                    random_id: String(crypto_1.default.randomInt(1, 2 ** 31)),
                    access_token: token,
                    v: VK_API_VERSION,
                });
                if (keyboard)
                    params.set("keyboard", keyboard);
                const res = await fetch(`${VK_API}/messages.send`, {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: params.toString(),
                });
                const json = (await res.json());
                if (json.error) {
                    if (!NOT_ALLOWED_CODES.has(json.error.error_code ?? 0)) {
                        logger_1.log.warn({ vkUserId, code: json.error.error_code, msg: json.error.error_msg }, "[vk send]");
                    }
                    return false;
                }
                return true;
            }
            catch (e) {
                logger_1.log.warn({ vkUserId, err: e.message }, "[vk send]");
                return false;
            }
        },
    };
}

"use strict";
/**
 * Валидация VK Mini App launch params.
 *
 * VK при запуске мини-аппа передаёт query-string вида
 *   vk_app_id=123&vk_user_id=456&vk_ts=...&sign=AbC...
 * Подпись: base64url( HMAC-SHA256( "k=v&k=v" из отсортированных vk_*-параметров,
 * «защищённый ключ» приложения ) ). Алгоритм — по официальным докам VK Mini Apps.
 *
 * Фронт шлёт сырую query-string в заголовке `Authorization: vk <qs>`.
 * Без VK_APP_SECRET валидация всегда null → схема vk отдаёт 401 (TG-only режим).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyVkLaunchParams = verifyVkLaunchParams;
exports.verifyVkPhoneSign = verifyVkPhoneSign;
const crypto_1 = __importDefault(require("crypto"));
const auth_validation_1 = require("./auth-validation");
const platform_1 = require("./platform");
const VK_APP_SECRET = process.env.VK_APP_SECRET ?? "";
const VK_APP_ID = Number(process.env.VK_APP_ID ?? 0);
function verifyVkLaunchParams(qs) {
    if (!qs || !VK_APP_SECRET)
        return null;
    let params;
    try {
        params = new URLSearchParams(qs);
    }
    catch {
        return null;
    }
    if (!(0, auth_validation_1.hasUniqueQueryKeys)(params))
        return null;
    const sign = params.get("sign");
    if (!sign)
        return null;
    // Подписываются ТОЛЬКО vk_*-параметры, отсортированные по имени,
    // в URL-кодировке (как querystring.stringify: %20, не '+').
    const signedString = [...params.entries()]
        .filter(([k]) => k.startsWith("vk_"))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&");
    if (!signedString)
        return null;
    const calc = crypto_1.default
        .createHmac("sha256", VK_APP_SECRET)
        .update(signedString)
        .digest("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    // timing-safe сравнение
    const a = Buffer.from(calc);
    const b = Buffer.from(sign);
    if (a.length !== b.length || !crypto_1.default.timingSafeEqual(a, b))
        return null;
    // Свежесть запуска — 24h, как у Telegram initData
    if (!(0, auth_validation_1.isFreshAuthTimestamp)(params.get("vk_ts")))
        return null;
    const vkUserId = Number(params.get("vk_user_id") ?? 0);
    const appId = Number(params.get("vk_app_id") ?? 0);
    if (!(0, auth_validation_1.isValidPlatformId)(vkUserId, platform_1.MAX_ID_OFFSET - platform_1.VK_ID_OFFSET) || !(0, auth_validation_1.isValidPlatformId)(appId))
        return null;
    // Если VK_APP_ID задан — принимаем подписи только своего приложения
    if (VK_APP_ID && appId !== VK_APP_ID)
        return null;
    return { vkUserId, appId };
}
/**
 * Проверка подписи результата VKWebAppGetPhoneNumber.
 * VK возвращает { phone_number, sign }, где по докам VK Mini Apps API:
 * sign = SHA256( AppID + ApiSecret + UserID + "phone_number" + значение ).
 * (Источник: VKCOM/vk-mini-apps-api, описание getPhoneNumber.)
 * Сравниваем в hex (lowercase); ApiSecret = защищённый ключ приложения.
 */
function verifyVkPhoneSign(phoneNumber, vkUserId, sign) {
    if (!VK_APP_SECRET || !VK_APP_ID || !phoneNumber || !sign)
        return false;
    const calc = crypto_1.default
        .createHash("sha256")
        .update(`${VK_APP_ID}${VK_APP_SECRET}${vkUserId}phone_number${phoneNumber}`)
        .digest("hex");
    const a = Buffer.from(calc);
    const b = Buffer.from(sign.toLowerCase());
    return a.length === b.length && crypto_1.default.timingSafeEqual(a, b);
}

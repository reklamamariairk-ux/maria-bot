"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.maxConfigured = void 0;
exports.verifyMaxInitData = verifyMaxInitData;
/**
 * Верификация запуска мини-приложения МАКС (max.ru).
 *
 * Алгоритм (dev.max.ru/docs/webapps/validation) — тот же, что у Telegram WebApp:
 *   1. initData = query-string из window.WebApp.initData (бридж st.max.ru/js/max-web-app.js).
 *   2. hash вынимается, остальные пары сортируются по ключу и склеиваются через \n.
 *   3. secret_key = HMAC-SHA256(key="WebAppData", message=MAX_BOT_TOKEN).
 *   4. подпись = HMAC-SHA256(secret_key, data_check_string) hex === hash.
 *
 * Без MAX_BOT_TOKEN в env всегда возвращает null — платформа выключена
 * (деплой безопасен до регистрации бота «Марии» в кабинете dev.max.ru).
 */
const crypto_1 = __importDefault(require("crypto"));
const auth_validation_1 = require("./auth-validation");
const platform_1 = require("./platform");
const MAX_BOT_TOKEN = process.env.MAX_BOT_TOKEN ?? "";
function verifyMaxInitData(initData) {
    if (!initData || !MAX_BOT_TOKEN)
        return null;
    const params = new URLSearchParams(initData);
    // Официальная спецификация MAX требует единственности каждого параметра.
    if (!(0, auth_validation_1.hasUniqueQueryKeys)(params))
        return null;
    const hash = params.get("hash");
    if (!hash)
        return null;
    params.delete("hash");
    const dataCheckString = [...params.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");
    const secretKey = crypto_1.default.createHmac("sha256", "WebAppData").update(MAX_BOT_TOKEN).digest();
    const calcHash = crypto_1.default.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
    const bCalc = Buffer.from(calcHash);
    const bHash = Buffer.from(hash);
    if (bCalc.length !== bHash.length || !crypto_1.default.timingSafeEqual(bCalc, bHash))
        return null;
    // auth_date входит в официальный InitData и обязателен: ограничиваем replay 24 часами.
    if (!(0, auth_validation_1.isFreshAuthTimestamp)(params.get("auth_date")))
        return null;
    const userJson = params.get("user");
    if (!userJson)
        return null;
    try {
        const u = JSON.parse(userJson);
        return u && (0, auth_validation_1.isValidPlatformId)(u.id, Number.MAX_SAFE_INTEGER - platform_1.MAX_ID_OFFSET) ? u : null;
    }
    catch {
        return null;
    }
}
const maxConfigured = () => Boolean(MAX_BOT_TOKEN);
exports.maxConfigured = maxConfigured;

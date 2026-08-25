"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AUTH_FUTURE_SKEW_SECONDS = exports.AUTH_MAX_AGE_SECONDS = void 0;
exports.isFreshAuthTimestamp = isFreshAuthTimestamp;
exports.hasUniqueQueryKeys = hasUniqueQueryKeys;
exports.isValidPlatformId = isValidPlatformId;
/** Общие строгие проверки подписанных launch-параметров платформ. */
exports.AUTH_MAX_AGE_SECONDS = 24 * 60 * 60;
exports.AUTH_FUTURE_SKEW_SECONDS = 5 * 60;
/**
 * Подпись сама по себе не ограничивает replay. Принимаем данные не старше суток
 * и допускаем только небольшой уход часов клиента/платформы вперёд.
 */
function isFreshAuthTimestamp(value, nowSeconds = Date.now() / 1000, maxAgeSeconds = exports.AUTH_MAX_AGE_SECONDS, futureSkewSeconds = exports.AUTH_FUTURE_SKEW_SECONDS) {
    const timestamp = Number(value);
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || !Number.isFinite(nowSeconds))
        return false;
    const age = nowSeconds - timestamp;
    return age <= maxAgeSeconds && age >= -futureSkewSeconds;
}
/** Не допускаем неоднозначный разбор `a=1&a=2` разными слоями приложения. */
function hasUniqueQueryKeys(params) {
    const seen = new Set();
    for (const key of params.keys()) {
        if (seen.has(key))
            return false;
        seen.add(key);
    }
    return true;
}
/** Platform ID должен точно помещаться в JS number и выделенный namespace. */
function isValidPlatformId(value, maxExclusive = Number.MAX_SAFE_INTEGER) {
    return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) < maxExclusive;
}

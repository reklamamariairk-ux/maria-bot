"use strict";
/**
 * Платформы и namespacing внутренних ID.
 *
 * ⚠️ КЛЮЧЕВОЕ СОГЛАШЕНИЕ ПРОЕКТА (с порта на VK, 06.2026):
 * Все таблицы БД ключуются по `chat_id BIGINT` — историческое имя из Telegram-эпохи.
 * Чтобы не трогать ~25 таблиц, юзеры других платформ хранятся в тех же колонках со СДВИГОМ:
 *
 *   internalId(TG)   = tg_user_id                       (< ~1e11)
 *   internalId(VK)   = VK_ID_OFFSET  + vk_user_id       (VK id < 1e10)
 *   internalId(MAX)  = MAX_ID_OFFSET + max_user_id      (МАКС, добавлен 08.2026)
 *
 * VK_ID_OFFSET = 2e12, MAX_ID_OFFSET = 4e12 → диапазоны не пересекаются,
 * всё < 2^53 (Number точен).
 *
 * Правила:
 * - ВНУТРИ БД и push-квот — всегда internalId.
 * - НАРУЖУ (юзеру в UI/QR, в Bitrix-комментарии, во внешние API) — ТОЛЬКО
 *   toPlatformId(internalId) + platformOf(internalId). Никогда не светить 2e12+.
 * - Роутинг отправки сообщений — по platformOf(internalId).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_ID_OFFSET = exports.VK_ID_OFFSET = void 0;
exports.toInternalId = toInternalId;
exports.isVkId = isVkId;
exports.isMaxId = isMaxId;
exports.platformOf = platformOf;
exports.toPlatformId = toPlatformId;
exports.platformLabel = platformLabel;
exports.VK_ID_OFFSET = 2000000000000;
exports.MAX_ID_OFFSET = 4000000000000;
function toInternalId(platform, platformId) {
    if (platform === "vk")
        return exports.VK_ID_OFFSET + platformId;
    if (platform === "max")
        return exports.MAX_ID_OFFSET + platformId;
    return platformId;
}
function isVkId(internalId) {
    return internalId >= exports.VK_ID_OFFSET && internalId < exports.MAX_ID_OFFSET;
}
function isMaxId(internalId) {
    return internalId >= exports.MAX_ID_OFFSET;
}
function platformOf(internalId) {
    return isMaxId(internalId) ? "max" : isVkId(internalId) ? "vk" : "tg";
}
/** Обратно в "родной" id платформы — для отображения юзеру и внешних систем. */
function toPlatformId(internalId) {
    if (isMaxId(internalId))
        return internalId - exports.MAX_ID_OFFSET;
    if (isVkId(internalId))
        return internalId - exports.VK_ID_OFFSET;
    return internalId;
}
/** Человекочитаемая метка платформы (для Bitrix-комментариев и логов). */
function platformLabel(internalId) {
    const p = platformOf(internalId);
    return p === "max" ? "МАКС Mini App" : p === "vk" ? "VK Mini App" : "Telegram Mini App";
}

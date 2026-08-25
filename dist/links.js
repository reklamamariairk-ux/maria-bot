"use strict";
/**
 * Платформо-зависимые ссылки на Mini App.
 *
 * Пуши и share-тексты должны вести в приложение ТОЙ платформы, где живёт
 * получатель: TG-юзеру — t.me-deep-link, VK-юзеру — vk.com/app<ID>#param.
 * Платформа получателя определяется по internalId (см. platform.ts).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.miniAppLink = miniAppLink;
exports.referralLink = referralLink;
exports.clickerReferralLink = clickerReferralLink;
exports.clickerFriendLink = clickerFriendLink;
exports.withAppLinkForVk = withAppLinkForVk;
exports.stripMarkdown = stripMarkdown;
const platform_1 = require("./platform");
const BOT_USERNAME = "mariatortik_bot";
const VK_APP_ID = process.env.VK_APP_ID ?? "";
// Публичная ссылка мини-аппа в МАКС (выдаётся после регистрации в dev.max.ru,
// формат https://max.ru/... — задать в env). Пусто = МАКС-юзерам даём t.me-фоллбек.
const MAX_APP_URL = process.env.MAX_APP_URL ?? "";
/**
 * Ссылка на Mini App для конкретного получателя (по internalId).
 * startParam — например `rate_12345` или `wish_M3X7K2P9`; пустой = просто открыть app.
 *
 * VK: параметр уезжает в hash (`#rate_12345`) — фронт читает его в App.startParam().
 * Если VK_APP_ID не задан (TG-only деплой) — VK-ссылка деградирует в t.me
 * (такого получателя в БД и быть не должно).
 */
function miniAppLink(internalId, startParam = "") {
    if ((0, platform_1.platformOf)(internalId) === "vk" && VK_APP_ID) {
        return `https://vk.com/app${VK_APP_ID}${startParam ? `#${startParam}` : ""}`;
    }
    if ((0, platform_1.platformOf)(internalId) === "max" && MAX_APP_URL) {
        return `${MAX_APP_URL}${startParam ? `#${startParam}` : ""}`;
    }
    return `https://t.me/${BOT_USERNAME}${startParam ? `?startapp=${startParam}` : ""}`;
}
/** Ссылка "пригласи друга" (реферальная). VK: hash ref_<code>; TG: ?start=. */
function referralLink(internalId, code) {
    if ((0, platform_1.platformOf)(internalId) === "vk" && VK_APP_ID) {
        return `https://vk.com/app${VK_APP_ID}#ref_${code}`;
    }
    return `https://t.me/${BOT_USERNAME}?start=ref_${code}`;
}
/**
 * Реф-ссылка кликера «Котик Комбат» (своя схема `ckref_<internalId>`, читается
 * фронтом в App.startParam()). TG: `?startapp=ckref_` (открывает Mini App с
 * параметром), VK: `#ckref_` в hash. code = internalId пригласившего.
 */
function clickerReferralLink(internalId) {
    const code = String(internalId);
    if ((0, platform_1.platformOf)(internalId) === "vk" && VK_APP_ID) {
        return `https://vk.com/app${VK_APP_ID}#ckref_${code}`;
    }
    // ?start= → уходит в /start бота (обрабатывает ckref_ и регистрирует реферал).
    // Самый надёжный путь: не зависит от настроек Mini App (в отличие от ?startapp=).
    return `https://t.me/${BOT_USERNAME}?start=ckref_${code}`;
}
/**
 * Ссылка «кода дружбы» голубятни (`ckfr_<internalId>`): получатель кликает —
 * бот связывает обоих в pigeon_friends (взаимно, клик = согласие). TG-only MVP:
 * VK-юзерам отдаём ту же t.me-ссылку (перейдут в TG-бота).
 */
function clickerFriendLink(internalId) {
    return `https://t.me/${BOT_USERNAME}?start=ckfr_${internalId}`;
}
/**
 * Для VK-получателя добавляет в конец текста ссылку на мини-апп (в VK push
 * без ссылки ведёт в никуда — нет постоянной webApp-кнопки как в TG-чате).
 * Для TG возвращает текст без изменений (байт-в-байт прежнее поведение).
 */
function withAppLinkForVk(internalId, text) {
    if ((0, platform_1.platformOf)(internalId) !== "vk" || !VK_APP_ID)
        return text;
    return `${text}\n\n${miniAppLink(internalId)}`;
}
/**
 * VK messages.send не понимает Markdown — перед отправкой VK-юзеру текст
 * прогоняется через это. Снимает жирный, курсив, `code` и [text](url) → "text url".
 */
function stripMarkdown(text) {
    return text
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 $2")
        .replace(/([*_`])(\S(?:[^*_`]*\S)?)\1/g, "$2");
}

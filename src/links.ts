/**
 * Платформо-зависимые ссылки на Mini App.
 *
 * Пуши и share-тексты должны вести в приложение ТОЙ платформы, где живёт
 * получатель: TG-юзеру — t.me-deep-link, VK-юзеру — vk.com/app<ID>#param.
 * Платформа получателя определяется по internalId (см. platform.ts).
 */

import { platformOf } from "./platform";

const BOT_USERNAME = "mariatortik_bot";
const VK_APP_ID = process.env.VK_APP_ID ?? "";

/**
 * Ссылка на Mini App для конкретного получателя (по internalId).
 * startParam — например `rate_12345` или `wish_M3X7K2P9`; пустой = просто открыть app.
 *
 * VK: параметр уезжает в hash (`#rate_12345`) — фронт читает его в App.startParam().
 * Если VK_APP_ID не задан (TG-only деплой) — VK-ссылка деградирует в t.me
 * (такого получателя в БД и быть не должно).
 */
export function miniAppLink(internalId: number, startParam = ""): string {
  if (platformOf(internalId) === "vk" && VK_APP_ID) {
    return `https://vk.com/app${VK_APP_ID}${startParam ? `#${startParam}` : ""}`;
  }
  return `https://t.me/${BOT_USERNAME}${startParam ? `?startapp=${startParam}` : ""}`;
}

/** Ссылка "пригласи друга" (реферальная). VK: hash ref_<code>; TG: ?start=. */
export function referralLink(internalId: number, code: string): string {
  if (platformOf(internalId) === "vk" && VK_APP_ID) {
    return `https://vk.com/app${VK_APP_ID}#ref_${code}`;
  }
  return `https://t.me/${BOT_USERNAME}?start=ref_${code}`;
}

/**
 * Реф-ссылка кликера «Котик Комбат» (своя схема `ckref_<internalId>`, читается
 * фронтом в App.startParam()). TG: `?startapp=ckref_` (открывает Mini App с
 * параметром), VK: `#ckref_` в hash. code = internalId пригласившего.
 */
export function clickerReferralLink(internalId: number): string {
  const code = String(internalId);
  if (platformOf(internalId) === "vk" && VK_APP_ID) {
    return `https://vk.com/app${VK_APP_ID}#ckref_${code}`;
  }
  // ?start= → уходит в /start бота (обрабатывает ckref_ и регистрирует реферал).
  // Самый надёжный путь: не зависит от настроек Mini App (в отличие от ?startapp=).
  return `https://t.me/${BOT_USERNAME}?start=ckref_${code}`;
}

/**
 * Для VK-получателя добавляет в конец текста ссылку на мини-апп (в VK push
 * без ссылки ведёт в никуда — нет постоянной webApp-кнопки как в TG-чате).
 * Для TG возвращает текст без изменений (байт-в-байт прежнее поведение).
 */
export function withAppLinkForVk(internalId: number, text: string): string {
  if (platformOf(internalId) !== "vk" || !VK_APP_ID) return text;
  return `${text}\n\n${miniAppLink(internalId)}`;
}

/**
 * VK messages.send не понимает Markdown — перед отправкой VK-юзеру текст
 * прогоняется через это. Снимает жирный, курсив, `code` и [text](url) → "text url".
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 $2")
    .replace(/([*_`])(\S(?:[^*_`]*\S)?)\1/g, "$2");
}

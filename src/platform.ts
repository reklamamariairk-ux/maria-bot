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

export type Platform = "tg" | "vk" | "max";

export const VK_ID_OFFSET = 2_000_000_000_000;
export const MAX_ID_OFFSET = 4_000_000_000_000;

export function toInternalId(platform: Platform, platformId: number): number {
  if (platform === "vk") return VK_ID_OFFSET + platformId;
  if (platform === "max") return MAX_ID_OFFSET + platformId;
  return platformId;
}

export function isVkId(internalId: number): boolean {
  return internalId >= VK_ID_OFFSET && internalId < MAX_ID_OFFSET;
}

export function isMaxId(internalId: number): boolean {
  return internalId >= MAX_ID_OFFSET;
}

export function platformOf(internalId: number): Platform {
  return isMaxId(internalId) ? "max" : isVkId(internalId) ? "vk" : "tg";
}

/** Обратно в "родной" id платформы — для отображения юзеру и внешних систем. */
export function toPlatformId(internalId: number): number {
  if (isMaxId(internalId)) return internalId - MAX_ID_OFFSET;
  if (isVkId(internalId)) return internalId - VK_ID_OFFSET;
  return internalId;
}

/** Человекочитаемая метка платформы (для Bitrix-комментариев и логов). */
export function platformLabel(internalId: number): string {
  const p = platformOf(internalId);
  return p === "max" ? "МАКС Mini App" : p === "vk" ? "VK Mini App" : "Telegram Mini App";
}

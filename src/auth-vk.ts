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

import crypto from "crypto";
import { hasUniqueQueryKeys, isFreshAuthTimestamp, isValidPlatformId } from "./auth-validation";
import { MAX_ID_OFFSET, VK_ID_OFFSET } from "./platform";

export interface VkLaunchUser {
  /** Родной VK user id (НЕ namespaced). */
  vkUserId: number;
  appId: number;
}

// На первом VK-деплое защищённый ключ приложения оказался сохранён под
// историческим именем VK_CALLBACK_SECRET. Поддерживаем оба имени как набор
// ключей ротации: подпись всё равно обязана точно совпасть хотя бы с одним
// серверным секретом, а значение ни при каких условиях не уходит на клиент.
const VK_APP_SECRETS = [...new Set([
  process.env.VK_APP_SECRET ?? "",
  process.env.VK_CALLBACK_SECRET ?? "",
].filter(Boolean))];
const VK_APP_ID = Number(process.env.VK_APP_ID ?? 0);

function signatureMatches(value: string, expected: string): boolean {
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifyVkLaunchParams(qs: string): VkLaunchUser | null {
  if (!qs || !VK_APP_SECRETS.length) return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(qs);
  } catch {
    return null;
  }
  if (!hasUniqueQueryKeys(params)) return null;
  const sign = params.get("sign");
  if (!sign) return null;

  // Подписываются ТОЛЬКО vk_*-параметры, отсортированные по имени,
  // в URL-кодировке (как querystring.stringify: %20, не '+').
  const signedString = [...params.entries()]
    .filter(([k]) => k.startsWith("vk_"))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  if (!signedString) return null;

  const validSignature = VK_APP_SECRETS.some((secret) => {
    const calc = crypto
      .createHmac("sha256", secret)
      .update(signedString)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    return signatureMatches(calc, sign);
  });
  if (!validSignature) return null;

  // Свежесть запуска — 24h, как у Telegram initData
  if (!isFreshAuthTimestamp(params.get("vk_ts"))) return null;

  const vkUserId = Number(params.get("vk_user_id") ?? 0);
  const appId = Number(params.get("vk_app_id") ?? 0);
  if (!isValidPlatformId(vkUserId, MAX_ID_OFFSET - VK_ID_OFFSET) || !isValidPlatformId(appId)) return null;
  // Если VK_APP_ID задан — принимаем подписи только своего приложения
  if (VK_APP_ID && appId !== VK_APP_ID) return null;

  return { vkUserId, appId };
}

/**
 * Проверка подписи результата VKWebAppGetPhoneNumber.
 * VK возвращает { phone_number, sign }, где по докам VK Mini Apps API:
 * sign = SHA256( AppID + ApiSecret + UserID + "phone_number" + значение ).
 * (Источник: VKCOM/vk-mini-apps-api, описание getPhoneNumber.)
 * Сравниваем в hex (lowercase); ApiSecret = защищённый ключ приложения.
 */
export function verifyVkPhoneSign(phoneNumber: string, vkUserId: number, sign: string): boolean {
  if (!VK_APP_SECRETS.length || !VK_APP_ID || !phoneNumber || !sign) return false;
  return VK_APP_SECRETS.some((secret) => {
    const calc = crypto
      .createHash("sha256")
      .update(`${VK_APP_ID}${secret}${vkUserId}phone_number${phoneNumber}`)
      .digest("hex");
    return signatureMatches(calc, sign.toLowerCase());
  });
}

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
import crypto from "crypto";
import type { TgUser } from "./auth";

const MAX_BOT_TOKEN = process.env.MAX_BOT_TOKEN ?? "";

export function verifyMaxInitData(initData: string): TgUser | null {
  if (!initData || !MAX_BOT_TOKEN) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(MAX_BOT_TOKEN).digest();
  const calcHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  const bCalc = Buffer.from(calcHash);
  const bHash = Buffer.from(hash);
  if (bCalc.length !== bHash.length || !crypto.timingSafeEqual(bCalc, bHash)) return null;

  // Свежесть подписи — как у TG (если МАКС кладёт auth_date; нет поля → не режем)
  const authDate = Number(params.get("auth_date") ?? 0);
  if (authDate && Date.now() / 1000 - authDate > 86400) return null;

  const userJson = params.get("user");
  if (!userJson) return null;
  try {
    const u = JSON.parse(userJson) as TgUser;
    return u && u.id ? u : null;
  } catch {
    return null;
  }
}

export const maxConfigured = (): boolean => Boolean(MAX_BOT_TOKEN);

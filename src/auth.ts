import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

export interface TgUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

const BOT_TOKEN = process.env.BOT_TOKEN ?? "";

// Verify Telegram WebApp initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
// initData is the raw query-string from window.Telegram.WebApp.initData
export function verifyInitData(initData: string): TgUser | null {
  if (!initData || !BOT_TOKEN) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const calcHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (calcHash !== hash) return null;

  // Reject if older than 24h
  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null;

  const userJson = params.get("user");
  if (!userJson) return null;
  try {
    return JSON.parse(userJson) as TgUser;
  } catch {
    return null;
  }
}

// Express middleware: extracts verified user from `Authorization: tma <initData>` and puts on req.tgUser
export function requireTgUser(req: Request, res: Response, next: NextFunction) {
  const auth = req.header("Authorization") ?? "";
  const initData = auth.startsWith("tma ") ? auth.slice(4) : "";
  const user = verifyInitData(initData);
  if (!user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  (req as Request & { tgUser?: TgUser }).tgUser = user;
  next();
}

export function getTgUser(req: Request): TgUser | undefined {
  return (req as Request & { tgUser?: TgUser }).tgUser;
}

// Optional verify: достаёт TgUser из заголовка Authorization, если присутствует и валидный.
// Не 401-ит — просто возвращает undefined.
export function tryGetTgUser(req: Request): TgUser | undefined {
  const cached = (req as Request & { tgUser?: TgUser }).tgUser;
  if (cached) return cached;
  const auth = req.header("Authorization") ?? "";
  const initData = auth.startsWith("tma ") ? auth.slice(4) : "";
  if (!initData) return undefined;
  const user = verifyInitData(initData);
  if (user) (req as Request & { tgUser?: TgUser }).tgUser = user;
  return user ?? undefined;
}

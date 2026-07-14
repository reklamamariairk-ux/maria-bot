import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { verifyVkLaunchParams } from "./auth-vk";
import { toInternalId, type Platform } from "./platform";

export interface TgUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

/**
 * Унифицированный юзер обеих платформ.
 * id — ВНУТРЕННИЙ (namespaced, см. platform.ts): для TG = tg id, для VK = 2e12 + vk id.
 * Все БД-операции работают с ним без изменений. Наружу — toPlatformId(id).
 * Структурно совместим с TgUser → существующие роуты работают как есть.
 */
export interface AppUser extends TgUser {
  platform: Platform;
  /** Родной id платформы (для отображения/внешних систем). */
  platformId: number;
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
  // Constant-time сравнение (как в auth-vk.ts / app-auth.ts) — не течём длиной префикса.
  const bCalc = Buffer.from(calcHash);
  const bHash = Buffer.from(hash);
  if (bCalc.length !== bHash.length || !crypto.timingSafeEqual(bCalc, bHash)) return null;

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

// ─── Унифицированная авторизация (tma + vk) ─────────────────────────────────

type AuthedRequest = Request & { appUser?: AppUser; tgUser?: TgUser };

/**
 * Имя VK-юзера не входит в подписанные launch params (в отличие от TG initData).
 * Фронт может прислать его в заголовке `x-vk-user` (JSON {first_name,last_name}) —
 * НЕ доверять для security, использовать ТОЛЬКО для отображения/персонализации.
 */
function vkDisplayName(req: Request): { first_name?: string; last_name?: string } {
  try {
    const raw = req.header("x-vk-user");
    if (!raw) return {};
    const j = JSON.parse(raw) as { first_name?: unknown; last_name?: unknown };
    const clean = (v: unknown) =>
      typeof v === "string" ? v.replace(/[<>]/g, "").slice(0, 64) : undefined;
    return { first_name: clean(j.first_name), last_name: clean(j.last_name) };
  } catch {
    return {};
  }
}

/** Парсит Authorization (tma <initData> | vk <launchParamsQS>) → AppUser. Кэширует на req. */
function resolveUser(req: Request): AppUser | undefined {
  const r = req as AuthedRequest;
  if (r.appUser) return r.appUser;
  const auth = req.header("Authorization") ?? "";

  let user: AppUser | undefined;
  if (auth.startsWith("tma ")) {
    const tg = verifyInitData(auth.slice(4));
    if (tg) user = { ...tg, platform: "tg", platformId: tg.id };
  } else if (auth.startsWith("vk ")) {
    const vk = verifyVkLaunchParams(auth.slice(3));
    if (vk) {
      user = {
        id: toInternalId("vk", vk.vkUserId),
        platform: "vk",
        platformId: vk.vkUserId,
        ...vkDisplayName(req),
      };
    }
  }
  if (user) {
    r.appUser = user;
    r.tgUser = user; // legacy-поле: все старые consumers получают internalId
  }
  return user;
}

// Express middleware: верифицирует юзера любой платформы, кладёт на req
export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!resolveUser(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

export function getUser(req: Request): AppUser | undefined {
  return (req as AuthedRequest).appUser;
}

export function tryGetUser(req: Request): AppUser | undefined {
  return resolveUser(req);
}

// ─── Legacy-алиасы (17 файлов импортируют — НЕ переименовывать) ──────────────
// С VK-порта принимают ОБЕ платформы; id в TgUser = internalId (см. platform.ts).

export const requireTgUser = requireUser;

export function getTgUser(req: Request): TgUser | undefined {
  return (req as AuthedRequest).appUser;
}

export function tryGetTgUser(req: Request): TgUser | undefined {
  return resolveUser(req);
}

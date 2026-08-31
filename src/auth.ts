import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { verifyVkLaunchParams } from "./auth-vk";
import { verifyMaxInitData } from "./auth-max";
import { canonicalChatId } from "./account-link";
import { toInternalId, type Platform } from "./platform";
import { hasUniqueQueryKeys, isFreshAuthTimestamp, isValidPlatformId } from "./auth-validation";
import { VK_ID_OFFSET } from "./platform";

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
  if (!hasUniqueQueryKeys(params)) return null;
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

  // Replay-окно 24ч; далеко будущий auth_date тоже не должен обходить срок.
  if (!isFreshAuthTimestamp(params.get("auth_date"))) return null;

  const userJson = params.get("user");
  if (!userJson) return null;
  try {
    const user = JSON.parse(userJson) as TgUser;
    return user && isValidPlatformId(user.id, VK_ID_OFFSET) ? user : null;
  } catch {
    return null;
  }
}

// ─── Унифицированная авторизация (tma + vk) ─────────────────────────────────

type AuthedRequest = Request & { appUser?: AppUser; tgUser?: TgUser };

/**
 * Имя VK-юзера не входит в подписанные launch params (в отличие от TG initData).
 * Фронт присылает его в ASCII-safe заголовке `x-vk-user`
 * (encodeURIComponent(JSON {first_name,last_name})); старый сырой JSON тоже читаем.
 * НЕ доверять для security, использовать ТОЛЬКО для отображения/персонализации.
 */
export function parseVkDisplayNameHeader(raw: string | null | undefined): { first_name?: string; last_name?: string } {
  try {
    if (!raw) return {};
    const json = /^%7b/i.test(raw) ? decodeURIComponent(raw) : raw;
    const j = JSON.parse(json) as { first_name?: unknown; last_name?: unknown };
    const clean = (v: unknown) =>
      typeof v === "string" ? v.replace(/[<>]/g, "").slice(0, 64) : undefined;
    return { first_name: clean(j.first_name), last_name: clean(j.last_name) };
  } catch {
    return {};
  }
}

function vkDisplayName(req: Request): { first_name?: string; last_name?: string } {
  return parseVkDisplayNameHeader(req.header("x-vk-user"));
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
    const rawVk = auth.slice(3);
    const vk = verifyVkLaunchParams(rawVk);
    if (!vk) {
      // Диагностика только метаданных: не логируем launch-параметры и подпись.
      try {
        const p = new URLSearchParams(rawVk);
        console.warn("[vk-auth] launch rejected", {
          rawLength: rawVk.length,
          keys: [...p.keys()].filter((k) => k !== "sign").sort(),
          appId: p.get("vk_app_id") ?? null,
          userIdPresent: Boolean(p.get("vk_user_id")),
          tsPresent: Boolean(p.get("vk_ts")),
          signLength: p.get("sign")?.length ?? 0,
        });
      } catch {
        console.warn("[vk-auth] launch rejected: malformed params", { rawLength: rawVk.length });
      }
    }
    if (vk) {
      user = {
        id: toInternalId("vk", vk.vkUserId),
        platform: "vk",
        platformId: vk.vkUserId,
        ...vkDisplayName(req),
      };
    }
  } else if (auth.startsWith("max ")) {
    const mx = verifyMaxInitData(auth.slice(4));
    if (mx) {
      user = { ...mx, id: toInternalId("max", mx.id), platform: "max", platformId: mx.id };
    }
  }
  if (user) {
    r.appUser = user;
    r.tgUser = user; // legacy-поле: все старые consumers получают internalId
  }
  return user;
}

// Express middleware: верифицирует юзера любой платформы, кладёт на req.
// Если аккаунт связан по телефону (account-link.ts) — id подменяется на
// канонический: человек играет одним профилем с любой платформы.
export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const user = resolveUser(req);
  if (!user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    const canon = await canonicalChatId(user.id);
    if (canon !== user.id) user.id = canon;
  } catch {
    // Продолжать под platform id опасно: у связанного пользователя появится
    // второй игровой профиль. Клиент безопасно повторит запрос после восстановления БД.
    res.status(503).json({ error: "auth_unavailable" });
    return;
  }
  next();
}

/** Необязательная авторизация: анонимный запрос пропускается, валидный получает
 * appUser и канонический id. Нужна публичным маршрутам вроде AI-чата. */
export async function optionalUser(req: Request, _res: Response, next: NextFunction) {
  const user = resolveUser(req);
  if (user) {
    try {
      const canon = await canonicalChatId(user.id);
      if (canon !== user.id) user.id = canon;
    } catch {}
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

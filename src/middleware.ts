/**
 * Express middleware'ы вынесенные из src/index.ts.
 * - rateLimit(maxPerMinute) — sliding window per (user/IP, HTTP method, path).
 * - adminToken — проверка `x-user-token` или `body.token` против ADMIN_TOKEN.
 *
 * requireTgUser/getTgUser/tryGetTgUser лежат в `src/auth.ts` (не трогаем).
 */

import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

export type AdminRole = "viewer" | "operator" | "superadmin";
declare global {
  namespace Express { interface Request { adminRole?: AdminRole } }
}

/**
 * Constant-time сравнение секретов (токены, HMAC). Обычный `===`/`!==` завершается
 * на первом различающемся байте → тайминг выдаёт длину совпавшего префикса.
 * Возвращает false для пустых/разной длины строк без раскрытия тайминга.
 */
export function safeEq(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// ── Rate limit ──────────────────────────────────────────────────────────────
// Простой sliding window per-IP + per-path. Bucket очищается каждые 5 мин.
const rateBuckets = new Map<string, number[]>();

export function rateLimit(maxPerMinute: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    // req.ip уважает `app.set("trust proxy", 1)` — берёт реальный клиентский IP,
    // добавленный Caddy справа в X-Forwarded-For. Раньше здесь брался ЛЕВЫЙ элемент
    // XFF (клиентский, подделываемый) → лимит обходился любым заголовком.
    // Авторизованные запросы лимитируем по юзеру, не по IP: мобильные операторы
    // прячут толпу абонентов за одним CGNAT-IP, и общий IP-лимит душил бы всех разом.
    // requireTgUser стоит в цепочке ДО rateLimit и уже положил appUser на req.
    const uid = (req as { appUser?: { id?: number } }).appUser?.id;
    const who = uid ? `u${uid}` : (req.ip || req.socket.remoteAddress || "unknown");
    // GET и POST одного URL — разные операции и часто имеют разные лимиты.
    // Если складывать их в один bucket, POST /tune + следующий GET /tune
    // преждевременно исчерпывают лимит друг друга при серийной прокачке.
    const key = `${who}:${req.method.toUpperCase()}:${req.path}`;
    const now = Date.now();
    const win = 60_000;
    const arr = (rateBuckets.get(key) || []).filter((t) => now - t < win);
    if (arr.length >= maxPerMinute) {
      res.status(429).json({
        ok: false,
        error: "rate_limited",
        message: "Слишком много запросов. Подожди минуту.",
      });
      return;
    }
    arr.push(now);
    rateBuckets.set(key, arr);
    next();
  };
}

// Чистим старые ведра раз в 5 минут чтобы Map не разрастался
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of rateBuckets) {
    const fresh = arr.filter((t) => now - t < 60_000);
    if (fresh.length === 0) rateBuckets.delete(k);
    else rateBuckets.set(k, fresh);
  }
}, 5 * 60_000);

// ── Admin token middleware ─────────────────────────────────────────────────
/** Проверяет `x-user-token` header или `body.token` против ADMIN_TOKEN env. */
export function requireAdminToken(req: Request, res: Response, next: NextFunction): void {
  const token = req.header("x-user-token")
             || (req.body as { token?: string })?.token;
  const role = getAdminRole(token);
  if (!role) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  req.adminRole = role;
  next();
}

export function getAdminRole(token: string | undefined): AdminRole | null {
  if (process.env.ADMIN_TOKEN && safeEq(token, process.env.ADMIN_TOKEN)) return "superadmin";
  if (process.env.ADMIN_OPS_TOKEN && safeEq(token, process.env.ADMIN_OPS_TOKEN)) return "operator";
  if (process.env.ADMIN_VIEW_TOKEN && safeEq(token, process.env.ADMIN_VIEW_TOKEN)) return "viewer";
  return null;
}

export function requireAdminRole(role: AdminRole) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const order: Record<AdminRole, number> = { viewer: 1, operator: 2, superadmin: 3 };
    if (!req.adminRole || order[req.adminRole] < order[role]) {
      res.status(403).json({ error: "insufficient_admin_role", required: role });
      return;
    }
    next();
  };
}

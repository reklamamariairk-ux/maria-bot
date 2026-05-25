/**
 * Express middleware'ы вынесенные из src/index.ts.
 * - rateLimit(maxPerMinute) — sliding window per (IP, path).
 * - adminToken — проверка `x-user-token` или `body.token` против ADMIN_TOKEN.
 *
 * requireTgUser/getTgUser/tryGetTgUser лежат в `src/auth.ts` (не трогаем).
 */

import type { Request, Response, NextFunction } from "express";

// ── Rate limit ──────────────────────────────────────────────────────────────
// Простой sliding window per-IP + per-path. Bucket очищается каждые 5 мин.
const rateBuckets = new Map<string, number[]>();

export function rateLimit(maxPerMinute: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
            || req.socket.remoteAddress
            || "unknown";
    const key = `${ip}:${req.path}`;
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
             || (req.body as { token?: string })?.token
             || (req.query.token as string | undefined);
  if (!token || token !== process.env.ADMIN_TOKEN) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}

/**
 * Авторизация именно игровых маршрутов «Котик Комбат».
 *
 * Обычная requireTgUser подтверждает подпись платформы и канонизирует связанный
 * аккаунт. Этот слой дополнительно запрещает доступ профилям, которые оператор
 * заблокировал в игровой админке. Проверка живёт на HTTP-границе, поэтому её не
 * могут обойти прямым вызовом маршрутов Дома, Голубятни или отдельных вкладок.
 */
import type { Request, Response, NextFunction } from "express";
import { requireTgUser as requireAppUser, getTgUser } from "./auth";
import { pool } from "./db";
import { log } from "./logger";

const accessCache = new Map<number, { blocked: boolean; expires: number }>();
// Блок/разблок из админки инвалидирует запись немедленно. Минутный fast-path
// убирает отдельный SELECT перед каждым тап-батчем и игровой кнопкой.
const ACCESS_CACHE_MS = 60_000;

/** Админская блокировка инвалидирует fast-path немедленно. */
export function clearGameAccessCache(chatId: number): void {
  accessCache.delete(chatId);
}

export async function requireGameUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  let authenticated = false;
  await requireAppUser(req, res, () => { authenticated = true; });
  if (!authenticated) return;

  const user = getTgUser(req)!;
  try {
    const now = Date.now();
    let blocked: boolean;
    const cached = accessCache.get(user.id);
    if (cached && cached.expires > now) blocked = cached.blocked;
    else {
      const { rows } = await pool.query(
        `SELECT admin_blocked FROM clicker_state WHERE chat_id=$1`,
        [user.id]
      );
      blocked = Boolean(rows[0]?.admin_blocked);
      accessCache.set(user.id, { blocked, expires: now + ACCESS_CACHE_MS });
      if (accessCache.size > 10_000) {
        for (const [id, item] of accessCache) if (item.expires <= now) accessCache.delete(id);
        // Даже если все записи свежие, не позволяем карте расти без границы.
        if (accessCache.size > 10_000) accessCache.delete(accessCache.keys().next().value!);
      }
    }
    if (blocked) {
      res.status(403).json({ error: "account_blocked" });
      return;
    }
    next();
  } catch (error) {
    log.error({ err: error, chatId: user.id }, "[game access]");
    res.status(500).json({ error: "internal" });
  }
}

// Удобные legacy-имена для игровых router-файлов: достаточно сменить источник
// импорта, не размазывая особую проверку по каждой ручке.
export const requireTgUser = requireGameUser;
export { getTgUser };

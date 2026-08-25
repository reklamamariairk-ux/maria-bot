"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTgUser = exports.requireTgUser = void 0;
exports.clearGameAccessCache = clearGameAccessCache;
exports.requireGameUser = requireGameUser;
const auth_1 = require("./auth");
Object.defineProperty(exports, "getTgUser", { enumerable: true, get: function () { return auth_1.getTgUser; } });
const db_1 = require("./db");
const logger_1 = require("./logger");
const accessCache = new Map();
const ACCESS_CACHE_MS = 5000;
/** Админская блокировка инвалидирует fast-path немедленно. */
function clearGameAccessCache(chatId) {
    accessCache.delete(chatId);
}
async function requireGameUser(req, res, next) {
    let authenticated = false;
    await (0, auth_1.requireTgUser)(req, res, () => { authenticated = true; });
    if (!authenticated)
        return;
    const user = (0, auth_1.getTgUser)(req);
    try {
        const now = Date.now();
        let blocked;
        const cached = accessCache.get(user.id);
        if (cached && cached.expires > now)
            blocked = cached.blocked;
        else {
            const { rows } = await db_1.pool.query(`SELECT admin_blocked FROM clicker_state WHERE chat_id=$1`, [user.id]);
            blocked = Boolean(rows[0]?.admin_blocked);
            accessCache.set(user.id, { blocked, expires: now + ACCESS_CACHE_MS });
            if (accessCache.size > 10000) {
                for (const [id, item] of accessCache)
                    if (item.expires <= now)
                        accessCache.delete(id);
                // Даже если все записи свежие, не позволяем карте расти без границы.
                if (accessCache.size > 10000)
                    accessCache.delete(accessCache.keys().next().value);
            }
        }
        if (blocked) {
            res.status(403).json({ error: "account_blocked" });
            return;
        }
        next();
    }
    catch (error) {
        logger_1.log.error({ err: error, chatId: user.id }, "[game access]");
        res.status(500).json({ error: "internal" });
    }
}
// Удобные legacy-имена для игровых router-файлов: достаточно сменить источник
// импорта, не размазывая особую проверку по каждой ручке.
exports.requireTgUser = requireGameUser;

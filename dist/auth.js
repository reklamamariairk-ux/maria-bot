"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireTgUser = void 0;
exports.verifyInitData = verifyInitData;
exports.requireUser = requireUser;
exports.optionalUser = optionalUser;
exports.getUser = getUser;
exports.tryGetUser = tryGetUser;
exports.getTgUser = getTgUser;
exports.tryGetTgUser = tryGetTgUser;
const crypto_1 = __importDefault(require("crypto"));
const auth_vk_1 = require("./auth-vk");
const auth_max_1 = require("./auth-max");
const account_link_1 = require("./account-link");
const platform_1 = require("./platform");
const auth_validation_1 = require("./auth-validation");
const platform_2 = require("./platform");
const BOT_TOKEN = process.env.BOT_TOKEN ?? "";
// Verify Telegram WebApp initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
// initData is the raw query-string from window.Telegram.WebApp.initData
function verifyInitData(initData) {
    if (!initData || !BOT_TOKEN)
        return null;
    const params = new URLSearchParams(initData);
    if (!(0, auth_validation_1.hasUniqueQueryKeys)(params))
        return null;
    const hash = params.get("hash");
    if (!hash)
        return null;
    params.delete("hash");
    const dataCheckString = [...params.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");
    const secretKey = crypto_1.default.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
    const calcHash = crypto_1.default.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
    // Constant-time сравнение (как в auth-vk.ts / app-auth.ts) — не течём длиной префикса.
    const bCalc = Buffer.from(calcHash);
    const bHash = Buffer.from(hash);
    if (bCalc.length !== bHash.length || !crypto_1.default.timingSafeEqual(bCalc, bHash))
        return null;
    // Replay-окно 24ч; далеко будущий auth_date тоже не должен обходить срок.
    if (!(0, auth_validation_1.isFreshAuthTimestamp)(params.get("auth_date")))
        return null;
    const userJson = params.get("user");
    if (!userJson)
        return null;
    try {
        const user = JSON.parse(userJson);
        return user && (0, auth_validation_1.isValidPlatformId)(user.id, platform_2.VK_ID_OFFSET) ? user : null;
    }
    catch {
        return null;
    }
}
/**
 * Имя VK-юзера не входит в подписанные launch params (в отличие от TG initData).
 * Фронт может прислать его в заголовке `x-vk-user` (JSON {first_name,last_name}) —
 * НЕ доверять для security, использовать ТОЛЬКО для отображения/персонализации.
 */
function vkDisplayName(req) {
    try {
        const raw = req.header("x-vk-user");
        if (!raw)
            return {};
        const j = JSON.parse(raw);
        const clean = (v) => typeof v === "string" ? v.replace(/[<>]/g, "").slice(0, 64) : undefined;
        return { first_name: clean(j.first_name), last_name: clean(j.last_name) };
    }
    catch {
        return {};
    }
}
/** Парсит Authorization (tma <initData> | vk <launchParamsQS>) → AppUser. Кэширует на req. */
function resolveUser(req) {
    const r = req;
    if (r.appUser)
        return r.appUser;
    const auth = req.header("Authorization") ?? "";
    let user;
    if (auth.startsWith("tma ")) {
        const tg = verifyInitData(auth.slice(4));
        if (tg)
            user = { ...tg, platform: "tg", platformId: tg.id };
    }
    else if (auth.startsWith("vk ")) {
        const vk = (0, auth_vk_1.verifyVkLaunchParams)(auth.slice(3));
        if (vk) {
            user = {
                id: (0, platform_1.toInternalId)("vk", vk.vkUserId),
                platform: "vk",
                platformId: vk.vkUserId,
                ...vkDisplayName(req),
            };
        }
    }
    else if (auth.startsWith("max ")) {
        const mx = (0, auth_max_1.verifyMaxInitData)(auth.slice(4));
        if (mx) {
            user = { ...mx, id: (0, platform_1.toInternalId)("max", mx.id), platform: "max", platformId: mx.id };
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
async function requireUser(req, res, next) {
    const user = resolveUser(req);
    if (!user) {
        res.status(401).json({ error: "unauthorized" });
        return;
    }
    try {
        const canon = await (0, account_link_1.canonicalChatId)(user.id);
        if (canon !== user.id)
            user.id = canon;
    }
    catch {
        // Продолжать под platform id опасно: у связанного пользователя появится
        // второй игровой профиль. Клиент безопасно повторит запрос после восстановления БД.
        res.status(503).json({ error: "auth_unavailable" });
        return;
    }
    next();
}
/** Необязательная авторизация: анонимный запрос пропускается, валидный получает
 * appUser и канонический id. Нужна публичным маршрутам вроде AI-чата. */
async function optionalUser(req, _res, next) {
    const user = resolveUser(req);
    if (user) {
        try {
            const canon = await (0, account_link_1.canonicalChatId)(user.id);
            if (canon !== user.id)
                user.id = canon;
        }
        catch { }
    }
    next();
}
function getUser(req) {
    return req.appUser;
}
function tryGetUser(req) {
    return resolveUser(req);
}
// ─── Legacy-алиасы (17 файлов импортируют — НЕ переименовывать) ──────────────
// С VK-порта принимают ОБЕ платформы; id в TgUser = internalId (см. platform.ts).
exports.requireTgUser = requireUser;
function getTgUser(req) {
    return req.appUser;
}
function tryGetTgUser(req) {
    return resolveUser(req);
}

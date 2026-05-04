"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyInitData = verifyInitData;
exports.requireTgUser = requireTgUser;
exports.getTgUser = getTgUser;
const crypto_1 = __importDefault(require("crypto"));
const BOT_TOKEN = process.env.BOT_TOKEN ?? "";
// Verify Telegram WebApp initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
// initData is the raw query-string from window.Telegram.WebApp.initData
function verifyInitData(initData) {
    if (!initData || !BOT_TOKEN)
        return null;
    const params = new URLSearchParams(initData);
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
    if (calcHash !== hash)
        return null;
    // Reject if older than 24h
    const authDate = Number(params.get("auth_date") ?? 0);
    if (!authDate || Date.now() / 1000 - authDate > 86400)
        return null;
    const userJson = params.get("user");
    if (!userJson)
        return null;
    try {
        return JSON.parse(userJson);
    }
    catch {
        return null;
    }
}
// Express middleware: extracts verified user from `Authorization: tma <initData>` and puts on req.tgUser
function requireTgUser(req, res, next) {
    const auth = req.header("Authorization") ?? "";
    const initData = auth.startsWith("tma ") ? auth.slice(4) : "";
    const user = verifyInitData(initData);
    if (!user) {
        res.status(401).json({ error: "unauthorized" });
        return;
    }
    req.tgUser = user;
    next();
}
function getTgUser(req) {
    return req.tgUser;
}

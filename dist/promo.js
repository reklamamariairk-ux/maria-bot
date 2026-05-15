"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadPromoCodes = loadPromoCodes;
exports.reloadPromoCodes = reloadPromoCodes;
exports.findPromo = findPromo;
exports.validatePromoSync = validatePromoSync;
/**
 * Промокоды: чтение из data/promo-codes.json + validate с проверкой условий.
 * Использования логируются в таблицу promo_uses (см. db.ts).
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const PROMO_FILE = path_1.default.join(__dirname, "..", "data", "promo-codes.json");
let _promoCache = null;
function loadPromoCodes() {
    if (_promoCache)
        return _promoCache;
    try {
        if (fs_1.default.existsSync(PROMO_FILE)) {
            const raw = fs_1.default.readFileSync(PROMO_FILE, "utf-8");
            const data = JSON.parse(raw);
            _promoCache = Array.isArray(data.codes) ? data.codes.map((c) => ({
                ...c,
                code: String(c.code || "").toUpperCase(),
            })) : [];
            return _promoCache;
        }
    }
    catch (e) {
        console.error("[promo] load failed:", e.message);
    }
    _promoCache = [];
    return _promoCache;
}
function reloadPromoCodes() {
    _promoCache = null;
    return loadPromoCodes().length;
}
function findPromo(code) {
    const norm = String(code || "").trim().toUpperCase();
    if (!norm)
        return null;
    const codes = loadPromoCodes();
    return codes.find((c) => c.code === norm) ?? null;
}
/**
 * Чистая валидация — БЕЗ проверки `one_per_user` и `max_uses_total`.
 * Те проверки async и делаются в endpoint'е (требуют DB).
 */
function validatePromoSync(input) {
    const promo = findPromo(input.code);
    if (!promo)
        return { promo: null, result: { ok: false, reason: "not_found" } };
    // expires_at — формат YYYY-MM-DD, сравниваем со «сегодня Иркутск»
    // (бизнес в UTC+8; иначе промокод бы жил лишние 8 часов после полуночи Иркутска).
    if (promo.expires_at) {
        const todayIrk = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
        if (promo.expires_at < todayIrk) {
            return { promo, result: { ok: false, reason: "expired" } };
        }
    }
    const cartTotal = Number(input.cart_total) || 0;
    if (promo.min_order && cartTotal < promo.min_order) {
        return {
            promo,
            result: { ok: false, reason: "min_order_not_met", discount: 0, code: promo.code },
        };
    }
    // Расчёт скидки
    let discount = 0;
    if (promo.type === "percent") {
        discount = Math.floor(cartTotal * (promo.value / 100));
    }
    else if (promo.type === "amount") {
        discount = Math.min(promo.value, cartTotal);
    }
    return {
        promo,
        result: {
            ok: true,
            code: promo.code,
            type: promo.type,
            value: promo.value,
            discount,
            description: promo.description,
        },
    };
}

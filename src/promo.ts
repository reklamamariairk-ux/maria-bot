/**
 * Промокоды: чтение из data/promo-codes.json + validate с проверкой условий.
 * Использования логируются в таблицу promo_uses (см. db.ts).
 */
import fs from "fs";
import path from "path";

export type PromoType = "percent" | "amount";

export interface PromoCode {
  code: string;
  type: PromoType;
  value: number;
  description: string;
  expires_at: string | null;
  min_order: number | null;
  max_uses_total: number | null;
  one_per_user: boolean;
}

const PROMO_FILE = path.join(__dirname, "..", "data", "promo-codes.json");
let _promoCache: PromoCode[] | null = null;

export function loadPromoCodes(): PromoCode[] {
  if (_promoCache) return _promoCache;
  try {
    if (fs.existsSync(PROMO_FILE)) {
      const raw = fs.readFileSync(PROMO_FILE, "utf-8");
      const data = JSON.parse(raw) as { codes?: PromoCode[] };
      _promoCache = Array.isArray(data.codes) ? data.codes.map((c) => ({
        ...c,
        code: String(c.code || "").toUpperCase(),
      })) : [];
      return _promoCache;
    }
  } catch (e) {
    console.error("[promo] load failed:", (e as Error).message);
  }
  _promoCache = [];
  return _promoCache;
}

export function reloadPromoCodes(): number {
  _promoCache = null;
  return loadPromoCodes().length;
}

export function findPromo(code: string): PromoCode | null {
  const norm = String(code || "").trim().toUpperCase();
  if (!norm) return null;
  const codes = loadPromoCodes();
  return codes.find((c) => c.code === norm) ?? null;
}

export interface ValidatePromoInput {
  code: string;
  cart_total: number;
  chat_id?: number;
}

export interface ValidatePromoResult {
  ok: boolean;
  /** Сообщение об ошибке (если ok=false) */
  reason?: string;
  /** Найденная скидка в рублях (если ok=true) */
  discount?: number;
  type?: PromoType;
  value?: number;
  description?: string;
  code?: string;
}

/**
 * Чистая валидация — БЕЗ проверки `one_per_user` и `max_uses_total`.
 * Те проверки async и делаются в endpoint'е (требуют DB).
 */
export function validatePromoSync(
  input: ValidatePromoInput
): { promo: PromoCode | null; result: ValidatePromoResult } {
  const promo = findPromo(input.code);
  if (!promo) return { promo: null, result: { ok: false, reason: "not_found" } };
  // expires_at — формат YYYY-MM-DD, сравниваем со «сегодня Иркутск»
  // (бизнес в UTC+8; иначе промокод бы жил лишние 8 часов после полуночи Иркутска).
  if (promo.expires_at) {
    const todayIrk = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
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
  } else if (promo.type === "amount") {
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

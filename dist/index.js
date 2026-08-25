"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const path_1 = __importDefault(require("path"));
const https_1 = __importDefault(require("https"));
const crypto_1 = __importDefault(require("crypto"));
const node_cron_1 = __importDefault(require("node-cron"));
const grammy_1 = require("grammy");
const logger_1 = require("./logger");
const middleware_1 = require("./middleware");
const sweet_check_1 = __importStar(require("./routes/sweet-check"));
const holidays_1 = __importDefault(require("./routes/holidays"));
const catalog_1 = require("./routes/catalog");
const reviews_1 = require("./routes/reviews");
const club_1 = __importDefault(require("./routes/club"));
const lk_1 = __importDefault(require("./routes/lk"));
const promo_1 = __importDefault(require("./routes/promo"));
const order_rating_1 = __importDefault(require("./routes/order-rating"));
const order_location_1 = __importStar(require("./routes/order-location"));
const cake_concept_1 = __importDefault(require("./routes/cake-concept"));
const selfie_cake_1 = __importDefault(require("./routes/selfie-cake"));
const wishlist_1 = require("./routes/wishlist");
const leads_1 = __importDefault(require("./routes/leads"));
const partners_1 = __importDefault(require("./routes/partners"));
const notify_prefs_1 = __importDefault(require("./routes/notify-prefs"));
const secret_of_day_1 = require("./routes/secret-of-day");
const push_1 = require("./push");
const sender_1 = require("./vk/sender");
const callback_1 = require("./vk/callback");
const vk_1 = require("./routes/vk");
const links_1 = require("./links");
const referral_1 = require("./routes/referral");
const wheel_streak_1 = require("./routes/wheel-streak");
const pigeons_1 = require("./routes/pigeons");
const db_1 = require("./db");
const user_1 = __importDefault(require("./routes/user"));
const game_1 = __importDefault(require("./routes/game"));
const pet_1 = __importDefault(require("./routes/pet"));
const app_auth_1 = __importStar(require("./routes/app-auth"));
const account_link_1 = require("./account-link");
const admin_game_1 = __importDefault(require("./routes/admin-game"));
const admin_system_1 = __importDefault(require("./routes/admin-system"));
const pet_2 = require("./pet");
const clicker_1 = __importDefault(require("./routes/clicker"));
const clicker_2 = require("./clicker");
const pigeons_2 = require("./pigeons");
const analytics_1 = require("./analytics");
const clicker_push_1 = require("./clicker-push");
const pet_push_1 = require("./pet-push");
const bonus1c_1 = require("./bonus1c");
const cart_1 = __importDefault(require("./routes/cart"));
const scraper_1 = require("./scraper");
const db_2 = require("./db");
const db_3 = require("./db");
const club_2 = require("./club");
const auth_1 = require("./auth");
const partners_2 = require("./partners");
const lk_2 = require("./lk");
const order_1 = require("./order");
const holidays_2 = require("./holidays");
const promo_2 = require("./promo");
const selfie_cake_2 = require("./selfie-cake");
const date_utils_1 = require("./date-utils");
// ─── Env ────────────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN ?? "";
const GROQ_KEY = process.env.GROQ_KEY ?? "";
const WEBHOOK_URL = process.env.WEBHOOK_URL ?? "";
const PORT = Number(process.env.PORT ?? 3000);
const MINI_APP_URL = process.env.MINI_APP_URL ?? WEBHOOK_URL;
const ADMIN_IDS = (process.env.ADMIN_IDS ?? "").split(",").map(Number).filter(Boolean);
// Preview-режим (staging): если BOT_TOKEN пуст — поднимаем только HTTP-сервер
// (Mini App + API), но НЕ инициализируем Telegram-бота. Webhook не ставится,
// бот не конфликтует с prod-ботом. GROQ_KEY тоже не строго обязателен — без него
// AI-чат отдаёт 503, но всё остальное работает.
const PREVIEW_MODE = !BOT_TOKEN;
if (PREVIEW_MODE) {
    console.log("[STAGE] BOT_TOKEN пустой → preview mode: Telegram-бот отключён, работают только HTTP + Mini App");
}
if (!GROQ_KEY && !PREVIEW_MODE)
    console.warn("[startup] GROQ_KEY не задан — AI-чат вернёт 503");
// ─── Каталог (в памяти) ──────────────────────────────────────────────────────
let catalog = (0, scraper_1.loadCatalog)();
async function refreshCatalog() {
    try {
        const prevIds = new Set(catalog.map((p) => p.id));
        catalog = await (0, scraper_1.scrapeCatalog)();
        // Diff: появились ли товары, которых раньше не было?
        if (prevIds.size > 0) {
            const newIds = catalog
                .map((p) => Number(p.id))
                .filter((id) => Number.isFinite(id) && !prevIds.has(id));
            if (newIds.length > 0) {
                notifyWishlistBackInStock(newIds).catch((e) => console.error("[WISHLIST notify]", e.message));
            }
        }
        prewarmImageCache().catch((e) => console.error("[IMG] prewarm failed:", e.message));
    }
    catch (e) {
        console.error("Ошибка обновления каталога:", e.message);
    }
}
async function notifyWishlistBackInStock(productIds) {
    const subs = await (0, db_2.getWishlistSubsForProducts)(productIds);
    if (subs.length === 0)
        return;
    // Группируем по chat_id чтобы отправить один push на юзера
    const byChat = new Map();
    for (const s of subs) {
        const arr = byChat.get(s.chat_id) ?? [];
        arr.push(s.product_id);
        byChat.set(s.chat_id, arr);
    }
    let sent = 0;
    for (const [chatId, pids] of byChat.entries()) {
        const products = pids
            .map((id) => catalog.find((p) => p.id === id))
            .filter((p) => Boolean(p))
            .slice(0, 5);
        if (products.length === 0)
            continue;
        const list = products.map((p) => {
            const priceStr = p.priceNumber != null ? `${p.priceNumber.toLocaleString("ru-RU")} ₽` : (p.price || "");
            return `• ${p.name}${priceStr ? ` — ${priceStr}` : ""}`;
        }).join("\n");
        const msg = `🎂 *Снова в наличии*\n\n${list}\n\nЗабери, пока есть — открой Mini App.`;
        const ok = await sendPushSafely(chatId, "marketing_rewards", (0, links_1.withAppLinkForVk)(chatId, msg));
        if (ok)
            sent++;
    }
    if (sent > 0)
        console.log(`[WISHLIST] notified ${sent} subscribers about ${productIds.length} new product(s)`);
}
// Pre-order push к ближайшим праздникам (cron — раз в день).
// За preorderDays до даты праздника рассылаем всем подписчикам, у которых
// включён marketing_promo. Дедуп — таблица holiday_push_log (chat_id+holiday+year).
async function pushHolidayPreorder() {
    const due = (0, holidays_2.getHolidaysToPushToday)();
    if (due.length === 0)
        return;
    const subs = await (0, db_2.getAllSubscribers)();
    for (const occ of due) {
        let sent = 0, skipped = 0;
        const body = occ.holiday.pushBody(occ.daysUntil);
        const text = `${occ.holiday.emoji} *${occ.holiday.name}*\n\n${body}`;
        for (const { chat_id } of subs) {
            // Идемпотентность: не пушить, если уже отправили этому юзеру в этом году
            if (await (0, db_2.hasHolidayPushSent)(chat_id, occ.holiday.id, occ.year).catch(() => false)) {
                skipped++;
                continue;
            }
            // marketing_promo проверяет prefs+quiet hours+глобальный 5/сутки.
            // Weekly-quota=1 проигнорировать нельзя — это поведение sendPushSafely;
            // но праздничные пуши разнесены минимум на 10 дней, так что в норме проходят.
            const ok = await sendPushSafely(chat_id, "marketing_promo", (0, links_1.withAppLinkForVk)(chat_id, text));
            if (ok) {
                sent++;
                await (0, db_2.markHolidayPushSent)(chat_id, occ.holiday.id, occ.year).catch(() => { });
            }
        }
        console.log(`[HOLIDAY] ${occ.holiday.id} (${occ.daysUntil}d before): sent=${sent} skipped=${skipped}`);
    }
}
// Post-order rating prompts — push «Оцени заказ» через 2-72h после терминального статуса.
// Запускается из cron'а раз в час. Дедуп через таблицу order_rating_prompts.
async function pushOrderRatingPrompts() {
    const subs = await (0, db_2.getAllSubscribers)();
    let sent = 0, checked = 0;
    for (const s of subs) {
        const phone = await (0, lk_2.getVerifiedPhone)(s.chat_id).catch(() => null);
        if (!phone)
            continue;
        const lk = await (0, lk_2.fetchLk)(s.chat_id).catch(() => null);
        if (!lk?.ok || !lk.data?.configured)
            continue;
        const orders = Array.isArray(lk.data.orders) ? lk.data.orders : [];
        if (orders.length === 0)
            continue;
        checked++;
        // Берём заказы со статусом «доставлен/выдан/завершён» возрастом 2-72 часа
        for (const o of orders) {
            const status = String(o.status || "").toLowerCase().trim();
            if (!/выдан|доставлен|доставлено|завершён|завершен|выполнен/.test(status))
                continue;
            let orderDate = null;
            try {
                const d = new Date(String(o.date).replace(" ", "T"));
                if (!isNaN(d.getTime()))
                    orderDate = d;
            }
            catch { }
            if (!orderDate)
                continue;
            const ageHours = (Date.now() - orderDate.getTime()) / 3600000;
            if (ageHours < 2 || ageHours > 72)
                continue;
            const orderId = String(o.id);
            // Дедуп: уже отправили?
            if (await (0, db_2.hasRatingPromptSent)(s.chat_id, orderId).catch(() => false))
                continue;
            // Уже оценил?
            if (await (0, db_2.getOrderRating)(s.chat_id, orderId).catch(() => null)) {
                await (0, db_2.markRatingPromptSent)(s.chat_id, orderId).catch(() => { });
                continue;
            }
            // Отправляем push с deep-link на rating-форму (платформа получателя)
            const link = (0, links_1.miniAppLink)(s.chat_id, `rate_${orderId}`);
            const msg = `⭐ *Как тебе заказ №${orderId}?*\n\nОцени за 5 секунд — поможешь нам стать лучше. И получишь персональную подсказку, что попробовать в следующий раз 🍰\n\n[Открыть форму](${link})`;
            const ok = await sendPushSafely(s.chat_id, "marketing_promo", msg, { dedupeKey: `rating:${orderId}` });
            if (ok) {
                sent++;
                await (0, db_2.markRatingPromptSent)(s.chat_id, orderId).catch(() => { });
            }
        }
    }
    if (sent > 0 || checked > 0)
        console.log(`[RATING-PROMPT] checked=${checked} sent=${sent}`);
}
// Cart abandonment — push юзерам, чья корзина живёт >24h без чекаута
async function pushCartAbandonments() {
    const abandoned = await (0, db_2.getAbandonedCarts)().catch(() => []);
    if (abandoned.length === 0)
        return;
    let sent = 0;
    for (const snap of abandoned) {
        const sum = Number(snap.total_sum) || 0;
        const cnt = Number(snap.item_count) || 0;
        const pluralItem = cnt === 1 ? "товар" : cnt < 5 ? "товара" : "товаров";
        const msg = `🛒 *Не забыл?*\n\nУ тебя в корзине ${cnt} ${pluralItem} на ${sum.toLocaleString("ru-RU")} ₽.\n\nЗабери до конца дня — открой Mini App.`;
        const snapshotKey = new Date(snap.snapshot_at).toISOString();
        const ok = await sendPushSafely(snap.chat_id, "marketing_promo", (0, links_1.withAppLinkForVk)(snap.chat_id, msg), {
            dedupeKey: `cart-abandoned:${snapshotKey}`,
        });
        if (ok) {
            sent++;
            // Тихие часы/сбой сети не должны навсегда запрещать повторную попытку.
            await (0, db_2.markCartAbandonedPushed)(snap.chat_id).catch(() => { });
        }
    }
    if (sent > 0)
        console.log(`[CART ABANDON] notified ${sent} subscribers`);
}
// ─── Воронка «Котик Комбат» (MVP T2/T3/T4) ──────────────────────────────────
// Все пуши/начисления по умолчанию ВЫКЛЮЧЕНЫ (env-флаги OFF) — крон считает и
// логирует в dry-run, но НЕ шлёт людям и НЕ начисляет баллы, пока флаг не поднят.
// Включение — outward-facing действие: включает Маша/владелец, когда готов.
const FUNNEL_RETENTION_ENABLED = process.env.FUNNEL_RETENTION_ENABLED === "1";
const FUNNEL_REF_BONUS_ENABLED = process.env.FUNNEL_REF_BONUS_ENABLED === "1";
const FUNNEL_EXPIRE_DAYS = Math.max(1, Number(process.env.FUNNEL_EXPIRE_DAYS) || 5);
const FUNNEL_REACT_DAYS = Math.max(3, Number(process.env.FUNNEL_REACT_DAYS) || 14);
const FUNNEL_REF_ORDER_POINTS = Math.max(0, Number(process.env.FUNNEL_REF_ORDER_POINTS) || 100);
// Напоминания о питомце «Василий» (голод / энергия) — см. pet-push.ts.
// По умолчанию (env не задан) ВЫКЛЮЧЕНЫ — включает Маша/владелец на VPS, когда готовы.
const PET_REMINDERS_ENABLED = process.env.PET_REMINDERS_ENABLED === "1";
function pluralRu(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11)
        return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20))
        return few;
    return many;
}
const pushDayIrk = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
// T2 — пуш «баллы сгорают»: реальные points, истекающие ≤ FUNNEL_EXPIRE_DAYS дней.
async function pushExpiringPoints() {
    const users = await (0, club_2.getExpiringPointsUsers)(FUNNEL_EXPIRE_DAYS).catch(() => []);
    if (users.length === 0)
        return;
    let sent = 0, dry = 0, skipped = 0;
    for (const u of users) {
        if (await (0, analytics_1.wasFunnelSent)(u.chatId, "points_expiry", FUNNEL_EXPIRE_DAYS + 1).catch(() => false)) {
            skipped++;
            continue;
        }
        const daysLeft = Math.max(1, Math.ceil((u.soonest.getTime() - Date.now()) / 86400000));
        const msg = `⏳ *Баллы скоро сгорают*\n\nУ тебя ${u.amount.toLocaleString("ru-RU")} бонусных ${pluralRu(u.amount, "балл", "балла", "баллов")} сгорят через ${daysLeft} ${pluralRu(daysLeft, "день", "дня", "дней")}. 1 балл = 1 ₽ — потрать их в заказе на maria-irk.ru, чтобы не потерять 🍰`;
        if (!FUNNEL_RETENTION_ENABLED) {
            dry++;
            continue;
        }
        const ok = await sendPushSafely(u.chatId, "marketing_promo", (0, links_1.withAppLinkForVk)(u.chatId, msg), { dedupeKey: `points-expiry:${pushDayIrk()}` });
        if (ok) {
            sent++;
            await (0, analytics_1.markFunnelSent)(u.chatId, "points_expiry");
        }
    }
    console.log(`[FUNNEL expiry] users=${users.length} sent=${sent} dry=${dry} skipped=${skipped} enabled=${FUNNEL_RETENTION_ENABLED}`);
}
// T3 — реактивация «Василий скучает»: игроки, уснувшие ≥ FUNNEL_REACT_DAYS дней.
async function pushReactivation() {
    const dormant = await (0, analytics_1.getDormantPlayers)(FUNNEL_REACT_DAYS, 90).catch(() => []);
    if (dormant.length === 0)
        return;
    let sent = 0, dry = 0, skipped = 0;
    for (const chatId of dormant) {
        if (await (0, analytics_1.wasFunnelSent)(chatId, "reactivation", FUNNEL_REACT_DAYS).catch(() => false)) {
            skipped++;
            continue;
        }
        const msg = `🐱 *Василий скучает!*\n\nДавно тебя не было в «Котик Комбат» — бизнес заскучал. Загляни, забери накопленные монеты и открой новых голубей-помощников!`;
        if (!FUNNEL_RETENTION_ENABLED) {
            dry++;
            continue;
        }
        const full = (0, links_1.withAppLinkForVk)(chatId, `${msg}\n\n${(0, links_1.miniAppLink)(chatId, "click")}`);
        const ok = await sendPushSafely(chatId, "marketing_game", full, { dedupeKey: `reactivation:${pushDayIrk()}` });
        if (ok) {
            sent++;
            await (0, analytics_1.markFunnelSent)(chatId, "reactivation");
        }
    }
    console.log(`[FUNNEL reactivate] dormant=${dormant.length} sent=${sent} dry=${dry} skipped=${skipped} enabled=${FUNNEL_RETENTION_ENABLED}`);
}
// T4 — реф-бонус за ПЕРВЫЙ заказ приглашённого: реальные points рефереру.
// Анти-абуз: только по реальному завершённому заказу приглашённого; дедуп флагом.
async function checkReferralFirstOrders() {
    const cands = await (0, clicker_2.getRefOrderCandidates)().catch(() => []);
    if (cands.length === 0)
        return;
    let paid = 0, checked = 0, dry = 0;
    for (const { invitee, referrer } of cands) {
        const phone = await (0, lk_2.getVerifiedPhone)(invitee).catch(() => null);
        if (!phone)
            continue; // без верифицированного телефона заказы не видим
        const lk = await (0, lk_2.fetchLk)(invitee).catch(() => null);
        if (!lk?.ok || !lk.data?.configured)
            continue;
        const orders = Array.isArray(lk.data.orders) ? lk.data.orders : [];
        const hasCompleted = orders.some((o) => /выдан|доставлен|доставлено|выполнен|завершён|завершен/.test(String(o.status ?? "").toLowerCase()));
        checked++;
        if (!hasCompleted)
            continue;
        if (!FUNNEL_REF_BONUS_ENABLED) {
            dry++;
            continue;
        }
        try {
            // Сначала идемпотентное начисление, затем флаг. Если процесс упадёт между ними,
            // следующий проход повторит тот же ключ без двойных баллов и завершит выдачу.
            await (0, club_2.earnPoints)(referrer, FUNNEL_REF_ORDER_POINTS, "referral_first_order", { invitee }, `referral-first-order:${invitee}`);
            const claimed = await (0, clicker_2.markRefOrderRewarded)(invitee);
            if (!claimed)
                continue; // другой параллельный проход уже отправит уведомление
            (0, analytics_1.trackEvent)(referrer, "referral_order", { invitee });
            const msg = `🎉 *Твой друг сделал первый заказ!*\n\nСпасибо, что привёл друга в «Марию» — тебе начислено ${FUNNEL_REF_ORDER_POINTS} бонусных ${pluralRu(FUNNEL_REF_ORDER_POINTS, "балл", "балла", "баллов")} (1 балл = 1 ₽). Потрать их в следующем заказе 🎂`;
            await sendPushSafely(referrer, "marketing_rewards", (0, links_1.withAppLinkForVk)(referrer, msg));
            paid++;
        }
        catch (e) {
            logger_1.log.error({ err: e, referrer, invitee }, "[FUNNEL ref-order] earnPoints failed");
        }
    }
    console.log(`[FUNNEL ref-order] cands=${cands.length} checked=${checked} paid=${paid} dry=${dry} enabled=${FUNNEL_REF_BONUS_ENABLED}`);
}
// Order status diff — обходит подписчиков с verified phone, тянет /api/lk, diff'ит статусы
const STATUS_EMOJI = {
    "новый": "📋",
    "новая": "📋",
    "обработка": "📞",
    "обрабатывается": "📞",
    "принят": "✅",
    "принято": "✅",
    "оплачен": "💳",
    "оплачен на сайте": "💳",
    "готовится": "🍳",
    "в работе": "🍳",
    "готов": "🎁",
    "готов к выдаче": "🎁",
    "ожидает выдачи": "🎁",
    "в доставке": "🚚",
    "в пути": "🚚",
    "доставлен": "✅",
    "доставлено": "✅",
    "выдан": "✅",
    "выдано": "✅",
    "завершён": "✅",
    "завершен": "✅",
    "выполнен": "✅",
    "отменён": "❌",
    "отменен": "❌",
    "отмена": "❌",
};
function statusEmoji(status) {
    const key = status.toLowerCase().trim();
    return STATUS_EMOJI[key] || "📦";
}
function isTerminalStatus(status) {
    const key = status.toLowerCase().trim();
    return /выдан|доставлен|доставлено|выполнен|завершён|завершен|отменён|отменен|отмена/.test(key);
}
async function checkOrderStatusChanges() {
    const subs = await (0, db_2.getAllSubscribers)();
    let pushed = 0;
    let checked = 0;
    for (const s of subs) {
        // Только верифицированные юзеры с реальным телефоном
        const phone = await (0, lk_2.getVerifiedPhone)(s.chat_id).catch(() => null);
        if (!phone)
            continue;
        const lk = await (0, lk_2.fetchLk)(s.chat_id).catch(() => null);
        if (!lk?.ok || !lk.data?.configured)
            continue;
        const orders = Array.isArray(lk.data.orders) ? lk.data.orders : [];
        if (orders.length === 0)
            continue;
        checked++;
        // Рассматриваем только активные заказы (не старше 14 дней)
        const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;
        const recent = orders.filter((o) => {
            try {
                const d = new Date(String(o.date).replace(" ", "T"));
                return !isNaN(d.getTime()) && Date.now() - d.getTime() < FOURTEEN_DAYS;
            }
            catch {
                return true;
            }
        });
        if (recent.length === 0)
            continue;
        const seen = await (0, db_2.getOrderStatusMap)(s.chat_id);
        for (const o of recent) {
            const orderId = String(o.id);
            const status = String(o.status ?? "").trim();
            if (!status)
                continue;
            const prev = seen.get(orderId);
            if (prev === undefined) {
                // Первый раз видим этот заказ — просто запомним, без push
                // (push о создании отправляет /api/order при создании)
                await (0, db_2.setOrderStatus)(s.chat_id, orderId, status).catch(() => { });
                continue;
            }
            if (prev === status)
                continue;
            // Статус изменился — пушим
            const emoji = statusEmoji(status);
            const msg = `${emoji} *Заказ №${orderId}* — ${status}`;
            const statusDedupeKey = `order-status:${orderId}:${status}`;
            const ok = await sendPushSafely(s.chat_id, "transactional", msg, {
                dedupeKey: statusDedupeKey,
            });
            const delivered = ok || await (0, db_3.wasNotificationSent)(s.chat_id, statusDedupeKey).catch(() => false);
            if (delivered) {
                if (ok)
                    pushed++;
                await (0, db_2.setOrderStatus)(s.chat_id, orderId, status).catch(() => { });
                // T6: событие воронки — заказ дошёл до завершённого (не отменённого) статуса.
                if (isTerminalStatus(status) && !/отмен/.test(status.toLowerCase())) {
                    (0, analytics_1.trackEvent)(s.chat_id, "order_completed", { orderId });
                }
            }
        }
    }
    if (pushed > 0 || checked > 0) {
        console.log(`[ORDER STATUS] checked=${checked} subs, pushed=${pushed} updates`);
    }
}
// Запускаем парсинг при старте (не блокируем сервер)
const needsScrape = catalog.length === 0;
if (needsScrape) {
    refreshCatalog();
}
else {
    console.log(`📦 Каталог загружен с диска: ${catalog.length} позиций (${(0, scraper_1.catalogAge)()})`);
    // Обновляем в фоне, не ждём
    refreshCatalog();
}
// Обновление каждые 24 часа
// Каталог обновляем каждый час — синхронизация с правками на сайте
setInterval(refreshCatalog, 10 * 60 * 1000); // 10 мин: правки каталога на сайте доезжают в приложение быстро
// Очистка старых файлов в /tmp (img_cache > 7 дней, lead_photos > 90 дней)
function cleanupTmpDir(dir, maxAgeMs) {
    try {
        const entries = require("fs").readdirSync(dir);
        const now = Date.now();
        let removed = 0;
        for (const f of entries) {
            try {
                const fp = require("path").join(dir, f);
                const st = require("fs").statSync(fp);
                if (now - st.mtimeMs > maxAgeMs) {
                    require("fs").unlinkSync(fp);
                    removed++;
                }
            }
            catch { }
        }
        if (removed > 0)
            console.log(`[CLEANUP] removed ${removed} stale files from ${dir}`);
    }
    catch { }
}
function runCleanup() {
    cleanupTmpDir("/tmp/img_cache", 7 * 24 * 60 * 60 * 1000); // 7 дней
    cleanupTmpDir("/tmp/lead_photos", 90 * 24 * 60 * 60 * 1000); // 90 дней
    (0, selfie_cake_2.cleanupOldSelfies)().catch(() => { }); // 2 часа (внутри модуля)
}
setInterval(runCleanup, 6 * 60 * 60 * 1000); // каждые 6 часов
setTimeout(runCleanup, 5 * 60 * 1000); // первая через 5 минут после старта
// Селфи имеют обещанный TTL 2 часа; частая отдельная страховка нужна после
// рестарта, когда персональные таймеры старого процесса уже потеряны.
setInterval(() => (0, selfie_cake_2.cleanupOldSelfies)().catch(() => { }), 10 * 60 * 1000);
setTimeout(() => (0, selfie_cake_2.cleanupOldSelfies)().catch(() => { }), 1000);
// ─── Telegram Bot ───────────────────────────────────────────────────────────
// В preview-режиме (staging без BOT_TOKEN) создаём бот с dummy-токеном —
// grammy не пингует api при new Bot(), а реальные вызовы к TG API будут
// валиться с 401 (которые уже под try/catch в push/notification коде).
// Webhook не ставится и bot.start() не вызывается — см. startup-блок внизу.
const bot = new grammy_1.Bot(BOT_TOKEN || "1:DUMMY_PREVIEW_TOKEN_AAAAAAAAAAAAAAAAAAAAAA");
// Push-service вынесен в src/push.ts. sendPushSafely остаётся доступным
// через привычное имя — фасад для существующих вызовов (push-functions,
// cron-jobs, /api/streak/touch, /api/wheel/spin и т.д.)
// VK-порт: пуши роутятся по платформе получателя (isVkId). Прямые
// bot.api.sendMessage по сохранённому chat_id запрещены — только send* отсюда.
const vkSender = (0, sender_1.createVkSender)();
const _pushService = (0, push_1.createPushService)(bot, vkSender);
const sendPushSafely = _pushService.sendPushSafely;
const sendRaw = _pushService.sendRaw;
(0, clicker_2.setClickerPushService)(_pushService); // пуш «копилка стаи полна» из donateSquadBank
// Приложение-магазин отменили (07.2026) — в боте живёт ТОЛЬКО игра «Котик
// Комбат» (game.html). Все Mini App-кнопки ведут в игру; корень (старый магазин)
// не открываем нигде. BotFather Main Mini App URL тоже = game.html.
const GAME_URL = (MINI_APP_URL || "https://bot.145-223-121-47.sslip.io").replace(/\/+$/, "") + "/game.html";
function webAppButton(_text, label = "🎮 Открыть игру") {
    return new grammy_1.InlineKeyboard().webApp(label, GAME_URL);
}
const gameButton = (label = "🎮 Открыть игру") => webAppButton("", label);
const WELCOME = `
🐱 Это *«Котик Комбат»* — игра кондитерской *«Мария»*!

Расти кота Василия от Котёнка-стажёра до Императора выпечки:
👆 Тапай — зарабатывай монеты и открывай 19 образов
🏪 Заводи бизнесы — монеты капают даже офлайн
🏠 Ухаживай за Василием в его Доме

🎁 За уровни и заботу — настоящие призы: промокоды и баллы на карту «Марии». Всё — на вкладке «Призы».

Жми «Играть» 👇
`.trim();
const GAMES_TEXT = `
🎮 *Игры в Mini App*

🃏 *Мемори* — переворачивай карточки со сладостями и находи пары
🎂 *Flappy Cake* — лети сквозь препятствия и набирай очки

Нажми кнопку и играй прямо сейчас! 🎁
`.trim();
// SALE_TEXT собирается динамически из data/sweet-check-prizes.json — призы
// можно менять без правки кода.
function buildSaleText() {
    const cfg = (0, sweet_check_1.loadSweetCheckPrizes)();
    const lotteryLine = cfg.headline_name
        ? `🧾 *Лотерея «Сладкий чек»* — каждый чек = шанс выиграть ${cfg.headline_name} и другие призы (${cfg.quarter_label.toLowerCase()})`
        : `🧾 *Лотерея «Сладкий чек»* — каждый чек = билет в розыгрыш`;
    return `
🌟 *Акции*

🎂 *Торт месяца* — со скидкой, доставка от 1 000 ₽ бесплатно
🎁 Фирменная коробка с лентой — бесплатно к любому заказу
${lotteryLine}

Подробнее на сайте maria-irk.ru ⏳
`.trim();
}
const HELP_TEXT = `
📞 *Контакты кондитерской «Мария»*

📍 17 кафе в Иркутске + точки в Ангарске
🕐 Уточняйте часы работы на сайте
📱 +7 (3952) 50-40-80
🌐 maria-irk.ru

Пишите — ответим быстро! 💌
`.trim();
// Приветствие для пришедших по QR с чека/POS/упаковки (/start qr_*).
// Задача воронки: перевести покупателя из платных SMS в бесплатный push,
// крючок — реальные 100 баллов клуба за подтверждение номера (BONUS_VERIFY_PHONE).
const QR_WELCOME = `
👋 Вы отсканировали QR «Марии» — добро пожаловать!

Вас ждёт игра *«Котик Комбат»*: растите кота Василия и получайте настоящие призы:
🎁 Welcome-промокод за первую победу — сразу в игре
💎 *100 баллов* на карту за подтверждение номера
🎂 Промокоды и баллы за уровни и заботу о коте

Жмите «Играть» 👇
`.trim();
bot.command("start", async (ctx) => {
    if (ctx.from) {
        await (0, db_2.addSubscriber)(ctx.from.id, ctx.from.username, ctx.from.first_name).catch(() => { });
        // Referral payload: /start ref_MARIA-XXX (code-based, активная схема)
        // Старый numeric-формат (/start ref_12345) — deprecated, игнорируется.
        const payload = ctx.match?.trim();
        // Вход в maria-app: /start applogin_<nonce> — привязать чат к nonce и
        // попросить контакт (криптографическая верификация, как в клубе).
        if (payload && /^applogin_[a-f0-9]{32}$/.test(payload)) {
            const okAttach = await (0, app_auth_1.attachAppLoginChat)(payload.slice(9), ctx.from.id).catch(() => false);
            if (okAttach) {
                // Анти-фишинг: device-flow уязвим к «перешли жертве ссылку → она делится
                // номером → атакующий поллит nonce и получает доступ к её бонусам».
                // Явно предупреждаем — номером делиться только если вход инициировал ты сам.
                await ctx.reply("🔐 Вход в приложение «Мария»\n\n" +
                    "Если ВЫ только что открыли приложение и нажали «Войти через Telegram» — поделитесь номером кнопкой ниже, и приложение узнает вас и ваши бонусы.\n\n" +
                    "⚠️ Если эту ссылку вам кто-то прислал — НЕ делитесь номером: так вы откроете доступ к своим бонусам и покупкам чужому человеку.", { reply_markup: new grammy_1.Keyboard().requestContact("📱 Это я — поделиться номером").resized().oneTime() });
            }
            else {
                await ctx.reply("⏳ Ссылка входа устарела. Вернитесь в приложение и нажмите «Войти через Telegram» ещё раз.");
            }
            return;
        }
        // QR-воронка (чек/POS/упаковка): /start qr_<источник> — фиксируем источник
        // и показываем приветствие с бонусом за номер.
        if (payload && /^qr_[a-z0-9_-]{1,32}$/i.test(payload)) {
            await (0, db_2.setSubscriberSourceOnce)(ctx.from.id, payload.toLowerCase()).catch(() => { });
            await ctx.reply(QR_WELCOME, { parse_mode: "Markdown", reply_markup: webAppButton(QR_WELCOME) });
            return;
        }
        // Реферал кликера: /start ckref_<internalId пригласившего>. Надёжный путь
        // (?start= всегда доходит до бота, в отличие от Mini App ?startapp=).
        if (payload && payload.startsWith("ckref_")) {
            const ownerId = Number(payload.slice(6));
            if (Number.isFinite(ownerId) && ownerId !== ctx.from.id) {
                const r = await (0, clicker_2.registerRef)(ctx.from.id, String(ownerId)).catch(() => null);
                if (r?.ok) {
                    const userName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || "Новый друг";
                    await sendRaw(ownerId, `🎉 *${userName}* зашёл в «Котик Комбат» по твоей ссылке — тебе +30000 монет 🪙 Спасибо, что зовёшь друзей!`, { parse_mode: "Markdown" }).catch(() => { });
                }
                const bonusLine = r?.ok ? "\n\nТебе начислено +2500 монет за вход по приглашению." : "";
                await ctx.reply(`🐱 Добро пожаловать в «Котик Комбат»!${bonusLine}\n\nЖми и качай котика 👇`, { reply_markup: gameButton("🎮 Играть") }).catch(() => { });
                return;
            }
        }
        // «Код дружбы» голубятни: /start ckfr_<internalId владельца ссылки>. Клик =
        // взаимное согласие — связываем пару в pigeon_friends для дружеских дуэлей.
        if (payload && payload.startsWith("ckfr_")) {
            const ownerId = Number(payload.slice(5));
            if (Number.isFinite(ownerId) && ownerId !== ctx.from.id) {
                const { addFriend } = await Promise.resolve().then(() => __importStar(require("./pigeons")));
                const r = await addFriend(ctx.from.id, ownerId).catch(() => null);
                if (r?.ok && !r.already) {
                    const userName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || "Новый друг";
                    await sendRaw(ownerId, `🕊️ *${userName}* принял твой код дружбы! Теперь он появится в Голубятне → Друзья — можно вызывать друг друга на дуэль.`, { parse_mode: "Markdown" }).catch(() => { });
                    await ctx.reply(`🕊️ Вы теперь друзья! Открывай Голубятню → Друзья и вызывай друга на дуэль.`, { reply_markup: gameButton() }).catch(() => { });
                }
                else {
                    await ctx.reply(r?.already ? `🕊️ Вы уже друзья! Открывай Голубятню → Друзья и устраивай дуэль.` : `Не получилось добавить в друзья — попробуй позже.`, { reply_markup: gameButton() }).catch(() => { });
                }
                return;
            }
        }
        // Инвайт в свою стаю: /start cksq_<INVITE_CODE>. Клик по ссылке владельца =
        // мгновенное вступление (владелец сам пригласил — заявка не нужна).
        if (payload && payload.startsWith("cksq_")) {
            const r = await (0, clicker_2.joinSquadByCode)(ctx.from.id, payload.slice(5)).catch(() => null);
            await ctx.reply(r?.ok
                ? `⚔️ Ты в стае «${r.squadName}»! Тапайте вместе, наполняйте копилку — и вся стая получит бонус к монетам.`
                : r?.reason === "full" ? "Стая уже заполнена (20 игроков) — попроси владельца освободить место."
                    : "Код приглашения не сработал — попроси свежую ссылку у владельца стаи.", { reply_markup: gameButton() }).catch(() => { });
            return;
        }
        if (payload && payload.startsWith("ref_")) {
            const rest = payload.slice(4);
            if (/^MARIA-/i.test(rest)) {
                const r = await (0, db_2.recordReferralUse)(ctx.from.id, rest).catch(() => null);
                if (r?.ok && r.ownerChat) {
                    const userName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || "Новый друг";
                    // sendRaw: владелец кода может оказаться VK-юзером
                    await sendRaw(r.ownerChat, `🎉 *${userName}* пришёл по твоему коду \`${rest.toUpperCase()}\` — спасибо, что зовёшь друзей в «Марию»!`, { parse_mode: "Markdown" }).catch(() => { });
                }
            }
        }
    }
    await ctx.reply(WELCOME, { parse_mode: "Markdown", reply_markup: webAppButton(WELCOME) });
});
// Phone share via WebApp.requestContact OR keyboard button
bot.on(":contact", async (ctx) => {
    const c = ctx.message?.contact;
    if (!c || !ctx.from)
        return;
    if (c.user_id !== ctx.from.id) {
        await ctx.reply("Можно поделиться только своим номером 🙂");
        return;
    }
    await (0, db_2.addSubscriber)(ctx.from.id, ctx.from.username, ctx.from.first_name).catch(() => { });
    // Вход в maria-app: если у чата есть свежий pending-nonce — завершаем device-flow.
    const appLoginDone = await (0, app_auth_1.completeAppLogin)(ctx.from.id, c.phone_number).catch(() => false);
    try {
        const result = await (0, club_2.verifyPhone)(ctx.from.id, c.phone_number);
        // Связка платформ по телефону — сообщаем отдельной строкой
        if (result.link?.linked) {
            await ctx.reply("🔗 Аккаунты связаны! Этот номер уже играл с другой платформы (VK/МАКС) — теперь у тебя один общий профиль и прогресс везде.").catch(() => { });
        }
        if (appLoginDone) {
            await ctx.reply(`✅ Готово! Вход подтверждён — вернитесь в приложение «Мария».${result.bonusAwarded <= 0 ? "" : `

💎 Бонус: +${result.bonusAwarded} баллов за подтверждение номера.`}`, { reply_markup: { remove_keyboard: true } });
        }
        else if (result.alreadyVerified) {
            await ctx.reply("✅ Номер уже подтверждён");
        }
        else if (result.bonusAwarded <= 0) {
            await ctx.reply("✅ Номер подтверждён. Бонус за подтверждение уже был получен ранее.", { reply_markup: webAppButton("") });
        }
        else {
            await ctx.reply(`✅ Номер подтверждён!\n\n💎 Тебе начислено +${result.bonusAwarded} баллов на счёт.\nОткрой Mini App, чтобы продолжить 👇`, { reply_markup: webAppButton("") });
        }
    }
    catch (e) {
        console.error("[VERIFY]", e.message);
        await ctx.reply("⚠️ Не удалось сохранить номер, попробуй ещё раз позже");
    }
});
bot.command("games", async (ctx) => ctx.reply(GAMES_TEXT, { parse_mode: "Markdown", reply_markup: gameButton("🎮 Играть") }));
bot.command("sale", async (ctx) => { const t = buildSaleText(); await ctx.reply(t, { parse_mode: "Markdown", reply_markup: webAppButton(t, "🛒 Акции") }); });
bot.command("help", async (ctx) => ctx.reply(HELP_TEXT, { parse_mode: "Markdown", reply_markup: webAppButton(HELP_TEXT, "📋 Открыть меню") }));
// /broadcast <текст> — только для администраторов
bot.command("broadcast", async (ctx) => {
    if (!ctx.from || !ADMIN_IDS.includes(ctx.from.id)) {
        await ctx.reply("⛔ Нет доступа");
        return;
    }
    const text = ctx.match?.trim();
    if (!text) {
        await ctx.reply("Использование: /broadcast Текст сообщения");
        return;
    }
    const subscribers = await (0, db_2.getAllSubscribers)();
    await ctx.reply(`📤 Начинаю рассылку для ${subscribers.length} подписчиков…`);
    let sent = 0, failed = 0;
    for (const { chat_id } of subscribers) {
        const ok = await sendRaw(chat_id, text, { parse_mode: "Markdown" });
        if (ok)
            sent++;
        else
            failed++;
        await new Promise((r) => setTimeout(r, 50));
    }
    await ctx.reply(`✅ Готово: отправлено ${sent}, ошибок ${failed}`);
});
// /birthday ДД.ММ — сохранить день рождения
bot.command("birthday", async (ctx) => {
    const input = ctx.match?.trim();
    if (!input) {
        await ctx.reply("Укажите дату рождения: /birthday ДД.ММ\nНапример: /birthday 15.03");
        return;
    }
    const match = input.match(/^(\d{1,2})\.(\d{1,2})$/);
    if (!match) {
        await ctx.reply("Неверный формат. Используйте: /birthday ДД.ММ");
        return;
    }
    const [, day, month] = match;
    if (!(0, date_utils_1.isValidDayMonth)(Number(day), Number(month))) {
        await ctx.reply("Такой даты не существует. Проверьте день и месяц.");
        return;
    }
    const birthday = `2000-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    if (!ctx.from)
        return;
    await (0, db_2.setUserBirthday)(ctx.from.id, birthday);
    await (0, db_2.addSubscriber)(ctx.from.id, ctx.from.username, ctx.from.first_name).catch(() => { });
    await ctx.reply(`🎂 Запомнила! Поздравлю вас ${day}.${month.padStart(2, "0")} со скидкой в день рождения 🎁`);
});
bot.on("message:text", async (ctx) => {
    if (ctx.from) {
        await (0, db_2.addSubscriber)(ctx.from.id, ctx.from.username, ctx.from.first_name).catch(() => { });
    }
    await ctx.reply(`✨ Откройте наш Mini App — там игры, ИИ-кондитер и все акции!`, { reply_markup: webAppButton("") });
});
// ─── Express ─────────────────────────────────────────────────────────────────
const app = (0, express_1.default)();
// За Caddy / Cloudflare. Один hop — Caddy. Нужно чтобы req.protocol/req.ip
// читались из X-Forwarded-*. Без этого Secure-cookies не выставятся, плюс
// в selfie-cake baseUrl строится из заголовков и легко подменяется.
app.set("trust proxy", 1);
// CSP подобран под Telegram WebApp:
// - frame-ancestors разрешает встраивание в web.telegram.org/k/a/z (web-клиенты)
//   и на 'self' для прямого открытия в браузере (dev).
// - default-src 'self' закрывает большинство XSS-каналов.
// - script-src/style-src 'self' + 'unsafe-inline' (inline-onclick атрибуты у нас
//   ещё используются; убираем их постепенно — см. рефакторинг partners на data-tg-open).
// - img-src + connect-src: разрешаем maria-irk.ru (catalog images + LK API),
//   pollinations.ai (AI-генерация), cloudinary (если будет), telegram.org
//   (TG WebApp SDK).
app.use((0, helmet_1.default)({
    contentSecurityPolicy: {
        useDefaults: false,
        directives: {
            "default-src": ["'self'"],
            // VK-порт: мини-апп открывается в iframe vk.com/m.vk.com (web) — нужны
            // frame-ancestors; vk-bridge SDK грузится с unpkg (script-src)
            "frame-ancestors": ["'self'", "https://web.telegram.org", "https://t.me", "https://*.telegram.org", "https://vk.com", "https://*.vk.com", "https://*.vk-apps.com"],
            "script-src": ["'self'", "'unsafe-inline'", "https://telegram.org", "https://*.telegram.org", "https://unpkg.com"],
            "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
            "img-src": ["'self'", "data:", "blob:", "https:", "http://image.pollinations.ai", "https://image.pollinations.ai"],
            "connect-src": ["'self'", "https://image.pollinations.ai", "https://*.maria-irk.ru", "https://maria-irk.ru", "https://api.vk.com"],
            "media-src": ["'self'", "blob:"],
            "object-src": ["'none'"],
            "base-uri": ["'self'"],
            "form-action": ["'self'"],
        },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
}));
app.use((0, cors_1.default)());
// Фото передаются как base64: selfie до 6 МБ и до трёх референсов заказа.
// Выбираем parser ДО общего 1 МБ parser, иначе route-level limit уже не работает.
const regularJsonParser = express_1.default.json({ limit: "1mb" });
const imageJsonParser = express_1.default.json({ limit: "20mb" });
app.use((req, res, next) => {
    const largeImageBody = req.method === "POST"
        && (req.path === "/api/lead" || req.path === "/api/selfie-cake");
    return (largeImageBody ? imageJsonParser : regularJsonParser)(req, res, next);
});
// Structured request log — reqId + duration + status, /health пропускается
app.use((0, logger_1.requestLogger)());
// rateLimit и requireAdminToken вынесены в `./middleware`
// (см. волну рефакторинга #5). Импортируются ниже.
app.use(express_1.default.static(path_1.default.join(__dirname, "..", "public"), {
    setHeaders(res, filePath) {
        // HTML не кэшируем — иначе Telegram/браузер держат старый index с прежним ?v=
        // (JS/CSS версионируются через ?v= и могут кэшироваться). Свежесть кода после деплоя.
        if (filePath.endsWith(".html"))
            res.setHeader("Cache-Control", "no-cache");
    },
}));
// Явный вход в центр администрирования: некоторые reverse proxy не передают
// завершающий слэш каталогам, поэтому express.static не всегда резолвит index.
app.get("/admin", (_req, res) => {
    res.redirect(302, "/admin/");
});
app.get("/admin/", (_req, res) => {
    res.sendFile(path_1.default.join(__dirname, "..", "public", "admin", "index.html"));
});
app.get("/privacy", (_req, res) => {
    res.sendFile(path_1.default.join(__dirname, "..", "public", "privacy.html"));
});
app.get("/support", (_req, res) => {
    res.sendFile(path_1.default.join(__dirname, "..", "public", "support.html"));
});
// Прокси логотипа
function proxyAsset(url, contentType) {
    return (_req, res) => {
        https_1.default.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (r) => {
            res.setHeader("Content-Type", contentType);
            res.setHeader("Cache-Control", "public, max-age=86400");
            r.pipe(res);
        }).on("error", () => res.status(502).end());
    };
}
app.get("/logo.svg", proxyAsset("https://www.maria-irk.ru/local/templates/maria/img/logo_new.svg", "image/svg+xml"));
app.get("/logo.png", proxyAsset("https://www.maria-irk.ru/local/templates/maria/img/mobile_logo.png", "image/png"));
// Раздача фото-референсов «На заказ» — менеджеры открывают по ссылке из лида
app.get("/lead-photo/:name", (req, res) => {
    const name = String(req.params.name || "").replace(/[^a-z0-9._-]/gi, "");
    if (!name) {
        res.status(400).end();
        return;
    }
    const file = path_1.default.join("/tmp", "lead_photos", name);
    res.sendFile(file, (err) => { if (err)
        res.status(404).end(); });
});
// ─── Image proxy ────────────────────────────────────────────────────────────
// Прокси картинок товаров с resize в WebP + дисковым кэшем + прогревом.
// Sharp превращает 1.4 MB PNG в ~80-150 KB WebP — ускоряет загрузку в 10×.
const fsSync = __importStar(require("fs"));
let sharp = null;
try {
    // Динамический импорт — если sharp не установился (Render free tier), fallback на raw stream
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sharp = require("sharp");
    console.log("[IMG] sharp loaded — resize + webp enabled");
}
catch (e) {
    console.warn("[IMG] sharp not available, falling back to raw streaming:", e.message);
}
const IMG_CACHE_DIR = path_1.default.join("/tmp", "img_cache");
const IMG_CACHE_LIMIT = 96 * 1024 * 1024; // 96 MB в памяти
const IMG_MAX_ITEM = 3 * 1024 * 1024; // 3 MB — крупнее не кешируем
try {
    fsSync.mkdirSync(IMG_CACHE_DIR, { recursive: true });
}
catch { }
const imgCache = new Map();
let imgCacheBytes = 0;
const inflight = new Map();
function safeRasterContentType(value) {
    const type = value.split(";", 1)[0].trim().toLowerCase();
    return /^(image\/(jpeg|png|webp|gif|avif))$/.test(type) ? type : null;
}
function imgKey(u) {
    return require("crypto").createHash("md5").update(u).digest("hex");
}
function imgDiskGet(u) {
    const k = imgKey(u);
    try {
        const buf = fsSync.readFileSync(path_1.default.join(IMG_CACHE_DIR, k));
        const meta = fsSync.readFileSync(path_1.default.join(IMG_CACHE_DIR, k + ".meta"), "utf8");
        const type = safeRasterContentType(meta);
        return type ? { buf, type } : null;
    }
    catch {
        return null;
    }
}
function imgDiskPut(u, v) {
    const k = imgKey(u);
    try {
        fsSync.writeFileSync(path_1.default.join(IMG_CACHE_DIR, k), v.buf);
        fsSync.writeFileSync(path_1.default.join(IMG_CACHE_DIR, k + ".meta"), v.type);
    }
    catch { }
}
function imgMemGet(key) {
    const v = imgCache.get(key);
    if (!v)
        return null;
    imgCache.delete(key);
    imgCache.set(key, v);
    return v;
}
function imgMemPut(key, value) {
    if (value.buf.length > IMG_MAX_ITEM)
        return;
    imgCache.set(key, value);
    imgCacheBytes += value.buf.length;
    while (imgCacheBytes > IMG_CACHE_LIMIT) {
        const first = imgCache.keys().next().value;
        if (!first)
            break;
        const old = imgCache.get(first);
        if (old)
            imgCacheBytes -= old.buf.length;
        imgCache.delete(first);
    }
}
function fetchUpstream(u) {
    if (inflight.has(u))
        return inflight.get(u);
    const p = new Promise((resolve) => {
        const url = new URL(u);
        const opts = {
            hostname: url.hostname,
            path: url.pathname + url.search,
            headers: { "User-Agent": "MariaBot/1.0 ImgProxy" },
            rejectUnauthorized: true,
        };
        const req = https_1.default.request(opts, (r) => {
            if ((r.statusCode ?? 0) >= 400) {
                r.resume();
                resolve(null);
                return;
            }
            const type = safeRasterContentType(String(r.headers["content-type"] ?? ""));
            if (!type) {
                r.resume();
                resolve(null);
                return;
            }
            const chunks = [];
            let total = 0;
            let oversize = false;
            r.on("data", (c) => {
                total += c.length;
                if (total > IMG_MAX_ITEM)
                    oversize = true;
                if (!oversize)
                    chunks.push(c);
            });
            r.on("end", async () => {
                if (oversize || !chunks.length) {
                    resolve(null);
                    return;
                }
                let buf = Buffer.concat(chunks);
                let outType = type;
                // Sharp: ресайз до 600×750 (или меньше если оригинал меньше) и конвертация в WebP
                if (sharp) {
                    try {
                        const resized = await sharp(buf)
                            .resize(600, 750, { fit: "inside", withoutEnlargement: true })
                            .webp({ quality: 78, effort: 4 })
                            .toBuffer();
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        buf = resized;
                        outType = "image/webp";
                    }
                    catch (e) {
                        // fallback — отдаём оригинал
                        console.warn("[IMG] resize failed:", e.message);
                    }
                }
                const value = { buf, type: outType };
                imgMemPut(u, value);
                imgDiskPut(u, value);
                resolve(value);
            });
        });
        req.on("error", () => resolve(null));
        req.setTimeout(20000, () => { req.destroy(); resolve(null); });
        req.end();
    });
    inflight.set(u, p);
    p.finally(() => inflight.delete(u));
    return p;
}
async function imgGet(u) {
    // 1) память
    const mem = imgMemGet(u);
    if (mem)
        return mem;
    // 2) диск
    const disk = imgDiskGet(u);
    if (disk) {
        imgMemPut(u, disk);
        return disk;
    }
    // 3) upstream
    return fetchUpstream(u);
}
app.get("/img", async (req, res) => {
    const u = String(req.query.u ?? "");
    if (!/^https:\/\/(www\.)?maria-irk\.ru\/upload\//.test(u)) {
        res.status(400).end();
        return;
    }
    // Сначала проверим горячий кэш — быстрый return без await
    const memHit = imgMemGet(u);
    if (memHit) {
        res.setHeader("Content-Type", memHit.type);
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.setHeader("X-Cache", "HIT");
        res.end(memHit.buf);
        return;
    }
    const v = await imgGet(u);
    if (!v) {
        res.status(502).end();
        return;
    }
    res.setHeader("Content-Type", v.type);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("X-Cache", "FILL");
    res.end(v.buf);
});
// Прогрев кэша: при старте качаем картинки топ-100 товаров
async function prewarmImageCache() {
    const urls = catalog
        .filter((p) => p.image && /maria-irk\.ru\/upload\//.test(p.image))
        .slice(0, 100)
        .map((p) => p.image);
    console.log(`[IMG] prewarming ${urls.length} images…`);
    let done = 0;
    // Параллельно по 6 — чтобы не ддосить maria-irk.ru
    const batch = 6;
    for (let i = 0; i < urls.length; i += batch) {
        await Promise.all(urls.slice(i, i + batch).map((u) => imgGet(u).then(() => { done++; })));
    }
    console.log(`[IMG] prewarmed ${done}/${urls.length} (mem ${(imgCacheBytes / 1024 / 1024).toFixed(1)} MB)`);
}
// Прогрев при старте — fallback на случай, если первый refreshCatalog упадёт
// (повторный прогрев после успешного refresh идёт изнутри refreshCatalog).
setTimeout(() => { prewarmImageCache().catch((e) => console.error("[IMG] prewarm failed:", e)); }, 5000);
// ─── Groq chat (agent с tool calling) ───────────────────────────────────────
const ai_tools_1 = require("./ai-tools");
// Парсит «try again in 2.639s» или «try again in 160ms» из текста ошибки Groq
function parseRetryAfter(msg, headerVal) {
    if (headerVal) {
        const v = parseFloat(headerVal);
        if (!isNaN(v))
            return Math.min(10000, Math.ceil(v * 1000));
    }
    // ms-формат: «in 160ms»
    const ms = msg.match(/(?:try again in|retry after)\s+([\d.]+)\s*ms/i);
    if (ms)
        return Math.min(10000, Math.max(100, Math.ceil(parseFloat(ms[1]))));
    // s-формат: «in 1.5s»
    const s = msg.match(/(?:try again in|retry after)\s+([\d.]+)\s*s/i);
    if (s)
        return Math.min(10000, Math.ceil(parseFloat(s[1]) * 1000));
    return 0;
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function groqRequest(payload) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(payload);
        const opts = {
            hostname: "api.groq.com",
            path: "/openai/v1/chat/completions",
            method: "POST",
            headers: {
                Authorization: `Bearer ${GROQ_KEY}`,
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
            },
        };
        const req = https_1.default.request(opts, (r) => {
            let d = "";
            r.on("data", (c) => (d += c));
            r.on("end", () => {
                const status = r.statusCode ?? 0;
                try {
                    const parsed = JSON.parse(d);
                    if (status === 429 || (parsed.error?.code === "rate_limit_exceeded")) {
                        const e = new Error(parsed.error?.message ?? `Groq rate limit (${status})`);
                        e.status = status;
                        e.rateLimited = true;
                        e.retryAfterMs = parseRetryAfter(parsed.error?.message ?? "", r.headers["retry-after"]);
                        reject(e);
                        return;
                    }
                    if (status >= 500) {
                        const e = new Error(`Groq ${status}: ${parsed.error?.message ?? "server error"}`);
                        e.status = status;
                        reject(e);
                        return;
                    }
                    resolve(parsed);
                }
                catch (e) {
                    const err = new Error(`Groq parse error (status ${status}): ${e.message}`);
                    err.status = status;
                    reject(err);
                }
            });
        });
        req.on("error", reject);
        req.setTimeout(45000, () => {
            req.destroy();
            const e = new Error("Groq timeout (45s)");
            e.status = 0;
            reject(e);
        });
        req.write(body);
        req.end();
    });
}
// Streaming-вариант для Groq SSE. Возвращает async iterable объектов формата OpenAI delta:
// { delta: { content?, tool_calls? }, finish_reason? }
async function* groqStream(payload) {
    const body = JSON.stringify({ ...payload, stream: true });
    const req = await new Promise((resolve, reject) => {
        const r = https_1.default.request({
            hostname: "api.groq.com",
            path: "/openai/v1/chat/completions",
            method: "POST",
            headers: {
                Authorization: `Bearer ${GROQ_KEY}`,
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
                Accept: "text/event-stream",
            },
        }, resolve);
        r.on("error", reject);
        r.setTimeout(60000, () => {
            r.destroy();
            reject(Object.assign(new Error("Groq stream timeout"), { status: 0 }));
        });
        r.write(body);
        r.end();
    });
    // Если статус не 200 — собираем тело и кидаем как ошибку
    if ((req.statusCode ?? 0) !== 200) {
        let errBody = "";
        for await (const chunk of req)
            errBody += chunk.toString();
        let parsed = {};
        try {
            parsed = JSON.parse(errBody);
        }
        catch { }
        const e = new Error(`Groq stream ${req.statusCode}: ${parsed.error?.message ?? errBody.slice(0, 200)}`);
        e.status = req.statusCode;
        if (req.statusCode === 429 || parsed.error?.code === "rate_limit_exceeded") {
            e.rateLimited = true;
            e.retryAfterMs = parseRetryAfter(parsed.error?.message ?? "", req.headers["retry-after"]);
        }
        throw e;
    }
    let buf = "";
    for await (const chunk of req) {
        buf += chunk.toString();
        let nl;
        while ((nl = buf.indexOf("\n\n")) !== -1) {
            const evt = buf.slice(0, nl);
            buf = buf.slice(nl + 2);
            // SSE event: одна или несколько строк "data: ..."
            const lines = evt.split("\n").filter((l) => l.startsWith("data:"));
            for (const line of lines) {
                const data = line.slice(5).trim();
                if (data === "[DONE]" || !data)
                    continue;
                try {
                    const parsed = JSON.parse(data);
                    const choice = parsed?.choices?.[0];
                    if (!choice)
                        continue;
                    yield { delta: choice.delta ?? {}, finish_reason: choice.finish_reason };
                }
                catch { /* skipped malformed chunk */ }
            }
        }
    }
}
function publicChatFailure(error) {
    if (error.rateLimited) {
        return { status: 429, message: "ИИ временно занят. Подожди 10–20 секунд и попробуй ещё раз." };
    }
    if (error.status === 0 || /timeout/i.test(error.message)) {
        return { status: 504, message: "ИИ не ответил вовремя. Попробуй ещё раз через минуту." };
    }
    return { status: 502, message: "ИИ временно недоступен. Попробуй через минуту или позвони +7 (3952) 50-40-80." };
}
/** История с браузера может содержать только обычные user/assistant сообщения.
 * system/tool сообщения формирует сам сервер; ограничение длины защищает Groq
 * quota и не позволяет клиенту подменить служебную историю. */
function sanitizeClientChatMessages(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > 50)
        return null;
    const out = [];
    for (const item of value) {
        if (!item || typeof item !== "object")
            return null;
        const role = item.role;
        const content = item.content;
        if ((role !== "user" && role !== "assistant") || typeof content !== "string")
            return null;
        const clean = content.trim();
        if (!clean || clean.length > 4000)
            return null;
        out.push({ role, content: clean });
    }
    return out;
}
// Системный prompt для основного режима (поиск/заказ торта)
function cakeSystemPrompt(catalogLen) {
    return `Ты — Маша, тёплый AI-помощник кондитерской «Мария» в Иркутске. Каталог: ${catalogLen} товаров.

КОНТАКТЫ: maria-irk.ru, +7 (3952) 50-40-80, 17 кафе. Клуб «Мария для своих»: кэшбэк 5–10% по уровням (Друзья/Лучшие друзья/Семья), оплата заказа баллами до 30%, ДР-скидка −5%/−10% детям. Сладкий чек — квартальная лотерея с техникой; точные текущие призы НЕ называй, скажи «список призов в разделе Клуб». Никогда не выдумывай числа/цены — только из tool результатов.

ИНСТРУМЕНТЫ:
- search_products(query, contains?, exclude?) — поиск. Ищет по name, filling, cake_type, preview, dietary. Используй contains для точного матча.
- get_product(id) — детали
- get_today_special() — торт месяца со скидкой
- get_cake_types() — список типов
- list_categories() — категории
- check_my_loyalty() — баллы/билеты (нужен verified телефон)
- get_my_orders() — заказы клиента
- list_partners(category?) — партнёры со скидками
- add_to_cart(product_id) — добавить в корзину

ПРАВИЛА:
1. ВСЕГДА используй search_products перед ответом про товары. Не отвечай по памяти.
2. Цены, имена, веса — ТОЛЬКО из tool результатов.
3. Если нет — честно «нет», не подменяй.
4. ПРОАКТИВНОСТЬ: если юзер описывает событие/ситуацию (ДР, фуршет, корпоратив, гостям, "что-нибудь шоколадное") — СРАЗУ делай search_products и предложи 2-4 варианта, не задавай уточняющих вопросов.
5. ДИЕТА: товары имеют теги dietary (sugar-free, gluten-free, vegan, lactose-free, low-cal, nut-free). На вопросы типа «без сахара / веганский / без глютена» — search с contains=["веган"], ["без сахара"] и т.п. Если нашёл — предложи; если нет — честно «такого пока нет, могу подсказать ближайшее».
6. КОРПОРАТИВЫ: если юзер пишет про B2B/большой заказ/в офис/30+ человек — направь его на форму «Корпоративные заказы» (кнопка на главной экране).
7. СКОЛЬКО БРАТЬ: если спрашивают «на N человек» / «сколько кг» — упомяни что в карточке торта есть калькулятор «🧮 Сколько брать?». Сам тоже можешь подсказать: ~130 г/взрослого, ~80 г/ребёнка.
8. Цена = price (итог со скидкой, поле из tool). Если у товара discountPercent>0, упомяни в формате: «<актуальная цена> ₽ (–<discountPercent>%, было <oldPrice> ₽)» — используй РЕАЛЬНЫЕ числа из tool результата, не выдумывай.
9. Если первый search не нашёл — попробуй другие слова/contains. До 3 попыток.

СТИЛЬ: дружелюбный, на «ты», как помощник в любимом кафе. 1-2 эмодзи, 2-5 предложений, русский. Не корпоративно («мы нашли») — обращайся лично («посмотри, нашла два»). UI рендерит карточки товаров с кнопкой «+ В корзину» — НЕ вставляй ссылки/картинки текстом, описывай выбор словами. Можно **жирным** выделять важное (название/цену).`;
}
// Системный prompt для режима «Сладкий исповедник» — эмпатичный mood-pairing
function confessorSystemPrompt(catalogLen) {
    return `Ты — Маша, AI-помощник кондитерской «Мария» в Иркутске. Сейчас особый режим: «Сладкий исповедник».

Юзер пришёл не за заказом — а поговорить про настроение, день, чувства. Слушай эмпатично, без давления продаж. Каталог: ${catalogLen} товаров.

ПРАВИЛА:
1. СНАЧАЛА послушай. Если юзер только поздоровался или коротко — задай 1 открытый вопрос про чувства/день. Не торопись с тортом.
2. Только когда поймёшь настроение — МЯГКО предложи десерт под него через search_products. Не как продавец, а как друг.
3. МАППИНГ настроение → вкус (примеры):
   - тяжёлый день, устал → крепкий, основательный (Медовик, Наполеон, шоколадный)
   - грустно, одиноко → мягкое, ванильное, нежное (Птичье молоко, чизкейк, эклер)
   - радостно, празднично → яркое (бенто-сердечком, фруктовое, цветное)
   - тревожно, нервно → лёгкое, освежающее (ягодное, цитрусовое, низкокалорийное)
   - романтично → парное, на двоих (бенто, набор пирожных)
4. ВСЕГДА search_products чтобы найти реальный товар. Не выдумывай.
5. ОСТОРОЖНО: если пишут про серьёзные проблемы (потеря, депрессия, кризис, мысли о суициде) — отметь это с теплотой, скажи «торт не лечит, но иногда помогает побаловать себя». При очень серьёзных вещах деликатно упомяни телефон доверия 8-800-2000-122 (бесплатный, психолог). Не игнорируй.
6. Не задавай вопросов про каталог/диету в стиле sales («какой бюджет?», «что любите?»). Это эмоциональный разговор.

СТИЛЬ: тёплый, на «ты», как близкая подруга которая работает в кафе. 2-4 коротких предложения, 1 эмодзи. Не корпоративно, не натужно весело. Можно молчаливо посочувствовать.`;
}
function systemPromptFor(mode, catalogLen) {
    return mode === "confessor" ? confessorSystemPrompt(catalogLen) : cakeSystemPrompt(catalogLen);
}
async function* chatAgentStream(userMessages, ctx, mode = "cake") {
    const system = {
        role: "system",
        content: systemPromptFor(mode, ctx.catalog.length),
    };
    // Жёсткое ограничение истории — Groq free-tier 6000 TPM, длинная история убивает запрос.
    // 16 последних сообщений ~= 2000 токенов, плюс system+tools = ~2800 → влезает с запасом.
    const trimmedUser = userMessages.length > 16 ? userMessages.slice(-16) : userMessages;
    const messages = [system, ...trimmedUser];
    const MAX_ITERATIONS = 6;
    let toolsBroken = false;
    let currentModel = "openai/gpt-oss-120b";
    let finalText = "";
    let retried429 = false;
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        const sendMessages = trimHistory(messages, 20);
        const acc = { content: "", tool_calls: [] };
        let finishReason;
        const callStream = async function* (model) {
            yield* groqStream({
                model,
                max_tokens: 768,
                temperature: 0.3,
                top_p: 0.9,
                messages: sendMessages,
                ...(toolsBroken ? {} : { tools: ai_tools_1.TOOL_DEFS, tool_choice: "auto" }),
            });
        };
        try {
            for await (const chunk of callStream(currentModel)) {
                if (chunk.delta.content) {
                    acc.content += chunk.delta.content;
                    yield { type: "delta", text: chunk.delta.content };
                }
                if (chunk.delta.tool_calls) {
                    for (const tc of chunk.delta.tool_calls) {
                        if (!acc.tool_calls[tc.index]) {
                            acc.tool_calls[tc.index] = { id: tc.id || "", type: "function", function: { name: "", arguments: "" } };
                        }
                        const slot = acc.tool_calls[tc.index];
                        if (tc.id)
                            slot.id = tc.id;
                        if (tc.function?.name)
                            slot.function.name += tc.function.name;
                        if (tc.function?.arguments)
                            slot.function.arguments += tc.function.arguments;
                    }
                }
                if (chunk.finish_reason)
                    finishReason = chunk.finish_reason;
            }
        }
        catch (err) {
            const e = err;
            if (e.rateLimited) {
                // Стратегия:
                // 1. Если на 120b — fallback на 20b сразу (другой пул limit-ов)
                // 2. Если уже на 20b — ждём retry-after из ответа Groq и повторяем (один раз)
                if (currentModel === "openai/gpt-oss-120b") {
                    console.warn("[chatAgentStream] 120b rate-limited, fallback to 20b");
                    currentModel = "openai/gpt-oss-20b";
                    iter--;
                    continue;
                }
                if (!retried429) {
                    const wait = e.retryAfterMs && e.retryAfterMs > 0 ? e.retryAfterMs : 3000;
                    console.warn(`[chatAgentStream] 20b rate-limited, waiting ${wait}ms and retrying`);
                    await sleep(wait);
                    retried429 = true;
                    iter--;
                    continue;
                }
            }
            yield { type: "error", message: publicChatFailure(e).message };
            return;
        }
        // Сохраняем accumulated assistant message в историю
        const validToolCalls = acc.tool_calls.filter((tc) => tc && tc.id && tc.function.name);
        const asstMsg = { role: "assistant", content: acc.content || null };
        if (validToolCalls.length)
            asstMsg.tool_calls = validToolCalls;
        messages.push(asstMsg);
        finalText = acc.content;
        // Если finish_reason !== tool_calls → это финальный ответ, выходим
        if (finishReason !== "tool_calls" || validToolCalls.length === 0) {
            yield {
                type: "final",
                text: finalText.trim(),
                products: [...ctx.surfacedProducts.values()],
                cart_actions: ctx.cartActions,
            };
            return;
        }
        // Иначе исполняем tools параллельно
        const results = await Promise.all(validToolCalls.map(async (tc) => {
            let args = {};
            try {
                const parsed = JSON.parse(tc.function.arguments || "{}");
                if (parsed && typeof parsed === "object")
                    args = parsed;
            }
            catch { }
            const out = await (0, ai_tools_1.runTool)(tc.function.name, args, ctx);
            return { tool_call_id: tc.id, role: "tool", name: tc.function.name, content: out };
        }));
        for (const tc of validToolCalls)
            yield { type: "tool", name: tc.function.name };
        messages.push(...results);
    }
    // MAX_ITERATIONS исчерпаны — финальный non-stream запрос без tools
    try {
        const final = await groqRequest({
            model: "openai/gpt-oss-20b",
            max_tokens: 768,
            temperature: 0.3,
            messages,
        });
        const finalChoice = final.choices?.[0];
        yield {
            type: "final",
            text: (finalChoice?.message?.content ?? "Извини, не получилось разобраться. Попробуй переформулировать.").trim(),
            products: [...ctx.surfacedProducts.values()],
            cart_actions: ctx.cartActions,
        };
    }
    catch (e) {
        yield { type: "error", message: publicChatFailure(e).message };
    }
}
// Обрезаем историю если она слишком длинная — сохраняем system + последние N пар user/assistant
// Tool messages и tool_calls идут парами, поэтому обрезаем по паре assistant→[tool…] чтобы не сломать логику
function trimHistory(messages, maxNonSystem = 16) {
    if (messages.length <= maxNonSystem + 1)
        return messages;
    // Сохраняем первое system-сообщение и последние maxNonSystem
    const sys = messages[0]?.role === "system" ? [messages[0]] : [];
    const tail = messages.slice(-maxNonSystem);
    // Если первый элемент tail — tool, то он сирота (не имеет соответствующего assistant с tool_calls)
    // → пропускаем, пока не дойдём до user или assistant без tool_calls
    let firstSafe = 0;
    while (firstSafe < tail.length && tail[firstSafe].role === "tool")
        firstSafe++;
    return [...sys, ...tail.slice(firstSafe)];
}
async function chatAgent(userMessages, ctx, mode = "cake") {
    const system = {
        role: "system",
        content: systemPromptFor(mode, ctx.catalog.length),
    };
    // Жёсткое урезание истории — Groq free-tier 6000 TPM.
    // 16 последних сообщений ~= 2000 токенов, плюс system+tools = ~2800 → влезает с запасом.
    const trimmedUser = userMessages.length > 16 ? userMessages.slice(-16) : userMessages;
    const messages = [system, ...trimmedUser];
    const MAX_ITERATIONS = 6;
    let toolsBroken = false;
    let currentModel = "openai/gpt-oss-120b";
    let retried429 = false;
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        const sendMessages = trimHistory(messages, 20);
        let response;
        try {
            response = await groqRequest({
                model: currentModel,
                max_tokens: 768,
                temperature: 0.3,
                top_p: 0.9,
                messages: sendMessages,
                ...(toolsBroken ? {} : { tools: ai_tools_1.TOOL_DEFS, tool_choice: "auto" }),
            });
        }
        catch (err) {
            const e = err;
            if (e.rateLimited) {
                if (currentModel === "openai/gpt-oss-120b") {
                    console.warn("[chatAgent] 120b rate-limited, fallback to 20b");
                    currentModel = "openai/gpt-oss-20b";
                    iter--;
                    continue;
                }
                if (!retried429) {
                    const wait = e.retryAfterMs && e.retryAfterMs > 0 ? e.retryAfterMs : 3000;
                    console.warn(`[chatAgent] 20b rate-limited, waiting ${wait}ms and retrying`);
                    await sleep(wait);
                    retried429 = true;
                    iter--;
                    continue;
                }
            }
            throw err;
        }
        const choice = response.choices?.[0];
        if (!choice) {
            const err = response.error;
            const errMsg = err?.message ?? "no_choice";
            // Groq quirk: при некоторых входах модель не может сгенерить tool call.
            // Делаем повтор без tools.
            if (!toolsBroken && /function|tool/i.test(errMsg)) {
                console.error("[chatAgent] tools broken, retry without:", errMsg);
                toolsBroken = true;
                continue;
            }
            throw new Error(errMsg);
        }
        const msg = choice.message;
        messages.push(msg);
        // Если LLM ответил без tool_calls — финиш
        if (!msg.tool_calls || msg.tool_calls.length === 0) {
            return {
                text: (msg.content ?? "").trim(),
                products: [...ctx.surfacedProducts.values()],
                cart_actions: ctx.cartActions,
            };
        }
        // Иначе — запускаем все tool_calls параллельно
        const results = await Promise.all(msg.tool_calls.map(async (tc) => {
            let args = {};
            try {
                const parsed = JSON.parse(tc.function.arguments || "{}");
                if (parsed && typeof parsed === "object")
                    args = parsed;
            }
            catch { }
            const out = await (0, ai_tools_1.runTool)(tc.function.name, args, ctx);
            return { tool_call_id: tc.id, role: "tool", name: tc.function.name, content: out };
        }));
        messages.push(...results);
    }
    // Если за MAX_ITERATIONS не успели — финальный запрос без tools
    const final = await groqRequest({
        model: "openai/gpt-oss-20b", // быстрый fallback — гарантированно ответит
        max_tokens: 768,
        temperature: 0.3,
        messages,
    }).catch(() => ({ choices: [] }));
    const finalChoice = final.choices?.[0];
    return {
        text: (finalChoice?.message?.content ?? "Извини, не получилось разобраться. Попробуй переформулировать.").trim(),
        products: [...ctx.surfacedProducts.values()],
        cart_actions: ctx.cartActions,
    };
}
app.post("/api/chat-stream", auth_1.optionalUser, (0, middleware_1.rateLimit)(40), async (req, res) => {
    const { mode } = req.body;
    const messages = sanitizeClientChatMessages(req.body.messages);
    if (!messages) {
        res.status(400).json({ error: "messages array is required" });
        return;
    }
    const chatMode = mode === "confessor" ? "confessor" : "cake";
    const tgUser = (0, auth_1.getTgUser)(req);
    const ctx = {
        chatId: tgUser?.id ?? 0,
        catalog,
        surfacedProducts: new Map(),
        cartActions: [],
    };
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    let closed = false;
    req.on("aborted", () => { closed = true; });
    res.on("close", () => { if (!res.writableEnded)
        closed = true; });
    const send = (event) => {
        if (!closed && !res.writableEnded)
            res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try {
        for await (const event of chatAgentStream(messages, ctx, chatMode)) {
            if (closed)
                break;
            send(event);
        }
    }
    catch (err) {
        const e = err;
        console.error(`[CHAT-STREAM] err: status=${e.status} msg=${e.message}`);
        send({ type: "error", message: publicChatFailure(e).message });
    }
    finally {
        if (!closed && !res.writableEnded) {
            res.write("data: [DONE]\n\n");
            res.end();
        }
    }
});
app.post("/api/chat", auth_1.optionalUser, (0, middleware_1.rateLimit)(40), async (req, res) => {
    const { mode } = req.body;
    const messages = sanitizeClientChatMessages(req.body.messages);
    if (!messages) {
        res.status(400).json({ error: "messages array is required" });
        return;
    }
    const chatMode = mode === "confessor" ? "confessor" : "cake";
    // chatId — Telegram WebApp init data; если нет — ставим 0 (анон),
    // тогда tools auth-зависимые вернут unauthorised.
    const tgUser = (0, auth_1.getTgUser)(req);
    const chatId = tgUser?.id ?? 0;
    try {
        const ctx = {
            chatId,
            catalog,
            surfacedProducts: new Map(),
            cartActions: [],
        };
        const out = await chatAgent(messages, ctx, chatMode);
        res.json({ text: out.text, products: out.products, cart_actions: out.cart_actions });
    }
    catch (err) {
        const e = err;
        console.error(`[CHAT] err: status=${e.status} msg=${e.message}`);
        const failure = publicChatFailure(e);
        res.status(failure.status).json({ error: failure.message });
    }
});
// Leads (lead, lead-corporate, transcribe) вынесены в src/routes/leads.ts
app.use(leads_1.default);
// ─── Admin-only утилиты (через requireAdminToken middleware) ────────────────
// Утечка бизнес-инфы — переведено под admin-token (раньше любой видел число подписчиков)
app.get("/api/subscribers/count", middleware_1.requireAdminToken, async (_req, res) => {
    const subs = await (0, db_2.getAllSubscribers)();
    res.json({ count: subs.length });
});
// Рассылка через API (для будущей админ-панели)
app.post("/api/broadcast", middleware_1.requireAdminToken, (0, middleware_1.requireAdminRole)("operator"), async (req, res) => {
    const { text } = req.body;
    if (!text?.trim()) {
        res.status(400).json({ error: "text required" });
        return;
    }
    const subscribers = await (0, db_2.getAllSubscribers)();
    res.json({ status: "started", total: subscribers.length });
    let sent = 0, failed = 0;
    for (const { chat_id } of subscribers) {
        const ok = await sendRaw(chat_id, text, { parse_mode: "Markdown" });
        if (ok)
            sent++;
        else
            failed++;
        await new Promise((r) => setTimeout(r, 50));
    }
    logger_1.log.info({ sent, failed, total: subscribers.length }, "[BROADCAST] done");
});
// Ручное обновление каталога (admin-only — раньше любой мог дёргать рефреш
// → нагрузка на CATALOG_API maria-irk.ru через unauth-юзеров).
app.post("/api/refresh-catalog", middleware_1.requireAdminToken, (0, middleware_1.requireAdminRole)("operator"), async (_req, res) => {
    res.json({ status: "started" });
    await refreshCatalog();
});
// Статус каталога
app.get("/api/catalog-status", (0, middleware_1.rateLimit)(30), (_req, res) => {
    res.json({
        count: catalog.length,
        updated: (0, scraper_1.catalogAge)(),
        sample: catalog.slice(0, 3),
    });
});
// User-related (me, birthday, unverify-phone, history) → src/routes/user.ts
app.use(user_1.default);
// Club routes (daily, convert, redeem, rewards, my-rewards, conversion-tiers)
// вынесены в src/routes/club.ts
app.use(club_1.default);
// Game results → src/routes/game.ts
app.use(game_1.default);
// Виртуальный питомец → src/routes/pet.ts
app.use(pet_1.default);
// Вход maria-app через Telegram (device-flow) → src/routes/app-auth.ts
app.use("/api/app", app_auth_1.default);
// Кликер «Котик Комбат» → src/routes/clicker.ts
app.use(clicker_1.default);
// Админка игры: метрики/игроки/рассылка (UI: /admin/game.html, гейт ADMIN_TOKEN)
app.use((0, admin_game_1.default)(_pushService));
app.use((0, admin_system_1.default)());
// GET /api/holidays/upcoming вынесен в src/routes/holidays.ts
app.use(holidays_1.default);
// Админ: руками триггернуть pushHolidayPreorder (для тестов).
// Остаётся в index.ts т.к. push-функция здесь же; перенесём с push-волной.
app.post("/api/admin/holidays/push", middleware_1.requireAdminToken, (0, middleware_1.requireAdminRole)("operator"), async (_req, res) => {
    pushHolidayPreorder().catch((e) => logger_1.log.error({ err: e }, "[HOLIDAY MANUAL]"));
    res.json({ ok: true, status: "scheduled" });
});
// Админ: ручной прогон пушей-возвратов «Котик Комбат» (для теста; обычно крон 17:00 Иркутск).
// Дедуп по дню действует — повторный вызов в тот же день не задвоит.
app.post("/api/admin/clicker/push", middleware_1.requireAdminToken, (0, middleware_1.requireAdminRole)("operator"), async (_req, res) => {
    try {
        const r = await (0, clicker_push_1.runClickerRetentionPush)(_pushService);
        res.json({ ok: true, ...r });
    }
    catch (e) {
        logger_1.log.error({ err: e }, "[CLICKER PUSH MANUAL]");
        res.status(500).json({ error: "internal" });
    }
});
// Админ: ручные триггеры напоминаний о питомце (для теста — см. pet-push.ts).
// ⚠️ Флаг PET_REMINDERS_ENABLED здесь НЕ проверяется — эти эндпоинты шлют
// пуши по-настоящему реальным кандидатам. Не дёргать вне теста.
app.post("/api/admin/pet/remind-hungry", middleware_1.requireAdminToken, (0, middleware_1.requireAdminRole)("operator"), async (_req, res) => {
    try {
        const r = await (0, pet_push_1.runPetHungryPush)(_pushService);
        res.json({ ok: true, ...r });
    }
    catch (e) {
        logger_1.log.error({ err: e }, "[PET HUNGRY PUSH MANUAL]");
        res.status(500).json({ error: "internal" });
    }
});
app.post("/api/admin/pet/remind-energy", middleware_1.requireAdminToken, (0, middleware_1.requireAdminRole)("operator"), async (_req, res) => {
    try {
        const r = await (0, pet_push_1.runPetEnergyPush)(_pushService);
        res.json({ ok: true, ...r });
    }
    catch (e) {
        logger_1.log.error({ err: e }, "[PET ENERGY PUSH MANUAL]");
        res.status(500).json({ error: "internal" });
    }
});
// Админ: ручные триггеры вороночных кронов (T2/T3/T4) — для теста.
// В dry-run (флаги OFF) считают и логируют, но не шлют/не начисляют.
app.post("/api/admin/funnel/expiry", middleware_1.requireAdminToken, (0, middleware_1.requireAdminRole)("operator"), async (_req, res) => {
    try {
        await pushExpiringPoints();
        res.json({ ok: true, enabled: FUNNEL_RETENTION_ENABLED });
    }
    catch (e) {
        logger_1.log.error({ err: e }, "[FUNNEL EXPIRY MANUAL]");
        res.status(500).json({ error: "internal" });
    }
});
app.post("/api/admin/funnel/reactivate", middleware_1.requireAdminToken, (0, middleware_1.requireAdminRole)("operator"), async (_req, res) => {
    try {
        await pushReactivation();
        res.json({ ok: true, enabled: FUNNEL_RETENTION_ENABLED });
    }
    catch (e) {
        logger_1.log.error({ err: e }, "[FUNNEL REACTIVATE MANUAL]");
        res.status(500).json({ error: "internal" });
    }
});
app.post("/api/admin/funnel/ref-orders", middleware_1.requireAdminToken, (0, middleware_1.requireAdminRole)("operator"), async (_req, res) => {
    try {
        await checkReferralFirstOrders();
        res.json({ ok: true, enabled: FUNNEL_REF_BONUS_ENABLED });
    }
    catch (e) {
        logger_1.log.error({ err: e }, "[FUNNEL REF-ORDER MANUAL]");
        res.status(500).json({ error: "internal" });
    }
});
// Админ: ручное закрытие недельного сезона + пуш победителям (для теста).
app.post("/api/admin/clicker/weekly-close", middleware_1.requireAdminToken, (0, middleware_1.requireAdminRole)("operator"), async (_req, res) => {
    try {
        const close = await (0, clicker_2.closeWeeklySeason)();
        const push = await (0, clicker_2.pushWeeklyWinners)(_pushService);
        res.json({ ok: true, ...close, pushed: push.sent });
    }
    catch (e) {
        logger_1.log.error({ err: e }, "[WEEKLY CLOSE MANUAL]");
        res.status(500).json({ error: "internal" });
    }
});
// Админ: перезагрузить data/dietary-overrides.json и переразметить in-memory каталог
// без рестарта (для оперативной коррекции false-positive)
app.post("/api/admin/dietary/reload", middleware_1.requireAdminToken, (0, middleware_1.requireAdminRole)("operator"), (_req, res) => {
    (0, scraper_1.reloadDietaryOverrides)();
    let tagged = 0;
    for (const p of catalog) {
        const tags = (0, scraper_1.detectDietary)(p);
        if (tags.length > 0) {
            p.dietary = tags;
            tagged++;
        }
        else {
            delete p.dietary;
        }
    }
    res.json({ ok: true, total: catalog.length, tagged });
});
// Catalog routes вынесены в src/routes/catalog.ts. Передаём getter — чтобы
// router всегда работал с актуальным in-memory массивом (refreshCatalog его
// мутирует через `catalog = ...` ниже в этом файле).
app.use((0, catalog_1.createCatalogRouter)({ getCatalog: () => catalog, catalogAge: scraper_1.catalogAge }));
// ─── Reviews API ─────────────────────────────────────────────────────────────
// GET список отзывов + статистика для товара
// Reviews routes (CRUD + admin hide) вынесены в src/routes/reviews.ts.
// Передаём getter каталога — для валидации product_id при POST review.
app.use((0, reviews_1.createReviewsRouter)(() => catalog));
// Wishlist (share POST + share/:code GET + sync) вынесен в src/routes/wishlist.ts
// (см. app.use(createWishlistRouter) ниже).
// Promo routes (validate + use) вынесены в src/routes/promo.ts
app.use(promo_1.default);
// Cake-concept (AI-конструктор) вынесен в src/routes/cake-concept.ts
app.use(cake_concept_1.default);
// Selfie-cake (AI-портрет на торте) вынесен в src/routes/selfie-cake.ts
app.use(selfie_cake_1.default);
// Wishlist (share + sync) вынесен в src/routes/wishlist.ts
app.use((0, wishlist_1.createWishlistRouter)(() => catalog));
// Hot-reload data/promo-codes.json без рестарта
app.post("/api/admin/promo/reload", middleware_1.requireAdminToken, (0, middleware_1.requireAdminRole)("operator"), (_req, res) => {
    const total = (0, promo_2.reloadPromoCodes)();
    res.json({ ok: true, total });
});
// Order rating routes (GET + POST) вынесены в src/routes/order-rating.ts
app.use(order_rating_1.default);
app.use(order_location_1.default);
// /api/wishlist/share/:code вынесен в src/routes/wishlist.ts
// /api/reviews/stats-batch также вынесен в src/routes/reviews.ts
// Partners (GET list + admin sync) вынесен в src/routes/partners.ts
app.use(partners_1.default);
// Secret-of-day → src/routes/secret-of-day.ts
app.use((0, secret_of_day_1.createSecretOfDayRouter)(() => catalog));
// Notification prefs → src/routes/notify-prefs.ts
app.use(notify_prefs_1.default);
// Referrals (me + use) → src/routes/referral.ts
app.use((0, referral_1.createReferralRouter)(_pushService, db_1.pool));
// Wheel + streak → src/routes/wheel-streak.ts
app.use((0, wheel_streak_1.createWheelStreakRouter)(_pushService));
// Голубятня (коллекция/обмены/друзья) → src/routes/pigeons.ts
app.use((0, pigeons_1.createPigeonsRouter)(_pushService));
// VK Callback API (входящие события сообщества) → src/vk/callback.ts
// Без VK_CALLBACK_SECRET/VK_CONFIRMATION_CODE отвечает 404 (TG-only режим)
app.use((0, callback_1.createVkCallbackRouter)(vkSender));
// VK verify-phone (крипто-проверка sign от VKWebAppGetPhoneNumber) → src/routes/vk.ts
app.use((0, vk_1.createVkRouter)());
// /api/secret-of-day вынесен в src/routes/secret-of-day.ts (см. createSecretOfDayRouter выше)
// /api/rewards/mine также вынесен в src/routes/club.ts
// Cron-функция: каждое утро 09:00 Иркутск выбирает «секрет дня» (рекомендация)
// Никакой выдуманной скидки — discountPct = 0. Если у выбранного товара в 1С
// есть реальная скидка, фронт её покажет из каталога. Иначе — просто рекомендация.
async function rotateSecretOfDay() {
    if (catalog.length === 0)
        return;
    const eligibles = catalog.filter((p) => ["Торты", "Пирожные и десерты", "Пироги"].includes(p.category) && p.id && (p.priceNumber ?? 0) >= 300);
    const pool = eligibles.length > 0 ? eligibles : catalog;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick?.id) {
        await (0, db_2.setSecretOfDay)(Number(pick.id), 0).catch((e) => console.error("[SECRET-OF-DAY]", e.message));
        console.log(`[SECRET-OF-DAY] picked id=${pick.id} "${pick.name}"`);
    }
}
// /api/notify-prefs (GET + POST) вынесены в src/routes/notify-prefs.ts
// Cart sync (для cart-abandonment push) → src/routes/cart.ts
app.use(cart_1.default);
// /api/wishlist/sync (back-in-stock subscribe) вынесен в src/routes/wishlist.ts
// LK (личный кабинет с maria-irk.ru через Bitrix) вынесен в src/routes/lk.ts
app.use(lk_1.default);
const ORDER_LOG = [];
function logOrderAttempt(a) {
    ORDER_LOG.push(a);
    if (ORDER_LOG.length > 20)
        ORDER_LOG.shift();
}
/** Маскирует телефон для логов (ПДн): оставляет только последние 4 цифры. */
function maskPhone(p) {
    return p ? String(p).replace(/\d(?=\d{4})/g, "*") : "-";
}
app.get("/api/_debug-orders", (req, res) => {
    if (!process.env.ORDER_TOKEN || !(0, middleware_1.safeEq)(req.header("x-order-debug-token"), process.env.ORDER_TOKEN)) {
        res.status(403).json({ error: "forbidden" });
        return;
    }
    // Маскируем телефон полностью кроме последних 4 цифр — debug не должен светить PII целиком
    const masked = ORDER_LOG.map((a) => {
        const phone = a.body.phone ? a.body.phone.replace(/\d(?=\d{4})/g, "*") : a.body.phone;
        return { ...a, body: { ...a.body, phone } };
    });
    res.json({ count: ORDER_LOG.length, attempts: masked });
});
// Перевод ошибок order-create.php в человекочитаемый русский
function translateOrderError(err) {
    const map = {
        bad_json: "Неверный формат данных. Попробуйте ещё раз.",
        forbidden: "Сервер отказал в обработке (токен).",
        method_not_allowed: "Метод не поддерживается.",
        module_unavailable: "Модуль магазина временно недоступен.",
        missing_fields: "Не заполнены обязательные поля.",
        bad_phone: "Неверный номер телефона. Укажите 10-значный российский номер.",
        no_valid_items: "Товары не найдены или сняты с продажи. Обновите корзину.",
        order_insert_failed: "Не удалось сохранить заказ в базе. Попробуйте через минуту.",
        basket_insert_failed: "Не удалось сохранить позиции корзины. Попробуйте через минуту.",
        order_api_not_configured: "Сервис заказов не настроен. Свяжитесь с поддержкой.",
        timeout: "Сайт не ответил вовремя. Попробуйте через минуту.",
    };
    return map[err ?? ""] ?? `Не удалось создать заказ. Позвоните +7 (3952) 50-40-80 для оформления.`;
}
app.post("/api/order", auth_1.optionalUser, (0, middleware_1.rateLimit)(15), async (req, res) => {
    const tg = (0, auth_1.tryGetUser)(req); // optional, без блокировки (AppUser: platform + platformId)
    const body = req.body;
    const rawRequestId = String(body.request_id ?? req.header("idempotency-key") ?? "").trim();
    if (rawRequestId && !/^[A-Za-z0-9:_-]{16,128}$/.test(rawRequestId)) {
        res.status(400).json({ ok: false, error: "bad_request_id", message: "Некорректный ключ запроса" });
        return;
    }
    const requestId = rawRequestId || null;
    let phone = String(body.phone ?? "").trim();
    let lkData = null;
    if (tg?.id) {
        // Если юзер просил использовать привязанный телефон или не ввёл вручную —
        // подставляем подтверждённый номер из subscribers (источник правды).
        if (body.useVerifiedPhone || !phone) {
            const verified = await (0, lk_2.getVerifiedPhone)(tg.id).catch(() => null);
            if (verified)
                phone = verified;
        }
        try {
            const lk = await (0, lk_2.fetchLk)(tg.id);
            lkData = lk.ok ? lk.data : null;
        }
        catch { }
    }
    phone = phone.slice(0, 32);
    const customerName = String(body.name ?? "").trim().slice(0, 120);
    const orderAddress = String(body.address ?? "").trim().slice(0, 500);
    const rawOrderDate = String(body.delivery_date ?? "").trim().slice(0, 32);
    const orderDate = rawOrderDate ? (0, date_utils_1.normalizeDeliveryDate)(rawOrderDate) : "";
    if (rawOrderDate && !orderDate) {
        res.status(400).json({ ok: false, error: "bad_delivery_date", message: "Укажите корректную дату доставки" });
        return;
    }
    const orderTime = String(body.delivery_time ?? "").trim().slice(0, 32);
    const customerComment = String(body.comment ?? "").trim().slice(0, 2000);
    const customerEmail = String(body.email ?? "").trim().slice(0, 254);
    const itemMap = new Map();
    if (Array.isArray(body.items)) {
        for (const item of body.items) {
            const id = Number(item?.id);
            const qty = Number(item?.qty);
            if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(qty) || qty <= 0 || qty > 99)
                continue;
            itemMap.set(id, Math.min(99, (itemMap.get(id) ?? 0) + qty));
        }
    }
    const items = [...itemMap].map(([id, qty]) => ({ id, qty }));
    // Снимок body для логирования (без чувствительных данных)
    const bodySnap = {
        phone: phone ? maskPhone(phone) : undefined,
        name: customerName || undefined,
        itemsCount: items.length,
        itemIds: items.slice(0, 10).map((i) => i.id),
        hasAddress: !!orderAddress,
        hasComment: !!customerComment,
        useVerifiedPhone: !!body.useVerifiedPhone,
    };
    const ts = new Date().toISOString();
    const baseAttempt = { ts, tg: tg?.id ?? null, body: bodySnap, outcome: "validation_error", status: 0 };
    console.log(`[ORDER] req: phone=${maskPhone(phone)} items=${items.length} ids=${JSON.stringify(bodySnap.itemIds)} tg=${tg?.id || '-'}`);
    // Валидация телефона: после очистки от не-цифр должно быть 10+ цифр
    const phoneDigits = phone.replace(/\D/g, "");
    if (!phone || phoneDigits.length < 10) {
        const r = { ok: false, error: "phone_required", message: "Укажите телефон (минимум 10 цифр, например 9149094916 или +79149094916)" };
        logOrderAttempt({ ...baseAttempt, status: 400, error: r.error, message: r.message });
        res.status(400).json(r);
        return;
    }
    if (!customerName) {
        const r = { ok: false, error: "name_required", message: "Укажите имя" };
        logOrderAttempt({ ...baseAttempt, status: 400, error: r.error, message: r.message });
        res.status(400).json(r);
        return;
    }
    if (items.length === 0) {
        const original = Array.isArray(body.items) ? body.items.length : 0;
        const msg = original > 0
            ? "Не удалось разобрать товары в корзине. Очистите корзину и добавьте заново."
            : "Корзина пуста";
        const r = { ok: false, error: "empty_cart", message: msg };
        logOrderAttempt({ ...baseAttempt, status: 400, error: r.error, message: r.message });
        res.status(400).json(r);
        return;
    }
    if (items.length > 30) {
        const r = { ok: false, error: "too_many_items", message: "Слишком много позиций (максимум 30)" };
        logOrderAttempt({ ...baseAttempt, status: 400, error: r.error, message: r.message });
        res.status(400).json(r);
        return;
    }
    // Собираем максимум контекста о клиенте — чтобы менеджер видел в Sale-заказе.
    // Используем BMP-only символы (Bitrix MySQL utf8 не держит 4-байтные эмодзи).
    const ctx = [];
    let rewardIds = [];
    if (customerComment)
        ctx.push(`Комментарий: ${customerComment}`);
    if (tg?.id) {
        // ⚠️ Наружу (менеджеру в Bitrix) — только родной id платформы, не internal
        const displayName = [tg.first_name, tg.last_name].filter(Boolean).join(" ") || null;
        if (tg.platform === "vk") {
            ctx.push(`VK: id=${tg.platformId} · vk.com/id${tg.platformId}${displayName ? ` · ${displayName}` : ""}`);
        }
        else {
            const tgInfo = [
                tg.username ? `@${tg.username}` : null,
                `id=${tg.platformId}`,
                displayName,
            ].filter(Boolean).join(" · ");
            ctx.push(`Telegram: ${tgInfo}`);
        }
    }
    else {
        ctx.push("Mini App: гость (не залогинен)");
    }
    if (lkData) {
        if (lkData.configured) {
            const name = lkData.name ? `${lkData.name}` : "";
            const level = lkData.level ? `· ${lkData.level}` : "";
            ctx.push(`Программа лояльности: ${name} ${level}`.trim());
            if (lkData.balance != null)
                ctx.push(`Баланс баллов: ${lkData.balance}`);
            if (lkData.year_spent != null)
                ctx.push(`Потрачено за год: ${Number(lkData.year_spent).toLocaleString("ru-RU")} ₽`);
            const tCount = Number(lkData.tickets_count ?? 0);
            if (tCount > 0)
                ctx.push(`Сладкий чек: ${tCount} билет${tCount === 1 ? "" : tCount < 5 ? "а" : "ов"}`);
            const orderCount = Array.isArray(lkData.orders) ? lkData.orders.length : 0;
            if (orderCount > 0)
                ctx.push(`История покупок на сайте: ${orderCount} заказ${orderCount === 1 ? "" : orderCount < 5 ? "а" : "ов"}`);
        }
        else {
            ctx.push("На сайте maria-irk.ru с этим телефоном клиент не зарегистрирован");
        }
    }
    // Локальный баланс бота (звёзды/очки за игры/рефералов)
    if (tg?.id) {
        try {
            const bal = await (0, club_2.getBalance)(tg.id);
            if (bal.stars > 0 || bal.points > 0) {
                ctx.push(`Бот-бонусы: ${bal.points} очков · ${bal.stars} звёзд (всего заработано: ${bal.totalEarnedPoints} очков · ${bal.totalEarnedStars} звёзд)`);
            }
        }
        catch { }
        // Подтверждение телефона через бот
        try {
            const verified = await (0, club_2.isPhoneVerified)(tg.id);
            if (verified)
                ctx.push("✓ Телефон подтверждён через Mini App");
        }
        catch { }
        // История взаимодействия с ботом: дата регистрации, запуски, последний заход
        try {
            const info = await (0, db_2.getSubscriberInfo)(tg.id);
            if (info) {
                const fmt = (iso) => {
                    if (!iso)
                        return "—";
                    const d = new Date(iso);
                    return d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
                };
                const reg = info.joined_at ? `Регистрация в Mini App: ${fmt(info.joined_at)}` : null;
                const last = info.last_seen_at ? `последний заход: ${fmt(info.last_seen_at)}` : null;
                const cnt = info.launch_count > 0 ? `запусков: ${info.launch_count}` : null;
                const line = [reg, cnt, last].filter(Boolean).join(" · ");
                if (line)
                    ctx.push(line);
            }
        }
        catch { }
        // Накопленные награды с колеса/streak — добавляем в комментарий и помечаем used
        try {
            const rewards = await (0, db_2.getUnusedRewards)(tg.id);
            if (rewards.length > 0) {
                rewardIds = rewards.map((reward) => Number(reward.id));
                const REWARD_LABEL = {
                    discount_coupon: (v) => `🎫 Купон -${v}%`,
                    points: (v) => `💎 +${v} баллов`,
                    free_eclair: () => "🍫 Бесплатный эклер (при заказе от 800 ₽)",
                    double_points: () => "✨ ×2 баллов на этот заказ",
                    sweet_ticket: () => "🎟 +1 билет в Sweet Check",
                    cake_month_10: () => "🎂 Торт месяца -10%",
                    free_dessert: () => "🍰 Бесплатный десерт (streak 7 дней)",
                };
                const lines = rewards.map((r) => {
                    const fn = REWARD_LABEL[r.kind];
                    return fn ? fn(r.value) : `🎁 ${r.kind}`;
                });
                ctx.push(`Накопленные награды (применить):\n• ${lines.join("\n• ")}`);
            }
        }
        catch { }
    }
    // Имена/цены позиций из кэша каталога — для B24-fallback, когда шлюз сайта лежит
    // (обычный путь берёт их из ответа PHP, fallback-путь иначе показал бы «Товар #id»)
    const itemsInfo = items.map((i) => {
        const p = catalog.find((c) => c.id === i.id);
        return { id: i.id, name: p?.name ?? `Товар #${i.id}`, price: p?.priceNumber ?? 0, qty: i.qty };
    });
    const missingProduct = items.find((item) => !catalog.some((product) => product.id === item.id));
    if (missingProduct) {
        const r = { ok: false, error: "product_not_found", message: `Товар #${missingProduct.id} больше недоступен. Обновите корзину.` };
        logOrderAttempt({ ...baseAttempt, status: 400, error: r.error, message: r.message });
        res.status(400).json(r);
        return;
    }
    // Цену и скидку считаем только по серверному каталогу. cart_total/discount из
    // браузера никогда не участвуют в создании заказа.
    const subtotal = itemsInfo.reduce((sum, item) => sum + item.price * item.qty, 0);
    const promoCode = String(body.promo_code ?? "").trim().toUpperCase();
    if (promoCode.length > 64) {
        res.status(400).json({ ok: false, error: "promo_code_too_long", message: "Некорректный промокод" });
        return;
    }
    const effectiveRequestId = requestId ?? crypto_1.default.randomUUID();
    const requestHash = crypto_1.default.createHash("sha256").update(JSON.stringify({
        phone: phoneDigits.slice(-10), name: customerName, items,
        address: orderAddress, delivery_date: orderDate,
        delivery_time: orderTime, email: customerEmail,
        comment: customerComment, promoCode,
    })).digest("hex");
    const ownerKey = tg?.id
        ? `user:${tg.id}`
        : `phone:${crypto_1.default.createHash("sha256").update(phoneDigits.slice(-10)).digest("hex")}`;
    // Проверяем уже завершённый запрос ДО проверки one_per_user: иначе сетевой
    // повтор успешного заказа видел бы уже списанный промокод и получал 409.
    if (requestId) {
        const existing = await (0, db_3.lookupOrderRequest)(requestId, ownerKey, requestHash);
        if (existing?.state === "succeeded") {
            res.json(existing.response);
            return;
        }
        if (existing?.state === "pending") {
            res.status(409).json({ ok: false, error: "order_in_progress", message: "Этот заказ уже оформляется. Подождите несколько секунд." });
            return;
        }
        if (existing?.state === "conflict") {
            res.status(409).json({ ok: false, error: "request_id_reused", message: "Ключ запроса уже использован для другого заказа" });
            return;
        }
    }
    let appliedPromo = null;
    if (promoCode) {
        const sync = (0, promo_2.validatePromoSync)({ code: promoCode, cart_total: subtotal });
        if (sync.result.ok && sync.promo) {
            if (sync.promo.one_per_user && !tg?.id) {
                res.status(401).json({ ok: false, error: "promo_login_required", message: "Для этого промокода нужно войти в аккаунт" });
                return;
            }
            if (tg?.id && sync.promo.one_per_user && await (0, db_2.hasUserUsedPromo)(tg.id, sync.promo.code)) {
                res.status(409).json({ ok: false, error: "promo_already_used", message: "Этот промокод уже использован" });
                return;
            }
            if (sync.promo.max_uses_total != null && await (0, db_2.countPromoUses)(sync.promo.code) >= sync.promo.max_uses_total) {
                res.status(409).json({ ok: false, error: "promo_limit_reached", message: "Лимит активаций промокода исчерпан" });
                return;
            }
            appliedPromo = {
                code: sync.promo.code,
                discount: Number(sync.result.discount ?? 0),
                source: "catalog",
                maxUsesTotal: sync.promo.max_uses_total,
                onePerUser: sync.promo.one_per_user,
            };
        }
        else if (sync.result.reason === "not_found" && tg?.id) {
            const reward = await (0, db_3.findUserReward)(tg.id, promoCode).catch(() => null);
            const todayIrk = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
            if (!reward || reward.used_at) {
                res.status(409).json({ ok: false, error: reward ? "promo_already_used" : "promo_not_found", message: reward ? "Награда уже использована" : "Промокод не найден" });
                return;
            }
            if (new Date(reward.expires_at).toISOString().slice(0, 10) < todayIrk) {
                res.status(409).json({ ok: false, error: "promo_expired", message: "Срок действия промокода истёк" });
                return;
            }
            if (reward.reward_type !== "percent" && reward.reward_type !== "amount") {
                res.status(409).json({ ok: false, error: "promo_cashier_only", message: "Эту награду нужно показать кассиру" });
                return;
            }
            if (reward.min_order && subtotal < reward.min_order) {
                res.status(409).json({ ok: false, error: "promo_min_order", message: `Минимальная сумма заказа: ${reward.min_order.toLocaleString("ru-RU")} ₽` });
                return;
            }
            const value = Number(reward.discount_value ?? 0);
            appliedPromo = {
                code: promoCode,
                discount: reward.reward_type === "percent" ? Math.floor(subtotal * value / 100) : Math.min(value, subtotal),
                source: "user_reward",
                maxUsesTotal: null,
                onePerUser: true,
            };
        }
        else {
            const messages = {
                expired: "Срок действия промокода истёк",
                min_order_not_met: sync.promo?.min_order ? `Минимальная сумма заказа: ${sync.promo.min_order.toLocaleString("ru-RU")} ₽` : "Недостаточная сумма заказа",
                not_found: "Промокод не найден",
            };
            res.status(409).json({ ok: false, error: `promo_${sync.result.reason ?? "invalid"}`, message: messages[sync.result.reason ?? ""] ?? "Промокод нельзя применить" });
            return;
        }
    }
    const expectedTotal = Math.max(0, subtotal - (appliedPromo?.discount ?? 0));
    if (appliedPromo) {
        ctx.push(`Промокод проверен сервером: ${appliedPromo.code} · скидка ${appliedPromo.discount.toLocaleString("ru-RU")} ₽ · итого ${expectedTotal.toLocaleString("ru-RU")} ₽`);
    }
    const richComment = ctx.join("\n");
    let idempotencyClaimed = false;
    if (requestId) {
        const claim = await (0, db_3.claimOrderRequest)(requestId, ownerKey, requestHash);
        if (claim.state === "succeeded") {
            res.json(claim.response);
            return;
        }
        if (claim.state === "pending") {
            res.status(409).json({ ok: false, error: "order_in_progress", message: "Этот заказ уже оформляется. Подождите несколько секунд." });
            return;
        }
        if (claim.state === "conflict") {
            res.status(409).json({ ok: false, error: "request_id_reused", message: "Ключ запроса уже использован для другого заказа" });
            return;
        }
        idempotencyClaimed = true;
    }
    const promoReservationRef = `pending:${effectiveRequestId}`;
    let promoReserved = false;
    if (appliedPromo) {
        try {
            if (appliedPromo.source === "catalog") {
                const reserved = await (0, db_3.recordPromoUseGuarded)(appliedPromo.code, tg?.id ?? null, promoReservationRef, appliedPromo.maxUsesTotal, appliedPromo.onePerUser);
                promoReserved = reserved.ok;
            }
            else if (tg?.id) {
                promoReserved = await (0, db_3.markUserRewardUsed)(appliedPromo.code, tg.id, promoReservationRef);
            }
        }
        catch (error) {
            logger_1.log.error({ err: error, code: appliedPromo.code }, "[order] promo reservation");
        }
        if (!promoReserved) {
            if (idempotencyClaimed)
                await (0, db_3.releaseOrderRequest)(effectiveRequestId).catch(() => { });
            res.status(409).json({ ok: false, error: "promo_no_longer_available", message: "Промокод уже использован или его лимит исчерпан" });
            return;
        }
    }
    let result;
    try {
        result = await (0, order_1.createOrder)({
            phone,
            name: customerName,
            platform: tg?.platform,
            items,
            address: orderAddress || undefined,
            delivery_date: orderDate || undefined,
            delivery_time: orderTime || undefined,
            comment: richComment,
            email: customerEmail || undefined,
            request_id: effectiveRequestId,
            promo_code: appliedPromo?.code,
            promo_discount: appliedPromo?.discount,
            expected_total: appliedPromo ? expectedTotal : undefined,
        }, itemsInfo);
    }
    catch (error) {
        if (appliedPromo && promoReserved) {
            if (appliedPromo.source === "catalog")
                await (0, db_3.releasePromoUse)(appliedPromo.code, promoReservationRef).catch(() => { });
            else if (tg?.id)
                await (0, db_3.releaseUserReward)(appliedPromo.code, tg.id, promoReservationRef).catch(() => { });
        }
        if (idempotencyClaimed)
            await (0, db_3.releaseOrderRequest)(effectiveRequestId).catch(() => { });
        logger_1.log.error({ err: error, requestId: effectiveRequestId }, "[order] unexpected create failure");
        res.status(502).json({ ok: false, error: "order_failed", message: translateOrderError(undefined) });
        return;
    }
    if (!result.ok) {
        if (appliedPromo && promoReserved) {
            if (appliedPromo.source === "catalog")
                await (0, db_3.releasePromoUse)(appliedPromo.code, promoReservationRef).catch(() => { });
            else if (tg?.id)
                await (0, db_3.releaseUserReward)(appliedPromo.code, tg.id, promoReservationRef).catch(() => { });
        }
        if (idempotencyClaimed)
            await (0, db_3.releaseOrderRequest)(effectiveRequestId).catch(() => { });
        console.error(`[ORDER] PHP error: ${result.error} for phone=${maskPhone(phone)} items=${JSON.stringify(bodySnap.itemIds)}`);
        const userMsg = translateOrderError(result.error);
        logOrderAttempt({ ...baseAttempt, outcome: "php_error", status: 502, error: result.error, message: userMsg });
        res.status(502).json({ ok: false, error: result.error ?? "order_failed", message: userMsg });
        return;
    }
    console.log(`[ORDER] created ${result.leadOnly ? "B24-lead (сайт недоступен)" : `#${result.orderId}`} for ${maskPhone(phone)}`);
    logOrderAttempt({ ...baseAttempt, outcome: "success", status: 200, orderId: result.orderId });
    const finalOrderRef = String(result.orderId ?? effectiveRequestId);
    if (tg?.id && result.orderId) {
        await (0, db_3.recordAppOrderOwner)(tg.id, String(result.orderId)).catch((error) => {
            logger_1.log.error({ err: error, chatId: tg.id, orderId: result.orderId }, "[order] owner mapping");
        });
    }
    if (appliedPromo && promoReserved) {
        if (appliedPromo.source === "catalog")
            await (0, db_3.finalizePromoUseOrder)(appliedPromo.code, promoReservationRef, finalOrderRef).catch(() => { });
        else if (tg?.id)
            await (0, db_3.finalizeUserRewardOrder)(appliedPromo.code, tg.id, promoReservationRef, finalOrderRef).catch(() => { });
    }
    const finalExpectedTotal = appliedPromo ? expectedTotal : Number(result.total ?? subtotal);
    const responseResult = {
        ...result,
        discount: appliedPromo?.discount ?? 0,
        expectedTotal: finalExpectedTotal,
        ...(result.orderId && (0, order_location_1.orderTrackingToken)(result.orderId)
            ? { trackingToken: (0, order_location_1.orderTrackingToken)(result.orderId) }
            : {}),
    };
    if (idempotencyClaimed) {
        await (0, db_3.completeOrderRequest)(effectiveRequestId, responseResult).catch((error) => {
            // Заказ уже существует во внешней системе: клиент всё равно должен
            // получить успех, а pending-запись не даст случайно создать дубль.
            logger_1.log.error({ err: error, requestId: effectiveRequestId }, "[order] idempotency completion");
        });
    }
    // Корзина превратилась в заказ — снимаем snapshot чтобы не пушить abandonment
    if (tg?.id) {
        (0, db_2.clearCartSnapshot)(tg.id).catch(() => { });
        // Списываем ровно тот снимок наград, который вошёл в комментарий заказа.
        (0, db_2.consumeRewards)(tg.id, rewardIds).catch(() => { });
    }
    // Push confirmation в TG-чат (если есть chat_id юзера)
    // `tg` уже объявлен выше через tryGetTgUser(req)
    if (tg?.id) {
        const itemsLine = items.slice(0, 3).map((it) => `${it.qty}× #${it.id}`).join(", ");
        const moreLine = items.length > 3 ? ` +${items.length - 3}` : "";
        const dateLine = orderDate && orderTime
            ? `\n📅 ${orderDate} · ${orderTime}`
            : "";
        const addrLine = orderAddress ? `\n📍 ${orderAddress.slice(0, 80)}` : "";
        const msg = `✅ *Заявка ${result.orderId ? `№${result.orderId} ` : ""}принята!*

🛒 ${itemsLine}${moreLine}${dateLine}${addrLine}

Менеджер позвонит для подтверждения в течение 1 часа.
_Узнать статус: напишите боту_`;
        sendRaw(tg.id, (0, links_1.withAppLinkForVk)(tg.id, msg), { parse_mode: "Markdown" }).then((ok) => {
            if (!ok)
                console.warn(`[ORDER push] failed for chat ${tg.id}`);
        });
        // Если есть delivery_date — schedule напоминание за 2 часа до
        if (orderDate && orderTime) {
            try {
                const [dd, mm, yyyy] = orderDate.split(".");
                const [hh] = orderTime.split(":");
                if (dd && mm && yyyy && hh) {
                    const target = new Date(`${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}T${hh.padStart(2, "0")}:00:00+08:00`);
                    const reminderTime = target.getTime() - 2 * 60 * 60 * 1000;
                    const delay = reminderTime - Date.now();
                    if (delay > 0 && delay < 30 * 24 * 60 * 60 * 1000) { // только если в пределах 30 дней
                        setTimeout(() => {
                            sendRaw(tg.id, `🔔 Через 2 часа ваш заказ №${result.orderId} будет готов!\n\n${orderTime} · ${orderDate}`).catch(() => { });
                        }, delay);
                    }
                }
            }
            catch { }
        }
    }
    res.json(responseResult);
});
// /api/partners/sync вынесен в src/routes/partners.ts
// Прокси к /api/shops.php на сайте — миниапп получает реальные адреса
const SHOPS_API = process.env.SHOPS_API ?? "";
const SHOPS_TOKEN = process.env.SHOPS_TOKEN ?? process.env.LK_TOKEN ?? "";
let _shopsCache = null;
// Hardcoded coords для известных адресов кафе Мария.
// Если адрес содержит ключевое слово — подставляем уточнённые координаты.
// Fallback: центр города (Иркутск/Ангарск).
const CAFE_COORDS_LOOKUP = [
    // Иркутск — Центр
    { match: /ленина[, ]*1\b/i, lat: 52.2766, lon: 104.2806 },
    { match: /карла маркса[, ]*24/i, lat: 52.2802, lon: 104.2843 },
    { match: /партизанск/i, lat: 52.2858, lon: 104.2762 },
    { match: /верхн.+набереж/i, lat: 52.2826, lon: 104.2752 },
    { match: /рабочая[, ]*2/i, lat: 52.2826, lon: 104.2796 },
    { match: /баррикад/i, lat: 52.3022, lon: 104.2611 },
    { match: /карла либкнехта/i, lat: 52.2849, lon: 104.2785 },
    { match: /советская/i, lat: 52.2870, lon: 104.2920 },
    { match: /декабрист/i, lat: 52.2724, lon: 104.3013 },
    // Иркутск — Свердловский / Юбилейный / Студгородок
    { match: /юбилейн.+5[06]|юбилейный[, ]*56/i, lat: 52.2400, lon: 104.2540 },
    { match: /дьяконов/i, lat: 52.2381, lon: 104.2553 },
    { match: /жукова[, ]*11/i, lat: 52.2683, lon: 104.2444 },
    { match: /терешковой/i, lat: 52.2530, lon: 104.2620 },
    // Иркутск — Октябрьский / Байкальская
    { match: /байкальская[, ]*141/i, lat: 52.2900, lon: 104.3322 },
    { match: /байкальская[, ]*105/i, lat: 52.2728, lon: 104.3128 },
    { match: /байкальская[, ]*295/i, lat: 52.3122, lon: 104.3658 },
    { match: /байкальская/i, lat: 52.2900, lon: 104.3322 }, // fallback
    // Иркутск — Куйбышевский (Ржанова, Зелёный)
    { match: /ржанова/i, lat: 52.3083, lon: 104.2950 },
    // Ангарск
    { match: /ангарск/i, lat: 52.5333, lon: 103.9000 },
    { match: /18 микрорайон|микрорайон.+19/i, lat: 52.5358, lon: 103.8987 },
];
const IRKUTSK_CENTER = { lat: 52.286, lon: 104.305 };
const ANGARSK_CENTER = { lat: 52.535, lon: 103.900 };
function enrichShopCoords(s) {
    // Уже есть валидные координаты — не трогаем
    const existingLat = Number(s.lat ?? s.latitude);
    const existingLon = Number(s.lon ?? s.longitude);
    if (Number.isFinite(existingLat) && Number.isFinite(existingLon) && Math.abs(existingLat) > 0.1) {
        return s;
    }
    const addr = String(s.address ?? s.name ?? "");
    const city = String(s.city ?? "");
    // Сначала ищем точный match
    for (const rule of CAFE_COORDS_LOOKUP) {
        if (rule.match.test(addr) || rule.match.test(city)) {
            return { ...s, lat: rule.lat, lon: rule.lon, _coords_source: "lookup" };
        }
    }
    // Fallback — центр города
    if (/ангарск/i.test(addr) || /ангарск/i.test(city)) {
        return { ...s, lat: ANGARSK_CENTER.lat, lon: ANGARSK_CENTER.lon, _coords_source: "city_center" };
    }
    return { ...s, lat: IRKUTSK_CENTER.lat, lon: IRKUTSK_CENTER.lon, _coords_source: "city_center" };
}
// Фолбэк: бандл-список кафе (data/shops.json) — когда сайтовый шлюз /api/shops.php
// недоступен (сейчас 404) или отдаёт пусто. Данные реальные (со страницы контактов
// сайта), координаты доставляет enrichShopCoords.
function bundledShops() {
    try {
        const raw = fsSync.readFileSync(path_1.default.join(__dirname, "..", "data", "shops.json"), "utf-8");
        const data = JSON.parse(raw);
        const shops = Array.isArray(data.shops)
            ? data.shops.map((s) => enrichShopCoords(s))
            : [];
        return { count: shops.length, shops };
    }
    catch {
        return null;
    }
}
app.get("/api/shops", (0, middleware_1.rateLimit)(60), async (_req, res) => {
    // Кеш 1 час (общий для апстрима и фолбэка)
    if (_shopsCache && (Date.now() - _shopsCache.ts) < 3600000) {
        res.json(_shopsCache.data);
        return;
    }
    // 1) Сайтовый шлюз, если настроен и жив
    if (SHOPS_API && SHOPS_TOKEN) {
        try {
            const sep = SHOPS_API.includes("?") ? "&" : "?";
            const url = `${SHOPS_API}${sep}token=${encodeURIComponent(SHOPS_TOKEN)}`;
            const raw = await new Promise((resolve, reject) => {
                const req = https_1.default.get(url, (r) => {
                    let body = "";
                    r.on("data", (c) => body += c);
                    r.on("end", () => { try {
                        resolve(JSON.parse(body));
                    }
                    catch (e) {
                        reject(e);
                    } });
                });
                req.on("error", reject);
                req.setTimeout(10000, () => { req.destroy(); reject(new Error("Timeout")); });
            });
            const data = raw;
            if (Array.isArray(data?.shops) && data.shops.length > 0) {
                data.shops = data.shops.map((s) => enrichShopCoords(s));
                _shopsCache = { data, ts: Date.now() };
                res.json(data);
                return;
            }
            console.warn("[SHOPS] upstream empty — using bundled fallback");
        }
        catch (e) {
            console.warn("[SHOPS] upstream failed — using bundled fallback:", e.message);
        }
    }
    // 2) Фолбэк: реальный список кафе из бандла (data/shops.json)
    const fb = bundledShops();
    if (fb && fb.shops.length > 0) {
        _shopsCache = { data: fb, ts: Date.now() };
        res.json(fb);
        return;
    }
    res.status(502).json({ count: 0, shops: [], error: "unavailable" });
});
// Сброс кеша адресов кафе — следующий /api/shops подтянет свежее с сайта
app.post("/api/admin/shops/reload", middleware_1.requireAdminToken, (0, middleware_1.requireAdminRole)("operator"), (_req, res) => {
    _shopsCache = null;
    res.json({ ok: true, cleared: true });
});
// Sweet Check (недели + призы) вынесены в src/routes/sweet-check.ts
app.use(sweet_check_1.default);
app.get("/health", (_req, res) => res.json({ status: "ok", catalog: catalog.length, partners: (0, partners_2.getPartnersMeta)() }));
// Версия билда — для верификации, что новый код задеплоился
app.get("/version", (_req, res) => res.json({
    version: process.env.npm_package_version ?? "unknown",
    commit: process.env.RENDER_GIT_COMMIT ?? "local",
    features: ["rich-order-comment", "subscriber-stats", "phone-verified-mark", "b24-productrows", "rich-items-list"],
}));
// ─── Запуск ──────────────────────────────────────────────────────────────────
bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`[BOT ERROR] update_id=${ctx.update.update_id}`);
    console.error(`  type: ${err.constructor.name}`);
    console.error(`  message: ${err.message}`);
    if (err.stack)
        console.error(err.stack);
});
async function sendBirthdayGreetings() {
    const users = await (0, db_2.getTodayBirthdays)();
    for (const { chat_id, first_name } of users) {
        const name = first_name ? `, ${first_name}` : "";
        const ok = await sendRaw(chat_id, (0, links_1.withAppLinkForVk)(chat_id, `🎂 С днём рождения${name}!\n\nКондитерская «Мария» поздравляет вас и дарит скидку:\n🎁 *−5% вам* и *−10% детям* (действует ±5 дней от дня рождения)\n\nПриходите порадовать себя сладким! 🍰`), { parse_mode: "Markdown" });
        if (ok) {
            await (0, db_2.markBirthdayNotified)(chat_id).catch(() => { });
            console.log(`[BIRTHDAY] Поздравили chat_id=${chat_id}`);
        }
        else {
            console.error(`[BIRTHDAY] Не доставлено chat_id=${chat_id}`);
        }
    }
}
async function main() {
    await (0, db_2.initDb)();
    await (0, club_2.initClubSchema)();
    await (0, pet_2.initPetSchema)();
    await (0, clicker_2.initClickerSchema)();
    await (0, pigeons_2.initPigeonSchema)();
    await (0, analytics_1.initAnalyticsSchema)();
    await (0, clicker_push_1.initClickerPushSchema)();
    await (0, bonus1c_1.initBonusSchema)();
    await (0, app_auth_1.initAppAuthSchema)();
    await (0, account_link_1.initAccountLinkSchema)();
    await (0, clicker_2.initSquadBankSchema)();
    await (0, clicker_2.initCustomSquadSchema)();
    (0, bonus1c_1.startBonusWorker)();
    // Sentry error handler — после всех routes, до listen
    app.use((0, logger_1.sentryExpressErrorHandler)());
    logger_1.log.info({
        botToken: BOT_TOKEN ? "set" : "MISSING",
        groqKey: GROQ_KEY ? "set" : "MISSING",
        webhookUrl: WEBHOOK_URL || "(empty — long polling)",
        port: PORT,
        previewMode: PREVIEW_MODE,
        sentry: process.env.SENTRY_DSN ? "enabled" : "disabled",
    }, "startup");
    // Ежедневные поздравления с днём рождения в 10:00 по Иркутску (UTC+8 = 02:00 UTC)
    node_cron_1.default.schedule("0 2 * * *", () => {
        sendBirthdayGreetings().catch((e) => console.error("[BIRTHDAY CRON]", e));
    });
    console.log("[STARTUP] Birthday cron scheduled (daily 10:00 Irkutsk)");
    // Pre-order push к ближайшим праздникам — каждое утро 10:30 Иркутск (02:30 UTC).
    // Запуск после birthday cron, чтоб день рождения не конкурировал с праздничным пушем.
    node_cron_1.default.schedule("30 2 * * *", () => {
        pushHolidayPreorder().catch((e) => console.error("[HOLIDAY CRON]", e));
    });
    console.log(`[STARTUP] Holiday pre-order cron scheduled (daily 10:30 Irkutsk; ${holidays_2.HOLIDAYS.length} holidays tracked)`);
    // Post-order rating prompts — каждый час дёргает «Оцени заказ» для тех, у кого
    // заказ завершён 2-72 часа назад и rating ещё не отправлен.
    node_cron_1.default.schedule("47 * * * *", () => {
        pushOrderRatingPrompts().catch((e) => console.error("[RATING-PROMPT CRON]", e));
    });
    console.log("[STARTUP] Order rating-prompt cron scheduled (hourly)");
    // Order status cron — каждые 30 минут проверяет смены статусов у verified юзеров
    node_cron_1.default.schedule("*/30 * * * *", () => {
        checkOrderStatusChanges().catch((e) => console.error("[ORDER STATUS CRON]", e));
    });
    console.log("[STARTUP] Order-status cron scheduled (every 30 min)");
    // Cart abandonment cron — каждый час шлёт пуш юзерам с забытой корзиной >24h
    node_cron_1.default.schedule("23 * * * *", () => {
        pushCartAbandonments().catch((e) => logger_1.log.error({ err: e }, "[CART ABANDON CRON]"));
    });
    console.log("[STARTUP] Cart-abandonment cron scheduled (hourly)");
    // Пуши-возвраты «Котик Комбат» — раз в день 17:00 Иркутск (09:00 UTC).
    // 1 игровой пуш/день/игрок: серия под угрозой (приоритет) или «энергия полная».
    node_cron_1.default.schedule("0 9 * * *", () => {
        (0, clicker_push_1.runClickerRetentionPush)(_pushService).catch((e) => logger_1.log.error({ err: e }, "[CLICKER PUSH CRON]"));
    });
    console.log("[STARTUP] Clicker retention-push cron scheduled (daily 17:00 Irkutsk)");
    // Напоминание «Василий проголодался» — ежедневно 19:00 Иркутск (11:00 UTC).
    // За флагом PET_REMINDERS_ENABLED: выключен ⇒ тик молча выходит (без похода в БД
    // и без лога на каждый тик — состояние флага уже залогировано один раз ниже).
    node_cron_1.default.schedule("0 11 * * *", () => {
        if (!PET_REMINDERS_ENABLED)
            return;
        (0, pet_push_1.runPetHungryPush)(_pushService).catch((e) => logger_1.log.error({ err: e }, "[PET HUNGRY CRON]"));
    });
    // Напоминание «Энергия восстановилась» — каждые 30 минут (:13 и :43, разнесено
    // от других получасовых/часовых кронов, чтобы не пересекаться по нагрузке).
    node_cron_1.default.schedule("13,43 * * * *", () => {
        if (!PET_REMINDERS_ENABLED)
            return;
        (0, pet_push_1.runPetEnergyPush)(_pushService).catch((e) => logger_1.log.error({ err: e }, "[PET ENERGY CRON]"));
    });
    console.log(`[STARTUP] Pet reminder crons scheduled (hungry=19:00 Irkutsk, energy=every 30min; enabled=${PET_REMINDERS_ENABLED})`);
    // Воронка T2 — «баллы сгорают»: ежедневно 11:00 Иркутск (03:00 UTC).
    node_cron_1.default.schedule("0 3 * * *", () => {
        pushExpiringPoints().catch((e) => logger_1.log.error({ err: e }, "[FUNNEL EXPIRY CRON]"));
    });
    // Воронка T3 — реактивация «Василий скучает»: ежедневно 12:00 Иркутск (04:00 UTC).
    node_cron_1.default.schedule("0 4 * * *", () => {
        pushReactivation().catch((e) => logger_1.log.error({ err: e }, "[FUNNEL REACTIVATE CRON]"));
    });
    // Воронка T4 — реф-бонус за первый заказ приглашённого: каждый час :37.
    node_cron_1.default.schedule("37 * * * *", () => {
        checkReferralFirstOrders().catch((e) => logger_1.log.error({ err: e }, "[FUNNEL REF-ORDER CRON]"));
    });
    console.log(`[STARTUP] Funnel MVP crons scheduled (retention=${FUNNEL_RETENTION_ENABLED} ref-bonus=${FUNNEL_REF_BONUS_ENABLED}; OFF=dry-run)`);
    // Закрытие недельного сезона «Котик Комбат» — понедельник 00:02 Иркутск (вс 16:02 UTC),
    // ДО обнуления week_base активными игроками. Фиксирует топ-3 + начисляет призы.
    node_cron_1.default.schedule("2 16 * * 0", () => {
        (0, clicker_2.closeWeeklySeason)().catch((e) => logger_1.log.error({ err: e }, "[WEEKLY CLOSE CRON]"));
        // Гонка стаи финиширует вс, закрытие пн 00:02 = сразу после — та же тактовая точка.
        if (pigeons_2.RACE_ENABLED)
            (0, pigeons_2.closeRaceWeek)().catch((e) => logger_1.log.error({ err: e }, "[RACE CLOSE CRON]"));
    });
    console.log(`[STARTUP] Weekly-season close cron scheduled (Mon 00:02 Irkutsk; race=${pigeons_2.RACE_ENABLED})`);
    // Catch-up после cold start/deploy: единственный понедельничный тик мог быть
    // пропущен, пока Render спал. Оба close идемпотентны по ключу недели.
    setTimeout(() => {
        void (async () => {
            try {
                await (0, clicker_2.closeWeeklySeason)();
                if (pigeons_2.RACE_ENABLED)
                    await (0, pigeons_2.closeRaceWeek)();
                await (0, clicker_2.pushWeeklyWinners)(_pushService);
            }
            catch (e) {
                logger_1.log.error({ err: e }, "[WEEKLY STARTUP CATCHUP]");
            }
        })();
    }, 12000);
    // Голубиная почта: возврат эскроу протухших офферов доски — ежедневно 00:10 Иркутск
    // (16:10 UTC). Помимо ленивого expireTrades() при чтении доски (getTradeBoard),
    // гарантирует возврат даже тем, кто доску не открывает.
    node_cron_1.default.schedule("10 16 * * *", () => {
        (0, pigeons_2.expireTrades)().catch((e) => logger_1.log.error({ err: e }, "[PIGEON TRADES EXPIRE CRON]"));
    });
    console.log("[STARTUP] Pigeon-trades expire cron scheduled (daily 00:10 Irkutsk)");
    // Пуш победителям недели — понедельник 10:00 Иркутск (02:00 UTC), не в тихие часы.
    node_cron_1.default.schedule("0 2 * * 1", () => {
        (0, clicker_2.pushWeeklyWinners)(_pushService).catch((e) => logger_1.log.error({ err: e }, "[WEEKLY PUSH CRON]"));
    });
    console.log("[STARTUP] Weekly-winners push cron scheduled (Mon 10:00 Irkutsk)");
    // Secret-of-day cron — каждое утро 09:00 Иркутск (UTC 01:00) выбирает товар
    node_cron_1.default.schedule("0 1 * * *", () => {
        rotateSecretOfDay().catch((e) => console.error("[SECRET-OF-DAY CRON]", e));
    });
    // Запустить при старте если ещё не задано на сегодня
    setTimeout(() => {
        (0, db_2.getSecretOfDay)().then((s) => {
            if (!s)
                return rotateSecretOfDay();
        }).catch(() => { });
    }, 8000);
    console.log("[STARTUP] Secret-of-day cron scheduled (09:00 Иркутск)");
    // Партнёры — синк с Bitrix раз в час (если PARTNERS_API задан)
    if (process.env.PARTNERS_API) {
        (0, partners_2.syncPartners)().catch((e) => logger_1.log.error({ err: e }, "[PARTNERS] startup sync"));
        node_cron_1.default.schedule("17 * * * *", () => {
            (0, partners_2.syncPartners)().catch((e) => logger_1.log.error({ err: e }, "[PARTNERS CRON]"));
        });
        console.log("[STARTUP] Partners cron scheduled (hourly)");
    }
    else {
        console.log("[STARTUP] PARTNERS_API not set — partners served from data/partners.json");
    }
    if (PREVIEW_MODE) {
        // Staging preview: только Express, без TG-webhook и без bot.start().
        // Mini App + API работают; команды бота и push'и — нет (Telegram отвергнет
        // вызовы с dummy-токеном, ошибки проглатываются существующими try/catch).
        app.listen(PORT, () => console.log(`🚀 Preview server on port ${PORT} (no Telegram bot)`));
    }
    else if (WEBHOOK_URL) {
        const webhookPath = `/webhook/${BOT_TOKEN}`;
        app.use(webhookPath, (0, grammy_1.webhookCallback)(bot, "express"));
        app.listen(PORT, async () => {
            try {
                await bot.api.setWebhook(`${WEBHOOK_URL}${webhookPath}`);
                const info = await bot.api.getWebhookInfo();
                console.log(`[STARTUP] Webhook set successfully (${info.pending_update_count || 0} pending updates)`);
                if (info.last_error_message) {
                    console.error(`[WEBHOOK] Last error: ${info.last_error_message} (${new Date((info.last_error_date ?? 0) * 1000).toISOString()})`);
                }
                console.log(`🚀 Server on port ${PORT} | Webhook set`);
            }
            catch (e) {
                logger_1.log.error({ err: e }, "[STARTUP] Failed to set webhook");
            }
        });
    }
    else {
        app.listen(PORT, () => console.log(`🚀 Server on port ${PORT} (long polling)`));
        try {
            await bot.start();
        }
        catch (e) {
            logger_1.log.error({ err: e }, "[STARTUP] bot.start() failed");
            throw e;
        }
    }
}
main().catch((err) => {
    logger_1.log.fatal({ err }, "fatal startup error");
    // Даём Sentry время отправить event, потом exit
    setTimeout(() => process.exit(1), 500);
});
// Также ловим unhandled rejections / uncaught exceptions глобально
process.on("unhandledRejection", (reason) => {
    logger_1.log.error({ err: reason }, "unhandledRejection");
});
process.on("uncaughtException", (err) => {
    logger_1.log.error({ err }, "uncaughtException");
});

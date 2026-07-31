import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import https from "https";
import cron from "node-cron";
import { Bot, webhookCallback, InlineKeyboard, Keyboard } from "grammy";
import { log, requestLogger, sentryExpressErrorHandler, captureError } from "./logger";
import { rateLimit, requireAdminToken, safeEq } from "./middleware";
import sweetCheckRouter, { loadSweetCheckPrizes } from "./routes/sweet-check";
import holidaysRouter from "./routes/holidays";
import { createCatalogRouter } from "./routes/catalog";
import { createReviewsRouter } from "./routes/reviews";
import clubRouter from "./routes/club";
import lkRouter from "./routes/lk";
import promoRouter from "./routes/promo";
import orderRatingRouter from "./routes/order-rating";
import orderLocationRouter from "./routes/order-location";
import cakeConceptRouter from "./routes/cake-concept";
import selfieCakeRouter from "./routes/selfie-cake";
import { createWishlistRouter } from "./routes/wishlist";
import leadsRouter from "./routes/leads";
import partnersRouter from "./routes/partners";
import notifyPrefsRouter from "./routes/notify-prefs";
import { createSecretOfDayRouter } from "./routes/secret-of-day";
import { createPushService } from "./push";
import { createVkSender } from "./vk/sender";
import { createVkCallbackRouter } from "./vk/callback";
import { createVkRouter } from "./routes/vk";
import { miniAppLink, withAppLinkForVk, clickerReferralLink } from "./links";
import { createReferralRouter } from "./routes/referral";
import { createWheelStreakRouter } from "./routes/wheel-streak";
import { createPigeonsRouter } from "./routes/pigeons";
import { pool as _dbPoolForRouters } from "./db";
import userRouter from "./routes/user";
import gameRouter from "./routes/game";
import petRouter from "./routes/pet";
import appAuthRouter, { initAppAuthSchema, attachAppLoginChat, completeAppLogin } from "./routes/app-auth";
import { initPetSchema } from "./pet";
import clickerRouter from "./routes/clicker";
import { initClickerSchema, registerRef, closeWeeklySeason, pushWeeklyWinners, getRefOrderCandidates, markRefOrderRewarded } from "./clicker";
import { initPigeonSchema, RACE_ENABLED, closeRaceWeek, expireTrades } from "./pigeons";
import { initAnalyticsSchema, trackEvent, wasFunnelSent, markFunnelSent, getDormantPlayers } from "./analytics";
import { initClickerPushSchema, runClickerRetentionPush } from "./clicker-push";
import { runPetHungryPush, runPetEnergyPush } from "./pet-push";
import { initBonusSchema, startBonusWorker } from "./bonus1c";
import cartRouter from "./routes/cart";
import { scrapeCatalog, loadCatalog, searchCatalog, catalogAge, fetchProductById, reloadDietaryOverrides, detectDietary, Product } from "./scraper";
import { initDb, addSubscriber, setSubscriberSourceOnce, getAllSubscribers, setUserBirthday, getTodayBirthdays, markBirthdayNotified, touchSubscriber, getSubscriberInfo, wishlistSync, getWishlistSubsForProducts, getOrCreateReferralCode, recordReferralUse, getOrderStatusMap, setOrderStatus, canSendNotification, logNotification, NotificationKind, getNotificationPrefs, setNotificationPrefs, saveCartSnapshot, clearCartSnapshot, getAbandonedCarts, markCartAbandonedPushed, getSpinStatus, recordSpin, WHEEL_PRIZES, touchVisitStreak, setSecretOfDay, getSecretOfDay, getUnusedRewards, consumeRewards, hasHolidayPushSent, markHolidayPushSent, getReviewsForProduct, getReviewStats, getReviewStatsBatch, getMyReview, upsertReview, deleteMyReview, setReviewHidden, countReviewsLast24h, createWishlistShare, getWishlistShare, incrementWishlistShareOpens, countWishlistSharesLast24h, getOrderRating, upsertOrderRating, hasRatingPromptSent, markRatingPromptSent, countPromoUses, hasUserUsedPromo, recordPromoUse } from "./db";
import {
  initClubSchema,
  getBalance,
  isPhoneVerified,
  verifyPhone,
  claimDailyLogin,
  convertStars,
  getRewardsCatalog,
  redeemReward,
  getMyRewards,
  recordGameResult,
  getHistory,
  getDailyStatus,
  CONVERSION_TIERS,
  earnPoints,
  getExpiringPointsUsers,
} from "./club";
import { requireTgUser, getTgUser, tryGetTgUser, tryGetUser } from "./auth";
import { getPartners, getPartnersMeta, syncPartners } from "./partners";
import { fetchLk, getVerifiedPhone } from "./lk";
import { createOrder, OrderRequest } from "./order";
import { getNextHoliday, getHolidaysToPushToday, HOLIDAYS } from "./holidays";
import { validatePromoSync, reloadPromoCodes, findPromo } from "./promo";
import { generateCakeConcepts, isConceptEnabled } from "./cake-concept";
import { storeSelfie, readSelfie, generateSelfieCakes, cleanupOldSelfies } from "./selfie-cake";

// ─── Env ────────────────────────────────────────────────────────────────────
const BOT_TOKEN    = process.env.BOT_TOKEN    ?? "";
const GROQ_KEY     = process.env.GROQ_KEY     ?? "";
const WEBHOOK_URL  = process.env.WEBHOOK_URL  ?? "";
const PORT         = Number(process.env.PORT  ?? 3000);
const MINI_APP_URL = process.env.MINI_APP_URL ?? WEBHOOK_URL;
const ADMIN_IDS    = (process.env.ADMIN_IDS ?? "").split(",").map(Number).filter(Boolean);

// Preview-режим (staging): если BOT_TOKEN пуст — поднимаем только HTTP-сервер
// (Mini App + API), но НЕ инициализируем Telegram-бота. Webhook не ставится,
// бот не конфликтует с prod-ботом. GROQ_KEY тоже не строго обязателен — без него
// AI-чат отдаёт 503, но всё остальное работает.
const PREVIEW_MODE = !BOT_TOKEN;
if (PREVIEW_MODE) {
  console.log("[STAGE] BOT_TOKEN пустой → preview mode: Telegram-бот отключён, работают только HTTP + Mini App");
}
if (!GROQ_KEY && !PREVIEW_MODE) console.warn("[startup] GROQ_KEY не задан — AI-чат вернёт 503");

// ─── Каталог (в памяти) ──────────────────────────────────────────────────────
let catalog: Product[] = loadCatalog();

async function refreshCatalog() {
  try {
    const prevIds = new Set(catalog.map((p) => p.id));
    catalog = await scrapeCatalog();
    // Diff: появились ли товары, которых раньше не было?
    if (prevIds.size > 0) {
      const newIds = catalog
        .map((p) => Number(p.id))
        .filter((id) => Number.isFinite(id) && !prevIds.has(id));
      if (newIds.length > 0) {
        notifyWishlistBackInStock(newIds).catch((e) => console.error("[WISHLIST notify]", (e as Error).message));
      }
    }
    prewarmImageCache().catch((e) => console.error("[IMG] prewarm failed:", (e as Error).message));
  } catch (e) {
    console.error("Ошибка обновления каталога:", (e as Error).message);
  }
}

async function notifyWishlistBackInStock(productIds: number[]) {
  const subs = await getWishlistSubsForProducts(productIds);
  if (subs.length === 0) return;
  // Группируем по chat_id чтобы отправить один push на юзера
  const byChat = new Map<number, number[]>();
  for (const s of subs) {
    const arr = byChat.get(s.chat_id) ?? [];
    arr.push(s.product_id);
    byChat.set(s.chat_id, arr);
  }
  let sent = 0;
  for (const [chatId, pids] of byChat.entries()) {
    const products = pids
      .map((id) => catalog.find((p) => p.id === id))
      .filter((p): p is Product => Boolean(p))
      .slice(0, 5);
    if (products.length === 0) continue;
    const list = products.map((p) => {
      const priceStr = p.priceNumber != null ? `${p.priceNumber.toLocaleString("ru-RU")} ₽` : (p.price || "");
      return `• ${p.name}${priceStr ? ` — ${priceStr}` : ""}`;
    }).join("\n");
    const msg = `🎂 *Снова в наличии*\n\n${list}\n\nЗабери, пока есть — открой Mini App.`;
    const ok = await sendPushSafely(chatId, "marketing_rewards", withAppLinkForVk(chatId, msg));
    if (ok) sent++;
  }
  if (sent > 0) console.log(`[WISHLIST] notified ${sent} subscribers about ${productIds.length} new product(s)`);
}

// Pre-order push к ближайшим праздникам (cron — раз в день).
// За preorderDays до даты праздника рассылаем всем подписчикам, у которых
// включён marketing_promo. Дедуп — таблица holiday_push_log (chat_id+holiday+year).
async function pushHolidayPreorder() {
  const due = getHolidaysToPushToday();
  if (due.length === 0) return;
  const subs = await getAllSubscribers();
  for (const occ of due) {
    let sent = 0, skipped = 0;
    const body = occ.holiday.pushBody(occ.daysUntil);
    const text = `${occ.holiday.emoji} *${occ.holiday.name}*\n\n${body}`;
    for (const { chat_id } of subs) {
      // Идемпотентность: не пушить, если уже отправили этому юзеру в этом году
      if (await hasHolidayPushSent(chat_id, occ.holiday.id, occ.year).catch(() => false)) {
        skipped++;
        continue;
      }
      // marketing_promo проверяет prefs+quiet hours+глобальный 5/сутки.
      // Weekly-quota=1 проигнорировать нельзя — это поведение sendPushSafely;
      // но праздничные пуши разнесены минимум на 10 дней, так что в норме проходят.
      const ok = await sendPushSafely(chat_id, "marketing_promo", withAppLinkForVk(chat_id, text));
      if (ok) {
        sent++;
        await markHolidayPushSent(chat_id, occ.holiday.id, occ.year).catch(() => {});
      }
    }
    console.log(`[HOLIDAY] ${occ.holiday.id} (${occ.daysUntil}d before): sent=${sent} skipped=${skipped}`);
  }
}

// Post-order rating prompts — push «Оцени заказ» через 2-72h после терминального статуса.
// Запускается из cron'а раз в час. Дедуп через таблицу order_rating_prompts.
async function pushOrderRatingPrompts() {
  const subs = await getAllSubscribers();
  let sent = 0, checked = 0;
  for (const s of subs) {
    const phone = await getVerifiedPhone(s.chat_id).catch(() => null);
    if (!phone) continue;
    const lk = await fetchLk(s.chat_id).catch(() => null);
    if (!lk?.ok || !lk.data?.configured) continue;
    const orders = Array.isArray(lk.data.orders) ? lk.data.orders : [];
    if (orders.length === 0) continue;
    checked++;
    // Берём заказы со статусом «доставлен/выдан/завершён» возрастом 2-72 часа
    for (const o of orders) {
      const status = String(o.status || "").toLowerCase().trim();
      if (!/выдан|доставлен|доставлено|завершён|завершен|выполнен/.test(status)) continue;
      let orderDate: Date | null = null;
      try {
        const d = new Date(String(o.date).replace(" ", "T"));
        if (!isNaN(d.getTime())) orderDate = d;
      } catch {}
      if (!orderDate) continue;
      const ageHours = (Date.now() - orderDate.getTime()) / 3_600_000;
      if (ageHours < 2 || ageHours > 72) continue;
      const orderId = String(o.id);
      // Дедуп: уже отправили?
      if (await hasRatingPromptSent(s.chat_id, orderId).catch(() => false)) continue;
      // Уже оценил?
      if (await getOrderRating(s.chat_id, orderId).catch(() => null)) {
        await markRatingPromptSent(s.chat_id, orderId).catch(() => {});
        continue;
      }
      // Отправляем push с deep-link на rating-форму (платформа получателя)
      const link = miniAppLink(s.chat_id, `rate_${orderId}`);
      const msg = `⭐ *Как тебе заказ №${orderId}?*\n\nОцени за 5 секунд — поможешь нам стать лучше. И получишь персональную подсказку, что попробовать в следующий раз 🍰\n\n[Открыть форму](${link})`;
      const ok = await sendPushSafely(s.chat_id, "marketing_promo", msg);
      if (ok) {
        sent++;
        await markRatingPromptSent(s.chat_id, orderId).catch(() => {});
      }
    }
  }
  if (sent > 0 || checked > 0) console.log(`[RATING-PROMPT] checked=${checked} sent=${sent}`);
}

// Cart abandonment — push юзерам, чья корзина живёт >24h без чекаута
async function pushCartAbandonments() {
  const abandoned = await getAbandonedCarts().catch(() => []);
  if (abandoned.length === 0) return;
  let sent = 0;
  for (const snap of abandoned) {
    const sum = Number(snap.total_sum) || 0;
    const cnt = Number(snap.item_count) || 0;
    const pluralItem = cnt === 1 ? "товар" : cnt < 5 ? "товара" : "товаров";
    const msg = `🛒 *Не забыл?*\n\nУ тебя в корзине ${cnt} ${pluralItem} на ${sum.toLocaleString("ru-RU")} ₽.\n\nЗабери до конца дня — открой Mini App.`;
    const ok = await sendPushSafely(snap.chat_id, "marketing_promo", withAppLinkForVk(snap.chat_id, msg));
    if (ok) sent++;
    // Помечаем как pushed чтобы не дёргать повторно
    await markCartAbandonedPushed(snap.chat_id).catch(() => {});
  }
  if (sent > 0) console.log(`[CART ABANDON] notified ${sent} subscribers`);
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

function pluralRu(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

// T2 — пуш «баллы сгорают»: реальные points, истекающие ≤ FUNNEL_EXPIRE_DAYS дней.
async function pushExpiringPoints() {
  const users = await getExpiringPointsUsers(FUNNEL_EXPIRE_DAYS).catch(() => []);
  if (users.length === 0) return;
  let sent = 0, dry = 0, skipped = 0;
  for (const u of users) {
    if (await wasFunnelSent(u.chatId, "points_expiry", FUNNEL_EXPIRE_DAYS + 1).catch(() => false)) { skipped++; continue; }
    const daysLeft = Math.max(1, Math.ceil((u.soonest.getTime() - Date.now()) / 86_400_000));
    const msg = `⏳ *Баллы скоро сгорают*\n\nУ тебя ${u.amount.toLocaleString("ru-RU")} бонусных ${pluralRu(u.amount, "балл", "балла", "баллов")} сгорят через ${daysLeft} ${pluralRu(daysLeft, "день", "дня", "дней")}. 1 балл = 1 ₽ — потрать их в заказе на maria-irk.ru, чтобы не потерять 🍰`;
    if (!FUNNEL_RETENTION_ENABLED) { dry++; continue; }
    const ok = await sendPushSafely(u.chatId, "marketing_promo", withAppLinkForVk(u.chatId, msg));
    if (ok) { sent++; await markFunnelSent(u.chatId, "points_expiry"); }
  }
  console.log(`[FUNNEL expiry] users=${users.length} sent=${sent} dry=${dry} skipped=${skipped} enabled=${FUNNEL_RETENTION_ENABLED}`);
}

// T3 — реактивация «Василий скучает»: игроки, уснувшие ≥ FUNNEL_REACT_DAYS дней.
async function pushReactivation() {
  const dormant = await getDormantPlayers(FUNNEL_REACT_DAYS, 90).catch(() => []);
  if (dormant.length === 0) return;
  let sent = 0, dry = 0, skipped = 0;
  for (const chatId of dormant) {
    if (await wasFunnelSent(chatId, "reactivation", FUNNEL_REACT_DAYS).catch(() => false)) { skipped++; continue; }
    const msg = `🐱 *Василий скучает!*\n\nДавно тебя не было в «Котик Комбат» — бизнес заскучал. Загляни, забери накопленные монеты и открой новых голубей-помощников!`;
    if (!FUNNEL_RETENTION_ENABLED) { dry++; continue; }
    const full = withAppLinkForVk(chatId, `${msg}\n\n${miniAppLink(chatId, "click")}`);
    const ok = await sendPushSafely(chatId, "marketing_game", full);
    if (ok) { sent++; await markFunnelSent(chatId, "reactivation"); }
  }
  console.log(`[FUNNEL reactivate] dormant=${dormant.length} sent=${sent} dry=${dry} skipped=${skipped} enabled=${FUNNEL_RETENTION_ENABLED}`);
}

// T4 — реф-бонус за ПЕРВЫЙ заказ приглашённого: реальные points рефереру.
// Анти-абуз: только по реальному завершённому заказу приглашённого; дедуп флагом.
async function checkReferralFirstOrders() {
  const cands = await getRefOrderCandidates().catch(() => []);
  if (cands.length === 0) return;
  let paid = 0, checked = 0, dry = 0;
  for (const { invitee, referrer } of cands) {
    const phone = await getVerifiedPhone(invitee).catch(() => null);
    if (!phone) continue; // без верифицированного телефона заказы не видим
    const lk = await fetchLk(invitee).catch(() => null);
    if (!lk?.ok || !lk.data?.configured) continue;
    const orders = Array.isArray(lk.data.orders) ? lk.data.orders : [];
    const hasCompleted = orders.some((o) =>
      /выдан|доставлен|доставлено|выполнен|завершён|завершен/.test(String(o.status ?? "").toLowerCase())
    );
    checked++;
    if (!hasCompleted) continue;
    if (!FUNNEL_REF_BONUS_ENABLED) { dry++; continue; }
    // Помечаем ДО начисления — атомарный дедуп (никогда не задвоим реальные баллы).
    const claimed = await markRefOrderRewarded(invitee).catch(() => false);
    if (!claimed) continue;
    try {
      await earnPoints(referrer, FUNNEL_REF_ORDER_POINTS, "referral_first_order", { invitee });
      trackEvent(referrer, "referral_order", { invitee });
      const msg = `🎉 *Твой друг сделал первый заказ!*\n\nСпасибо, что привёл друга в «Марию» — тебе начислено ${FUNNEL_REF_ORDER_POINTS} бонусных ${pluralRu(FUNNEL_REF_ORDER_POINTS, "балл", "балла", "баллов")} (1 балл = 1 ₽). Потрать их в следующем заказе 🎂`;
      await sendPushSafely(referrer, "marketing_rewards", withAppLinkForVk(referrer, msg));
      paid++;
    } catch (e) {
      log.error({ err: e, referrer, invitee }, "[FUNNEL ref-order] earnPoints failed");
    }
  }
  console.log(`[FUNNEL ref-order] cands=${cands.length} checked=${checked} paid=${paid} dry=${dry} enabled=${FUNNEL_REF_BONUS_ENABLED}`);
}

// Order status diff — обходит подписчиков с verified phone, тянет /api/lk, diff'ит статусы
const STATUS_EMOJI: Record<string, string> = {
  "новый":             "📋",
  "новая":             "📋",
  "обработка":         "📞",
  "обрабатывается":    "📞",
  "принят":            "✅",
  "принято":           "✅",
  "оплачен":           "💳",
  "оплачен на сайте":  "💳",
  "готовится":         "🍳",
  "в работе":          "🍳",
  "готов":             "🎁",
  "готов к выдаче":    "🎁",
  "ожидает выдачи":    "🎁",
  "в доставке":        "🚚",
  "в пути":            "🚚",
  "доставлен":         "✅",
  "доставлено":        "✅",
  "выдан":             "✅",
  "выдано":            "✅",
  "завершён":          "✅",
  "завершен":          "✅",
  "выполнен":          "✅",
  "отменён":           "❌",
  "отменен":           "❌",
  "отмена":            "❌",
};
function statusEmoji(status: string): string {
  const key = status.toLowerCase().trim();
  return STATUS_EMOJI[key] || "📦";
}
function isTerminalStatus(status: string): boolean {
  const key = status.toLowerCase().trim();
  return /выдан|доставлен|доставлено|выполнен|завершён|завершен|отменён|отменен|отмена/.test(key);
}

async function checkOrderStatusChanges() {
  const subs = await getAllSubscribers();
  let pushed = 0;
  let checked = 0;
  for (const s of subs) {
    // Только верифицированные юзеры с реальным телефоном
    const phone = await getVerifiedPhone(s.chat_id).catch(() => null);
    if (!phone) continue;

    const lk = await fetchLk(s.chat_id).catch(() => null);
    if (!lk?.ok || !lk.data?.configured) continue;
    const orders = Array.isArray(lk.data.orders) ? lk.data.orders : [];
    if (orders.length === 0) continue;
    checked++;

    // Рассматриваем только активные заказы (не старше 14 дней)
    const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;
    const recent = orders.filter((o) => {
      try {
        const d = new Date(String(o.date).replace(" ", "T"));
        return !isNaN(d.getTime()) && Date.now() - d.getTime() < FOURTEEN_DAYS;
      } catch { return true; }
    });
    if (recent.length === 0) continue;

    const seen = await getOrderStatusMap(s.chat_id);
    for (const o of recent) {
      const orderId = String(o.id);
      const status = String(o.status ?? "").trim();
      if (!status) continue;
      const prev = seen.get(orderId);
      if (prev === undefined) {
        // Первый раз видим этот заказ — просто запомним, без push
        // (push о создании отправляет /api/order при создании)
        await setOrderStatus(s.chat_id, orderId, status).catch(() => {});
        continue;
      }
      if (prev === status) continue;
      // Статус изменился — пушим
      const emoji = statusEmoji(status);
      const msg = `${emoji} *Заказ №${orderId}* — ${status}`;
      const ok = await sendPushSafely(s.chat_id, "transactional", msg);
      if (ok) pushed++;
      await setOrderStatus(s.chat_id, orderId, status).catch(() => {});
      // T6: событие воронки — заказ дошёл до завершённого (не отменённого) статуса.
      if (isTerminalStatus(status) && !/отмен/.test(status.toLowerCase())) {
        trackEvent(s.chat_id, "order_completed", { orderId });
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
} else {
  console.log(`📦 Каталог загружен с диска: ${catalog.length} позиций (${catalogAge()})`);
  // Обновляем в фоне, не ждём
  refreshCatalog();
}

// Обновление каждые 24 часа
// Каталог обновляем каждый час — синхронизация с правками на сайте
setInterval(refreshCatalog, 10 * 60 * 1000); // 10 мин: правки каталога на сайте доезжают в приложение быстро

// Очистка старых файлов в /tmp (img_cache > 7 дней, lead_photos > 90 дней)
function cleanupTmpDir(dir: string, maxAgeMs: number) {
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
      } catch {}
    }
    if (removed > 0) console.log(`[CLEANUP] removed ${removed} stale files from ${dir}`);
  } catch {}
}
function runCleanup() {
  cleanupTmpDir("/tmp/img_cache", 7 * 24 * 60 * 60 * 1000);    // 7 дней
  cleanupTmpDir("/tmp/lead_photos", 90 * 24 * 60 * 60 * 1000); // 90 дней
  cleanupOldSelfies().catch(() => {});                          // 2 часа (внутри модуля)
}
setInterval(runCleanup, 6 * 60 * 60 * 1000); // каждые 6 часов
setTimeout(runCleanup, 5 * 60 * 1000);       // первая через 5 минут после старта

// ─── Telegram Bot ───────────────────────────────────────────────────────────
// В preview-режиме (staging без BOT_TOKEN) создаём бот с dummy-токеном —
// grammy не пингует api при new Bot(), а реальные вызовы к TG API будут
// валиться с 401 (которые уже под try/catch в push/notification коде).
// Webhook не ставится и bot.start() не вызывается — см. startup-блок внизу.
const bot = new Bot(BOT_TOKEN || "1:DUMMY_PREVIEW_TOKEN_AAAAAAAAAAAAAAAAAAAAAA");

// Push-service вынесен в src/push.ts. sendPushSafely остаётся доступным
// через привычное имя — фасад для существующих вызовов (push-functions,
// cron-jobs, /api/streak/touch, /api/wheel/spin и т.д.)
// VK-порт: пуши роутятся по платформе получателя (isVkId). Прямые
// bot.api.sendMessage по сохранённому chat_id запрещены — только send* отсюда.
const vkSender = createVkSender();
const _pushService = createPushService(bot, vkSender);
const sendPushSafely = _pushService.sendPushSafely;
const sendRaw = _pushService.sendRaw;

function webAppButton(_text: string, label = "🍰 Открыть Mini App") {
  return new InlineKeyboard().webApp(label, MINI_APP_URL || "https://t.me");
}

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
function buildSaleText(): string {
  const cfg = loadSweetCheckPrizes();
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
    await addSubscriber(ctx.from.id, ctx.from.username, ctx.from.first_name).catch(() => {});

    // Referral payload: /start ref_MARIA-XXX (code-based, активная схема)
    // Старый numeric-формат (/start ref_12345) — deprecated, игнорируется.
    const payload = ctx.match?.trim();
    // Вход в maria-app: /start applogin_<nonce> — привязать чат к nonce и
    // попросить контакт (криптографическая верификация, как в клубе).
    if (payload && /^applogin_[a-f0-9]{32}$/.test(payload)) {
      const okAttach = await attachAppLoginChat(payload.slice(9), ctx.from.id).catch(() => false);
      if (okAttach) {
        // Анти-фишинг: device-flow уязвим к «перешли жертве ссылку → она делится
        // номером → атакующий поллит nonce и получает доступ к её бонусам».
        // Явно предупреждаем — номером делиться только если вход инициировал ты сам.
        await ctx.reply(
          "🔐 Вход в приложение «Мария»\n\n" +
          "Если ВЫ только что открыли приложение и нажали «Войти через Telegram» — поделитесь номером кнопкой ниже, и приложение узнает вас и ваши бонусы.\n\n" +
          "⚠️ Если эту ссылку вам кто-то прислал — НЕ делитесь номером: так вы откроете доступ к своим бонусам и покупкам чужому человеку.",
          { reply_markup: new Keyboard().requestContact("📱 Это я — поделиться номером").resized().oneTime() }
        );
      } else {
        await ctx.reply("⏳ Ссылка входа устарела. Вернитесь в приложение и нажмите «Войти через Telegram» ещё раз.");
      }
      return;
    }
    // QR-воронка (чек/POS/упаковка): /start qr_<источник> — фиксируем источник
    // и показываем приветствие с бонусом за номер.
    if (payload && /^qr_[a-z0-9_-]{1,32}$/i.test(payload)) {
      await setSubscriberSourceOnce(ctx.from.id, payload.toLowerCase()).catch(() => {});
      await ctx.reply(QR_WELCOME, { parse_mode: "Markdown", reply_markup: webAppButton(QR_WELCOME) });
      return;
    }
    // Реферал кликера: /start ckref_<internalId пригласившего>. Надёжный путь
    // (?start= всегда доходит до бота, в отличие от Mini App ?startapp=).
    if (payload && payload.startsWith("ckref_")) {
      const ownerId = Number(payload.slice(6));
      if (Number.isFinite(ownerId) && ownerId !== ctx.from.id) {
        const r = await registerRef(ctx.from.id, String(ownerId)).catch(() => null);
        if (r?.ok) {
          const userName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || "Новый друг";
          await sendRaw(ownerId, `🎉 *${userName}* зашёл в «Котик Комбат» по твоей ссылке — тебе +30000 монет 🪙 Спасибо, что зовёшь друзей!`, { parse_mode: "Markdown" }).catch(() => {});
        }
        await ctx.reply(`🐱 Добро пожаловать в «Котик Комбат»!\n\nТебе начислено +2500 монет за вход по приглашению. Жми и качай котика 👇`, { reply_markup: webAppButton("", "🎮 Играть") }).catch(() => {});
        return;
      }
    }
    // «Код дружбы» голубятни: /start ckfr_<internalId владельца ссылки>. Клик =
    // взаимное согласие — связываем пару в pigeon_friends, оба видят друг друга
    // в адресатах голубиной почты.
    if (payload && payload.startsWith("ckfr_")) {
      const ownerId = Number(payload.slice(5));
      if (Number.isFinite(ownerId) && ownerId !== ctx.from.id) {
        const { addFriend } = await import("./pigeons");
        const r = await addFriend(ctx.from.id, ownerId).catch(() => null);
        if (r?.ok && !r.already) {
          const userName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || "Новый друг";
          await sendRaw(ownerId, `🕊️ *${userName}* принял твой код дружбы! Теперь вы можете слать друг другу голубей — загляни в Голубятню → Обмены/Почта.`, { parse_mode: "Markdown" }).catch(() => {});
          await ctx.reply(`🕊️ Вы теперь друзья! Отправляй голубей из Голубятни — вкладка «Голуби» → «Почта».`, { reply_markup: webAppButton("", "🎮 Открыть игру") }).catch(() => {});
        } else {
          await ctx.reply(r?.already ? `🕊️ Вы уже друзья! Открывай голубятню и шли голубей.` : `Не получилось добавить в друзья — попробуй позже.`, { reply_markup: webAppButton("", "🎮 Открыть игру") }).catch(() => {});
        }
        return;
      }
    }
    if (payload && payload.startsWith("ref_")) {
      const rest = payload.slice(4);
      if (/^MARIA-/i.test(rest)) {
        const r = await recordReferralUse(ctx.from.id, rest).catch(() => null);
        if (r?.ok && r.ownerChat) {
          const userName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || "Новый друг";
          // sendRaw: владелец кода может оказаться VK-юзером
          await sendRaw(
            r.ownerChat,
            `🎉 *${userName}* пришёл по твоему коду \`${rest.toUpperCase()}\` — спасибо, что зовёшь друзей в «Марию»!`,
            { parse_mode: "Markdown" }
          ).catch(() => {});
        }
      }
    }
  }
  await ctx.reply(WELCOME, { parse_mode: "Markdown", reply_markup: webAppButton(WELCOME) });
});

// Phone share via WebApp.requestContact OR keyboard button
bot.on(":contact", async (ctx) => {
  const c = ctx.message?.contact;
  if (!c || !ctx.from) return;
  if (c.user_id !== ctx.from.id) {
    await ctx.reply("Можно поделиться только своим номером 🙂");
    return;
  }
  await addSubscriber(ctx.from.id, ctx.from.username, ctx.from.first_name).catch(() => {});
  // Вход в maria-app: если у чата есть свежий pending-nonce — завершаем device-flow.
  const appLoginDone = await completeAppLogin(ctx.from.id, c.phone_number).catch(() => false);
  try {
    const result = await verifyPhone(ctx.from.id, c.phone_number);
    if (appLoginDone) {
      await ctx.reply(
        `✅ Готово! Вход подтверждён — вернитесь в приложение «Мария».${result.alreadyVerified ? "" : `

💎 Бонус: +${result.bonusAwarded} баллов за подтверждение номера.`}`,
        { reply_markup: { remove_keyboard: true } }
      );
    } else if (result.alreadyVerified) {
      await ctx.reply("✅ Номер уже подтверждён");
    } else {
      await ctx.reply(
        `✅ Номер подтверждён!\n\n💎 Тебе начислено +${result.bonusAwarded} баллов на счёт.\nОткрой Mini App, чтобы продолжить 👇`,
        { reply_markup: webAppButton("") }
      );
    }
  } catch (e) {
    console.error("[VERIFY]", (e as Error).message);
    await ctx.reply("⚠️ Не удалось сохранить номер, попробуй ещё раз позже");
  }
});

bot.command("games",  async (ctx) => ctx.reply(GAMES_TEXT,  { parse_mode: "Markdown", reply_markup: webAppButton(GAMES_TEXT, "🎮 Играть") }));
bot.command("sale",   async (ctx) => { const t = buildSaleText(); await ctx.reply(t, { parse_mode: "Markdown", reply_markup: webAppButton(t, "🛒 Акции") }); });
bot.command("help",   async (ctx) => ctx.reply(HELP_TEXT,   { parse_mode: "Markdown", reply_markup: webAppButton(HELP_TEXT, "📋 Открыть меню") }));

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
  const subscribers = await getAllSubscribers();
  await ctx.reply(`📤 Начинаю рассылку для ${subscribers.length} подписчиков…`);
  let sent = 0, failed = 0;
  for (const { chat_id } of subscribers) {
    const ok = await sendRaw(chat_id, text, { parse_mode: "Markdown" });
    if (ok) sent++; else failed++;
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
  const birthday = `2000-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  if (!ctx.from) return;
  await setUserBirthday(ctx.from.id, birthday);
  await addSubscriber(ctx.from.id, ctx.from.username, ctx.from.first_name).catch(() => {});
  await ctx.reply(`🎂 Запомнила! Поздравлю вас ${day}.${month.padStart(2, "0")} со скидкой в день рождения 🎁`);
});

bot.on("message:text", async (ctx) => {
  if (ctx.from) {
    await addSubscriber(ctx.from.id, ctx.from.username, ctx.from.first_name).catch(() => {});
  }
  await ctx.reply(
    `✨ Откройте наш Mini App — там игры, ИИ-кондитер и все акции!`,
    { reply_markup: webAppButton("") }
  );
});

// ─── Express ─────────────────────────────────────────────────────────────────
const app = express();

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
app.use(
  helmet({
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
  })
);
app.use(cors());
app.use(express.json({ limit: "1mb" }));
// Structured request log — reqId + duration + status, /health пропускается
app.use(requestLogger());

// rateLimit и requireAdminToken вынесены в `./middleware`
// (см. волну рефакторинга #5). Импортируются ниже.

app.use(express.static(path.join(__dirname, "..", "public"), {
  setHeaders(res, filePath) {
    // HTML не кэшируем — иначе Telegram/браузер держат старый index с прежним ?v=
    // (JS/CSS версионируются через ?v= и могут кэшироваться). Свежесть кода после деплоя.
    if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
  },
}));

// Прокси логотипа
function proxyAsset(url: string, contentType: string) {
  return (_req: express.Request, res: express.Response) => {
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0" }, rejectUnauthorized: false }, (r) => {
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
  if (!name) { res.status(400).end(); return; }
  const file = path.join("/tmp", "lead_photos", name);
  res.sendFile(file, (err) => { if (err) res.status(404).end(); });
});

// ─── Image proxy ────────────────────────────────────────────────────────────
// Прокси картинок товаров с resize в WebP + дисковым кэшем + прогревом.
// Sharp превращает 1.4 MB PNG в ~80-150 KB WebP — ускоряет загрузку в 10×.
import * as fsSync from "fs";
let sharp: ((input: Buffer) => { resize: (w: number, h: number, opts?: Record<string, unknown>) => unknown; webp: (opts: Record<string, unknown>) => { toBuffer: () => Promise<Buffer> } }) | null = null;
try {
  // Динамический импорт — если sharp не установился (Render free tier), fallback на raw stream
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  sharp = require("sharp");
  console.log("[IMG] sharp loaded — resize + webp enabled");
} catch (e) {
  console.warn("[IMG] sharp not available, falling back to raw streaming:", (e as Error).message);
}

const IMG_CACHE_DIR   = path.join("/tmp", "img_cache");
const IMG_CACHE_LIMIT = 96 * 1024 * 1024; // 96 MB в памяти
const IMG_MAX_ITEM    = 3 * 1024 * 1024;  // 3 MB — крупнее не кешируем

try { fsSync.mkdirSync(IMG_CACHE_DIR, { recursive: true }); } catch {}

interface CachedImg { buf: Buffer; type: string; }
const imgCache = new Map<string, CachedImg>();
let imgCacheBytes = 0;
const inflight = new Map<string, Promise<CachedImg | null>>();

function imgKey(u: string): string {
  return require("crypto").createHash("md5").update(u).digest("hex");
}
function imgDiskGet(u: string): CachedImg | null {
  const k = imgKey(u);
  try {
    const buf  = fsSync.readFileSync(path.join(IMG_CACHE_DIR, k));
    const meta = fsSync.readFileSync(path.join(IMG_CACHE_DIR, k + ".meta"), "utf8");
    return { buf, type: meta.trim() || "image/jpeg" };
  } catch { return null; }
}
function imgDiskPut(u: string, v: CachedImg) {
  const k = imgKey(u);
  try {
    fsSync.writeFileSync(path.join(IMG_CACHE_DIR, k), v.buf);
    fsSync.writeFileSync(path.join(IMG_CACHE_DIR, k + ".meta"), v.type);
  } catch {}
}
function imgMemGet(key: string): CachedImg | null {
  const v = imgCache.get(key);
  if (!v) return null;
  imgCache.delete(key); imgCache.set(key, v);
  return v;
}
function imgMemPut(key: string, value: CachedImg) {
  if (value.buf.length > IMG_MAX_ITEM) return;
  imgCache.set(key, value);
  imgCacheBytes += value.buf.length;
  while (imgCacheBytes > IMG_CACHE_LIMIT) {
    const first = imgCache.keys().next().value;
    if (!first) break;
    const old = imgCache.get(first);
    if (old) imgCacheBytes -= old.buf.length;
    imgCache.delete(first);
  }
}

function fetchUpstream(u: string): Promise<CachedImg | null> {
  if (inflight.has(u)) return inflight.get(u)!;
  const p = new Promise<CachedImg | null>((resolve) => {
    const url = new URL(u);
    const opts: https.RequestOptions = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: { "User-Agent": "MariaBot/1.0 ImgProxy" },
      rejectUnauthorized: false,
    };
    const req = https.request(opts, (r) => {
      if ((r.statusCode ?? 0) >= 400) { r.resume(); resolve(null); return; }
      const type = String(r.headers["content-type"] ?? "image/jpeg");
      const chunks: Buffer[] = [];
      let total = 0; let oversize = false;
      r.on("data", (c: Buffer) => {
        total += c.length;
        if (total > IMG_MAX_ITEM) oversize = true;
        if (!oversize) chunks.push(c);
      });
      r.on("end", async () => {
        if (oversize || !chunks.length) { resolve(null); return; }
        let buf = Buffer.concat(chunks);
        let outType = type;
        // Sharp: ресайз до 600×750 (или меньше если оригинал меньше) и конвертация в WebP
        if (sharp) {
          try {
            const resized = await (sharp as unknown as (b: Buffer) => { resize: (w: number, h: number, o: Record<string, unknown>) => { webp: (o: Record<string, unknown>) => { toBuffer: () => Promise<Buffer> } } })(buf)
              .resize(600, 750, { fit: "inside", withoutEnlargement: true })
              .webp({ quality: 78, effort: 4 })
              .toBuffer();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            buf = resized as any;
            outType = "image/webp";
          } catch (e) {
            // fallback — отдаём оригинал
            console.warn("[IMG] resize failed:", (e as Error).message);
          }
        }
        const value: CachedImg = { buf, type: outType };
        imgMemPut(u, value);
        imgDiskPut(u, value);
        resolve(value);
      });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(20_000, () => { req.destroy(); resolve(null); });
    req.end();
  });
  inflight.set(u, p);
  p.finally(() => inflight.delete(u));
  return p;
}

async function imgGet(u: string): Promise<CachedImg | null> {
  // 1) память
  const mem = imgMemGet(u);
  if (mem) return mem;
  // 2) диск
  const disk = imgDiskGet(u);
  if (disk) { imgMemPut(u, disk); return disk; }
  // 3) upstream
  return fetchUpstream(u);
}

app.get("/img", async (req, res) => {
  const u = String(req.query.u ?? "");
  if (!/^https:\/\/(www\.)?maria-irk\.ru\/upload\//.test(u)) {
    res.status(400).end(); return;
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
  if (!v) { res.status(502).end(); return; }
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
    .map((p) => p.image!);
  console.log(`[IMG] prewarming ${urls.length} images…`);
  let done = 0;
  // Параллельно по 6 — чтобы не ддосить maria-irk.ru
  const batch = 6;
  for (let i = 0; i < urls.length; i += batch) {
    await Promise.all(urls.slice(i, i + batch).map((u) => imgGet(u).then(() => { done++; })));
  }
  console.log(`[IMG] prewarmed ${done}/${urls.length} (mem ${(imgCacheBytes/1024/1024).toFixed(1)} MB)`);
}
// Прогрев при старте — fallback на случай, если первый refreshCatalog упадёт
// (повторный прогрев после успешного refresh идёт изнутри refreshCatalog).
setTimeout(() => { prewarmImageCache().catch((e) => console.error("[IMG] prewarm failed:", e)); }, 5000);

// ─── Groq chat (agent с tool calling) ───────────────────────────────────────
import { TOOL_DEFS, runTool, ToolContext } from "./ai-tools";

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

interface GroqErr extends Error { status?: number; rateLimited?: boolean; retryAfterMs?: number; }

// Парсит «try again in 2.639s» или «try again in 160ms» из текста ошибки Groq
function parseRetryAfter(msg: string, headerVal?: string): number {
  if (headerVal) {
    const v = parseFloat(headerVal);
    if (!isNaN(v)) return Math.min(10_000, Math.ceil(v * 1000));
  }
  // ms-формат: «in 160ms»
  const ms = msg.match(/(?:try again in|retry after)\s+([\d.]+)\s*ms/i);
  if (ms) return Math.min(10_000, Math.max(100, Math.ceil(parseFloat(ms[1]))));
  // s-формат: «in 1.5s»
  const s = msg.match(/(?:try again in|retry after)\s+([\d.]+)\s*s/i);
  if (s) return Math.min(10_000, Math.ceil(parseFloat(s[1]) * 1000));
  return 0;
}

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

function groqRequest(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const opts: https.RequestOptions = {
      hostname: "api.groq.com",
      path: "/openai/v1/chat/completions",
      method: "POST",
      headers: {
        Authorization:   `Bearer ${GROQ_KEY}`,
        "Content-Type":  "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => {
        const status = r.statusCode ?? 0;
        try {
          const parsed = JSON.parse(d);
          if (status === 429 || (parsed.error?.code === "rate_limit_exceeded")) {
            const e: GroqErr = new Error(parsed.error?.message ?? `Groq rate limit (${status})`);
            e.status = status; e.rateLimited = true;
            e.retryAfterMs = parseRetryAfter(parsed.error?.message ?? "", r.headers["retry-after"] as string);
            reject(e); return;
          }
          if (status >= 500) {
            const e: GroqErr = new Error(`Groq ${status}: ${parsed.error?.message ?? "server error"}`);
            e.status = status;
            reject(e); return;
          }
          resolve(parsed);
        } catch (e) {
          const err: GroqErr = new Error(`Groq parse error (status ${status}): ${(e as Error).message}`);
          err.status = status;
          reject(err);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(45_000, () => {
      req.destroy();
      const e: GroqErr = new Error("Groq timeout (45s)");
      e.status = 0;
      reject(e);
    });
    req.write(body);
    req.end();
  });
}

// Streaming-вариант для Groq SSE. Возвращает async iterable объектов формата OpenAI delta:
// { delta: { content?, tool_calls? }, finish_reason? }
async function* groqStream(payload: Record<string, unknown>): AsyncGenerator<{
  delta: { content?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> };
  finish_reason?: string;
}, void, void> {
  const body = JSON.stringify({ ...payload, stream: true });
  const req = await new Promise<import("http").IncomingMessage>((resolve, reject) => {
    const r = https.request({
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
    r.setTimeout(60_000, () => {
      r.destroy();
      reject(Object.assign(new Error("Groq stream timeout"), { status: 0 } as GroqErr));
    });
    r.write(body);
    r.end();
  });

  // Если статус не 200 — собираем тело и кидаем как ошибку
  if ((req.statusCode ?? 0) !== 200) {
    let errBody = "";
    for await (const chunk of req) errBody += chunk.toString();
    let parsed: { error?: { message?: string; code?: string } } = {};
    try { parsed = JSON.parse(errBody); } catch {}
    const e: GroqErr = new Error(`Groq stream ${req.statusCode}: ${parsed.error?.message ?? errBody.slice(0, 200)}`);
    e.status = req.statusCode;
    if (req.statusCode === 429 || parsed.error?.code === "rate_limit_exceeded") {
      e.rateLimited = true;
      e.retryAfterMs = parseRetryAfter(parsed.error?.message ?? "", req.headers["retry-after"] as string);
    }
    throw e;
  }

  let buf = "";
  for await (const chunk of req) {
    buf += chunk.toString();
    let nl: number;
    while ((nl = buf.indexOf("\n\n")) !== -1) {
      const evt = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      // SSE event: одна или несколько строк "data: ..."
      const lines = evt.split("\n").filter((l) => l.startsWith("data:"));
      for (const line of lines) {
        const data = line.slice(5).trim();
        if (data === "[DONE]" || !data) continue;
        try {
          const parsed = JSON.parse(data);
          const choice = parsed?.choices?.[0];
          if (!choice) continue;
          yield { delta: choice.delta ?? {}, finish_reason: choice.finish_reason };
        } catch { /* skipped malformed chunk */ }
      }
    }
  }
}

// Streaming-агент: yield-ит события {type:'delta'|'tool'|'final'|'error'} для SSE
type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "tool"; name: string }
  | { type: "final"; text: string; products: Record<string, unknown>[]; cart_actions: ToolContext["cartActions"] }
  | { type: "error"; message: string };

type ChatMode = "cake" | "confessor";

// Системный prompt для основного режима (поиск/заказ торта)
function cakeSystemPrompt(catalogLen: number): string {
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
function confessorSystemPrompt(catalogLen: number): string {
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

function systemPromptFor(mode: ChatMode, catalogLen: number): string {
  return mode === "confessor" ? confessorSystemPrompt(catalogLen) : cakeSystemPrompt(catalogLen);
}

async function* chatAgentStream(
  userMessages: ChatMessage[],
  ctx: ToolContext,
  mode: ChatMode = "cake",
): AsyncGenerator<StreamEvent, void, void> {
  const system: ChatMessage = {
    role: "system",
    content: systemPromptFor(mode, ctx.catalog.length),
  };

  // Жёсткое ограничение истории — Groq free-tier 6000 TPM, длинная история убивает запрос.
  // 16 последних сообщений ~= 2000 токенов, плюс system+tools = ~2800 → влезает с запасом.
  const trimmedUser = userMessages.length > 16 ? userMessages.slice(-16) : userMessages;
  const messages: ChatMessage[] = [system, ...trimmedUser];
  const MAX_ITERATIONS = 6;

  let toolsBroken = false;
  let currentModel = "llama-3.3-70b-versatile";
  let finalText = "";
  let retried429 = false;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const sendMessages = trimHistory(messages, 20);
    const acc = { content: "", tool_calls: [] as Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> };
    let finishReason: string | undefined;

    const callStream = async function* (model: string) {
      yield* groqStream({
        model,
        max_tokens: 768,
        temperature: 0.3,
        top_p: 0.9,
        messages: sendMessages,
        ...(toolsBroken ? {} : { tools: TOOL_DEFS, tool_choice: "auto" }),
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
            if (tc.id) slot.id = tc.id;
            if (tc.function?.name) slot.function.name += tc.function.name;
            if (tc.function?.arguments) slot.function.arguments += tc.function.arguments;
          }
        }
        if (chunk.finish_reason) finishReason = chunk.finish_reason;
      }
    } catch (err) {
      const e = err as GroqErr;
      if (e.rateLimited) {
        // Стратегия:
        // 1. Если на 70b — fallback на 8b сразу (другой пул limit-ов)
        // 2. Если уже на 8b — ждём retry-after из ответа Groq и повторяем (один раз)
        if (currentModel === "llama-3.3-70b-versatile") {
          console.warn("[chatAgentStream] 70b rate-limited, fallback to 8b");
          currentModel = "llama-3.1-8b-instant";
          iter--; continue;
        }
        if (!retried429) {
          const wait = e.retryAfterMs && e.retryAfterMs > 0 ? e.retryAfterMs : 3000;
          console.warn(`[chatAgentStream] 8b rate-limited, waiting ${wait}ms and retrying`);
          await sleep(wait);
          retried429 = true;
          iter--; continue;
        }
      }
      yield { type: "error", message: e.message };
      return;
    }

    // Сохраняем accumulated assistant message в историю
    const validToolCalls = acc.tool_calls.filter((tc) => tc && tc.id && tc.function.name);
    const asstMsg: ChatMessage = { role: "assistant", content: acc.content || null };
    if (validToolCalls.length) asstMsg.tool_calls = validToolCalls;
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
    const results = await Promise.all(
      validToolCalls.map(async (tc) => {
        let args: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(tc.function.arguments || "{}");
          if (parsed && typeof parsed === "object") args = parsed;
        } catch {}
        const out = await runTool(tc.function.name, args, ctx);
        return { tool_call_id: tc.id, role: "tool" as const, name: tc.function.name, content: out };
      })
    );
    for (const tc of validToolCalls) yield { type: "tool", name: tc.function.name };
    messages.push(...results);
  }

  // MAX_ITERATIONS исчерпаны — финальный non-stream запрос без tools
  try {
    const final = await groqRequest({
      model: "llama-3.1-8b-instant",
      max_tokens: 768,
      temperature: 0.3,
      messages,
    });
    const finalChoice = (final.choices as Array<{ message: ChatMessage }>)?.[0];
    yield {
      type: "final",
      text: (finalChoice?.message?.content ?? "Извини, не получилось разобраться. Попробуй переформулировать.").trim(),
      products: [...ctx.surfacedProducts.values()],
      cart_actions: ctx.cartActions,
    };
  } catch (e) {
    yield { type: "error", message: (e as Error).message };
  }
}

// Обрезаем историю если она слишком длинная — сохраняем system + последние N пар user/assistant
// Tool messages и tool_calls идут парами, поэтому обрезаем по паре assistant→[tool…] чтобы не сломать логику
function trimHistory(messages: ChatMessage[], maxNonSystem = 16): ChatMessage[] {
  if (messages.length <= maxNonSystem + 1) return messages;
  // Сохраняем первое system-сообщение и последние maxNonSystem
  const sys = messages[0]?.role === "system" ? [messages[0]] : [];
  const tail = messages.slice(-maxNonSystem);
  // Если первый элемент tail — tool, то он сирота (не имеет соответствующего assistant с tool_calls)
  // → пропускаем, пока не дойдём до user или assistant без tool_calls
  let firstSafe = 0;
  while (firstSafe < tail.length && tail[firstSafe].role === "tool") firstSafe++;
  return [...sys, ...tail.slice(firstSafe)];
}

async function chatAgent(
  userMessages: ChatMessage[],
  ctx: ToolContext,
  mode: ChatMode = "cake",
): Promise<{ text: string; products: Record<string, unknown>[]; cart_actions: ToolContext["cartActions"] }> {
  const system: ChatMessage = {
    role: "system",
    content: systemPromptFor(mode, ctx.catalog.length),
  };

  // Жёсткое урезание истории — Groq free-tier 6000 TPM.
  // 16 последних сообщений ~= 2000 токенов, плюс system+tools = ~2800 → влезает с запасом.
  const trimmedUser = userMessages.length > 16 ? userMessages.slice(-16) : userMessages;
  const messages: ChatMessage[] = [system, ...trimmedUser];
  const MAX_ITERATIONS = 6;

  let toolsBroken = false;
  let currentModel = "llama-3.3-70b-versatile";
  let retried429 = false;
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const sendMessages = trimHistory(messages, 20);
    let response: Record<string, unknown>;
    try {
      response = await groqRequest({
        model: currentModel,
        max_tokens: 768,
        temperature: 0.3,
        top_p: 0.9,
        messages: sendMessages,
        ...(toolsBroken ? {} : { tools: TOOL_DEFS, tool_choice: "auto" }),
      });
    } catch (err) {
      const e = err as GroqErr;
      if (e.rateLimited) {
        if (currentModel === "llama-3.3-70b-versatile") {
          console.warn("[chatAgent] 70b rate-limited, fallback to 8b");
          currentModel = "llama-3.1-8b-instant";
          iter--; continue;
        }
        if (!retried429) {
          const wait = e.retryAfterMs && e.retryAfterMs > 0 ? e.retryAfterMs : 3000;
          console.warn(`[chatAgent] 8b rate-limited, waiting ${wait}ms and retrying`);
          await sleep(wait);
          retried429 = true;
          iter--; continue;
        }
      }
      throw err;
    }

    const choice = (response.choices as Array<{ message: ChatMessage; finish_reason: string }>)?.[0];
    if (!choice) {
      const err = response.error as { message?: string; type?: string } | undefined;
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
    const results = await Promise.all(
      msg.tool_calls.map(async (tc) => {
        let args: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(tc.function.arguments || "{}");
          if (parsed && typeof parsed === "object") args = parsed;
        } catch {}
        const out = await runTool(tc.function.name, args, ctx);
        return { tool_call_id: tc.id, role: "tool" as const, name: tc.function.name, content: out };
      })
    );
    messages.push(...results);
  }

  // Если за MAX_ITERATIONS не успели — финальный запрос без tools
  const final = await groqRequest({
    model: "llama-3.1-8b-instant",  // быстрый fallback — гарантированно ответит
    max_tokens: 768,
    temperature: 0.3,
    messages,
  }).catch(() => ({ choices: [] } as Record<string, unknown>));
  const finalChoice = (final.choices as Array<{ message: ChatMessage }>)?.[0];
  return {
    text: (finalChoice?.message?.content ?? "Извини, не получилось разобраться. Попробуй переформулировать.").trim(),
    products: [...ctx.surfacedProducts.values()],
    cart_actions: ctx.cartActions,
  };
}

app.post("/api/chat", rateLimit(40), async (req, res) => {
  const { messages, mode } = req.body as { messages: ChatMessage[]; mode?: string };
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages array is required" });
    return;
  }
  const chatMode: ChatMode = mode === "confessor" ? "confessor" : "cake";
  // chatId — Telegram WebApp init data; если нет — ставим 0 (анон),
  // тогда tools auth-зависимые вернут unauthorised.
  const tgUser = getTgUser(req);
  const chatId = tgUser?.id ?? 0;

  try {
    const ctx: ToolContext = {
      chatId,
      catalog,
      surfacedProducts: new Map(),
      cartActions: [],
    };
    const out = await chatAgent(messages, ctx, chatMode);
    res.json({ text: out.text, products: out.products, cart_actions: out.cart_actions });
  } catch (err) {
    const e = err as GroqErr;
    console.error(`[CHAT] err: status=${e.status} msg=${e.message}`);
    if (e.rateLimited) {
      res.status(429).json({ error: "ИИ временно занят (превышен лимит запросов). Подожди 10-20 секунд и попробуй ещё раз." });
    } else if (e.status === 0 || /timeout/i.test(e.message)) {
      res.status(504).json({ error: "ИИ не ответил вовремя. Попробуй ещё раз через минуту." });
    } else {
      res.status(502).json({ error: "ИИ временно недоступен. Попробуй через минуту или позвони +7 (3952) 50-40-80." });
    }
  }
});

// Leads (lead, lead-corporate, transcribe) вынесены в src/routes/leads.ts
app.use(leadsRouter);

// ─── Admin-only утилиты (через requireAdminToken middleware) ────────────────

// Утечка бизнес-инфы — переведено под admin-token (раньше любой видел число подписчиков)
app.get("/api/subscribers/count", requireAdminToken, async (_req, res) => {
  const subs = await getAllSubscribers();
  res.json({ count: subs.length });
});

// Рассылка через API (для будущей админ-панели)
app.post("/api/broadcast", requireAdminToken, async (req, res) => {
  const { text } = req.body as { text?: string };
  if (!text?.trim()) {
    res.status(400).json({ error: "text required" });
    return;
  }
  const subscribers = await getAllSubscribers();
  res.json({ status: "started", total: subscribers.length });
  let sent = 0, failed = 0;
  for (const { chat_id } of subscribers) {
    const ok = await sendRaw(chat_id, text, { parse_mode: "Markdown" });
    if (ok) sent++; else failed++;
    await new Promise((r) => setTimeout(r, 50));
  }
  log.info({ sent, failed, total: subscribers.length }, "[BROADCAST] done");
});

// Ручное обновление каталога (admin-only — раньше любой мог дёргать рефреш
// → нагрузка на CATALOG_API maria-irk.ru через unauth-юзеров).
app.post("/api/refresh-catalog", requireAdminToken, async (_req, res) => {
  res.json({ status: "started" });
  await refreshCatalog();
});

// Статус каталога
app.get("/api/catalog-status", rateLimit(30), (_req, res) => {
  res.json({
    count: catalog.length,
    updated: catalogAge(),
    sample: catalog.slice(0, 3),
  });
});

// User-related (me, birthday, unverify-phone, history) → src/routes/user.ts
app.use(userRouter);

// Club routes (daily, convert, redeem, rewards, my-rewards, conversion-tiers)
// вынесены в src/routes/club.ts
app.use(clubRouter);

// Game results → src/routes/game.ts
app.use(gameRouter);

// Виртуальный питомец → src/routes/pet.ts
app.use(petRouter);

// Вход maria-app через Telegram (device-flow) → src/routes/app-auth.ts
app.use("/api/app", appAuthRouter);

// Кликер «Котик Комбат» → src/routes/clicker.ts
app.use(clickerRouter);

// GET /api/holidays/upcoming вынесен в src/routes/holidays.ts
app.use(holidaysRouter);

// Админ: руками триггернуть pushHolidayPreorder (для тестов).
// Остаётся в index.ts т.к. push-функция здесь же; перенесём с push-волной.
app.post("/api/admin/holidays/push", requireAdminToken, async (_req, res) => {
  pushHolidayPreorder().catch((e) => log.error({ err: e }, "[HOLIDAY MANUAL]"));
  res.json({ ok: true, status: "scheduled" });
});

// Админ: ручной прогон пушей-возвратов «Котик Комбат» (для теста; обычно крон 17:00 Иркутск).
// Дедуп по дню действует — повторный вызов в тот же день не задвоит.
app.post("/api/admin/clicker/push", requireAdminToken, async (_req, res) => {
  try { const r = await runClickerRetentionPush(_pushService); res.json({ ok: true, ...r }); }
  catch (e) { log.error({ err: e }, "[CLICKER PUSH MANUAL]"); res.status(500).json({ error: "internal" }); }
});

// Админ: ручные триггеры напоминаний о питомце (для теста — см. pet-push.ts).
// ⚠️ Флаг PET_REMINDERS_ENABLED здесь НЕ проверяется — эти эндпоинты шлют
// пуши по-настоящему реальным кандидатам. Не дёргать вне теста.
app.post("/api/admin/pet/remind-hungry", requireAdminToken, async (_req, res) => {
  try { const r = await runPetHungryPush(_pushService); res.json({ ok: true, ...r }); }
  catch (e) { log.error({ err: e }, "[PET HUNGRY PUSH MANUAL]"); res.status(500).json({ error: "internal" }); }
});
app.post("/api/admin/pet/remind-energy", requireAdminToken, async (_req, res) => {
  try { const r = await runPetEnergyPush(_pushService); res.json({ ok: true, ...r }); }
  catch (e) { log.error({ err: e }, "[PET ENERGY PUSH MANUAL]"); res.status(500).json({ error: "internal" }); }
});

// Админ: ручные триггеры вороночных кронов (T2/T3/T4) — для теста.
// В dry-run (флаги OFF) считают и логируют, но не шлют/не начисляют.
app.post("/api/admin/funnel/expiry", requireAdminToken, async (_req, res) => {
  try { await pushExpiringPoints(); res.json({ ok: true, enabled: FUNNEL_RETENTION_ENABLED }); }
  catch (e) { log.error({ err: e }, "[FUNNEL EXPIRY MANUAL]"); res.status(500).json({ error: "internal" }); }
});
app.post("/api/admin/funnel/reactivate", requireAdminToken, async (_req, res) => {
  try { await pushReactivation(); res.json({ ok: true, enabled: FUNNEL_RETENTION_ENABLED }); }
  catch (e) { log.error({ err: e }, "[FUNNEL REACTIVATE MANUAL]"); res.status(500).json({ error: "internal" }); }
});
app.post("/api/admin/funnel/ref-orders", requireAdminToken, async (_req, res) => {
  try { await checkReferralFirstOrders(); res.json({ ok: true, enabled: FUNNEL_REF_BONUS_ENABLED }); }
  catch (e) { log.error({ err: e }, "[FUNNEL REF-ORDER MANUAL]"); res.status(500).json({ error: "internal" }); }
});

// Админ: ручное закрытие недельного сезона + пуш победителям (для теста).
app.post("/api/admin/clicker/weekly-close", requireAdminToken, async (_req, res) => {
  try { const close = await closeWeeklySeason(); const push = await pushWeeklyWinners(_pushService); res.json({ ok: true, ...close, pushed: push.sent }); }
  catch (e) { log.error({ err: e }, "[WEEKLY CLOSE MANUAL]"); res.status(500).json({ error: "internal" }); }
});

// Админ: перезагрузить data/dietary-overrides.json и переразметить in-memory каталог
// без рестарта (для оперативной коррекции false-positive)
app.post("/api/admin/dietary/reload", requireAdminToken, (_req, res) => {
  reloadDietaryOverrides();
  let tagged = 0;
  for (const p of catalog) {
    const tags = detectDietary(p);
    if (tags.length > 0) { p.dietary = tags; tagged++; }
    else { delete p.dietary; }
  }
  res.json({ ok: true, total: catalog.length, tagged });
});

// Catalog routes вынесены в src/routes/catalog.ts. Передаём getter — чтобы
// router всегда работал с актуальным in-memory массивом (refreshCatalog его
// мутирует через `catalog = ...` ниже в этом файле).
app.use(createCatalogRouter({ getCatalog: () => catalog, catalogAge }));

// ─── Reviews API ─────────────────────────────────────────────────────────────
// GET список отзывов + статистика для товара
// Reviews routes (CRUD + admin hide) вынесены в src/routes/reviews.ts.
// Передаём getter каталога — для валидации product_id при POST review.
app.use(createReviewsRouter(() => catalog));

// Wishlist (share POST + share/:code GET + sync) вынесен в src/routes/wishlist.ts
// (см. app.use(createWishlistRouter) ниже).

// Promo routes (validate + use) вынесены в src/routes/promo.ts
app.use(promoRouter);

// Cake-concept (AI-конструктор) вынесен в src/routes/cake-concept.ts
app.use(cakeConceptRouter);

// Selfie-cake (AI-портрет на торте) вынесен в src/routes/selfie-cake.ts
app.use(selfieCakeRouter);

// Wishlist (share + sync) вынесен в src/routes/wishlist.ts
app.use(createWishlistRouter(() => catalog));


// Hot-reload data/promo-codes.json без рестарта
app.post("/api/admin/promo/reload", requireAdminToken, (_req, res) => {
  const total = reloadPromoCodes();
  res.json({ ok: true, total });
});

// Order rating routes (GET + POST) вынесены в src/routes/order-rating.ts
app.use(orderRatingRouter);
app.use(orderLocationRouter);

// /api/wishlist/share/:code вынесен в src/routes/wishlist.ts
// /api/reviews/stats-batch также вынесен в src/routes/reviews.ts

// Partners (GET list + admin sync) вынесен в src/routes/partners.ts
app.use(partnersRouter);
// Secret-of-day → src/routes/secret-of-day.ts
app.use(createSecretOfDayRouter(() => catalog));
// Notification prefs → src/routes/notify-prefs.ts
app.use(notifyPrefsRouter);

// Referrals (me + use) → src/routes/referral.ts
app.use(createReferralRouter(_pushService, _dbPoolForRouters));
// Wheel + streak → src/routes/wheel-streak.ts
app.use(createWheelStreakRouter(_pushService));
// Голубятня (коллекция/обмены/почта) → src/routes/pigeons.ts
app.use(createPigeonsRouter(_pushService));
// VK Callback API (входящие события сообщества) → src/vk/callback.ts
// Без VK_CALLBACK_SECRET/VK_CONFIRMATION_CODE отвечает 404 (TG-only режим)
app.use(createVkCallbackRouter(vkSender));
// VK verify-phone (крипто-проверка sign от VKWebAppGetPhoneNumber) → src/routes/vk.ts
app.use(createVkRouter());
// /api/secret-of-day вынесен в src/routes/secret-of-day.ts (см. createSecretOfDayRouter выше)

// /api/rewards/mine также вынесен в src/routes/club.ts

// Cron-функция: каждое утро 09:00 Иркутск выбирает «секрет дня» (рекомендация)
// Никакой выдуманной скидки — discountPct = 0. Если у выбранного товара в 1С
// есть реальная скидка, фронт её покажет из каталога. Иначе — просто рекомендация.
async function rotateSecretOfDay() {
  if (catalog.length === 0) return;
  const eligibles = catalog.filter((p) =>
    ["Торты", "Пирожные и десерты", "Пироги"].includes(p.category) && p.id && (p.priceNumber ?? 0) >= 300
  );
  const pool = eligibles.length > 0 ? eligibles : catalog;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  if (pick?.id) {
    await setSecretOfDay(Number(pick.id), 0).catch((e) => console.error("[SECRET-OF-DAY]", (e as Error).message));
    console.log(`[SECRET-OF-DAY] picked id=${pick.id} "${pick.name}"`);
  }
}

// /api/notify-prefs (GET + POST) вынесены в src/routes/notify-prefs.ts

// Cart sync (для cart-abandonment push) → src/routes/cart.ts
app.use(cartRouter);

// /api/wishlist/sync (back-in-stock subscribe) вынесен в src/routes/wishlist.ts

// LK (личный кабинет с maria-irk.ru через Bitrix) вынесен в src/routes/lk.ts
app.use(lkRouter);

// Создание заказа из миниаппа — обёртка вокруг /api/order-create.php на сайте
// Auth не обязателен (юзер может ввести phone руками); если есть verified TG user —
// можем подтянуть verified phone и привязать chatId в комментарии
// ─── Ring buffer для отладки последних 20 попыток заказа ────────────────────
interface OrderAttempt {
  ts: string;
  tg: number | null;
  body: { phone?: string; name?: string; itemsCount?: number; itemIds?: number[]; hasAddress?: boolean; hasComment?: boolean; useVerifiedPhone?: boolean };
  outcome: "validation_error" | "php_error" | "success" | "exception";
  status: number;
  error?: string;
  message?: string;
  orderId?: number;
  phpRaw?: string;
}
const ORDER_LOG: OrderAttempt[] = [];
function logOrderAttempt(a: OrderAttempt) {
  ORDER_LOG.push(a);
  if (ORDER_LOG.length > 20) ORDER_LOG.shift();
}
/** Маскирует телефон для логов (ПДн): оставляет только последние 4 цифры. */
function maskPhone(p: string | undefined | null): string {
  return p ? String(p).replace(/\d(?=\d{4})/g, "*") : "-";
}

app.get("/api/_debug-orders", (req, res) => {
  if (!process.env.ORDER_TOKEN || !safeEq(String(req.query.token ?? ""), process.env.ORDER_TOKEN)) {
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
function translateOrderError(err: string | undefined): string {
  const map: Record<string, string> = {
    bad_json:              "Неверный формат данных. Попробуйте ещё раз.",
    forbidden:             "Сервер отказал в обработке (токен).",
    method_not_allowed:    "Метод не поддерживается.",
    module_unavailable:    "Модуль магазина временно недоступен.",
    missing_fields:        "Не заполнены обязательные поля.",
    bad_phone:             "Неверный номер телефона. Укажите 10-значный российский номер.",
    no_valid_items:        "Товары не найдены или сняты с продажи. Обновите корзину.",
    order_insert_failed:   "Не удалось сохранить заказ в базе. Попробуйте через минуту.",
    basket_insert_failed:  "Не удалось сохранить позиции корзины. Попробуйте через минуту.",
    order_api_not_configured: "Сервис заказов не настроен. Свяжитесь с поддержкой.",
    timeout:               "Сайт не ответил вовремя. Попробуйте через минуту.",
  };
  return map[err ?? ""] ?? `Не удалось создать заказ. Позвоните +7 (3952) 50-40-80 для оформления.`;
}

app.post("/api/order", rateLimit(15), async (req, res) => {
  const tg = tryGetUser(req); // optional, без блокировки (AppUser: platform + platformId)
  const body = req.body as Partial<OrderRequest> & { useVerifiedPhone?: boolean };

  let phone = String(body.phone ?? "").trim();
  let lkData: Record<string, unknown> | null = null;
  if (tg?.id) {
    // Если юзер просил использовать привязанный телефон или не ввёл вручную —
    // подставляем подтверждённый номер из subscribers (источник правды).
    if (body.useVerifiedPhone || !phone) {
      const verified = await getVerifiedPhone(tg.id).catch(() => null);
      if (verified) phone = verified;
    }
    try {
      const lk = await fetchLk(tg.id);
      lkData = lk.ok ? (lk.data as unknown as Record<string, unknown>) : null;
    } catch {}
  }

  const items = Array.isArray(body.items)
    ? body.items.filter((i) => i && Number(i.id) > 0 && Number(i.qty) > 0)
        .map((i) => ({ id: Number(i.id), qty: Number(i.qty) }))
    : [];

  // Снимок body для логирования (без чувствительных данных)
  const bodySnap = {
    phone:          phone || undefined,
    name:           body.name ? String(body.name) : undefined,
    itemsCount:     items.length,
    itemIds:        items.slice(0, 10).map((i) => i.id),
    hasAddress:     !!body.address,
    hasComment:     !!body.comment,
    useVerifiedPhone: !!body.useVerifiedPhone,
  };
  const ts = new Date().toISOString();
  const baseAttempt: OrderAttempt = { ts, tg: tg?.id ?? null, body: bodySnap, outcome: "validation_error", status: 0 };

  console.log(`[ORDER] req: phone=${maskPhone(phone)} items=${items.length} ids=${JSON.stringify(bodySnap.itemIds)} tg=${tg?.id || '-'}`);

  // Валидация телефона: после очистки от не-цифр должно быть 10+ цифр
  const phoneDigits = phone.replace(/\D/g, "");
  if (!phone || phoneDigits.length < 10) {
    const r = { ok: false, error: "phone_required", message: "Укажите телефон (минимум 10 цифр, например 9149094916 или +79149094916)" };
    logOrderAttempt({ ...baseAttempt, status: 400, error: r.error, message: r.message });
    res.status(400).json(r);
    return;
  }
  if (!body.name) {
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
  const ctx: string[] = [];
  if (body.comment) ctx.push(`Комментарий: ${body.comment}`);
  if (tg?.id) {
    // ⚠️ Наружу (менеджеру в Bitrix) — только родной id платформы, не internal
    const displayName = [tg.first_name, tg.last_name].filter(Boolean).join(" ") || null;
    if (tg.platform === "vk") {
      ctx.push(`VK: id=${tg.platformId} · vk.com/id${tg.platformId}${displayName ? ` · ${displayName}` : ""}`);
    } else {
      const tgInfo = [
        tg.username ? `@${tg.username}` : null,
        `id=${tg.platformId}`,
        displayName,
      ].filter(Boolean).join(" · ");
      ctx.push(`Telegram: ${tgInfo}`);
    }
  } else {
    ctx.push("Mini App: гость (не залогинен)");
  }
  if (lkData) {
    if (lkData.configured) {
      const name  = lkData.name  ? `${lkData.name}` : "";
      const level = lkData.level ? `· ${lkData.level}` : "";
      ctx.push(`Программа лояльности: ${name} ${level}`.trim());
      if (lkData.balance != null)    ctx.push(`Баланс баллов: ${lkData.balance}`);
      if (lkData.year_spent != null) ctx.push(`Потрачено за год: ${Number(lkData.year_spent).toLocaleString("ru-RU")} ₽`);
      const tCount = Number(lkData.tickets_count ?? 0);
      if (tCount > 0) ctx.push(`Сладкий чек: ${tCount} билет${tCount === 1 ? "" : tCount < 5 ? "а" : "ов"}`);
      const orderCount = Array.isArray(lkData.orders) ? lkData.orders.length : 0;
      if (orderCount > 0) ctx.push(`История покупок на сайте: ${orderCount} заказ${orderCount === 1 ? "" : orderCount < 5 ? "а" : "ов"}`);
    } else {
      ctx.push("На сайте maria-irk.ru с этим телефоном клиент не зарегистрирован");
    }
  }
  // Локальный баланс бота (звёзды/очки за игры/рефералов)
  if (tg?.id) {
    try {
      const bal = await getBalance(tg.id);
      if (bal.stars > 0 || bal.points > 0) {
        ctx.push(`Бот-бонусы: ${bal.points} очков · ${bal.stars} звёзд (всего заработано: ${bal.totalEarnedPoints} очков · ${bal.totalEarnedStars} звёзд)`);
      }
    } catch {}
    // Подтверждение телефона через бот
    try {
      const verified = await isPhoneVerified(tg.id);
      if (verified) ctx.push("✓ Телефон подтверждён через Mini App");
    } catch {}
    // История взаимодействия с ботом: дата регистрации, запуски, последний заход
    try {
      const info = await getSubscriberInfo(tg.id);
      if (info) {
        const fmt = (iso: string | null) => {
          if (!iso) return "—";
          const d = new Date(iso);
          return d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
        };
        const reg  = info.joined_at    ? `Регистрация в Mini App: ${fmt(info.joined_at)}`        : null;
        const last = info.last_seen_at ? `последний заход: ${fmt(info.last_seen_at)}`            : null;
        const cnt  = info.launch_count > 0 ? `запусков: ${info.launch_count}`                    : null;
        const line = [reg, cnt, last].filter(Boolean).join(" · ");
        if (line) ctx.push(line);
      }
    } catch {}
    // Накопленные награды с колеса/streak — добавляем в комментарий и помечаем used
    try {
      const rewards = await getUnusedRewards(tg.id);
      if (rewards.length > 0) {
        const REWARD_LABEL: Record<string, (v: string) => string> = {
          discount_coupon: (v) => `🎫 Купон -${v}%`,
          points:          (v) => `💎 +${v} баллов`,
          free_eclair:     () => "🍫 Бесплатный эклер (при заказе от 800 ₽)",
          double_points:   () => "✨ ×2 баллов на этот заказ",
          sweet_ticket:    () => "🎟 +1 билет в Sweet Check",
          cake_month_10:   () => "🎂 Торт месяца -10%",
          free_dessert:    () => "🍰 Бесплатный десерт (streak 7 дней)",
        };
        const lines = rewards.map((r) => {
          const fn = REWARD_LABEL[r.kind];
          return fn ? fn(r.value) : `🎁 ${r.kind}`;
        });
        ctx.push(`Накопленные награды (применить):\n• ${lines.join("\n• ")}`);
      }
    } catch {}
  }
  const richComment = ctx.join("\n");

  // Имена/цены позиций из кэша каталога — для B24-fallback, когда шлюз сайта лежит
  // (обычный путь берёт их из ответа PHP, fallback-путь иначе показал бы «Товар #id»)
  const itemsInfo = items.map((i) => {
    const p = catalog.find((c) => c.id === i.id);
    return { id: i.id, name: p?.name ?? `Товар #${i.id}`, price: p?.priceNumber ?? 0, qty: i.qty };
  });

  const result = await createOrder({
    phone,
    name:          String(body.name).trim(),
    platform:      tg?.platform,
    items,
    address:       body.address       ? String(body.address).trim()       : undefined,
    delivery_date: body.delivery_date ? String(body.delivery_date).trim() : undefined,
    delivery_time: body.delivery_time ? String(body.delivery_time).trim() : undefined,
    comment:       richComment,
    email:         body.email         ? String(body.email).trim()         : undefined,
  }, itemsInfo);

  if (!result.ok) {
    console.error(`[ORDER] PHP error: ${result.error} for phone=${maskPhone(phone)} items=${JSON.stringify(bodySnap.itemIds)}`);
    const userMsg = translateOrderError(result.error);
    logOrderAttempt({ ...baseAttempt, outcome: "php_error", status: 502, error: result.error, message: userMsg });
    res.status(502).json({ ok: false, error: result.error ?? "order_failed", message: userMsg });
    return;
  }
  console.log(`[ORDER] created ${result.leadOnly ? "B24-lead (сайт недоступен)" : `#${result.orderId}`} for ${maskPhone(phone)}`);
  logOrderAttempt({ ...baseAttempt, outcome: "success", status: 200, orderId: result.orderId });

  // Корзина превратилась в заказ — снимаем snapshot чтобы не пушить abandonment
  if (tg?.id) {
    clearCartSnapshot(tg.id).catch(() => {});
    // Атомарно консьюмим все награды (они уже в richComment, теперь mark used_at=NOW())
    consumeRewards(tg.id).catch(() => {});
  }

  // Push confirmation в TG-чат (если есть chat_id юзера)
  // `tg` уже объявлен выше через tryGetTgUser(req)
  if (tg?.id) {
    const itemsLine = items.slice(0, 3).map((it) => `${it.qty}× #${it.id}`).join(", ");
    const moreLine = items.length > 3 ? ` +${items.length - 3}` : "";
    const dateLine = body.delivery_date && body.delivery_time
      ? `\n📅 ${body.delivery_date} · ${body.delivery_time}`
      : "";
    const addrLine = body.address ? `\n📍 ${String(body.address).slice(0, 80)}` : "";
    const msg = `✅ *Заявка ${result.orderId ? `№${result.orderId} ` : ""}принята!*

🛒 ${itemsLine}${moreLine}${dateLine}${addrLine}

Менеджер позвонит для подтверждения в течение 1 часа.
_Узнать статус: напишите боту_`;
    sendRaw(tg.id, withAppLinkForVk(tg.id, msg), { parse_mode: "Markdown" }).then((ok) => {
      if (!ok) console.warn(`[ORDER push] failed for chat ${tg.id}`);
    });

    // Если есть delivery_date — schedule напоминание за 2 часа до
    if (body.delivery_date && body.delivery_time) {
      try {
        const [dd, mm, yyyy] = String(body.delivery_date).split(".");
        const [hh] = String(body.delivery_time).split(":");
        if (dd && mm && yyyy && hh) {
          const target = new Date(`${yyyy}-${mm.padStart(2,"0")}-${dd.padStart(2,"0")}T${hh.padStart(2,"0")}:00:00+08:00`);
          const reminderTime = target.getTime() - 2 * 60 * 60 * 1000;
          const delay = reminderTime - Date.now();
          if (delay > 0 && delay < 30 * 24 * 60 * 60 * 1000) { // только если в пределах 30 дней
            setTimeout(() => {
              sendRaw(tg.id, `🔔 Через 2 часа ваш заказ №${result.orderId} будет готов!\n\n${body.delivery_time} · ${body.delivery_date}`).catch(() => {});
            }, delay);
          }
        }
      } catch {}
    }
  }

  res.json(result);
});

// /api/partners/sync вынесен в src/routes/partners.ts

// Прокси к /api/shops.php на сайте — миниапп получает реальные адреса
const SHOPS_API   = process.env.SHOPS_API   ?? "";
const SHOPS_TOKEN = process.env.SHOPS_TOKEN ?? process.env.LK_TOKEN ?? "";
let _shopsCache: { data: unknown; ts: number } | null = null;
// Hardcoded coords для известных адресов кафе Мария.
// Если адрес содержит ключевое слово — подставляем уточнённые координаты.
// Fallback: центр города (Иркутск/Ангарск).
const CAFE_COORDS_LOOKUP: { match: RegExp; lat: number; lon: number }[] = [
  // Иркутск — Центр
  { match: /ленина[, ]*1\b/i,                lat: 52.2766, lon: 104.2806 },
  { match: /карла маркса[, ]*24/i,           lat: 52.2802, lon: 104.2843 },
  { match: /партизанск/i,                    lat: 52.2858, lon: 104.2762 },
  { match: /верхн.+набереж/i,                lat: 52.2826, lon: 104.2752 },
  { match: /рабочая[, ]*2/i,                 lat: 52.2826, lon: 104.2796 },
  { match: /баррикад/i,                      lat: 52.3022, lon: 104.2611 },
  { match: /карла либкнехта/i,               lat: 52.2849, lon: 104.2785 },
  { match: /советская/i,                     lat: 52.2870, lon: 104.2920 },
  { match: /декабрист/i,                     lat: 52.2724, lon: 104.3013 },
  // Иркутск — Свердловский / Юбилейный / Студгородок
  { match: /юбилейн.+5[06]|юбилейный[, ]*56/i, lat: 52.2400, lon: 104.2540 },
  { match: /дьяконов/i,                      lat: 52.2381, lon: 104.2553 },
  { match: /жукова[, ]*11/i,                 lat: 52.2683, lon: 104.2444 },
  { match: /терешковой/i,                    lat: 52.2530, lon: 104.2620 },
  // Иркутск — Октябрьский / Байкальская
  { match: /байкальская[, ]*141/i,           lat: 52.2900, lon: 104.3322 },
  { match: /байкальская[, ]*105/i,           lat: 52.2728, lon: 104.3128 },
  { match: /байкальская[, ]*295/i,           lat: 52.3122, lon: 104.3658 },
  { match: /байкальская/i,                   lat: 52.2900, lon: 104.3322 }, // fallback
  // Иркутск — Куйбышевский (Ржанова, Зелёный)
  { match: /ржанова/i,                       lat: 52.3083, lon: 104.2950 },
  // Ангарск
  { match: /ангарск/i,                       lat: 52.5333, lon: 103.9000 },
  { match: /18 микрорайон|микрорайон.+19/i,  lat: 52.5358, lon: 103.8987 },
];
const IRKUTSK_CENTER  = { lat: 52.286, lon: 104.305 };
const ANGARSK_CENTER  = { lat: 52.535, lon: 103.900 };

function enrichShopCoords(s: Record<string, unknown>): Record<string, unknown> {
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
function bundledShops(): { count: number; shops: unknown[] } | null {
  try {
    const raw = fsSync.readFileSync(path.join(__dirname, "..", "data", "shops.json"), "utf-8");
    const data = JSON.parse(raw) as { shops?: unknown[] };
    const shops = Array.isArray(data.shops)
      ? data.shops.map((s) => enrichShopCoords(s as Record<string, unknown>))
      : [];
    return { count: shops.length, shops };
  } catch {
    return null;
  }
}

app.get("/api/shops", rateLimit(60), async (_req, res) => {
  // Кеш 1 час (общий для апстрима и фолбэка)
  if (_shopsCache && (Date.now() - _shopsCache.ts) < 3600_000) {
    res.json(_shopsCache.data);
    return;
  }
  // 1) Сайтовый шлюз, если настроен и жив
  if (SHOPS_API && SHOPS_TOKEN) {
    try {
      const sep = SHOPS_API.includes("?") ? "&" : "?";
      const url = `${SHOPS_API}${sep}token=${encodeURIComponent(SHOPS_TOKEN)}`;
      const raw = await new Promise<unknown>((resolve, reject) => {
        const req = https.get(url, { rejectUnauthorized: false }, (r) => {
          let body = ""; r.on("data", (c: Buffer) => body += c);
          r.on("end", () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
        });
        req.on("error", reject);
        req.setTimeout(10_000, () => { req.destroy(); reject(new Error("Timeout")); });
      });
      const data = raw as { shops?: unknown[]; count?: number };
      if (Array.isArray(data?.shops) && data.shops.length > 0) {
        data.shops = data.shops.map((s) => enrichShopCoords(s as Record<string, unknown>));
        _shopsCache = { data, ts: Date.now() };
        res.json(data);
        return;
      }
      console.warn("[SHOPS] upstream empty — using bundled fallback");
    } catch (e) {
      console.warn("[SHOPS] upstream failed — using bundled fallback:", (e as Error).message);
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
app.post("/api/admin/shops/reload", requireAdminToken, (_req, res) => {
  _shopsCache = null;
  res.json({ ok: true, cleared: true });
});

// Sweet Check (недели + призы) вынесены в src/routes/sweet-check.ts
app.use(sweetCheckRouter);

app.get("/health", (_req, res) =>
  res.json({ status: "ok", catalog: catalog.length, partners: getPartnersMeta() })
);

// Версия билда — для верификации, что новый код задеплоился
app.get("/version", (_req, res) =>
  res.json({
    version: process.env.npm_package_version ?? "unknown",
    commit: process.env.RENDER_GIT_COMMIT ?? "local",
    features: ["rich-order-comment", "subscriber-stats", "phone-verified-mark", "b24-productrows", "rich-items-list"],
  })
);


// ─── Запуск ──────────────────────────────────────────────────────────────────
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`[BOT ERROR] update_id=${ctx.update.update_id}`);
  console.error(`  type: ${err.constructor.name}`);
  console.error(`  message: ${err.message}`);
  if ((err as any).stack) console.error(err.stack);
});

async function sendBirthdayGreetings() {
  const users = await getTodayBirthdays();
  for (const { chat_id, first_name } of users) {
    const name = first_name ? `, ${first_name}` : "";
    const ok = await sendRaw(
      chat_id,
      withAppLinkForVk(chat_id, `🎂 С днём рождения${name}!\n\nКондитерская «Мария» поздравляет вас и дарит скидку:\n🎁 *−5% вам* и *−10% детям* (действует ±5 дней от дня рождения)\n\nПриходите порадовать себя сладким! 🍰`),
      { parse_mode: "Markdown" }
    );
    if (ok) {
      await markBirthdayNotified(chat_id).catch(() => {});
      console.log(`[BIRTHDAY] Поздравили chat_id=${chat_id}`);
    } else {
      console.error(`[BIRTHDAY] Не доставлено chat_id=${chat_id}`);
    }
  }
}

async function main() {
  await initDb();
  await initClubSchema();
  await initPetSchema();
  await initClickerSchema();
  await initPigeonSchema();
  await initAnalyticsSchema();
  await initClickerPushSchema();
  await initBonusSchema();
  await initAppAuthSchema();
  startBonusWorker();

  // Sentry error handler — после всех routes, до listen
  app.use(sentryExpressErrorHandler());

  log.info({
    botToken: BOT_TOKEN ? "set" : "MISSING",
    groqKey: GROQ_KEY ? "set" : "MISSING",
    webhookUrl: WEBHOOK_URL || "(empty — long polling)",
    port: PORT,
    previewMode: PREVIEW_MODE,
    sentry: process.env.SENTRY_DSN ? "enabled" : "disabled",
  }, "startup");

  // Ежедневные поздравления с днём рождения в 10:00 по Иркутску (UTC+8 = 02:00 UTC)
  cron.schedule("0 2 * * *", () => {
    sendBirthdayGreetings().catch((e) => console.error("[BIRTHDAY CRON]", e));
  });
  console.log("[STARTUP] Birthday cron scheduled (daily 10:00 Irkutsk)");

  // Pre-order push к ближайшим праздникам — каждое утро 10:30 Иркутск (02:30 UTC).
  // Запуск после birthday cron, чтоб день рождения не конкурировал с праздничным пушем.
  cron.schedule("30 2 * * *", () => {
    pushHolidayPreorder().catch((e) => console.error("[HOLIDAY CRON]", e));
  });
  console.log(`[STARTUP] Holiday pre-order cron scheduled (daily 10:30 Irkutsk; ${HOLIDAYS.length} holidays tracked)`);

  // Post-order rating prompts — каждый час дёргает «Оцени заказ» для тех, у кого
  // заказ завершён 2-72 часа назад и rating ещё не отправлен.
  cron.schedule("47 * * * *", () => {
    pushOrderRatingPrompts().catch((e) => console.error("[RATING-PROMPT CRON]", e));
  });
  console.log("[STARTUP] Order rating-prompt cron scheduled (hourly)");

  // Order status cron — каждые 30 минут проверяет смены статусов у verified юзеров
  cron.schedule("*/30 * * * *", () => {
    checkOrderStatusChanges().catch((e) => console.error("[ORDER STATUS CRON]", e));
  });
  console.log("[STARTUP] Order-status cron scheduled (every 30 min)");

  // Cart abandonment cron — каждый час шлёт пуш юзерам с забытой корзиной >24h
  cron.schedule("23 * * * *", () => {
    pushCartAbandonments().catch((e) => log.error({ err: e }, "[CART ABANDON CRON]"));
  });
  console.log("[STARTUP] Cart-abandonment cron scheduled (hourly)");

  // Пуши-возвраты «Котик Комбат» — раз в день 17:00 Иркутск (09:00 UTC).
  // 1 игровой пуш/день/игрок: серия под угрозой (приоритет) или «энергия полная».
  cron.schedule("0 9 * * *", () => {
    runClickerRetentionPush(_pushService).catch((e) => log.error({ err: e }, "[CLICKER PUSH CRON]"));
  });
  console.log("[STARTUP] Clicker retention-push cron scheduled (daily 17:00 Irkutsk)");

  // Напоминание «Василий проголодался» — ежедневно 19:00 Иркутск (11:00 UTC).
  // За флагом PET_REMINDERS_ENABLED: выключен ⇒ тик молча выходит (без похода в БД
  // и без лога на каждый тик — состояние флага уже залогировано один раз ниже).
  cron.schedule("0 11 * * *", () => {
    if (!PET_REMINDERS_ENABLED) return;
    runPetHungryPush(_pushService).catch((e) => log.error({ err: e }, "[PET HUNGRY CRON]"));
  });
  // Напоминание «Энергия восстановилась» — каждые 30 минут (:13 и :43, разнесено
  // от других получасовых/часовых кронов, чтобы не пересекаться по нагрузке).
  cron.schedule("13,43 * * * *", () => {
    if (!PET_REMINDERS_ENABLED) return;
    runPetEnergyPush(_pushService).catch((e) => log.error({ err: e }, "[PET ENERGY CRON]"));
  });
  console.log(`[STARTUP] Pet reminder crons scheduled (hungry=19:00 Irkutsk, energy=every 30min; enabled=${PET_REMINDERS_ENABLED})`);

  // Воронка T2 — «баллы сгорают»: ежедневно 11:00 Иркутск (03:00 UTC).
  cron.schedule("0 3 * * *", () => {
    pushExpiringPoints().catch((e) => log.error({ err: e }, "[FUNNEL EXPIRY CRON]"));
  });
  // Воронка T3 — реактивация «Василий скучает»: ежедневно 12:00 Иркутск (04:00 UTC).
  cron.schedule("0 4 * * *", () => {
    pushReactivation().catch((e) => log.error({ err: e }, "[FUNNEL REACTIVATE CRON]"));
  });
  // Воронка T4 — реф-бонус за первый заказ приглашённого: каждый час :37.
  cron.schedule("37 * * * *", () => {
    checkReferralFirstOrders().catch((e) => log.error({ err: e }, "[FUNNEL REF-ORDER CRON]"));
  });
  console.log(`[STARTUP] Funnel MVP crons scheduled (retention=${FUNNEL_RETENTION_ENABLED} ref-bonus=${FUNNEL_REF_BONUS_ENABLED}; OFF=dry-run)`);

  // Закрытие недельного сезона «Котик Комбат» — понедельник 00:02 Иркутск (вс 16:02 UTC),
  // ДО обнуления week_base активными игроками. Фиксирует топ-3 + начисляет призы.
  cron.schedule("2 16 * * 0", () => {
    closeWeeklySeason().catch((e) => log.error({ err: e }, "[WEEKLY CLOSE CRON]"));
    // Гонка стаи финиширует вс, закрытие пн 00:02 = сразу после — та же тактовая точка.
    if (RACE_ENABLED) closeRaceWeek().catch((e) => log.error({ err: e }, "[RACE CLOSE CRON]"));
  });
  console.log(`[STARTUP] Weekly-season close cron scheduled (Mon 00:02 Irkutsk; race=${RACE_ENABLED})`);

  // Голубиная почта: возврат эскроу протухших офферов доски — ежедневно 00:10 Иркутск
  // (16:10 UTC). Помимо ленивого expireTrades() при чтении доски (getTradeBoard),
  // гарантирует возврат даже тем, кто доску не открывает.
  cron.schedule("10 16 * * *", () => {
    expireTrades().catch((e) => log.error({ err: e }, "[PIGEON TRADES EXPIRE CRON]"));
  });
  console.log("[STARTUP] Pigeon-trades expire cron scheduled (daily 00:10 Irkutsk)");

  // Пуш победителям недели — понедельник 10:00 Иркутск (02:00 UTC), не в тихие часы.
  cron.schedule("0 2 * * 1", () => {
    pushWeeklyWinners(_pushService).catch((e) => log.error({ err: e }, "[WEEKLY PUSH CRON]"));
  });
  console.log("[STARTUP] Weekly-winners push cron scheduled (Mon 10:00 Irkutsk)");

  // Secret-of-day cron — каждое утро 09:00 Иркутск (UTC 01:00) выбирает товар
  cron.schedule("0 1 * * *", () => {
    rotateSecretOfDay().catch((e) => console.error("[SECRET-OF-DAY CRON]", e));
  });
  // Запустить при старте если ещё не задано на сегодня
  setTimeout(() => {
    getSecretOfDay().then((s) => {
      if (!s) return rotateSecretOfDay();
    }).catch(() => {});
  }, 8000);
  console.log("[STARTUP] Secret-of-day cron scheduled (09:00 Иркутск)");

  // Партнёры — синк с Bitrix раз в час (если PARTNERS_API задан)
  if (process.env.PARTNERS_API) {
    syncPartners().catch((e) => log.error({ err: e }, "[PARTNERS] startup sync"));
    cron.schedule("17 * * * *", () => {
      syncPartners().catch((e) => log.error({ err: e }, "[PARTNERS CRON]"));
    });
    console.log("[STARTUP] Partners cron scheduled (hourly)");
  } else {
    console.log("[STARTUP] PARTNERS_API not set — partners served from data/partners.json");
  }

  if (PREVIEW_MODE) {
    // Staging preview: только Express, без TG-webhook и без bot.start().
    // Mini App + API работают; команды бота и push'и — нет (Telegram отвергнет
    // вызовы с dummy-токеном, ошибки проглатываются существующими try/catch).
    app.listen(PORT, () => console.log(`🚀 Preview server on port ${PORT} (no Telegram bot)`));
  } else if (WEBHOOK_URL) {
    const webhookPath = `/webhook/${BOT_TOKEN}`;
    app.use(webhookPath, webhookCallback(bot, "express"));
    app.listen(PORT, async () => {
      try {
        await bot.api.setWebhook(`${WEBHOOK_URL}${webhookPath}`);
        const info = await bot.api.getWebhookInfo();
        console.log(`[STARTUP] Webhook set: ${info.url}`);
        if (info.last_error_message) {
          console.error(`[WEBHOOK] Last error: ${info.last_error_message} (${new Date((info.last_error_date ?? 0) * 1000).toISOString()})`);
        }
        console.log(`🚀 Server on port ${PORT} | Webhook set`);
      } catch (e) {
        log.error({ err: e }, "[STARTUP] Failed to set webhook");
      }
    });
  } else {
    app.listen(PORT, () => console.log(`🚀 Server on port ${PORT} (long polling)`));
    try {
      await bot.start();
    } catch (e) {
      log.error({ err: e }, "[STARTUP] bot.start() failed");
      throw e;
    }
  }
}

main().catch((err) => {
  log.fatal({ err }, "fatal startup error");
  // Даём Sentry время отправить event, потом exit
  setTimeout(() => process.exit(1), 500);
});

// Также ловим unhandled rejections / uncaught exceptions глобально
process.on("unhandledRejection", (reason) => {
  log.error({ err: reason }, "unhandledRejection");
});
process.on("uncaughtException", (err) => {
  log.error({ err }, "uncaughtException");
});

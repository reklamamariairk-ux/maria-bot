import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import https from "https";
import cron from "node-cron";
import { Bot, webhookCallback, InlineKeyboard } from "grammy";
import { scrapeCatalog, loadCatalog, searchCatalog, catalogAge, fetchProductById, Product } from "./scraper";
import { initDb, addSubscriber, getAllSubscribers, setUserBirthday, getTodayBirthdays, markBirthdayNotified, touchSubscriber, getSubscriberInfo, wishlistSync, getWishlistSubsForProducts, getOrCreateReferralCode, recordReferralUse, getOrderStatusMap, setOrderStatus, canSendNotification, logNotification, NotificationKind, getNotificationPrefs, setNotificationPrefs, saveCartSnapshot, clearCartSnapshot, getAbandonedCarts, markCartAbandonedPushed } from "./db";
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
  recordReferral,
  CONVERSION_TIERS,
} from "./club";
import { requireTgUser, getTgUser, tryGetTgUser } from "./auth";
import { getPartners, getPartnersMeta, syncPartners } from "./partners";
import { fetchLk, getVerifiedPhone } from "./lk";
import { createOrder, OrderRequest } from "./order";

// ─── Env ────────────────────────────────────────────────────────────────────
const BOT_TOKEN    = process.env.BOT_TOKEN    ?? "";
const GROQ_KEY     = process.env.GROQ_KEY     ?? "";
const WEBHOOK_URL  = process.env.WEBHOOK_URL  ?? "";
const PORT         = Number(process.env.PORT  ?? 3000);
const MINI_APP_URL = process.env.MINI_APP_URL ?? WEBHOOK_URL;
const ADMIN_IDS    = (process.env.ADMIN_IDS ?? "").split(",").map(Number).filter(Boolean);

if (!BOT_TOKEN) throw new Error("BOT_TOKEN is required");
if (!GROQ_KEY)  throw new Error("GROQ_KEY is required");

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
    const list = products.map((p) => `• ${p.name} — ${Number(p.price).toLocaleString("ru-RU")} ₽`).join("\n");
    const msg = `🎂 *Снова в наличии*\n\n${list}\n\nЗабери, пока есть — открой Mini App.`;
    const ok = await sendPushSafely(chatId, "marketing_rewards", msg);
    if (ok) sent++;
  }
  if (sent > 0) console.log(`[WISHLIST] notified ${sent} subscribers about ${productIds.length} new product(s)`);
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
    const ok = await sendPushSafely(snap.chat_id, "marketing_promo", msg);
    if (ok) sent++;
    // Помечаем как pushed чтобы не дёргать повторно
    await markCartAbandonedPushed(snap.chat_id).catch(() => {});
  }
  if (sent > 0) console.log(`[CART ABANDON] notified ${sent} subscribers`);
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
      // Если терминальный статус — больше не отслеживаем (но запись остаётся в DB)
      if (isTerminalStatus(status)) {
        // optional: можно удалять старые записи cleanup-кроном, но не критично
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
setInterval(refreshCatalog, 60 * 60 * 1000);

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
}
setInterval(runCleanup, 6 * 60 * 60 * 1000); // каждые 6 часов
setTimeout(runCleanup, 5 * 60 * 1000);       // первая через 5 минут после старта

// ─── Telegram Bot ───────────────────────────────────────────────────────────
const bot = new Bot(BOT_TOKEN);

// Smart-notification wrapper — учитывает quiet hours, weekly quota, daily quota
async function sendPushSafely(
  chatId: number,
  kind: NotificationKind,
  text: string,
  opts?: { parse_mode?: "Markdown" | "HTML" }
): Promise<boolean> {
  const gate = await canSendNotification(chatId, kind).catch(() => ({ ok: false, reason: "db_error" }));
  if (!gate.ok) {
    console.log(`[push skipped] ${chatId} · ${kind} · ${gate.reason}`);
    return false;
  }
  try {
    await bot.api.sendMessage(chatId, text, { parse_mode: opts?.parse_mode ?? "Markdown" });
    await logNotification(chatId, kind).catch(() => {});
    return true;
  } catch (e) {
    const msg = (e as Error).message || "";
    if (!/blocked|forbidden|chat not found/i.test(msg)) {
      console.warn(`[push] ${chatId} ${kind}:`, msg);
    }
    return false;
  }
}

function webAppButton(_text: string, label = "🍰 Открыть Mini App") {
  return new InlineKeyboard().webApp(label, MINI_APP_URL || "https://t.me");
}

const WELCOME = `
👋 Добро пожаловать в кондитерскую *«Мария»*!

Здесь вы можете:
🎮 Поиграть в наши сладкие игры
🤖 Поговорить с ИИ-кондитером
🛒 Узнать об акциях и заказать сладости

Нажмите кнопку ниже, чтобы открыть Mini App 👇
`.trim();

const GAMES_TEXT = `
🎮 *Игры в Mini App*

🃏 *Мемори* — переворачивай карточки со сладостями и находи пары
🎂 *Flappy Cake* — лети сквозь препятствия и набирай очки

Нажми кнопку и играй прямо сейчас! 🎁
`.trim();

const SALE_TEXT = `
🌟 *Акции*

🎂 *Торт месяца* — скидка 20%, доставка от 1 000 ₽ бесплатно
🎁 Фирменная коробка с лентой — бесплатно к любому заказу
🧾 *Лотерея «Сладкий чек»* — каждый чек = шанс на iPhone 17 Pro Max, MacBook, PS5 Slim

Подробнее на сайте maria-irk.ru ⏳
`.trim();

const HELP_TEXT = `
📞 *Контакты кондитерской «Мария»*

📍 17 кафе в Иркутске + точки в Ангарске
🕐 Уточняйте часы работы на сайте
📱 +7 (3952) 50-40-80
🌐 maria-irk.ru

Пишите — ответим быстро! 💌
`.trim();

bot.command("start", async (ctx) => {
  if (ctx.from) {
    await addSubscriber(ctx.from.id, ctx.from.username, ctx.from.first_name).catch(() => {});

    // Referral payload: /start ref_12345 (старая схема) или /start ref_MARIA-XXX (новая)
    const payload = ctx.match?.trim();
    if (payload && payload.startsWith("ref_")) {
      const rest = payload.slice(4);
      if (/^MARIA-/i.test(rest)) {
        // Code-based реферал
        const r = await recordReferralUse(ctx.from.id, rest).catch(() => null);
        if (r?.ok && r.ownerChat) {
          const userName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || "Новый друг";
          await bot.api.sendMessage(
            r.ownerChat,
            `🎉 *${userName}* пришёл по твоему коду \`${rest.toUpperCase()}\`!\n\nКогда он сделает первый заказ, вы оба получите *200 ₽*.`,
            { parse_mode: "Markdown" }
          ).catch(() => {});
        }
      } else {
        const referrerId = Number(rest);
        if (referrerId && referrerId !== ctx.from.id) {
          await recordReferral(referrerId, ctx.from.id).catch(() => {});
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
  try {
    const result = await verifyPhone(ctx.from.id, c.phone_number);
    if (result.alreadyVerified) {
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
bot.command("sale",   async (ctx) => ctx.reply(SALE_TEXT,   { parse_mode: "Markdown", reply_markup: webAppButton(SALE_TEXT, "🛒 Акции") }));
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
    try {
      await bot.api.sendMessage(chat_id, text, { parse_mode: "Markdown" });
      sent++;
    } catch {
      failed++;
    }
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

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ─── Rate limit ─────────────────────────────────────────────────────────────
// Простой sliding window per-IP: разные лимиты для разных эндпоинтов.
const rateBuckets = new Map<string, number[]>();
function rateLimit(maxPerMinute: number) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
    const key = `${ip}:${req.path}`;
    const now = Date.now();
    const win = 60_000;
    const arr = (rateBuckets.get(key) || []).filter((t) => now - t < win);
    if (arr.length >= maxPerMinute) {
      res.status(429).json({ ok: false, error: "rate_limited", message: "Слишком много запросов. Подожди минуту." });
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

app.use(express.static(path.join(__dirname, "..", "public")));

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
// Запуск прогрева когда каталог готов (через 5 сек после старта)
setTimeout(() => { prewarmImageCache().catch((e) => console.error("[IMG] prewarm failed:", e)); }, 5000);
// И повторно после каждого обновления каталога
const _origRefresh = refreshCatalog;
(global as Record<string, unknown>).__refreshCatalogPatched = false;

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

async function* chatAgentStream(
  userMessages: ChatMessage[],
  ctx: ToolContext,
): AsyncGenerator<StreamEvent, void, void> {
  const system: ChatMessage = {
    role: "system",
    content: `Ты — Маша, тёплый AI-помощник кондитерской «Мария» в Иркутске. Каталог: ${ctx.catalog.length} товаров.

КОНТАКТЫ: maria-irk.ru, +7 (3952) 50-40-80, 17 кафе. Клуб «Мария для своих»: кэшбэк 5–10%, бонусы до 30%, ДР-скидка −5/−10%. Сладкий чек: лотерея на iPhone 17, MacBook, PS5.

ИНСТРУМЕНТЫ:
- search_products(query, contains?, exclude?) — поиск. Ищет по name, filling, cake_type, preview. Используй contains для точного матча.
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
4. У нас НЕТ: торты с мармеладом, без яиц, веганские, без глютена. Безе содержит белок (это тоже яйца).
5. Цена = price (итог со скидкой). Если discountPercent>0, упомяни: «1 856 ₽ (–20%, было 2 320 ₽)».
6. Если первый search не нашёл — попробуй другие слова/contains. До 3 попыток.

СТИЛЬ: дружелюбный, на «ты», как помощник в любимом кафе. 1-2 эмодзи, 2-5 предложений, русский. Не корпоративно («мы нашли») — обращайся лично («посмотри, нашла два»). UI рендерит карточки товаров — НЕ вставляй ссылки/картинки текстом, описывай выбор словами. Можно **жирным** выделять важное (название/цену).`,
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
): Promise<{ text: string; products: Record<string, unknown>[]; cart_actions: ToolContext["cartActions"] }> {
  const system: ChatMessage = {
    role: "system",
    content: `Ты — Маша, тёплый AI-помощник кондитерской «Мария» в Иркутске. Каталог: ${ctx.catalog.length} товаров.

КОНТАКТЫ: maria-irk.ru, +7 (3952) 50-40-80, 17 кафе. Клуб «Мария для своих»: кэшбэк 5–10%, бонусы до 30%, ДР-скидка −5/−10%. Сладкий чек: лотерея на iPhone 17, MacBook, PS5.

ИНСТРУМЕНТЫ:
- search_products(query, contains?, exclude?) — поиск. Ищет по name, filling, cake_type, preview. Используй contains для точного матча.
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
4. У нас НЕТ: торты с мармеладом, без яиц, веганские, без глютена. Безе содержит белок (это тоже яйца).
5. Цена = price (итог со скидкой). Если discountPercent>0, упомяни: «1 856 ₽ (–20%, было 2 320 ₽)».
6. Если первый search не нашёл — попробуй другие слова/contains. До 3 попыток.

СТИЛЬ: дружелюбный, на «ты», как помощник в любимом кафе. 1-2 эмодзи, 2-5 предложений, русский. Не корпоративно («мы нашли») — обращайся лично («посмотри, нашла два»). UI рендерит карточки товаров — НЕ вставляй ссылки/картинки текстом, описывай выбор словами. Можно **жирным** выделять важное (название/цену).`,
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
  const { messages } = req.body as { messages: ChatMessage[] };
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages array is required" });
    return;
  }
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
    const out = await chatAgent(messages, ctx);
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

// Voice input: принимает WebM/MP4/WAV blob от MediaRecorder, пересылает в Groq Whisper.
// Возвращает {text}. Клиент вставляет текст в input-поле, пользователь правит/отправляет.
app.post("/api/transcribe",
  rateLimit(20),
  express.raw({ type: ["audio/*", "application/octet-stream"], limit: "6mb" }),
  async (req, res) => {
    const audio = req.body as Buffer;
    if (!Buffer.isBuffer(audio) || audio.length === 0) {
      res.status(400).json({ error: "audio body required" });
      return;
    }
    if (audio.length > 5 * 1024 * 1024) {
      res.status(413).json({ error: "audio too large (>5MB)" });
      return;
    }
    // Определяем расширение по Content-Type
    const ct = String(req.headers["content-type"] || "audio/webm");
    const ext = /mp4|m4a/i.test(ct) ? "m4a" : /ogg/i.test(ct) ? "ogg" : /wav/i.test(ct) ? "wav" : "webm";

    try {
      const fd = new FormData();
      // Blob поддерживается в Node 18+ глобально
      fd.append("file", new Blob([audio], { type: ct }), `voice.${ext}`);
      fd.append("model", "whisper-large-v3-turbo");
      fd.append("language", "ru");
      fd.append("response_format", "json");
      fd.append("temperature", "0");

      const resp = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${GROQ_KEY}` },
        body: fd,
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.error(`[TRANSCRIBE] Groq ${resp.status}: ${errText.slice(0, 200)}`);
        if (resp.status === 429) {
          res.status(429).json({ error: "Распознавание временно недоступно (лимит). Попробуй через минуту." });
        } else {
          res.status(502).json({ error: "Распознавание не удалось. Попробуй ещё раз или напиши текстом." });
        }
        return;
      }

      const data = await resp.json() as { text?: string };
      const text = (data.text ?? "").trim();
      res.json({ text });
    } catch (e) {
      console.error("[TRANSCRIBE] error:", (e as Error).message);
      res.status(500).json({ error: "Ошибка распознавания. Попробуй ещё раз." });
    }
  }
);

// SSE-стриминг чата: тот же формат, что /api/chat, но события приходят постепенно.
// Клиент: fetch -> ReadableStream reader -> парсит "data: ..." и аппендит chunk-и в bubble.
app.post("/api/chat-stream", rateLimit(40), async (req, res) => {
  const { messages } = req.body as { messages: ChatMessage[] };
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages array is required" });
    return;
  }
  const tgUser = getTgUser(req);
  const chatId = tgUser?.id ?? 0;

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  // Heartbeat: каждые 15с пинг-комментарий, чтобы прокси не закрыли соединение
  const heartbeat = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 15_000);

  const ctx: ToolContext = {
    chatId,
    catalog,
    surfacedProducts: new Map(),
    cartActions: [],
  };

  try {
    for await (const ev of chatAgentStream(messages, ctx)) {
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
      if (ev.type === "final" || ev.type === "error") break;
    }
  } catch (err) {
    const e = err as GroqErr;
    console.error(`[CHAT-STREAM] err: status=${e.status} msg=${e.message}\nstack=${e.stack}`);
    const userMsg = e.rateLimited
      ? "ИИ временно занят (лимит). Подожди 10-20 секунд."
      : `ИИ временно недоступен (${e.message?.slice(0, 100) || "unknown"}).`;
    try { res.write(`data: ${JSON.stringify({ type: "error", message: userMsg })}\n\n`); } catch {}
  } finally {
    clearInterval(heartbeat);
    try { res.end(); } catch {}
  }
});

// ─── Bitrix24 lead ───────────────────────────────────────────────────────────
const BITRIX_WEBHOOK = process.env.BITRIX_WEBHOOK ?? "";

// Заявка на индивидуальный торт (форма «На заказ» — менеджер свяжется)
app.post("/api/lead", rateLimit(10), express.json({ limit: "8mb" }), async (req, res) => {
  const { name, phone, description, date, portions, comment, photo } = req.body as {
    name?: string; phone?: string; description?: string;
    date?: string; portions?: string; comment?: string; photo?: string;
  };

  if (!name || !phone) {
    res.status(400).json({ error: "Имя и телефон обязательны" });
    return;
  }

  // Если есть фото-референс (data:image/jpeg;base64,...) — сохраняем в /tmp с уникальным именем,
  // в COMMENTS лида пишем ссылку для менеджера.
  let photoUrl = "";
  if (photo && photo.startsWith("data:image/")) {
    try {
      const m = photo.match(/^data:image\/(\w+);base64,(.+)$/);
      if (m) {
        const ext = m[1] === "jpeg" ? "jpg" : m[1];
        const buf = Buffer.from(m[2], "base64");
        if (buf.length < 4 * 1024 * 1024) {
          const id = require("crypto").randomBytes(8).toString("hex");
          const dir = path.join("/tmp", "lead_photos");
          fsSync.mkdirSync(dir, { recursive: true });
          const fname = `${Date.now()}_${id}.${ext}`;
          fsSync.writeFileSync(path.join(dir, fname), buf);
          photoUrl = `${process.env.MINI_APP_URL || ""}/lead-photo/${fname}`.replace(/^\//, "https://maria-bot-6182.onrender.com/");
        }
      }
    } catch (e) { console.warn("[LEAD] photo save failed:", (e as Error).message); }
  }

  const title = `Заказ торта — ${name} (Telegram Mini App)`;
  const comments = [
    description && `Торт: ${description}`,
    date        && `Дата: ${date}`,
    portions    && `Порций: ${portions}`,
    comment     && `Комментарий: ${comment}`,
    photoUrl    && `Фото референса: ${photoUrl}`,
  ].filter(Boolean).join("\n");

  if (!BITRIX_WEBHOOK) {
    console.warn("[ORDER] BITRIX_WEBHOOK not set, lead not created");
    res.json({ ok: true, warn: "no_webhook" });
    return;
  }

  try {
    const body = JSON.stringify({
      fields: {
        TITLE: title,
        NAME: name,
        PHONE: [{ VALUE: phone, VALUE_TYPE: "WORK" }],
        COMMENTS: comments,
        SOURCE_ID: "WEB",
      },
    });

    await new Promise<void>((resolve, reject) => {
      const url = new URL(`${BITRIX_WEBHOOK}crm.lead.add.json`);
      const opts: https.RequestOptions = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      };
      const r = https.request(opts, (resp) => {
        let d = "";
        resp.on("data", (c) => (d += c));
        resp.on("end", () => {
          const json = JSON.parse(d);
          if (json.error) reject(new Error(json.error_description ?? json.error));
          else resolve();
        });
      });
      r.on("error", reject);
      r.write(body);
      r.end();
    });

    console.log(`[ORDER] Lead created: ${title}`);
    res.json({ ok: true });
  } catch (e) {
    console.error("[ORDER] Bitrix24 error:", (e as Error).message);
    res.status(502).json({ error: "Не удалось создать заявку, попробуйте позже" });
  }
});

// ─── Магазины ────────────────────────────────────────────────────────────────
const STORES: { id: number; name: string }[] = [];

app.get("/api/stores", (_req, res) => {
  res.json(STORES);
});

// ─── Статистика подписчиков ───────────────────────────────────────────────────
app.get("/api/subscribers/count", async (_req, res) => {
  const subs = await getAllSubscribers();
  res.json({ count: subs.length });
});

// ─── Рассылка через API (для будущей админ-панели) ────────────────────────────
app.post("/api/broadcast", async (req, res) => {
  const { token, text } = req.body as { token?: string; text?: string };
  if (!token || token !== process.env.ADMIN_TOKEN) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (!text?.trim()) {
    res.status(400).json({ error: "text required" });
    return;
  }
  const subscribers = await getAllSubscribers();
  res.json({ status: "started", total: subscribers.length });
  let sent = 0, failed = 0;
  for (const { chat_id } of subscribers) {
    try {
      await bot.api.sendMessage(chat_id, text, { parse_mode: "Markdown" });
      sent++;
    } catch { failed++; }
    await new Promise((r) => setTimeout(r, 50));
  }
  console.log(`[BROADCAST] sent=${sent} failed=${failed}`);
});

// Ручное обновление каталога (для отладки)
app.post("/api/refresh-catalog", async (_req, res) => {
  res.json({ status: "started" });
  await refreshCatalog();
});

// Статус каталога
app.get("/api/catalog-status", (_req, res) => {
  res.json({
    count: catalog.length,
    updated: catalogAge(),
    sample: catalog.slice(0, 3),
  });
});

// ─── Club / Loyalty API ──────────────────────────────────────────────────────

// День рождения юзера — для UI показа карточки-приглашения
import { pool as _dbPool } from "./db";
async function getUserBirthday(chatId: number): Promise<string | null> {
  try {
    const { rows } = await _dbPool.query(`SELECT birthday FROM user_birthdays WHERE chat_id = $1`, [chatId]);
    return rows[0]?.birthday ? String(rows[0].birthday).slice(0, 10) : null;
  } catch { return null; }
}

app.post("/api/birthday", requireTgUser, async (req, res) => {
  const u = getTgUser(req)!;
  const body = req.body as { birthday?: string };
  const bday = String(body.birthday ?? "").trim();
  // Принимаем yyyy-mm-dd (input type=date)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bday)) {
    res.status(400).json({ ok: false, error: "Неверный формат даты" });
    return;
  }
  try {
    await setUserBirthday(u.id, bday);
    res.json({ ok: true });
  } catch (e) {
    console.error("[BIRTHDAY]", (e as Error).message);
    res.status(500).json({ ok: false, error: "Не получилось сохранить" });
  }
});

app.get("/api/me", requireTgUser, async (req, res) => {
  const u = getTgUser(req)!;
  try {
    await touchSubscriber(u.id, u.username, u.first_name).catch(() => {});
    const [verified, balance, daily, myRewards, birthday, subInfo, phone] = await Promise.all([
      isPhoneVerified(u.id),
      getBalance(u.id),
      getDailyStatus(u.id),
      getMyRewards(u.id),
      getUserBirthday(u.id),
      getSubscriberInfo(u.id),
      getVerifiedPhone(u.id),
    ]);
    // Маскируем телефон: +7 (***) ***-12-34 — показываем только последние 4 цифры
    let phoneMasked: string | null = null;
    if (phone) {
      const digits = phone.replace(/\D/g, "");
      if (digits.length >= 11) {
        const last4 = digits.slice(-4);
        phoneMasked = `+7 (***) ***-${last4.slice(0,2)}-${last4.slice(2)}`;
      }
    }
    res.json({
      user: { id: u.id, first_name: u.first_name, username: u.username },
      phoneVerified: verified,
      phoneMasked,
      balance,
      daily,
      activeRewards: myRewards.length,
      birthday,
      joinedAt: subInfo?.joined_at ?? null,
      launchCount: subInfo?.launch_count ?? 0,
    });
  } catch (e) {
    console.error("[API /me]", (e as Error).message);
    res.status(500).json({ error: "internal" });
  }
});

app.post("/api/verify-phone", requireTgUser, async (req, res) => {
  const u = getTgUser(req)!;
  const { phone } = req.body as { phone?: string };
  if (!phone || phone.replace(/\D/g, "").length < 10) {
    res.status(400).json({ error: "bad_phone" });
    return;
  }
  try {
    const result = await verifyPhone(u.id, phone);
    const balance = await getBalance(u.id);
    res.json({ ok: true, ...result, balance });
  } catch (e) {
    console.error("[API /verify-phone]", (e as Error).message);
    res.status(500).json({ error: "internal" });
  }
});

// Отвязать телефон — обнуляем phone_verified_at и phone
app.post("/api/unverify-phone", requireTgUser, async (req, res) => {
  const u = getTgUser(req)!;
  try {
    const { pool } = await import("./db");
    await pool.query(
      `UPDATE subscribers SET phone = NULL, phone_verified_at = NULL WHERE chat_id = $1`,
      [u.id]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("[API /unverify-phone]", (e as Error).message);
    res.status(500).json({ error: "internal" });
  }
});

app.post("/api/daily/claim", requireTgUser, async (req, res) => {
  const u = getTgUser(req)!;
  try {
    if (!(await isPhoneVerified(u.id))) {
      res.status(403).json({ error: "phone_not_verified" });
      return;
    }
    const result = await claimDailyLogin(u.id);
    const balance = await getBalance(u.id);
    res.json({ ...result, balance });
  } catch (e) {
    console.error("[API /daily/claim]", (e as Error).message);
    res.status(500).json({ error: "internal" });
  }
});

app.get("/api/conversion-tiers", (_req, res) => {
  res.json(CONVERSION_TIERS);
});

app.post("/api/convert", requireTgUser, async (req, res) => {
  const u = getTgUser(req)!;
  const { stars } = req.body as { stars?: number };
  if (typeof stars !== "number") {
    res.status(400).json({ error: "bad_stars" });
    return;
  }
  try {
    const result = await convertStars(u.id, stars);
    const balance = await getBalance(u.id);
    res.json({ ...result, balance });
  } catch (e) {
    console.error("[API /convert]", (e as Error).message);
    res.status(500).json({ error: "internal" });
  }
});

app.get("/api/rewards", async (_req, res) => {
  try {
    const items = await getRewardsCatalog();
    res.json(items);
  } catch (e) {
    console.error("[API /rewards]", (e as Error).message);
    res.status(500).json({ error: "internal" });
  }
});

app.post("/api/redeem", requireTgUser, async (req, res) => {
  const u = getTgUser(req)!;
  const { rewardId } = req.body as { rewardId?: number };
  if (typeof rewardId !== "number") {
    res.status(400).json({ error: "bad_reward_id" });
    return;
  }
  try {
    if (!(await isPhoneVerified(u.id))) {
      res.status(403).json({ error: "phone_not_verified" });
      return;
    }
    const result = await redeemReward(u.id, rewardId);
    const balance = await getBalance(u.id);
    res.json({ ...result, balance });
  } catch (e) {
    console.error("[API /redeem]", (e as Error).message);
    res.status(500).json({ error: "internal" });
  }
});

app.get("/api/my-rewards", requireTgUser, async (req, res) => {
  const u = getTgUser(req)!;
  try {
    const items = await getMyRewards(u.id);
    res.json(items);
  } catch (e) {
    console.error("[API /my-rewards]", (e as Error).message);
    res.status(500).json({ error: "internal" });
  }
});

app.post("/api/game-result", requireTgUser, async (req, res) => {
  const u = getTgUser(req)!;
  const { game, score } = req.body as { game?: string; score?: number };
  if (!game || typeof score !== "number" || score < 0) {
    res.status(400).json({ error: "bad_input" });
    return;
  }
  if (!["flappy_cake", "memory", "bakery"].includes(game)) {
    res.status(400).json({ error: "unknown_game" });
    return;
  }
  try {
    if (!(await isPhoneVerified(u.id))) {
      res.json({ starsAwarded: 0, recordBeaten: false, recordBonus: 0, capped: false, gated: true });
      return;
    }
    const result = await recordGameResult(u.id, game, score);
    const balance = await getBalance(u.id);
    res.json({ ...result, balance });
  } catch (e) {
    console.error("[API /game-result]", (e as Error).message);
    res.status(500).json({ error: "internal" });
  }
});

app.get("/api/history", requireTgUser, async (req, res) => {
  const u = getTgUser(req)!;
  try {
    const rows = await getHistory(u.id, 30);
    res.json(rows);
  } catch (e) {
    console.error("[API /history]", (e as Error).message);
    res.status(500).json({ error: "internal" });
  }
});

// ─── Catalog API ─────────────────────────────────────────────────────────────
app.get("/api/catalog/categories", (_req, res) => {
  const counts = new Map<string, number>();
  for (const p of catalog) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  const categories = Array.from(counts.entries()).map(([name, count]) => {
    const sample = catalog.find((p) => p.category === name && p.image);
    return { name, count, sample: sample?.image ?? null };
  });
  res.json({ categories, total: catalog.length, updated: catalogAge() });
});

// ВАЖНО: НЕ фильтруем по available. В Bitrix available:false ставится для
// заказных тортов («Торт под заказ Подарок» и пр.) — их физически нет в кафе,
// но они доступны под заказ. Скрывать их нельзя.
app.get("/api/catalog/products", (req, res) => {
  const category = String(req.query.category ?? "").trim();
  const limit = Math.min(Number(req.query.limit ?? 30), 100);
  const offset = Number(req.query.offset ?? 0);

  let filtered = catalog.slice();
  if (category) filtered = filtered.filter((p) => p.category === category);

  const products = filtered.slice(offset, offset + limit);
  res.json({ products, total: filtered.length, limit, offset });
});

app.get("/api/catalog/search", (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) {
    res.json({ products: [], total: 0 });
    return;
  }
  const products = searchCatalog(catalog, q, 30);
  res.json({ products, total: products.length });
});

app.get("/api/catalog/product/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "bad_id" }); return; }
  const product = await fetchProductById(id);
  if (!product) { res.status(404).json({ error: "not_found" }); return; }
  res.json({ product });
});

// ─── Partners ────────────────────────────────────────────────────────────────
app.get("/api/partners", (_req, res) => {
  res.json({ partners: getPartners(), meta: getPartnersMeta() });
});

// ─── Referrals ──────────────────────────────────────────────────────────────
app.get("/api/referral/me", requireTgUser, async (req, res) => {
  const u = getTgUser(req)!;
  try {
    const code = await getOrCreateReferralCode(u.id, u.first_name);
    const used = await _dbPool.query(
      `SELECT COUNT(*)::int AS used FROM referral_uses WHERE code = $1`,
      [code]
    );
    res.json({ code, used: used.rows[0]?.used ?? 0, share_url: `https://t.me/mariatortik_bot?start=ref_${code}` });
  } catch (e) {
    console.error("[referral/me]", (e as Error).message);
    res.status(500).json({ error: "internal" });
  }
});

app.post("/api/referral/use", requireTgUser, async (req, res) => {
  const u = getTgUser(req)!;
  const code = String(req.body?.code ?? "").trim().toUpperCase();
  if (!code) {
    res.status(400).json({ error: "code_required" });
    return;
  }
  try {
    const r = await recordReferralUse(u.id, code);
    if (!r.ok) {
      res.status(400).json({ error: r.reason });
      return;
    }
    // Уведомляем владельца кода
    if (r.ownerChat) {
      const userName = [u.first_name, u.last_name].filter(Boolean).join(" ") || "Новый друг";
      bot.api.sendMessage(
        r.ownerChat,
        `🎉 *${userName}* пришёл по твоему коду \`${code}\`!\n\nКогда он сделает первый заказ, вы оба получите *200 ₽* на бонусный счёт.`,
        { parse_mode: "Markdown" }
      ).catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("[referral/use]", (e as Error).message);
    res.status(500).json({ error: "internal" });
  }
});

// ─── Notification preferences ───────────────────────────────────────────────
app.get("/api/notify-prefs", requireTgUser, async (req, res) => {
  const u = getTgUser(req)!;
  try {
    const prefs = await getNotificationPrefs(u.id);
    res.json(prefs);
  } catch {
    res.status(500).json({ error: "internal" });
  }
});

app.post("/api/notify-prefs", requireTgUser, async (req, res) => {
  const u = getTgUser(req)!;
  const body = req.body as { marketing_promo?: boolean; marketing_rewards?: boolean };
  const prefs: { marketing_promo?: boolean; marketing_rewards?: boolean } = {};
  if (typeof body.marketing_promo === "boolean") prefs.marketing_promo = body.marketing_promo;
  if (typeof body.marketing_rewards === "boolean") prefs.marketing_rewards = body.marketing_rewards;
  try {
    await setNotificationPrefs(u.id, prefs);
    const fresh = await getNotificationPrefs(u.id);
    res.json(fresh);
  } catch {
    res.status(500).json({ error: "internal" });
  }
});

// ─── Cart sync (для abandonment push) ────────────────────────────────────────
app.post("/api/cart/sync", requireTgUser, async (req, res) => {
  const u = getTgUser(req)!;
  const body = req.body as { items?: Array<{ id: number; qty: number; price?: number; name?: string }> };
  const items = Array.isArray(body.items) ? body.items.filter((i) => i && Number(i.id) > 0 && Number(i.qty) > 0) : [];
  try {
    if (items.length === 0) {
      await clearCartSnapshot(u.id);
    } else {
      const totalSum = items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
      await saveCartSnapshot(u.id, items, totalSum);
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "internal" });
  }
});

// ─── Wishlist subscriptions (для уведомления «снова в наличии») ─────────────
app.post("/api/wishlist/sync", requireTgUser, async (req, res) => {
  const u = getTgUser(req)!;
  const ids = Array.isArray(req.body?.ids)
    ? (req.body.ids as unknown[]).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  try {
    await wishlistSync(u.id, ids);
    res.json({ ok: true, count: ids.length });
  } catch (e) {
    console.error("[wishlist/sync]", (e as Error).message);
    res.status(500).json({ error: "internal" });
  }
});

// ─── LK (Личный кабинет на сайте) ────────────────────────────────────────────
app.get("/api/lk", requireTgUser, async (req, res) => {
  const u = getTgUser(req)!;
  try {
    const result = await fetchLk(u.id);
    if (!result.ok) {
      const code = result.reason === "phone_not_verified" ? 403 : 502;
      res.status(code).json({ error: result.reason });
      return;
    }
    res.json(result.data);
  } catch (e) {
    console.error("[API /lk]", (e as Error).message);
    res.status(500).json({ error: "internal" });
  }
});

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

app.get("/api/_debug-orders", (req, res) => {
  if ((req.query.token ?? "") !== process.env.ORDER_TOKEN) {
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
  const tg = tryGetTgUser(req); // optional, без блокировки
  const body = req.body as Partial<OrderRequest> & { useVerifiedPhone?: boolean };

  let phone = String(body.phone ?? "").trim();
  let lkData: Record<string, unknown> | null = null;
  if (tg?.id) {
    try {
      const lk = await fetchLk(tg.id);
      lkData = lk.ok ? (lk.data as unknown as Record<string, unknown>) : null;
      if ((body.useVerifiedPhone || !phone) && lkData?.configured && lkData.phone) {
        phone = String(lkData.phone);
      }
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

  console.log(`[ORDER] req: phone=${phone || '-'} name=${body.name || '-'} items=${items.length} ids=${JSON.stringify(bodySnap.itemIds)} tg=${tg?.id || '-'}`);

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
    const tgInfo = [
      tg.username ? `@${tg.username}` : null,
      `id=${tg.id}`,
      [tg.first_name, tg.last_name].filter(Boolean).join(" ") || null,
    ].filter(Boolean).join(" · ");
    ctx.push(`Telegram: ${tgInfo}`);
  } else {
    ctx.push("Telegram: гость (не залогинен в Mini App)");
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
  }
  const richComment = ctx.join("\n");

  const result = await createOrder({
    phone,
    name:          String(body.name).trim(),
    items,
    address:       body.address       ? String(body.address).trim()       : undefined,
    delivery_date: body.delivery_date ? String(body.delivery_date).trim() : undefined,
    delivery_time: body.delivery_time ? String(body.delivery_time).trim() : undefined,
    comment:       richComment,
    email:         body.email         ? String(body.email).trim()         : undefined,
  });

  if (!result.ok) {
    console.error(`[ORDER] PHP error: ${result.error} for phone=${phone} items=${JSON.stringify(bodySnap.itemIds)}`);
    const userMsg = translateOrderError(result.error);
    logOrderAttempt({ ...baseAttempt, outcome: "php_error", status: 502, error: result.error, message: userMsg });
    res.status(502).json({ ok: false, error: result.error ?? "order_failed", message: userMsg });
    return;
  }
  console.log(`[ORDER] created #${result.orderId} for ${phone}`);
  logOrderAttempt({ ...baseAttempt, outcome: "success", status: 200, orderId: result.orderId });

  // Корзина превратилась в заказ — снимаем snapshot чтобы не пушить abandonment
  if (tg?.id) {
    clearCartSnapshot(tg.id).catch(() => {});
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
    const msg = `✅ *Заявка №${result.orderId} принята!*

🛒 ${itemsLine}${moreLine}${dateLine}${addrLine}

Менеджер позвонит для подтверждения в течение 1 часа.
_Узнать статус: напишите боту_`;
    bot.api.sendMessage(tg.id, msg, { parse_mode: "Markdown" }).catch((e) => {
      console.warn(`[ORDER push] failed for chat ${tg.id}:`, (e as Error).message);
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
              bot.api.sendMessage(tg.id, `🔔 Через 2 часа ваш заказ №${result.orderId} будет готов!\n\n${body.delivery_time} · ${body.delivery_date}`).catch(() => {});
            }, delay);
          }
        }
      } catch {}
    }
  }

  res.json(result);
});

app.post("/api/partners/sync", async (req, res) => {
  const { token } = req.body as { token?: string };
  if (!token || token !== process.env.ADMIN_TOKEN) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const result = await syncPartners();
  res.json(result);
});

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

app.get("/api/shops", async (_req, res) => {
  if (!SHOPS_API || !SHOPS_TOKEN) {
    res.status(503).json({ count: 0, shops: [], error: "shops_api_not_configured" });
    return;
  }
  // Кеш 1 час
  if (_shopsCache && (Date.now() - _shopsCache.ts) < 3600_000) {
    res.json(_shopsCache.data);
    return;
  }
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
    // Обогащаем shops координатами
    const data = raw as { shops?: unknown[]; count?: number };
    if (Array.isArray(data?.shops)) {
      data.shops = data.shops.map((s) => enrichShopCoords(s as Record<string, unknown>));
    }
    _shopsCache = { data, ts: Date.now() };
    res.json(data);
  } catch (e) {
    console.error("[SHOPS]", (e as Error).message);
    res.status(502).json({ count: 0, shops: [], error: "fetch_failed" });
  }
});

// Sweet Check — активная неделя/квест
// Расписание зеркально с сайта. Админ Maria сможет править даты в этом месте.
const SWEET_CHECK_WEEKS = [
  { from: "2026-04-13", to: "2026-04-19", name: "Неделя 4 · Старт",        task: "Купи набор «Семейный»", reward: "5 билетов" },
  { from: "2026-04-20", to: "2026-04-26", name: "Неделя 5 · Сезон ягод",   task: "Купи 2 пирога с ягодной начинкой", reward: "5 билетов" },
  { from: "2026-04-27", to: "2026-05-03", name: "Неделя 6 · Капкейки",     task: "Купи 4 капкейка любых вкусов", reward: "5 билетов" },
  { from: "2026-05-04", to: "2026-05-10", name: "Неделя 7 · Подарок другу",task: "Купи бенто-торт + капкейк или десерт в стакане", reward: "5 билетов" },
  { from: "2026-05-11", to: "2026-05-17", name: "Неделя 8",                task: "Уточняется в кафе", reward: "5 билетов" },
  { from: "2026-05-18", to: "2026-05-24", name: "Неделя 9",                task: "Уточняется в кафе", reward: "5 билетов" },
  { from: "2026-05-25", to: "2026-05-31", name: "Неделя 10",               task: "Уточняется в кафе", reward: "5 билетов" },
  { from: "2026-06-01", to: "2026-06-07", name: "Неделя 11",               task: "Уточняется в кафе", reward: "5 билетов" },
  { from: "2026-06-08", to: "2026-06-14", name: "Неделя 12",               task: "Уточняется в кафе", reward: "5 билетов" },
  { from: "2026-06-15", to: "2026-06-21", name: "Неделя 13",               task: "Уточняется в кафе", reward: "5 билетов" },
  { from: "2026-06-22", to: "2026-06-28", name: "Неделя 14",               task: "Уточняется в кафе", reward: "5 билетов" },
  { from: "2026-06-29", to: "2026-07-05", name: "Неделя 15 · Финал Q2",    task: "Уточняется в кафе", reward: "5 билетов" },
];
app.get("/api/sweet-check/active", (_req, res) => {
  const now = new Date().toISOString().slice(0, 10);
  const active = SWEET_CHECK_WEEKS.find((w) => w.from <= now && now <= w.to) ?? null;
  const next   = SWEET_CHECK_WEEKS.find((w) => w.from > now) ?? null;
  const fmt = (d: string) => {
    const [y, m, dd] = d.split("-");
    return `${dd}.${m}.${y}`;
  };
  res.json({
    active: active ? { ...active, dates: `${fmt(active.from)} — ${fmt(active.to)}` } : null,
    next:   next   ? { ...next,   dates: `${fmt(next.from)} — ${fmt(next.to)}` }     : null,
    period: { from: SWEET_CHECK_WEEKS[0]?.from, to: SWEET_CHECK_WEEKS.at(-1)?.to },
  });
});

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
    try {
      const name = first_name ? `, ${first_name}` : "";
      await bot.api.sendMessage(
        chat_id,
        `🎂 С днём рождения${name}!\n\nКондитерская «Мария» поздравляет вас и дарит скидку:\n🎁 *−5% вам* и *−10% детям* (действует ±5 дней от дня рождения)\n\nПриходите порадовать себя сладким! 🍰`,
        { parse_mode: "Markdown" }
      );
      await markBirthdayNotified(chat_id);
      console.log(`[BIRTHDAY] Поздравили chat_id=${chat_id}`);
    } catch (e) {
      console.error(`[BIRTHDAY] Ошибка для chat_id=${chat_id}:`, (e as Error).message);
    }
  }
}

async function main() {
  await initDb();
  await initClubSchema();

  console.log(`[STARTUP] BOT_TOKEN=${BOT_TOKEN ? "set" : "MISSING"}`);
  console.log(`[STARTUP] GROQ_KEY=${GROQ_KEY ? "set" : "MISSING"}`);
  console.log(`[STARTUP] WEBHOOK_URL=${WEBHOOK_URL || "(empty — long polling)"}`);
  console.log(`[STARTUP] PORT=${PORT}`);

  // Ежедневные поздравления с днём рождения в 10:00 по Иркутску (UTC+8 = 02:00 UTC)
  cron.schedule("0 2 * * *", () => {
    sendBirthdayGreetings().catch((e) => console.error("[BIRTHDAY CRON]", e));
  });
  console.log("[STARTUP] Birthday cron scheduled (daily 10:00 Irkutsk)");

  // Order status cron — каждые 30 минут проверяет смены статусов у verified юзеров
  cron.schedule("*/30 * * * *", () => {
    checkOrderStatusChanges().catch((e) => console.error("[ORDER STATUS CRON]", e));
  });
  console.log("[STARTUP] Order-status cron scheduled (every 30 min)");

  // Cart abandonment cron — каждый час шлёт пуш юзерам с забытой корзиной >24h
  cron.schedule("23 * * * *", () => {
    pushCartAbandonments().catch((e) => console.error("[CART ABANDON CRON]", e));
  });
  console.log("[STARTUP] Cart-abandonment cron scheduled (hourly)");

  // Партнёры — синк с Bitrix раз в час (если PARTNERS_API задан)
  if (process.env.PARTNERS_API) {
    syncPartners().catch((e) => console.error("[PARTNERS] startup sync:", e));
    cron.schedule("17 * * * *", () => {
      syncPartners().catch((e) => console.error("[PARTNERS CRON]", e));
    });
    console.log("[STARTUP] Partners cron scheduled (hourly)");
  } else {
    console.log("[STARTUP] PARTNERS_API not set — partners served from data/partners.json");
  }

  if (WEBHOOK_URL) {
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
        console.error("[STARTUP] Failed to set webhook:", (e as Error).message);
      }
    });
  } else {
    app.listen(PORT, () => console.log(`🚀 Server on port ${PORT} (long polling)`));
    try {
      await bot.start();
    } catch (e) {
      console.error("[STARTUP] bot.start() failed:", (e as Error).message);
      throw e;
    }
  }
}

main().catch((err) => { console.error("Fatal:", err.stack ?? err); process.exit(1); });

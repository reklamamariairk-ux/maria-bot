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
const node_cron_1 = __importDefault(require("node-cron"));
const grammy_1 = require("grammy");
const scraper_1 = require("./scraper");
const db_1 = require("./db");
const club_1 = require("./club");
const auth_1 = require("./auth");
const partners_1 = require("./partners");
const lk_1 = require("./lk");
const order_1 = require("./order");
// ─── Env ────────────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN ?? "";
const GROQ_KEY = process.env.GROQ_KEY ?? "";
const WEBHOOK_URL = process.env.WEBHOOK_URL ?? "";
const PORT = Number(process.env.PORT ?? 3000);
const MINI_APP_URL = process.env.MINI_APP_URL ?? WEBHOOK_URL;
const ADMIN_IDS = (process.env.ADMIN_IDS ?? "").split(",").map(Number).filter(Boolean);
if (!BOT_TOKEN)
    throw new Error("BOT_TOKEN is required");
if (!GROQ_KEY)
    throw new Error("GROQ_KEY is required");
// ─── Каталог (в памяти) ──────────────────────────────────────────────────────
let catalog = (0, scraper_1.loadCatalog)();
async function refreshCatalog() {
    try {
        catalog = await (0, scraper_1.scrapeCatalog)();
    }
    catch (e) {
        console.error("Ошибка обновления каталога:", e.message);
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
setInterval(refreshCatalog, 60 * 60 * 1000);
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
}
setInterval(runCleanup, 6 * 60 * 60 * 1000); // каждые 6 часов
setTimeout(runCleanup, 5 * 60 * 1000); // первая через 5 минут после старта
// ─── Telegram Bot ───────────────────────────────────────────────────────────
const bot = new grammy_1.Bot(BOT_TOKEN);
function webAppButton(_text, label = "🍰 Открыть Mini App") {
    return new grammy_1.InlineKeyboard().webApp(label, MINI_APP_URL || "https://t.me");
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
        await (0, db_1.addSubscriber)(ctx.from.id, ctx.from.username, ctx.from.first_name).catch(() => { });
        // Referral payload: /start ref_12345
        const payload = ctx.match?.trim();
        if (payload && payload.startsWith("ref_")) {
            const referrerId = Number(payload.slice(4));
            if (referrerId && referrerId !== ctx.from.id) {
                await (0, club_1.recordReferral)(referrerId, ctx.from.id).catch(() => { });
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
    await (0, db_1.addSubscriber)(ctx.from.id, ctx.from.username, ctx.from.first_name).catch(() => { });
    try {
        const result = await (0, club_1.verifyPhone)(ctx.from.id, c.phone_number);
        if (result.alreadyVerified) {
            await ctx.reply("✅ Номер уже подтверждён");
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
bot.command("games", async (ctx) => ctx.reply(GAMES_TEXT, { parse_mode: "Markdown", reply_markup: webAppButton(GAMES_TEXT, "🎮 Играть") }));
bot.command("sale", async (ctx) => ctx.reply(SALE_TEXT, { parse_mode: "Markdown", reply_markup: webAppButton(SALE_TEXT, "🛒 Акции") }));
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
    const subscribers = await (0, db_1.getAllSubscribers)();
    await ctx.reply(`📤 Начинаю рассылку для ${subscribers.length} подписчиков…`);
    let sent = 0, failed = 0;
    for (const { chat_id } of subscribers) {
        try {
            await bot.api.sendMessage(chat_id, text, { parse_mode: "Markdown" });
            sent++;
        }
        catch {
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
    if (!ctx.from)
        return;
    await (0, db_1.setUserBirthday)(ctx.from.id, birthday);
    await (0, db_1.addSubscriber)(ctx.from.id, ctx.from.username, ctx.from.first_name).catch(() => { });
    await ctx.reply(`🎂 Запомнила! Поздравлю вас ${day}.${month.padStart(2, "0")} со скидкой в день рождения 🎁`);
});
bot.on("message:text", async (ctx) => {
    if (ctx.from) {
        await (0, db_1.addSubscriber)(ctx.from.id, ctx.from.username, ctx.from.first_name).catch(() => { });
    }
    await ctx.reply(`✨ Откройте наш Mini App — там игры, ИИ-кондитер и все акции!`, { reply_markup: webAppButton("") });
});
// ─── Express ─────────────────────────────────────────────────────────────────
const app = (0, express_1.default)();
app.use((0, helmet_1.default)({ contentSecurityPolicy: false }));
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: "1mb" }));
// ─── Rate limit ─────────────────────────────────────────────────────────────
// Простой sliding window per-IP: разные лимиты для разных эндпоинтов.
const rateBuckets = new Map();
function rateLimit(maxPerMinute) {
    return (req, res, next) => {
        const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
        const key = `${ip}:${req.path}`;
        const now = Date.now();
        const win = 60000;
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
        const fresh = arr.filter((t) => now - t < 60000);
        if (fresh.length === 0)
            rateBuckets.delete(k);
        else
            rateBuckets.set(k, fresh);
    }
}, 5 * 60000);
app.use(express_1.default.static(path_1.default.join(__dirname, "..", "public")));
// Прокси логотипа
function proxyAsset(url, contentType) {
    return (_req, res) => {
        https_1.default.get(url, { headers: { "User-Agent": "Mozilla/5.0" }, rejectUnauthorized: false }, (r) => {
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
function imgKey(u) {
    return require("crypto").createHash("md5").update(u).digest("hex");
}
function imgDiskGet(u) {
    const k = imgKey(u);
    try {
        const buf = fsSync.readFileSync(path_1.default.join(IMG_CACHE_DIR, k));
        const meta = fsSync.readFileSync(path_1.default.join(IMG_CACHE_DIR, k + ".meta"), "utf8");
        return { buf, type: meta.trim() || "image/jpeg" };
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
            rejectUnauthorized: false,
        };
        const req = https_1.default.request(opts, (r) => {
            if ((r.statusCode ?? 0) >= 400) {
                r.resume();
                resolve(null);
                return;
            }
            const type = String(r.headers["content-type"] ?? "image/jpeg");
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
// Запуск прогрева когда каталог готов (через 5 сек после старта)
setTimeout(() => { prewarmImageCache().catch((e) => console.error("[IMG] prewarm failed:", e)); }, 5000);
// И повторно после каждого обновления каталога
const _origRefresh = refreshCatalog;
global.__refreshCatalogPatched = false;
// ─── Groq chat (agent с tool calling) ───────────────────────────────────────
const ai_tools_1 = require("./ai-tools");
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
                        const e = new Error(`Groq rate limit (${status})`);
                        e.status = status;
                        e.rateLimited = true;
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
        req.setTimeout(30000, () => {
            req.destroy();
            const e = new Error("Groq timeout (30s)");
            e.status = 0;
            reject(e);
        });
        req.write(body);
        req.end();
    });
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
async function chatAgent(userMessages, ctx) {
    const system = {
        role: "system",
        content: `Ты — Маша, тёплый AI-помощник кондитерской «Мария» в Иркутске.

О НАС:
— Сайт maria-irk.ru | Телефон +7 (3952) 50-40-80 | 17 кафе в Иркутске + точки в Ангарске
— 33 года на рынке (с 1993)
— Торт месяца меняется ежемесячно — узнай через search_products (ищи hit:true)
— Клуб «Мария для своих»: кэшбэк 5–10%, оплата бонусами до 30%
— Скидка ко дню рождения: вам −5%, детям −10% (±5 дней)
— Лотерея «Сладкий чек»: каждый чек = шанс на iPhone 17 Pro Max, MacBook, PS5 Slim, Apple Watch, JBL — розыгрыш каждый квартал

КАТАЛОГ — что у нас ЕСТЬ и чего НЕТ (источник истины):
🟢 ЕСТЬ:
• Торты со сметаной: Зебра, Фигаро, Графы, Домашний с брусникой, Королевский, Малиновый медовик, Шоколадно-вишнёвый
• Торты с ягодами (готовые, не заказные): Домашний с брусникой, Медовик, Клубничный пломбир, Молочная девочка с клубникой, Торт с ягодой, Торт с рюшами и ягодой
• Торт с курагой и сметаной — это «Фигаро» (также подойдёт «Королевский»)
• Торты с сырным кремом: Банан-солёная карамель, Красный бархат, Оскар, Лаванда, Медовик, Манго (и заказные)
• Безе и пирожные содержат яичный белок — НЕ являются «без яиц»
🔴 НЕТ в каталоге:
• Тортов с мармеладом
• Тортов «без яиц» — все наши десерты содержат яйца (или белок). Если клиент просит без яиц — честно скажи что таких нет, не предлагай безе как замену.

КАК РАБОТАТЬ:
— Когда клиент спрашивает про торты/пироги/наборы — ВСЕГДА вызывай search_products. Используй разные запросы (по начинке, типу, ингредиенту), не только по имени.
— Если клиент уточняет «расскажи подробнее» — вызови get_product с ID последнего обсуждаемого товара.
— Когда спрашивают про баллы/счёт/бонусы — вызови check_my_loyalty.
— Когда спрашивают про заказы/историю — вызови get_my_orders.
— Когда спрашивают про скидки у партнёров — list_partners.
— Каталог: ${ctx.catalog.length} активных товаров.

ЦЕНЫ:
— search_products возвращает price (цена со скидкой) и oldPrice (старая цена без скидки, если есть discountPercent > 0).
— ВСЕГДА называй итоговую price (то что клиент платит). Если есть discountPercent, упомяни старую цену тоже: «1 856 ₽ (вместо 2 320 ₽, скидка 20%)».
— Не выдумывай цены — только из tool calls.

СТИЛЬ:
— Живой, тёплый тон. Без канцелярита.
— Эмодзи умеренно: 1-2 на сообщение.
— Ответы короткие: 2-5 предложений.
— Когда советуешь товар — называй имя и точную цену. Картинку не вставляй текстом — UI покажет карточку под ответом.
— Язык: русский.

ЖЁСТКИЕ ПРАВИЛА:
— Конкретные товары (имя, цена, вес) бери ТОЛЬКО из ответов tool calls. БЕЗ выдумок.
— Если в каталоге нет того что просят (например торт с мармеладом) — честно говори «у нас нет», не предлагай похожее как «то самое». Можешь предложить альтернативу: «зато есть...».
— Если клиент не верифицировал телефон, баланс/заказы недоступны — мягко предложи «Поделиться номером» во вкладке Клуб.
— Никогда не утверждай что наши изделия «без яиц». Безе содержит белок.`,
    };
    // Обрезаем историю клиента — оставляем последние ~30 сообщений + system.
    // Llama-3.3-70b у Groq имеет 32K context, средний тур ~150 токенов → 30 сообщений
    // помещается с большим запасом, диалог стабильно идёт.
    const trimmedUser = userMessages.length > 30 ? userMessages.slice(-30) : userMessages;
    const messages = [system, ...trimmedUser];
    const MAX_ITERATIONS = 4;
    let toolsBroken = false;
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        // Для каждой итерации обрезаем messages если они выросли с tool-результатами
        const sendMessages = trimHistory(messages, 36);
        const response = await groqRequest({
            model: "llama-3.3-70b-versatile",
            max_tokens: 1024,
            temperature: 0.6,
            messages: sendMessages,
            ...(toolsBroken ? {} : { tools: ai_tools_1.TOOL_DEFS, tool_choice: "auto" }),
        });
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
                args = JSON.parse(tc.function.arguments || "{}");
            }
            catch { }
            const out = await (0, ai_tools_1.runTool)(tc.function.name, args, ctx);
            return { tool_call_id: tc.id, role: "tool", name: tc.function.name, content: out };
        }));
        messages.push(...results);
    }
    // Если за MAX_ITERATIONS не успели — финальный запрос без tools
    const final = await groqRequest({
        model: "llama-3.3-70b-versatile",
        max_tokens: 512,
        messages,
    });
    const finalChoice = final.choices?.[0];
    return {
        text: (finalChoice?.message?.content ?? "Извини, не получилось разобраться. Попробуй переформулировать.").trim(),
        products: [...ctx.surfacedProducts.values()],
        cart_actions: ctx.cartActions,
    };
}
app.post("/api/chat", rateLimit(40), async (req, res) => {
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: "messages array is required" });
        return;
    }
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
        const out = await chatAgent(messages, ctx);
        res.json({ text: out.text, products: out.products, cart_actions: out.cart_actions });
    }
    catch (err) {
        const e = err;
        console.error(`[CHAT] err: status=${e.status} msg=${e.message}`);
        if (e.rateLimited) {
            res.status(429).json({ error: "ИИ временно занят (превышен лимит запросов). Подожди 10-20 секунд и попробуй ещё раз." });
        }
        else if (e.status === 0 || /timeout/i.test(e.message)) {
            res.status(504).json({ error: "ИИ не ответил вовремя. Попробуй ещё раз через минуту." });
        }
        else {
            res.status(502).json({ error: "ИИ временно недоступен. Попробуй через минуту или позвони +7 (3952) 50-40-80." });
        }
    }
});
// ─── Bitrix24 lead ───────────────────────────────────────────────────────────
const BITRIX_WEBHOOK = process.env.BITRIX_WEBHOOK ?? "";
// Заявка на индивидуальный торт (форма «На заказ» — менеджер свяжется)
app.post("/api/lead", rateLimit(10), express_1.default.json({ limit: "8mb" }), async (req, res) => {
    const { name, phone, description, date, portions, comment, photo } = req.body;
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
                    const dir = path_1.default.join("/tmp", "lead_photos");
                    fsSync.mkdirSync(dir, { recursive: true });
                    const fname = `${Date.now()}_${id}.${ext}`;
                    fsSync.writeFileSync(path_1.default.join(dir, fname), buf);
                    photoUrl = `${process.env.MINI_APP_URL || ""}/lead-photo/${fname}`.replace(/^\//, "https://maria-bot-6182.onrender.com/");
                }
            }
        }
        catch (e) {
            console.warn("[LEAD] photo save failed:", e.message);
        }
    }
    const title = `Заказ торта — ${name} (Telegram Mini App)`;
    const comments = [
        description && `Торт: ${description}`,
        date && `Дата: ${date}`,
        portions && `Порций: ${portions}`,
        comment && `Комментарий: ${comment}`,
        photoUrl && `Фото референса: ${photoUrl}`,
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
        await new Promise((resolve, reject) => {
            const url = new URL(`${BITRIX_WEBHOOK}crm.lead.add.json`);
            const opts = {
                hostname: url.hostname,
                path: url.pathname + url.search,
                method: "POST",
                headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
            };
            const r = https_1.default.request(opts, (resp) => {
                let d = "";
                resp.on("data", (c) => (d += c));
                resp.on("end", () => {
                    const json = JSON.parse(d);
                    if (json.error)
                        reject(new Error(json.error_description ?? json.error));
                    else
                        resolve();
                });
            });
            r.on("error", reject);
            r.write(body);
            r.end();
        });
        console.log(`[ORDER] Lead created: ${title}`);
        res.json({ ok: true });
    }
    catch (e) {
        console.error("[ORDER] Bitrix24 error:", e.message);
        res.status(502).json({ error: "Не удалось создать заявку, попробуйте позже" });
    }
});
// ─── Магазины ────────────────────────────────────────────────────────────────
const STORES = [];
app.get("/api/stores", (_req, res) => {
    res.json(STORES);
});
// ─── Статистика подписчиков ───────────────────────────────────────────────────
app.get("/api/subscribers/count", async (_req, res) => {
    const subs = await (0, db_1.getAllSubscribers)();
    res.json({ count: subs.length });
});
// ─── Рассылка через API (для будущей админ-панели) ────────────────────────────
app.post("/api/broadcast", async (req, res) => {
    const { token, text } = req.body;
    if (!token || token !== process.env.ADMIN_TOKEN) {
        res.status(403).json({ error: "forbidden" });
        return;
    }
    if (!text?.trim()) {
        res.status(400).json({ error: "text required" });
        return;
    }
    const subscribers = await (0, db_1.getAllSubscribers)();
    res.json({ status: "started", total: subscribers.length });
    let sent = 0, failed = 0;
    for (const { chat_id } of subscribers) {
        try {
            await bot.api.sendMessage(chat_id, text, { parse_mode: "Markdown" });
            sent++;
        }
        catch {
            failed++;
        }
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
        updated: (0, scraper_1.catalogAge)(),
        sample: catalog.slice(0, 3),
    });
});
// ─── Club / Loyalty API ──────────────────────────────────────────────────────
// День рождения юзера — для UI показа карточки-приглашения
const db_2 = require("./db");
async function getUserBirthday(chatId) {
    try {
        const { rows } = await db_2.pool.query(`SELECT birthday FROM user_birthdays WHERE chat_id = $1`, [chatId]);
        return rows[0]?.birthday ? String(rows[0].birthday).slice(0, 10) : null;
    }
    catch {
        return null;
    }
}
app.post("/api/birthday", auth_1.requireTgUser, async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    const body = req.body;
    const bday = String(body.birthday ?? "").trim();
    // Принимаем yyyy-mm-dd (input type=date)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bday)) {
        res.status(400).json({ ok: false, error: "Неверный формат даты" });
        return;
    }
    try {
        await (0, db_1.setUserBirthday)(u.id, bday);
        res.json({ ok: true });
    }
    catch (e) {
        console.error("[BIRTHDAY]", e.message);
        res.status(500).json({ ok: false, error: "Не получилось сохранить" });
    }
});
app.get("/api/me", auth_1.requireTgUser, async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        // touchSubscriber заодно бьёт launch_count и last_seen_at; addSubscriber оставлен для совместимости
        await (0, db_1.touchSubscriber)(u.id, u.username, u.first_name).catch(() => { });
        const [verified, balance, daily, myRewards, birthday] = await Promise.all([
            (0, club_1.isPhoneVerified)(u.id),
            (0, club_1.getBalance)(u.id),
            (0, club_1.getDailyStatus)(u.id),
            (0, club_1.getMyRewards)(u.id),
            getUserBirthday(u.id),
        ]);
        res.json({
            user: { id: u.id, first_name: u.first_name, username: u.username },
            phoneVerified: verified,
            balance,
            daily,
            activeRewards: myRewards.length,
            birthday,
        });
    }
    catch (e) {
        console.error("[API /me]", e.message);
        res.status(500).json({ error: "internal" });
    }
});
app.post("/api/verify-phone", auth_1.requireTgUser, async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    const { phone } = req.body;
    if (!phone || phone.replace(/\D/g, "").length < 10) {
        res.status(400).json({ error: "bad_phone" });
        return;
    }
    try {
        const result = await (0, club_1.verifyPhone)(u.id, phone);
        const balance = await (0, club_1.getBalance)(u.id);
        res.json({ ok: true, ...result, balance });
    }
    catch (e) {
        console.error("[API /verify-phone]", e.message);
        res.status(500).json({ error: "internal" });
    }
});
app.post("/api/daily/claim", auth_1.requireTgUser, async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        if (!(await (0, club_1.isPhoneVerified)(u.id))) {
            res.status(403).json({ error: "phone_not_verified" });
            return;
        }
        const result = await (0, club_1.claimDailyLogin)(u.id);
        const balance = await (0, club_1.getBalance)(u.id);
        res.json({ ...result, balance });
    }
    catch (e) {
        console.error("[API /daily/claim]", e.message);
        res.status(500).json({ error: "internal" });
    }
});
app.get("/api/conversion-tiers", (_req, res) => {
    res.json(club_1.CONVERSION_TIERS);
});
app.post("/api/convert", auth_1.requireTgUser, async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    const { stars } = req.body;
    if (typeof stars !== "number") {
        res.status(400).json({ error: "bad_stars" });
        return;
    }
    try {
        const result = await (0, club_1.convertStars)(u.id, stars);
        const balance = await (0, club_1.getBalance)(u.id);
        res.json({ ...result, balance });
    }
    catch (e) {
        console.error("[API /convert]", e.message);
        res.status(500).json({ error: "internal" });
    }
});
app.get("/api/rewards", async (_req, res) => {
    try {
        const items = await (0, club_1.getRewardsCatalog)();
        res.json(items);
    }
    catch (e) {
        console.error("[API /rewards]", e.message);
        res.status(500).json({ error: "internal" });
    }
});
app.post("/api/redeem", auth_1.requireTgUser, async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    const { rewardId } = req.body;
    if (typeof rewardId !== "number") {
        res.status(400).json({ error: "bad_reward_id" });
        return;
    }
    try {
        if (!(await (0, club_1.isPhoneVerified)(u.id))) {
            res.status(403).json({ error: "phone_not_verified" });
            return;
        }
        const result = await (0, club_1.redeemReward)(u.id, rewardId);
        const balance = await (0, club_1.getBalance)(u.id);
        res.json({ ...result, balance });
    }
    catch (e) {
        console.error("[API /redeem]", e.message);
        res.status(500).json({ error: "internal" });
    }
});
app.get("/api/my-rewards", auth_1.requireTgUser, async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        const items = await (0, club_1.getMyRewards)(u.id);
        res.json(items);
    }
    catch (e) {
        console.error("[API /my-rewards]", e.message);
        res.status(500).json({ error: "internal" });
    }
});
app.post("/api/game-result", auth_1.requireTgUser, async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    const { game, score } = req.body;
    if (!game || typeof score !== "number" || score < 0) {
        res.status(400).json({ error: "bad_input" });
        return;
    }
    if (!["flappy_cake", "memory", "bakery"].includes(game)) {
        res.status(400).json({ error: "unknown_game" });
        return;
    }
    try {
        if (!(await (0, club_1.isPhoneVerified)(u.id))) {
            res.json({ starsAwarded: 0, recordBeaten: false, recordBonus: 0, capped: false, gated: true });
            return;
        }
        const result = await (0, club_1.recordGameResult)(u.id, game, score);
        const balance = await (0, club_1.getBalance)(u.id);
        res.json({ ...result, balance });
    }
    catch (e) {
        console.error("[API /game-result]", e.message);
        res.status(500).json({ error: "internal" });
    }
});
app.get("/api/history", auth_1.requireTgUser, async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        const rows = await (0, club_1.getHistory)(u.id, 30);
        res.json(rows);
    }
    catch (e) {
        console.error("[API /history]", e.message);
        res.status(500).json({ error: "internal" });
    }
});
// ─── Catalog API ─────────────────────────────────────────────────────────────
app.get("/api/catalog/categories", (_req, res) => {
    const counts = new Map();
    for (const p of catalog)
        counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    const categories = Array.from(counts.entries()).map(([name, count]) => {
        const sample = catalog.find((p) => p.category === name && p.image);
        return { name, count, sample: sample?.image ?? null };
    });
    res.json({ categories, total: catalog.length, updated: (0, scraper_1.catalogAge)() });
});
// Доступные товары — скрываем явно помеченные available:false (нет в наличии).
// Если поле отсутствует — считаем доступным (по умолчанию).
function onlyAvailable(p) {
    return p.available !== false;
}
app.get("/api/catalog/products", (req, res) => {
    const category = String(req.query.category ?? "").trim();
    const limit = Math.min(Number(req.query.limit ?? 30), 100);
    const offset = Number(req.query.offset ?? 0);
    const includeUnavailable = req.query.all === "1";
    let filtered = catalog.filter(onlyAvailable);
    if (includeUnavailable)
        filtered = catalog.slice();
    if (category)
        filtered = filtered.filter((p) => p.category === category);
    const products = filtered.slice(offset, offset + limit);
    res.json({ products, total: filtered.length, limit, offset });
});
app.get("/api/catalog/search", (req, res) => {
    const q = String(req.query.q ?? "").trim();
    if (!q) {
        res.json({ products: [], total: 0 });
        return;
    }
    const all = (0, scraper_1.searchCatalog)(catalog, q, 60);
    const products = all.filter(onlyAvailable).slice(0, 30);
    res.json({ products, total: products.length });
});
app.get("/api/catalog/product/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!id) {
        res.status(400).json({ error: "bad_id" });
        return;
    }
    const product = await (0, scraper_1.fetchProductById)(id);
    if (!product) {
        res.status(404).json({ error: "not_found" });
        return;
    }
    res.json({ product });
});
// ─── Partners ────────────────────────────────────────────────────────────────
app.get("/api/partners", (_req, res) => {
    res.json({ partners: (0, partners_1.getPartners)(), meta: (0, partners_1.getPartnersMeta)() });
});
// ─── LK (Личный кабинет на сайте) ────────────────────────────────────────────
app.get("/api/lk", auth_1.requireTgUser, async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        const result = await (0, lk_1.fetchLk)(u.id);
        if (!result.ok) {
            const code = result.reason === "phone_not_verified" ? 403 : 502;
            res.status(code).json({ error: result.reason });
            return;
        }
        res.json(result.data);
    }
    catch (e) {
        console.error("[API /lk]", e.message);
        res.status(500).json({ error: "internal" });
    }
});
const ORDER_LOG = [];
function logOrderAttempt(a) {
    ORDER_LOG.push(a);
    if (ORDER_LOG.length > 20)
        ORDER_LOG.shift();
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
app.post("/api/order", rateLimit(15), async (req, res) => {
    const tg = (0, auth_1.tryGetTgUser)(req); // optional, без блокировки
    const body = req.body;
    let phone = String(body.phone ?? "").trim();
    let lkData = null;
    if (tg?.id) {
        try {
            const lk = await (0, lk_1.fetchLk)(tg.id);
            lkData = lk.ok ? lk.data : null;
            if ((body.useVerifiedPhone || !phone) && lkData?.configured && lkData.phone) {
                phone = String(lkData.phone);
            }
        }
        catch { }
    }
    const items = Array.isArray(body.items)
        ? body.items.filter((i) => i && Number(i.id) > 0 && Number(i.qty) > 0)
            .map((i) => ({ id: Number(i.id), qty: Number(i.qty) }))
        : [];
    // Снимок body для логирования (без чувствительных данных)
    const bodySnap = {
        phone: phone || undefined,
        name: body.name ? String(body.name) : undefined,
        itemsCount: items.length,
        itemIds: items.slice(0, 10).map((i) => i.id),
        hasAddress: !!body.address,
        hasComment: !!body.comment,
        useVerifiedPhone: !!body.useVerifiedPhone,
    };
    const ts = new Date().toISOString();
    const baseAttempt = { ts, tg: tg?.id ?? null, body: bodySnap, outcome: "validation_error", status: 0 };
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
    const ctx = [];
    if (body.comment)
        ctx.push(`Комментарий: ${body.comment}`);
    if (tg?.id) {
        const tgInfo = [
            tg.username ? `@${tg.username}` : null,
            `id=${tg.id}`,
            [tg.first_name, tg.last_name].filter(Boolean).join(" ") || null,
        ].filter(Boolean).join(" · ");
        ctx.push(`Telegram: ${tgInfo}`);
    }
    else {
        ctx.push("Telegram: гость (не залогинен в Mini App)");
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
            const bal = await (0, club_1.getBalance)(tg.id);
            if (bal.stars > 0 || bal.points > 0) {
                ctx.push(`Бот-бонусы: ${bal.points} очков · ${bal.stars} звёзд (всего заработано: ${bal.totalEarnedPoints} очков · ${bal.totalEarnedStars} звёзд)`);
            }
        }
        catch { }
        // Подтверждение телефона через бот
        try {
            const verified = await (0, club_1.isPhoneVerified)(tg.id);
            if (verified)
                ctx.push("✓ Телефон подтверждён через Mini App");
        }
        catch { }
        // История взаимодействия с ботом: дата регистрации, запуски, последний заход
        try {
            const info = await (0, db_1.getSubscriberInfo)(tg.id);
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
    }
    const richComment = ctx.join("\n");
    const result = await (0, order_1.createOrder)({
        phone,
        name: String(body.name).trim(),
        items,
        address: body.address ? String(body.address).trim() : undefined,
        delivery_date: body.delivery_date ? String(body.delivery_date).trim() : undefined,
        delivery_time: body.delivery_time ? String(body.delivery_time).trim() : undefined,
        comment: richComment,
        email: body.email ? String(body.email).trim() : undefined,
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
    res.json(result);
});
app.post("/api/partners/sync", async (req, res) => {
    const { token } = req.body;
    if (!token || token !== process.env.ADMIN_TOKEN) {
        res.status(403).json({ error: "forbidden" });
        return;
    }
    const result = await (0, partners_1.syncPartners)();
    res.json(result);
});
// Прокси к /api/shops.php на сайте — миниапп получает реальные адреса
const SHOPS_API = process.env.SHOPS_API ?? "";
const SHOPS_TOKEN = process.env.SHOPS_TOKEN ?? process.env.LK_TOKEN ?? "";
let _shopsCache = null;
app.get("/api/shops", async (_req, res) => {
    if (!SHOPS_API || !SHOPS_TOKEN) {
        res.status(503).json({ count: 0, shops: [], error: "shops_api_not_configured" });
        return;
    }
    // Кеш 1 час
    if (_shopsCache && (Date.now() - _shopsCache.ts) < 3600000) {
        res.json(_shopsCache.data);
        return;
    }
    try {
        const sep = SHOPS_API.includes("?") ? "&" : "?";
        const url = `${SHOPS_API}${sep}token=${encodeURIComponent(SHOPS_TOKEN)}`;
        const data = await new Promise((resolve, reject) => {
            const req = https_1.default.get(url, { rejectUnauthorized: false }, (r) => {
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
        _shopsCache = { data, ts: Date.now() };
        res.json(data);
    }
    catch (e) {
        console.error("[SHOPS]", e.message);
        res.status(502).json({ count: 0, shops: [], error: "fetch_failed" });
    }
});
// Sweet Check — активная неделя/квест
// Расписание зеркально с сайта. Админ Maria сможет править даты в этом месте.
const SWEET_CHECK_WEEKS = [
    { from: "2026-04-13", to: "2026-04-19", name: "Неделя 4 · Старт", task: "Купи набор «Семейный»", reward: "5 билетов" },
    { from: "2026-04-20", to: "2026-04-26", name: "Неделя 5 · Сезон ягод", task: "Купи 2 пирога с ягодной начинкой", reward: "5 билетов" },
    { from: "2026-04-27", to: "2026-05-03", name: "Неделя 6 · Капкейки", task: "Купи 4 капкейка любых вкусов", reward: "5 билетов" },
    { from: "2026-05-04", to: "2026-05-10", name: "Неделя 7 · Подарок другу", task: "Купи бенто-торт + капкейк или десерт в стакане", reward: "5 билетов" },
    { from: "2026-05-11", to: "2026-05-17", name: "Неделя 8", task: "Уточняется в кафе", reward: "5 билетов" },
    { from: "2026-05-18", to: "2026-05-24", name: "Неделя 9", task: "Уточняется в кафе", reward: "5 билетов" },
    { from: "2026-05-25", to: "2026-05-31", name: "Неделя 10", task: "Уточняется в кафе", reward: "5 билетов" },
    { from: "2026-06-01", to: "2026-06-07", name: "Неделя 11", task: "Уточняется в кафе", reward: "5 билетов" },
    { from: "2026-06-08", to: "2026-06-14", name: "Неделя 12", task: "Уточняется в кафе", reward: "5 билетов" },
    { from: "2026-06-15", to: "2026-06-21", name: "Неделя 13", task: "Уточняется в кафе", reward: "5 билетов" },
    { from: "2026-06-22", to: "2026-06-28", name: "Неделя 14", task: "Уточняется в кафе", reward: "5 билетов" },
    { from: "2026-06-29", to: "2026-07-05", name: "Неделя 15 · Финал Q2", task: "Уточняется в кафе", reward: "5 билетов" },
];
app.get("/api/sweet-check/active", (_req, res) => {
    const now = new Date().toISOString().slice(0, 10);
    const active = SWEET_CHECK_WEEKS.find((w) => w.from <= now && now <= w.to) ?? null;
    const next = SWEET_CHECK_WEEKS.find((w) => w.from > now) ?? null;
    const fmt = (d) => {
        const [y, m, dd] = d.split("-");
        return `${dd}.${m}.${y}`;
    };
    res.json({
        active: active ? { ...active, dates: `${fmt(active.from)} — ${fmt(active.to)}` } : null,
        next: next ? { ...next, dates: `${fmt(next.from)} — ${fmt(next.to)}` } : null,
        period: { from: SWEET_CHECK_WEEKS[0]?.from, to: SWEET_CHECK_WEEKS.at(-1)?.to },
    });
});
app.get("/health", (_req, res) => res.json({ status: "ok", catalog: catalog.length, partners: (0, partners_1.getPartnersMeta)() }));
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
    const users = await (0, db_1.getTodayBirthdays)();
    for (const { chat_id, first_name } of users) {
        try {
            const name = first_name ? `, ${first_name}` : "";
            await bot.api.sendMessage(chat_id, `🎂 С днём рождения${name}!\n\nКондитерская «Мария» поздравляет вас и дарит скидку:\n🎁 *−5% вам* и *−10% детям* (действует ±5 дней от дня рождения)\n\nПриходите порадовать себя сладким! 🍰`, { parse_mode: "Markdown" });
            await (0, db_1.markBirthdayNotified)(chat_id);
            console.log(`[BIRTHDAY] Поздравили chat_id=${chat_id}`);
        }
        catch (e) {
            console.error(`[BIRTHDAY] Ошибка для chat_id=${chat_id}:`, e.message);
        }
    }
}
async function main() {
    await (0, db_1.initDb)();
    await (0, club_1.initClubSchema)();
    console.log(`[STARTUP] BOT_TOKEN=${BOT_TOKEN ? "set" : "MISSING"}`);
    console.log(`[STARTUP] GROQ_KEY=${GROQ_KEY ? "set" : "MISSING"}`);
    console.log(`[STARTUP] WEBHOOK_URL=${WEBHOOK_URL || "(empty — long polling)"}`);
    console.log(`[STARTUP] PORT=${PORT}`);
    // Ежедневные поздравления с днём рождения в 10:00 по Иркутску (UTC+8 = 02:00 UTC)
    node_cron_1.default.schedule("0 2 * * *", () => {
        sendBirthdayGreetings().catch((e) => console.error("[BIRTHDAY CRON]", e));
    });
    console.log("[STARTUP] Birthday cron scheduled (daily 10:00 Irkutsk)");
    // Партнёры — синк с Bitrix раз в час (если PARTNERS_API задан)
    if (process.env.PARTNERS_API) {
        (0, partners_1.syncPartners)().catch((e) => console.error("[PARTNERS] startup sync:", e));
        node_cron_1.default.schedule("17 * * * *", () => {
            (0, partners_1.syncPartners)().catch((e) => console.error("[PARTNERS CRON]", e));
        });
        console.log("[STARTUP] Partners cron scheduled (hourly)");
    }
    else {
        console.log("[STARTUP] PARTNERS_API not set — partners served from data/partners.json");
    }
    if (WEBHOOK_URL) {
        const webhookPath = `/webhook/${BOT_TOKEN}`;
        app.use(webhookPath, (0, grammy_1.webhookCallback)(bot, "express"));
        app.listen(PORT, async () => {
            try {
                await bot.api.setWebhook(`${WEBHOOK_URL}${webhookPath}`);
                const info = await bot.api.getWebhookInfo();
                console.log(`[STARTUP] Webhook set: ${info.url}`);
                if (info.last_error_message) {
                    console.error(`[WEBHOOK] Last error: ${info.last_error_message} (${new Date((info.last_error_date ?? 0) * 1000).toISOString()})`);
                }
                console.log(`🚀 Server on port ${PORT} | Webhook set`);
            }
            catch (e) {
                console.error("[STARTUP] Failed to set webhook:", e.message);
            }
        });
    }
    else {
        app.listen(PORT, () => console.log(`🚀 Server on port ${PORT} (long polling)`));
        try {
            await bot.start();
        }
        catch (e) {
            console.error("[STARTUP] bot.start() failed:", e.message);
            throw e;
        }
    }
}
main().catch((err) => { console.error("Fatal:", err.stack ?? err); process.exit(1); });

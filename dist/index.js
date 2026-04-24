"use strict";
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
setInterval(refreshCatalog, 24 * 60 * 60 * 1000);
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

🎂 *Торт месяца «Три шоколада»* — скидка 20%, доставка от 1 000 ₽ бесплатно
🎁 Фирменная коробка с лентой — бесплатно к любому заказу
🧾 *Лотерея «Сладкий чек»* — каждый чек = шанс выиграть iPhone 17, MacBook, PS5

Подробнее на сайте maria-irk.ru ⏳
`.trim();
const HELP_TEXT = `
📞 *Контакты кондитерской «Мария»*

📍 18 магазинов в Иркутске и Ангарске
🕐 Уточняйте часы работы на сайте
📱 +7 (3952) 50-40-80
🌐 maria-irk.ru

Пишите — ответим быстро! 💌
`.trim();
bot.command("start", async (ctx) => {
    if (ctx.from) {
        await (0, db_1.addSubscriber)(ctx.from.id, ctx.from.username, ctx.from.first_name).catch(() => { });
    }
    await ctx.reply(WELCOME, { parse_mode: "Markdown", reply_markup: webAppButton(WELCOME) });
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
// ─── Groq chat ───────────────────────────────────────────────────────────────
function groqChat(messages) {
    return new Promise((resolve, reject) => {
        // Ищем подходящие товары по последнему сообщению пользователя
        const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
        const hits = (0, scraper_1.searchCatalog)(catalog, lastUser, 6);
        const catalogBlock = hits.length
            ? "\n\nТОВАРЫ ИЗ НАШЕГО КАТАЛОГА (реальные данные с сайта):\n" +
                hits.map((p) => `— ${p.name} (${p.category})${p.price ? ", " + p.price : ""} → ${p.url}`).join("\n")
            : catalog.length
                ? `\n\n(Каталог загружен: ${catalog.length} позиций. По запросу ничего не найдено — отвечай по общим знаниям о нас.)`
                : "\n\n(Каталог ещё загружается — не придумывай конкретные названия, отправляй на сайт.)";
        const systemPrompt = `Ты — тёплый помощник кондитерской «Мария» в Иркутске. Тебя зовут Маша.

О НАС:
— Сайт: maria-irk.ru | Телефон: +7 (3952) 50-40-80 | 18 магазинов в Иркутске и Ангарске
— Торт месяца: «Три шоколада» — три слоя мусса (тёмный, молочный, белый бельгийский шоколад), скидка 20%
— Программа «Мария для своих»: кэшбэк 5–10% в зависимости от уровня, оплата бонусами до 30%
— Скидка в день рождения: вам −5%, детям −10% (±5 дней)
— Лотерея «Сладкий чек»: каждый чек = шанс выиграть iPhone 17, MacBook, PS5, Apple Watch, JBL
${catalogBlock}

КАК ОТВЕЧАТЬ:
— Говори живо и тепло, как подруга. Эмодзи — умеренно.
— Если в каталоге выше есть подходящие товары — называй их по имени и давай ссылку.
— Если товара нет в каталоге — не придумывай названия, направляй на сайт или телефон.
— На вопросы про торт на праздник — советуй «Торты на заказ», давай телефон.
— Ответы короткие: 2–4 предложения. Язык: русский.`;
        const body = JSON.stringify({
            model: "llama-3.1-8b-instant",
            max_tokens: 512,
            messages: [
                { role: "system", content: systemPrompt },
                ...messages,
            ],
        });
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
                try {
                    const json = JSON.parse(d);
                    const text = json.choices?.[0]?.message?.content ?? "";
                    if (!text)
                        reject(new Error(json.error?.message ?? "Empty response"));
                    else
                        resolve(text);
                }
                catch (e) {
                    reject(e);
                }
            });
        });
        req.on("error", reject);
        req.write(body);
        req.end();
    });
}
app.post("/api/chat", async (req, res) => {
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: "messages array is required" });
        return;
    }
    try {
        const text = await groqChat(messages);
        res.json({ text });
    }
    catch (err) {
        console.error("Groq error:", err.message);
        res.status(502).json({ error: "ИИ недоступен, попробуйте позже" });
    }
});
// ─── Bitrix24 lead ───────────────────────────────────────────────────────────
const BITRIX_WEBHOOK = process.env.BITRIX_WEBHOOK ?? "";
app.post("/api/order", async (req, res) => {
    const { name, phone, description, date, portions, comment } = req.body;
    if (!name || !phone) {
        res.status(400).json({ error: "Имя и телефон обязательны" });
        return;
    }
    const title = `Заказ торта — ${name} (Telegram Mini App)`;
    const comments = [
        description && `Торт: ${description}`,
        date && `Дата: ${date}`,
        portions && `Порций: ${portions}`,
        comment && `Комментарий: ${comment}`,
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
// ─── Loyalty lookup ───────────────────────────────────────────────────────────
const LOYALTY_API = process.env.LOYALTY_API ?? ""; // https://www.maria-irk.ru/local/api/loyalty.php
const LOYALTY_TOKEN = process.env.LOYALTY_TOKEN ?? "maria2026";
app.post("/api/loyalty/lookup", async (req, res) => {
    const { phone } = req.body;
    if (!phone) {
        res.status(400).json({ error: "no_phone" });
        return;
    }
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) {
        res.status(400).json({ error: "bad_phone" });
        return;
    }
    if (!LOYALTY_API) {
        // API ещё не подключён — возвращаем заглушку
        res.json({ error: "not_ready" });
        return;
    }
    try {
        const url = `${LOYALTY_API}?token=${LOYALTY_TOKEN}&phone=${digits}`;
        const data = await new Promise((resolve, reject) => {
            const mod = require("https");
            const r = mod.get(url, { rejectUnauthorized: false }, (resp) => {
                let body = "";
                resp.on("data", (c) => (body += c));
                resp.on("end", () => resolve(body));
            });
            r.on("error", reject);
            r.setTimeout(10000, () => { r.destroy(); reject(new Error("Timeout")); });
        });
        res.json(JSON.parse(data));
    }
    catch (e) {
        console.error("Loyalty API error:", e.message);
        res.status(502).json({ error: "service_error" });
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
app.get("/health", (_req, res) => res.json({ status: "ok", catalog: catalog.length }));
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
    console.log(`[STARTUP] BOT_TOKEN=${BOT_TOKEN ? "set" : "MISSING"}`);
    console.log(`[STARTUP] GROQ_KEY=${GROQ_KEY ? "set" : "MISSING"}`);
    console.log(`[STARTUP] WEBHOOK_URL=${WEBHOOK_URL || "(empty — long polling)"}`);
    console.log(`[STARTUP] PORT=${PORT}`);
    // Ежедневные поздравления с днём рождения в 10:00 по Иркутску (UTC+8 = 02:00 UTC)
    node_cron_1.default.schedule("0 2 * * *", () => {
        sendBirthdayGreetings().catch((e) => console.error("[BIRTHDAY CRON]", e));
    });
    console.log("[STARTUP] Birthday cron scheduled (daily 10:00 Irkutsk)");
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

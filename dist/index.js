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
const grammy_1 = require("grammy");
const scraper_1 = require("./scraper");
// ─── Env ────────────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN ?? "";
const GROQ_KEY = process.env.GROQ_KEY ?? "";
const WEBHOOK_URL = process.env.WEBHOOK_URL ?? "";
const PORT = Number(process.env.PORT ?? 3000);
const MINI_APP_URL = process.env.MINI_APP_URL ?? WEBHOOK_URL;
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
bot.command("start", async (ctx) => ctx.reply(WELCOME, { parse_mode: "Markdown", reply_markup: webAppButton(WELCOME) }));
bot.command("games", async (ctx) => ctx.reply(GAMES_TEXT, { parse_mode: "Markdown", reply_markup: webAppButton(GAMES_TEXT, "🎮 Играть") }));
bot.command("sale", async (ctx) => ctx.reply(SALE_TEXT, { parse_mode: "Markdown", reply_markup: webAppButton(SALE_TEXT, "🛒 Акции") }));
bot.command("help", async (ctx) => ctx.reply(HELP_TEXT, { parse_mode: "Markdown", reply_markup: webAppButton(HELP_TEXT, "📋 Открыть меню") }));
bot.on("message:text", async (ctx) => {
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
async function main() {
    if (WEBHOOK_URL) {
        const webhookPath = `/webhook/${BOT_TOKEN}`;
        app.use(webhookPath, (0, grammy_1.webhookCallback)(bot, "express"));
        app.listen(PORT, async () => {
            await bot.api.setWebhook(`${WEBHOOK_URL}${webhookPath}`);
            console.log(`🚀 Server on port ${PORT} | Webhook set`);
        });
    }
    else {
        app.listen(PORT, () => console.log(`🚀 Server on port ${PORT} (long polling)`));
        await bot.start();
    }
}
main().catch((err) => { console.error("Fatal:", err); process.exit(1); });

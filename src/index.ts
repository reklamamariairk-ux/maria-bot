import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import https from "https";
import { Bot, webhookCallback, InlineKeyboard } from "grammy";
import { scrapeCatalog, loadCatalog, searchCatalog, catalogAge, Product } from "./scraper";
import { sendCode, verifyCode } from "./loyalty";

// ─── Env ────────────────────────────────────────────────────────────────────
const BOT_TOKEN    = process.env.BOT_TOKEN    ?? "";
const GROQ_KEY     = process.env.GROQ_KEY     ?? "";
const WEBHOOK_URL  = process.env.WEBHOOK_URL  ?? "";
const PORT         = Number(process.env.PORT  ?? 3000);
const MINI_APP_URL = process.env.MINI_APP_URL ?? WEBHOOK_URL;

if (!BOT_TOKEN) throw new Error("BOT_TOKEN is required");
if (!GROQ_KEY)  throw new Error("GROQ_KEY is required");

// ─── Каталог (в памяти) ──────────────────────────────────────────────────────
let catalog: Product[] = loadCatalog();

async function refreshCatalog() {
  try {
    catalog = await scrapeCatalog();
  } catch (e) {
    console.error("Ошибка обновления каталога:", (e as Error).message);
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
setInterval(refreshCatalog, 24 * 60 * 60 * 1000);

// ─── Telegram Bot ───────────────────────────────────────────────────────────
const bot = new Bot(BOT_TOKEN);

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

bot.command("start",  async (ctx) => ctx.reply(WELCOME,     { parse_mode: "Markdown", reply_markup: webAppButton(WELCOME) }));
bot.command("games",  async (ctx) => ctx.reply(GAMES_TEXT,  { parse_mode: "Markdown", reply_markup: webAppButton(GAMES_TEXT, "🎮 Играть") }));
bot.command("sale",   async (ctx) => ctx.reply(SALE_TEXT,   { parse_mode: "Markdown", reply_markup: webAppButton(SALE_TEXT, "🛒 Акции") }));
bot.command("help",   async (ctx) => ctx.reply(HELP_TEXT,   { parse_mode: "Markdown", reply_markup: webAppButton(HELP_TEXT, "📋 Открыть меню") }));

bot.on("message:text", async (ctx) => {
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

// ─── Groq chat ───────────────────────────────────────────────────────────────
function groqChat(messages: { role: string; content: string }[]): Promise<string> {
  return new Promise((resolve, reject) => {

    // Ищем подходящие товары по последнему сообщению пользователя
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const hits = searchCatalog(catalog, lastUser, 6);
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
        try {
          const json  = JSON.parse(d);
          const text: string = json.choices?.[0]?.message?.content ?? "";
          if (!text) reject(new Error(json.error?.message ?? "Empty response"));
          else resolve(text);
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body as { messages: { role: string; content: string }[] };
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages array is required" });
    return;
  }
  try {
    const text = await groqChat(messages);
    res.json({ text });
  } catch (err) {
    console.error("Groq error:", (err as Error).message);
    res.status(502).json({ error: "ИИ недоступен, попробуйте позже" });
  }
});

// ─── Loyalty lookup ───────────────────────────────────────────────────────────
const LOYALTY_API = process.env.LOYALTY_API ?? "";  // https://www.maria-irk.ru/local/api/loyalty.php
const LOYALTY_TOKEN = process.env.LOYALTY_TOKEN ?? "maria2026";

app.post("/api/loyalty/lookup", async (req, res) => {
  const { phone } = req.body as { phone?: string };
  if (!phone) { res.status(400).json({ error: "no_phone" }); return; }

  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) { res.status(400).json({ error: "bad_phone" }); return; }

  if (!LOYALTY_API) {
    // API ещё не подключён — возвращаем заглушку
    res.json({ error: "not_ready" });
    return;
  }

  try {
    const url = `${LOYALTY_API}?token=${LOYALTY_TOKEN}&phone=${digits}`;
    const data = await new Promise<string>((resolve, reject) => {
      const mod = require("https") as typeof import("https");
      const r = mod.get(url, { rejectUnauthorized: false }, (resp) => {
        let body = "";
        resp.on("data", (c: Buffer) => (body += c));
        resp.on("end", () => resolve(body));
      });
      r.on("error", reject);
      r.setTimeout(10_000, () => { r.destroy(); reject(new Error("Timeout")); });
    });
    res.json(JSON.parse(data));
  } catch (e) {
    console.error("Loyalty API error:", (e as Error).message);
    res.status(502).json({ error: "service_error" });
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
    updated: catalogAge(),
    sample: catalog.slice(0, 3),
  });
});

app.get("/health", (_req, res) => res.json({ status: "ok", catalog: catalog.length }));

// ─── Запуск ──────────────────────────────────────────────────────────────────
async function main() {
  if (WEBHOOK_URL) {
    const webhookPath = `/webhook/${BOT_TOKEN}`;
    app.use(webhookPath, webhookCallback(bot, "express"));
    app.listen(PORT, async () => {
      await bot.api.setWebhook(`${WEBHOOK_URL}${webhookPath}`);
      console.log(`🚀 Server on port ${PORT} | Webhook set`);
    });
  } else {
    app.listen(PORT, () => console.log(`🚀 Server on port ${PORT} (long polling)`));
    await bot.start();
  }
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });

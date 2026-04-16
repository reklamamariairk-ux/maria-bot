import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import https from "https";
import { Bot, webhookCallback, InlineKeyboard } from "grammy";

// ─── Env ────────────────────────────────────────────────────────────────────
const BOT_TOKEN   = process.env.BOT_TOKEN   ?? "";
const GROQ_KEY    = process.env.GROQ_KEY    ?? "";
const WEBHOOK_URL = process.env.WEBHOOK_URL ?? "";   // https://<your-app>.onrender.com
const PORT        = Number(process.env.PORT ?? 3000);
const MINI_APP_URL = process.env.MINI_APP_URL ?? WEBHOOK_URL;

if (!BOT_TOKEN) throw new Error("BOT_TOKEN is required");
if (!GROQ_KEY)  throw new Error("GROQ_KEY is required");

// ─── Telegram Bot ───────────────────────────────────────────────────────────
const bot = new Bot(BOT_TOKEN);

/** Клавиатура с кнопкой Web App */
function webAppButton(text: string, label = "🍰 Открыть Mini App") {
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
🎂 *Поймай торт* — лови падающие тортики и набирай очки

Лучшие игроки получают скидку 10% на следующий заказ 🎁
`.trim();

const SALE_TEXT = `
🌟 *Акции этой недели*

🎂 Торт «Наполеон» 1 кг — *890 ₽* (было 1 100 ₽)
🍰 Набор макаронс 12 шт — *650 ₽* (было 800 ₽)
🧁 Капкейки при заказе от 1 500 ₽ — *2 шт в подарок*
🚚 Доставка бесплатно при заказе от *2 000 ₽*

Акции действуют до воскресенья включительно ⏳
`.trim();

const HELP_TEXT = `
📞 *Контакты кондитерской «Мария»*

📍 г. Москва, ул. Пушкина, 12
🕐 Пн–Пт: 9:00–20:00 | Сб–Вс: 10:00–19:00
📱 +7 (495) 123-45-67
✉️ maria@pastry.ru

По вопросам заказа пишите нам — ответим в течение 15 минут 💌
`.trim();

bot.command("start", async (ctx) => {
  await ctx.reply(WELCOME, {
    parse_mode: "Markdown",
    reply_markup: webAppButton(WELCOME),
  });
});

bot.command("games", async (ctx) => {
  await ctx.reply(GAMES_TEXT, {
    parse_mode: "Markdown",
    reply_markup: webAppButton(GAMES_TEXT, "🎮 Играть"),
  });
});

bot.command("sale", async (ctx) => {
  await ctx.reply(SALE_TEXT, {
    parse_mode: "Markdown",
    reply_markup: webAppButton(SALE_TEXT, "🛒 Заказать"),
  });
});

bot.command("help", async (ctx) => {
  await ctx.reply(HELP_TEXT, {
    parse_mode: "Markdown",
    reply_markup: webAppButton(HELP_TEXT, "📋 Открыть меню"),
  });
});

// Любое текстовое сообщение → предлагает открыть Mini App
bot.on("message:text", async (ctx) => {
  await ctx.reply(
    `✨ Откройте наш Mini App — там игры, ИИ-кондитер и все акции!`,
    { reply_markup: webAppButton("") }
  );
});

// ─── Express сервер ─────────────────────────────────────────────────────────
const app = express();

app.use(helmet({
  contentSecurityPolicy: false, // Mini App нужен доступ к Telegram JS
}));
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// 1. Статика из /public
app.use(express.static(path.join(__dirname, "..", "public")));

// Прокси логотипа (обходит CORS браузера)
function proxyAsset(url: string, contentType: string) {
  return (_req: express.Request, res: express.Response) => {
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (r) => {
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");
      r.pipe(res);
    }).on("error", () => res.status(502).end());
  };
}
app.get("/logo.svg", proxyAsset("https://www.maria-irk.ru/local/templates/maria/img/logo_new.svg", "image/svg+xml"));
app.get("/logo.png", proxyAsset("https://www.maria-irk.ru/local/templates/maria/img/mobile_logo.png", "image/png"));

// 2. Прокси к Groq API
function groqChat(messages: { role: string; content: string }[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "llama-3.1-8b-instant",
      max_tokens: 1024,
      messages: [
        {
          role: "system",
          content: `Ты — дружелюбный ИИ-ассистент кондитерской «Мария» в Иркутске (сайт: maria-irk.ru).

СТРОГИЕ ПРАВИЛА — обязательны к исполнению:
1. НИКОГДА не придумывай названия конкретных тортов, пирожных или других позиций — ты не знаешь точного ассортимента.
2. Если клиент спрашивает о конкретных тортах или ценах — направляй на сайт: maria-irk.ru или по телефону +7 (3952) 50-40-80.
3. Говори только то, что точно знаешь из информации ниже. Лучше сказать «уточните на сайте», чем придумать.

ЧТО ТЫ ЗНАЕШЬ ТОЧНО:
— Категории: Торты, Пироги, Пирожные, Наборы, Для праздника, Торты на заказ, Бенто (от 690 ₽)
— Торт месяца: «Три шоколада» — три слоя мусса (тёмный, молочный, белый бельгийский шоколад), скидка 20%, бесплатная доставка от 1 000 ₽
— 18 магазинов в Иркутске и Ангарске
— Телефон: +7 (3952) 50-40-80
— Программа лояльности «Мария для своих»: кэшбэк 5% (Друзья), 7% (Лучшие друзья, от 10 000 ₽/год), 10% (Семья, от 50 000 ₽/год)
— Оплата бонусами до 30% от суммы заказа
— Скидка в день рождения: вам и партнёру 5%, детям 10% (±5 дней)
— Лотерея «Сладкий чек»: каждый чек = попытка выиграть iPhone 17 Pro Max, MacBook, PS5, Apple Watch, JBL
— Партнёры клуба: Лука Лаб (−35% на диагностику), Деница (до −16 000 ₽ на ENDYMED), Гардо (брови в подарок), Пряников (ролл в подарок), СТО Просто (замена масла бесплатно), Азатай (−10% на проживание), Real Victory (−30% пн–пт), Тайга (−15% номера)

СТИЛЬ: коротко, тепло, с эмодзи. Язык: русский.`,
        },
        ...messages,
      ],
    });

    const opts: https.RequestOptions = {
      hostname: "api.groq.com",
      path: "/openai/v1/chat/completions",
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_KEY}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(opts, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => {
        try {
          const json = JSON.parse(d);
          const text: string = json.choices?.[0]?.message?.content ?? "";
          if (!text) reject(new Error(json.error?.message ?? "Empty response"));
          else resolve(text);
        } catch (e) {
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
  const { messages } = req.body as {
    messages: { role: string; content: string }[];
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages array is required" });
    return;
  }

  try {
    const text = await groqChat(messages);
    res.json({ text });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Groq error:", msg);
    res.status(502).json({ error: "ИИ недоступен, попробуйте позже" });
  }
});

// Health-check для Render
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// ─── Запуск ─────────────────────────────────────────────────────────────────
async function main() {
  if (WEBHOOK_URL) {
    // Production: webhook
    const webhookPath = `/webhook/${BOT_TOKEN}`;
    app.use(webhookPath, webhookCallback(bot, "express"));
    app.listen(PORT, async () => {
      await bot.api.setWebhook(`${WEBHOOK_URL}${webhookPath}`);
      console.log(`🚀 Server on port ${PORT} | Webhook: ${WEBHOOK_URL}${webhookPath}`);
    });
  } else {
    // Dev: long polling
    app.listen(PORT, () =>
      console.log(`🚀 Server on port ${PORT} (long polling mode)`)
    );
    await bot.start();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

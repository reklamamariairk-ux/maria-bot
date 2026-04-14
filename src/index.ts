import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { Bot, webhookCallback, InlineKeyboard } from "grammy";

// ─── Env ────────────────────────────────────────────────────────────────────
const BOT_TOKEN   = process.env.BOT_TOKEN   ?? "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY ?? "";
const WEBHOOK_URL = process.env.WEBHOOK_URL ?? "";   // https://<your-app>.onrender.com
const PORT        = Number(process.env.PORT ?? 3000);
const MINI_APP_URL = process.env.MINI_APP_URL ?? WEBHOOK_URL;

if (!BOT_TOKEN)    throw new Error("BOT_TOKEN is required");
if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_KEY is required");

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

// 2. Прокси к Anthropic API
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body as {
    messages: { role: "user" | "assistant"; content: string }[];
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages array is required" });
    return;
  }

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: `Ты — дружелюбный ИИ-ассистент кондитерской «Мария».
Помогаешь клиентам выбрать сладости, рассказываешь о составе,
рекомендуешь рецепты, отвечаешь на вопросы о заказе и доставке.
Отвечай коротко, по делу, с эмодзи. Язык: русский.`,
      messages,
    });

    const block = response.content[0];
    const text = block && block.type === "text" ? (block as { type: "text"; text: string }).text : "";
    res.json({ text });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Anthropic error:", msg);
    res.status(502).json({ error: "AI недоступен, попробуйте позже" });
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

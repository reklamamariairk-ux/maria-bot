import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import https from "https";
import cron from "node-cron";
import { Bot, webhookCallback, InlineKeyboard } from "grammy";
import { scrapeCatalog, loadCatalog, searchCatalog, catalogAge, Product } from "./scraper";
import { initDb, addSubscriber, getAllSubscribers, setUserBirthday, getTodayBirthdays, markBirthdayNotified } from "./db";
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
import { requireTgUser, getTgUser } from "./auth";
import { getPartners, getPartnersMeta, syncPartners } from "./partners";
import { fetchLk } from "./lk";

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

bot.command("start", async (ctx) => {
  if (ctx.from) {
    await addSubscriber(ctx.from.id, ctx.from.username, ctx.from.first_name).catch(() => {});

    // Referral payload: /start ref_12345
    const payload = ctx.match?.trim();
    if (payload && payload.startsWith("ref_")) {
      const referrerId = Number(payload.slice(4));
      if (referrerId && referrerId !== ctx.from.id) {
        await recordReferral(referrerId, ctx.from.id).catch(() => {});
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

// ─── Bitrix24 lead ───────────────────────────────────────────────────────────
const BITRIX_WEBHOOK = process.env.BITRIX_WEBHOOK ?? "";

app.post("/api/order", async (req, res) => {
  const { name, phone, description, date, portions, comment } = req.body as {
    name?: string; phone?: string; description?: string;
    date?: string; portions?: string; comment?: string;
  };

  if (!name || !phone) {
    res.status(400).json({ error: "Имя и телефон обязательны" });
    return;
  }

  const title = `Заказ торта — ${name} (Telegram Mini App)`;
  const comments = [
    description && `Торт: ${description}`,
    date        && `Дата: ${date}`,
    portions    && `Порций: ${portions}`,
    comment     && `Комментарий: ${comment}`,
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

app.get("/api/me", requireTgUser, async (req, res) => {
  const u = getTgUser(req)!;
  try {
    await addSubscriber(u.id, u.username, u.first_name).catch(() => {});
    const [verified, balance, daily, myRewards] = await Promise.all([
      isPhoneVerified(u.id),
      getBalance(u.id),
      getDailyStatus(u.id),
      getMyRewards(u.id),
    ]);
    res.json({
      user: { id: u.id, first_name: u.first_name, username: u.username },
      phoneVerified: verified,
      balance,
      daily,
      activeRewards: myRewards.length,
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

app.get("/api/catalog/products", (req, res) => {
  const category = String(req.query.category ?? "").trim();
  const limit = Math.min(Number(req.query.limit ?? 30), 100);
  const offset = Number(req.query.offset ?? 0);

  const filtered = category
    ? catalog.filter((p) => p.category === category)
    : catalog;

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

// ─── Partners ────────────────────────────────────────────────────────────────
app.get("/api/partners", (_req, res) => {
  res.json({ partners: getPartners(), meta: getPartnersMeta() });
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

app.post("/api/partners/sync", async (req, res) => {
  const { token } = req.body as { token?: string };
  if (!token || token !== process.env.ADMIN_TOKEN) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const result = await syncPartners();
  res.json(result);
});

app.get("/health", (_req, res) =>
  res.json({ status: "ok", catalog: catalog.length, partners: getPartnersMeta() })
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

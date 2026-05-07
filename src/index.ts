import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import https from "https";
import cron from "node-cron";
import { Bot, webhookCallback, InlineKeyboard } from "grammy";
import { scrapeCatalog, loadCatalog, searchCatalog, catalogAge, fetchProductById, Product } from "./scraper";
import { initDb, addSubscriber, getAllSubscribers, setUserBirthday, getTodayBirthdays, markBirthdayNotified, touchSubscriber, getSubscriberInfo } from "./db";
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
import { fetchLk } from "./lk";
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
// Каталог обновляем каждый час — синхронизация с правками на сайте
setInterval(refreshCatalog, 60 * 60 * 1000);

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

// ─── Image proxy ────────────────────────────────────────────────────────────
// Прокси картинок товаров с агрессивными cache-заголовками + in-memory hot cache.
// Сами URL содержат хеш в пути → можно отдавать как immutable.
const IMG_CACHE_LIMIT = 64 * 1024 * 1024; // 64 MB — храним только горячие
const IMG_MAX_ITEM    = 2 * 1024 * 1024;  // 2 MB — крупнее не кешируем
interface CachedImg { buf: Buffer; type: string; ts: number; }
const imgCache = new Map<string, CachedImg>();
let imgCacheBytes = 0;

function imgCacheGet(key: string): CachedImg | null {
  const v = imgCache.get(key);
  if (!v) return null;
  // refresh LRU position
  imgCache.delete(key);
  imgCache.set(key, v);
  return v;
}
function imgCachePut(key: string, value: CachedImg) {
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

app.get("/img", (req, res) => {
  const u = String(req.query.u ?? "");
  // Whitelist: только maria-irk.ru
  if (!/^https:\/\/(www\.)?maria-irk\.ru\/upload\//.test(u)) {
    res.status(400).end();
    return;
  }
  const hit = imgCacheGet(u);
  if (hit) {
    res.setHeader("Content-Type", hit.type);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("X-Cache", "HIT");
    res.end(hit.buf);
    return;
  }
  const url = new URL(u);
  const opts: https.RequestOptions = {
    hostname: url.hostname,
    path: url.pathname + url.search,
    headers: { "User-Agent": "MariaBot/1.0 ImgProxy" },
    rejectUnauthorized: false,
  };
  const upstream = https.request(opts, (r) => {
    if ((r.statusCode ?? 0) >= 400) {
      res.status(r.statusCode ?? 502).end();
      r.resume();
      return;
    }
    const type = String(r.headers["content-type"] ?? "image/jpeg");
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("X-Cache", "MISS");
    const chunks: Buffer[] = [];
    let total = 0;
    let stoppedCaching = false;
    r.on("data", (chunk: Buffer) => {
      if (!stoppedCaching) {
        total += chunk.length;
        if (total > IMG_MAX_ITEM) stoppedCaching = true;
        else chunks.push(chunk);
      }
      res.write(chunk);
    });
    r.on("end", () => {
      res.end();
      if (!stoppedCaching && chunks.length) {
        imgCachePut(u, { buf: Buffer.concat(chunks), type, ts: Date.now() });
      }
    });
  });
  upstream.on("error", () => { res.status(502).end(); });
  upstream.setTimeout(15_000, () => { upstream.destroy(); if (!res.headersSent) res.status(504).end(); });
  upstream.end();
});

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

interface GroqErr extends Error { status?: number; rateLimited?: boolean; }

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
            const e: GroqErr = new Error(`Groq rate limit (${status})`);
            e.status = status; e.rateLimited = true;
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
    req.setTimeout(30_000, () => {
      req.destroy();
      const e: GroqErr = new Error("Groq timeout (30s)");
      e.status = 0;
      reject(e);
    });
    req.write(body);
    req.end();
  });
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
    content: `Ты — Маша, тёплый AI-помощник кондитерской «Мария» в Иркутске.

О НАС:
— Сайт maria-irk.ru | Телефон +7 (3952) 50-40-80 | 17 кафе в Иркутске + точки в Ангарске
— 33 года на рынке (с 1993)
— Торт месяца меняется ежемесячно — узнай через search_products (ищи hit:true)
— Клуб «Мария для своих»: кэшбэк 5–10%, оплата бонусами до 30%
— Скидка ко дню рождения: вам −5%, детям −10% (±5 дней)
— Лотерея «Сладкий чек»: каждый чек = шанс на iPhone 17 Pro Max, MacBook, PS5 Slim, Apple Watch, JBL — розыгрыш каждый квартал

КАК РАБОТАТЬ:
— Когда клиент спрашивает про торты/пироги/наборы — ВСЕГДА вызывай search_products чтобы найти РЕАЛЬНЫЕ товары из нашего каталога (247 позиций). Не выдумывай названия.
— Если клиент уточняет «расскажи подробнее» — вызови get_product с ID последнего обсуждаемого товара.
— Когда спрашивают про баллы/счёт/бонусы — вызови check_my_loyalty.
— Когда спрашивают про заказы/историю — вызови get_my_orders.
— Когда спрашивают про скидки у партнёров — list_partners.
— Каталог: ${ctx.catalog.length} активных товаров.

СТИЛЬ:
— Живой, тёплый тон. Без канцелярита.
— Эмодзи умеренно: 1-2 на сообщение.
— Ответы короткие: 2-5 предложений.
— Когда советуешь товар — называй имя и приблизительную цену. Картинку не вставляй текстом — UI покажет карточку под ответом.
— Язык: русский.

ВАЖНО:
— Конкретные товары (имя, цена, вес) бери ТОЛЬКО из ответов tool calls. Без выдумок.
— Если клиент не верифицировал телефон, баланс/заказы недоступны — мягко предложи нажать «Поделиться номером» во вкладке Клуб.`,
  };

  // Обрезаем историю клиента — оставляем последние ~12 сообщений + system,
  // чтобы не упереться в токен-лимит Groq и не плодить долгие запросы.
  const trimmedUser = userMessages.length > 12 ? userMessages.slice(-12) : userMessages;
  const messages: ChatMessage[] = [system, ...trimmedUser];
  const MAX_ITERATIONS = 4;

  let toolsBroken = false;
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    // Для каждой итерации обрезаем messages если они выросли с tool-результатами
    const sendMessages = trimHistory(messages, 18);
    const response = await groqRequest({
      model: "llama-3.3-70b-versatile",
      max_tokens: 1024,
      temperature: 0.6,
      messages: sendMessages,
      ...(toolsBroken ? {} : { tools: TOOL_DEFS, tool_choice: "auto" }),
    });

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
        try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
        const out = await runTool(tc.function.name, args, ctx);
        return { tool_call_id: tc.id, role: "tool" as const, name: tc.function.name, content: out };
      })
    );
    messages.push(...results);
  }

  // Если за MAX_ITERATIONS не успели — финальный запрос без tools
  const final = await groqRequest({
    model: "llama-3.3-70b-versatile",
    max_tokens: 512,
    messages,
  });
  const finalChoice = (final.choices as Array<{ message: ChatMessage }>)?.[0];
  return {
    text: (finalChoice?.message?.content ?? "Извини, не получилось разобраться. Попробуй переформулировать.").trim(),
    products: [...ctx.surfacedProducts.values()],
    cart_actions: ctx.cartActions,
  };
}

app.post("/api/chat", async (req, res) => {
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

// ─── Bitrix24 lead ───────────────────────────────────────────────────────────
const BITRIX_WEBHOOK = process.env.BITRIX_WEBHOOK ?? "";

// Заявка на индивидуальный торт (форма «На заказ» — менеджер свяжется)
app.post("/api/lead", async (req, res) => {
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
    // touchSubscriber заодно бьёт launch_count и last_seen_at; addSubscriber оставлен для совместимости
    await touchSubscriber(u.id, u.username, u.first_name).catch(() => {});
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
  res.json({ count: ORDER_LOG.length, attempts: ORDER_LOG });
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

app.post("/api/order", async (req, res) => {
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
    const data = await new Promise<unknown>((resolve, reject) => {
      const req = https.get(url, { rejectUnauthorized: false }, (r) => {
        let body = ""; r.on("data", (c: Buffer) => body += c);
        r.on("end", () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
      });
      req.on("error", reject);
      req.setTimeout(10_000, () => { req.destroy(); reject(new Error("Timeout")); });
    });
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

/**
 * AI Tools — function calling для Groq.
 *
 * Каждый tool описан в OpenAI-совместимом формате (Groq понимает тот же).
 * Handler принимает arguments + ctx с chatId/catalog, возвращает строку
 * (которая попадёт в next-iteration сообщения как `role: "tool"`).
 */

import type { Product } from "./scraper";
import { fetchProductById } from "./scraper";
import { searchCatalog } from "./scraper";
import { fetchLk } from "./lk";
import { getPartners } from "./partners";

export interface ToolContext {
  chatId: number;
  catalog: Product[];
  /** Товары, которые AI «достал» через инструменты — отдадим во фронт для рендера карточек. */
  surfacedProducts: Map<number, Record<string, unknown>>;
  /** Действия для корзины: {add, id, qty}. Фронт применит к localStorage. */
  cartActions: Array<{ action: "add"; id: number; qty: number; name?: string }>;
}

export const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "search_products",
      description:
          "Ищет товары в каталоге кондитерской «Мария». Может фильтровать по тексту, " +
          "категории, вкусу/начинке (filling) и исключать ингредиенты (exclude). " +
          "Использует поля name, preview, description, filling, cake_type. " +
          "Только доступные товары (available !== false).",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Запрос: «торт шоколадный», «пирог с курицей», «детский набор», «со сметаной»" },
          category: {
            type: "string",
            description: "Опционально: ограничить категорией (Торты, Пироги, Пирожные и десерты, Наборы, Торты на заказ, Для праздника).",
          },
          contains: {
            type: "array",
            items: { type: "string" },
            description: "Опционально: ингредиенты которые ДОЛЖНЫ быть («сметана», «ягода», «сырный крем»).",
          },
          exclude: {
            type: "array",
            items: { type: "string" },
            description: "Опционально: ингредиенты которые НЕ должны быть («орехи», «шоколад», «молоко»). Полезно для аллергиков.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_product",
      description:
          "Возвращает полные детали товара по ID (описание, состав, вес, фото). " +
          "Используй когда клиент уточняет «расскажи подробнее про этот торт».",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number", description: "ID товара (число)" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_categories",
      description: "Возвращает список всех категорий каталога с количеством товаров.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "check_my_loyalty",
      description:
          "Возвращает баланс баллов и билеты «Сладкого чека» текущего пользователя. " +
          "Работает только если пользователь подтвердил телефон. Иначе вернёт {error}.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_orders",
      description:
          "Возвращает последние заказы пользователя с сайта (номер, дата, сумма, состав). " +
          "Работает только при верифицированном телефоне.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "add_to_cart",
      description:
          "Добавляет товар в корзину пользователя. Используй когда клиент явно просит «добавь в корзину», «возьму», «оформляю», «положи мне». " +
          "ID берётся из результатов search_products или get_product.",
      parameters: {
        type: "object",
        properties: {
          product_id: { type: "number", description: "ID товара (из каталога)" },
        },
        required: ["product_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_partners",
      description:
          "Возвращает партнёров клуба «Мария для своих» — заведения, дающие скидки/подарки участникам клуба.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", description: "Опционально: фильтр по категории (Здоровье, Красота, Рестораны, Отдых, Дом, Авто)" },
        },
      },
    },
  },
];

// ─── Handlers ────────────────────────────────────────────────────────────────

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  try {
    switch (name) {
      case "search_products":  return await handleSearch(args, ctx);
      case "get_product":      return await handleGetProduct(args, ctx);
      case "list_categories":  return handleCategories(ctx);
      case "check_my_loyalty": return await handleLoyalty(ctx);
      case "get_my_orders":    return await handleOrders(args, ctx);
      case "list_partners":    return handlePartners(args);
      case "add_to_cart":      return await handleAddToCart(args, ctx);
      default:                 return JSON.stringify({ error: `unknown_tool:${name}` });
    }
  } catch (e) {
    return JSON.stringify({ error: (e as Error).message });
  }
}

function summarizeProduct(p: Product | Record<string, unknown>): Record<string, unknown> {
  const id = (p as { id?: number }).id;
  const name = (p as { name?: string }).name;
  const category = (p as { category?: string }).category;
  const price = (p as { price?: string; priceNumber?: number }).priceNumber
    ?? (p as { price?: string }).price;
  const oldPrice = (p as { oldPriceNumber?: number; oldPrice?: string }).oldPriceNumber
    ?? (p as { oldPrice?: string }).oldPrice;
  const discountPercent = (p as { discountPercent?: number }).discountPercent;
  const weight = (p as { weight?: string | null }).weight;
  const persons = (p as { persons?: string | null }).persons;
  const hit = (p as { hit?: boolean }).hit;
  const url = (p as { url?: string }).url;
  const image = (p as { image?: string }).image;
  const out: Record<string, unknown> = { id, name, category, price, weight, persons, hit, url, image };
  if (oldPrice && discountPercent && discountPercent > 0) {
    out.oldPrice = oldPrice;
    out.discountPercent = discountPercent;
  }
  return out;
}

async function handleSearch(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const query = String(args.query ?? "").trim();
  const category = args.category ? String(args.category) : "";
  const contains = Array.isArray(args.contains) ? (args.contains as unknown[]).map((s) => String(s).toLowerCase().trim()).filter(Boolean) : [];
  const exclude  = Array.isArray(args.exclude)  ? (args.exclude  as unknown[]).map((s) => String(s).toLowerCase().trim()).filter(Boolean) : [];
  const limit = Math.max(1, Math.min(10, Number(args.limit ?? 5)));

  // available:false означает «нет в кафе» (актуально для заказных тортов),
  // но НЕ означает что товар недоступен — заказные торты можно заказать.
  let pool = ctx.catalog.slice();
  if (category) {
    const lc = category.toLowerCase();
    pool = pool.filter((p) => p.category.toLowerCase().includes(lc));
  }

  // Вспомогательная функция: вернёт «всё что знаем о составе» в одну строку
  const productText = (p: Product): string => {
    return [p.name, p.preview, p.weight, p.persons].filter(Boolean).join(" ").toLowerCase();
  };

  // Filter: должен содержать ВСЕ слова из contains
  if (contains.length) {
    pool = pool.filter((p) => {
      const text = productText(p);
      return contains.every((c) => text.includes(c));
    });
  }
  // Filter: НЕ должен содержать ни одного из exclude
  if (exclude.length) {
    pool = pool.filter((p) => {
      const text = productText(p);
      return !exclude.some((e) => text.includes(e));
    });
  }

  const found = searchCatalog(pool, query || "", limit);
  for (const p of found) {
    if (p.id) ctx.surfacedProducts.set(p.id, summarizeProduct(p));
  }
  return JSON.stringify({
    query, category: category || null,
    contains: contains.length ? contains : undefined,
    exclude: exclude.length ? exclude : undefined,
    count: found.length,
    products: found.map(summarizeProduct),
  });
}

async function handleGetProduct(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const id = Number(args.id ?? 0);
  if (!id) return JSON.stringify({ error: "bad_id" });
  const remote = await fetchProductById(id);
  if (remote) {
    ctx.surfacedProducts.set(id, summarizeProduct({ ...remote, id }));
    return JSON.stringify({
      id,
      name: remote.name,
      price: remote.price,
      currency: remote.currency,
      weight: remote.weight,
      persons: remote.persons,
      hit: remote.hit,
      available: remote.available,
      description: remote.description_text || remote.preview,
      filling: remote.filling,
      cake_type: remote.cake_type,
      pie_type: remote.pie_type,
      dessert_type: remote.dessert_type,
      occasion: remote.occasion,
      whom: remote.whom,
      url: remote.url,
      images: remote.images,
    });
  }
  // Fallback to in-memory catalog
  const local = ctx.catalog.find((p) => p.id === id);
  if (!local) return JSON.stringify({ error: "not_found" });
  ctx.surfacedProducts.set(id, summarizeProduct(local));
  return JSON.stringify(summarizeProduct(local));
}

function handleCategories(ctx: ToolContext): string {
  const counts = new Map<string, number>();
  for (const p of ctx.catalog) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  const list = [...counts.entries()].map(([name, count]) => ({ name, count }));
  return JSON.stringify({ categories: list, total: ctx.catalog.length });
}

async function handleLoyalty(ctx: ToolContext): Promise<string> {
  const r = await fetchLk(ctx.chatId);
  if (!r.ok) return JSON.stringify({ error: r.reason ?? "service_error" });
  const d = r.data;
  if (!d) return JSON.stringify({ error: "no_data" });
  if (!d.configured) return JSON.stringify({ configured: false, hint: "LK не настроен" });
  return JSON.stringify({
    configured: true,
    found: d.found,
    name: d.name,
    level: d.level,
    balance: d.balance,
    tickets_count: d.tickets_count,
    sweet_check: (d as { tickets_count?: number }).tickets_count ?? 0,
  });
}

async function handleOrders(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const r = await fetchLk(ctx.chatId);
  if (!r.ok) return JSON.stringify({ error: r.reason ?? "service_error" });
  const d = r.data as Record<string, unknown> | undefined;
  if (!d || !d.configured) return JSON.stringify({ configured: false });
  const orders = Array.isArray(d.orders) ? (d.orders as Record<string, unknown>[]) : [];
  const limit = Math.max(1, Math.min(10, Number(args.limit ?? 5)));
  return JSON.stringify({
    count: orders.length,
    orders: orders.slice(0, limit).map((o) => ({
      id: o.id,
      date: o.date,
      sum: o.sum,
      status: o.status,
      paid: o.paid,
      items: Array.isArray(o.items) ? (o.items as Array<{name: string; qty: number}>).slice(0, 5).map(i => `${i.qty}× ${i.name}`).join(", ") : "",
    })),
  });
}

async function handleAddToCart(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const id = Number(args.product_id ?? args.id ?? 0);
  if (!id) return JSON.stringify({ ok: false, error: "bad_id" });

  // Загружаем актуальные данные товара (если не из памяти)
  let name: string | undefined;
  let price: number | null = null;
  let image: string | undefined;

  const inMem = ctx.catalog.find((p) => p.id === id);
  if (inMem) {
    name  = inMem.name;
    price = inMem.priceNumber ?? null;
    image = inMem.image;
  } else {
    const remote = await fetchProductById(id);
    if (remote) {
      name  = String(remote.name ?? "");
      price = remote.price != null ? Number(remote.price) : null;
      const imgs = remote.images as string[] | undefined;
      image = Array.isArray(imgs) ? imgs[0] : undefined;
    }
  }

  if (!name) return JSON.stringify({ ok: false, error: "not_found" });

  ctx.cartActions.push({ action: "add", id, qty: 1, name });
  ctx.surfacedProducts.set(id, { id, name, price, image, hit: false });

  return JSON.stringify({ ok: true, added: { id, name, qty: 1 } });
}

function handlePartners(args: Record<string, unknown>): string {
  const cat = args.category ? String(args.category).trim().toLowerCase() : "";
  let list = getPartners();
  if (cat) {
    list = list.filter((p) => {
      const pc = (p as unknown as { category?: string }).category;
      return pc && String(pc).toLowerCase().includes(cat);
    });
  }
  return JSON.stringify({
    count: list.length,
    partners: list.slice(0, 20).map((p) => {
      const o = p as unknown as { category?: string; url?: string };
      return {
        name: p.name,
        perk: p.perk,
        desc: p.desc,
        category: o.category ?? null,
        url: o.url ?? null,
      };
    }),
  });
}

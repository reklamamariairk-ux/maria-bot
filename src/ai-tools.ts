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

// Compact tool defs — каждое описание ужато для экономии Groq TPM (~600 ткн вместо ~1500)
export const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "search_products",
      description: "Поиск товаров. contains — что должно быть, exclude — чего быть не должно (для аллергий).",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          category: { type: "string" },
          contains: { type: "array", items: { type: "string" } },
          exclude: { type: "array", items: { type: "string" } },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_product",
      description: "Детали товара по ID.",
      parameters: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
    },
  },
  {
    type: "function",
    function: { name: "list_categories", description: "Категории каталога.", parameters: { type: "object", properties: {} } },
  },
  {
    type: "function",
    function: { name: "check_my_loyalty", description: "Баллы и билеты юзера (нужен verified phone).", parameters: { type: "object", properties: {} } },
  },
  {
    type: "function",
    function: { name: "get_my_orders", description: "Заказы юзера (нужен verified phone).", parameters: { type: "object", properties: {} } },
  },
  {
    type: "function",
    function: {
      name: "add_to_cart",
      description: "Добавить в корзину. ID берётся из search_products/get_product.",
      parameters: { type: "object", properties: { product_id: { type: "number" } }, required: ["product_id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_partners",
      description: "Партнёры клуба (со скидками).",
      parameters: { type: "object", properties: { category: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: { name: "get_today_special", description: "Торт месяца со скидкой 20%.", parameters: { type: "object", properties: {} } },
  },
  {
    type: "function",
    function: { name: "get_cake_types", description: "Типы тортов с количеством.", parameters: { type: "object", properties: {} } },
  },
];

// ─── Кэш результатов tool-ов ─────────────────────────────────────────────────
// Снижает Groq TPM расход (повторный вопрос → мгновенный ответ из кэша).
// Кэшируем только pure (без юзер-контекста) и ненатурально-меняющиеся данные.
// add_to_cart, check_my_loyalty, get_my_orders — НЕ кэшируем.
type CacheEntry = { result: string; surfaced: Array<[number, Record<string, unknown>]>; expiresAt: number };
const TOOL_CACHE = new Map<string, CacheEntry>();
const TOOL_CACHE_MAX = 200;
const TOOL_CACHE_TTL = 60_000; // 60 сек
const CACHEABLE = new Set([
  "search_products", "get_product", "list_categories",
  "list_partners", "get_today_special", "get_cake_types",
]);

function cacheKey(name: string, args: Record<string, unknown>): string {
  // Стабильная сериализация: сортируем ключи, чтобы {a:1,b:2} === {b:2,a:1}
  const keys = Object.keys(args).sort();
  const ordered: Record<string, unknown> = {};
  for (const k of keys) ordered[k] = args[k];
  return `${name}::${JSON.stringify(ordered)}`;
}

function cacheGet(key: string): CacheEntry | null {
  const e = TOOL_CACHE.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) { TOOL_CACHE.delete(key); return null; }
  // LRU: переместить в конец
  TOOL_CACHE.delete(key);
  TOOL_CACHE.set(key, e);
  return e;
}

function cacheSet(key: string, result: string, surfaced: Array<[number, Record<string, unknown>]>): void {
  if (TOOL_CACHE.size >= TOOL_CACHE_MAX) {
    // Удаляем самый старый (первый в Map — это insertion order)
    const oldestKey = TOOL_CACHE.keys().next().value;
    if (oldestKey !== undefined) TOOL_CACHE.delete(oldestKey);
  }
  TOOL_CACHE.set(key, { result, surfaced, expiresAt: Date.now() + TOOL_CACHE_TTL });
}

// ─── Handlers ────────────────────────────────────────────────────────────────

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  // Кэш-хит → реплеим side-effect (surfacedProducts) и возвращаем сохранённый JSON
  const useCache = CACHEABLE.has(name);
  const key = useCache ? cacheKey(name, args) : "";
  if (useCache) {
    const hit = cacheGet(key);
    if (hit) {
      for (const [id, summary] of hit.surfaced) ctx.surfacedProducts.set(id, summary);
      return hit.result;
    }
  }

  try {
    // Запоминаем какие товары уже были в surfacedProducts ДО этого хендлера —
    // чтобы кэшировать только diff (то что добавил именно этот вызов).
    const beforeIds = new Set(ctx.surfacedProducts.keys());
    let result: string;
    switch (name) {
      case "search_products":   result = await handleSearch(args, ctx); break;
      case "get_product":       result = await handleGetProduct(args, ctx); break;
      case "list_categories":   result = handleCategories(ctx); break;
      case "check_my_loyalty":  result = await handleLoyalty(ctx); break;
      case "get_my_orders":     result = await handleOrders(args, ctx); break;
      case "list_partners":     result = handlePartners(args); break;
      case "add_to_cart":       result = await handleAddToCart(args, ctx); break;
      case "get_today_special": result = handleTodaySpecial(ctx); break;
      case "get_cake_types":    result = handleCakeTypes(ctx); break;
      default:                  result = JSON.stringify({ error: `unknown_tool:${name}` });
    }
    if (useCache) {
      const surfaced: Array<[number, Record<string, unknown>]> = [];
      for (const [id, summary] of ctx.surfacedProducts.entries()) {
        if (!beforeIds.has(id)) surfaced.push([id, summary]);
      }
      cacheSet(key, result, surfaced);
    }
    return result;
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
  // Нормализация: латинские гомоглифы → кириллица + lowercase
  const HG: Record<string, string> = {a:"а",b:"в",c:"с",e:"е",h:"н",k:"к",m:"м",o:"о",p:"р",t:"т",x:"х",y:"у"};
  const norm = (s: string) => s.toLowerCase().replace(/[a-z]/g, (c) => HG[c] || c);

  const contains = Array.isArray(args.contains) ? (args.contains as unknown[]).map((s) => norm(String(s).trim())).filter(Boolean) : [];
  const exclude  = Array.isArray(args.exclude)  ? (args.exclude  as unknown[]).map((s) => norm(String(s).trim())).filter(Boolean) : [];
  const limit = Math.max(1, Math.min(10, Number(args.limit ?? 5)));

  // available:false означает «нет в кафе» (актуально для заказных тортов),
  // но НЕ означает что товар недоступен — заказные торты можно заказать.
  let pool = ctx.catalog.slice();
  if (category) {
    const lc = norm(category);
    pool = pool.filter((p) => norm(p.category).includes(lc));
  }

  // Вспомогательная функция: вернёт «всё что знаем о товаре» в одну нормализованную строку
  const productText = (p: Product): string => {
    return norm([
      p.name, p.preview, p.weight, p.persons,
      ...(p.filling || []),
      ...(p.cake_type || []),
      ...(p.pie_type || []),
      ...(p.dessert_type || []),
      ...(p.occasion || []),
    ].filter(Boolean).join(" "));
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

function handleTodaySpecial(ctx: ToolContext): string {
  // Торт месяца: hit:true в категории Торты с скидкой
  const candidates = ctx.catalog.filter((p) =>
    p.hit && p.category === "Торты" && (p.discountPercent ?? 0) > 0
  );
  if (candidates.length === 0) {
    // Fallback — просто первый hit
    const fallback = ctx.catalog.find((p) => p.hit && p.category === "Торты");
    if (!fallback) return JSON.stringify({ error: "no_special" });
    if (fallback.id) ctx.surfacedProducts.set(fallback.id, summarizeProduct(fallback));
    return JSON.stringify({ ...summarizeProduct(fallback), is_today_special: true });
  }
  // Берём первого со скидкой (обычно скидка применяется только на одного)
  const c = candidates[0];
  if (c.id) ctx.surfacedProducts.set(c.id, summarizeProduct(c));
  return JSON.stringify({ ...summarizeProduct(c), is_today_special: true });
}

function handleCakeTypes(ctx: ToolContext): string {
  const counts = new Map<string, number>();
  for (const p of ctx.catalog) {
    for (const t of p.cake_type ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const list = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, count }));
  return JSON.stringify({ cake_types: list, total: list.reduce((s, t) => s + t.count, 0) });
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

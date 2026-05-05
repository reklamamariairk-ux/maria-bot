"use strict";
/**
 * AI Tools — function calling для Groq.
 *
 * Каждый tool описан в OpenAI-совместимом формате (Groq понимает тот же).
 * Handler принимает arguments + ctx с chatId/catalog, возвращает строку
 * (которая попадёт в next-iteration сообщения как `role: "tool"`).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOL_DEFS = void 0;
exports.runTool = runTool;
const scraper_1 = require("./scraper");
const scraper_2 = require("./scraper");
const lk_1 = require("./lk");
const partners_1 = require("./partners");
exports.TOOL_DEFS = [
    {
        type: "function",
        function: {
            name: "search_products",
            description: "Ищет товары в каталоге кондитерской «Мария» по тексту запроса " +
                "(название, ингредиенты, повод). Используй при вопросе клиента про конкретный десерт.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Запрос: «торт шоколадный», «пирог с курицей», «детский набор»" },
                    category: {
                        type: "string",
                        description: "Опционально: ограничить категорией (Торты, Пироги, Пирожные и десерты, Наборы, Торты на заказ, Для праздника, Пасха).",
                    },
                    limit: { type: "number", description: "Сколько вернуть (по умолчанию 5, максимум 10)" },
                },
                required: ["query"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_product",
            description: "Возвращает полные детали товара по ID (описание, состав, вес, фото). " +
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
            description: "Возвращает баланс баллов и билеты «Сладкого чека» текущего пользователя. " +
                "Работает только если пользователь подтвердил телефон. Иначе вернёт {error}.",
            parameters: { type: "object", properties: {} },
        },
    },
    {
        type: "function",
        function: {
            name: "get_my_orders",
            description: "Возвращает последние заказы пользователя с сайта (номер, дата, сумма, состав). " +
                "Работает только при верифицированном телефоне.",
            parameters: {
                type: "object",
                properties: {
                    limit: { type: "number", description: "Сколько вернуть (по умолчанию 5)" },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "list_partners",
            description: "Возвращает партнёров клуба «Мария для своих» — заведения, дающие скидки/подарки участникам клуба.",
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
async function runTool(name, args, ctx) {
    try {
        switch (name) {
            case "search_products": return await handleSearch(args, ctx);
            case "get_product": return await handleGetProduct(args, ctx);
            case "list_categories": return handleCategories(ctx);
            case "check_my_loyalty": return await handleLoyalty(ctx);
            case "get_my_orders": return await handleOrders(args, ctx);
            case "list_partners": return handlePartners(args);
            default: return JSON.stringify({ error: `unknown_tool:${name}` });
        }
    }
    catch (e) {
        return JSON.stringify({ error: e.message });
    }
}
function summarizeProduct(p) {
    const id = p.id;
    const name = p.name;
    const category = p.category;
    const price = p.priceNumber
        ?? p.price;
    const weight = p.weight;
    const persons = p.persons;
    const hit = p.hit;
    const url = p.url;
    const image = p.image;
    return { id, name, category, price, weight, persons, hit, url, image };
}
async function handleSearch(args, ctx) {
    const query = String(args.query ?? "").trim();
    const category = args.category ? String(args.category) : "";
    const limit = Math.max(1, Math.min(10, Number(args.limit ?? 5)));
    let pool = ctx.catalog;
    if (category) {
        const lc = category.toLowerCase();
        pool = pool.filter((p) => p.category.toLowerCase().includes(lc));
    }
    const found = (0, scraper_2.searchCatalog)(pool, query, limit);
    for (const p of found) {
        if (p.id)
            ctx.surfacedProducts.set(p.id, summarizeProduct(p));
    }
    return JSON.stringify({
        query, category: category || null, count: found.length,
        products: found.map(summarizeProduct),
    });
}
async function handleGetProduct(args, ctx) {
    const id = Number(args.id ?? 0);
    if (!id)
        return JSON.stringify({ error: "bad_id" });
    const remote = await (0, scraper_1.fetchProductById)(id);
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
    if (!local)
        return JSON.stringify({ error: "not_found" });
    ctx.surfacedProducts.set(id, summarizeProduct(local));
    return JSON.stringify(summarizeProduct(local));
}
function handleCategories(ctx) {
    const counts = new Map();
    for (const p of ctx.catalog)
        counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    const list = [...counts.entries()].map(([name, count]) => ({ name, count }));
    return JSON.stringify({ categories: list, total: ctx.catalog.length });
}
async function handleLoyalty(ctx) {
    const r = await (0, lk_1.fetchLk)(ctx.chatId);
    if (!r.ok)
        return JSON.stringify({ error: r.reason ?? "service_error" });
    const d = r.data;
    if (!d)
        return JSON.stringify({ error: "no_data" });
    if (!d.configured)
        return JSON.stringify({ configured: false, hint: "LK не настроен" });
    return JSON.stringify({
        configured: true,
        found: d.found,
        name: d.name,
        level: d.level,
        balance: d.balance,
        tickets_count: d.tickets_count,
        sweet_check: d.tickets_count ?? 0,
    });
}
async function handleOrders(args, ctx) {
    const r = await (0, lk_1.fetchLk)(ctx.chatId);
    if (!r.ok)
        return JSON.stringify({ error: r.reason ?? "service_error" });
    const d = r.data;
    if (!d || !d.configured)
        return JSON.stringify({ configured: false });
    const orders = Array.isArray(d.orders) ? d.orders : [];
    const limit = Math.max(1, Math.min(10, Number(args.limit ?? 5)));
    return JSON.stringify({
        count: orders.length,
        orders: orders.slice(0, limit).map((o) => ({
            id: o.id,
            date: o.date,
            sum: o.sum,
            status: o.status,
            paid: o.paid,
            items: Array.isArray(o.items) ? o.items.slice(0, 5).map(i => `${i.qty}× ${i.name}`).join(", ") : "",
        })),
    });
}
function handlePartners(args) {
    const cat = args.category ? String(args.category).trim().toLowerCase() : "";
    let list = (0, partners_1.getPartners)();
    if (cat) {
        list = list.filter((p) => {
            const pc = p.category;
            return pc && String(pc).toLowerCase().includes(cat);
        });
    }
    return JSON.stringify({
        count: list.length,
        partners: list.slice(0, 20).map((p) => {
            const o = p;
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

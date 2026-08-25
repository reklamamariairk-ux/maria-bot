"use strict";
/**
 * Catalog routes — публичные read-only эндпоинты каталога товаров.
 *
 * Эндпоинты:
 * - GET /api/catalog/categories     список категорий с количеством + sample-фото
 * - GET /api/catalog/products       пагинация + фильтр diet (vegan, gluten-free, etc)
 * - GET /api/catalog/search?q=...   нечёткий поиск
 * - GET /api/catalog/product/:id    одиночный товар (свежие данные через fetchProductById,
 *                                    подмешиваем dietary из in-memory каталога)
 *
 * Принимает getter `() => Product[]` чтобы router использовал актуальный
 * катаglobal in-memory массив (refreshCatalog в src/index.ts его обновляет).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCatalogRouter = createCatalogRouter;
const express_1 = require("express");
const scraper_1 = require("../scraper");
const middleware_1 = require("../middleware");
function createCatalogRouter(deps) {
    const { getCatalog, catalogAge } = deps;
    const router = (0, express_1.Router)();
    router.get("/api/catalog/categories", (0, middleware_1.rateLimit)(120), (_req, res) => {
        const catalog = getCatalog();
        const counts = new Map();
        for (const p of catalog)
            counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
        const categories = Array.from(counts.entries()).map(([name, count]) => {
            const sample = catalog.find((p) => p.category === name && p.image);
            return { name, count, sample: sample?.image ?? null };
        });
        res.json({ categories, total: catalog.length, updated: catalogAge() });
    });
    // ВАЖНО: НЕ фильтруем по available. В Bitrix available:false ставится для
    // заказных тортов («Торт под заказ Подарок» и пр.) — их физически нет в кафе,
    // но они доступны под заказ. Скрывать их нельзя.
    router.get("/api/catalog/products", (0, middleware_1.rateLimit)(60), (req, res) => {
        const catalog = getCatalog();
        const category = String(req.query.category ?? "").trim();
        const limit = Math.min(Number(req.query.limit ?? 30), 100);
        const offset = Number(req.query.offset ?? 0);
        // diet=vegan,sugar-free — товар должен содержать ВСЕ переданные теги
        const diet = String(req.query.diet ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        let filtered = catalog.slice();
        if (category)
            filtered = filtered.filter((p) => p.category === category);
        if (diet.length > 0) {
            filtered = filtered.filter((p) => {
                const tags = p.dietary || [];
                return diet.every((d) => tags.includes(d));
            });
        }
        const products = filtered.slice(offset, offset + limit);
        res.json({ products, total: filtered.length, limit, offset });
    });
    router.get("/api/catalog/search", (0, middleware_1.rateLimit)(30), (req, res) => {
        const q = String(req.query.q ?? "").trim();
        if (!q) {
            res.json({ products: [], total: 0 });
            return;
        }
        const products = (0, scraper_1.searchCatalog)(getCatalog(), q, 30);
        res.json({ products, total: products.length });
    });
    router.get("/api/catalog/product/:id", (0, middleware_1.rateLimit)(120), async (req, res) => {
        const id = Number(req.params.id);
        if (!id) {
            res.status(400).json({ error: "bad_id" });
            return;
        }
        const product = await (0, scraper_1.fetchProductById)(id);
        if (!product) {
            res.status(404).json({ error: "not_found" });
            return;
        }
        // Подмешиваем dietary из in-memory каталога (где разметка уже сделана)
        const fromCache = getCatalog().find((p) => p.id === id);
        if (fromCache?.dietary && fromCache.dietary.length > 0) {
            product.dietary = fromCache.dietary;
        }
        res.json({ product });
    });
    return router;
}

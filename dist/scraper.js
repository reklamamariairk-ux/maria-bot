"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.reloadDietaryOverrides = reloadDietaryOverrides;
exports.detectDietary = detectDietary;
exports.scrapeCatalog = scrapeCatalog;
exports.fetchProductById = fetchProductById;
exports.loadCatalog = loadCatalog;
exports.catalogAge = catalogAge;
exports.searchCatalog = searchCatalog;
const https_1 = __importDefault(require("https"));
const cheerio = __importStar(require("cheerio"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// ─── Config ──────────────────────────────────────────────────────────────────
const BASE = "https://www.maria-irk.ru";
const DATA_DIR = path_1.default.join(__dirname, "..", "data");
const DATA_FILE = path_1.default.join(DATA_DIR, "catalog.json");
const DIETARY_OVERRIDES_FILE = path_1.default.join(DATA_DIR, "dietary-overrides.json");
const CATALOG_API = process.env.CATALOG_API ?? "";
const CATALOG_TOKEN = process.env.CATALOG_TOKEN ?? "";
// ─── Dietary detection ──────────────────────────────────────────────────────
// Ключевые слова для авто-разметки. Стараемся не давать false-positive:
// только явные «без X» формулировки и устоявшиеся термины.
// ВАЖНО: \b в JS regex работает только с латиницей. Для кириллических
// границ слова используем (?<![а-яёa-z])…(?![а-яёa-z]) — это поддерживается
// с Node 10+ (es2018 lookbehind). Без lookaround были бы false-positive
// типа «непостный» → vegan.
const DIETARY_KEYWORDS = {
    "sugar-free": [
        /без\s*сахар/i,
        /no\s*sugar/i,
        /(?<![а-яёa-z])стеви/i,
        /без\s*подсласт/i,
    ],
    "gluten-free": [
        /без\s*глютен/i,
        /безглютен/i,
        /gluten[\s-]*free/i,
        /из\s*миндальной\s*муки/i,
    ],
    "vegan": [
        /(?<![а-яёa-z])веган/i,
        /\bvegan\b/i,
        /(?<![а-яёa-z])постн(ый|ая|ое|ые|ого|ому|ыми)/i,
    ],
    "lactose-free": [
        /без\s*лактоз/i,
        /lactose[\s-]*free/i,
        /без\s*молочк/i,
    ],
    "low-cal": [
        /(?<![а-яёa-z])пп(?![а-яёa-z])/i,
        /пп[\s-]*десерт/i,
        /пп[\s-]*торт/i,
        /низкокалорий/i,
        /(?<![а-яёa-z])лёгк(ий|ая|ое|ие)(?![а-яёa-z])/i,
        /\bfit(ness)?\b/i,
        /(?<![а-яёa-z])диет/i,
    ],
    "nut-free": [
        /без\s*орех/i,
        /nut[\s-]*free/i,
    ],
};
let _dietaryOverridesCache = null;
function loadDietaryOverrides() {
    if (_dietaryOverridesCache)
        return _dietaryOverridesCache;
    try {
        if (fs_1.default.existsSync(DIETARY_OVERRIDES_FILE)) {
            const raw = fs_1.default.readFileSync(DIETARY_OVERRIDES_FILE, "utf-8");
            _dietaryOverridesCache = JSON.parse(raw);
            return _dietaryOverridesCache;
        }
    }
    catch (e) {
        console.error("[dietary-overrides] load failed:", e.message);
    }
    _dietaryOverridesCache = {};
    return _dietaryOverridesCache;
}
// Сбросить кэш — для админ-эндпоинта перезагрузки overrides без рестарта
function reloadDietaryOverrides() {
    _dietaryOverridesCache = null;
}
function detectDietary(p) {
    const text = [
        p.name || "",
        p.preview || "",
        ...(p.filling || []),
        ...(p.cake_type || []),
        ...(p.pie_type || []),
        ...(p.dessert_type || []),
    ].join(" ");
    const tags = new Set();
    for (const tag of Object.keys(DIETARY_KEYWORDS)) {
        if (DIETARY_KEYWORDS[tag].some((re) => re.test(text)))
            tags.add(tag);
    }
    // Apply overrides
    const ov = loadDietaryOverrides();
    const idKey = String(p.id ?? "");
    if (idKey && ov.byId?.[idKey])
        return [...ov.byId[idKey]];
    if (idKey && ov.add?.[idKey])
        for (const t of ov.add[idKey])
            tags.add(t);
    if (idKey && ov.remove?.[idKey])
        for (const t of ov.remove[idKey])
            tags.delete(t);
    return [...tags];
}
function applyDietaryTags(products) {
    return products.map((p) => {
        const dietary = detectDietary(p);
        return dietary.length > 0 ? { ...p, dietary } : p;
    });
}
const PAGES = [
    { path: "/cakes/", cat: "Торты" },
    { path: "/pies/", cat: "Пироги" },
    { path: "/cakes-and-desserts/", cat: "Пирожные" },
    { path: "/sets/", cat: "Наборы" },
    { path: "/cakes-to-order/", cat: "Торты на заказ" },
    { path: "/products/", cat: "Для праздника" },
];
// ─── HTTP helper ─────────────────────────────────────────────────────────────
function fetchHtml(url) {
    return new Promise((resolve, reject) => {
        const req = https_1.default.get(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (compatible; MariaBot/1.0)",
                "Accept-Language": "ru-RU,ru;q=0.9",
                "Accept": "text/html",
            },
            rejectUnauthorized: false, // сайт имеет проблемы с цепочкой сертификатов
        }, (res) => {
            // Обрабатываем редиректы
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                fetchHtml(res.headers.location).then(resolve).catch(reject);
                return;
            }
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        });
        req.on("error", reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error("Timeout")); });
    });
}
// ─── Parser ───────────────────────────────────────────────────────────────────
function parsePage(html, category) {
    const $ = cheerio.load(html);
    const products = [];
    $('[data-entity="item"]').each((_, el) => {
        // Вариант 1: стандартная карточка — имя в h3 > a
        let name = $(el).find("h3 a").first().text().trim();
        let href = $(el).find("h3 a").first().attr("href") ?? "";
        // Вариант 2: карточка набора — имя в alt первой картинки
        if (!name) {
            name = $(el).find("img").first().attr("alt")?.trim() ?? "";
            href = $(el).find("a").first().attr("href") ?? "";
        }
        if (!name)
            return;
        const url = href.startsWith("http") ? href : (href ? BASE + href : "");
        // Цена — в [data-entity="price-block"] p
        const price = $(el).find('[data-entity="price-block"] p').first()
            .text().trim().replace(/\s+/g, " ");
        // Картинка — первый img в карточке с src /upload/...
        let image;
        $(el).find("img").each((_i, img) => {
            const src = $(img).attr("src") ?? $(img).attr("data-src") ?? "";
            if (src && src.includes("/upload/") && !image) {
                image = src.startsWith("http") ? src : BASE + src;
            }
        });
        products.push({ name, category, price, url, image });
    });
    return products;
}
// ─── Fetch JSON helper ───────────────────────────────────────────────────────
function fetchJson(url, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
        const req = https_1.default.get(url, { rejectUnauthorized: false }, (r) => {
            let body = "";
            r.on("data", (c) => (body += c));
            r.on("end", () => {
                try {
                    resolve(JSON.parse(body));
                }
                catch (e) {
                    reject(e);
                }
            });
        });
        req.on("error", reject);
        req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error("Timeout")); });
    });
}
// Retry helper — для медленных первых запросов (cold cache)
async function fetchJsonWithRetry(url, attempts = 3, timeoutMs = 60000) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fetchJson(url, timeoutMs);
        }
        catch (e) {
            lastErr = e;
            console.warn(`[fetch] attempt ${i + 1}/${attempts} failed:`, e.message);
            if (i < attempts - 1)
                await new Promise((r) => setTimeout(r, 2000));
        }
    }
    throw lastErr;
}
// ─── API source — читаем из /api/catalog.php ────────────────────────────────
async function fetchFromApi() {
    const sep = CATALOG_API.includes("?") ? "&" : "?";
    const url = `${CATALOG_API}${sep}token=${encodeURIComponent(CATALOG_TOKEN)}&limit=500`;
    const raw = (await fetchJsonWithRetry(url, 3, 60000));
    const sections = Array.isArray(raw.sections) ? raw.sections : [];
    const sectionById = new Map(sections.map(s => [s.id, s]));
    const arr = Array.isArray(raw.products) ? raw.products : [];
    return arr.map((p) => {
        const sid = Number(p.section_id ?? 0);
        const sec = sectionById.get(sid);
        const priceNumber = p.price == null ? null : Number(p.price);
        const priceStr = priceNumber != null ? `${priceNumber.toLocaleString("ru-RU")} ₽` : "";
        const oldPriceNumber = p.oldPrice == null ? null : Number(p.oldPrice);
        const oldPriceStr = oldPriceNumber != null ? `${oldPriceNumber.toLocaleString("ru-RU")} ₽` : "";
        const discountPercent = p.discountPercent != null ? Number(p.discountPercent) : 0;
        return {
            id: Number(p.id),
            name: String(p.name ?? ""),
            category: sec?.name ?? "Каталог",
            price: priceStr,
            priceNumber,
            oldPrice: oldPriceStr || undefined,
            oldPriceNumber,
            discountPercent: discountPercent || undefined,
            currency: String(p.currency ?? "RUB"),
            url: String(p.url ?? ""),
            image: p.image ? String(p.image) : undefined,
            weight: p.weight ? String(p.weight) : null,
            persons: p.persons ? String(p.persons) : null,
            hit: Boolean(p.hit),
            available: p.available !== false,
            preview: p.preview ? String(p.preview) : "",
            sectionCode: sec?.code,
            sectionId: sid,
            occasion: Array.isArray(p.occasion) ? p.occasion.map(String) : undefined,
            filling: Array.isArray(p.filling) ? p.filling.map(String) : undefined,
            cake_type: Array.isArray(p.cake_type) ? p.cake_type.map(String) : undefined,
            pie_type: Array.isArray(p.pie_type) ? p.pie_type.map(String) : undefined,
            dessert_type: Array.isArray(p.dessert_type) ? p.dessert_type.map(String) : undefined,
            whom: Array.isArray(p.whom) ? p.whom.map(String) : undefined,
        };
    });
}
// ─── Scrape all pages (legacy fallback) ─────────────────────────────────────
async function scrapeFromSite() {
    console.log("🔄 Скрейпинг каталога maria-irk.ru (fallback)...");
    const all = [];
    for (const page of PAGES) {
        try {
            const html = await fetchHtml(BASE + page.path);
            const products = parsePage(html, page.cat);
            console.log(`  ✅ ${page.cat}: ${products.length} позиций`);
            all.push(...products);
            await new Promise((r) => setTimeout(r, 600));
        }
        catch (err) {
            console.error(`  ❌ Ошибка ${page.path}:`, err.message);
        }
    }
    return all;
}
// ─── Public: получить каталог (API → fallback scraping) ─────────────────────
async function scrapeCatalog() {
    let all = [];
    let source = "scrape";
    if (CATALOG_API && CATALOG_TOKEN) {
        try {
            all = await fetchFromApi();
            source = "bitrix";
            console.log(`✅ Каталог из API: ${all.length} позиций`);
        }
        catch (err) {
            console.error("[CATALOG_API] failed, fallback to scrape:", err.message);
        }
    }
    if (all.length === 0) {
        all = await scrapeFromSite();
    }
    // Авто-разметка диета-тегов (sugar-free / gluten-free / vegan / lactose-free / low-cal / nut-free)
    all = applyDietaryTags(all);
    const dietCount = all.filter((p) => p.dietary && p.dietary.length > 0).length;
    if (dietCount > 0)
        console.log(`✅ Диета-теги проставлены: ${dietCount} позиций`);
    if (!fs_1.default.existsSync(DATA_DIR))
        fs_1.default.mkdirSync(DATA_DIR, { recursive: true });
    const data = { updated: new Date().toISOString(), products: all, source };
    fs_1.default.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
    console.log(`✅ Каталог сохранён: ${all.length} позиций (source=${source})`);
    return all;
}
// ─── Загрузить детальные данные одного товара по ID ─────────────────────────
async function fetchProductById(id) {
    if (!CATALOG_API || !CATALOG_TOKEN)
        return null;
    try {
        const sep = CATALOG_API.includes("?") ? "&" : "?";
        const url = `${CATALOG_API}${sep}token=${encodeURIComponent(CATALOG_TOKEN)}&id=${id}`;
        const raw = (await fetchJson(url));
        return raw.product ?? null;
    }
    catch (e) {
        console.error("[CATALOG_API] product fetch:", e.message);
        return null;
    }
}
// ─── Load from disk ───────────────────────────────────────────────────────────
function loadCatalog() {
    try {
        if (fs_1.default.existsSync(DATA_FILE)) {
            const raw = fs_1.default.readFileSync(DATA_FILE, "utf-8");
            const data = JSON.parse(raw);
            const products = data.products ?? [];
            // Если catalog.json создан до dietary-фичи — проставим теги на лету
            const hasDietary = products.some((p) => Array.isArray(p.dietary));
            return hasDietary ? products : applyDietaryTags(products);
        }
    }
    catch (e) {
        console.error("Ошибка загрузки каталога:", e.message);
    }
    return [];
}
function catalogAge() {
    try {
        if (fs_1.default.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs_1.default.readFileSync(DATA_FILE, "utf-8"));
            return data.updated ?? null;
        }
    }
    catch { }
    return null;
}
// ─── Search ───────────────────────────────────────────────────────────────────
// Нормализация: латинские буквы-гомоглифы → кириллица
// (в каталоге Bitrix часто 'Cметана' с латинским C, 'A' вместо 'А' и т.п.)
const HOMOGLYPHS = {
    "a": "а", "b": "в", "c": "с", "e": "е", "h": "н", "k": "к", "m": "м", "o": "о", "p": "р", "t": "т", "x": "х", "y": "у",
    "A": "А", "B": "В", "C": "С", "E": "Е", "H": "Н", "K": "К", "M": "М", "O": "О", "P": "Р", "T": "Т", "X": "Х", "Y": "У",
};
function normalizeStr(s) {
    return s.toLowerCase().replace(/[a-zA-Z]/g, (c) => HOMOGLYPHS[c] || c);
}
function searchCatalog(catalog, query, limit = 6) {
    if (!catalog.length)
        return [];
    const q = normalizeStr(query);
    // Стемминг для русского: убираем стандартные окончания
    const stems = q.split(/\s+/)
        .filter((w) => w.length > 2)
        .map((w) => w.replace(/(ого|ому|ыми|ами|ями|ной|ный|ная|ное|ные|ой|ей|ие|ый|ая|ое|ые|ы|и|а|у|е)$/u, ""))
        .filter((w) => w.length > 2);
    if (!stems.length)
        return catalog.slice(0, limit);
    return catalog
        .map((p) => {
        const fields = {
            name: normalizeStr(p.name || ""),
            category: normalizeStr(p.category || ""),
            preview: normalizeStr(p.preview || ""),
            types: normalizeStr([...(p.cake_type || []), ...(p.pie_type || []), ...(p.dessert_type || [])].join(" ")),
            filling: normalizeStr((p.filling || []).join(" ")),
            occasion: normalizeStr((p.occasion || []).join(" ")),
        };
        // Веса: name × 5, types/filling × 4, category/occasion × 2, preview × 1
        let score = 0;
        for (const stem of stems) {
            if (fields.name.includes(stem))
                score += 5;
            if (fields.types.includes(stem))
                score += 4;
            if (fields.filling.includes(stem))
                score += 4;
            if (fields.category.includes(stem))
                score += 2;
            if (fields.occasion.includes(stem))
                score += 2;
            if (fields.preview.includes(stem))
                score += 1;
        }
        return { p, score };
    })
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ p }) => p);
}

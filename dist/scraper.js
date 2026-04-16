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
exports.scrapeCatalog = scrapeCatalog;
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
        products.push({ name, category, price, url });
    });
    return products;
}
// ─── Scrape all pages ─────────────────────────────────────────────────────────
async function scrapeCatalog() {
    console.log("🔄 Начинаю парсинг каталога maria-irk.ru...");
    const all = [];
    for (const page of PAGES) {
        try {
            const html = await fetchHtml(BASE + page.path);
            const products = parsePage(html, page.cat);
            console.log(`  ✅ ${page.cat}: ${products.length} позиций`);
            all.push(...products);
            // пауза между запросами
            await new Promise((r) => setTimeout(r, 600));
        }
        catch (err) {
            console.error(`  ❌ Ошибка ${page.path}:`, err.message);
        }
    }
    // Сохраняем на диск
    if (!fs_1.default.existsSync(DATA_DIR))
        fs_1.default.mkdirSync(DATA_DIR, { recursive: true });
    const data = { updated: new Date().toISOString(), products: all };
    fs_1.default.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
    console.log(`✅ Каталог сохранён: ${all.length} позиций`);
    return all;
}
// ─── Load from disk ───────────────────────────────────────────────────────────
function loadCatalog() {
    try {
        if (fs_1.default.existsSync(DATA_FILE)) {
            const raw = fs_1.default.readFileSync(DATA_FILE, "utf-8");
            const data = JSON.parse(raw);
            return data.products ?? [];
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
function searchCatalog(catalog, query, limit = 6) {
    if (!catalog.length)
        return [];
    const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    if (!words.length)
        return catalog.slice(0, limit);
    return catalog
        .map((p) => {
        const text = `${p.name} ${p.category}`.toLowerCase();
        const score = words.reduce((s, w) => s + (text.includes(w) ? 1 : 0), 0);
        return { p, score };
    })
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ p }) => p);
}

import https from "https";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";

// ─── Types ──────────────────────────────────────────────────────────────────
export interface Product {
  name: string;
  category: string;
  price: string;
  url: string;
}

interface CatalogData {
  updated: string;
  products: Product[];
}

// ─── Config ──────────────────────────────────────────────────────────────────
const BASE = "https://www.maria-irk.ru";
const DATA_DIR  = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "catalog.json");

const PAGES: { path: string; cat: string }[] = [
  { path: "/cakes/",              cat: "Торты" },
  { path: "/pies/",               cat: "Пироги" },
  { path: "/cakes-and-desserts/", cat: "Пирожные" },
  { path: "/sets/",               cat: "Наборы" },
  { path: "/cakes-to-order/",     cat: "Торты на заказ" },
  { path: "/products/",           cat: "Для праздника" },
];

// ─── HTTP helper ─────────────────────────────────────────────────────────────
function fetchHtml(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent":      "Mozilla/5.0 (compatible; MariaBot/1.0)",
          "Accept-Language": "ru-RU,ru;q=0.9",
          "Accept":          "text/html",
        },
        rejectUnauthorized: false,  // сайт имеет проблемы с цепочкой сертификатов
      },
      (res) => {
        // Обрабатываем редиректы
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchHtml(res.headers.location).then(resolve).catch(reject);
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      }
    );
    req.on("error", reject);
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

// ─── Parser ───────────────────────────────────────────────────────────────────
function parsePage(html: string, category: string): Product[] {
  const $ = cheerio.load(html);
  const products: Product[] = [];

  $('[data-entity="item"]').each((_, el) => {
    // Вариант 1: стандартная карточка — имя в h3 > a
    let name = $(el).find("h3 a").first().text().trim();
    let href = $(el).find("h3 a").first().attr("href") ?? "";

    // Вариант 2: карточка набора — имя в alt первой картинки
    if (!name) {
      name = $(el).find("img").first().attr("alt")?.trim() ?? "";
      href = $(el).find("a").first().attr("href") ?? "";
    }

    if (!name) return;

    const url = href.startsWith("http") ? href : (href ? BASE + href : "");

    // Цена — в [data-entity="price-block"] p
    const price = $(el).find('[data-entity="price-block"] p').first()
      .text().trim().replace(/\s+/g, " ");

    products.push({ name, category, price, url });
  });

  return products;
}

// ─── Scrape all pages ─────────────────────────────────────────────────────────
export async function scrapeCatalog(): Promise<Product[]> {
  console.log("🔄 Начинаю парсинг каталога maria-irk.ru...");
  const all: Product[] = [];

  for (const page of PAGES) {
    try {
      const html     = await fetchHtml(BASE + page.path);
      const products = parsePage(html, page.cat);
      console.log(`  ✅ ${page.cat}: ${products.length} позиций`);
      all.push(...products);
      // пауза между запросами
      await new Promise<void>((r) => setTimeout(r, 600));
    } catch (err) {
      console.error(`  ❌ Ошибка ${page.path}:`, (err as Error).message);
    }
  }

  // Сохраняем на диск
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const data: CatalogData = { updated: new Date().toISOString(), products: all };
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
  console.log(`✅ Каталог сохранён: ${all.length} позиций`);

  return all;
}

// ─── Load from disk ───────────────────────────────────────────────────────────
export function loadCatalog(): Product[] {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw  = fs.readFileSync(DATA_FILE, "utf-8");
      const data = JSON.parse(raw) as CatalogData;
      return data.products ?? [];
    }
  } catch (e) {
    console.error("Ошибка загрузки каталога:", (e as Error).message);
  }
  return [];
}

export function catalogAge(): string | null {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as CatalogData;
      return data.updated ?? null;
    }
  } catch {}
  return null;
}

// ─── Search ───────────────────────────────────────────────────────────────────
export function searchCatalog(catalog: Product[], query: string, limit = 6): Product[] {
  if (!catalog.length) return [];
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (!words.length) return catalog.slice(0, limit);

  return catalog
    .map((p) => {
      const text  = `${p.name} ${p.category}`.toLowerCase();
      const score = words.reduce((s, w) => s + (text.includes(w) ? 1 : 0), 0);
      return { p, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ p }) => p);
}

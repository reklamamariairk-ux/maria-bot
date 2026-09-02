import https from "https";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";

// ─── Types ──────────────────────────────────────────────────────────────────
// Диета-теги: что в товаре ОТСУТСТВУЕТ (фильтры «Для меня»).
// Логика только по явным маркерам в названии/описании — фолс-позитив
// «Наполеон содержит муку → значит с глютеном» не считается тегом
// gluten-free; теги ставятся только при явном «без глютена» и т.п.
export type DietaryTag =
  | "sugar-free"   // без сахара / стевия
  | "gluten-free"  // без глютена
  | "vegan"        // веганский / постный
  | "lactose-free" // без лактозы / без молочки
  | "low-cal"      // пп / низкокалорийный / fit
  | "nut-free";    // без орехов

export interface Product {
  id?: number;
  name: string;
  category: string;
  price: string;
  priceNumber?: number | null;
  oldPriceNumber?: number | null;
  oldPrice?: string;
  discountPercent?: number;
  currency?: string;
  url: string;
  image?: string;
  weight?: string | null;
  persons?: string | null;
  hit?: boolean;
  available?: boolean;
  preview?: string;
  sectionCode?: string;
  sectionId?: number;
  occasion?: string[];
  filling?: string[];
  cake_type?: string[];
  pie_type?: string[];
  dessert_type?: string[];
  whom?: string[];
  dietary?: DietaryTag[];
}

interface CatalogData {
  updated: string;
  products: Product[];
  source?: string;
}

// ─── Config ──────────────────────────────────────────────────────────────────
const BASE = "https://www.maria-irk.ru";
const DATA_DIR  = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "catalog.json");
const DIETARY_OVERRIDES_FILE = path.join(DATA_DIR, "dietary-overrides.json");
const CATALOG_API   = process.env.CATALOG_API   ?? "";
const CATALOG_TOKEN = process.env.CATALOG_TOKEN ?? "";

// ─── Dietary detection ──────────────────────────────────────────────────────
// Ключевые слова для авто-разметки. Стараемся не давать false-positive:
// только явные «без X» формулировки и устоявшиеся термины.
// ВАЖНО: \b в JS regex работает только с латиницей. Для кириллических
// границ слова используем (?<![а-яёa-z])…(?![а-яёa-z]) — это поддерживается
// с Node 10+ (es2018 lookbehind). Без lookaround были бы false-positive
// типа «непостный» → vegan.
const DIETARY_KEYWORDS: Record<DietaryTag, RegExp[]> = {
  "sugar-free":   [
    /без\s*сахар/i,
    /no\s*sugar/i,
    /(?<![а-яёa-z])стеви/i,
    /без\s*подсласт/i,
  ],
  "gluten-free":  [
    /без\s*глютен/i,
    /безглютен/i,
    /gluten[\s-]*free/i,
    /из\s*миндальной\s*муки/i,
  ],
  "vegan":        [
    /(?<![а-яёa-z])веган/i,
    /\bvegan\b/i,
    /(?<![а-яёa-z])постн(ый|ая|ое|ые|ого|ому|ыми)/i,
  ],
  "lactose-free": [
    /без\s*лактоз/i,
    /lactose[\s-]*free/i,
    /без\s*молочк/i,
  ],
  "low-cal":      [
    /(?<![а-яёa-z])пп(?![а-яёa-z])/i,
    /пп[\s-]*десерт/i,
    /пп[\s-]*торт/i,
    /низкокалорий/i,
    /(?<![а-яёa-z])лёгк(ий|ая|ое|ие)(?![а-яёa-z])/i,
    /\bfit(ness)?\b/i,
    /(?<![а-яёa-z])диет/i,
  ],
  "nut-free":     [
    /без\s*орех/i,
    /nut[\s-]*free/i,
  ],
};

interface DietaryOverrides {
  // id → массив тегов (полная замена авто-определённых)
  byId?: Record<string, DietaryTag[]>;
  // id → теги для добавления к авто-определённым
  add?: Record<string, DietaryTag[]>;
  // id → теги для исключения из авто-определённых (false-positive фикс)
  remove?: Record<string, DietaryTag[]>;
}

let _dietaryOverridesCache: DietaryOverrides | null = null;
function loadDietaryOverrides(): DietaryOverrides {
  if (_dietaryOverridesCache) return _dietaryOverridesCache;
  try {
    if (fs.existsSync(DIETARY_OVERRIDES_FILE)) {
      const raw = fs.readFileSync(DIETARY_OVERRIDES_FILE, "utf-8");
      _dietaryOverridesCache = JSON.parse(raw) as DietaryOverrides;
      return _dietaryOverridesCache;
    }
  } catch (e) {
    console.error("[dietary-overrides] load failed:", (e as Error).message);
  }
  _dietaryOverridesCache = {};
  return _dietaryOverridesCache;
}

// Сбросить кэш — для админ-эндпоинта перезагрузки overrides без рестарта
export function reloadDietaryOverrides(): void {
  _dietaryOverridesCache = null;
}

export function detectDietary(p: Product): DietaryTag[] {
  const text = [
    p.name || "",
    p.preview || "",
    ...(p.filling || []),
    ...(p.cake_type || []),
    ...(p.pie_type || []),
    ...(p.dessert_type || []),
  ].join(" ");
  const tags = new Set<DietaryTag>();
  for (const tag of Object.keys(DIETARY_KEYWORDS) as DietaryTag[]) {
    if (DIETARY_KEYWORDS[tag].some((re) => re.test(text))) tags.add(tag);
  }
  // Apply overrides
  const ov = loadDietaryOverrides();
  const idKey = String(p.id ?? "");
  if (idKey && ov.byId?.[idKey]) return [...ov.byId[idKey]];
  if (idKey && ov.add?.[idKey])    for (const t of ov.add[idKey]) tags.add(t);
  if (idKey && ov.remove?.[idKey]) for (const t of ov.remove[idKey]) tags.delete(t);
  return [...tags];
}

function applyDietaryTags(products: Product[]): Product[] {
  return products.map((p) => {
    const dietary = detectDietary(p);
    return dietary.length > 0 ? { ...p, dietary } : p;
  });
}

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

    // Картинка — первый img в карточке с src /upload/...
    let image: string | undefined;
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
function fetchJson(url: string, timeoutMs = 60_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (r) => {
      let body = "";
      r.on("data", (c: Buffer) => (body += c));
      r.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

// Retry helper — для медленных первых запросов (cold cache)
async function fetchJsonWithRetry(url: string, attempts = 3, timeoutMs = 60_000): Promise<unknown> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchJson(url, timeoutMs);
    } catch (e) {
      lastErr = e;
      console.warn(`[fetch] attempt ${i+1}/${attempts} failed:`, (e as Error).message);
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}

// ─── API source — читаем из /api/catalog.php ────────────────────────────────
async function fetchFromApi(): Promise<Product[]> {
  const sep = CATALOG_API.includes("?") ? "&" : "?";
  const url = `${CATALOG_API}${sep}token=${encodeURIComponent(CATALOG_TOKEN)}&limit=500`;
  const raw = (await fetchJsonWithRetry(url, 3, 60_000)) as {
    sections?: Array<{ id: number; code: string; name: string }>;
    products?: Array<Record<string, unknown>>;
  };
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
      id:           Number(p.id),
      name:         String(p.name ?? ""),
      category:     sec?.name ?? "Каталог",
      price:        priceStr,
      priceNumber,
      oldPrice:     oldPriceStr || undefined,
      oldPriceNumber,
      discountPercent: discountPercent || undefined,
      currency:     String(p.currency ?? "RUB"),
      url:          String(p.url ?? ""),
      image:        p.image ? String(p.image) : undefined,
      weight:       p.weight ? String(p.weight) : null,
      persons:      p.persons ? String(p.persons) : null,
      hit:          Boolean(p.hit),
      available:    p.available !== false,
      preview:      p.preview ? String(p.preview) : "",
      sectionCode:  sec?.code,
      sectionId:    sid,
      occasion:     Array.isArray(p.occasion)     ? p.occasion.map(String)     : undefined,
      filling:      Array.isArray(p.filling)      ? p.filling.map(String)      : undefined,
      cake_type:    Array.isArray(p.cake_type)    ? p.cake_type.map(String)    : undefined,
      pie_type:     Array.isArray(p.pie_type)     ? p.pie_type.map(String)     : undefined,
      dessert_type: Array.isArray(p.dessert_type) ? p.dessert_type.map(String) : undefined,
      whom:         Array.isArray(p.whom)         ? p.whom.map(String)         : undefined,
    } as Product;
  });
}

// ─── Scrape all pages (legacy fallback) ─────────────────────────────────────
async function scrapeFromSite(): Promise<Product[]> {
  console.log("🔄 Скрейпинг каталога maria-irk.ru (fallback)...");
  const all: Product[] = [];

  for (const page of PAGES) {
    try {
      const html     = await fetchHtml(BASE + page.path);
      const products = parsePage(html, page.cat);
      console.log(`  ✅ ${page.cat}: ${products.length} позиций`);
      all.push(...products);
      await new Promise<void>((r) => setTimeout(r, 600));
    } catch (err) {
      console.error(`  ❌ Ошибка ${page.path}:`, (err as Error).message);
    }
  }
  return all;
}

// ─── Public: получить каталог (API → fallback scraping) ─────────────────────
export async function scrapeCatalog(): Promise<Product[]> {
  let all: Product[] = [];
  let source = "scrape";

  if (CATALOG_API && CATALOG_TOKEN) {
    try {
      all = await fetchFromApi();
      source = "bitrix";
      console.log(`✅ Каталог из API: ${all.length} позиций`);
    } catch (err) {
      console.error("[CATALOG_API] failed, fallback to scrape:", (err as Error).message);
    }
  }

  if (all.length === 0) {
    all = await scrapeFromSite();
  }

  // Защита: если оба источника вернули пусто (сеть лежит) — не затираем
  // прошлый рабочий каталог на диске и не обнуляем in-memory state.
  // Бросаем — refreshCatalog поймает и оставит предыдущий catalog.
  if (all.length === 0) {
    throw new Error("catalog_sources_empty");
  }

  // Авто-разметка диета-тегов (sugar-free / gluten-free / vegan / lactose-free / low-cal / nut-free)
  all = applyDietaryTags(all);
  const dietCount = all.filter((p) => p.dietary && p.dietary.length > 0).length;
  if (dietCount > 0) console.log(`✅ Диета-теги проставлены: ${dietCount} позиций`);

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const data: CatalogData = { updated: new Date().toISOString(), products: all, source };
  // Несколько API-процессов могут обновиться одновременно. Уникальный temp +
  // atomic rename не даёт соседнему процессу прочитать наполовину записанный JSON.
  const tempFile = `${DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tempFile, DATA_FILE);
  } finally {
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
  console.log(`✅ Каталог сохранён: ${all.length} позиций (source=${source})`);

  return all;
}

// ─── Загрузить детальные данные одного товара по ID ─────────────────────────
export async function fetchProductById(id: number): Promise<Record<string, unknown> | null> {
  if (!CATALOG_API || !CATALOG_TOKEN) return null;
  try {
    const sep = CATALOG_API.includes("?") ? "&" : "?";
    const url = `${CATALOG_API}${sep}token=${encodeURIComponent(CATALOG_TOKEN)}&id=${id}`;
    const raw = (await fetchJson(url)) as { product?: Record<string, unknown> };
    return raw.product ?? null;
  } catch (e) {
    console.error("[CATALOG_API] product fetch:", (e as Error).message);
    return null;
  }
}

// ─── Load from disk ───────────────────────────────────────────────────────────
export function loadCatalog(): Product[] {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw  = fs.readFileSync(DATA_FILE, "utf-8");
      const data = JSON.parse(raw) as CatalogData;
      const products = data.products ?? [];
      // Если catalog.json создан до dietary-фичи — проставим теги на лету
      const hasDietary = products.some((p) => Array.isArray(p.dietary));
      return hasDietary ? products : applyDietaryTags(products);
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
// Нормализация: латинские буквы-гомоглифы → кириллица
// (в каталоге Bitrix часто 'Cметана' с латинским C, 'A' вместо 'А' и т.п.)
const HOMOGLYPHS: Record<string, string> = {
  "a":"а","b":"в","c":"с","e":"е","h":"н","k":"к","m":"м","o":"о","p":"р","t":"т","x":"х","y":"у",
  "A":"А","B":"В","C":"С","E":"Е","H":"Н","K":"К","M":"М","O":"О","P":"Р","T":"Т","X":"Х","Y":"У",
};
function normalizeStr(s: string): string {
  return s.toLowerCase().replace(/[a-zA-Z]/g, (c) => HOMOGLYPHS[c] || c);
}

export function searchCatalog(catalog: Product[], query: string, limit = 6): Product[] {
  if (!catalog.length) return [];
  const q = normalizeStr(query);
  // Стемминг для русского: убираем стандартные окончания
  const stems = q.split(/\s+/)
    .filter((w) => w.length > 2)
    .map((w) => w.replace(/(ого|ому|ыми|ами|ями|ной|ный|ная|ное|ные|ой|ей|ие|ый|ая|ое|ые|ы|и|а|у|е)$/u, ""))
    .filter((w) => w.length > 2);
  if (!stems.length) return catalog.slice(0, limit);

  return catalog
    .map((p) => {
      const fields = {
        name:     normalizeStr(p.name || ""),
        category: normalizeStr(p.category || ""),
        preview:  normalizeStr(p.preview || ""),
        types:    normalizeStr([...(p.cake_type || []), ...(p.pie_type || []), ...(p.dessert_type || [])].join(" ")),
        filling:  normalizeStr((p.filling || []).join(" ")),
        occasion: normalizeStr((p.occasion || []).join(" ")),
      };
      // Веса: name × 5, types/filling × 4, category/occasion × 2, preview × 1
      let score = 0;
      for (const stem of stems) {
        if (fields.name.includes(stem))     score += 5;
        if (fields.types.includes(stem))    score += 4;
        if (fields.filling.includes(stem))  score += 4;
        if (fields.category.includes(stem)) score += 2;
        if (fields.occasion.includes(stem)) score += 2;
        if (fields.preview.includes(stem))  score += 1;
      }
      return { p, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ p }) => p);
}

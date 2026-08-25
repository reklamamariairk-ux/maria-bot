import fs from "fs";
import path from "path";
import https from "https";

export interface Partner {
  emoji: string;
  name: string;
  perk: string;
  desc: string;
  category?: string | null;
  url?: string | null;
  logo_url?: string | null;
}

interface PartnersData {
  updated: string;
  source: string;
  partners: Partner[];
}

const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "partners.json");

// Optional: external Bitrix endpoint (e.g. https://www.maria-irk.ru/local/api/partners.php)
const PARTNERS_API = process.env.PARTNERS_API ?? "";
const PARTNERS_TOKEN = process.env.PARTNERS_TOKEN ?? "";

let cache: PartnersData | null = null;

function readDisk(): PartnersData | null {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as PartnersData;
    }
  } catch (e) {
    console.error("[PARTNERS] read error:", (e as Error).message);
  }
  return null;
}

function writeDisk(data: PartnersData): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.error("[PARTNERS] write error:", (e as Error).message);
  }
}

function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (r) => {
      let body = "";
      r.on("data", (c: Buffer) => (body += c));
      r.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

// Pull from external Bitrix endpoint, normalize, save to disk
export async function syncPartners(): Promise<{ ok: boolean; count: number; reason?: string }> {
  if (!PARTNERS_API) return { ok: false, count: 0, reason: "no_api_url" };

  try {
    const sep = PARTNERS_API.includes("?") ? "&" : "?";
    const url = PARTNERS_TOKEN
      ? `${PARTNERS_API}${sep}token=${encodeURIComponent(PARTNERS_TOKEN)}`
      : PARTNERS_API;
    const raw = await fetchJson(url);

    // Accept either { partners: [...] } or a bare array
    const arr = Array.isArray(raw)
      ? raw
      : (raw as { partners?: unknown }).partners;

    if (!Array.isArray(arr)) {
      return { ok: false, count: 0, reason: "bad_response" };
    }

    const partners: Partner[] = arr
      .map((p: unknown) => {
        const o = p as Record<string, unknown>;
        return {
          emoji:    String(o.emoji ?? o.icon ?? "🤝"),
          name:     String(o.name ?? o.title ?? "").trim(),
          perk:     String(o.perk ?? o.discount ?? "").trim(),
          desc:     String(o.desc ?? o.description ?? "").trim(),
          category: o.category ? String(o.category) : null,
          url:      o.url ? String(o.url) : null,
          logo_url: o.logo_url ? String(o.logo_url) : null,
        };
      })
      .filter((p) => p.name.length > 0);

    const data: PartnersData = {
      updated: new Date().toISOString(),
      source: "bitrix",
      partners,
    };
    writeDisk(data);
    cache = data;
    console.log(`[PARTNERS] synced ${partners.length} from Bitrix`);
    return { ok: true, count: partners.length };
  } catch (e) {
    console.error("[PARTNERS] sync failed:", (e as Error).message);
    return { ok: false, count: 0, reason: (e as Error).message };
  }
}

export function getPartners(): Partner[] {
  if (cache) return cache.partners;
  const disk = readDisk();
  if (disk) {
    cache = disk;
    return disk.partners;
  }
  return [];
}

export function getPartnersMeta(): { updated: string; source: string; count: number } {
  const disk = cache ?? readDisk();
  return {
    updated: disk?.updated ?? "never",
    source: disk?.source ?? "none",
    count: disk?.partners.length ?? 0,
  };
}

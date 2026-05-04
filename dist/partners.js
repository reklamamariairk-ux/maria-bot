"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncPartners = syncPartners;
exports.getPartners = getPartners;
exports.getPartnersMeta = getPartnersMeta;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const https_1 = __importDefault(require("https"));
const DATA_DIR = path_1.default.join(__dirname, "..", "data");
const DATA_FILE = path_1.default.join(DATA_DIR, "partners.json");
// Optional: external Bitrix endpoint (e.g. https://www.maria-irk.ru/local/api/partners.php)
const PARTNERS_API = process.env.PARTNERS_API ?? "";
const PARTNERS_TOKEN = process.env.PARTNERS_TOKEN ?? "";
let cache = null;
function readDisk() {
    try {
        if (fs_1.default.existsSync(DATA_FILE)) {
            return JSON.parse(fs_1.default.readFileSync(DATA_FILE, "utf-8"));
        }
    }
    catch (e) {
        console.error("[PARTNERS] read error:", e.message);
    }
    return null;
}
function writeDisk(data) {
    try {
        if (!fs_1.default.existsSync(DATA_DIR))
            fs_1.default.mkdirSync(DATA_DIR, { recursive: true });
        fs_1.default.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
    }
    catch (e) {
        console.error("[PARTNERS] write error:", e.message);
    }
}
function fetchJson(url) {
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
        req.setTimeout(10000, () => { req.destroy(); reject(new Error("Timeout")); });
    });
}
// Pull from external Bitrix endpoint, normalize, save to disk
async function syncPartners() {
    if (!PARTNERS_API)
        return { ok: false, count: 0, reason: "no_api_url" };
    try {
        const sep = PARTNERS_API.includes("?") ? "&" : "?";
        const url = PARTNERS_TOKEN
            ? `${PARTNERS_API}${sep}token=${encodeURIComponent(PARTNERS_TOKEN)}`
            : PARTNERS_API;
        const raw = await fetchJson(url);
        // Accept either { partners: [...] } or a bare array
        const arr = Array.isArray(raw)
            ? raw
            : raw.partners;
        if (!Array.isArray(arr)) {
            return { ok: false, count: 0, reason: "bad_response" };
        }
        const partners = arr
            .map((p) => {
            const o = p;
            return {
                emoji: String(o.emoji ?? o.icon ?? "🤝"),
                name: String(o.name ?? o.title ?? "").trim(),
                perk: String(o.perk ?? o.discount ?? "").trim(),
                desc: String(o.desc ?? o.description ?? "").trim(),
            };
        })
            .filter((p) => p.name.length > 0);
        const data = {
            updated: new Date().toISOString(),
            source: "bitrix",
            partners,
        };
        writeDisk(data);
        cache = data;
        console.log(`[PARTNERS] synced ${partners.length} from Bitrix`);
        return { ok: true, count: partners.length };
    }
    catch (e) {
        console.error("[PARTNERS] sync failed:", e.message);
        return { ok: false, count: 0, reason: e.message };
    }
}
function getPartners() {
    if (cache)
        return cache.partners;
    const disk = readDisk();
    if (disk) {
        cache = disk;
        return disk.partners;
    }
    return [];
}
function getPartnersMeta() {
    const disk = cache ?? readDisk();
    return {
        updated: disk?.updated ?? "never",
        source: disk?.source ?? "none",
        count: disk?.partners.length ?? 0,
    };
}

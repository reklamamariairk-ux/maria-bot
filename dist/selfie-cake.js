"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.storeSelfie = storeSelfie;
exports.readSelfie = readSelfie;
exports.generateSelfieCakes = generateSelfieCakes;
exports.cleanupOldSelfies = cleanupOldSelfies;
/**
 * AI-портрет юзера на торте: загружаешь селфи → AI рисует сахарную фигурку
 * по мотивам твоего фото.
 *
 * Стек: Pollinations.ai (бесплатно) с img2img — параметр `image=<URL>` указывает
 * на временное публичное фото юзера. Pollinations скачивает его сервером и
 * использует как conditioning. Strength = 0.5 — баланс «узнаваемо vs стилизовано».
 *
 * Хранение: /tmp/cake_selfies/{uuid}.jpg, авто-удаление через cleanupTmpDir
 * (см. index.ts) — добавляется в общий runCleanup с TTL 2 часа.
 */
const fs_1 = __importDefault(require("fs"));
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const SELFIE_DIR = path_1.default.join("/tmp", "cake_selfies");
// Создаём папку при импорте — раз и навсегда. Здесь оставляем sync — это
// один раз на процесс, не блокирует hot path.
try {
    fs_1.default.mkdirSync(SELFIE_DIR, { recursive: true });
}
catch { }
const SELFIE_STYLES = [
    {
        label: "Сахарная фигурка",
        modifier: "as a cute marzipan sugar figurine on top of an elegant birthday cake, hand-crafted style, soft lighting",
    },
    {
        label: "Бенто-портрет",
        modifier: "as a hand-painted character on a small bento cake, modern pastry art, pastel colors, charming and warm",
    },
    {
        label: "Праздничный",
        modifier: "as a festive cake topper figurine on top of a layered celebration cake, colorful frosting, joyful mood",
    },
];
function buildPrompt(modifier) {
    return [
        "Photorealistic product photo of a custom cake with a person depicted",
        modifier + ",",
        "white or cream background, top-down 3/4 angle, professional bakery photography, single cake centered, soft natural lighting.",
    ].join(" ");
}
function buildPollinationsUrl(prompt, imageUrl, seed) {
    const params = new URLSearchParams({
        image: imageUrl,
        width: "1024",
        height: "1024",
        model: "flux",
        seed: String(seed),
        nologo: "true",
        enhance: "true",
    });
    return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params.toString()}`;
}
// data:image/jpeg;base64,XXXX → Buffer + extension
function parseDataUrl(b64) {
    const match = b64.match(/^data:image\/(jpe?g|png|webp);base64,(.+)$/i);
    if (!match)
        return null;
    const ext = match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
    return { buf: Buffer.from(match[2], "base64"), ext };
}
async function storeSelfie(b64DataUrl, baseUrl) {
    const parsed = parseDataUrl(b64DataUrl);
    if (!parsed)
        throw new Error("bad_image_format");
    // Лимит 6 MB на base64 (после декодирования ~4.5 MB)
    if (parsed.buf.length > 6 * 1024 * 1024)
        throw new Error("image_too_large");
    if (parsed.buf.length < 1024)
        throw new Error("image_too_small");
    const id = crypto_1.default.randomBytes(8).toString("hex");
    const filename = `${id}.${parsed.ext}`;
    await promises_1.default.writeFile(path_1.default.join(SELFIE_DIR, filename), parsed.buf);
    // baseUrl: абсолютный URL нашего сервиса. Pollinations стучится сюда чтобы
    // забрать селфи как conditioning image для img2img.
    const publicUrl = `${baseUrl.replace(/\/$/, "")}/api/selfie-img/${id}`;
    return { id, publicUrl };
}
async function readSelfie(id) {
    // Защита от path traversal
    if (!/^[0-9a-f]{16}$/.test(id))
        return null;
    for (const ext of ["jpeg", "png", "webp"]) {
        const fp = path_1.default.join(SELFIE_DIR, `${id}.${ext}`);
        try {
            const buf = await promises_1.default.readFile(fp);
            return { buf, type: ext === "jpeg" ? "image/jpeg" : `image/${ext}` };
        }
        catch { }
    }
    return null;
}
function generateSelfieCakes(publicSelfieUrl) {
    const baseSeed = Math.floor(Math.random() * 1000000);
    return SELFIE_STYLES.map((s, i) => ({
        url: buildPollinationsUrl(buildPrompt(s.modifier), publicSelfieUrl, baseSeed + i),
        variant: s.label,
    }));
}
// Опционально вызывается из общего runCleanup — удаляем selfie старше 2 часов
async function cleanupOldSelfies() {
    try {
        const now = Date.now();
        const maxAge = 2 * 60 * 60 * 1000;
        const files = await promises_1.default.readdir(SELFIE_DIR);
        for (const f of files) {
            try {
                const fp = path_1.default.join(SELFIE_DIR, f);
                const st = await promises_1.default.stat(fp);
                if (now - st.mtimeMs > maxAge)
                    await promises_1.default.unlink(fp);
            }
            catch { }
        }
    }
    catch { }
}

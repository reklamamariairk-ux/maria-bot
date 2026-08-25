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
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";

const SELFIE_DIR = path.join("/tmp", "cake_selfies");
const SELFIE_TTL_MS = 2 * 60 * 60 * 1000;

// Создаём папку при импорте — раз и навсегда. Здесь оставляем sync — это
// один раз на процесс, не блокирует hot path.
try { fs.mkdirSync(SELFIE_DIR, { recursive: true }); } catch {}

export interface SelfieCakeResult {
  url: string;
  variant: string;
}

const SELFIE_STYLES: { label: string; modifier: string }[] = [
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

function buildPrompt(modifier: string): string {
  return [
    "Photorealistic product photo of a custom cake with a person depicted",
    modifier + ",",
    "white or cream background, top-down 3/4 angle, professional bakery photography, single cake centered, soft natural lighting.",
  ].join(" ");
}

function buildPollinationsUrl(prompt: string, imageUrl: string, seed: number): string {
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
function parseDataUrl(b64: string): { buf: Buffer; ext: string } | null {
  const match = b64.match(/^data:image\/(jpe?g|png|webp);base64,(.+)$/i);
  if (!match) return null;
  const ext = match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
  return { buf: Buffer.from(match[2], "base64"), ext };
}

export interface StoreSelfieResult {
  id: string;
  publicUrl: string; // относительный путь /api/selfie-img/{id}
}

export async function storeSelfie(b64DataUrl: string, baseUrl: string): Promise<StoreSelfieResult> {
  const parsed = parseDataUrl(b64DataUrl);
  if (!parsed) throw new Error("bad_image_format");
  // Лимит 6 MB на base64 (после декодирования ~4.5 MB)
  if (parsed.buf.length > 6 * 1024 * 1024) throw new Error("image_too_large");
  if (parsed.buf.length < 1024) throw new Error("image_too_small");

  const id = crypto.randomBytes(16).toString("hex");
  const filename = `${id}.${parsed.ext}`;
  const filePath = path.join(SELFIE_DIR, filename);
  await fsp.writeFile(filePath, parsed.buf);
  // Основной путь удаления — персональный таймер ровно на TTL. Периодический
  // cleanup остаётся страховкой после рестарта процесса.
  const expiryTimer = setTimeout(() => { fsp.unlink(filePath).catch(() => {}); }, SELFIE_TTL_MS);
  expiryTimer.unref();
  // baseUrl: абсолютный URL нашего сервиса. Pollinations стучится сюда чтобы
  // забрать селфи как conditioning image для img2img.
  const publicUrl = `${baseUrl.replace(/\/$/, "")}/api/selfie-img/${id}`;
  return { id, publicUrl };
}

export async function readSelfie(id: string): Promise<{ buf: Buffer; type: string } | null> {
  // Защита от path traversal
  if (!/^[0-9a-f]{32}$/.test(id)) return null;
  for (const ext of ["jpeg", "png", "webp"]) {
    const fp = path.join(SELFIE_DIR, `${id}.${ext}`);
    try {
      const st = await fsp.stat(fp);
      if (Date.now() - st.mtimeMs >= SELFIE_TTL_MS) {
        await fsp.unlink(fp).catch(() => {});
        return null;
      }
      const buf = await fsp.readFile(fp);
      return { buf, type: ext === "jpeg" ? "image/jpeg" : `image/${ext}` };
    } catch {}
  }
  return null;
}

export function generateSelfieCakes(publicSelfieUrl: string): SelfieCakeResult[] {
  const baseSeed = Math.floor(Math.random() * 1_000_000);
  return SELFIE_STYLES.map((s, i) => ({
    url: buildPollinationsUrl(buildPrompt(s.modifier), publicSelfieUrl, baseSeed + i),
    variant: s.label,
  }));
}

// Опционально вызывается из общего runCleanup — удаляем selfie старше 2 часов
export async function cleanupOldSelfies(): Promise<void> {
  try {
    const now = Date.now();
    const files = await fsp.readdir(SELFIE_DIR);
    for (const f of files) {
      try {
        const fp = path.join(SELFIE_DIR, f);
        const st = await fsp.stat(fp);
        if (now - st.mtimeMs >= SELFIE_TTL_MS) await fsp.unlink(fp);
      } catch {}
    }
  } catch {}
}

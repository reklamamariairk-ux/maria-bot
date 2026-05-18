/**
 * AI-генерация концепт-картинок торта по описанию юзера.
 * Используем БЕСПЛАТНЫЙ Pollinations.ai (https://pollinations.ai) — без ключей,
 * без регистрации. Под капотом — Flux. Картинка генерируется при первом GET
 * на URL, затем кешируется на их CDN.
 *
 * Стратегия: сервер быстро возвращает 3 URL'а с разными стилистиками и seed'ами.
 * Фронт ставит их в <img src>, генерация идёт async на стороне Pollinations.
 * Skeleton-карточки показываются пока картинка не загрузилась.
 */
import https from "https";

export interface CakeConcept {
  url: string;
  variant: string;
}

const STYLE_VARIANTS: { label: string; modifier: string }[] = [
  { label: "Минимал", modifier: "minimalist elegant style, clean lines, premium pastry shop aesthetic, soft shadows" },
  { label: "Классика", modifier: "classic traditional style, hand-crafted decorations, soft pastel tones, romantic mood" },
  { label: "Яркий", modifier: "vibrant bold colors, playful decorations, modern dessert photography, festive mood" },
];

function buildPrompt(userPrompt: string, modifier: string): string {
  return [
    "Photorealistic product photo of a custom cake.",
    `${userPrompt}.`,
    `Style: ${modifier}.`,
    "White or cream background, soft natural lighting, top-down 3/4 angle, professional bakery photography, no text or logos on the cake, no people, single cake centered.",
  ].join(" ");
}

function buildPollinationsUrl(prompt: string, seed: number): string {
  const params = new URLSearchParams({
    width: "1024",
    height: "1024",
    model: "flux",
    seed: String(seed),
    nologo: "true",
    enhance: "true",
  });
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params.toString()}`;
}

// Health-check: Pollinations может временно лежать. Дёргаем главную с timeout 3s.
let _lastHealthCheck = 0;
let _isHealthy = true;
export async function isConceptEnabled(): Promise<boolean> {
  // Кешируем результат на 5 минут чтобы не дёргать на каждый запрос
  const now = Date.now();
  if (now - _lastHealthCheck < 5 * 60 * 1000) return _isHealthy;
  _lastHealthCheck = now;
  _isHealthy = await new Promise<boolean>((resolve) => {
    const req = https.request({
      hostname: "image.pollinations.ai",
      method: "HEAD",
      path: "/",
      timeout: 3000,
    }, (res) => {
      resolve((res.statusCode ?? 0) < 500);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.end();
  });
  return _isHealthy;
}

export async function generateCakeConcepts(userPrompt: string): Promise<CakeConcept[]> {
  const trimmed = userPrompt.trim().slice(0, 500);
  if (trimmed.length < 5) throw new Error("prompt_too_short");

  // Генерируем 3 URL'а с разными стилями и разными seed'ами для уникальности.
  // Pollinations начнёт генерацию при первом GET от клиента — нам ждать не нужно.
  const baseSeed = Math.floor(Math.random() * 1_000_000);
  return STYLE_VARIANTS.map((v, i) => ({
    url: buildPollinationsUrl(buildPrompt(trimmed, v.modifier), baseSeed + i),
    variant: v.label,
  }));
}

/**
 * AI-генерация концепт-картинок торта по описанию юзера.
 * Использует OpenAI DALL-E 3 (env OPENAI_KEY). Если ключа нет — возвращает 503.
 * Делаем 3 параллельных вызова с разными прилагательными в prompt'е чтобы
 * получить визуально разные варианты (DALL-E 3 не поддерживает n>1).
 */
import https from "https";

const OPENAI_KEY = process.env.OPENAI_KEY ?? "";

export interface CakeConcept {
  url: string;
  variant: string; // короткий лейбл-стилистика
}

const STYLE_VARIANTS: { label: string; modifier: string }[] = [
  { label: "Минимал", modifier: "minimalist, elegant, clean lines, premium pastry shop aesthetic" },
  { label: "Классика", modifier: "classic style, traditional decoration, soft pastel tones, hand-crafted look" },
  { label: "Яркий", modifier: "vibrant colors, playful decorations, modern dessert photography, bold composition" },
];

function buildPrompt(userPrompt: string, modifier: string): string {
  return [
    "Photorealistic product photo of a custom cake.",
    `Description: ${userPrompt}.`,
    `Style: ${modifier}.`,
    "White or light cream background, soft natural lighting, top-down 3/4 angle, professional bakery photography, no text or logos on the cake, no people, single cake centered.",
  ].join(" ");
}

interface OpenAIImage {
  url: string;
  revised_prompt?: string;
}

function callDalle3(prompt: string): Promise<OpenAIImage> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "dall-e-3",
      prompt,
      size: "1024x1024",
      quality: "standard",
      n: 1,
    });
    const opts: https.RequestOptions = {
      hostname: "api.openai.com",
      path: "/v1/images/generations",
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, (res) => {
      let d = "";
      res.on("data", (c: Buffer) => (d += c));
      res.on("end", () => {
        try {
          const j = JSON.parse(d) as { data?: OpenAIImage[]; error?: { message: string } };
          if (j.error) reject(new Error(j.error.message));
          else if (j.data?.[0]?.url) resolve(j.data[0]);
          else reject(new Error("no image url in response"));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(60_000, () => { req.destroy(); reject(new Error("timeout")); });
    req.write(body);
    req.end();
  });
}

export function isConceptEnabled(): boolean {
  return Boolean(OPENAI_KEY);
}

export async function generateCakeConcepts(userPrompt: string): Promise<CakeConcept[]> {
  if (!OPENAI_KEY) throw new Error("not_configured");
  const trimmed = userPrompt.trim().slice(0, 500);
  if (trimmed.length < 5) throw new Error("prompt_too_short");

  // 3 параллельных запроса с разными стилистическими модификаторами
  const results = await Promise.allSettled(
    STYLE_VARIANTS.map((v) => callDalle3(buildPrompt(trimmed, v.modifier))),
  );
  const concepts: CakeConcept[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      concepts.push({ url: r.value.url, variant: STYLE_VARIANTS[i].label });
    } else {
      console.warn(`[cake-concept] variant ${STYLE_VARIANTS[i].label} failed:`, (r.reason as Error).message);
    }
  });
  if (concepts.length === 0) throw new Error("all_variants_failed");
  return concepts;
}

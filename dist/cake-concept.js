"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isConceptEnabled = isConceptEnabled;
exports.generateCakeConcepts = generateCakeConcepts;
/**
 * AI-генерация концепт-картинок торта по описанию юзера.
 * Использует OpenAI DALL-E 3 (env OPENAI_KEY). Если ключа нет — возвращает 503.
 * Делаем 3 параллельных вызова с разными прилагательными в prompt'е чтобы
 * получить визуально разные варианты (DALL-E 3 не поддерживает n>1).
 */
const https_1 = __importDefault(require("https"));
const OPENAI_KEY = process.env.OPENAI_KEY ?? "";
const STYLE_VARIANTS = [
    { label: "Минимал", modifier: "minimalist, elegant, clean lines, premium pastry shop aesthetic" },
    { label: "Классика", modifier: "classic style, traditional decoration, soft pastel tones, hand-crafted look" },
    { label: "Яркий", modifier: "vibrant colors, playful decorations, modern dessert photography, bold composition" },
];
function buildPrompt(userPrompt, modifier) {
    return [
        "Photorealistic product photo of a custom cake.",
        `Description: ${userPrompt}.`,
        `Style: ${modifier}.`,
        "White or light cream background, soft natural lighting, top-down 3/4 angle, professional bakery photography, no text or logos on the cake, no people, single cake centered.",
    ].join(" ");
}
function callDalle3(prompt) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            model: "dall-e-3",
            prompt,
            size: "1024x1024",
            quality: "standard",
            n: 1,
        });
        const opts = {
            hostname: "api.openai.com",
            path: "/v1/images/generations",
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENAI_KEY}`,
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
            },
        };
        const req = https_1.default.request(opts, (res) => {
            let d = "";
            res.on("data", (c) => (d += c));
            res.on("end", () => {
                try {
                    const j = JSON.parse(d);
                    if (j.error)
                        reject(new Error(j.error.message));
                    else if (j.data?.[0]?.url)
                        resolve(j.data[0]);
                    else
                        reject(new Error("no image url in response"));
                }
                catch (e) {
                    reject(e);
                }
            });
        });
        req.on("error", reject);
        req.setTimeout(60000, () => { req.destroy(); reject(new Error("timeout")); });
        req.write(body);
        req.end();
    });
}
function isConceptEnabled() {
    return Boolean(OPENAI_KEY);
}
async function generateCakeConcepts(userPrompt) {
    if (!OPENAI_KEY)
        throw new Error("not_configured");
    const trimmed = userPrompt.trim().slice(0, 500);
    if (trimmed.length < 5)
        throw new Error("prompt_too_short");
    // 3 параллельных запроса с разными стилистическими модификаторами
    const results = await Promise.allSettled(STYLE_VARIANTS.map((v) => callDalle3(buildPrompt(trimmed, v.modifier))));
    const concepts = [];
    results.forEach((r, i) => {
        if (r.status === "fulfilled") {
            concepts.push({ url: r.value.url, variant: STYLE_VARIANTS[i].label });
        }
        else {
            console.warn(`[cake-concept] variant ${STYLE_VARIANTS[i].label} failed:`, r.reason.message);
        }
    });
    if (concepts.length === 0)
        throw new Error("all_variants_failed");
    return concepts;
}

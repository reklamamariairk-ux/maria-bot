/**
 * Cake-concept routes — AI-конструктор торта на заказ.
 *
 * - POST /api/cake-concept/generate — 3 концепт-картинки через Pollinations.ai (Flux)
 * - POST /api/cake-concept/submit   — отправить выбранный концепт менеджеру (Bitrix24 лид)
 *
 * Оба endpoints под requireTgUser + rateLimit (защита от ботнет-абуза AI-кредитов
 * Groq/Pollinations и спама Bitrix CRM произвольными URL).
 *
 * Whitelist `image_url` принимает только `https://image.pollinations.ai/*` —
 * иначе атакующий через DevTools мог пробросить порно/рекламу в лид.
 */

import { Router } from "express";
import https from "https";
import { generateCakeConcepts, isConceptEnabled } from "../cake-concept";
import { rateLimit } from "../middleware";
import { requireTgUser, tryGetTgUser } from "../auth";
import { log } from "../logger";

const router = Router();

export function isAllowedConceptImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "image.pollinations.ai"
      && !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
}

router.post("/api/cake-concept/generate", requireTgUser, rateLimit(2), async (req, res) => {
  const healthy = await isConceptEnabled();
  if (!healthy) {
    res.status(503).json({ error: "not_configured", message: "Сервис генерации картинок временно недоступен. Попробуй позже." });
    return;
  }
  const body = req.body as { prompt?: string };
  const prompt = String(body.prompt ?? "").trim();
  if (prompt.length < 5) {
    res.status(400).json({ error: "prompt_too_short", message: "Опиши торт подробнее (минимум 5 символов)" });
    return;
  }
  try {
    const concepts = await generateCakeConcepts(prompt);
    res.json({ ok: true, concepts });
  } catch (e) {
    log.error({ err: e, prompt }, "[cake-concept/generate]");
    res.status(500).json({ error: "internal", message: "Что-то пошло не так. Попробуй ещё раз." });
  }
});

router.post("/api/cake-concept/submit", requireTgUser, rateLimit(5), async (req, res) => {
  const b = req.body as {
    prompt?: string;
    image_url?: string;
    variant?: string;
    name?: string;
    phone?: string;
    event_date?: string;
    persons?: string;
    comment?: string;
  };
  if (!b.image_url || !b.prompt || !b.name || !b.phone) {
    res.status(400).json({ error: "missing_fields" });
    return;
  }
  // image_url должен быть с нашего AI-генератора. Иначе любой может пробросить
  // в лид Bitrix произвольную URL (через DevTools) — спам/реклама в CRM.
  if (!isAllowedConceptImageUrl(b.image_url)) {
    res.status(400).json({ error: "bad_image_url" });
    return;
  }
  const BITRIX_WEBHOOK = process.env.BITRIX_WEBHOOK ?? "";
  if (!BITRIX_WEBHOOK) {
    res.status(503).json({ error: "no_webhook" });
    return;
  }
  const tg = tryGetTgUser(req);
  const lines: string[] = [];
  lines.push(`▼ AI-конструктор торта на заказ`);
  lines.push(`▼ Стилистика: ${b.variant || "—"}`);
  lines.push("");
  lines.push(`▼ Описание от клиента:`);
  lines.push(b.prompt);
  lines.push("");
  if (b.event_date) lines.push(`📅 Дата: ${b.event_date}`);
  if (b.persons) lines.push(`👥 Гостей: ${b.persons}`);
  if (b.comment) {
    lines.push("");
    lines.push(`ⓘ Комментарий: ${b.comment}`);
  }
  lines.push("");
  lines.push(`🖼 Концепт-картинка: ${b.image_url}`);
  if (tg?.id) {
    const tgInfo = [tg.username ? `@${tg.username}` : null, `id=${tg.id}`].filter(Boolean).join(" · ");
    lines.push(`Telegram: ${tgInfo}`);
  }
  const parts = String(b.name).trim().split(/\s+/);
  const firstName = parts[0] || b.name;
  const lastName = parts.slice(1).join(" ");
  try {
    const base = BITRIX_WEBHOOK.endsWith("/") ? BITRIX_WEBHOOK : BITRIX_WEBHOOK + "/";
    const url = new URL(`${base}crm.lead.add.json`);
    const fields: Record<string, unknown> = {
      TITLE: `🎨 AI-концепт торта · ${b.name}`,
      NAME: firstName,
      LAST_NAME: lastName,
      PHONE: [{ VALUE: b.phone, VALUE_TYPE: "WORK" }],
      COMMENTS: lines.join("\n"),
      SOURCE_ID: "WEB",
      SOURCE_DESCRIPTION: "Telegram Mini App · AI-концепт",
    };
    const reqBody = JSON.stringify({ fields });
    await new Promise<void>((resolve, reject) => {
      const r = https.request({
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(reqBody) },
      }, (resp) => {
        let d = "";
        resp.on("data", (c) => (d += c));
        resp.on("end", () => {
          try {
            const json = JSON.parse(d) as { error?: string; error_description?: string };
            if (json.error) reject(new Error(json.error_description ?? json.error));
            else resolve();
          } catch (err) { reject(err); }
        });
      });
      r.on("error", reject);
      r.write(reqBody);
      r.end();
    });
    log.info({ name: b.name, tgId: tg?.id }, "[cake-concept] lead created");
    res.json({ ok: true });
  } catch (e) {
    log.error({ err: e, name: b.name }, "[cake-concept/submit]");
    res.status(502).json({ error: "lead_create_failed" });
  }
});

export default router;

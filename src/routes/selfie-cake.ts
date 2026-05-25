/**
 * Selfie-cake routes — AI-портрет на торте (img2img через Pollinations).
 *
 * - POST /api/selfie-cake       — принимает base64 фото → возвращает 3 концепта
 * - GET  /api/selfie-img/:id    — публичная раздача сохранённого селфи
 *                                 (Pollinations скачивает по этому URL)
 *
 * SSRF-защита: baseUrl для скачивания строится из WEBHOOK_URL/MINI_APP_URL env,
 * не из заголовков. ID = 128-бит random + path-traversal regex в readSelfie.
 */

import express, { Router } from "express";
import { isConceptEnabled } from "../cake-concept";
import { storeSelfie, readSelfie, generateSelfieCakes } from "../selfie-cake";
import { rateLimit } from "../middleware";
import { requireTgUser } from "../auth";
import { log } from "../logger";

const router = Router();

router.post(
  "/api/selfie-cake",
  requireTgUser,
  rateLimit(3),
  express.json({ limit: "8mb" }),
  async (req, res) => {
    const healthy = await isConceptEnabled();
    if (!healthy) {
      res.status(503).json({ error: "not_configured", message: "Сервис временно недоступен. Попробуй позже." });
      return;
    }
    const body = req.body as { image_b64?: string };
    const b64 = String(body.image_b64 ?? "");
    if (!b64) {
      res.status(400).json({ error: "no_image" });
      return;
    }
    try {
      // Pollinations должен мочь скачать наш selfie. baseUrl берётся из ENV (WEBHOOK_URL
      // или MINI_APP_URL), НЕ из request-заголовков — иначе атакующий через подделку
      // X-Forwarded-Host превратит наш API в SSRF-прокси (Pollinations скачает с evil.com).
      const baseUrl = (process.env.WEBHOOK_URL || process.env.MINI_APP_URL || "").trim();
      if (!baseUrl) {
        res.status(503).json({ error: "no_base_url", message: "Сервис не сконфигурирован." });
        return;
      }
      const stored = await storeSelfie(b64, baseUrl);
      const variants = generateSelfieCakes(stored.publicUrl);
      res.json({ ok: true, variants, selfie_id: stored.id });
    } catch (e) {
      const msg = (e as Error).message;
      log.error({ err: e }, "[selfie-cake]");
      if (msg === "bad_image_format") {
        res.status(400).json({ error: "bad_format", message: "Поддерживаются JPG, PNG, WebP" });
      } else if (msg === "image_too_large") {
        res.status(400).json({ error: "too_large", message: "Размер фото — до 6 МБ" });
      } else if (msg === "image_too_small") {
        res.status(400).json({ error: "too_small", message: "Слишком маленькое фото" });
      } else {
        res.status(500).json({ error: "internal", message: "Что-то пошло не так. Попробуй ещё раз." });
      }
    }
  }
);

// Публичная раздача временных selfie (Pollinations скачивает по этому URL).
// Защита: 128-бит random ID + path-traversal regex в readSelfie.
router.get("/api/selfie-img/:id", rateLimit(120), async (req, res) => {
  const id = String(req.params.id || "");
  const file = await readSelfie(id);
  if (!file) { res.status(404).end(); return; }
  res.setHeader("Content-Type", file.type);
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.end(file.buf);
});

export default router;

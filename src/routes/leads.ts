/**
 * Leads + voice transcribe routes.
 *
 * - POST /api/lead             — индивидуальный заказ торта → лид в Bitrix24 CRM
 * - POST /api/lead-corporate   — B2B-заказ → лид в Bitrix24 с тэгом «корпоратив»
 * - POST /api/transcribe       — голосовой ввод → Groq Whisper → текст (RU)
 *
 * Все три самостоятельны (Bitrix24 https + Groq fetch).
 */

import express, { Router } from "express";
import https from "https";
import path from "path";
import * as fsSync from "fs";
import * as crypto from "crypto";
import { rateLimit } from "../middleware";
import { log } from "../logger";

const router = Router();

const BITRIX_WEBHOOK = () => process.env.BITRIX_WEBHOOK ?? "";

// ─── Индивидуальный заказ торта ─────────────────────────────────────────────
router.post("/api/lead", rateLimit(10), express.json({ limit: "8mb" }), async (req, res) => {
  const { name, phone, description, date, portions, comment, photo } = req.body as {
    name?: string; phone?: string; description?: string;
    date?: string; portions?: string; comment?: string; photo?: string;
  };

  if (!name || !phone) {
    res.status(400).json({ error: "Имя и телефон обязательны" });
    return;
  }

  // Photo-референс → /tmp + URL в комментарии лида
  let photoUrl = "";
  if (photo && photo.startsWith("data:image/")) {
    try {
      const m = photo.match(/^data:image\/(\w+);base64,(.+)$/);
      if (m) {
        const ext = m[1] === "jpeg" ? "jpg" : m[1];
        const buf = Buffer.from(m[2], "base64");
        if (buf.length < 4 * 1024 * 1024) {
          const id = crypto.randomBytes(8).toString("hex");
          const dir = path.join("/tmp", "lead_photos");
          fsSync.mkdirSync(dir, { recursive: true });
          const fname = `${Date.now()}_${id}.${ext}`;
          fsSync.writeFileSync(path.join(dir, fname), buf);
          const base = (process.env.MINI_APP_URL || process.env.WEBHOOK_URL || "").replace(/\/$/, "");
          photoUrl = `${base}/lead-photo/${fname}`;
        }
      }
    } catch (e) {
      log.warn({ err: e }, "[LEAD] photo save failed");
    }
  }

  const title = `Заказ торта — ${name} (Telegram Mini App)`;
  const comments = [
    description && `Торт: ${description}`,
    date        && `Дата: ${date}`,
    portions    && `Порций: ${portions}`,
    comment     && `Комментарий: ${comment}`,
    photoUrl    && `Фото референса: ${photoUrl}`,
  ].filter(Boolean).join("\n");

  const webhook = BITRIX_WEBHOOK();
  if (!webhook) {
    log.warn("[ORDER] BITRIX_WEBHOOK not set, lead not created");
    res.json({ ok: true, warn: "no_webhook" });
    return;
  }

  try {
    const body = JSON.stringify({
      fields: {
        TITLE: title,
        NAME: name,
        PHONE: [{ VALUE: phone, VALUE_TYPE: "WORK" }],
        COMMENTS: comments,
        SOURCE_ID: "WEB",
      },
    });

    await new Promise<void>((resolve, reject) => {
      const url = new URL(`${webhook}crm.lead.add.json`);
      const r = https.request({
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      }, (resp) => {
        let d = "";
        resp.on("data", (c) => (d += c));
        resp.on("end", () => {
          const json = JSON.parse(d);
          if (json.error) reject(new Error(json.error_description ?? json.error));
          else resolve();
        });
      });
      r.on("error", reject);
      r.write(body);
      r.end();
    });

    log.info({ name }, "[ORDER] Lead created");
    res.json({ ok: true });
  } catch (e) {
    log.error({ err: e }, "[ORDER] Bitrix24 sync failed");
    res.status(502).json({ error: "Не удалось создать заявку, попробуйте позже" });
  }
});

// ─── B2B (корпоративные заказы) ─────────────────────────────────────────────
router.post("/api/lead-corporate", rateLimit(5), express.json({ limit: "1mb" }), async (req, res) => {
  const b = req.body as {
    company?: string; contact_name?: string; phone?: string; email?: string;
    event_type?: string; people?: number | string; budget?: string;
    date?: string; time?: string; address?: string;
    extras?: string[]; comment?: string;
  };
  if (!b.contact_name || !b.phone) {
    res.status(400).json({ error: "Контактное лицо и телефон обязательны" });
    return;
  }
  const people = Number(b.people) || 0;
  const extras = Array.isArray(b.extras) ? b.extras.filter((s) => typeof s === "string").slice(0, 10) : [];

  const company = (b.company || "").trim() || "—";
  const title = `🏢 Корпоратив · ${company} · ${b.contact_name}`;
  const lines: string[] = [];
  lines.push(`▼ Компания: ${company}`);
  lines.push(`▼ Контакт: ${b.contact_name}`);
  if (b.phone)      lines.push(`☎ Телефон: ${b.phone}`);
  if (b.email)      lines.push(`✉ Email: ${b.email}`);
  lines.push("");
  if (b.event_type) lines.push(`🎯 Тип события: ${b.event_type}`);
  if (people > 0)   lines.push(`👥 Кол-во гостей: ${people}`);
  if (b.budget)     lines.push(`💰 Бюджет: ${b.budget}`);
  if (b.date)       lines.push(`📅 Дата: ${b.date}${b.time ? " · " + b.time : ""}`);
  if (b.address)    lines.push(`📍 Адрес доставки: ${b.address}`);
  if (extras.length > 0) {
    lines.push("");
    lines.push("⚙ Доп. услуги:");
    for (const e of extras) lines.push(`  • ${e}`);
  }
  if (b.comment) {
    lines.push("");
    lines.push(`ⓘ Комментарий:`);
    lines.push(b.comment);
  }
  const comments = lines.join("\n");

  const webhook = BITRIX_WEBHOOK();
  if (!webhook) {
    log.warn("[B2B] BITRIX_WEBHOOK not set, lead not created");
    res.json({ ok: true, warn: "no_webhook" });
    return;
  }

  try {
    const parts = String(b.contact_name).trim().split(/\s+/);
    const firstName = parts[0] || b.contact_name;
    const lastName  = parts.slice(1).join(" ");
    const fields: Record<string, unknown> = {
      TITLE:              title,
      NAME:               firstName,
      LAST_NAME:          lastName,
      COMPANY_TITLE:      company !== "—" ? company : undefined,
      PHONE:              [{ VALUE: b.phone, VALUE_TYPE: "WORK" }],
      COMMENTS:           comments,
      SOURCE_ID:          "WEB",
      SOURCE_DESCRIPTION: "Telegram Mini App · B2B",
    };
    if (b.email) fields.EMAIL = [{ VALUE: b.email, VALUE_TYPE: "WORK" }];
    if (b.address) fields.ADDRESS = b.address;

    const body = JSON.stringify({ fields });
    await new Promise<void>((resolve, reject) => {
      const base = webhook.endsWith("/") ? webhook : webhook + "/";
      const url = new URL(`${base}crm.lead.add.json`);
      const r = https.request({
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      }, (resp) => {
        let d = "";
        resp.on("data", (c) => (d += c));
        resp.on("end", () => {
          try {
            const json = JSON.parse(d);
            if (json.error) reject(new Error(json.error_description ?? json.error));
            else resolve();
          } catch (e) { reject(e); }
        });
      });
      r.on("error", reject);
      r.write(body);
      r.end();
    });
    log.info({ company, contact: b.contact_name }, "[B2B] Lead created");
    res.json({ ok: true });
  } catch (e) {
    log.error({ err: e }, "[B2B] Bitrix24 sync failed");
    res.status(502).json({ error: "Не удалось создать заявку, попробуйте позже" });
  }
});

// ─── Voice transcribe (Groq Whisper) ────────────────────────────────────────
router.post("/api/transcribe",
  rateLimit(20),
  express.raw({ type: ["audio/*", "application/octet-stream"], limit: "6mb" }),
  async (req, res) => {
    const audio = req.body as Buffer;
    if (!Buffer.isBuffer(audio) || audio.length === 0) {
      res.status(400).json({ error: "audio body required" });
      return;
    }
    if (audio.length > 5 * 1024 * 1024) {
      res.status(413).json({ error: "audio too large (>5MB)" });
      return;
    }
    const ct = String(req.headers["content-type"] || "audio/webm");
    const ext = /mp4|m4a/i.test(ct) ? "m4a" : /ogg/i.test(ct) ? "ogg" : /wav/i.test(ct) ? "wav" : "webm";
    const groqKey = process.env.GROQ_KEY ?? "";
    if (!groqKey) {
      res.status(503).json({ error: "GROQ_KEY не задан" });
      return;
    }

    try {
      const fd = new FormData();
      fd.append("file", new Blob([audio], { type: ct }), `voice.${ext}`);
      fd.append("model", "whisper-large-v3-turbo");
      fd.append("language", "ru");
      fd.append("response_format", "json");
      fd.append("temperature", "0");

      const resp = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${groqKey}` },
        body: fd,
      });

      if (!resp.ok) {
        const errText = await resp.text();
        log.error({ status: resp.status, body: errText.slice(0, 200) }, "[TRANSCRIBE] Groq error");
        if (resp.status === 429) {
          res.status(429).json({ error: "Распознавание временно недоступно (лимит). Попробуй через минуту." });
        } else {
          res.status(502).json({ error: "Распознавание не удалось. Попробуй ещё раз или напиши текстом." });
        }
        return;
      }

      const data = await resp.json() as { text?: string };
      const text = (data.text ?? "").trim();
      res.json({ text });
    } catch (e) {
      log.error({ err: e }, "[TRANSCRIBE]");
      res.status(500).json({ error: "Ошибка распознавания. Попробуй ещё раз." });
    }
  }
);

export default router;

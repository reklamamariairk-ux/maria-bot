/** Read-only system controls for the administrator web console. */
import { Router } from "express";
import { pool } from "../db";
import { requireAdminToken, rateLimit } from "../middleware";
import { log } from "../logger";

export default function adminSystemRouter(): Router {
  const router = Router();

  router.get("/api/admin/system/status", requireAdminToken, rateLimit(30), async (_req, res) => {
    const started = Date.now();
    try {
      await pool.query("SELECT 1");
      res.json({
        ok: true,
        db: { ok: true, latencyMs: Date.now() - started },
        uptimeSec: Math.round(process.uptime()),
        node: process.version,
        env: process.env.NODE_ENV || "development",
        config: {
          giftsEnabled: process.env.CLICKER_GIFTS_ENABLED === "1",
          telegram: Boolean(process.env.BOT_TOKEN),
          database: Boolean(process.env.DATABASE_URL),
          monitoring: Boolean(process.env.SENTRY_DSN),
        },
        memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        checkedAt: new Date().toISOString(),
      });
    } catch (error) {
      log.error({ err: error }, "[admin system status]");
      res.status(503).json({ ok: false, db: { ok: false }, checkedAt: new Date().toISOString() });
    }
  });

  router.get("/api/admin/system/audit", requireAdminToken, rateLimit(30), async (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    try {
      const { rows } = await pool.query(
        `SELECT chat_id, event, meta, created_at
           FROM clicker_events
          WHERE event LIKE 'admin_%'
          ORDER BY created_at DESC
          LIMIT $1`, [limit]);
      res.json({ events: rows.map((row) => ({ ...row, chat_id: String(row.chat_id) })) });
    } catch (error) {
      log.error({ err: error }, "[admin system audit]");
      res.status(500).json({ error: "internal" });
    }
  });

  return router;
}

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

  router.get("/api/admin/economy/report", requireAdminToken, rateLimit(30), async (_req, res) => {
    try {
      const [totals, cases, top, suspicious] = await Promise.all([
        pool.query(`SELECT COUNT(*)::int AS players,
                           COALESCE(SUM(balance),0)::bigint AS balance,
                           COALESCE(SUM(total_earned),0)::bigint AS total_earned,
                           COALESCE(SUM(case_spent),0)::bigint AS case_spent,
                           COALESCE(SUM(case_won),0)::bigint AS case_won,
                           COALESCE(SUM(taps),0)::bigint AS taps
                      FROM clicker_state`),
        pool.query(`SELECT COUNT(*)::int AS openings,
                           COALESCE(SUM(cost),0)::bigint AS spent,
                           COALESCE(SUM(balance_after-balance_before),0)::bigint AS balance_delta
                      FROM clicker_case_history`),
        pool.query(`SELECT chat_id::text, balance::bigint, total_earned::bigint, taps::bigint,
                           case_spent::bigint, case_won::bigint
                      FROM clicker_state ORDER BY total_earned DESC LIMIT 20`),
        pool.query(`SELECT chat_id::text, balance::bigint, total_earned::bigint, taps::bigint,
                           case_spent::bigint, case_won::bigint
                      FROM clicker_state
                     WHERE total_earned > 1000000
                        OR (case_spent > 0 AND case_won > case_spent * 2)
                     ORDER BY total_earned DESC LIMIT 100`),
      ]);
      res.json({ totals: totals.rows[0], cases: cases.rows[0], top: top.rows, suspicious: suspicious.rows });
    } catch (error) {
      log.error({ err: error }, "[admin economy report]");
      res.status(500).json({ error: "internal" });
    }
  });

  return router;
}

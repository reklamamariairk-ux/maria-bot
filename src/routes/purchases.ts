import { Router } from "express";
import { getTgUser } from "../auth";
import { rateLimit, requireAdminToken } from "../middleware";
import { requireGameUser as requireTgUser } from "../game-auth";
import { getPurchaseTasks, getPurchaseTaskClaims, syncPurchases } from "../purchase1c";

const router = Router();

router.get("/api/clicker/purchase-tasks", requireTgUser, rateLimit(60), async (req, res) => {
  const user = getTgUser(req)!;
  try { res.json({ tasks: await getPurchaseTasks(user.id), claims: await getPurchaseTaskClaims(user.id) }); }
  catch { res.status(500).json({ error: "internal" }); }
});

// Manual admin sync is useful for acceptance tests; normal sync is scheduled.
router.post("/api/admin/purchases/sync", requireAdminToken, rateLimit(10), async (req, res) => {
  try { const result = await syncPurchases(typeof req.body?.period === "string" ? req.body.period : undefined); res.json(result); }
  catch { res.status(502).json({ error: "purchase_sync_failed" }); }
});

router.get("/api/admin/purchase-tasks", requireAdminToken, rateLimit(30), async (_req, res) => {
  try {
    const { pool } = await import("../db");
    const { rows } = await pool.query(`SELECT id,title,description,product_codes AS "productCodes",store_codes AS "storeCodes",min_qty AS "minQty",min_amount AS "minAmount",reward_coins AS "rewardCoins",loyalty_points AS "loyaltyPoints",starts_at AS "startsAt",ends_at AS "endsAt",max_claims AS "maxClaims",is_active AS "isActive" FROM purchase_tasks ORDER BY id DESC`);
    res.json({ tasks: rows });
  } catch { res.status(500).json({ error: "internal" }); }
});

router.post("/api/admin/purchase-tasks", requireAdminToken, rateLimit(20), async (req, res) => {
  const b = req.body ?? {};
  const title = String(b.title ?? "").trim();
  const productCodes = Array.isArray(b.productCodes) ? b.productCodes.map(String).map((x: string) => x.trim()).filter(Boolean) : [];
  if (!title || !productCodes.length) { res.status(400).json({ error: "title_and_productCodes_required" }); return; }
  try {
    const { pool } = await import("../db");
    const { rows } = await pool.query(`INSERT INTO purchase_tasks (title,description,product_codes,store_codes,min_qty,min_amount,reward_coins,loyalty_points,starts_at,ends_at,max_claims) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::timestamptz,NOW()),$10,$11) RETURNING id`, [title, String(b.description ?? ""), productCodes, Array.isArray(b.storeCodes) ? b.storeCodes.map(String) : [], Math.max(0.01, Number(b.minQty) || 1), Math.max(0, Number(b.minAmount) || 0), Math.max(0, Math.floor(Number(b.rewardCoins) || 0)), Math.max(0, Math.floor(Number(b.loyaltyPoints) || 0)), b.startsAt ?? null, b.endsAt ?? null, b.maxClaims == null ? null : Math.max(1, Math.floor(Number(b.maxClaims) || 1))]);
    res.status(201).json({ id: rows[0].id });
  } catch { res.status(500).json({ error: "internal" }); }
});

router.post("/api/admin/purchase-tasks/:id/disable", requireAdminToken, rateLimit(30), async (req, res) => {
  try { const { pool } = await import("../db"); await pool.query(`UPDATE purchase_tasks SET is_active=false WHERE id=$1`, [Number(req.params.id)]); res.json({ ok: true }); }
  catch { res.status(500).json({ error: "internal" }); }
});

export default router;

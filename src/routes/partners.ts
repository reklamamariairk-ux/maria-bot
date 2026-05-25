/**
 * Partners routes — список партнёров клуба + ручной sync с Bitrix.
 *
 * - GET  /api/partners        публичный, отдаёт getPartners() + meta
 * - POST /api/partners/sync   admin-only, триггерит syncPartners()
 */

import { Router } from "express";
import { getPartners, getPartnersMeta, syncPartners } from "../partners";
import { rateLimit, requireAdminToken } from "../middleware";

const router = Router();

router.get("/api/partners", rateLimit(60), (_req, res) => {
  res.json({ partners: getPartners(), meta: getPartnersMeta() });
});

router.post("/api/partners/sync", requireAdminToken, async (_req, res) => {
  const result = await syncPartners();
  res.json(result);
});

export default router;

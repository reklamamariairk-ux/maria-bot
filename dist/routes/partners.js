"use strict";
/**
 * Partners routes — список партнёров клуба + ручной sync с Bitrix.
 *
 * - GET  /api/partners        публичный, отдаёт getPartners() + meta
 * - POST /api/partners/sync   admin-only, триггерит syncPartners()
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const partners_1 = require("../partners");
const middleware_1 = require("../middleware");
const router = (0, express_1.Router)();
router.get("/api/partners", (0, middleware_1.rateLimit)(60), (_req, res) => {
    res.json({ partners: (0, partners_1.getPartners)(), meta: (0, partners_1.getPartnersMeta)() });
});
router.post("/api/partners/sync", middleware_1.requireAdminToken, (0, middleware_1.requireAdminRole)("operator"), async (_req, res) => {
    const result = await (0, partners_1.syncPartners)();
    res.json(result);
});
exports.default = router;

/**
 * Clicker routes — «Котик Комбат».
 * GET  /api/clicker            · POST /api/clicker/tap {taps}
 * POST /api/clicker/buy {type,id} · POST /api/clicker/daily
 * POST /api/clicker/boost {type:turbo|energy} · GET /api/clicker/top
 */
import { Router } from "express";
import { getClicker, tapClicker, buyClicker, claimDaily, boostClicker, getTop } from "../clicker";
import { rateLimit } from "../middleware";
import { requireTgUser, getTgUser } from "../auth";
import { log } from "../logger";

const router = Router();

router.get("/api/clicker", requireTgUser, rateLimit(120), async (req, res) => {
  const u = getTgUser(req)!;
  try { res.json(await getClicker(u.id)); } catch (e) { log.error({ err: e, chatId: u.id }, "[GET /api/clicker]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/tap", requireTgUser, rateLimit(120), async (req, res) => {
  const u = getTgUser(req)!; const taps = Number((req.body as { taps?: number }).taps) || 0;
  try { res.json(await tapClicker(u.id, taps)); } catch (e) { log.error({ err: e, chatId: u.id }, "[tap]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/buy", requireTgUser, rateLimit(60), async (req, res) => {
  const u = getTgUser(req)!; const { type, id } = req.body as { type?: string; id?: string };
  try { const r = await buyClicker(u.id, String(type || ""), id); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json(r.state); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[buy]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/daily", requireTgUser, rateLimit(30), async (req, res) => {
  const u = getTgUser(req)!;
  try { const r = await claimDaily(u.id); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json({ reward: r.reward, ...r.state }); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[daily]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/boost", requireTgUser, rateLimit(60), async (req, res) => {
  const u = getTgUser(req)!; const type = String((req.body as { type?: string }).type || "");
  try { const r = await boostClicker(u.id, type); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json(r.state); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[boost]"); res.status(500).json({ error: "internal" }); }
});

router.get("/api/clicker/top", requireTgUser, rateLimit(60), async (req, res) => {
  const u = getTgUser(req)!;
  try { res.json(await getTop(u.id, 30)); } catch (e) { log.error({ err: e, chatId: u.id }, "[top]"); res.status(500).json({ error: "internal" }); }
});

export default router;

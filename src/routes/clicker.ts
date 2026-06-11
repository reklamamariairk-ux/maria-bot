/**
 * Clicker routes — «Котик Комбат».
 * GET  /api/clicker            · POST /api/clicker/tap {taps}
 * POST /api/clicker/buy {type,id} · POST /api/clicker/daily
 * POST /api/clicker/boost {type:turbo|energy} · GET /api/clicker/top
 */
import { Router } from "express";
import { getClicker, tapClicker, buyClicker, claimDaily, boostClicker, getTop, registerRef, getTasks, claimTask, claimCombo, claimCipher, getAchievements } from "../clicker";
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

router.post("/api/clicker/combo", requireTgUser, rateLimit(30), async (req, res) => {
  const u = getTgUser(req)!;
  try { const r = await claimCombo(u.id); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json({ reward: r.reward, ...r.state }); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[combo]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/cipher", requireTgUser, rateLimit(30), async (req, res) => {
  const u = getTgUser(req)!; const guess = String((req.body as { guess?: string }).guess || "");
  try { const r = await claimCipher(u.id, guess); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json({ reward: r.reward, ...r.state }); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[cipher]"); res.status(500).json({ error: "internal" }); }
});

router.get("/api/clicker/top", requireTgUser, rateLimit(60), async (req, res) => {
  const u = getTgUser(req)!;
  try { res.json(await getTop(u.id, 30)); } catch (e) { log.error({ err: e, chatId: u.id }, "[top]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/ref", requireTgUser, rateLimit(20), async (req, res) => {
  const u = getTgUser(req)!; const code = String((req.body as { code?: string }).code || "");
  try { const r = await registerRef(u.id, code); res.json({ refReward: r.ok ? r.reward : 0, ...r.state }); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[ref]"); res.status(500).json({ error: "internal" }); }
});

router.get("/api/clicker/tasks", requireTgUser, rateLimit(60), async (req, res) => {
  const u = getTgUser(req)!;
  try { res.json(await getTasks(u.id)); } catch (e) { log.error({ err: e, chatId: u.id }, "[tasks]"); res.status(500).json({ error: "internal" }); }
});

router.get("/api/clicker/achievements", requireTgUser, rateLimit(60), async (req, res) => {
  const u = getTgUser(req)!;
  try { res.json(await getAchievements(u.id)); } catch (e) { log.error({ err: e, chatId: u.id }, "[achievements]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/task", requireTgUser, rateLimit(40), async (req, res) => {
  const u = getTgUser(req)!; const id = String((req.body as { id?: string }).id || "");
  try { const r = await claimTask(u.id, id); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json({ reward: r.reward, ...r.state }); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[task]"); res.status(500).json({ error: "internal" }); }
});

export default router;

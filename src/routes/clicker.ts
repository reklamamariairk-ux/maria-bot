/**
 * Clicker routes — «Котик Комбат».
 * GET  /api/clicker            · POST /api/clicker/tap {taps}
 * POST /api/clicker/buy {type,id} · POST /api/clicker/daily
 * POST /api/clicker/boost {type:turbo|energy} · GET /api/clicker/top
 */
import { Router } from "express";
import { getClicker, tapClicker, buyClicker, claimDaily, boostClicker, getTop, registerRef, getTasks, claimTask, claimCombo, claimCipher, getAchievements, getRewards, redeemReward, claimBonus, openChest, claimRain, claimGame, redeemCode, getSquads, joinSquad } from "../clicker";
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

router.post("/api/clicker/code", requireTgUser, rateLimit(20), async (req, res) => {
  const u = getTgUser(req)!; const code = String((req.body as { code?: string }).code || "");
  try { const r = await redeemCode(u.id, code); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json({ reward: r.reward, ...r.state }); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[code]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/rain", requireTgUser, rateLimit(30), async (req, res) => {
  const u = getTgUser(req)!; const score = Number((req.body as { score?: number }).score) || 0;
  try { const r = await claimRain(u.id, score); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json({ reward: r.reward, ...r.state }); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[rain]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/game", requireTgUser, rateLimit(40), async (req, res) => {
  const u = getTgUser(req)!; const { game, score } = req.body as { game?: string; score?: number };
  try { const r = await claimGame(u.id, String(game || ""), Number(score) || 0); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json({ reward: r.reward, game: r.game, ...r.state }); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[game]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/chest", requireTgUser, rateLimit(30), async (req, res) => {
  const u = getTgUser(req)!;
  try { const r = await openChest(u.id); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json({ prize: r.prize, ...r.state }); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[chest]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/bonus", requireTgUser, rateLimit(60), async (req, res) => {
  const u = getTgUser(req)!;
  try { const r = await claimBonus(u.id); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json({ amount: r.amount, ...r.state }); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[bonus]"); res.status(500).json({ error: "internal" }); }
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

router.get("/api/clicker/squads", requireTgUser, rateLimit(60), async (req, res) => {
  const u = getTgUser(req)!;
  try { res.json(await getSquads(u.id)); } catch (e) { log.error({ err: e, chatId: u.id }, "[squads]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/squad", requireTgUser, rateLimit(20), async (req, res) => {
  const u = getTgUser(req)!; const id = String((req.body as { id?: string }).id || "");
  try { const r = await joinSquad(u.id, id); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json(r.state); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[squad]"); res.status(500).json({ error: "internal" }); }
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

router.get("/api/clicker/rewards", requireTgUser, rateLimit(60), async (req, res) => {
  const u = getTgUser(req)!;
  try { res.json(await getRewards(u.id)); } catch (e) { log.error({ err: e, chatId: u.id }, "[rewards]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/redeem", requireTgUser, rateLimit(20), async (req, res) => {
  const u = getTgUser(req)!; const id = String((req.body as { id?: string }).id || "");
  try { const r = await redeemReward(u.id, id); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json({ code: r.code, ...r.state }); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[redeem]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/task", requireTgUser, rateLimit(40), async (req, res) => {
  const u = getTgUser(req)!; const id = String((req.body as { id?: string }).id || "");
  try { const r = await claimTask(u.id, id); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json({ reward: r.reward, ...r.state }); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[task]"); res.status(500).json({ error: "internal" }); }
});

export default router;

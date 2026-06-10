/**
 * Clicker routes — «Котик Комбат».
 * - GET  /api/clicker             — состояние (энергия+пассив применены)
 * - POST /api/clicker/tap {taps}  — засчитать пачку тапов
 * - POST /api/clicker/buy {type,id} — апгрейд: multitap | energy | card(id)
 */
import { Router } from "express";
import { getClicker, tapClicker, buyClicker } from "../clicker";
import { rateLimit } from "../middleware";
import { requireTgUser, getTgUser } from "../auth";
import { log } from "../logger";

const router = Router();

router.get("/api/clicker", requireTgUser, rateLimit(120), async (req, res) => {
  const u = getTgUser(req)!;
  try { res.json(await getClicker(u.id)); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[GET /api/clicker]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/tap", requireTgUser, rateLimit(120), async (req, res) => {
  const u = getTgUser(req)!;
  const taps = Number((req.body as { taps?: number }).taps) || 0;
  try { res.json(await tapClicker(u.id, taps)); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[POST /api/clicker/tap]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/buy", requireTgUser, rateLimit(60), async (req, res) => {
  const u = getTgUser(req)!;
  const { type, id } = req.body as { type?: string; id?: string };
  try {
    const r = await buyClicker(u.id, String(type || ""), id);
    if (!r.ok) { res.status(400).json({ error: r.reason }); return; }
    res.json(r.state);
  } catch (e) { log.error({ err: e, chatId: u.id }, "[POST /api/clicker/buy]"); res.status(500).json({ error: "internal" }); }
});

export default router;

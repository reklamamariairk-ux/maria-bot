/**
 * Clicker routes — «Котик Комбат».
 * - GET  /api/clicker            — состояние (энергия восстановлена)
 * - POST /api/clicker/tap {taps} — засчитать пачку тапов
 */
import { Router } from "express";
import { getClicker, tapClicker, LEVELS } from "../clicker";
import { rateLimit } from "../middleware";
import { requireTgUser, getTgUser } from "../auth";
import { log } from "../logger";

const router = Router();

router.get("/api/clicker", requireTgUser, rateLimit(120), async (req, res) => {
  const u = getTgUser(req)!;
  try {
    res.json({ ...(await getClicker(u.id)), levels: LEVELS.map((l) => ({ level: l.level, name: l.name, need: l.need })) });
  } catch (e) {
    log.error({ err: e, chatId: u.id }, "[GET /api/clicker]");
    res.status(500).json({ error: "internal" });
  }
});

router.post("/api/clicker/tap", requireTgUser, rateLimit(120), async (req, res) => {
  const u = getTgUser(req)!;
  const taps = Number((req.body as { taps?: number }).taps) || 0;
  try {
    res.json(await tapClicker(u.id, taps));
  } catch (e) {
    log.error({ err: e, chatId: u.id }, "[POST /api/clicker/tap]");
    res.status(500).json({ error: "internal" });
  }
});

export default router;

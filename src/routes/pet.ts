/**
 * Pet routes — виртуальный питомец «Котик Марии».
 * - GET  /api/pet                 — состояние (с применённым decay)
 * - POST /api/pet/action {action} — уход: feed|sleep|wash|play
 * - POST /api/pet/location {location} — сменить локацию
 */
import { Router } from "express";
import { getPet, doPetAction, setPetLocation, buyPetItem, equipPetItem, SHOP, type PetAction } from "../pet";
import { rateLimit } from "../middleware";
import { requireTgUser, getTgUser } from "../auth";
import { log } from "../logger";

const router = Router();

router.get("/api/pet", requireTgUser, rateLimit(60), async (req, res) => {
  const u = getTgUser(req)!;
  try {
    res.json(await getPet(u.id));
  } catch (e) {
    log.error({ err: e, chatId: u.id }, "[GET /api/pet]");
    res.status(500).json({ error: "internal" });
  }
});

router.post("/api/pet/action", requireTgUser, rateLimit(60), async (req, res) => {
  const u = getTgUser(req)!;
  const action = String((req.body as { action?: string }).action || "") as PetAction;
  try {
    const r = await doPetAction(u.id, action);
    if (!r.ok) { res.status(400).json({ error: r.reason }); return; }
    res.json(r.state);
  } catch (e) {
    log.error({ err: e, chatId: u.id, action }, "[POST /api/pet/action]");
    res.status(500).json({ error: "internal" });
  }
});

router.post("/api/pet/location", requireTgUser, rateLimit(60), async (req, res) => {
  const u = getTgUser(req)!;
  const location = String((req.body as { location?: string }).location || "");
  try {
    res.json(await setPetLocation(u.id, location));
  } catch (e) {
    log.error({ err: e, chatId: u.id }, "[POST /api/pet/location]");
    res.status(500).json({ error: "internal" });
  }
});

// Каталог магазина (публичный, без авторизации)
router.get("/api/pet/shop", (_req, res) => res.json({ shop: SHOP }));

router.post("/api/pet/buy", requireTgUser, rateLimit(40), async (req, res) => {
  const u = getTgUser(req)!;
  const item = String((req.body as { item?: string }).item || "");
  try {
    const r = await buyPetItem(u.id, item);
    if (!r.ok) { res.status(400).json({ error: r.reason }); return; }
    res.json(r.state);
  } catch (e) {
    log.error({ err: e, chatId: u.id, item }, "[POST /api/pet/buy]");
    res.status(500).json({ error: "internal" });
  }
});

router.post("/api/pet/equip", requireTgUser, rateLimit(60), async (req, res) => {
  const u = getTgUser(req)!;
  const item = String((req.body as { item?: string }).item || "");
  try {
    const r = await equipPetItem(u.id, item);
    if (!r.ok) { res.status(400).json({ error: r.reason }); return; }
    res.json(r.state);
  } catch (e) {
    log.error({ err: e, chatId: u.id, item }, "[POST /api/pet/equip]");
    res.status(500).json({ error: "internal" });
  }
});

export default router;

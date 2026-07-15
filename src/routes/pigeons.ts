/**
 * Pigeons routes — «Голубятня» (коллекция/сеты/звёзды/обмены/почта).
 * GET  /api/pigeons                  · POST /api/pigeons/set-claim {set}
 * GET  /api/pigeons/trades           · POST /api/pigeons/trade {give,want,to?}
 * POST /api/pigeons/trade/accept {id}· POST /api/pigeons/trade/cancel {id}
 * POST /api/pigeons/mail {breed,to,sticker} · POST /api/pigeons/mail/thanks {id,sticker}
 * GET  /api/pigeons/mail             · GET  /api/pigeons/recipients
 * POST /api/pigeons/feed {breed}     · POST /api/pigeons/showcase {breeds}
 * POST /api/pigeons/race/enter {breed} · GET /api/pigeons/race — за флагом PIGEON_RACE_ENABLED
 *
 * sendMail нужен PushService для пуша получателю — роутер собирается фабрикой
 * createPigeonsRouter(push), как createWheelStreakRouter/createReferralRouter.
 */
import { Router } from "express";
import {
  getPigeonsOverview, claimSet, getTradeBoard, createTrade, acceptTrade, cancelTrade,
  sendMail, getInbox, thankMail, getMailRecipients, feedPigeon, setShowcase,
  enterRace, getRace,
} from "../pigeons";
import type { PushService } from "../push";
import { requireTgUser, getTgUser } from "../auth";
import { rateLimit } from "../middleware";
import { log } from "../logger";

export function createPigeonsRouter(push: PushService): Router {
  const router = Router();

  router.get("/api/pigeons", requireTgUser, rateLimit(60), async (req, res) => {
    const u = getTgUser(req)!;
    try { res.json(await getPigeonsOverview(u.id)); }
    catch (e) { log.error({ err: e, chatId: u.id }, "[pigeons]"); res.status(500).json({ error: "internal" }); }
  });

  router.post("/api/pigeons/set-claim", requireTgUser, rateLimit(20), async (req, res) => {
    const u = getTgUser(req)!; const set = String((req.body as { set?: string }).set || "");
    try { const r = await claimSet(u.id, set); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json(r); }
    catch (e) { log.error({ err: e, chatId: u.id }, "[pigeons/set-claim]"); res.status(500).json({ error: "internal" }); }
  });

  router.get("/api/pigeons/trades", requireTgUser, rateLimit(60), async (req, res) => {
    const u = getTgUser(req)!;
    try { res.json(await getTradeBoard(u.id)); }
    catch (e) { log.error({ err: e, chatId: u.id }, "[pigeons/trades]"); res.status(500).json({ error: "internal" }); }
  });

  router.post("/api/pigeons/trade", requireTgUser, rateLimit(20), async (req, res) => {
    const u = getTgUser(req)!;
    const { give, want, to } = req.body as { give?: string; want?: string; to?: number };
    const toNum = to === undefined || to === null ? undefined : Number(to);
    if (toNum !== undefined && !Number.isInteger(toNum)) { res.status(400).json({ error: "bad_input" }); return; }
    try {
      const r = await createTrade(u.id, String(give || ""), String(want || ""), toNum);
      if (!r.ok) { res.status(400).json({ error: r.reason }); return; }
      res.json(r);
    } catch (e) { log.error({ err: e, chatId: u.id }, "[pigeons/trade]"); res.status(500).json({ error: "internal" }); }
  });

  router.post("/api/pigeons/trade/accept", requireTgUser, rateLimit(20), async (req, res) => {
    const u = getTgUser(req)!; const id = Number((req.body as { id?: number }).id);
    if (!Number.isInteger(id)) { res.status(400).json({ error: "bad_input" }); return; }
    try { const r = await acceptTrade(u.id, id); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json(r); }
    catch (e) { log.error({ err: e, chatId: u.id }, "[pigeons/trade/accept]"); res.status(500).json({ error: "internal" }); }
  });

  router.post("/api/pigeons/trade/cancel", requireTgUser, rateLimit(20), async (req, res) => {
    const u = getTgUser(req)!; const id = Number((req.body as { id?: number }).id);
    if (!Number.isInteger(id)) { res.status(400).json({ error: "bad_input" }); return; }
    try { const r = await cancelTrade(u.id, id); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json(r); }
    catch (e) { log.error({ err: e, chatId: u.id }, "[pigeons/trade/cancel]"); res.status(500).json({ error: "internal" }); }
  });

  router.post("/api/pigeons/mail", requireTgUser, rateLimit(10), async (req, res) => {
    const u = getTgUser(req)!;
    const { breed, to, sticker } = req.body as { breed?: string; to?: unknown; sticker?: number };
    // to принимает только 'random' | 'squad' | 'ref' | числовой chatId — всё остальное отсекаем
    // здесь, до вызова sendMail (squad резолвится на сервере из своего же squad отправителя).
    let toVal: number | "random" | "squad" | "ref";
    if (to === "random" || to === "squad" || to === "ref") {
      toVal = to;
    } else {
      const n = Number(to);
      if (!Number.isInteger(n)) { res.status(400).json({ error: "bad_input" }); return; }
      toVal = n;
    }
    try {
      const r = await sendMail(u.id, String(breed || ""), toVal, Number(sticker), push);
      if (!r.ok) { res.status(400).json({ error: r.reason }); return; }
      res.json(r);
    } catch (e) { log.error({ err: e, chatId: u.id }, "[pigeons/mail]"); res.status(500).json({ error: "internal" }); }
  });

  router.post("/api/pigeons/mail/thanks", requireTgUser, rateLimit(20), async (req, res) => {
    const u = getTgUser(req)!;
    const { id, sticker } = req.body as { id?: number; sticker?: number };
    const idNum = Number(id);
    if (!Number.isInteger(idNum)) { res.status(400).json({ error: "bad_input" }); return; }
    try {
      const r = await thankMail(u.id, idNum, Number(sticker));
      if (!r.ok) { res.status(400).json({ error: r.reason }); return; }
      res.json(r);
    } catch (e) { log.error({ err: e, chatId: u.id }, "[pigeons/mail/thanks]"); res.status(500).json({ error: "internal" }); }
  });

  router.get("/api/pigeons/mail", requireTgUser, rateLimit(60), async (req, res) => {
    const u = getTgUser(req)!;
    try { res.json(await getInbox(u.id)); }
    catch (e) { log.error({ err: e, chatId: u.id }, "[pigeons/mail get]"); res.status(500).json({ error: "internal" }); }
  });

  router.get("/api/pigeons/recipients", requireTgUser, rateLimit(60), async (req, res) => {
    const u = getTgUser(req)!;
    try { res.json(await getMailRecipients(u.id)); }
    catch (e) { log.error({ err: e, chatId: u.id }, "[pigeons/recipients]"); res.status(500).json({ error: "internal" }); }
  });

  router.post("/api/pigeons/feed", requireTgUser, rateLimit(20), async (req, res) => {
    const u = getTgUser(req)!; const breed = String((req.body as { breed?: string }).breed || "");
    try { const r = await feedPigeon(u.id, breed); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json(r); }
    catch (e) { log.error({ err: e, chatId: u.id }, "[pigeons/feed]"); res.status(500).json({ error: "internal" }); }
  });

  router.post("/api/pigeons/showcase", requireTgUser, rateLimit(20), async (req, res) => {
    const u = getTgUser(req)!; const breeds = (req.body as { breeds?: string[] }).breeds;
    try {
      const r = await setShowcase(u.id, Array.isArray(breeds) ? breeds : []);
      if (!r.ok) { res.status(400).json({ error: r.reason }); return; }
      res.json(r);
    } catch (e) { log.error({ err: e, chatId: u.id }, "[pigeons/showcase]"); res.status(500).json({ error: "internal" }); }
  });

  router.post("/api/pigeons/race/enter", requireTgUser, rateLimit(20), async (req, res) => {
    const u = getTgUser(req)!; const breed = String((req.body as { breed?: string }).breed || "");
    try { const r = await enterRace(u.id, breed); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json(r); }
    catch (e) { log.error({ err: e, chatId: u.id }, "[pigeons/race/enter]"); res.status(500).json({ error: "internal" }); }
  });

  router.get("/api/pigeons/race", requireTgUser, rateLimit(60), async (req, res) => {
    const u = getTgUser(req)!;
    try { res.json(await getRace(u.id)); }
    catch (e) { log.error({ err: e, chatId: u.id }, "[pigeons/race]"); res.status(500).json({ error: "internal" }); }
  });

  return router;
}

export default createPigeonsRouter;

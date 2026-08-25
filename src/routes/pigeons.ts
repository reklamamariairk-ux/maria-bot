/**
 * Pigeons routes — «Голубятня» (коллекция/сеты/звёзды/обмены).
 * GET  /api/pigeons                  · POST /api/pigeons/set-claim {set}
 * GET  /api/pigeons/trades           · POST /api/pigeons/trade {give,want,to?}
 * POST /api/pigeons/trade/accept {id}· POST /api/pigeons/trade/cancel {id} · POST /api/pigeons/trade/decline {id}
 * Почта отключена продуктово: mail endpoints ниже возвращают 410, чтобы старый клиент
 * не мог продолжать отправлять голубей.
 * POST /api/pigeons/feed {breed}     · POST /api/pigeons/showcase {breeds}
 * POST /api/pigeons/race/enter {breed} · GET /api/pigeons/race — за флагом PIGEON_RACE_ENABLED
 */
import { Router } from "express";
import {
  getPigeonsOverview, claimSet,
  feedPigeon, setShowcase,
  enterRace, getRace, getTuning, upgradeTune, BREED_BY_ID,
  getMailRecipients, getPigeonMissions, startPigeonMission, claimPigeonMission,
} from "../pigeons";
import type { PushService } from "../push";
import { requireTgUser, getTgUser } from "../game-auth";
import { rateLimit } from "../middleware";
import { log } from "../logger";

export function createPigeonsRouter(push: PushService): Router {
  const router = Router();
  void push;
  const tradesDisabled = (_req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }) => {
    res.status(410).json({ error: "trades_disabled", message: "Обмен голубями отключён" });
  };

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

  router.get("/api/pigeons/trades", tradesDisabled);
  router.post("/api/pigeons/trade", tradesDisabled);
  router.post("/api/pigeons/trade/accept", tradesDisabled);
  router.post("/api/pigeons/trade/cancel", tradesDisabled);
  router.post("/api/pigeons/trade/decline", tradesDisabled);

  // Старые адреса тоже должны подчиняться продуктовому выключателю. Иначе
  // модифицированный/закэшированный клиент мог обходить скрытый интерфейс.
  router.get("/api/pigeons/trades-legacy", tradesDisabled);
  router.post("/api/pigeons/trade-legacy", tradesDisabled);
  router.post("/api/pigeons/trade/accept-legacy", tradesDisabled);
  router.post("/api/pigeons/trade/cancel-legacy", tradesDisabled);
  router.post("/api/pigeons/trade/decline-legacy", tradesDisabled);

  router.get("/api/pigeons/missions", requireTgUser, rateLimit(60), async (req, res) => {
    const u = getTgUser(req)!;
    try { res.json(await getPigeonMissions(u.id)); }
    catch (e) { log.error({ err: e, chatId: u.id }, "[pigeons/missions]"); res.status(500).json({ error: "internal" }); }
  });

  router.post("/api/pigeons/missions/start", requireTgUser, rateLimit(30), async (req, res) => {
    const u = getTgUser(req)!; const b = req.body as { missionId?: string; breed?: string };
    try {
      const r = await startPigeonMission(u.id, String(b.missionId || ""), String(b.breed || ""));
      if (!r.ok) { res.status(400).json({ error: r.reason }); return; }
      res.json(r);
    } catch (e) { log.error({ err: e, chatId: u.id }, "[pigeons/missions/start]"); res.status(500).json({ error: "internal" }); }
  });

  router.post("/api/pigeons/missions/claim", requireTgUser, rateLimit(30), async (req, res) => {
    const u = getTgUser(req)!; const id = Number((req.body as { id?: number }).id);
    try {
      const r = await claimPigeonMission(u.id, id);
      if (!r.ok) { res.status(400).json({ error: r.reason }); return; }
      res.json(r);
    } catch (e) { log.error({ err: e, chatId: u.id }, "[pigeons/missions/claim]"); res.status(500).json({ error: "internal" }); }
  });
  router.post("/api/pigeons/mail", requireTgUser, rateLimit(10), async (req, res) => {
    res.status(410).json({ error: "disabled" });
  });

  router.post("/api/pigeons/mail/thanks", requireTgUser, rateLimit(20), async (req, res) => {
    res.status(410).json({ error: "disabled" });
  });

  router.get("/api/pigeons/mail", requireTgUser, rateLimit(60), async (req, res) => {
    res.status(410).json({ error: "disabled", mail: [] });
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
    const u = getTgUser(req)!;
    const b = req.body as { breed?: string; skill?: { rev1?: number; reactionMs?: number } };
    const breed = String(b.breed || "");
    try {
      // Отборочный полёт (v2): skill-инпут untrusted, та же нормализация, что в drag/race.
      let skill01 = 0;
      if (b.skill && typeof b.skill === "object") {
        const { launchSkill } = await import("../drag");
        skill01 = launchSkill({
          rev1: Number.isFinite(Number(b.skill.rev1)) ? Number(b.skill.rev1) : 9999,
          reactionMs: Math.max(0, Number(b.skill.reactionMs)) || 3000,
        });
      }
      const r = await enterRace(u.id, breed, skill01);
      if (!r.ok) { res.status(400).json({ error: r.reason }); return; }
      res.json(r);
    }
    catch (e) { log.error({ err: e, chatId: u.id }, "[pigeons/race/enter]"); res.status(500).json({ error: "internal" }); }
  });

  router.get("/api/pigeons/race", requireTgUser, rateLimit(60), async (req, res) => {
    const u = getTgUser(req)!;
    try { res.json(await getRace(u.id)); }
    catch (e) { log.error({ err: e, chatId: u.id }, "[pigeons/race]"); res.status(500).json({ error: "internal" }); }
  });

  router.get("/api/pigeons/tune", requireTgUser, rateLimit(60), async (req, res) => {
    const u = getTgUser(req)!; const breed = String((req.query as { breed?: string }).breed || "");
    try { res.json(await getTuning(u.id, breed)); }
    catch (e) { log.error({ err: e, chatId: u.id }, "[pigeons/tune]"); res.status(500).json({ error: "internal" }); }
  });

  router.post("/api/pigeons/tune", requireTgUser, rateLimit(120), async (req, res) => {
    const u = getTgUser(req)!; const b = req.body as { breed?: string; stat?: string };
    try {
      const r = await upgradeTune(u.id, String(b.breed || ""), String(b.stat || ""));
      if (!r.ok) { res.status(400).json({ error: r.reason }); return; }
      res.json(r);
    } catch (e) { log.error({ err: e, chatId: u.id }, "[pigeons/tune/post]"); res.status(500).json({ error: "internal" }); }
  });


  router.get("/api/pigeons/drag/duels", requireTgUser, rateLimit(60), async (req, res) => {
    const u = getTgUser(req)!;
    try {
      const { listFriendDuels } = await import("../drag");
      res.json(await listFriendDuels(u.id));
    } catch (e) { log.error({ err: e, chatId: u.id }, "[drag/duels]"); res.status(500).json({ error: "internal" }); }
  });

  router.post("/api/pigeons/drag/duel", requireTgUser, rateLimit(20), async (req, res) => {
    const u = getTgUser(req)!;
    const b = req.body as { friendChat?: number; breed?: string; stake?: number; requestId?: string; tap?: { count?: number; reactionMs?: number; durationMs?: number } };
    try {
      const { createFriendDuel } = await import("../drag");
      const requestId = typeof b.requestId === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(b.requestId) ? b.requestId : "";
      const r = await createFriendDuel(u.id, Math.floor(Number(b.friendChat) || 0), String(b.breed || ""), Number(b.stake) || 0, b.tap || null, requestId);
      if (!r.ok) { res.status(400).json({ error: r.reason }); return; }
      if (!r.duplicate) {
        const sender = String((u as any).first_name || (u as any).username || "Друг").slice(0, 24);
        const stake = Math.max(0, Math.floor(Number(b.stake) || 0));
        void push.sendRaw(Math.floor(Number(b.friendChat) || 0), `🏁 ${sender} вызывает тебя на дуэль в «Котик Комбат»!\nСтавка: ${stake ? stake.toLocaleString("ru-RU") + " монет" : "без ставки"}.\nОткрой игру — вызов ждёт на Главной.`);
      }
      res.json(r);
    } catch (e) { log.error({ err: e, chatId: u.id }, "[drag/duel]"); res.status(500).json({ error: "internal" }); }
  });

  router.post("/api/pigeons/drag/duel/decline", requireTgUser, rateLimit(30), async (req, res) => {
    const u = getTgUser(req)!; const id = Math.floor(Number((req.body as { id?: number }).id) || 0);
    try {
      const { declineFriendDuel } = await import("../drag");
      const r = await declineFriendDuel(u.id, id);
      if (!r.ok) { res.status(400).json({ error: r.reason }); return; }
      res.json(r);
    } catch (e) { log.error({ err: e, chatId: u.id }, "[drag/duel/decline]"); res.status(500).json({ error: "internal" }); }
  });

  router.post("/api/pigeons/drag/duel/cancel", requireTgUser, rateLimit(30), async (req, res) => {
    const u = getTgUser(req)!; const id = Math.floor(Number((req.body as { id?: number }).id) || 0);
    try {
      const { cancelFriendDuel } = await import("../drag");
      const r = await cancelFriendDuel(u.id, id);
      if (!r.ok) { res.status(400).json({ error: r.reason }); return; }
      res.json(r);
    } catch (e) { log.error({ err: e, chatId: u.id }, "[drag/duel/cancel]"); res.status(500).json({ error: "internal" }); }
  });

  router.post("/api/pigeons/drag/duel/accept", requireTgUser, rateLimit(20), async (req, res) => {
    const u = getTgUser(req)!;
    const b = req.body as { id?: number; breed?: string; tap?: { count?: number; reactionMs?: number; durationMs?: number } };
    try {
      const { acceptFriendDuel } = await import("../drag");
      const r = await acceptFriendDuel(u.id, Math.floor(Number(b.id) || 0), String(b.breed || ""), b.tap || null);
      if (!r.ok) { res.status(400).json({ error: r.reason }); return; }
      res.json(r);
    } catch (e) { log.error({ err: e, chatId: u.id }, "[drag/duel/accept]"); res.status(500).json({ error: "internal" }); }
  });

  router.post("/api/pigeons/drag/opponents", requireTgUser, rateLimit(30), async (req, res) => {
    const u = getTgUser(req)!; const body = req.body as { breed?: string; mode?: string }; const breed = String(body.breed || "");
    try {
      if (!BREED_BY_ID.has(breed)) { res.status(400).json({ error: "not_owned" }); return; }
      const { dragTargetProfile, pickOpponentsV3, cacheOpponents } = await import("../drag");
      const profile = await dragTargetProfile(u.id, breed);
      if (profile === null) { res.status(400).json({ error: "not_owned" }); return; }
      const mode = body.mode === "bet" ? "bet" : "training";
      const opponents = await pickOpponentsV3(u.id, profile.match, 3);
      cacheOpponents(u.id, breed, mode, opponents); // заезд переиспользует ровно этот набор режима (см. runRace)
      res.json({ myPower: profile.match, opponents });
    } catch (e) { log.error({ err: e, chatId: u.id }, "[drag/opponents]"); res.status(500).json({ error: "internal" }); }
  });

  router.post("/api/pigeons/drag/friend-opponents", requireTgUser, rateLimit(30), async (req, res) => {
    const u = getTgUser(req)!; const body = req.body as { breed?: string; friendChat?: number }; const breed = String(body.breed || "");
    try {
      if (!BREED_BY_ID.has(breed)) { res.status(400).json({ error: "not_owned" }); return; }
      const friendChat = Math.floor(Number(body.friendChat) || 0);
      const { dragTargetProfile, pickFriendOpponents, cacheOpponents } = await import("../drag");
      const profile = await dragTargetProfile(u.id, breed);
      if (profile === null) { res.status(400).json({ error: "not_owned" }); return; }
      const opponents = await pickFriendOpponents(u.id, friendChat, profile.match, 3);
      if (!opponents) { res.status(400).json({ error: "not_friend" }); return; }
      cacheOpponents(u.id, breed, "training", opponents);
      res.json({ myPower: profile.match, opponents });
    } catch (e) { log.error({ err: e, chatId: u.id }, "[drag/friend-opponents]"); res.status(500).json({ error: "internal" }); }
  });

  router.post("/api/pigeons/drag/race", requireTgUser, rateLimit(20), async (req, res) => {
    const u = getTgUser(req)!; const b = req.body as { breed?: string; mode?: string; stake?: number; reactionMs?: number; requestId?: string; skill?: { rev1?: number; rev2?: number; reactionMs?: number }; tap?: { count?: number; reactionMs?: number; durationMs?: number } };
    try {
      const { runRace } = await import("../drag");
      // reactionMs — untrusted: нормализуем на границе. Math.max(0,·) ловит отрицательные
      // (−1 truthy обошёл бы `||3000` и clampReact подтянул бы к REACT_MIN=ЛУЧШАЯ реакция —
      // чит на монеты в bet). −1/0/NaN → 3000 (худшая), валидные значения проходят.
      const reactionMs = Math.max(0, Number(b.reactionMs)) || 3000;
      // v2 «Идеальный запуск»: skill-объект тоже untrusted. Отступы свипов — signed мс:
      // NaN/Infinity → худший (9999, accuracy 0 после серверного клампа); реакция — как выше.
      const launch = b.skill && typeof b.skill === "object" ? {
        rev1: Number.isFinite(Number(b.skill.rev1)) ? Number(b.skill.rev1) : 9999,
        rev2: Number.isFinite(Number(b.skill.rev2)) ? Number(b.skill.rev2) : 9999,
        reactionMs: Math.max(0, Number(b.skill.reactionMs)) || 3000,
      } : null;
      // v3 «Тап-заезд»: tap-объект untrusted. count нормализуется сервером;
      // клиент ограничивает ввод тремя одновременными пальцами — здесь лишь приводим к числам;
      // reactionMs как выше (−1/0/NaN → 3000 худшая).
      const tap = b.tap && typeof b.tap === "object" ? {
        count: Math.max(0, Math.floor(Number(b.tap.count)) || 0),
        reactionMs: Math.max(0, Number(b.tap.reactionMs)) || 3000,
        durationMs: Number(b.tap.durationMs) || 5000,
      } : null;
      const legacyReact = tap ? tap.reactionMs : launch ? launch.reactionMs : reactionMs;
      const requestId = typeof b.requestId === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(b.requestId) ? b.requestId : "";
      const r = await runRace(u.id, String(b.breed || ""), b.mode === "bet" ? "bet" : "training", Number(b.stake) || 0, legacyReact, launch, tap, requestId);
      if (!r.ok) { log.warn({ chatId: u.id, reason: r.reason, breed: String(b.breed || ""), mode: b.mode, stake: b.stake }, "[drag/race rejected]"); res.status(400).json({ error: r.reason }); return; }
      res.json(r);
    } catch (e) { log.error({ err: e, chatId: u.id }, "[drag/race]"); res.status(500).json({ error: "internal" }); }
  });

  // Питомник: покупка гонщика за монеты кликера (цены в pigeons.ts::PIGEON_PRICE).
  router.post("/api/pigeons/buy", requireTgUser, rateLimit(20), async (req, res) => {
    const u = getTgUser(req)!; const breed = String((req.body as { breed?: string }).breed || "");
    try {
      const { buyPigeon } = await import("../pigeons");
      const r = await buyPigeon(u.id, breed);
      if (!r.ok) { res.status(400).json({ error: r.reason }); return; }
      res.json(r);
    } catch (e) { log.error({ err: e, chatId: u.id }, "[pigeons/buy]"); res.status(500).json({ error: "internal" }); }
  });

  return router;
}

export default createPigeonsRouter;

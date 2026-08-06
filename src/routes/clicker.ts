/**
 * Clicker routes — «Котик Комбат».
 * GET  /api/clicker            · POST /api/clicker/tap {taps}
 * POST /api/clicker/buy {type,id} · POST /api/clicker/daily
 * POST /api/clicker/boost {type:turbo|energy} · GET /api/clicker/top
 */
import { Router } from "express";
import { getClicker, tapClicker, buyClicker, claimDaily, boostClicker, getTop, registerRef, getTasks, claimTask, claimCombo, claimCipher, getAchievements, getRewards, redeemReward, claimBonus, openChest, openCase, claimRain, claimGame, getMilestones, claimMilestone, syncPurchaseBonus, migrateGuest, redeemCode, getSquads, joinSquad, squadBankStatus, donateSquadBank, createSquad, joinSquadByCode, requestJoinSquad, listSquadRequests, decideSquadRequest, prestigeReset, welcomePromoShown, markWelcomePromoShown, markOnboarded, getFtue, claimFtue, getSquadMembers } from "../clicker";
import { rateLimit, requireAdminToken } from "../middleware";
import { requireTgUser, getTgUser } from "../auth";
import { getBonusQueue, ackBonusQueue, queueAuthOk } from "../bonus1c";
import { trackActivity, trackEvent, getClickerStats } from "../analytics";
import { log } from "../logger";

const router = Router();

router.get("/api/clicker", requireTgUser, rateLimit(120), async (req, res) => {
  const u = getTgUser(req)!;
  try {
    res.json(await getClicker(u.id));
    trackActivity(u.id, { open: true });
    // T6: разметка источника открытия (deep-link несёт ?source=<мультик|соцсеть|упаковка>).
    const source = String(req.query.source || "").trim().slice(0, 32).replace(/[^a-zA-Z0-9_-]/g, "");
    if (source) trackEvent(u.id, "open", { source });
  } catch (e) { log.error({ err: e, chatId: u.id }, "[GET /api/clicker]"); res.status(500).json({ error: "internal" }); }
});

// FTUE «Первый день» (аудит 30.07): чеклист 5 вех первой сессии, награды за шаги.
router.get("/api/clicker/ftue", requireTgUser, rateLimit(60), async (req, res) => {
  const u = getTgUser(req)!;
  try { res.json(await getFtue(u.id)); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[clicker/ftue]"); res.status(500).json({ error: "internal" }); }
});
router.post("/api/clicker/ftue/claim", requireTgUser, rateLimit(30), async (req, res) => {
  const u = getTgUser(req)!;
  try {
    const r = await claimFtue(u.id, Number((req.body as { step?: number }).step));
    if (!r.ok) { res.status(400).json({ error: r.reason }); return; }
    trackEvent(u.id, "ftue_claim", { step: Number((req.body as { step?: number }).step) });
    res.json(r);
  } catch (e) { log.error({ err: e, chatId: u.id }, "[clicker/ftue/claim]"); res.status(500).json({ error: "internal" }); }
});

// T5 — Welcome-квест: реальный промокод новичку после первой мини-победы.
// Включается env WELCOME_PROMO (код) + WELCOME_PROMO_DESC (текст). Пусто = выключено.
// Выдаётся один раз, только с уровня ≥ 2 (первая победа). Не трогает выключенный обмен REWARDS.
const WELCOME_PROMO = (process.env.WELCOME_PROMO || "").trim();
const WELCOME_PROMO_DESC = (process.env.WELCOME_PROMO_DESC || "−10% на первый заказ на maria-irk.ru").trim();
router.get("/api/clicker/welcome", requireTgUser, rateLimit(30), async (req, res) => {
  const u = getTgUser(req)!;
  try {
    if (!WELCOME_PROMO) { res.json({ promo: null }); return; }
    if (await welcomePromoShown(u.id)) { res.json({ promo: null }); return; }
    const st = await getClicker(u.id);
    if ((st.level || 1) < 2) { res.json({ promo: null, pending: true }); return; } // ещё не «первая победа»
    res.json({ promo: WELCOME_PROMO, desc: WELCOME_PROMO_DESC });
  } catch (e) { log.error({ err: e, chatId: u.id }, "[clicker/welcome]"); res.status(500).json({ error: "internal" }); }
});
router.post("/api/clicker/welcome/seen", requireTgUser, rateLimit(30), async (req, res) => {
  const u = getTgUser(req)!;
  try {
    const first = await markWelcomePromoShown(u.id);
    if (first && WELCOME_PROMO) trackEvent(u.id, "welcome_promo", { code: WELCOME_PROMO });
    res.json({ ok: true });
  } catch (e) { log.error({ err: e, chatId: u.id }, "[clicker/welcome/seen]"); res.status(500).json({ error: "internal" }); }
});

// Онбординг пройден (серверный флаг вместо localStorage — чинит «обучение при каждом входе»).
router.post("/api/clicker/onboarded", requireTgUser, rateLimit(30), async (req, res) => {
  const u = getTgUser(req)!;
  try { await markOnboarded(u.id); res.json({ ok: true }); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[clicker/onboarded]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/tap", requireTgUser, rateLimit(120), async (req, res) => {
  const u = getTgUser(req)!; const taps = Number((req.body as { taps?: number }).taps) || 0;
  try { res.json(await tapClicker(u.id, taps)); if (taps > 0) trackActivity(u.id, { taps }); } catch (e) { log.error({ err: e, chatId: u.id }, "[tap]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/buy", requireTgUser, rateLimit(60), async (req, res) => {
  const u = getTgUser(req)!; const { type, id } = req.body as { type?: string; id?: string };
  try { const r = await buyClicker(u.id, String(type || ""), id); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json(r.state); trackEvent(u.id, "buy", { type: String(type || ""), id: id || null }); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[buy]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/daily", requireTgUser, rateLimit(30), async (req, res) => {
  const u = getTgUser(req)!;
  try { const r = await claimDaily(u.id); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json({ reward: r.reward, ...r.state }); trackEvent(u.id, "daily", { reward: r.reward, streak: r.state?.dailyStreak }); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[daily]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/code", requireTgUser, rateLimit(20), async (req, res) => {
  const u = getTgUser(req)!; const code = String((req.body as { code?: string }).code || "");
  try { const r = await redeemCode(u.id, code); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json({ reward: r.reward, ...r.state }); trackEvent(u.id, "code", { reward: r.reward }); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[code]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/rain", requireTgUser, rateLimit(30), async (req, res) => {
  const u = getTgUser(req)!; const score = Number((req.body as { score?: number }).score) || 0;
  try { const r = await claimRain(u.id, score); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json({ reward: r.reward, ...r.state }); trackEvent(u.id, "rain", { score, reward: r.reward }); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[rain]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/game", requireTgUser, rateLimit(40), async (req, res) => {
  const u = getTgUser(req)!; const { game, score } = req.body as { game?: string; score?: number };
  try { const r = await claimGame(u.id, String(game || ""), Number(score) || 0); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json({ reward: r.reward, game: r.game, pigeonDrop: r.pigeonDrop, ...r.state }); trackEvent(u.id, "game", { game: String(game || ""), score: Number(score) || 0, reward: r.reward }); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[game]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/chest", requireTgUser, rateLimit(30), async (req, res) => {
  const u = getTgUser(req)!;
  try { const r = await openChest(u.id); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json({ prize: r.prize, pigeonDrop: r.pigeonDrop, ...r.state }); trackEvent(u.id, "chest", {}); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[chest]"); res.status(500).json({ error: "internal" }); }
});

// Платный кейс: платишь монетами → взвешенный приз (казино-эдж, см. lootbox.ts).
router.post("/api/clicker/case", requireTgUser, rateLimit(30), async (req, res) => {
  const u = getTgUser(req)!;
  try { const r = await openCase(u.id); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json({ prize: r.prize, newBalance: r.newBalance, cost: r.cost, pigeonDrop: r.pigeonDrop, ...r.state }); trackEvent(u.id, "case", { prize: r.prize?.type }); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[case]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/bonus", requireTgUser, rateLimit(60), async (req, res) => {
  const u = getTgUser(req)!;
  try { const r = await claimBonus(u.id); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json({ amount: r.amount, pigeonDrop: r.pigeonDrop, ...r.state }); trackEvent(u.id, "bonus", { amount: r.amount }); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[bonus]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/prestige", requireTgUser, rateLimit(10), async (req, res) => {
  const u = getTgUser(req)!;
  try { const r = await prestigeReset(u.id); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json({ prestige: r.prestige, ...r.state }); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[prestige]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/boost", requireTgUser, rateLimit(60), async (req, res) => {
  const u = getTgUser(req)!; const type = String((req.body as { type?: string }).type || "");
  try { const r = await boostClicker(u.id, type); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json(r.state); trackEvent(u.id, "boost", { type }); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[boost]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/combo", requireTgUser, rateLimit(30), async (req, res) => {
  const u = getTgUser(req)!;
  try { const r = await claimCombo(u.id); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json({ reward: r.reward, pigeonDrop: r.pigeonDrop, ...r.state }); trackEvent(u.id, "combo", { reward: r.reward }); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[combo]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/cipher", requireTgUser, rateLimit(30), async (req, res) => {
  const u = getTgUser(req)!; const guess = String((req.body as { guess?: string }).guess || "");
  try { const r = await claimCipher(u.id, guess); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json({ reward: r.reward, ...r.state }); trackEvent(u.id, "cipher", { reward: r.reward }); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[cipher]"); res.status(500).json({ error: "internal" }); }
});

router.get("/api/clicker/squads", requireTgUser, rateLimit(60), async (req, res) => {
  const u = getTgUser(req)!;
  try {
    const d = await getSquads(u.id);
    // Копилка своей стаи — для прогресс-бара в блоке команд
    const bank = d.mySquad ? await squadBankStatus(d.mySquad, u.id) : null;
    res.json({ ...d, bank });
  } catch (e) { log.error({ err: e, chatId: u.id }, "[squads]"); res.status(500).json({ error: "internal" }); }
});

// Состав моей стаи (кто в команде + монеты + вклад в копилку).
router.get("/api/clicker/squad-members", requireTgUser, rateLimit(60), async (req, res) => {
  const u = getTgUser(req)!;
  try { res.json(await getSquadMembers(u.id)); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[squad-members]"); res.status(500).json({ error: "internal" }); }
});

// ── Свои стаи ───────────────────────────────────────────────────────────────
router.post("/api/clicker/squad-create", requireTgUser, rateLimit(10), async (req, res) => {
  const u = getTgUser(req)!;
  try {
    const r = await createSquad(u.id, String((req.body as { name?: unknown })?.name || ""));
    if (!r.ok) { res.status(400).json({ error: r.reason }); return; }
    res.json({ squadId: r.squadId, inviteCode: r.inviteCode, ...r.state });
  } catch (e) { log.error({ err: e, chatId: u.id }, "[squad-create]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/squad-code", requireTgUser, rateLimit(15), async (req, res) => {
  const u = getTgUser(req)!;
  try {
    const r = await joinSquadByCode(u.id, String((req.body as { code?: unknown })?.code || ""));
    if (!r.ok) { res.status(400).json({ error: r.reason }); return; }
    res.json({ squadName: r.squadName, ...r.state });
  } catch (e) { log.error({ err: e, chatId: u.id }, "[squad-code]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/squad-request", requireTgUser, rateLimit(15), async (req, res) => {
  const u = getTgUser(req)!;
  try {
    const r = await requestJoinSquad(u.id, String((req.body as { id?: unknown })?.id || ""));
    if (!r.ok) { res.status(400).json({ error: r.reason }); return; }
    res.json(r.pending ? { pending: true } : (r.state || { ok: true }));
  } catch (e) { log.error({ err: e, chatId: u.id }, "[squad-request]"); res.status(500).json({ error: "internal" }); }
});

router.get("/api/clicker/squad-requests", requireTgUser, rateLimit(60), async (req, res) => {
  const u = getTgUser(req)!;
  try { res.json(await listSquadRequests(u.id)); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[squad-requests]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/squad-decide", requireTgUser, rateLimit(30), async (req, res) => {
  const u = getTgUser(req)!;
  const b = req.body as { chatId?: unknown; accept?: unknown };
  try {
    const r = await decideSquadRequest(u.id, Number(b?.chatId), Boolean(b?.accept));
    if (!r.ok) { res.status(400).json({ error: r.reason }); return; }
    res.json({ ok: true });
  } catch (e) { log.error({ err: e, chatId: u.id }, "[squad-decide]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/squad-bank", requireTgUser, rateLimit(30), async (req, res) => {
  const u = getTgUser(req)!;
  const amount = Number((req.body as { amount?: unknown })?.amount);
  try {
    const r = await donateSquadBank(u.id, amount);
    if (!r.ok) { res.status(400).json({ error: r.reason }); return; }
    res.json({ donated: r.donated, bank: r.bank, ...r.state });
  } catch (e) { log.error({ err: e, chatId: u.id }, "[squad-bank]"); res.status(500).json({ error: "internal" }); }
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
  try { const r = await registerRef(u.id, code); res.json({ refReward: r.ok ? r.reward : 0, ...r.state }); if (r.ok) trackEvent(u.id, "ref", { reward: r.reward }); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[ref]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/purchase-sync", requireTgUser, rateLimit(20), async (req, res) => {
  const u = getTgUser(req)!;
  try { const r = await syncPurchaseBonus(u.id); res.json({ bonus: r.granted || 0, yearSpent: r.yearSpent, pigeonDrops: r.pigeonDrops, ...(r.state || {}) }); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[purchase-sync]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/migrate", requireTgUser, rateLimit(10), async (req, res) => {
  const u = getTgUser(req)!;
  try { const r = await migrateGuest(u.id, req.body || {}); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json({ migrated: r.migrated, ...r.state }); trackEvent(u.id, "migrate", { migrated: r.migrated }); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[migrate]"); res.status(500).json({ error: "internal" }); }
});

router.get("/api/clicker/tasks", requireTgUser, rateLimit(60), async (req, res) => {
  const u = getTgUser(req)!;
  try { res.json(await getTasks(u.id)); } catch (e) { log.error({ err: e, chatId: u.id }, "[tasks]"); res.status(500).json({ error: "internal" }); }
});

router.get("/api/clicker/achievements", requireTgUser, rateLimit(60), async (req, res) => {
  const u = getTgUser(req)!;
  try { res.json(await getAchievements(u.id)); } catch (e) { log.error({ err: e, chatId: u.id }, "[achievements]"); res.status(500).json({ error: "internal" }); }
});

router.get("/api/clicker/milestones", requireTgUser, rateLimit(60), async (req, res) => {
  const u = getTgUser(req)!;
  try { res.json(await getMilestones(u.id)); } catch (e) { log.error({ err: e, chatId: u.id }, "[milestones]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/milestone", requireTgUser, rateLimit(20), async (req, res) => {
  const u = getTgUser(req)!; const id = String((req.body as { id?: string }).id || "");
  try { const r = await claimMilestone(u.id, id); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json(r); trackEvent(u.id, "milestone", { id }); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[milestone]"); res.status(500).json({ error: "internal" }); }
});

router.get("/api/clicker/rewards", requireTgUser, rateLimit(60), async (req, res) => {
  const u = getTgUser(req)!;
  try { res.json(await getRewards(u.id)); } catch (e) { log.error({ err: e, chatId: u.id }, "[rewards]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/redeem", requireTgUser, rateLimit(20), async (req, res) => {
  const u = getTgUser(req)!; const id = String((req.body as { id?: string }).id || "");
  try { const r = await redeemReward(u.id, id); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json({ code: r.code, points: r.points, ...r.state }); trackEvent(u.id, "redeem", { id }); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[redeem]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/task", requireTgUser, rateLimit(40), async (req, res) => {
  const u = getTgUser(req)!; const id = String((req.body as { id?: string }).id || "");
  try { const r = await claimTask(u.id, id); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json({ reward: r.reward, ...r.state }); trackEvent(u.id, "task", { id }); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[task]"); res.status(500).json({ error: "internal" }); }
});

// ── Аналитика (admin-only): дашборд по игре ────────────────────────────────
router.get("/api/clicker/stats", requireAdminToken, rateLimit(60), async (_req, res) => {
  try { res.json(await getClickerStats()); }
  catch (e) { log.error({ err: e }, "[clicker stats]"); res.status(500).json({ error: "internal" }); }
});

// ── PULL-режим: 1С сама забирает очередь начислений (без TG-авторизации, токен) ──
// GET  /api/clicker/bonus-queue?token=...        → pending-начисления {id,phone,amount,reason,key}
// POST /api/clicker/bonus-ack {token, ids:[...]} → пометить зачисленными
router.get("/api/clicker/bonus-queue", rateLimit(120), async (req, res) => {
  if (!queueAuthOk(String(req.query.token || ""))) { res.status(403).json({ error: "forbidden" }); return; }
  try { const limit = Number(req.query.limit) || 100; res.json({ items: await getBonusQueue(limit) }); }
  catch (e) { log.error({ err: e }, "[bonus-queue]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/bonus-ack", rateLimit(120), async (req, res) => {
  const body = (req.body || {}) as { token?: string; ids?: number[] };
  if (!queueAuthOk(String(body.token || ""))) { res.status(403).json({ error: "forbidden" }); return; }
  try { const acked = await ackBonusQueue(Array.isArray(body.ids) ? body.ids : []); res.json({ acked }); }
  catch (e) { log.error({ err: e }, "[bonus-ack]"); res.status(500).json({ error: "internal" }); }
});

export default router;

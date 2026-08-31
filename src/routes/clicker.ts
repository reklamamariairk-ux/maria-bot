/**
 * Clicker routes — «Котик Комбат».
 * GET  /api/clicker            · POST /api/clicker/tap {taps}
 * POST /api/clicker/buy {type,id} · POST /api/clicker/daily
 * POST /api/clicker/boost {type:turbo|energy} · GET /api/clicker/top
 */
import { Router } from "express";
import { getClicker, tapClicker, buyClicker, claimDaily, boostClicker, getTop, registerRef, getTasks, claimTask, claimCombo, getAchievements, getRewards, redeemReward, claimBonus, openChest, openCase, getMilestones, claimMilestone, syncPurchaseBonus, migrateGuest, redeemCode, getSquads, joinSquad, squadBankStatus, donateSquadBank, createSquad, joinSquadByCode, requestJoinSquad, listSquadRequests, decideSquadRequest, prestigeReset, welcomePromoShown, markWelcomePromoShown, markOnboarded, getFtue, claimFtue, getSquadMembers, deleteClickerProfile } from "../clicker";
import { rateLimit, requireAdminToken } from "../middleware";
import { requireTgUser as requireAnyTgUser, getTgUser, getUser } from "../auth";
import { clearGameAccessCache, requireGameUser as requireTgUser } from "../game-auth";
import { getBonusQueue, ackBonusQueue, queueAuthOk } from "../bonus1c";
import { trackActivity, trackEvent, getClickerStats } from "../analytics";
import { log } from "../logger";
import crypto from "crypto";
import { pool } from "../db";
import { getPurchaseTasks, getPurchaseTaskClaims } from "../purchase1c";
import { getAccountLinkStatus } from "../account-link";

const router = Router();

// Удалить собственные данные можно и при игровой блокировке.
router.delete("/api/clicker/account", requireAnyTgUser, rateLimit(5), async (req, res) => {
  const u = getTgUser(req)!;
  try {
    await deleteClickerProfile(u.id);
    clearGameAccessCache(u.id);
    res.json({ ok: true });
  } catch (e) {
    log.error({ err: e, chatId: u.id }, "[DELETE /api/clicker/account]");
    res.status(500).json({ error: "internal" });
  }
});

router.get("/api/clicker", requireTgUser, rateLimit(120), async (req, res) => {
  const u = getTgUser(req)!;
  try {
    res.json(await getClicker(u.id));
    trackActivity(u.id, { open: true });
    // T6: разметка источника открытия (deep-link несёт ?source=<мультик|соцсеть|упаковка>).
    const source = String(req.query.source || "").trim().slice(0, 32).replace(/[^a-zA-Z0-9_-]/g, "");
    if (source) trackEvent(u.id, "open", { source });
  } catch (e) {
    if (e instanceof Error && e.message === "account_blocked") { res.status(403).json({ error: "account_blocked" }); return; }
    log.error({ err: e, chatId: u.id }, "[GET /api/clicker]"); res.status(500).json({ error: "internal" });
  }
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
  const u = getTgUser(req)!; const body = req.body as { taps?: number; comboBonus?: number; requestId?: string };
  const taps = Number(body.taps) || 0; const comboBonus = Number(body.comboBonus) || 0;
  const requestId = typeof body.requestId === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(body.requestId) ? body.requestId : "";
  try {
    const state = await tapClicker(u.id, taps, comboBonus, requestId);
    res.json(state);
    if (!state.duplicate && Number(state.acceptedTaps) > 0) trackActivity(u.id, { taps: Number(state.acceptedTaps) });
  } catch (e) { log.error({ err: e, chatId: u.id }, "[tap]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/commerce-click", requireTgUser, rateLimit(30), async (req, res) => {
  const u = getTgUser(req)!;
  const kind = String(req.body?.kind || "site").slice(0, 16);
  const taskId = String(req.body?.taskId || "").slice(0, 64);
  const campaignId = String(req.body?.campaignId || "").slice(0, 64);
  const token = crypto.randomBytes(18).toString("base64url");
  try {
    await pool.query(`INSERT INTO clicker_commerce_clicks(token, chat_id, kind, task_id, campaign_id) VALUES($1,$2,$3,$4,$5)`, [token, u.id, kind, taskId || null, campaignId || null]);
    trackEvent(u.id, "commerce_click", { kind, taskId, campaignId, token });
    res.json({ ok: true, token, expiresInHours: 72 });
  } catch (e) {
    log.error({ err: e, chatId: u.id }, "[clicker/commerce-click]");
    res.status(500).json({ error: "internal" });
  }
});

// Webhook для сайта/1С. Начисление награды здесь не происходит: только
// подтверждённый заказ может стать основанием для purchase-sync/задания.
// Это исключает ложные награды за клик, открытие корзины или незавершённый заказ.
router.post("/api/commerce/order-paid", rateLimit(120), async (req, res) => {
  const secret = String(process.env.COMMERCE_WEBHOOK_SECRET || "");
  if (!secret || req.header("X-Commerce-Webhook-Secret") !== secret) { res.status(401).json({ error: "unauthorized" }); return; }
  const token = String(req.body?.mariaRef || req.body?.token || "").trim();
  const orderId = String(req.body?.orderId || "").trim().slice(0, 128);
  const amount = Number(req.body?.amount);
  if (!token || !orderId || !Number.isFinite(amount) || amount <= 0) { res.status(400).json({ error: "invalid_payload" }); return; }
  try {
    const r = await pool.query(`UPDATE clicker_commerce_clicks SET order_id=$2, order_amount=$3, paid_at=NOW(), last_seen_at=NOW() WHERE token=$1 AND paid_at IS NULL AND created_at > NOW() - INTERVAL '72 hours' RETURNING chat_id, kind, task_id, campaign_id`, [token, orderId, amount]);
    if (!r.rowCount) { res.status(409).json({ error: "unknown_or_already_processed" }); return; }
    const row = r.rows[0];
    trackEvent(Number(row.chat_id), "commerce_order_paid", { orderId, amount, kind: row.kind, taskId: row.task_id, campaignId: row.campaign_id });
    res.json({ ok: true, tracked: true });
  } catch (e) { log.error({ err: e }, "[commerce/order-paid]"); res.status(500).json({ error: "internal" }); }
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

// Старые мини-игры удалены из клиента. Явный 410 не позволяет старым кешированным
// клиентам продолжать начислять награды через устаревшие игровые маршруты.
for (const path of ["/api/clicker/game-attempt", "/api/clicker/rain", "/api/clicker/game", "/api/clicker/cipher"]) {
  router.post(path, requireTgUser, rateLimit(30), (_req, res) => {
    res.status(410).json({ error: "removed" });
  });
}

router.post("/api/clicker/chest", requireTgUser, rateLimit(30), async (req, res) => {
  const u = getTgUser(req)!;
  try { const r = await openChest(u.id); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json({ prize: r.prize, pigeonDrop: r.pigeonDrop, ...r.state }); trackEvent(u.id, "chest", {}); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[chest]"); res.status(500).json({ error: "internal" }); }
});

// Платный кейс: платишь монетами → взвешенный приз (казино-эдж, см. lootbox.ts).
router.post("/api/clicker/case", requireTgUser, rateLimit(30), async (req, res) => {
  const u = getTgUser(req)!;
  const requestId = typeof req.body?.requestId === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(req.body.requestId) ? req.body.requestId : `legacy_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  try { const r = await openCase(u.id, requestId); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json({ prize: r.prize, newBalance: r.newBalance, balanceBefore: r.balanceBefore, cost: r.cost, duplicate: r.duplicate, pigeonDrop: r.pigeonDrop, ...r.state }); if (!r.duplicate) trackEvent(u.id, "case", { prize: r.prize?.type }); }
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
  const applicantId = Number(b?.chatId);
  if (!Number.isSafeInteger(applicantId) || applicantId <= 0 || typeof b?.accept !== "boolean") {
    res.status(400).json({ error: "bad_input" });
    return;
  }
  try {
    const r = await decideSquadRequest(u.id, applicantId, b.accept);
    if (!r.ok) { res.status(400).json({ error: r.reason }); return; }
    res.json({ ok: true });
  } catch (e) { log.error({ err: e, chatId: u.id }, "[squad-decide]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/squad-bank", requireTgUser, rateLimit(30), async (req, res) => {
  const u = getTgUser(req)!;
  const body = req.body as { amount?: unknown; requestId?: unknown };
  const amount = Number(body?.amount);
  if (!Number.isInteger(amount) || amount <= 0) { res.status(400).json({ error: "bad_amount" }); return; }
  try {
    const requestId = typeof body.requestId === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(body.requestId) ? body.requestId : "";
    const r = await donateSquadBank(u.id, amount, requestId);
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

// Быстрый снимок вкладки «Призы»: клиент уже имеет свежий ClickerState и сам
// вычисляет claimable. Здесь одним HTTP параллельно отдаём только серверные факты,
// покупки и связку аккаунтов — вместо четырёх последовательных запросов и двух
// повторных getClicker() с транзакциями.
router.get("/api/clicker/tasks-overview", requireTgUser, rateLimit(60), async (req, res) => {
  const u = getTgUser(req)!;
  const currentPlatform = getUser(req)?.platform ?? "tg";
  try {
    const [doneRows, purchaseTasks, purchaseClaims, accountLink] = await Promise.all([
      pool.query(`SELECT task FROM clicker_tasks WHERE chat_id=$1`, [u.id]),
      getPurchaseTasks(u.id),
      getPurchaseTaskClaims(u.id),
      getAccountLinkStatus(currentPlatform, u.id),
    ]);
    res.json({
      done: doneRows.rows.map((row) => String(row.task)),
      purchaseTasks,
      purchaseClaims,
      phoneVerified: accountLink.phoneVerified,
      accountLink,
    });
  } catch (e) {
    log.error({ err: e, chatId: u.id }, "[tasks-overview]");
    res.status(500).json({ error: "internal" });
  }
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
  try { const r = await claimMilestone(u.id, id); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json(r); if (!r.duplicate) trackEvent(u.id, "milestone", { id }); }
  catch (e) { log.error({ err: e, chatId: u.id }, "[milestone]"); res.status(500).json({ error: "internal" }); }
});

router.get("/api/clicker/rewards", requireTgUser, rateLimit(60), async (req, res) => {
  const u = getTgUser(req)!;
  try { res.json(await getRewards(u.id)); } catch (e) { log.error({ err: e, chatId: u.id }, "[rewards]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/redeem", requireTgUser, rateLimit(20), async (req, res) => {
  const u = getTgUser(req)!;
  const body = req.body as { id?: string; requestId?: string };
  const id = String(body.id || ""), requestId = String(body.requestId || "");
  try { const r = await redeemReward(u.id, id, requestId); if (!r.ok) { res.status(400).json({ error: r.reason }); return; } res.json({ code: r.code, points: r.points, ...r.state }); trackEvent(u.id, "redeem", { id }); }
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
// GET  /api/clicker/bonus-queue (Bearer/X-Bonus-Queue-Token) → pending-начисления
// POST /api/clicker/bonus-ack {ids:[...]} с тем же header → подтверждение
router.get("/api/clicker/bonus-queue", rateLimit(120), async (req, res) => {
  const bearer = String(req.header("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  const token = req.header("x-bonus-queue-token") || bearer;
  if (!queueAuthOk(token)) { res.status(403).json({ error: "forbidden" }); return; }
  try { const limit = Number(req.query.limit) || 100; res.json({ items: await getBonusQueue(limit) }); }
  catch (e) { log.error({ err: e }, "[bonus-queue]"); res.status(500).json({ error: "internal" }); }
});

router.post("/api/clicker/bonus-ack", rateLimit(120), async (req, res) => {
  const body = (req.body || {}) as { token?: string; ids?: number[] };
  const bearer = String(req.header("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  const token = req.header("x-bonus-queue-token") || bearer || body.token;
  if (!queueAuthOk(token)) { res.status(403).json({ error: "forbidden" }); return; }
  try { const acked = await ackBonusQueue(Array.isArray(body.ids) ? body.ids : []); res.json({ acked }); }
  catch (e) { log.error({ err: e }, "[bonus-ack]"); res.status(500).json({ error: "internal" }); }
});

export default router;

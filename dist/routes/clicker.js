"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Clicker routes — «Котик Комбат».
 * GET  /api/clicker            · POST /api/clicker/tap {taps}
 * POST /api/clicker/buy {type,id} · POST /api/clicker/daily
 * POST /api/clicker/boost {type:turbo|energy} · GET /api/clicker/top
 */
const express_1 = require("express");
const clicker_1 = require("../clicker");
const middleware_1 = require("../middleware");
const auth_1 = require("../auth");
const game_auth_1 = require("../game-auth");
const bonus1c_1 = require("../bonus1c");
const analytics_1 = require("../analytics");
const logger_1 = require("../logger");
const router = (0, express_1.Router)();
// Удалить собственные данные можно и при игровой блокировке.
router.delete("/api/clicker/account", auth_1.requireTgUser, (0, middleware_1.rateLimit)(5), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        await (0, clicker_1.deleteClickerProfile)(u.id);
        (0, game_auth_1.clearGameAccessCache)(u.id);
        res.json({ ok: true });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[DELETE /api/clicker/account]");
        res.status(500).json({ error: "internal" });
    }
});
router.get("/api/clicker", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(120), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        res.json(await (0, clicker_1.getClicker)(u.id));
        (0, analytics_1.trackActivity)(u.id, { open: true });
        // T6: разметка источника открытия (deep-link несёт ?source=<мультик|соцсеть|упаковка>).
        const source = String(req.query.source || "").trim().slice(0, 32).replace(/[^a-zA-Z0-9_-]/g, "");
        if (source)
            (0, analytics_1.trackEvent)(u.id, "open", { source });
    }
    catch (e) {
        if (e instanceof Error && e.message === "account_blocked") {
            res.status(403).json({ error: "account_blocked" });
            return;
        }
        logger_1.log.error({ err: e, chatId: u.id }, "[GET /api/clicker]");
        res.status(500).json({ error: "internal" });
    }
});
// FTUE «Первый день» (аудит 30.07): чеклист 5 вех первой сессии, награды за шаги.
router.get("/api/clicker/ftue", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(60), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        res.json(await (0, clicker_1.getFtue)(u.id));
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[clicker/ftue]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/clicker/ftue/claim", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(30), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        const r = await (0, clicker_1.claimFtue)(u.id, Number(req.body.step));
        if (!r.ok) {
            res.status(400).json({ error: r.reason });
            return;
        }
        (0, analytics_1.trackEvent)(u.id, "ftue_claim", { step: Number(req.body.step) });
        res.json(r);
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[clicker/ftue/claim]");
        res.status(500).json({ error: "internal" });
    }
});
// T5 — Welcome-квест: реальный промокод новичку после первой мини-победы.
// Включается env WELCOME_PROMO (код) + WELCOME_PROMO_DESC (текст). Пусто = выключено.
// Выдаётся один раз, только с уровня ≥ 2 (первая победа). Не трогает выключенный обмен REWARDS.
const WELCOME_PROMO = (process.env.WELCOME_PROMO || "").trim();
const WELCOME_PROMO_DESC = (process.env.WELCOME_PROMO_DESC || "−10% на первый заказ на maria-irk.ru").trim();
router.get("/api/clicker/welcome", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(30), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        if (!WELCOME_PROMO) {
            res.json({ promo: null });
            return;
        }
        if (await (0, clicker_1.welcomePromoShown)(u.id)) {
            res.json({ promo: null });
            return;
        }
        const st = await (0, clicker_1.getClicker)(u.id);
        if ((st.level || 1) < 2) {
            res.json({ promo: null, pending: true });
            return;
        } // ещё не «первая победа»
        res.json({ promo: WELCOME_PROMO, desc: WELCOME_PROMO_DESC });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[clicker/welcome]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/clicker/welcome/seen", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(30), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        const first = await (0, clicker_1.markWelcomePromoShown)(u.id);
        if (first && WELCOME_PROMO)
            (0, analytics_1.trackEvent)(u.id, "welcome_promo", { code: WELCOME_PROMO });
        res.json({ ok: true });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[clicker/welcome/seen]");
        res.status(500).json({ error: "internal" });
    }
});
// Онбординг пройден (серверный флаг вместо localStorage — чинит «обучение при каждом входе»).
router.post("/api/clicker/onboarded", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(30), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        await (0, clicker_1.markOnboarded)(u.id);
        res.json({ ok: true });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[clicker/onboarded]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/clicker/tap", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(120), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    const body = req.body;
    const taps = Number(body.taps) || 0;
    const comboBonus = Number(body.comboBonus) || 0;
    const requestId = typeof body.requestId === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(body.requestId) ? body.requestId : "";
    try {
        const state = await (0, clicker_1.tapClicker)(u.id, taps, comboBonus, requestId);
        res.json(state);
        if (!state.duplicate && Number(state.acceptedTaps) > 0)
            (0, analytics_1.trackActivity)(u.id, { taps: Number(state.acceptedTaps) });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[tap]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/clicker/buy", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(60), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    const { type, id } = req.body;
    try {
        const r = await (0, clicker_1.buyClicker)(u.id, String(type || ""), id);
        if (!r.ok) {
            res.status(400).json({ error: r.reason });
            return;
        }
        res.json(r.state);
        (0, analytics_1.trackEvent)(u.id, "buy", { type: String(type || ""), id: id || null });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[buy]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/clicker/daily", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(30), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        const r = await (0, clicker_1.claimDaily)(u.id);
        if (!r.ok) {
            res.status(400).json({ error: r.reason });
            return;
        }
        res.json({ reward: r.reward, ...r.state });
        (0, analytics_1.trackEvent)(u.id, "daily", { reward: r.reward, streak: r.state?.dailyStreak });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[daily]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/clicker/code", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(20), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    const code = String(req.body.code || "");
    try {
        const r = await (0, clicker_1.redeemCode)(u.id, code);
        if (!r.ok) {
            res.status(400).json({ error: r.reason });
            return;
        }
        res.json({ reward: r.reward, ...r.state });
        (0, analytics_1.trackEvent)(u.id, "code", { reward: r.reward });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[code]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/clicker/game-attempt", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(80), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    const game = String(req.body.game || "");
    try {
        const r = (0, clicker_1.createGameAttempt)(u.id, game);
        if (!r.ok) {
            res.status(400).json({ error: r.reason });
            return;
        }
        res.json({ token: r.token });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[game-attempt]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/clicker/rain", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(30), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    const { score, attempt } = req.body;
    try {
        const r = await (0, clicker_1.claimRain)(u.id, Number(score) || 0, String(attempt || ""));
        if (!r.ok) {
            res.status(400).json({ error: r.reason });
            return;
        }
        res.json({ reward: r.reward, ...r.state });
        (0, analytics_1.trackEvent)(u.id, "rain", { score: Number(score) || 0, reward: r.reward });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[rain]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/clicker/game", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(40), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    const { game, score, attempt } = req.body;
    try {
        const r = await (0, clicker_1.claimGame)(u.id, String(game || ""), Number(score) || 0, String(attempt || ""));
        if (!r.ok) {
            res.status(400).json({ error: r.reason });
            return;
        }
        res.json({ reward: r.reward, game: r.game, pigeonDrop: r.pigeonDrop, ...r.state });
        (0, analytics_1.trackEvent)(u.id, "game", { game: String(game || ""), score: Number(score) || 0, reward: r.reward });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[game]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/clicker/chest", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(30), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        const r = await (0, clicker_1.openChest)(u.id);
        if (!r.ok) {
            res.status(400).json({ error: r.reason });
            return;
        }
        res.json({ prize: r.prize, pigeonDrop: r.pigeonDrop, ...r.state });
        (0, analytics_1.trackEvent)(u.id, "chest", {});
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[chest]");
        res.status(500).json({ error: "internal" });
    }
});
// Платный кейс: платишь монетами → взвешенный приз (казино-эдж, см. lootbox.ts).
router.post("/api/clicker/case", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(30), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    const requestId = typeof req.body?.requestId === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(req.body.requestId) ? req.body.requestId : `legacy_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    try {
        const r = await (0, clicker_1.openCase)(u.id, requestId);
        if (!r.ok) {
            res.status(400).json({ error: r.reason });
            return;
        }
        res.json({ prize: r.prize, newBalance: r.newBalance, balanceBefore: r.balanceBefore, cost: r.cost, duplicate: r.duplicate, pigeonDrop: r.pigeonDrop, ...r.state });
        if (!r.duplicate)
            (0, analytics_1.trackEvent)(u.id, "case", { prize: r.prize?.type });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[case]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/clicker/bonus", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(60), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        const r = await (0, clicker_1.claimBonus)(u.id);
        if (!r.ok) {
            res.status(400).json({ error: r.reason });
            return;
        }
        res.json({ amount: r.amount, pigeonDrop: r.pigeonDrop, ...r.state });
        (0, analytics_1.trackEvent)(u.id, "bonus", { amount: r.amount });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[bonus]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/clicker/prestige", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(10), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        const r = await (0, clicker_1.prestigeReset)(u.id);
        if (!r.ok) {
            res.status(400).json({ error: r.reason });
            return;
        }
        res.json({ prestige: r.prestige, ...r.state });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[prestige]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/clicker/boost", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(60), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    const type = String(req.body.type || "");
    try {
        const r = await (0, clicker_1.boostClicker)(u.id, type);
        if (!r.ok) {
            res.status(400).json({ error: r.reason });
            return;
        }
        res.json(r.state);
        (0, analytics_1.trackEvent)(u.id, "boost", { type });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[boost]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/clicker/combo", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(30), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        const r = await (0, clicker_1.claimCombo)(u.id);
        if (!r.ok) {
            res.status(400).json({ error: r.reason });
            return;
        }
        res.json({ reward: r.reward, pigeonDrop: r.pigeonDrop, ...r.state });
        (0, analytics_1.trackEvent)(u.id, "combo", { reward: r.reward });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[combo]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/clicker/cipher", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(30), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    const guess = String(req.body.guess || "");
    try {
        const r = await (0, clicker_1.claimCipher)(u.id, guess);
        if (!r.ok) {
            res.status(400).json({ error: r.reason });
            return;
        }
        res.json({ reward: r.reward, ...r.state });
        (0, analytics_1.trackEvent)(u.id, "cipher", { reward: r.reward });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[cipher]");
        res.status(500).json({ error: "internal" });
    }
});
router.get("/api/clicker/squads", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(60), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        const d = await (0, clicker_1.getSquads)(u.id);
        // Копилка своей стаи — для прогресс-бара в блоке команд
        const bank = d.mySquad ? await (0, clicker_1.squadBankStatus)(d.mySquad, u.id) : null;
        res.json({ ...d, bank });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[squads]");
        res.status(500).json({ error: "internal" });
    }
});
// Состав моей стаи (кто в команде + монеты + вклад в копилку).
router.get("/api/clicker/squad-members", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(60), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        res.json(await (0, clicker_1.getSquadMembers)(u.id));
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[squad-members]");
        res.status(500).json({ error: "internal" });
    }
});
// ── Свои стаи ───────────────────────────────────────────────────────────────
router.post("/api/clicker/squad-create", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(10), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        const r = await (0, clicker_1.createSquad)(u.id, String(req.body?.name || ""));
        if (!r.ok) {
            res.status(400).json({ error: r.reason });
            return;
        }
        res.json({ squadId: r.squadId, inviteCode: r.inviteCode, ...r.state });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[squad-create]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/clicker/squad-code", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(15), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        const r = await (0, clicker_1.joinSquadByCode)(u.id, String(req.body?.code || ""));
        if (!r.ok) {
            res.status(400).json({ error: r.reason });
            return;
        }
        res.json({ squadName: r.squadName, ...r.state });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[squad-code]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/clicker/squad-request", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(15), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        const r = await (0, clicker_1.requestJoinSquad)(u.id, String(req.body?.id || ""));
        if (!r.ok) {
            res.status(400).json({ error: r.reason });
            return;
        }
        res.json(r.pending ? { pending: true } : (r.state || { ok: true }));
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[squad-request]");
        res.status(500).json({ error: "internal" });
    }
});
router.get("/api/clicker/squad-requests", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(60), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        res.json(await (0, clicker_1.listSquadRequests)(u.id));
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[squad-requests]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/clicker/squad-decide", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(30), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    const b = req.body;
    const applicantId = Number(b?.chatId);
    if (!Number.isSafeInteger(applicantId) || applicantId <= 0 || typeof b?.accept !== "boolean") {
        res.status(400).json({ error: "bad_input" });
        return;
    }
    try {
        const r = await (0, clicker_1.decideSquadRequest)(u.id, applicantId, b.accept);
        if (!r.ok) {
            res.status(400).json({ error: r.reason });
            return;
        }
        res.json({ ok: true });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[squad-decide]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/clicker/squad-bank", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(30), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    const body = req.body;
    const amount = Number(body?.amount);
    if (!Number.isInteger(amount) || amount <= 0) {
        res.status(400).json({ error: "bad_amount" });
        return;
    }
    try {
        const requestId = typeof body.requestId === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(body.requestId) ? body.requestId : "";
        const r = await (0, clicker_1.donateSquadBank)(u.id, amount, requestId);
        if (!r.ok) {
            res.status(400).json({ error: r.reason });
            return;
        }
        res.json({ donated: r.donated, bank: r.bank, ...r.state });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[squad-bank]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/clicker/squad", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(20), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    const id = String(req.body.id || "");
    try {
        const r = await (0, clicker_1.joinSquad)(u.id, id);
        if (!r.ok) {
            res.status(400).json({ error: r.reason });
            return;
        }
        res.json(r.state);
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[squad]");
        res.status(500).json({ error: "internal" });
    }
});
router.get("/api/clicker/top", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(60), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        res.json(await (0, clicker_1.getTop)(u.id, 30));
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[top]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/clicker/ref", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(20), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    const code = String(req.body.code || "");
    try {
        const r = await (0, clicker_1.registerRef)(u.id, code);
        res.json({ refReward: r.ok ? r.reward : 0, ...r.state });
        if (r.ok)
            (0, analytics_1.trackEvent)(u.id, "ref", { reward: r.reward });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[ref]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/clicker/purchase-sync", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(20), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        const r = await (0, clicker_1.syncPurchaseBonus)(u.id);
        res.json({ bonus: r.granted || 0, yearSpent: r.yearSpent, pigeonDrops: r.pigeonDrops, ...(r.state || {}) });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[purchase-sync]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/clicker/migrate", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(10), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        const r = await (0, clicker_1.migrateGuest)(u.id, req.body || {});
        if (!r.ok) {
            res.status(400).json({ error: r.reason });
            return;
        }
        res.json({ migrated: r.migrated, ...r.state });
        (0, analytics_1.trackEvent)(u.id, "migrate", { migrated: r.migrated });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[migrate]");
        res.status(500).json({ error: "internal" });
    }
});
router.get("/api/clicker/tasks", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(60), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        res.json(await (0, clicker_1.getTasks)(u.id));
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[tasks]");
        res.status(500).json({ error: "internal" });
    }
});
router.get("/api/clicker/achievements", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(60), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        res.json(await (0, clicker_1.getAchievements)(u.id));
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[achievements]");
        res.status(500).json({ error: "internal" });
    }
});
router.get("/api/clicker/milestones", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(60), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        res.json(await (0, clicker_1.getMilestones)(u.id));
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[milestones]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/clicker/milestone", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(20), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    const id = String(req.body.id || "");
    try {
        const r = await (0, clicker_1.claimMilestone)(u.id, id);
        if (!r.ok) {
            res.status(400).json({ error: r.reason });
            return;
        }
        res.json(r);
        if (!r.duplicate)
            (0, analytics_1.trackEvent)(u.id, "milestone", { id });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[milestone]");
        res.status(500).json({ error: "internal" });
    }
});
router.get("/api/clicker/rewards", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(60), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        res.json(await (0, clicker_1.getRewards)(u.id));
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[rewards]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/clicker/redeem", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(20), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    const body = req.body;
    const id = String(body.id || ""), requestId = String(body.requestId || "");
    try {
        const r = await (0, clicker_1.redeemReward)(u.id, id, requestId);
        if (!r.ok) {
            res.status(400).json({ error: r.reason });
            return;
        }
        res.json({ code: r.code, points: r.points, ...r.state });
        (0, analytics_1.trackEvent)(u.id, "redeem", { id });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[redeem]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/clicker/task", game_auth_1.requireGameUser, (0, middleware_1.rateLimit)(40), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    const id = String(req.body.id || "");
    try {
        const r = await (0, clicker_1.claimTask)(u.id, id);
        if (!r.ok) {
            res.status(400).json({ error: r.reason });
            return;
        }
        res.json({ reward: r.reward, ...r.state });
        (0, analytics_1.trackEvent)(u.id, "task", { id });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[task]");
        res.status(500).json({ error: "internal" });
    }
});
// ── Аналитика (admin-only): дашборд по игре ────────────────────────────────
router.get("/api/clicker/stats", middleware_1.requireAdminToken, (0, middleware_1.rateLimit)(60), async (_req, res) => {
    try {
        res.json(await (0, analytics_1.getClickerStats)());
    }
    catch (e) {
        logger_1.log.error({ err: e }, "[clicker stats]");
        res.status(500).json({ error: "internal" });
    }
});
// ── PULL-режим: 1С сама забирает очередь начислений (без TG-авторизации, токен) ──
// GET  /api/clicker/bonus-queue (Bearer/X-Bonus-Queue-Token) → pending-начисления
// POST /api/clicker/bonus-ack {ids:[...]} с тем же header → подтверждение
router.get("/api/clicker/bonus-queue", (0, middleware_1.rateLimit)(120), async (req, res) => {
    const bearer = String(req.header("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
    const token = req.header("x-bonus-queue-token") || bearer;
    if (!(0, bonus1c_1.queueAuthOk)(token)) {
        res.status(403).json({ error: "forbidden" });
        return;
    }
    try {
        const limit = Number(req.query.limit) || 100;
        res.json({ items: await (0, bonus1c_1.getBonusQueue)(limit) });
    }
    catch (e) {
        logger_1.log.error({ err: e }, "[bonus-queue]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/clicker/bonus-ack", (0, middleware_1.rateLimit)(120), async (req, res) => {
    const body = (req.body || {});
    const bearer = String(req.header("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
    const token = req.header("x-bonus-queue-token") || bearer || body.token;
    if (!(0, bonus1c_1.queueAuthOk)(token)) {
        res.status(403).json({ error: "forbidden" });
        return;
    }
    try {
        const acked = await (0, bonus1c_1.ackBonusQueue)(Array.isArray(body.ids) ? body.ids : []);
        res.json({ acked });
    }
    catch (e) {
        logger_1.log.error({ err: e }, "[bonus-ack]");
        res.status(500).json({ error: "internal" });
    }
});
exports.default = router;

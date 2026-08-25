"use strict";
/**
 * Referral routes — реферальная схема (code-based).
 *
 * - GET  /api/referral/me   — мой код + количество использований
 * - POST /api/referral/use  — записать использование чужого кода (с уведомлением владельца)
 *
 * Уведомление владельца кода идёт через push.sendRaw — владелец может быть
 * юзером любой платформы (TG/VK), сервис роутит сам.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createReferralRouter = createReferralRouter;
const express_1 = require("express");
const db_1 = require("../db");
const auth_1 = require("../auth");
const links_1 = require("../links");
const logger_1 = require("../logger");
function createReferralRouter(push, pool) {
    const router = (0, express_1.Router)();
    router.get("/api/referral/me", auth_1.requireTgUser, async (req, res) => {
        const u = (0, auth_1.getTgUser)(req);
        try {
            const code = await (0, db_1.getOrCreateReferralCode)(u.id, u.first_name);
            const used = await pool.query(`SELECT COUNT(*)::int AS used FROM referral_uses WHERE code = $1`, [code]);
            res.json({
                code,
                used: used.rows[0]?.used ?? 0,
                // Ссылка на платформу владельца кода (друг скорее всего там же)
                share_url: (0, links_1.referralLink)(u.id, code),
            });
        }
        catch (e) {
            logger_1.log.error({ err: e, chatId: u.id }, "[referral/me]");
            res.status(500).json({ error: "internal" });
        }
    });
    router.post("/api/referral/use", auth_1.requireTgUser, async (req, res) => {
        const u = (0, auth_1.getTgUser)(req);
        const code = String(req.body?.code ?? "").trim().toUpperCase();
        if (!code) {
            res.status(400).json({ error: "code_required" });
            return;
        }
        try {
            const r = await (0, db_1.recordReferralUse)(u.id, code);
            if (!r.ok) {
                res.status(400).json({ error: r.reason });
                return;
            }
            // Уведомляем владельца кода — best-effort (он может быть на другой платформе)
            if (r.ownerChat) {
                const userName = [u.first_name, u.last_name].filter(Boolean).join(" ") || "Новый друг";
                push.sendRaw(r.ownerChat, `🎉 *${userName}* пришёл по твоему коду \`${code}\` — спасибо, что зовёшь друзей в «Марию»!`, { parse_mode: "Markdown" }).catch(() => { });
            }
            res.json({ ok: true });
        }
        catch (e) {
            logger_1.log.error({ err: e, chatId: u.id, code }, "[referral/use]");
            res.status(500).json({ error: "internal" });
        }
    });
    return router;
}

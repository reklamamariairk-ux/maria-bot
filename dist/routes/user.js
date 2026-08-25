"use strict";
/**
 * User routes — данные текущего юзера, ДР, отвязка телефона, история.
 *
 * - POST /api/birthday        — сохранить ДР (yyyy-mm-dd)
 * - GET  /api/me              — профиль (balance, daily, rewards, phone, joined, etc)
 * - POST /api/unverify-phone  — отвязать телефон (обнуляет phone+verified_at)
 * - GET  /api/history         — последние 30 транзакций баллов/звёзд
 *
 * Маскирование телефона в /api/me: `+7 (***) ***-12-34` — показываем только
 * последние 4 цифры.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const club_1 = require("../club");
const lk_1 = require("../lk");
const middleware_1 = require("../middleware");
const auth_1 = require("../auth");
const platform_1 = require("../platform");
const logger_1 = require("../logger");
const date_utils_1 = require("../date-utils");
const router = (0, express_1.Router)();
async function getUserBirthday(chatId) {
    try {
        const { rows } = await db_1.pool.query(`SELECT birthday FROM user_birthdays WHERE chat_id = $1`, [chatId]);
        return rows[0]?.birthday ? String(rows[0].birthday).slice(0, 10) : null;
    }
    catch {
        return null;
    }
}
router.post("/api/birthday", auth_1.requireTgUser, (0, middleware_1.rateLimit)(5), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    const body = req.body;
    const bday = String(body.birthday ?? "").trim();
    if (!(0, date_utils_1.isValidIsoDate)(bday)) {
        res.status(400).json({ ok: false, error: "Неверный формат даты" });
        return;
    }
    try {
        await (0, db_1.setUserBirthday)(u.id, bday);
        res.json({ ok: true });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[BIRTHDAY]");
        res.status(500).json({ ok: false, error: "Не получилось сохранить" });
    }
});
router.get("/api/me", auth_1.requireTgUser, async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        await (0, db_1.touchSubscriber)(u.id, u.username, u.first_name).catch(() => { });
        const [verified, balance, daily, myRewards, birthday, subInfo, phone] = await Promise.all([
            (0, club_1.isPhoneVerified)(u.id),
            (0, club_1.getBalance)(u.id),
            (0, club_1.getDailyStatus)(u.id),
            (0, club_1.getMyRewards)(u.id),
            getUserBirthday(u.id),
            (0, db_1.getSubscriberInfo)(u.id),
            (0, lk_1.getVerifiedPhone)(u.id),
        ]);
        let phoneMasked = null;
        if (phone) {
            const digits = phone.replace(/\D/g, "");
            if (digits.length >= 11) {
                const last4 = digits.slice(-4);
                phoneMasked = `+7 (***) ***-${last4.slice(0, 2)}-${last4.slice(2)}`;
            }
        }
        // ⚠️ id наружу — ТОЛЬКО родной id платформы (internal 2e12+ не светим:
        // он уходит в QR-карту клуба и виден юзеру как «№ карты»)
        const platform = (0, auth_1.getUser)(req)?.platform ?? "tg";
        res.json({
            user: { id: (0, platform_1.toPlatformId)(u.id), first_name: u.first_name, username: u.username, platform },
            phoneVerified: verified,
            phoneMasked,
            balance,
            daily,
            activeRewards: myRewards.length,
            birthday,
            joinedAt: subInfo?.joined_at ?? null,
            launchCount: subInfo?.launch_count ?? 0,
        });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[API /me]");
        res.status(500).json({ error: "internal" });
    }
});
router.post("/api/unverify-phone", auth_1.requireTgUser, (0, middleware_1.rateLimit)(3), async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        await db_1.pool.query(`UPDATE subscribers SET phone = NULL, phone_verified_at = NULL WHERE chat_id = $1`, [u.id]);
        res.json({ ok: true });
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[API /unverify-phone]");
        res.status(500).json({ error: "internal" });
    }
});
router.get("/api/history", auth_1.requireTgUser, async (req, res) => {
    const u = (0, auth_1.getTgUser)(req);
    try {
        const rows = await (0, club_1.getHistory)(u.id, 30);
        res.json(rows);
    }
    catch (e) {
        logger_1.log.error({ err: e, chatId: u.id }, "[API /history]");
        res.status(500).json({ error: "internal" });
    }
});
exports.default = router;

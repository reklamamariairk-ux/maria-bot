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

import { Router } from "express";
import {
  pool,
  touchSubscriber,
  setUserBirthday,
  getSubscriberInfo,
} from "../db";
import {
  isPhoneVerified,
  getBalance,
  getDailyStatus,
  getMyRewards,
  getHistory,
} from "../club";
import { getVerifiedPhone } from "../lk";
import { rateLimit } from "../middleware";
import { requireTgUser, getTgUser, getUser } from "../auth";
import { toPlatformId } from "../platform";
import { log } from "../logger";
import { isValidIsoDate } from "../date-utils";

const router = Router();

async function getUserBirthday(chatId: number): Promise<string | null> {
  try {
    const { rows } = await pool.query<{ birthday: string }>(
      `SELECT birthday FROM user_birthdays WHERE chat_id = $1`,
      [chatId]
    );
    return rows[0]?.birthday ? String(rows[0].birthday).slice(0, 10) : null;
  } catch {
    return null;
  }
}

router.post("/api/birthday", requireTgUser, rateLimit(5), async (req, res) => {
  const u = getTgUser(req)!;
  const body = req.body as { birthday?: string };
  const bday = String(body.birthday ?? "").trim();
  if (!isValidIsoDate(bday)) {
    res.status(400).json({ ok: false, error: "Неверный формат даты" });
    return;
  }
  try {
    await setUserBirthday(u.id, bday);
    res.json({ ok: true });
  } catch (e) {
    log.error({ err: e, chatId: u.id }, "[BIRTHDAY]");
    res.status(500).json({ ok: false, error: "Не получилось сохранить" });
  }
});

router.get("/api/me", requireTgUser, async (req, res) => {
  const u = getTgUser(req)!;
  try {
    await touchSubscriber(u.id, u.username, u.first_name).catch(() => {});
    const [verified, balance, daily, myRewards, birthday, subInfo, phone] = await Promise.all([
      isPhoneVerified(u.id),
      getBalance(u.id),
      getDailyStatus(u.id),
      getMyRewards(u.id),
      getUserBirthday(u.id),
      getSubscriberInfo(u.id),
      getVerifiedPhone(u.id),
    ]);
    let phoneMasked: string | null = null;
    if (phone) {
      const digits = phone.replace(/\D/g, "");
      if (digits.length >= 11) {
        const last4 = digits.slice(-4);
        phoneMasked = `+7 (***) ***-${last4.slice(0, 2)}-${last4.slice(2)}`;
      }
    }
    // ⚠️ id наружу — ТОЛЬКО родной id платформы (internal 2e12+ не светим:
    // он уходит в QR-карту клуба и виден юзеру как «№ карты»)
    const platform = getUser(req)?.platform ?? "tg";
    res.json({
      user: { id: toPlatformId(u.id), first_name: u.first_name, username: u.username, platform },
      phoneVerified: verified,
      phoneMasked,
      balance,
      daily,
      activeRewards: myRewards.length,
      birthday,
      joinedAt: subInfo?.joined_at ?? null,
      launchCount: subInfo?.launch_count ?? 0,
    });
  } catch (e) {
    log.error({ err: e, chatId: u.id }, "[API /me]");
    res.status(500).json({ error: "internal" });
  }
});

router.post("/api/unverify-phone", requireTgUser, rateLimit(3), async (req, res) => {
  const u = getTgUser(req)!;
  try {
    await pool.query(
      `UPDATE subscribers SET phone = NULL, phone_verified_at = NULL WHERE chat_id = $1`,
      [u.id]
    );
    res.json({ ok: true });
  } catch (e) {
    log.error({ err: e, chatId: u.id }, "[API /unverify-phone]");
    res.status(500).json({ error: "internal" });
  }
});

router.get("/api/history", requireTgUser, async (req, res) => {
  const u = getTgUser(req)!;
  try {
    const rows = await getHistory(u.id, 30);
    res.json(rows);
  } catch (e) {
    log.error({ err: e, chatId: u.id }, "[API /history]");
    res.status(500).json({ error: "internal" });
  }
});

export default router;

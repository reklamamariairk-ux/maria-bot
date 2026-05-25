/**
 * LK routes — личный кабинет с сайта maria-irk.ru через Bitrix API.
 *
 * Эндпоинты:
 * - GET /api/lk — баланс баллов + история заказов + level + tickets count
 *                  (требует verified phone; 502 если Bitrix недоступен)
 *
 * Все 4 потребителя на фронте читают response плоско (см. fix `c58b570` от
 * 22.05) — формат: { found, name, level, balance, year_spent, orders, ... }.
 * Не оборачивать в { data: ... }.
 */

import { Router } from "express";
import { fetchLk } from "../lk";
import { rateLimit } from "../middleware";
import { requireTgUser, getTgUser } from "../auth";
import { log } from "../logger";

const router = Router();

router.get("/api/lk", requireTgUser, rateLimit(30), async (req, res) => {
  const u = getTgUser(req)!;
  try {
    const result = await fetchLk(u.id);
    if (!result.ok) {
      const code = result.reason === "phone_not_verified" ? 403 : 502;
      res.status(code).json({ error: result.reason });
      return;
    }
    res.json(result.data);
  } catch (e) {
    log.error({ err: e, chatId: u.id }, "/api/lk failed");
    res.status(500).json({ error: "internal" });
  }
});

export default router;

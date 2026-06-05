# maria-bot — конвенции проекта

Mini App кондитерской «Мария» (Иркутск) для **двух платформ**: Telegram + VK. Один сервис, одна Neon БД, один каталог из 1С.

## ⚠️ Платформы и ID (src/platform.ts)

- Все таблицы ключуются по `chat_id BIGINT` (историческое имя). TG-юзеры — родной id, VK-юзеры — `2e12 + vk_user_id`.
- В БД/квотах — всегда internalId. Наружу (UI, QR, Bitrix, внешние API) — только `toPlatformId()` + `platformOf()`. Значение ≥ 2e12 за пределами БД = баг.
- Отправка сообщений юзеру — ТОЛЬКО через PushService (роутит TG/VK сам). Прямые `bot.api.sendMessage(chatId)` запрещены.
- Ссылки на Mini App в текстах — только через `src/links.ts` (`miniAppLink`/`referralLink` по платформе получателя).
- VK не понимает Markdown — VK-sender стрипает его сам, но не полагайся на разметку в пушах.

## Критичные правила

- **Только реальные данные из 1С/каталога** — никаких выдуманных цен/скидок. Нет данных → не показывать.
- БД-транзакции ТОЛЬКО через `pool.connect()` + client + BEGIN/COMMIT/ROLLBACK + `client.release()` в `finally`. `pool.query("BEGIN")` НЕ работает.
- Все «сутки» — по Иркутску (UTC+8): `todayIrkutsk()`/`yesterdayIrkutsk()` в src/club.ts.
- Верификация телефона — только криптографически: TG `:contact` handler, VK — sign от VKWebAppGetPhoneNumber. Никаких trust-the-client endpoint'ов.
- Фронт: платформенные API только через бридж `public/js/tg-bridge.js` (глобал `App.*`), не напрямую `window.Telegram`/`vkBridge`.
- Иконки: Lucide-stroke `data-icon` (мелкие), 3D-glossy `data-icon-3d` (hero ≥32px). Эмодзи — только в пушах/маркетинге.
- Тема всегда светлая (бренд-решение), dark-mode принудительно выключен.

## Деплой

Hostinger VPS: `ssh root@145.223.121.47 'cd /opt/maria/maria-bot && git pull && cd .. && docker compose up -d --build maria-bot'`. Env: `/opt/maria/.env-files/bot.env`. Health: `https://bot.145-223-121-47.sslip.io/health`. Staging: контейнер `maria-bot-stage`. Без VK_* env сервис работает в TG-only режиме — деплой любого этапа безопасен.

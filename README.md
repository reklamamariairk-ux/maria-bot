# 🍰 Кондитерская «Мария» — Telegram Bot + Mini App

Telegram-бот с Mini App (игры + ИИ-чат) для кондитерской.

## Стек

| Слой | Технология |
|------|-----------|
| Бот | [grammY](https://grammy.dev/) |
| Сервер | Express.js |
| ИИ | [Groq](https://groq.com/) (llama-3.1-8b-instant) |
| Mini App | Vanilla JS / HTML / CSS |
| Деплой | Hostinger Docker + российские nginx/systemd/PostgreSQL |

---

## Production и высокая нагрузка

Production работает на Node.js 24 LTS. API и фоновые задачи поддерживают
раздельные роли `PROCESS_ROLE=api|worker`; для нескольких API-реплик используются
Redis и PgBouncer. Полная схема, конфигурация, health checks, метрики и безопасный
нагрузочный тест описаны в [docs/scale-readiness.md](docs/scale-readiness.md).

Перед запуском приложения на новой схеме:

```bash
npm ci
npm run build
npm run migrate
```

---

## Структура проекта

```
maria-bot/
├── src/
│   └── index.ts          # Бот + Express сервер
├── public/               # Mini App (статика)
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── app.js        # Навигация, Telegram init
│       ├── game.js       # Мемори + Поймай торт
│       └── chat.js       # ИИ-чат
├── render.yaml           # Конфиг деплоя Render
├── .env.example
├── tsconfig.json
└── package.json
```

---

## Быстрый старт (локально)

```bash
# 1. Клонируем / входим в папку
cd maria-bot

# 2. Устанавливаем зависимости
npm install

# 3. Копируем конфиг окружения
cp .env.example .env
# → заполняем BOT_TOKEN и GROQ_KEY

# 4. Запускаем в режиме разработки (long polling)
npm run dev
```

> Mini App будет доступен по адресу http://localhost:3000

---

## Production deploy

Production использует Node.js 24 LTS. Основной вход работает в Docker на
Hostinger, быстрый игровой вход — две systemd API-реплики на российском VDS.
PostgreSQL, PgBouncer и Redis находятся рядом с быстрыми репликами; единственный
worker для cron/push работает на Hostinger. Пошаговый rolling rollout, backup,
smoke, нагрузочный тест и откат описаны в
[docs/scale-readiness.md](docs/scale-readiness.md).

---

## Команды бота

| Команда | Описание |
|---------|---------|
| `/start` | Приветствие + кнопка Mini App |
| `/games` | Описание игр + кнопка |
| `/sale` | Акции недели + кнопка |
| `/help` | Контакты + кнопка |

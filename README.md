# 🍰 Кондитерская «Мария» — Telegram Bot + Mini App

Telegram-бот с Mini App (игры + ИИ-чат) для кондитерской.

## Стек

| Слой | Технология |
|------|-----------|
| Бот | [grammY](https://grammy.dev/) |
| Сервер | Express.js |
| ИИ | [Groq](https://groq.com/) (llama-3.1-8b-instant) |
| Mini App | Vanilla JS / HTML / CSS |
| Деплой | [Render.com](https://render.com) |

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

## Деплой на Render.com

### Шаг 1 — Подключить репозиторий

1. Запушьте проект на GitHub:
   ```bash
   git init && git add . && git commit -m "init"
   git remote add origin https://github.com/YOUR/maria-bot.git
   git push -u origin main
   ```
2. Зайдите на [render.com](https://render.com) → **New → Web Service**
3. Выберите репозиторий `maria-bot`

### Шаг 2 — Настроить сервис

| Поле | Значение |
|------|---------|
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm start` |
| **Node version** | `18` |

### Шаг 3 — Переменные окружения

В разделе **Environment → Environment Variables** добавьте:

| Ключ | Значение |
|------|---------|
| `BOT_TOKEN` | токен от @BotFather |
| `GROQ_KEY` | ключ из console.groq.com |
| `WEBHOOK_URL` | `https://<your-app>.onrender.com` |
| `MINI_APP_URL` | `https://<your-app>.onrender.com` |

### Шаг 4 — Зарегистрировать Mini App в Telegram

1. Откройте @BotFather → `/newapp` или `/editapp`
2. Укажите URL: `https://<your-app>.onrender.com`
3. Скопируйте ссылку `t.me/YOUR_BOT/app` и вставьте в `MINI_APP_URL`

### Шаг 5 — Deploy

Нажмите **Create Web Service** — Render сам установит зависимости, соберёт TypeScript и запустит сервер.

Первый деплой занимает ~2–3 минуты. После этого бот автоматически получит webhook.

---

## Команды бота

| Команда | Описание |
|---------|---------|
| `/start` | Приветствие + кнопка Mini App |
| `/games` | Описание игр + кнопка |
| `/sale` | Акции недели + кнопка |
| `/help` | Контакты + кнопка |

---

## Free Tier Render — важно

На бесплатном тарифе сервис засыпает через 15 минут без запросов.
При первом обращении после сна — cold start ~30 сек.

Чтобы бот отвечал быстро, настройте периодический ping (например через [UptimeRobot](https://uptimerobot.com)):
- URL: `https://<your-app>.onrender.com/health`
- Интервал: 14 минут

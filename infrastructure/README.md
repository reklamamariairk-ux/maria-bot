# Интеграции на стороне сайта maria-irk.ru

## partners.php — синхронизация партнёров клуба

Эндпоинт для отдачи партнёров клуба «Мария для своих» из админки Bitrix
в JSON. Mini-app дёргает его раз в час и обновляет список без редеплоя.

**Уже задеплоено:** `/api/partners.php` на www.maria-irk.ru (создан через
файловый менеджер админки). Источник данных — существующий инфоблок
`«Привилегии для Своих»` (IBLOCK_ID = 88, тип `privilege`).

### Структура инфоблока 88 (как есть)

| Код свойства | Тип | Назначение |
|---|---|---|
| `SHILD` | Список | Категория (Здоровье/Красота/Рестораны/Отдых/Дом/Авто) |
| `LINK` | Строка | URL партнёра |
| `LOGO` | Файл | Логотип (картинка) |
| `LOGO_TEXT` | HTML/текст | Короткое описание (резерв) |
| `COLOR`, `COLOR_TEXT` | Список | Цвета для оформления карточки на сайте |

`NAME` → `name`, `DETAIL_TEXT` → `desc`. Эмодзи и текст-бейдж (`perk`)
эндпоинт выводит из `DETAIL_TEXT` эвристиками:

- `(\d+)%` → `🏷` + `−N%`
- слово «подарок» → `🎁` + `🎁 Подарок`
- `N бонусных баллов` → `⭐` + `+N баллов`
- иначе — эмодзи по категории (🩺💅🍽🌴🏠🚗) или 🤝

Когда в админке заполняют `SHILD` (категорию) и/или `LOGO_TEXT` — эндпоинт
их подхватывает.

### Проверка

```
curl "https://www.maria-irk.ru/api/partners.php?token=YOUR_TOKEN"
```

Должен вернуть JSON с массивом `partners` (сейчас 14 элементов).

### Прописать env на Render

В Render Dashboard у сервиса `maria-bot`:

```
PARTNERS_API   = https://www.maria-irk.ru/api/partners.php
PARTNERS_TOKEN = da5d08353c26618f5aca4dbe185275e4981aaf2fbbc77d7317de5e89f9d1f94e
```

После рестарта в логах будет:

```
[STARTUP] Partners cron scheduled (hourly)
[PARTNERS] synced N from Bitrix
```

Mini App автоматически начнёт показывать актуальный список.

### Без эндпоинта

Если `PARTNERS_API` не задан — бот отдаёт партнёров из `data/partners.json`
(бандлится с репозиторием). Это fallback для старта без админки.

---

## lk.php — Личный кабинет с сайта

**Уже задеплоено:** `/api/lk.php`. Проксирует к 1С УПП — там же, откуда
берутся баланс и билеты на сайтовом `/personal/bonuses/` и `/personal/lottery/`.

### Источники данных в 1С

| Endpoint | Метод | Возвращает |
|---|---|---|
| `http://89.108.119.147/f_base_2023/hs/Website/Bonus/{phone}` | GET, basic auth `web:web` | JSON `{"Bonus":"40.1"}` или текст «Нет данных по начислению баллов» |
| `http://89.108.119.147/f_base_2023/hs/SweetCheck/Info/{phone}` | GET, basic auth `web:web` | XML `<root><Scores>5</Scores></root>` |

`{phone}` — 11 цифр, начинается с `8` (формат, который ждёт 1С).

### Контракт ответа (`/api/lk.php?token=…&phone=…`)

```json
{
  "found": true,
  "name": "Имя Фамилия" | null,
  "level": "Семья",
  "balance": 1234,
  "tickets": [],
  "tickets_count": 5,
  "phone": "89991234567"
}
```

Поля:
- `found` — true, если 1С отдало хоть какие-то данные
- `name` — берём из Bitrix `b_user.PERSONAL_PHONE` (опционально, может быть null)
- `level` — пока всегда `"Семья"` (на сайте `/personal/bonuses/` тоже захардкожено)
- `tickets` — пустой массив (1С отдаёт только число, не детали)
- `tickets_count` — целое число билетов

### Env на Render

```
LK_API   = https://www.maria-irk.ru/api/lk.php
LK_TOKEN = a4e4705f63070a189cc9bfa5bc65a722aa63bd9c981cae37229731eaca396a98
```

В Mini App вкладке «Клуб» секция **«Мой счёт на сайте»** показывает
имя, уровень, баланс и количество билетов.

### Безопасность

- Токен передаётся в URL → не логируйте URL запросов целиком в access-log
  (или экранируйте `?token=`).
- Если хотите параноидально — добавьте IP-whitelist в `ALLOWED_IPS`.
  IP сервера Render можно посмотреть в логах их CDN-провайдера или
  спросить у поддержки.
- Бот вызывает эндпоинт **только** для номеров, верифицированных через
  Telegram-контакт (поле `phone_verified_at IS NOT NULL` в `subscribers`).

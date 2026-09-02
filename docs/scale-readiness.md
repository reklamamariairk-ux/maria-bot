# «Котик Комбат»: эксплуатация под высокой нагрузкой

## Цель

Базовый профиль: 1 000 одновременно активных игроков с возможностью проверить
рост до 3 000. Для игрового API целевые показатели:

- `p95 POST /api/clicker/tap < 200 ms` внутри российского узла;
- доля `5xx` ниже `0,5%`;
- ни одной двойной или потерянной пачки тапов;
- отказ одного API-процесса не останавливает игру;
- фоновые задачи и пуши выполняются ровно одним worker.

## Реализованная схема

```text
nginx cache/gzip
       │
       ├── API :3010 ─┐
       └── API :3011 ─┼── PgBouncer :6432 ── PostgreSQL :5432
              │       │
              └── Redis :6379

Hostinger API + worker ──────────────── PostgreSQL :5432
```

Новый клиент отправляет tap-батч раз в 5 секунд и получает компактную квитанцию.
Старый протокол сохранён на время обновления WebView-кэшей. Redis объединяет
лимиты нескольких API-реплик; при кратком сбое приложение использует локальный
ограниченный fallback. Аналитика записывается пачками каждые 5 секунд.

## Переменные окружения

| Переменная | API | Worker | Назначение |
|---|---:|---:|---|
| `PROCESS_ROLE=api` | да | нет | HTTP без cron-задач |
| `PROCESS_ROLE=worker` | нет | да | cron/push/sync без HTTP |
| `RUN_SCHEMA_INIT=0` | да | да | миграция запускается отдельно |
| `DATABASE_URL=postgresql://...@127.0.0.1:6432/maria_bot` | Россия | нет | локальный PgBouncer |
| `DATABASE_URL=postgresql://...@186.246.14.117:5432/maria_bot` | Hostinger | да | текущий защищённый межсерверный доступ |
| `REDIS_URL=redis://127.0.0.1:6379` | да | нет | общие лимиты российских API-реплик и античит |
| `REDIS_COMMAND_TIMEOUT_MS=1000` | да | — | быстрый fallback при зависшем Redis |
| `PG_POOL_MAX=12` | да | `6` | клиентский пул процесса |
| `MAX_INFLIGHT_REQUESTS=200` | да | — | backpressure до очереди БД |
| `PG_STATEMENT_TIMEOUT_MS=15000` | да | да | предел SQL statement |
| `PG_QUERY_TIMEOUT_MS=20000` | да | да | предел запроса со стороны `pg` |
| `METRICS_TOKEN=<secret>` | да | — | Bearer или `X-Metrics-Token` для `/metrics` |
| `SENTRY_DSN=<dsn>` | да | да | ошибки и трассировка |

Реальные значения и пароли хранятся только в
`/opt/maria/.env-files/bot.env` (Hostinger) и
`/opt/maria-bot-russia/.env` (Россия), не в git.

## Порядок первого развёртывания

1. Сделать проверяемый backup PostgreSQL и записать команду восстановления.
2. Установить Node.js 24 LTS, Redis и PgBouncer.
3. Скопировать `deploy/redis.conf`, `deploy/pgbouncer.ini.example` и создать
   `/etc/pgbouncer/userlist.txt` с реальным SCRAM-секретом.
4. Сначала оставить `DATABASE_URL` направленным прямо на PostgreSQL, собрать код
   и выполнить миграцию:

   ```bash
   npm ci
   npm run build
   npm run migrate
   ```

5. Переключить `DATABASE_URL` на PgBouncer `127.0.0.1:6432` и проверить
   `SHOW POOLS` в административной консоли PgBouncer.
6. Установить systemd units из `deploy/`, затем запустить российские API:

   ```bash
   systemctl daemon-reload
   systemctl enable --now maria-bot-api@3010
   systemctl enable --now maria-bot-api@3011
   ```

7. Раскомментировать второй `server 127.0.0.1:3011` в upstream nginx, выполнить
   `nginx -t` и только после успешной проверки перезагрузить nginx.
8. Проверить `/live`, `/ready`, `/version`, авторизованное открытие игры и одну
   tap-пачку. В `/ready` должны быть `db.ok=true`, `redis.ok=true`,
   `db.waiting=0` без нагрузки.

Единственный production-worker запускается на Hostinger: российские адреса не
используются для исходящих Telegram-вызовов. Основной Docker API имеет
`PROCESS_ROLE=api`, отдельный контейнер worker — `PROCESS_ROLE=worker`. Эти роли
зафиксированы в `deploy/docker-compose.scale.yml`, который подключается вторым
compose-файлом после основного `/opt/maria/docker-compose.yml`.

На последующих выкладках порядок: build → migrate one-shot → rolling restart API
по одному процессу → worker → smoke. Нельзя одновременно останавливать оба API.
Российские units смотрят на атомарный symlink `/opt/maria-bot-current`; релизы
хранятся в `/opt/maria-bot-releases/<commit>`, а `.env` и изменяемый `data/`
остаются общими в `/opt/maria-bot-russia`.

## Нагрузочный тест

Сценарий никогда не атакует удалённый адрес без явного `ALLOW_REMOTE_LOAD=1`.
Для capacity-профиля нужен отдельный подписанный тестовый аккаунт на каждый VU;
один общий аккаунт измерит только блокировку одной строки PostgreSQL.

Файл авторизаций — JSON-массив значений заголовка `Authorization`, вне git:

```json
["tma <signed-init-data-1>", "vk <signed-launch-params-2>"]
```

Локальный smoke:

```bash
AUTHORIZATION="tma ..." npm run load:clicker
```

Ступени capacity-теста выполняются отдельно с паузой и проверкой метрик:

```bash
ALLOW_REMOTE_LOAD=1 LOAD_PROFILE=capacity BASE_URL=https://game.example.ru \
AUTHORIZATIONS_FILE=/secure/test-auth.json VUS=100 DURATION_SEC=300 npm run load:clicker

# затем VUS=500, 1000 и только после здоровых метрик — 3000
```

Остановить ступень, если `db.waiting` устойчиво растёт, p95 превышает 200 мс,
ошибки превышают 0,5%, event-loop p95 выше 100 мс или PostgreSQL CPU выше 75%.

## Мониторинг и алерты

- `/live` — процесс жив, не проверяет зависимости;
- `/ready` — PostgreSQL, Redis, пул, inflight и буфер аналитики;
- `/metrics` — Prometheus text format, защищён `METRICS_TOKEN`;
- Sentry — исключения и трассировка;
- nginx access/error log — входной RPS, 499/502/503 и cache hit ratio.

Минимальные алерты:

- readiness не 200 две проверки подряд;
- `5xx > 0,5%` за 5 минут;
- `maria_pg_pool_waiting > 0` дольше минуты;
- `maria_inflight_requests > 160` дольше минуты;
- p95 `/api/clicker/tap > 200 ms`;
- event-loop p95 > 100 ms;
- Redis недоступен при двух и более API-репликах;
- рестарт процесса или провал фоновой синхронизации.

## Деградация и откат

- Redis недоступен: API продолжает работать с локальными лимитами, но readiness
  становится 503, чтобы балансировщик не оставлял такую реплику в ротации.
- PostgreSQL недоступен: `/live` остаётся 200, `/ready` становится 503.
- Перегрузка процесса: новые запросы быстро получают 503 + `Retry-After: 1`,
  вместо многосекундной очереди и каскада таймаутов.
- Откат API возможен по одному процессу. Старый tap-клиент совместим с новым
  сервером, новый клиент умеет принять legacy полный tap-ответ.
- Если Redis нужно исключить из диагностики одной реплики, убрать `REDIS_URL` и
  перезапустить только её; при нескольких активных репликах это временная мера.

## Следующий предел

После подтверждённых 3 000 одновременных игроков следующий шаг — вынести рейтинг
в Redis Sorted Set и хранить вычисленные игровые множители прямо в
`clicker_state`. Делать это до измерения текущего compact tap-пути не требуется:
оно усложняет экономику и процедуру восстановления данных.

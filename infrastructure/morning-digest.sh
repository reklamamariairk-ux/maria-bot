#!/usr/bin/env bash
# Утренний дайджест «Мария» -> Telegram. Живёт на Hostinger VPS (145.223.121.47)
# в /opt/maria/scripts/morning-digest.sh, cron 0 0 * * * UTC (= 08:00 Иркутск).
# Установка: infrastructure/install-digest.sh с локальной машины.
#
# Токен бота НЕ хранится здесь — читается на VPS из env-файла claude-tg-remote.

set -u
CHAT_ID="757179699"

# BOT_TOKEN: пробуем известные места установки claude-tg-remote
for f in /opt/claude-remote/.env /opt/maria/claude-tg-remote/.env /root/claude-tg-remote/.env; do
  [ -f "$f" ] && BOT_TOKEN=$(grep -oP '^BOT_TOKEN=\K.*' "$f" | tr -d '"' | tr -d "'" | tr -d '\r') && [ -n "${BOT_TOKEN:-}" ] && break
done
if [ -z "${BOT_TOKEN:-}" ]; then
  echo "morning-digest: BOT_TOKEN не найден ни в одном известном .env" >&2
  exit 1
fi

code() { curl -sS -m 20 -o /dev/null -w '%{http_code}' "$@" 2>/dev/null || echo 000; }
mark() { [ "$1" = "$2" ] && echo "OK" || echo "FAIL($2)"; }

LINES=()
FAILS=0
add() { # $1 ожидание, $2 подпись, $3 url, остальные — доп. флаги curl
  local exp="$1" label="$2" url="$3"; shift 3
  local c; c=$(code "$@" "$url")
  local m; m=$(mark "$exp" "$c")
  [ "$m" != "OK" ] && FAILS=$((FAILS+1))
  LINES+=("$m $label")
}

# maria-bot (смоук-скрипт репо даёт детальный выход; здесь — ключевые точки)
if [ -x /opt/maria/maria-bot/scripts/smoke.sh ] || [ -f /opt/maria/maria-bot/scripts/smoke.sh ]; then
  if bash /opt/maria/maria-bot/scripts/smoke.sh >/tmp/smoke-bot.log 2>&1; then
    LINES+=("OK maria-bot смоук (8 проверок)")
  else
    FAILS=$((FAILS+1))
    LINES+=("FAIL maria-bot смоук: $(grep -c '^  FAIL' /tmp/smoke-bot.log) красных, детали в /tmp/smoke-bot.log")
  fi
else
  add 200 "maria-bot /health" "https://bot.145-223-121-47.sslip.io/health"
fi

# Витрины и дашборды
add 200 "vasily-cafe (игры)"        "https://vasily.145-223-121-47.sslip.io/"
add 200 "sales-dashboard (Timeweb)" "http://186.246.14.117/"
add 200 "план выпуска production.html" "http://186.246.14.117/production.html"

# Я.Директ-скрейп на sales-dashboard: свежесть + сессия.
# Добавлено 2026-07-29: скрейпер молча лежал 7 недель (sessionExpired), никто не видел.
DASH_TOKEN="8694d65d-b857-491f-9b3b-8c7285fe0340"
DIRECT_LINE=$(curl -sS -m 40 -H "X-User-Token: ${DASH_TOKEN}" "http://186.246.14.117/api/marketing/channels" 2>/dev/null | python3 -c '
import json,sys,datetime
try:
    d = json.load(sys.stdin)
    dr = (d.get("external") or {}).get("direct") or {}
    if dr.get("sessionExpired"):
        print("FAIL Я.Директ-скрейп: sessionExpired (нужен релогин yandex-state)")
        raise SystemExit
    ts = dr.get("scrapedAt") or ""
    age_h = (datetime.datetime.now(datetime.timezone.utc)
             - datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))).total_seconds() / 3600
    spend = (dr.get("totals") or {}).get("spend")
    if age_h < 30 and spend is not None:
        print(f"OK Я.Директ-скрейп ({age_h:.0f}ч назад, {spend:,.0f} руб MTD)".replace(",", " "))
    else:
        print(f"FAIL Я.Директ-скрейп: протух ({age_h:.0f}ч, spend={spend})")
except Exception as e:
    print("FAIL Я.Директ-скрейп: проверка сломалась (" + str(e)[:60] + ")")
' 2>/dev/null)
[ -z "$DIRECT_LINE" ] && DIRECT_LINE="FAIL Я.Директ-скрейп: дашборд не ответил"
case "$DIRECT_LINE" in FAIL*) FAILS=$((FAILS+1));; esac
LINES+=("$DIRECT_LINE")

# Кофе-контроль (антифрод, добавлено 2026-07-30): красные точки = стаканы уходят,
# напитки не пробиваются. Эндпоинт открытый, кэш 6ч на стороне дашборда.
COFFEE_LINE=$(curl -sS -m 60 "http://186.246.14.117/api/marketing/coffee-control" 2>/dev/null | python3 -c '
import json,sys
try:
    d = json.load(sys.stdin)
    reds = [s for s in d.get("stores", []) if s.get("status") == "red"]
    if reds:
        print("FAIL кофе-контроль: мимо кассы? " + ", ".join(
            f"{s[\"store\"]} ({s[\"cups\"]} стак/{s[\"drinks\"]} проб.)" for s in reds[:5]))
    else:
        print("OK кофе-контроль: красных точек нет")
except Exception:
    print("OK кофе-контроль: н/д (эндпоинт не ответил)")
' 2>/dev/null)
[ -z "$COFFEE_LINE" ] && COFFEE_LINE="OK кофе-контроль: н/д"
case "$COFFEE_LINE" in FAIL*) FAILS=$((FAILS+1));; esac
LINES+=("$COFFEE_LINE")

# Гонка стаи (добавлено 2026-07-30, аудит): заявки на прошлой неделе были, а строки
# итогов нет = cron проспал понедельник и призы не выданы. Пустая неделя без строки — не беда.
RACE_LINE=$(DBURL=$(grep -oE 'postgresql://[^"]*' /opt/maria/.env-files/bot.env | head -1); docker exec -i postgres psql "$DBURL" -t -A -c "
WITH d AS (SELECT ((EXTRACT(EPOCH FROM NOW())::bigint + 28800)/86400)::bigint AS day),
w AS (SELECT (day - ((day+3)%7) - 7)::text AS prev FROM d)
SELECT (SELECT COUNT(*) FROM pigeon_race_entries e, w WHERE e.week=w.prev) || ':' ||
       (SELECT COUNT(*) FROM pigeon_race_winners r, w WHERE r.week=w.prev);" 2>/dev/null)
case "$RACE_LINE" in
  0:*) LINES+=("OK гонка стаи: прошлая неделя без заявок");;
  *:0) FAILS=$((FAILS+1)); LINES+=("FAIL гонка стаи: заявки были, итоги НЕ подведены — призы не выданы");;
  *:*) LINES+=("OK гонка стаи: итоги прошлой недели подведены");;
  *)   LINES+=("OK гонка стаи: н/д");;
esac

# Бэкап БД (добавлено 2026-08-03, переезд с Neon на локальный postgres):
# свежий дамп maria_bot младше 26 часов и больше 10 КБ, иначе красный.
BK=$(ls -t /opt/maria/pg-backups/daily/maria_bot_*.sql.gz 2>/dev/null | head -1)
if [ -n "$BK" ] && [ "$(( $(date +%s) - $(stat -c %Y "$BK") ))" -lt 93600 ] && [ "$(stat -c%s "$BK")" -gt 10240 ]; then
  LINES+=("OK бэкап БД: $(basename "$BK")")
else
  FAILS=$((FAILS+1))
  LINES+=("FAIL бэкап БД: свежего дампа maria_bot нет (см. /opt/maria/pg-backups/daily/)")
fi

# Контейнеры docker: рестартящиеся/нездоровые
BAD=$(docker ps --format '{{.Names}} {{.Status}}' 2>/dev/null | grep -Ei 'restarting|unhealthy' || true)
if [ -n "$BAD" ]; then
  FAILS=$((FAILS+1))
  LINES+=("FAIL контейнеры: $(echo "$BAD" | tr '\n' '; ')")
else
  LINES+=("OK контейнеры docker здоровы")
fi

if [ "$FAILS" = "0" ]; then HEAD="🟢 Мария: всё живо"; else HEAD="🔴 Мария: проблем — $FAILS"; fi
TEXT="$HEAD ($(TZ=Asia/Irkutsk date '+%d.%m %H:%M') Иркутск)"$'\n'
for l in "${LINES[@]}"; do TEXT+="$l"$'\n'; done

curl -sS -m 20 "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${CHAT_ID}" \
  --data-urlencode "text=${TEXT}" \
  -o /dev/null

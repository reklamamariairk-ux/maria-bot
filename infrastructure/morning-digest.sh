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

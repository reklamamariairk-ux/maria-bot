#!/usr/bin/env bash
# Прод-смоук maria-bot: быстрая объективная проверка «жив и не сломан».
# Запуск:  bash scripts/smoke.sh            (прод по умолчанию)
#          BASE=http://localhost:3000 bash scripts/smoke.sh
# Выход: 0 = всё зелёно, 1 = есть красные. Только безопасные запросы
# (GET без auth + один POST в админку с пустым токеном, который обязан отбиться).

set -u
BASE="${BASE:-https://bot.145-223-121-47.sslip.io}"
# Windows-curl (schannel) + VPN не может проверить отзыв сертификата -> --ssl-no-revoke.
# На Linux (VPS) этого флага нет, поэтому подставляем только под schannel.
SSLFLAG=""
curl -V 2>/dev/null | grep -qi schannel && SSLFLAG="--ssl-no-revoke"
CURL="curl $SSLFLAG -sS -m 15 -o /dev/null -w %{http_code}"
FAIL=0

check() { # $1 ожидание, $2 описание, $3 фактический код
  if [ "$3" = "$1" ]; then
    echo "  OK   $2 -> $3"
  else
    echo "  FAIL $2 -> $3 (ожидалось $1)"
    FAIL=1
  fi
}

echo "SMOKE maria-bot @ $BASE"

check 200 "GET /health"            "$($CURL "$BASE/health")"
check 200 "GET /version"           "$($CURL "$BASE/version")"
check 200 "GET /game.html"         "$($CURL "$BASE/game.html")"
check 200 "GET /api/shops"         "$($CURL "$BASE/api/shops")"
check 200 "GET /api/catalog-status" "$($CURL "$BASE/api/catalog-status")"

# Гейты: без auth обязаны отбивать, «открывшийся» гейт = инцидент
check 401 "GET /api/pigeons (без auth)"  "$($CURL "$BASE/api/pigeons")"
check 403 "POST /api/admin/promo/reload (пустой токен)" "$($CURL -X POST "$BASE/api/admin/promo/reload")"

# Игровой клиент: game.html должен ссылаться на актуальный catdove
JS_REF=$(curl $SSLFLAG -sS -m 15 "$BASE/game.html" | grep -oE 'catdove\.js\?v=[0-9]+' | head -1)
if [ -n "$JS_REF" ]; then
  check 200 "GET /js/$JS_REF" "$($CURL "$BASE/js/$JS_REF")"
else
  echo "  FAIL game.html не ссылается на catdove.js?v=N"
  FAIL=1
fi

if [ "$FAIL" = "0" ]; then echo "RESULT: GREEN"; else echo "RESULT: RED"; fi
exit $FAIL

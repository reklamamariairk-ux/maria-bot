#!/usr/bin/env bash
# Ежедневный бэкап локального Postgres на Hostinger VPS (145.223.121.47).
# Живёт в /opt/maria/scripts/backup-pg.sh, cron 30 20 * * * UTC (= 04:30 Иркутск).
# Дампит все базы (maria_bot, maria_crew, maria_marketing) в /opt/maria/pg-backups/daily/,
# gzip, ротация 30 дней. По понедельникам шлёт копию maria_bot юзеру в TG (offsite).
#
# Добавлено 2026-08-03 при переезде maria-bot с Neon на локальный postgres.

set -u
OUT=/opt/maria/pg-backups/daily
mkdir -p "$OUT"
STAMP=$(date -u +%Y%m%d)
PGUSER=$(grep -oP '^POSTGRES_USER=\K.*' /opt/maria/.env-files/postgres.env | tr -d '\r')
FAIL=0

for db in maria_bot maria_crew maria_marketing; do
  f="$OUT/${db}_${STAMP}.sql.gz"
  # Порог 2 КБ: пустой/оборванный дамп в gzip меньше килобайта, валидный со схемой — больше
  if docker exec postgres pg_dump -U "$PGUSER" -d "$db" 2>/dev/null | gzip > "$f" && [ "$(stat -c%s "$f")" -gt 2048 ]; then
    :
  else
    FAIL=1
    echo "backup-pg: FAIL $db" >&2
  fi
done

# Ротация: 30 дней
find "$OUT" -name '*.sql.gz' -mtime +30 -delete

# Понедельник — offsite-копия maria_bot в TG (дамп маленький, ~1 МБ gzip)
if [ "$(date -u +%u)" = "1" ] && [ "$FAIL" = "0" ]; then
  for envf in /opt/claude-remote/.env /opt/maria/claude-tg-remote/.env /root/claude-tg-remote/.env; do
    [ -f "$envf" ] && BOT_TOKEN=$(grep -oP '^BOT_TOKEN=\K.*' "$envf" | tr -d '"' | tr -d "'" | tr -d '\r') && [ -n "${BOT_TOKEN:-}" ] && break
  done
  if [ -n "${BOT_TOKEN:-}" ]; then
    curl -sS -m 60 "https://api.telegram.org/bot${BOT_TOKEN}/sendDocument" \
      -F "chat_id=757179699" \
      -F "document=@$OUT/maria_bot_${STAMP}.sql.gz" \
      -F "caption=weekly db backup maria_bot ${STAMP}" \
      -o /dev/null || true
  fi
fi

exit "$FAIL"

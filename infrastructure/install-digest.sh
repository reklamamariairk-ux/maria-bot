#!/usr/bin/env bash
# Одноразовая установка утреннего дайджеста на Hostinger VPS.
# Запуск с локальной машины (Git Bash):  bash infrastructure/install-digest.sh
set -eu
VPS="root@145.223.121.47"
KEY="$HOME/.ssh/maria_prod"
HERE="$(cd "$(dirname "$0")" && pwd)"

# 1. подтянуть свежий репо на VPS (только git pull, контейнер не пересобирается)
ssh -i "$KEY" "$VPS" 'cd /opt/maria/maria-bot && git pull --ff-only'

# 2. залить скрипт дайджеста
ssh -i "$KEY" "$VPS" 'mkdir -p /opt/maria/scripts'
scp -i "$KEY" "$HERE/morning-digest.sh" "$VPS:/opt/maria/scripts/morning-digest.sh"
ssh -i "$KEY" "$VPS" 'chmod +x /opt/maria/scripts/morning-digest.sh /opt/maria/maria-bot/scripts/smoke.sh; sed -i "s/\r$//" /opt/maria/scripts/morning-digest.sh /opt/maria/maria-bot/scripts/smoke.sh'

# 3. крон: 00:00 UTC = 08:00 Иркутск, без дублей
ssh -i "$KEY" "$VPS" '(crontab -l 2>/dev/null | grep -v morning-digest; echo "0 0 * * * /opt/maria/scripts/morning-digest.sh >> /var/log/morning-digest.log 2>&1") | crontab -'

# 4. тестовый прогон — дайджест должен прийти в Telegram прямо сейчас
ssh -i "$KEY" "$VPS" 'bash /opt/maria/scripts/morning-digest.sh && echo "digest sent"'

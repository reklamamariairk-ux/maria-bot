#!/usr/bin/env bash
set -euo pipefail

umask 077
backup_dir=/opt/maria-bot-backups/daily
database=maria_bot
stamp=$(date -u +%Y%m%dT%H%M%SZ)
partial="$backup_dir/.${database}-${stamp}.dump.partial"
final="$backup_dir/${database}-${stamp}.dump"
checksum="$final.sha256"

mkdir -p "$backup_dir"
case "$partial" in /opt/maria-bot-backups/daily/.maria_bot-*.dump.partial) ;; *) exit 1 ;; esac
case "$final" in /opt/maria-bot-backups/daily/maria_bot-*.dump) ;; *) exit 1 ;; esac

cleanup() {
  rm -f -- "$partial" /tmp/maria-bot-backup-verify.dump
}
trap cleanup EXIT

# The root shell owns the redirection while pg_dump keeps PostgreSQL peer auth.
runuser -u postgres -- pg_dump --format=custom --compress=6 --no-owner --no-acl "$database" > "$partial"
test "$(stat -c%s "$partial")" -gt 10000
pg_restore --list "$partial" >/dev/null
mv "$partial" "$final"
sha256sum "$final" > "$checksum"
ln -sfn "$(basename "$final")" "$backup_dir/latest.dump"

# Sunday: prove that the newest archive is restorable, not merely readable.
if [ "$(date +%u)" = "7" ]; then
  verify_db=maria_bot_restore_check
  verify_file=/tmp/maria-bot-backup-verify.dump
  case "$verify_db" in maria_bot_restore_check) ;; *) exit 1 ;; esac
  runuser -u postgres -- dropdb --if-exists "$verify_db" >/dev/null 2>&1 || true
  cp "$final" "$verify_file"
  chown postgres:postgres "$verify_file"
  chmod 600 "$verify_file"
  runuser -u postgres -- createdb "$verify_db"
  restore_cleanup() {
    runuser -u postgres -- dropdb --if-exists "$verify_db" >/dev/null 2>&1 || true
    rm -f -- "$verify_file"
  }
  trap 'restore_cleanup; cleanup' EXIT
  runuser -u postgres -- pg_restore --exit-on-error --no-owner --no-acl --dbname="$verify_db" "$verify_file"
  runuser -u postgres -- psql -d "$verify_db" -Atc "SELECT to_regclass('public.clicker_state') IS NOT NULL" | grep -qx t
  restore_cleanup
  trap cleanup EXIT
fi

# Exact directory and filename pattern; database archives are retained 30 days.
find "$backup_dir" -maxdepth 1 -type f -name 'maria_bot-*.dump' -mtime +30 -delete
find "$backup_dir" -maxdepth 1 -type f -name 'maria_bot-*.dump.sha256' -mtime +30 -delete

trap - EXIT
cleanup
echo "backup_ok file=$final bytes=$(stat -c%s "$final")"

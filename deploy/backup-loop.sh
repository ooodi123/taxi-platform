#!/bin/sh
# Работает внутри контейнера backup: раз в сутки (в 03:30 по UTC) делает дамп базы.
# Первый дамп — сразу при старте, чтобы бэкап был с первого дня.
set -u
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p /backups

dump() {
  ts=$(date -u +%Y-%m-%d_%H%M)
  file="/backups/taxi_${ts}.sql.gz"
  if pg_dump --no-owner --no-privileges | gzip -6 > "${file}.tmp"; then
    mv "${file}.tmp" "$file"
    echo "$(date -u '+%F %T') бэкап готов: $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "${file}.tmp"
    echo "$(date -u '+%F %T') ОШИБКА бэкапа" >&2
  fi
  find /backups -name 'taxi_*.sql.gz' -type f -mtime +"$KEEP_DAYS" -delete
}

dump
while true; do
  now=$(date -u +%s)
  next=$(date -u -d "$(date -u +%F) 03:30" +%s 2>/dev/null || echo $((now + 86400)))
  [ "$next" -le "$now" ] && next=$((next + 86400))
  sleep $((next - now))
  dump
done

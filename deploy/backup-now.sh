#!/usr/bin/env bash
# Бэкап базы прямо сейчас в ./backups (ночные бэкапы делаются автоматически).
# Совет: копируйте папку backups на другой сервер или в облако — бэкап на том же диске
# не спасёт, если умрёт сам сервер.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
FILE="backups/taxi_$(date -u +%Y-%m-%d_%H%M%S)_manual.sql.gz"
docker compose exec -T postgres pg_dump -U taxi --no-owner --no-privileges taxi | gzip -6 > "$FILE.tmp"
mv "$FILE.tmp" "$FILE"
echo "Бэкап: $FILE ($(du -h "$FILE" | cut -f1))"

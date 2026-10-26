#!/usr/bin/env bash
# Восстановление базы из бэкапа. ВНИМАНИЕ: текущие данные будут заменены.
#   ./deploy/restore.sh backups/taxi_2026-10-21_0330.sql.gz
set -euo pipefail
cd "$(dirname "$0")/.."
FILE="${1:-}"
[ -f "$FILE" ] || { echo "Укажите файл бэкапа: ./deploy/restore.sh backups/<файл>.sql.gz"; ls -1t backups/ 2>/dev/null | head; exit 1; }

read -rp "Заменить текущую базу данными из $FILE? Это необратимо. Введите ДА: " ans
[ "$ans" = "ДА" ] || { echo "Отменено."; exit 1; }

echo "Сначала сохраняю текущее состояние…"
./deploy/backup-now.sh
docker compose stop api
docker compose exec -T postgres psql -U taxi -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS taxi WITH (FORCE);" -c "CREATE DATABASE taxi OWNER taxi;"
gunzip -c "$FILE" | docker compose exec -T postgres psql -U taxi -d taxi -v ON_ERROR_STOP=1 -q
docker compose start api
echo "Готово: база восстановлена из $FILE"

#!/usr/bin/env bash
# Обновление: положите новые файлы проекта поверх старых (кроме .env и backups/), затем:
#   ./deploy/update.sh
# Перед обновлением делается бэкап базы. Миграции применяются автоматически при старте.
set -euo pipefail
cd "$(dirname "$0")/.."
./deploy/backup-now.sh
docker compose up -d --build
echo "Жду запуска…"
for _ in $(seq 1 60); do
  if docker compose exec -T api wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo "Обновлено, всё работает."
    docker image prune -f >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 3
done
docker compose logs --tail 80 api
echo "API не поднялся. Логи выше. Откат базы при необходимости: ./deploy/restore.sh backups/<последний файл>"
exit 1

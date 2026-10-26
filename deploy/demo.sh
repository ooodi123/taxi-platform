#!/usr/bin/env bash
# Демо-режим для показа клиентам.
#   ./deploy/demo.sh on     — создать демо-таксопарк (если его нет) и включить виртуальных водителей
#   ./deploy/demo.sh off    — выключить виртуальных водителей
#   ./deploy/demo.sh bot <токен>  — подключить к демо-таксопарку отдельного Telegram-бота
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

set_env() { # ключ значение
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}

case "${1:-}" in
  on)
    docker compose exec -T api node dist/scripts/seed.js
    set_env DEMO_SIMULATOR true
    docker compose up -d api
    echo
    echo "Демо включено: водители «Демо Такси» сами выходят на линию, принимают заказы и возят."
    echo "Диспетчерская демо: https://$DOMAIN/app/dispatch/  (логин demo, пароль demo12345 — смените в «Настройках»)"
    echo "Подключите демо-бота: ./deploy/demo.sh bot <токен от @BotFather>"
    ;;
  off)
    set_env DEMO_SIMULATOR false
    docker compose up -d api
    echo "Виртуальные водители выключены."
    ;;
  bot)
    TOKEN="${2:?Укажите токен: ./deploy/demo.sh bot 123456:ABC...}"
    TID=$(curl -fsS "https://$DOMAIN/api/tenants/${DEMO_TENANT_SLUG:-demo}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
    curl -fsS -X PUT "https://$DOMAIN/api/admin/tenants/$TID/bot" \
      -H "X-Super-Admin-Key: $SUPER_ADMIN_KEY" -H "Content-Type: application/json" \
      -d "{\"botToken\": \"$TOKEN\"}" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("Бот подключён:", d["botUrl"])'
    ;;
  *)
    echo "Использование: ./deploy/demo.sh on | off | bot <токен>"; exit 1 ;;
esac

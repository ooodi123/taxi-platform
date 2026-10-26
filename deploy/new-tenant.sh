#!/usr/bin/env bash
# Подключить новый таксопарк.
#   ./deploy/new-tenant.sh "Такси Люкс" lux [токен_бота]
# Выведет логин и пароль владельца. Токен бота (из @BotFather) можно передать сразу
# или позже — владелец вставит его сам в диспетчерской, раздел «Настройки».
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Нет .env — сначала ./deploy/install.sh"; exit 1; }
set -a; . ./.env; set +a

NAME="${1:-}"; SLUG="${2:-}"; BOT="${3:-}"
if [ -z "$NAME" ] || [ -z "$SLUG" ]; then
  echo 'Использование: ./deploy/new-tenant.sh "Название таксопарка" slug [токен_бота]'
  echo 'slug — короткое имя латиницей для ссылок, например: lux, taxi-777'
  exit 1
fi
[[ "$SLUG" =~ ^[a-z0-9][a-z0-9-]{1,40}$ ]] || { echo "slug: только латиница в нижнем регистре, цифры и дефис"; exit 1; }

API="https://$DOMAIN/api"
call() { # метод путь [json]
  curl -fsS -X "$1" "$API$2" -H "X-Super-Admin-Key: $SUPER_ADMIN_KEY" -H "Content-Type: application/json" ${3:+-d "$3"}
}
json_str() { python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"; }
get() { python3 -c 'import json,sys; d=json.load(sys.stdin); print(eval("d"+sys.argv[1]))' "$1"; }

RES=$(call POST /admin/tenants "{\"name\": $(json_str "$NAME"), \"slug\": $(json_str "$SLUG")}") || {
  echo "Не удалось создать таксопарк (возможно, такой slug уже занят)."; exit 1; }
TID=$(echo "$RES" | get "['tenant']['id']")
LOGIN=$(echo "$RES" | get "['owner']['login']")
PASS=$(echo "$RES" | get "['owner']['password']")

echo
echo "Таксопарк «$NAME» создан."
echo "  Диспетчерская:  https://$DOMAIN/app/dispatch/"
echo "  Логин:          $LOGIN"
echo "  Пароль:         $PASS     (показывается один раз — передайте владельцу)"

if [ -n "$BOT" ]; then
  if B=$(call PUT "/admin/tenants/$TID/bot" "{\"botToken\": $(json_str "$BOT")}"); then
    echo "  Бот:            $(echo "$B" | get "['botUrl']")"
  else
    echo "  Бот не подключился — проверьте токен; владелец может подключить его в «Настройках»."
  fi
else
  echo "  Бот:            не подключён — владелец вставит токен в «Настройках»"
fi

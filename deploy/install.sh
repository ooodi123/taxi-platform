#!/usr/bin/env bash
# Первая установка платформы на чистый сервер Ubuntu 22.04/24.04 (или Debian 12).
# Запуск из папки проекта:  sudo ./deploy/install.sh
#
# Что делает:
#   1. ставит Docker, если его нет;
#   2. спрашивает домен и почту, генерирует пароли и ключи в .env;
#   3. открывает порты 22, 80, 443 в файрволе (если включён ufw);
#   4. собирает и запускает всё: API, базу, Redis, HTTPS (Caddy), бэкапы;
#   5. по желанию создаёт демо-таксопарк с виртуальными водителями.
set -euo pipefail
cd "$(dirname "$0")/.."

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
die()  { printf '\033[31mОшибка: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "запустите через sudo: sudo ./deploy/install.sh"
[ -f docker-compose.yml ] || die "запускайте из папки проекта taxi-platform"

# ---------- 1. Docker ----------
if ! command -v docker >/dev/null 2>&1; then
  say "Устанавливаю Docker…"
  command -v curl >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq curl; }
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || die "нет docker compose v2 — обновите Docker"

# ---------- 2. Настройки ----------
if [ -f .env ]; then
  say "Файл .env уже есть — использую его (чтобы начать заново, удалите .env)."
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
else
  say "Настройка"
  read -rp "Домен для платформы (например taxi.example.com): " DOMAIN
  [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "некорректный домен: $DOMAIN"
  read -rp "Ваша почта (для сертификата HTTPS): " ACME_EMAIL
  [[ "$ACME_EMAIL" == *@*.* ]] || die "некорректная почта: $ACME_EMAIL"

  POSTGRES_PASSWORD=$(openssl rand -hex 24)
  JWT_SECRET=$(openssl rand -hex 32)
  SUPER_ADMIN_KEY=$(openssl rand -hex 24)

  umask 077
  cat > .env <<EOF
DOMAIN=$DOMAIN
ACME_EMAIL=$ACME_EMAIL
NODE_ENV=production
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
JWT_SECRET=$JWT_SECRET
SUPER_ADMIN_KEY=$SUPER_ADMIN_KEY
DEV_AUTH=false
MIGRATE_ON_START=true
DEMO_SIMULATOR=false
DEMO_TENANT_SLUG=demo
GEOCODER_USER_AGENT="taxi-platform (contact: $ACME_EMAIL)"
OSRM_URL=
BACKUP_KEEP_DAYS=14
EOF
  umask 022
  echo ".env создан (права 600, внутри пароли — никому не отправляйте этот файл)."
fi

# ---------- Проверка DNS ----------
SERVER_IP=$(curl -fsS -4 --max-time 5 https://api.ipify.org 2>/dev/null || true)
DNS_IP=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)
if [ -n "$SERVER_IP" ] && [ "$DNS_IP" != "$SERVER_IP" ]; then
  warn "Внимание: домен $DOMAIN указывает на '${DNS_IP:-ничего}', а IP этого сервера $SERVER_IP."
  warn "Добавьте у регистратора домена запись A: $DOMAIN → $SERVER_IP. Без этого HTTPS не заработает."
  read -rp "Продолжить всё равно? [y/N] " ans
  [[ "$ans" =~ ^[YyДд]$ ]] || exit 1
fi

# ---------- 3. Файрвол ----------
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443 >/dev/null
  echo "ufw: открыты порты 22, 80, 443"
fi

# ---------- 4. Запуск ----------
mkdir -p backups
say "Собираю и запускаю (первый раз 3–5 минут)…"
docker compose up -d --build

say "Жду, пока API запустится…"
for _ in $(seq 1 60); do
  if docker compose exec -T api wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1; then ok=1; break; fi
  sleep 3
done
[ "${ok:-}" = 1 ] || { docker compose logs --tail 50 api; die "API не запустился, логи выше"; }

echo "Проверяю HTTPS (сертификат может выпускаться до минуты)…"
for _ in $(seq 1 20); do
  if curl -fsS --max-time 5 "https://$DOMAIN/api/health" >/dev/null 2>&1; then https=1; break; fi
  sleep 3
done
if [ "${https:-}" = 1 ]; then echo "HTTPS работает: https://$DOMAIN"
else warn "HTTPS пока не отвечает. Проверьте DNS и порты 80/443, затем: docker compose logs caddy"; fi

# ---------- 5. Демо ----------
read -rp $'\nСоздать демо-таксопарк с виртуальными водителями для показа клиентам? [y/N] ' demo
if [[ "$demo" =~ ^[YyДд]$ ]]; then
  ./deploy/demo.sh on
fi

say "Готово!"
cat <<EOF

  Диспетчерская:     https://$DOMAIN/app/dispatch/
  Ключ супер-админа: $SUPER_ADMIN_KEY   (хранится в .env)

  Подключить таксопарк:   ./deploy/new-tenant.sh "Название" slug
  Обновить платформу:     ./deploy/update.sh
  Бэкап прямо сейчас:     ./deploy/backup-now.sh   (автоматически — каждую ночь в ./backups)
  Логи:                   docker compose logs -f api
EOF

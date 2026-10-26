-- Таксопарки (клиенты платформы)
CREATE TABLE tenants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  slug         text NOT NULL UNIQUE,
  is_active    boolean NOT NULL DEFAULT true,
  currency     text NOT NULL DEFAULT 'RUB',
  branding     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- логотип, цвета, название в приложении
  settings     jsonb NOT NULL DEFAULT '{}'::jsonb,
  bot_token    text,                                 -- токен Telegram-бота таксопарка (этап 2)
  bot_username text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Сотрудники таксопарка: владелец и диспетчеры
CREATE TABLE staff_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  login         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name          text,
  role          text NOT NULL DEFAULT 'dispatcher' CHECK (role IN ('owner', 'dispatcher')),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Тарифы таксопарка
CREATE TABLE tariffs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code        text NOT NULL,
  name        text NOT NULL,
  base_fare   numeric(10,2) NOT NULL DEFAULT 0,   -- подача
  per_km      numeric(10,2) NOT NULL DEFAULT 0,
  per_min     numeric(10,2) NOT NULL DEFAULT 0,
  min_fare    numeric(10,2) NOT NULL DEFAULT 0,
  round_to    numeric(10,2) NOT NULL DEFAULT 1,   -- округление цены вверх до шага
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

-- Пассажиры
CREATE TABLE passengers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  telegram_id bigint,
  phone       text,
  name        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, telegram_id)
);

-- Водители
CREATE TABLE drivers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  telegram_id   bigint,
  name          text NOT NULL,
  phone         text,
  car_model     text,
  car_color     text,
  car_plate     text,
  tariff_codes  text[] NOT NULL DEFAULT '{}',   -- какие тарифы может возить (пусто = все)
  status        text NOT NULL DEFAULT 'offline' CHECK (status IN ('offline', 'online', 'busy')),
  is_active     boolean NOT NULL DEFAULT true,
  last_lat      double precision,
  last_lng      double precision,
  last_seen_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, telegram_id)
);
CREATE INDEX drivers_tenant_status ON drivers (tenant_id, status);

-- Заказы
CREATE TABLE orders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number             bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  passenger_id       uuid REFERENCES passengers(id),
  driver_id          uuid REFERENCES drivers(id),
  tariff_id          uuid NOT NULL REFERENCES tariffs(id),
  status             text NOT NULL DEFAULT 'searching'
                     CHECK (status IN ('searching', 'assigned', 'arrived', 'in_progress', 'completed', 'cancelled', 'expired')),
  source             text NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'dispatcher')),
  customer_name      text,
  customer_phone     text,
  comment            text,
  pickup_lat         double precision NOT NULL,
  pickup_lng         double precision NOT NULL,
  pickup_address     text,
  dropoff_lat        double precision,
  dropoff_lng        double precision,
  dropoff_address    text,
  distance_m         int,
  duration_s         int,
  estimated_price    numeric(10,2) NOT NULL,
  final_price        numeric(10,2),
  -- текущее предложение водителю
  offered_driver_id  uuid REFERENCES drivers(id),
  offer_expires_at   timestamptz,
  search_radius_idx  int NOT NULL DEFAULT 0,
  -- время этапов
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  assigned_at        timestamptz,
  arrived_at         timestamptz,
  started_at         timestamptz,
  completed_at       timestamptz,
  cancelled_at       timestamptz,
  cancelled_by       text,
  cancel_reason      text
);
CREATE INDEX orders_tenant_status_created ON orders (tenant_id, status, created_at DESC);
CREATE INDEX orders_searching ON orders (offer_expires_at) WHERE status = 'searching';
CREATE INDEX orders_passenger ON orders (passenger_id, created_at DESC);
CREATE INDEX orders_driver ON orders (driver_id, created_at DESC);
-- у водителя не может быть двух активных заказов
CREATE UNIQUE INDEX orders_one_active_per_driver
  ON orders (driver_id) WHERE status IN ('assigned', 'arrived', 'in_progress');
-- у пассажира не может быть двух активных заказов
CREATE UNIQUE INDEX orders_one_active_per_passenger
  ON orders (passenger_id) WHERE status IN ('searching', 'assigned', 'arrived', 'in_progress') AND passenger_id IS NOT NULL;
-- водитель не может держать два предложения одновременно
CREATE UNIQUE INDEX orders_one_offer_per_driver
  ON orders (offered_driver_id) WHERE status = 'searching' AND offered_driver_id IS NOT NULL;

-- История предложений водителям
CREATE TABLE order_offers (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id      uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  driver_id     uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  distance_m    int,
  result        text NOT NULL DEFAULT 'pending'
                CHECK (result IN ('pending', 'accepted', 'declined', 'timeout', 'cancelled', 'dropped')),
  offered_at    timestamptz NOT NULL DEFAULT now(),
  responded_at  timestamptz
);
CREATE INDEX order_offers_order ON order_offers (order_id);

-- Журнал событий заказа
CREATE TABLE order_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type        text NOT NULL,
  actor_type  text,
  actor_id    uuid,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_events_order ON order_events (order_id, id);

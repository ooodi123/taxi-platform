import 'dotenv/config';

function num(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Переменная ${name} должна быть числом, сейчас: "${raw}"`);
  return n;
}

const DEFAULT_JWT_SECRET = 'dev-secret-change-me';

/** REDIS_URL, либо отдельные REDIS_HOST / REDIS_PORT / REDIS_PASSWORD (так их дают некоторые хостинги) */
function redisUrlFromEnv(): string {
  if (process.env.REDIS_URL) return process.env.REDIS_URL;
  const host = process.env.REDIS_HOST;
  if (!host) return 'redis://localhost:6379';
  const port = process.env.REDIS_PORT || '6379';
  const user = process.env.REDIS_USER || process.env.REDIS_USERNAME || '';
  const pass = process.env.REDIS_PASSWORD || '';
  const auth = pass ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@` : '';
  return `redis://${auth}${host}:${port}`;
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: num('PORT', 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://taxi:taxi@localhost:5432/taxi',
  redisUrl: redisUrlFromEnv(),
  dbPoolMax: num('DB_POOL_MAX', 10),
  jwtSecret: process.env.JWT_SECRET || DEFAULT_JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '30d',
  superAdminKey: process.env.SUPER_ADMIN_KEY ?? '',
  devAuth: process.env.DEV_AUTH === 'true',
  migrateOnStart: process.env.MIGRATE_ON_START !== 'false',
  osrmUrl: (process.env.OSRM_URL ?? '').replace(/\/+$/, ''),
  /** Публичный адрес сервера с HTTPS, напр. https://taxi.example.com — нужен для бота и Mini App */
  publicUrl: (process.env.PUBLIC_URL ?? '').replace(/\/+$/, ''),
  /** Сколько живёт подпись Telegram (initData), секунд */
  telegramAuthMaxAgeSec: num('TELEGRAM_AUTH_MAX_AGE_SEC', 86400),
  /** Адрес Telegram Bot API (можно поменять на свой локальный bot-api сервер) */
  telegramApiUrl: (process.env.TELEGRAM_API_URL ?? 'https://api.telegram.org').replace(/\/+$/, ''),
  /** Геокодер: поиск адресов. По умолчанию публичный Nominatim (OpenStreetMap) */
  geocoderUrl: (process.env.GEOCODER_URL ?? 'https://nominatim.openstreetmap.org').replace(/\/+$/, ''),
  geocoderUserAgent: process.env.GEOCODER_USER_AGENT ?? 'taxi-platform/0.2 (contact: admin@example.com)',
  geocoderLanguage: process.env.GEOCODER_LANGUAGE ?? 'ru',
  demo: {
    /** Виртуальные водители для показа клиентам (только для демо-таксопарка!) */
    simulator: process.env.DEMO_SIMULATOR === 'true',
    tenantSlug: process.env.DEMO_TENANT_SLUG || 'demo',
    /** Создать демо-таксопарк при старте, если его нет (для хостингов без консоли) */
    seedOnStart: process.env.DEMO_SEED_ON_START === 'true',
  },
  dispatch: {
    offerTimeoutSec: num('OFFER_TIMEOUT_SEC', 15),
    searchRadiiKm: (process.env.SEARCH_RADII_KM ?? '2,5,10')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0),
    orderSearchTimeoutSec: num('ORDER_SEARCH_TIMEOUT_SEC', 300),
    driverLocationTtlSec: num('DRIVER_LOCATION_TTL_SEC', 60),
    sweepIntervalMs: num('DISPATCH_SWEEP_MS', 1000),
    /** Пауза перед повторным поиском, если машин рядом нет */
    retryDelaySec: num('DISPATCH_RETRY_SEC', 5),
    /** Сколько секунд водитель, пропустивший заказ, не получает его повторно */
    timeoutCooldownSec: num('OFFER_TIMEOUT_COOLDOWN_SEC', 60),
  },
};

export function assertProductionConfig(): void {
  if (config.env !== 'production') return;
  const problems: string[] = [];
  if (config.jwtSecret === DEFAULT_JWT_SECRET || config.jwtSecret.length < 32)
    problems.push('JWT_SECRET не задан или короче 32 символов');
  if (!config.superAdminKey || config.superAdminKey.length < 16)
    problems.push('SUPER_ADMIN_KEY не задан или короче 16 символов');
  if (config.devAuth) problems.push('DEV_AUTH=true нельзя включать в продакшене');
  if (problems.length) throw new Error('Небезопасная конфигурация:\n - ' + problems.join('\n - '));
}

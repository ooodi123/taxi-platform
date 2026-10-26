/**
 * Демо-данные: таксопарк «Демо Такси», тарифы, владелец, диспетчер и 5 водителей.
 * Запуск: npm run seed (после npm run build), в Docker: docker compose exec api node dist/scripts/seed.js
 * Повторный запуск ничего не дублирует.
 *
 * Город демо задаётся переменными (по умолчанию Москва):
 *   DEMO_CENTER="47.0105,28.8638"  DEMO_TIMEZONE=Europe/Chisinau  DEMO_CURRENCY=MDL
 */
import * as bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { config } from '../config';
import { runMigrations } from '../db/migrate';
import { createPool } from '../db/pool';

const slug = config.demo.tenantSlug;
const center = (process.env.DEMO_CENTER ?? '55.7558,37.6173').split(',').map(Number);
if (center.length !== 2 || !center.every(Number.isFinite)) throw new Error('DEMO_CENTER: укажите "широта,долгота"');
const timezone = process.env.DEMO_TIMEZONE ?? 'Europe/Moscow';
const currency = process.env.DEMO_CURRENCY ?? 'RUB';

const DEMO = {
  name: 'Демо Такси',
  owner: { login: 'demo', password: 'demo12345' },
  dispatcher: { login: 'demo-dispatcher', password: 'dispatch123' },
};

// telegram_id 1001–1005 — не настоящие аккаунты, это водители для симулятора и тестового входа
const DRIVERS: [number, string, string, string, string, string][] = [
  [1001, 'Иван Петров', '+70000000001', 'Kia Rio', 'белый', 'А001АА 77'],
  [1002, 'Сергей Смирнов', '+70000000002', 'Hyundai Solaris', 'серый', 'В002ВВ 77'],
  [1003, 'Алексей Козлов', '+70000000003', 'Toyota Camry', 'чёрный', 'С003СС 77'],
  [1004, 'Дмитрий Волков', '+70000000004', 'Skoda Octavia', 'синий', 'Е004ЕЕ 77'],
  [1005, 'Андрей Морозов', '+70000000005', 'Volkswagen Polo', 'белый', 'К005КК 77'],
];

/**
 * Создать демо-таксопарк, если его ещё нет. Возвращает true, если создан.
 * Вызывается из командной строки (npm run seed) и при старте сервера (DEMO_SEED_ON_START=true).
 */
export async function seedDemo(pool: Pool, log: (msg: string) => void = console.log): Promise<boolean> {
    const existing = await pool.query(`SELECT id FROM tenants WHERE slug = $1`, [slug]);
    if (existing.rows.length) {
      log(`Демо-таксопарк "${slug}" уже есть, пропускаю.`);
      return false;
    }
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const t = (
        await c.query(
          `INSERT INTO tenants (name, slug, currency, branding, settings) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [
            DEMO.name, slug, currency,
            JSON.stringify({ appName: DEMO.name, primaryColor: '#FFC72C' }),
            JSON.stringify({ center, timezone }),
          ],
        )
      ).rows[0];
      await c.query(
        `INSERT INTO tariffs (tenant_id, code, name, base_fare, per_km, per_min, min_fare, round_to, sort_order) VALUES
          ($1, 'econom',  'Эконом',  50, 15, 5, 150, 10, 0),
          ($1, 'comfort', 'Комфорт', 90, 22, 7, 250, 10, 1),
          ($1, 'business','Бизнес', 200, 40, 12, 600, 10, 2)`,
        [t.id],
      );
      await c.query(
        `INSERT INTO staff_users (tenant_id, login, password_hash, name, role) VALUES
          ($1, $2, $3, 'Владелец', 'owner'),
          ($1, $4, $5, 'Диспетчер', 'dispatcher')`,
        [t.id, DEMO.owner.login, await bcrypt.hash(DEMO.owner.password, 10),
          DEMO.dispatcher.login, await bcrypt.hash(DEMO.dispatcher.password, 10)],
      );
      for (const [i, [tg, name, phone, model, color, plate]] of DRIVERS.entries()) {
        await c.query(
          `INSERT INTO drivers (tenant_id, telegram_id, name, phone, car_model, car_color, car_plate, tariff_codes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          // первые двое — только эконом, третий — все тарифы, остальные — эконом и комфорт
          [t.id, tg, name, phone, model, color, plate, i < 2 ? ['econom'] : i === 2 ? [] : ['econom', 'comfort']],
        );
      }
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
    log(`Готово. Таксопарк "${DEMO.name}" (slug: ${slug}), центр карты: ${center.join(', ')}
  Владелец:  ${DEMO.owner.login} / ${DEMO.owner.password}
  Диспетчер: ${DEMO.dispatcher.login} / ${DEMO.dispatcher.password}
  Водители:  Telegram ID ${DRIVERS.map((d) => d[0]).join(', ')}
Смените пароли в диспетчерской, если демо доступно из интернета.`);
    return true;
}

async function main() {
  const pool = createPool(2);
  try {
    await runMigrations(pool);
    await seedDemo(pool);
  } finally {
    await pool.end();
  }
}

// запуск из командной строки: node dist/scripts/seed.js
if (require.main === module) {
  main().catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
}

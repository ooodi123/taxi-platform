import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

/** Папка migrations лежит в корне проекта: и для src/db, и для dist/db это ../../migrations */
export const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

/**
 * Применяет новые .sql-файлы из папки migrations по порядку имён.
 * Каждая миграция — в своей транзакции. Advisory lock защищает от одновременного
 * запуска с нескольких серверов.
 */
export async function runMigrations(pool: Pool, log: (msg: string) => void = console.log): Promise<string[]> {
  if (!existsSync(MIGRATIONS_DIR)) throw new Error(`Не найдена папка миграций: ${MIGRATIONS_DIR}`);
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock(7346001)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
    );
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (e: any) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`Миграция ${file} не применилась: ${e.message}`);
      }
      applied.push(file);
      log(`Миграция применена: ${file}`);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(7346001)').catch(() => undefined);
    client.release();
  }
  return applied;
}

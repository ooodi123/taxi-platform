"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIGRATIONS_DIR = void 0;
exports.runMigrations = runMigrations;
const fs_1 = require("fs");
const path_1 = require("path");
/** Папка migrations лежит в корне проекта: и для src/db, и для dist/db это ../../migrations */
exports.MIGRATIONS_DIR = (0, path_1.join)(__dirname, '..', '..', 'migrations');
/**
 * Применяет новые .sql-файлы из папки migrations по порядку имён.
 * Каждая миграция — в своей транзакции. Advisory lock защищает от одновременного
 * запуска с нескольких серверов.
 */
async function runMigrations(pool, log = console.log) {
    if (!(0, fs_1.existsSync)(exports.MIGRATIONS_DIR))
        throw new Error(`Не найдена папка миграций: ${exports.MIGRATIONS_DIR}`);
    const files = (0, fs_1.readdirSync)(exports.MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    const client = await pool.connect();
    const applied = [];
    try {
        await client.query('SELECT pg_advisory_lock(7346001)');
        await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
        const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
        for (const file of files) {
            if (done.has(file))
                continue;
            const sql = (0, fs_1.readFileSync)((0, path_1.join)(exports.MIGRATIONS_DIR, file), 'utf8');
            try {
                await client.query('BEGIN');
                await client.query(sql);
                await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
                await client.query('COMMIT');
            }
            catch (e) {
                await client.query('ROLLBACK').catch(() => undefined);
                throw new Error(`Миграция ${file} не применилась: ${e.message}`);
            }
            applied.push(file);
            log(`Миграция применена: ${file}`);
        }
    }
    finally {
        await client.query('SELECT pg_advisory_unlock(7346001)').catch(() => undefined);
        client.release();
    }
    return applied;
}

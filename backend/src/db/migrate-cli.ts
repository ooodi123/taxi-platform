import { runMigrations } from './migrate';
import { createPool } from './pool';

async function main() {
  const pool = createPool(2);
  try {
    const applied = await runMigrations(pool);
    console.log(applied.length ? `Готово, применено миграций: ${applied.length}` : 'База уже актуальна');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});

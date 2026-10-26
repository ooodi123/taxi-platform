"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const migrate_1 = require("./migrate");
const pool_1 = require("./pool");
async function main() {
    const pool = (0, pool_1.createPool)(2);
    try {
        const applied = await (0, migrate_1.runMigrations)(pool);
        console.log(applied.length ? `Готово, применено миграций: ${applied.length}` : 'База уже актуальна');
    }
    finally {
        await pool.end();
    }
}
main().catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
});

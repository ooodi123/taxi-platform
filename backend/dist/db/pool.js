"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPool = createPool;
exports.poolConfig = poolConfig;
const pg_1 = require("pg");
const config_1 = require("../config");
/**
 * Пул подключений к PostgreSQL.
 * Поддерживает и свою базу в Docker, и облачные (Neon, Supabase и т. п.):
 * параметр sslmode=require из строки подключения включает шифрование,
 * а channel_binding (его добавляет Neon) убирается — драйвер его не понимает.
 */
function createPool(max = config_1.config.dbPoolMax) {
    return new pg_1.Pool({ ...poolConfig(config_1.config.databaseUrl), max });
}
function poolConfig(url) {
    let connectionString = url;
    try {
        const u = new URL(url);
        u.searchParams.delete('channel_binding');
        connectionString = u.toString();
    }
    catch {
        /* не URL — отдаём как есть, драйвер сам сообщит об ошибке */
    }
    return { connectionString, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000 };
}

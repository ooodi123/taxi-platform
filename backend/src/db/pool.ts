import { Pool, PoolConfig } from 'pg';
import { config } from '../config';

/**
 * Пул подключений к PostgreSQL.
 * Поддерживает и свою базу в Docker, и облачные (Neon, Supabase и т. п.):
 * параметр sslmode=require из строки подключения включает шифрование,
 * а channel_binding (его добавляет Neon) убирается — драйвер его не понимает.
 */
export function createPool(max = config.dbPoolMax): Pool {
  return new Pool({ ...poolConfig(config.databaseUrl), max });
}

export function poolConfig(url: string): PoolConfig {
  let connectionString = url;
  try {
    const u = new URL(url);
    u.searchParams.delete('channel_binding');
    connectionString = u.toString();
  } catch {
    /* не URL — отдаём как есть, драйвер сам сообщит об ошибке */
  }
  return { connectionString, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000 };
}

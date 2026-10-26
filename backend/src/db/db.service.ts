import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow, types } from 'pg';
import { createPool } from './pool';

// numeric и bigint приходят из pg строками — переводим в числа
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

/** Что-то, через что можно выполнить запрос: пул или клиент внутри транзакции */
export type Queryable = Pick<Pool, 'query'> | PoolClient;

@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool: Pool = createPool();

  async many<T extends QueryResultRow = any>(sql: string, params: unknown[] = [], db: Queryable = this.pool): Promise<T[]> {
    const res = await db.query<T>(sql, params as any[]);
    return res.rows;
  }

  async one<T extends QueryResultRow = any>(sql: string, params: unknown[] = [], db: Queryable = this.pool): Promise<T | null> {
    const res = await db.query<T>(sql, params as any[]);
    return res.rows[0] ?? null;
  }

  /** Выполнить функцию в транзакции. При ошибке — откат. */
  async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}

/** snake_case → camelCase для строки из базы */
export function camel<T = any>(row: Record<string, any> | null | undefined): T {
  if (!row) return row as any;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = v;
  }
  return out as T;
}

/** Postgres: нарушение уникального индекса */
export function isUniqueViolation(e: any, constraint?: string): boolean {
  return e?.code === '23505' && (!constraint || e?.constraint === constraint);
}

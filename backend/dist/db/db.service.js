"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DbService = void 0;
exports.camel = camel;
exports.isUniqueViolation = isUniqueViolation;
const common_1 = require("@nestjs/common");
const pg_1 = require("pg");
const pool_1 = require("./pool");
// numeric и bigint приходят из pg строками — переводим в числа
pg_1.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
pg_1.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
let DbService = class DbService {
    pool = (0, pool_1.createPool)();
    async many(sql, params = [], db = this.pool) {
        const res = await db.query(sql, params);
        return res.rows;
    }
    async one(sql, params = [], db = this.pool) {
        const res = await db.query(sql, params);
        return res.rows[0] ?? null;
    }
    /** Выполнить функцию в транзакции. При ошибке — откат. */
    async tx(fn) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await fn(client);
            await client.query('COMMIT');
            return result;
        }
        catch (e) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw e;
        }
        finally {
            client.release();
        }
    }
    async onModuleDestroy() {
        await this.pool.end();
    }
};
exports.DbService = DbService;
exports.DbService = DbService = __decorate([
    (0, common_1.Injectable)()
], DbService);
/** snake_case → camelCase для строки из базы */
function camel(row) {
    if (!row)
        return row;
    const out = {};
    for (const [k, v] of Object.entries(row)) {
        out[k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())] = v;
    }
    return out;
}
/** Postgres: нарушение уникального индекса */
function isUniqueViolation(e, constraint) {
    return e?.code === '23505' && (!constraint || e?.constraint === constraint);
}

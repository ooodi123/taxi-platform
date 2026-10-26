"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TariffsService = void 0;
const common_1 = require("@nestjs/common");
const db_service_1 = require("../db/db.service");
let TariffsService = class TariffsService {
    db;
    constructor(db) {
        this.db = db;
    }
    async list(tenantId, onlyActive) {
        const rows = await this.db.many(`SELECT * FROM tariffs WHERE tenant_id = $1 ${onlyActive ? 'AND is_active' : ''} ORDER BY sort_order, created_at`, [tenantId]);
        return rows.map((r) => (0, db_service_1.camel)(r));
    }
    async get(tenantId, id, db) {
        const row = await this.db.one(`SELECT * FROM tariffs WHERE id = $1 AND tenant_id = $2`, [id, tenantId], db);
        if (!row)
            throw new common_1.NotFoundException('Тариф не найден');
        return (0, db_service_1.camel)(row);
    }
    async create(tenantId, input) {
        try {
            const row = await this.db.one(`INSERT INTO tariffs (tenant_id, code, name, base_fare, per_km, per_min, min_fare, round_to, is_active, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`, [
                tenantId, input.code, input.name,
                input.baseFare ?? 0, input.perKm ?? 0, input.perMin ?? 0, input.minFare ?? 0,
                input.roundTo ?? 1, input.isActive ?? true, input.sortOrder ?? 0,
            ]);
            return (0, db_service_1.camel)(row);
        }
        catch (e) {
            if ((0, db_service_1.isUniqueViolation)(e))
                throw new common_1.ConflictException('Тариф с таким кодом уже есть');
            throw e;
        }
    }
    async update(tenantId, id, p) {
        try {
            const row = await this.db.one(`UPDATE tariffs SET
           code = COALESCE($3, code), name = COALESCE($4, name),
           base_fare = COALESCE($5, base_fare), per_km = COALESCE($6, per_km), per_min = COALESCE($7, per_min),
           min_fare = COALESCE($8, min_fare), round_to = COALESCE($9, round_to),
           is_active = COALESCE($10, is_active), sort_order = COALESCE($11, sort_order)
         WHERE id = $1 AND tenant_id = $2 RETURNING *`, [
                id, tenantId, p.code ?? null, p.name ?? null, p.baseFare ?? null, p.perKm ?? null, p.perMin ?? null,
                p.minFare ?? null, p.roundTo ?? null, p.isActive ?? null, p.sortOrder ?? null,
            ]);
            if (!row)
                throw new common_1.NotFoundException('Тариф не найден');
            return (0, db_service_1.camel)(row);
        }
        catch (e) {
            if ((0, db_service_1.isUniqueViolation)(e))
                throw new common_1.ConflictException('Тариф с таким кодом уже есть');
            throw e;
        }
    }
};
exports.TariffsService = TariffsService;
exports.TariffsService = TariffsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [typeof (_a = typeof db_service_1.DbService !== "undefined" && db_service_1.DbService) === "function" ? _a : Object])
], TariffsService);

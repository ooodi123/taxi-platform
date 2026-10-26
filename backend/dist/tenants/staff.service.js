"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.StaffService = void 0;
const common_1 = require("@nestjs/common");
const bcrypt = __importStar(require("bcryptjs"));
const db_service_1 = require("../db/db.service");
/** Диспетчеры таксопарка — управляет владелец */
let StaffService = class StaffService {
    db;
    constructor(db) {
        this.db = db;
    }
    async list(tenantId) {
        const rows = await this.db.many(`SELECT id, login, name, role, is_active, created_at FROM staff_users WHERE tenant_id = $1 ORDER BY created_at`, [tenantId]);
        return rows.map(db_service_1.camel);
    }
    async create(tenantId, input) {
        try {
            const row = await this.db.one(`INSERT INTO staff_users (tenant_id, login, password_hash, name, role)
         VALUES ($1, $2, $3, $4, 'dispatcher')
         RETURNING id, login, name, role, is_active, created_at`, [tenantId, input.login, await bcrypt.hash(input.password, 10), input.name ?? null]);
            return (0, db_service_1.camel)(row);
        }
        catch (e) {
            if ((0, db_service_1.isUniqueViolation)(e))
                throw new common_1.ConflictException('Такой логин уже занят');
            throw e;
        }
    }
    async update(tenantId, id, patch) {
        const hash = patch.password ? await bcrypt.hash(patch.password, 10) : null;
        const row = await this.db.one(`UPDATE staff_users SET
         name          = COALESCE($3, name),
         password_hash = COALESCE($4, password_hash),
         is_active     = CASE WHEN role = 'owner' THEN is_active ELSE COALESCE($5, is_active) END
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, login, name, role, is_active, created_at`, [id, tenantId, patch.name ?? null, hash, patch.isActive ?? null]);
        if (!row)
            throw new common_1.NotFoundException('Сотрудник не найден');
        return (0, db_service_1.camel)(row);
    }
};
exports.StaffService = StaffService;
exports.StaffService = StaffService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [typeof (_a = typeof db_service_1.DbService !== "undefined" && db_service_1.DbService) === "function" ? _a : Object])
], StaffService);

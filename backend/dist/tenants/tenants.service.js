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
exports.TenantsService = void 0;
const common_1 = require("@nestjs/common");
const bcrypt = __importStar(require("bcryptjs"));
const crypto_1 = require("crypto");
const db_service_1 = require("../db/db.service");
/** Таксопарки — управляет супер-админ (владелец платформы) */
let TenantsService = class TenantsService {
    db;
    constructor(db) {
        this.db = db;
    }
    /** Создаёт таксопарк, базовый тариф и аккаунт владельца */
    async create(input) {
        const ownerLogin = input.ownerLogin ?? `${input.slug}-owner`;
        const ownerPassword = input.ownerPassword ?? (0, crypto_1.randomBytes)(9).toString('base64url');
        const hash = await bcrypt.hash(ownerPassword, 10);
        try {
            return await this.db.tx(async (c) => {
                const tenant = await this.db.one(`INSERT INTO tenants (name, slug, currency) VALUES ($1, $2, $3) RETURNING *`, [input.name, input.slug, input.currency ?? 'RUB'], c);
                await this.db.one(`INSERT INTO tariffs (tenant_id, code, name, base_fare, per_km, per_min, min_fare, round_to, sort_order)
           VALUES ($1, 'econom', 'Эконом', 50, 15, 5, 150, 10, 0) RETURNING id`, [tenant.id], c);
                await this.db.one(`INSERT INTO staff_users (tenant_id, login, password_hash, name, role)
           VALUES ($1, $2, $3, 'Владелец', 'owner') RETURNING id`, [tenant.id, ownerLogin, hash], c);
                return { tenant: this.view(tenant), owner: { login: ownerLogin, password: ownerPassword } };
            });
        }
        catch (e) {
            if ((0, db_service_1.isUniqueViolation)(e, 'tenants_slug_key'))
                throw new common_1.ConflictException('Такой slug уже занят');
            if ((0, db_service_1.isUniqueViolation)(e, 'staff_users_login_key'))
                throw new common_1.ConflictException('Такой логин уже занят');
            throw e;
        }
    }
    async list() {
        const rows = await this.db.many(`SELECT t.*,
              (SELECT count(*) FROM drivers d WHERE d.tenant_id = t.id) AS drivers_count,
              (SELECT count(*) FROM orders o WHERE o.tenant_id = t.id) AS orders_count
         FROM tenants t ORDER BY t.created_at DESC`);
        return rows.map((r) => this.view(r));
    }
    async update(id, patch) {
        const t = await this.db.one(`UPDATE tenants SET
         name      = COALESCE($2, name),
         is_active = COALESCE($3, is_active),
         currency  = COALESCE($4, currency),
         branding  = COALESCE($5, branding),
         settings  = COALESCE($6, settings)
       WHERE id = $1 RETURNING *`, [id, patch.name ?? null, patch.isActive ?? null, patch.currency ?? null, patch.branding ? JSON.stringify(patch.branding) : null,
            patch.settings ? JSON.stringify(patch.settings) : null,
        ]);
        if (!t)
            throw new common_1.NotFoundException('Таксопарк не найден');
        return this.view(t);
    }
    async getOwn(tenantId) {
        const t = await this.db.one(`SELECT * FROM tenants WHERE id = $1`, [tenantId]);
        if (!t)
            throw new common_1.NotFoundException('Таксопарк не найден');
        return this.view(t);
    }
    /** Владелец меняет своё: название, брендинг, центр карты, часовой пояс */
    async updateOwn(tenantId, p) {
        const branding = {};
        if (p.appName !== undefined)
            branding.appName = p.appName;
        if (p.primaryColor !== undefined)
            branding.primaryColor = p.primaryColor;
        const settings = {};
        if (p.center !== undefined)
            settings.center = p.center;
        if (p.timezone !== undefined)
            settings.timezone = p.timezone;
        // jsonb || jsonb — дописываем ключи, не стирая остальные
        const t = await this.db.one(`UPDATE tenants SET name = COALESCE($2, name), branding = branding || $3::jsonb, settings = settings || $4::jsonb
        WHERE id = $1 RETURNING *`, [tenantId, p.name ?? null, JSON.stringify(branding), JSON.stringify(settings)]);
        if (!t)
            throw new common_1.NotFoundException('Таксопарк не найден');
        return this.view(t);
    }
    /** Публичная информация о таксопарке (название, брендинг) — для приложения пассажира */
    async publicInfo(slug) {
        const t = await this.db.one(`SELECT id, name, slug, currency, branding, settings->'center' AS center FROM tenants WHERE slug = $1 AND is_active`, [slug]);
        if (!t)
            throw new common_1.NotFoundException('Таксопарк не найден');
        return (0, db_service_1.camel)(t);
    }
    view(row) {
        const { botToken, webhookSecret, ...rest } = (0, db_service_1.camel)(row);
        return { ...rest, hasBot: !!botToken };
    }
};
exports.TenantsService = TenantsService;
exports.TenantsService = TenantsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [typeof (_a = typeof db_service_1.DbService !== "undefined" && db_service_1.DbService) === "function" ? _a : Object])
], TenantsService);

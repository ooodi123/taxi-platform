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
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const bcrypt = __importStar(require("bcryptjs"));
const config_1 = require("../config");
const db_service_1 = require("../db/db.service");
const init_data_1 = require("../telegram/init-data");
let AuthService = class AuthService {
    db;
    jwt;
    constructor(db, jwt) {
        this.db = db;
        this.jwt = jwt;
    }
    sign(user) {
        return this.jwt.sign({ sub: user.sub, role: user.role, tid: user.tid });
    }
    /** Вход владельца или диспетчера таксопарка */
    async staffLogin(login, password) {
        const row = await this.db.one(`SELECT s.*, t.is_active AS tenant_active, t.name AS tenant_name
         FROM staff_users s JOIN tenants t ON t.id = s.tenant_id
        WHERE lower(s.login) = lower($1)`, [login]);
        // одинаковое сообщение, чтобы не подсказывать, существует ли логин
        if (!row || !(await bcrypt.compare(password, row.password_hash))) {
            throw new common_1.UnauthorizedException('Неверный логин или пароль');
        }
        if (!row.is_active || !row.tenant_active)
            throw new common_1.ForbiddenException('Доступ отключён');
        const user = { sub: row.id, role: row.role, tid: row.tenant_id };
        return {
            token: this.sign(user),
            user: { id: row.id, login: row.login, name: row.name, role: row.role },
            tenant: { id: row.tenant_id, name: row.tenant_name },
        };
    }
    /**
     * Тестовый вход пассажира или водителя без Telegram (только при DEV_AUTH=true).
     * На этапе 2 появится настоящий вход через Telegram initData.
     */
    async devToken(input) {
        if (!config_1.config.devAuth)
            throw new common_1.NotFoundException();
        const tenant = await this.activeTenantBySlug(input.tenantSlug);
        if (input.role === 'passenger') {
            const p = await this.db.one(`INSERT INTO passengers (tenant_id, telegram_id, name) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, telegram_id) DO UPDATE SET name = COALESCE(EXCLUDED.name, passengers.name)
         RETURNING *`, [tenant.id, input.telegramId, input.name ?? null]);
            return { token: this.sign({ sub: p.id, role: 'passenger', tid: tenant.id }), passenger: (0, db_service_1.camel)(p) };
        }
        const d = await this.db.one(`SELECT * FROM drivers WHERE tenant_id = $1 AND telegram_id = $2`, [tenant.id, input.telegramId]);
        if (!d)
            throw new common_1.NotFoundException('Водитель с таким Telegram ID не найден в этом таксопарке');
        if (!d.is_active)
            throw new common_1.ForbiddenException('Водитель отключён');
        return { token: this.sign({ sub: d.id, role: 'driver', tid: tenant.id }), driver: (0, db_service_1.camel)(d) };
    }
    /**
     * Вход из Telegram Mini App. initData подписан ботом таксопарка — проверяем подпись
     * его токеном, затем находим (или создаём) пассажира / находим водителя по Telegram ID.
     */
    async telegramLogin(input) {
        const tenant = await this.activeTenantBySlug(input.tenantSlug);
        if (!tenant.bot_token)
            throw new common_1.ForbiddenException('У таксопарка не подключён Telegram-бот');
        let data;
        try {
            data = (0, init_data_1.verifyInitData)(input.initData, tenant.bot_token, config_1.config.telegramAuthMaxAgeSec);
        }
        catch (e) {
            if (e instanceof init_data_1.InitDataError)
                throw new common_1.UnauthorizedException(e.message);
            throw e;
        }
        const u = data.user;
        const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || null;
        if (input.role === 'passenger') {
            const p = await this.db.one(`INSERT INTO passengers (tenant_id, telegram_id, name, username, language_code) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, telegram_id) DO UPDATE
           SET name = COALESCE(passengers.name, EXCLUDED.name),
               username = EXCLUDED.username, language_code = EXCLUDED.language_code
         RETURNING *`, [tenant.id, u.id, name, u.username ?? null, u.language_code ?? null]);
            return { token: this.sign({ sub: p.id, role: 'passenger', tid: tenant.id }), passenger: (0, db_service_1.camel)(p) };
        }
        const d = await this.db.one(`SELECT * FROM drivers WHERE tenant_id = $1 AND telegram_id = $2`, [tenant.id, u.id]);
        if (!d)
            throw new common_1.ForbiddenException(`Вы не зарегистрированы как водитель. Ваш Telegram ID: ${u.id} — сообщите его диспетчеру.`);
        if (!d.is_active)
            throw new common_1.ForbiddenException('Водитель отключён');
        return { token: this.sign({ sub: d.id, role: 'driver', tid: tenant.id }), driver: (0, db_service_1.camel)(d) };
    }
    /** Имя и телефон пассажир может поправить сам */
    async updatePassenger(user, patch) {
        const p = await this.db.one(`UPDATE passengers SET name = COALESCE($3, name), phone = COALESCE($4, phone)
        WHERE id = $1 AND tenant_id = $2 RETURNING *`, [user.sub, user.tid, patch.name ?? null, patch.phone ?? null]);
        if (!p)
            throw new common_1.NotFoundException('Пассажир не найден');
        return (0, db_service_1.camel)(p);
    }
    async activeTenantBySlug(slug) {
        const t = await this.db.one(`SELECT * FROM tenants WHERE slug = $1`, [slug]);
        if (!t)
            throw new common_1.NotFoundException('Таксопарк не найден');
        if (!t.is_active)
            throw new common_1.ForbiddenException('Таксопарк отключён');
        return t;
    }
    async me(user) {
        switch (user.role) {
            case 'superadmin':
                return { role: 'superadmin' };
            case 'owner':
            case 'dispatcher': {
                const s = await this.db.one(`SELECT id, login, name, role FROM staff_users WHERE id = $1`, [user.sub]);
                const t = await this.db.one(`SELECT id, name, slug, currency, branding, settings, bot_username FROM tenants WHERE id = $1`, [user.tid]);
                return { role: user.role, tenantId: user.tid, user: (0, db_service_1.camel)(s), tenant: (0, db_service_1.camel)(t) };
            }
            case 'driver': {
                const d = await this.db.one(`SELECT * FROM drivers WHERE id = $1 AND tenant_id = $2`, [user.sub, user.tid]);
                return { role: 'driver', tenantId: user.tid, driver: (0, db_service_1.camel)(d) };
            }
            case 'passenger': {
                const p = await this.db.one(`SELECT * FROM passengers WHERE id = $1 AND tenant_id = $2`, [user.sub, user.tid]);
                return { role: 'passenger', tenantId: user.tid, passenger: (0, db_service_1.camel)(p) };
            }
        }
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [typeof (_a = typeof db_service_1.DbService !== "undefined" && db_service_1.DbService) === "function" ? _a : Object, typeof (_b = typeof jwt_1.JwtService !== "undefined" && jwt_1.JwtService) === "function" ? _b : Object])
], AuthService);

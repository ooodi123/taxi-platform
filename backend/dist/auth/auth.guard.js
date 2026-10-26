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
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthGuard = void 0;
exports.safeEqual = safeEqual;
exports.verifyToken = verifyToken;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const jwt_1 = require("@nestjs/jwt");
const crypto_1 = require("crypto");
const config_1 = require("../config");
const auth_types_1 = require("./auth.types");
function safeEqual(a, b) {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && (0, crypto_1.timingSafeEqual)(ab, bb);
}
/**
 * Глобальная защита HTTP-маршрутов.
 * Токен: заголовок `Authorization: Bearer <jwt>`.
 * Супер-админ: заголовок `X-Super-Admin-Key: <SUPER_ADMIN_KEY>`.
 */
let AuthGuard = class AuthGuard {
    reflector;
    jwt;
    constructor(reflector, jwt) {
        this.reflector = reflector;
        this.jwt = jwt;
    }
    canActivate(ctx) {
        if (ctx.getType() !== 'http')
            return true; // сокеты проверяются в RealtimeGateway
        const targets = [ctx.getHandler(), ctx.getClass()];
        if (this.reflector.getAllAndOverride(auth_types_1.IS_PUBLIC_KEY, targets))
            return true;
        const req = ctx.switchToHttp().getRequest();
        req.user = this.resolveUser(req);
        if (!req.user)
            throw new common_1.UnauthorizedException('Нужна авторизация');
        const roles = this.reflector.getAllAndOverride(auth_types_1.ROLES_KEY, targets);
        if (roles?.length && !roles.includes(req.user.role))
            throw new common_1.ForbiddenException('Недостаточно прав');
        return true;
    }
    resolveUser(req) {
        const superKey = req.headers['x-super-admin-key'];
        if (typeof superKey === 'string' && config_1.config.superAdminKey) {
            if (!safeEqual(superKey, config_1.config.superAdminKey))
                throw new common_1.UnauthorizedException('Неверный ключ супер-админа');
            return { sub: 'superadmin', role: 'superadmin', tid: '' };
        }
        const header = req.headers['authorization'];
        if (!header?.startsWith('Bearer '))
            return null;
        return verifyToken(this.jwt, header.slice(7));
    }
};
exports.AuthGuard = AuthGuard;
exports.AuthGuard = AuthGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [typeof (_a = typeof core_1.Reflector !== "undefined" && core_1.Reflector) === "function" ? _a : Object, typeof (_b = typeof jwt_1.JwtService !== "undefined" && jwt_1.JwtService) === "function" ? _b : Object])
], AuthGuard);
function verifyToken(jwt, token) {
    try {
        const p = jwt.verify(token);
        return { sub: p.sub, role: p.role, tid: p.tid };
    }
    catch {
        throw new common_1.UnauthorizedException('Токен недействителен или истёк');
    }
}

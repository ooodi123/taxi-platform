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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var _a, _b, _c;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const auth_service_1 = require("./auth.service");
const auth_types_1 = require("./auth.types");
class StaffLoginDto {
    login;
    password;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], StaffLoginDto.prototype, "login", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], StaffLoginDto.prototype, "password", void 0);
class DevTokenDto {
    tenantSlug;
    role;
    telegramId;
    name;
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], DevTokenDto.prototype, "tenantSlug", void 0);
__decorate([
    (0, class_validator_1.IsIn)(['passenger', 'driver']),
    __metadata("design:type", String)
], DevTokenDto.prototype, "role", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], DevTokenDto.prototype, "telegramId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], DevTokenDto.prototype, "name", void 0);
class TelegramLoginDto {
    tenantSlug;
    initData;
    role;
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], TelegramLoginDto.prototype, "tenantSlug", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(10),
    (0, class_validator_1.MaxLength)(4096),
    __metadata("design:type", String)
], TelegramLoginDto.prototype, "initData", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['passenger', 'driver']),
    __metadata("design:type", String)
], TelegramLoginDto.prototype, "role", void 0);
class UpdateProfileDto {
    name;
    phone;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], UpdateProfileDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Matches)(/^\+?[0-9 ()-]{6,20}$/, { message: 'Некорректный телефон' }),
    __metadata("design:type", String)
], UpdateProfileDto.prototype, "phone", void 0);
let AuthController = class AuthController {
    auth;
    constructor(auth) {
        this.auth = auth;
    }
    /** Вход владельца/диспетчера таксопарка */
    login(dto) {
        return this.auth.staffLogin(dto.login, dto.password);
    }
    /** Тестовый вход пассажира/водителя (DEV_AUTH=true) */
    devToken(dto) {
        return this.auth.devToken(dto);
    }
    /** Вход из Telegram Mini App (пассажир или водитель) */
    telegram(dto) {
        return this.auth.telegramLogin({ ...dto, role: dto.role ?? 'passenger' });
    }
    me(user) {
        return this.auth.me(user);
    }
    /** Пассажир указывает имя и телефон (телефон увидит водитель) */
    updateMe(user, dto) {
        return this.auth.updatePassenger(user, dto);
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, auth_types_1.Public)(),
    (0, common_1.Post)('login'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [StaffLoginDto]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "login", null);
__decorate([
    (0, auth_types_1.Public)(),
    (0, common_1.Post)('dev/token'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [DevTokenDto]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "devToken", null);
__decorate([
    (0, auth_types_1.Public)(),
    (0, common_1.Post)('telegram'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [TelegramLoginDto]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "telegram", null);
__decorate([
    (0, common_1.Get)('me'),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_b = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _b : Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "me", null);
__decorate([
    (0, common_1.Patch)('me'),
    (0, auth_types_1.Roles)('passenger'),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_c = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _c : Object, UpdateProfileDto]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "updateMe", null);
exports.AuthController = AuthController = __decorate([
    (0, common_1.Controller)('auth'),
    __metadata("design:paramtypes", [typeof (_a = typeof auth_service_1.AuthService !== "undefined" && auth_service_1.AuthService) === "function" ? _a : Object])
], AuthController);

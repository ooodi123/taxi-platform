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
var _a, _b, _c, _d, _e, _f;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminBotController = exports.OwnerBotController = exports.TelegramWebhookController = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const auth_types_1 = require("../auth/auth.types");
const telegram_service_1 = require("./telegram.service");
class ConnectBotDto {
    botToken;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(20),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], ConnectBotDto.prototype, "botToken", void 0);
/** Сюда Telegram присылает сообщения ботам таксопарков */
let TelegramWebhookController = class TelegramWebhookController {
    telegram;
    constructor(telegram) {
        this.telegram = telegram;
    }
    webhook(tenantId, secret, update) {
        return this.telegram.handleUpdate(tenantId, secret, update);
    }
};
exports.TelegramWebhookController = TelegramWebhookController;
__decorate([
    (0, auth_types_1.Public)(),
    (0, common_1.Post)('webhook/:tenantId'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Param)('tenantId', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Headers)('x-telegram-bot-api-secret-token')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", void 0)
], TelegramWebhookController.prototype, "webhook", null);
exports.TelegramWebhookController = TelegramWebhookController = __decorate([
    (0, common_1.Controller)('telegram'),
    __metadata("design:paramtypes", [typeof (_a = typeof telegram_service_1.TelegramService !== "undefined" && telegram_service_1.TelegramService) === "function" ? _a : Object])
], TelegramWebhookController);
/** Владелец таксопарка подключает своего бота */
let OwnerBotController = class OwnerBotController {
    telegram;
    constructor(telegram) {
        this.telegram = telegram;
    }
    status(u) {
        return this.telegram.botStatus(u.tid);
    }
    connect(u, dto) {
        return this.telegram.connectBot(u.tid, dto.botToken.trim());
    }
    disconnect(u) {
        return this.telegram.disconnectBot(u.tid);
    }
};
exports.OwnerBotController = OwnerBotController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_c = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _c : Object]),
    __metadata("design:returntype", void 0)
], OwnerBotController.prototype, "status", null);
__decorate([
    (0, common_1.Put)(),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_d = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _d : Object, ConnectBotDto]),
    __metadata("design:returntype", void 0)
], OwnerBotController.prototype, "connect", null);
__decorate([
    (0, common_1.Delete)(),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_e = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _e : Object]),
    __metadata("design:returntype", void 0)
], OwnerBotController.prototype, "disconnect", null);
exports.OwnerBotController = OwnerBotController = __decorate([
    (0, common_1.Controller)('bot'),
    (0, auth_types_1.Roles)('owner'),
    __metadata("design:paramtypes", [typeof (_b = typeof telegram_service_1.TelegramService !== "undefined" && telegram_service_1.TelegramService) === "function" ? _b : Object])
], OwnerBotController);
/** Супер-админ подключает бота любому таксопарку */
let AdminBotController = class AdminBotController {
    telegram;
    constructor(telegram) {
        this.telegram = telegram;
    }
    status(id) {
        return this.telegram.botStatus(id);
    }
    connect(id, dto) {
        return this.telegram.connectBot(id, dto.botToken.trim());
    }
    disconnect(id) {
        return this.telegram.disconnectBot(id);
    }
};
exports.AdminBotController = AdminBotController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminBotController.prototype, "status", null);
__decorate([
    (0, common_1.Put)(),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, ConnectBotDto]),
    __metadata("design:returntype", void 0)
], AdminBotController.prototype, "connect", null);
__decorate([
    (0, common_1.Delete)(),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminBotController.prototype, "disconnect", null);
exports.AdminBotController = AdminBotController = __decorate([
    (0, common_1.Controller)('admin/tenants/:id/bot'),
    (0, auth_types_1.Roles)('superadmin'),
    __metadata("design:paramtypes", [typeof (_f = typeof telegram_service_1.TelegramService !== "undefined" && telegram_service_1.TelegramService) === "function" ? _f : Object])
], AdminBotController);

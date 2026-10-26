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
var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
Object.defineProperty(exports, "__esModule", { value: true });
exports.StaffController = exports.OwnerTenantController = exports.PublicTenantsController = exports.AdminTenantsController = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const auth_types_1 = require("../auth/auth.types");
const staff_service_1 = require("./staff.service");
const tenants_service_1 = require("./tenants.service");
class CreateTenantDto {
    name;
    slug;
    currency;
    ownerLogin;
    ownerPassword;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(2),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateTenantDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.Matches)(/^[a-z0-9][a-z0-9-]{1,40}$/, { message: 'slug: латиница в нижнем регистре, цифры и дефис' }),
    __metadata("design:type", String)
], CreateTenantDto.prototype, "slug", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Length)(3, 3),
    __metadata("design:type", String)
], CreateTenantDto.prototype, "currency", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(3),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateTenantDto.prototype, "ownerLogin", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(8),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], CreateTenantDto.prototype, "ownerPassword", void 0);
class UpdateTenantDto {
    name;
    isActive;
    currency;
    /** { appName, primaryColor: '#FFC72C' } */
    branding;
    /** { center: [lat, lng] } — где открывать карту по умолчанию */
    settings;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(2),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], UpdateTenantDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateTenantDto.prototype, "isActive", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Length)(3, 3),
    __metadata("design:type", String)
], UpdateTenantDto.prototype, "currency", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsObject)(),
    __metadata("design:type", typeof (_a = typeof Record !== "undefined" && Record) === "function" ? _a : Object)
], UpdateTenantDto.prototype, "branding", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsObject)(),
    __metadata("design:type", typeof (_b = typeof Record !== "undefined" && Record) === "function" ? _b : Object)
], UpdateTenantDto.prototype, "settings", void 0);
class CreateStaffDto {
    login;
    password;
    name;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(3),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateStaffDto.prototype, "login", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(8),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], CreateStaffDto.prototype, "password", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateStaffDto.prototype, "name", void 0);
class UpdateStaffDto {
    name;
    password;
    isActive;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], UpdateStaffDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(8),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], UpdateStaffDto.prototype, "password", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateStaffDto.prototype, "isActive", void 0);
/** Супер-админка: таксопарки платформы */
let AdminTenantsController = class AdminTenantsController {
    tenants;
    constructor(tenants) {
        this.tenants = tenants;
    }
    create(dto) {
        return this.tenants.create(dto);
    }
    list() {
        return this.tenants.list();
    }
    update(id, dto) {
        return this.tenants.update(id, dto);
    }
};
exports.AdminTenantsController = AdminTenantsController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [CreateTenantDto]),
    __metadata("design:returntype", void 0)
], AdminTenantsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminTenantsController.prototype, "list", null);
__decorate([
    (0, common_1.Patch)(':id'),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, UpdateTenantDto]),
    __metadata("design:returntype", void 0)
], AdminTenantsController.prototype, "update", null);
exports.AdminTenantsController = AdminTenantsController = __decorate([
    (0, common_1.Controller)('admin/tenants'),
    (0, auth_types_1.Roles)('superadmin'),
    __metadata("design:paramtypes", [typeof (_c = typeof tenants_service_1.TenantsService !== "undefined" && tenants_service_1.TenantsService) === "function" ? _c : Object])
], AdminTenantsController);
/** Публичная карточка таксопарка для приложения пассажира */
let PublicTenantsController = class PublicTenantsController {
    tenants;
    constructor(tenants) {
        this.tenants = tenants;
    }
    info(slug) {
        return this.tenants.publicInfo(slug);
    }
};
exports.PublicTenantsController = PublicTenantsController;
__decorate([
    (0, auth_types_1.Public)(),
    (0, common_1.Get)(':slug'),
    __param(0, (0, common_1.Param)('slug')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], PublicTenantsController.prototype, "info", null);
exports.PublicTenantsController = PublicTenantsController = __decorate([
    (0, common_1.Controller)('tenants'),
    __metadata("design:paramtypes", [typeof (_d = typeof tenants_service_1.TenantsService !== "undefined" && tenants_service_1.TenantsService) === "function" ? _d : Object])
], PublicTenantsController);
const TIMEZONES = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [];
class OwnerTenantDto {
    name;
    appName;
    primaryColor;
    center;
    timezone;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(2),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], OwnerTenantDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(60),
    __metadata("design:type", String)
], OwnerTenantDto.prototype, "appName", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Matches)(/^#[0-9a-fA-F]{6}$/, { message: 'Цвет в формате #RRGGBB' }),
    __metadata("design:type", String)
], OwnerTenantDto.prototype, "primaryColor", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMinSize)(2),
    (0, class_validator_1.ArrayMaxSize)(2),
    (0, class_validator_1.IsNumber)({}, { each: true }),
    __metadata("design:type", Array)
], OwnerTenantDto.prototype, "center", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], OwnerTenantDto.prototype, "timezone", void 0);
/** Свой таксопарк: владелец меняет название, цвет, центр карты, часовой пояс */
let OwnerTenantController = class OwnerTenantController {
    tenants;
    constructor(tenants) {
        this.tenants = tenants;
    }
    get(u) {
        return this.tenants.getOwn(u.tid);
    }
    update(u, dto) {
        if (dto.timezone && TIMEZONES.length && !TIMEZONES.includes(dto.timezone)) {
            throw new common_1.BadRequestException('Неизвестный часовой пояс, пример: Europe/Moscow');
        }
        if (dto.center && (Math.abs(dto.center[0]) > 90 || Math.abs(dto.center[1]) > 180)) {
            throw new common_1.BadRequestException('Некорректные координаты центра');
        }
        return this.tenants.updateOwn(u.tid, dto);
    }
};
exports.OwnerTenantController = OwnerTenantController;
__decorate([
    (0, common_1.Get)(),
    (0, auth_types_1.Roles)('owner', 'dispatcher'),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_f = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _f : Object]),
    __metadata("design:returntype", void 0)
], OwnerTenantController.prototype, "get", null);
__decorate([
    (0, common_1.Patch)(),
    (0, auth_types_1.Roles)('owner'),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_g = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _g : Object, OwnerTenantDto]),
    __metadata("design:returntype", void 0)
], OwnerTenantController.prototype, "update", null);
exports.OwnerTenantController = OwnerTenantController = __decorate([
    (0, common_1.Controller)('tenant'),
    __metadata("design:paramtypes", [typeof (_e = typeof tenants_service_1.TenantsService !== "undefined" && tenants_service_1.TenantsService) === "function" ? _e : Object])
], OwnerTenantController);
/** Диспетчеры — управляет владелец таксопарка */
let StaffController = class StaffController {
    staff;
    constructor(staff) {
        this.staff = staff;
    }
    list(u) {
        return this.staff.list(u.tid);
    }
    create(u, dto) {
        return this.staff.create(u.tid, dto);
    }
    update(u, id, dto) {
        return this.staff.update(u.tid, id, dto);
    }
};
exports.StaffController = StaffController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_j = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _j : Object]),
    __metadata("design:returntype", void 0)
], StaffController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_k = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _k : Object, CreateStaffDto]),
    __metadata("design:returntype", void 0)
], StaffController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':id'),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_l = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _l : Object, String, UpdateStaffDto]),
    __metadata("design:returntype", void 0)
], StaffController.prototype, "update", null);
exports.StaffController = StaffController = __decorate([
    (0, common_1.Controller)('staff'),
    (0, auth_types_1.Roles)('owner'),
    __metadata("design:paramtypes", [typeof (_h = typeof staff_service_1.StaffService !== "undefined" && staff_service_1.StaffService) === "function" ? _h : Object])
], StaffController);

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
exports.DriverSelfController = exports.DriversController = exports.LocationDto = void 0;
const common_1 = require("@nestjs/common");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const auth_types_1 = require("../auth/auth.types");
const drivers_service_1 = require("./drivers.service");
class DriverFieldsDto {
    phone;
    telegramId;
    carModel;
    carColor;
    carPlate;
    tariffCodes;
    isActive;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(30),
    __metadata("design:type", String)
], DriverFieldsDto.prototype, "phone", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], DriverFieldsDto.prototype, "telegramId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(60),
    __metadata("design:type", String)
], DriverFieldsDto.prototype, "carModel", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(30),
    __metadata("design:type", String)
], DriverFieldsDto.prototype, "carColor", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(20),
    __metadata("design:type", String)
], DriverFieldsDto.prototype, "carPlate", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(20),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], DriverFieldsDto.prototype, "tariffCodes", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], DriverFieldsDto.prototype, "isActive", void 0);
class CreateDriverDto extends DriverFieldsDto {
    name;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateDriverDto.prototype, "name", void 0);
class UpdateDriverDto extends DriverFieldsDto {
    name;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], UpdateDriverDto.prototype, "name", void 0);
class LocationDto {
    lat;
    lng;
}
exports.LocationDto = LocationDto;
__decorate([
    (0, class_validator_1.IsLatitude)(),
    __metadata("design:type", Number)
], LocationDto.prototype, "lat", void 0);
__decorate([
    (0, class_validator_1.IsLongitude)(),
    __metadata("design:type", Number)
], LocationDto.prototype, "lng", void 0);
class StartShiftDto {
    location;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateNested)(),
    (0, class_transformer_1.Type)(() => LocationDto),
    __metadata("design:type", LocationDto)
], StartShiftDto.prototype, "location", void 0);
class ListQuery {
    status;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['offline', 'online', 'busy']),
    __metadata("design:type", String)
], ListQuery.prototype, "status", void 0);
/** Водители — управление (владелец, диспетчер) */
let DriversController = class DriversController {
    drivers;
    constructor(drivers) {
        this.drivers = drivers;
    }
    list(u, q) {
        return this.drivers.list(u.tid, q.status);
    }
    live(u) {
        return this.drivers.live(u.tid);
    }
    create(u, dto) {
        return this.drivers.create(u.tid, dto);
    }
    update(u, id, dto) {
        return this.drivers.update(u.tid, id, dto);
    }
};
exports.DriversController = DriversController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_b = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _b : Object, ListQuery]),
    __metadata("design:returntype", void 0)
], DriversController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('live'),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_c = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _c : Object]),
    __metadata("design:returntype", void 0)
], DriversController.prototype, "live", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_d = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _d : Object, CreateDriverDto]),
    __metadata("design:returntype", void 0)
], DriversController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':id'),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_e = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _e : Object, String, UpdateDriverDto]),
    __metadata("design:returntype", void 0)
], DriversController.prototype, "update", null);
exports.DriversController = DriversController = __decorate([
    (0, common_1.Controller)('drivers'),
    (0, auth_types_1.Roles)('owner', 'dispatcher'),
    __metadata("design:paramtypes", [typeof (_a = typeof drivers_service_1.DriversService !== "undefined" && drivers_service_1.DriversService) === "function" ? _a : Object])
], DriversController);
/** Действия водителя в своём приложении */
let DriverSelfController = class DriverSelfController {
    drivers;
    constructor(drivers) {
        this.drivers = drivers;
    }
    me(u) {
        return this.drivers.me(u.tid, u.sub);
    }
    /** Поездки и выручка за сегодня */
    stats(u) {
        return this.drivers.stats(u.tid, u.sub);
    }
    startShift(u, dto) {
        return this.drivers.startShift(u.tid, u.sub, dto.location);
    }
    endShift(u) {
        return this.drivers.endShift(u.tid, u.sub);
    }
    location(u, dto) {
        return this.drivers.updateLocation(u.tid, u.sub, dto.lat, dto.lng);
    }
};
exports.DriverSelfController = DriverSelfController;
__decorate([
    (0, common_1.Get)('me'),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_g = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _g : Object]),
    __metadata("design:returntype", void 0)
], DriverSelfController.prototype, "me", null);
__decorate([
    (0, common_1.Get)('stats'),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_h = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _h : Object]),
    __metadata("design:returntype", void 0)
], DriverSelfController.prototype, "stats", null);
__decorate([
    (0, common_1.Post)('shift/start'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_j = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _j : Object, StartShiftDto]),
    __metadata("design:returntype", void 0)
], DriverSelfController.prototype, "startShift", null);
__decorate([
    (0, common_1.Post)('shift/end'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_k = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _k : Object]),
    __metadata("design:returntype", void 0)
], DriverSelfController.prototype, "endShift", null);
__decorate([
    (0, common_1.Post)('location'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_l = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _l : Object, LocationDto]),
    __metadata("design:returntype", void 0)
], DriverSelfController.prototype, "location", null);
exports.DriverSelfController = DriverSelfController = __decorate([
    (0, common_1.Controller)('driver'),
    (0, auth_types_1.Roles)('driver'),
    __metadata("design:paramtypes", [typeof (_f = typeof drivers_service_1.DriversService !== "undefined" && drivers_service_1.DriversService) === "function" ? _f : Object])
], DriverSelfController);

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
var _a, _b, _c, _d;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TariffsController = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const auth_types_1 = require("../auth/auth.types");
const tariffs_service_1 = require("./tariffs.service");
const money = { maxDecimalPlaces: 2 };
class TariffFieldsDto {
    baseFare;
    perKm;
    perMin;
    minFare;
    roundTo;
    isActive;
    sortOrder;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(money),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(1_000_000),
    __metadata("design:type", Number)
], TariffFieldsDto.prototype, "baseFare", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(money),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(1_000_000),
    __metadata("design:type", Number)
], TariffFieldsDto.prototype, "perKm", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(money),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(1_000_000),
    __metadata("design:type", Number)
], TariffFieldsDto.prototype, "perMin", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(money),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(1_000_000),
    __metadata("design:type", Number)
], TariffFieldsDto.prototype, "minFare", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsNumber)(money),
    (0, class_validator_1.Min)(0.01),
    (0, class_validator_1.Max)(10_000),
    __metadata("design:type", Number)
], TariffFieldsDto.prototype, "roundTo", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], TariffFieldsDto.prototype, "isActive", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    __metadata("design:type", Number)
], TariffFieldsDto.prototype, "sortOrder", void 0);
class CreateTariffDto extends TariffFieldsDto {
    code;
    name;
}
__decorate([
    (0, class_validator_1.Matches)(/^[a-z0-9_-]{2,30}$/, { message: 'code: латиница, цифры, _ и -' }),
    __metadata("design:type", String)
], CreateTariffDto.prototype, "code", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(60),
    __metadata("design:type", String)
], CreateTariffDto.prototype, "name", void 0);
class UpdateTariffDto extends TariffFieldsDto {
    code;
    name;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Matches)(/^[a-z0-9_-]{2,30}$/),
    __metadata("design:type", String)
], UpdateTariffDto.prototype, "code", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(1),
    (0, class_validator_1.MaxLength)(60),
    __metadata("design:type", String)
], UpdateTariffDto.prototype, "name", void 0);
let TariffsController = class TariffsController {
    tariffs;
    constructor(tariffs) {
        this.tariffs = tariffs;
    }
    /** Пассажиры и водители видят только активные тарифы, сотрудники — все */
    list(u) {
        return this.tariffs.list(u.tid, u.role === 'driver' || u.role === 'passenger');
    }
    create(u, dto) {
        return this.tariffs.create(u.tid, dto);
    }
    update(u, id, dto) {
        return this.tariffs.update(u.tid, id, dto);
    }
};
exports.TariffsController = TariffsController;
__decorate([
    (0, common_1.Get)(),
    (0, auth_types_1.Roles)('owner', 'dispatcher', 'driver', 'passenger'),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_b = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _b : Object]),
    __metadata("design:returntype", void 0)
], TariffsController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    (0, auth_types_1.Roles)('owner'),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_c = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _c : Object, CreateTariffDto]),
    __metadata("design:returntype", void 0)
], TariffsController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, auth_types_1.Roles)('owner'),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_d = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _d : Object, String, UpdateTariffDto]),
    __metadata("design:returntype", void 0)
], TariffsController.prototype, "update", null);
exports.TariffsController = TariffsController = __decorate([
    (0, common_1.Controller)('tariffs'),
    __metadata("design:paramtypes", [typeof (_a = typeof tariffs_service_1.TariffsService !== "undefined" && tariffs_service_1.TariffsService) === "function" ? _a : Object])
], TariffsController);

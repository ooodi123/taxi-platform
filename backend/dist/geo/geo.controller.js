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
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeoModule = exports.GeoController = void 0;
const common_1 = require("@nestjs/common");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const auth_types_1 = require("../auth/auth.types");
const geo_service_1 = require("./geo.service");
class SearchQuery {
    q;
    lat;
    lng;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], SearchQuery.prototype, "q", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsLatitude)(),
    __metadata("design:type", Number)
], SearchQuery.prototype, "lat", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsLongitude)(),
    __metadata("design:type", Number)
], SearchQuery.prototype, "lng", void 0);
class ReverseQuery {
    lat;
    lng;
}
__decorate([
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsLatitude)(),
    __metadata("design:type", Number)
], ReverseQuery.prototype, "lat", void 0);
__decorate([
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsLongitude)(),
    __metadata("design:type", Number)
], ReverseQuery.prototype, "lng", void 0);
let GeoController = class GeoController {
    geo;
    constructor(geo) {
        this.geo = geo;
    }
    /** Поиск адреса по тексту: /api/geo/search?q=Тверская 7&lat=..&lng=.. */
    search(q) {
        const near = q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : undefined;
        return this.geo.search(q.q, near);
    }
    /** Адрес по точке на карте */
    reverse(q) {
        return this.geo.reverse(q.lat, q.lng);
    }
};
exports.GeoController = GeoController;
__decorate([
    (0, common_1.Get)('search'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [SearchQuery]),
    __metadata("design:returntype", void 0)
], GeoController.prototype, "search", null);
__decorate([
    (0, common_1.Get)('reverse'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [ReverseQuery]),
    __metadata("design:returntype", void 0)
], GeoController.prototype, "reverse", null);
exports.GeoController = GeoController = __decorate([
    (0, common_1.Controller)('geo'),
    (0, auth_types_1.Roles)('passenger', 'driver', 'owner', 'dispatcher'),
    __metadata("design:paramtypes", [typeof (_a = typeof geo_service_1.GeoService !== "undefined" && geo_service_1.GeoService) === "function" ? _a : Object])
], GeoController);
let GeoModule = class GeoModule {
};
exports.GeoModule = GeoModule;
exports.GeoModule = GeoModule = __decorate([
    (0, common_1.Module)({
        controllers: [GeoController],
        providers: [geo_service_1.GeoService],
    })
], GeoModule);

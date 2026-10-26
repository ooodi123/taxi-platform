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
var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrdersController = void 0;
const common_1 = require("@nestjs/common");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const auth_types_1 = require("../auth/auth.types");
const order_status_1 = require("./order-status");
const orders_service_1 = require("./orders.service");
class PlaceDto {
    lat;
    lng;
    address;
}
__decorate([
    (0, class_validator_1.IsLatitude)(),
    __metadata("design:type", Number)
], PlaceDto.prototype, "lat", void 0);
__decorate([
    (0, class_validator_1.IsLongitude)(),
    __metadata("design:type", Number)
], PlaceDto.prototype, "lng", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], PlaceDto.prototype, "address", void 0);
class EstimateDto {
    pickup;
    dropoff;
}
__decorate([
    (0, class_validator_1.ValidateNested)(),
    (0, class_transformer_1.Type)(() => PlaceDto),
    __metadata("design:type", PlaceDto)
], EstimateDto.prototype, "pickup", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateNested)(),
    (0, class_transformer_1.Type)(() => PlaceDto),
    __metadata("design:type", PlaceDto)
], EstimateDto.prototype, "dropoff", void 0);
class CreateOrderDto extends EstimateDto {
    tariffId;
    comment;
    /** Для заказов, принятых диспетчером по телефону */
    customerName;
    customerPhone;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], CreateOrderDto.prototype, "tariffId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], CreateOrderDto.prototype, "comment", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(100),
    __metadata("design:type", String)
], CreateOrderDto.prototype, "customerName", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(30),
    __metadata("design:type", String)
], CreateOrderDto.prototype, "customerPhone", void 0);
class CancelDto {
    reason;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(300),
    __metadata("design:type", String)
], CancelDto.prototype, "reason", void 0);
class AssignDto {
    driverId;
}
__decorate([
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], AssignDto.prototype, "driverId", void 0);
class ListQuery {
    status;
    scope;
    limit;
    offset;
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['searching', 'assigned', 'arrived', 'in_progress', 'completed', 'cancelled', 'expired']),
    __metadata("design:type", typeof (_a = typeof order_status_1.OrderStatus !== "undefined" && order_status_1.OrderStatus) === "function" ? _a : Object)
], ListQuery.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['active', 'today']),
    __metadata("design:type", String)
], ListQuery.prototype, "scope", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(200),
    __metadata("design:type", Number)
], ListQuery.prototype, "limit", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], ListQuery.prototype, "offset", void 0);
const ALL = ['owner', 'dispatcher', 'driver', 'passenger'];
let OrdersController = class OrdersController {
    orders;
    constructor(orders) {
        this.orders = orders;
    }
    /** Цена по всем тарифам до заказа */
    estimate(u, dto) {
        return this.orders.estimate(u.tid, dto.pickup, dto.dropoff);
    }
    create(u, dto) {
        return this.orders.create(u, dto);
    }
    list(u, q) {
        return this.orders.list(u, q);
    }
    /** Активный заказ пассажира / заказ или предложение водителя */
    current(u) {
        return this.orders.current(u);
    }
    get(u, id) {
        return this.orders.getForUser(u, id);
    }
    /** История событий заказа — для диспетчера */
    events(u, id) {
        return this.orders.events(u, id);
    }
    cancel(u, id, dto) {
        return this.orders.cancel(u, id, dto.reason);
    }
    assign(u, id, dto) {
        return this.orders.assign(u, id, dto.driverId);
    }
    // ----- водитель -----
    accept(u, id) {
        return this.orders.accept(u, id);
    }
    decline(u, id) {
        return this.orders.decline(u, id);
    }
    arrived(u, id) {
        return this.orders.arrived(u, id);
    }
    start(u, id) {
        return this.orders.start(u, id);
    }
    complete(u, id) {
        return this.orders.complete(u, id);
    }
};
exports.OrdersController = OrdersController;
__decorate([
    (0, common_1.Post)('estimate'),
    (0, common_1.HttpCode)(200),
    (0, auth_types_1.Roles)('passenger', 'owner', 'dispatcher'),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_c = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _c : Object, EstimateDto]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "estimate", null);
__decorate([
    (0, common_1.Post)(),
    (0, auth_types_1.Roles)('passenger', 'owner', 'dispatcher'),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_d = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _d : Object, CreateOrderDto]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, auth_types_1.Roles)(...ALL),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_e = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _e : Object, ListQuery]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('current'),
    (0, auth_types_1.Roles)('passenger', 'driver'),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_f = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _f : Object]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "current", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, auth_types_1.Roles)(...ALL),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_g = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _g : Object, String]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "get", null);
__decorate([
    (0, common_1.Get)(':id/events'),
    (0, auth_types_1.Roles)('owner', 'dispatcher'),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_h = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _h : Object, String]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "events", null);
__decorate([
    (0, common_1.Post)(':id/cancel'),
    (0, common_1.HttpCode)(200),
    (0, auth_types_1.Roles)(...ALL),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_j = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _j : Object, String, CancelDto]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "cancel", null);
__decorate([
    (0, common_1.Post)(':id/assign'),
    (0, common_1.HttpCode)(200),
    (0, auth_types_1.Roles)('owner', 'dispatcher'),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_k = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _k : Object, String, AssignDto]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "assign", null);
__decorate([
    (0, common_1.Post)(':id/accept'),
    (0, common_1.HttpCode)(200),
    (0, auth_types_1.Roles)('driver'),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_l = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _l : Object, String]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "accept", null);
__decorate([
    (0, common_1.Post)(':id/decline'),
    (0, common_1.HttpCode)(200),
    (0, auth_types_1.Roles)('driver'),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_m = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _m : Object, String]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "decline", null);
__decorate([
    (0, common_1.Post)(':id/arrived'),
    (0, common_1.HttpCode)(200),
    (0, auth_types_1.Roles)('driver'),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_o = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _o : Object, String]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "arrived", null);
__decorate([
    (0, common_1.Post)(':id/start'),
    (0, common_1.HttpCode)(200),
    (0, auth_types_1.Roles)('driver'),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_p = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _p : Object, String]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "start", null);
__decorate([
    (0, common_1.Post)(':id/complete'),
    (0, common_1.HttpCode)(200),
    (0, auth_types_1.Roles)('driver'),
    __param(0, (0, auth_types_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_q = typeof auth_types_1.AuthUser !== "undefined" && auth_types_1.AuthUser) === "function" ? _q : Object, String]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "complete", null);
exports.OrdersController = OrdersController = __decorate([
    (0, common_1.Controller)('orders'),
    __metadata("design:paramtypes", [typeof (_b = typeof orders_service_1.OrdersService !== "undefined" && orders_service_1.OrdersService) === "function" ? _b : Object])
], OrdersController);

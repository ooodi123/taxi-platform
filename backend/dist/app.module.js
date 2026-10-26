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
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const auth_module_1 = require("./auth/auth.module");
const auth_types_1 = require("./auth/auth.types");
const db_module_1 = require("./db/db.module");
const db_service_1 = require("./db/db.service");
const redis_service_1 = require("./db/redis.service");
const drivers_module_1 = require("./drivers/drivers.module");
const orders_module_1 = require("./orders/orders.module");
const realtime_module_1 = require("./realtime/realtime.module");
const tariffs_module_1 = require("./tariffs/tariffs.module");
const tenants_module_1 = require("./tenants/tenants.module");
const telegram_module_1 = require("./telegram/telegram.module");
const geo_controller_1 = require("./geo/geo.controller");
const demo_service_1 = require("./demo/demo.service");
let HealthController = class HealthController {
    db;
    redis;
    constructor(db, redis) {
        this.db = db;
        this.redis = redis;
    }
    async health() {
        await this.db.one('SELECT 1');
        await this.redis.ping();
        return { ok: true, time: new Date().toISOString() };
    }
};
__decorate([
    (0, auth_types_1.Public)(),
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], HealthController.prototype, "health", null);
HealthController = __decorate([
    (0, common_1.Controller)('health'),
    __metadata("design:paramtypes", [typeof (_a = typeof db_service_1.DbService !== "undefined" && db_service_1.DbService) === "function" ? _a : Object, typeof (_b = typeof redis_service_1.RedisService !== "undefined" && redis_service_1.RedisService) === "function" ? _b : Object])
], HealthController);
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [db_module_1.DbModule, realtime_module_1.RealtimeModule, telegram_module_1.TelegramModule, auth_module_1.AuthModule, geo_controller_1.GeoModule, tenants_module_1.TenantsModule, tariffs_module_1.TariffsModule, drivers_module_1.DriversModule, orders_module_1.OrdersModule, demo_service_1.DemoModule],
        controllers: [HealthController],
    })
], AppModule);

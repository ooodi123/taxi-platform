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
var _a, _b, _c;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DemoModule = exports.DemoService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("../config");
const db_service_1 = require("../db/db.service");
const drivers_module_1 = require("../drivers/drivers.module");
const drivers_service_1 = require("../drivers/drivers.service");
const orders_module_1 = require("../orders/orders.module");
const orders_service_1 = require("../orders/orders.service");
const pricing_1 = require("../pricing/pricing");
const movement_1 = require("./movement");
const TICK_MS = 3000;
const ACCEPT_AFTER_TICKS = 1; // «подумать» перед принятием
const WAIT_AT_PICKUP_TICKS = 2; // пассажир садится
const IDLE_WANDER_M = 40;
const SPAWN_RADIUS_M = 2500;
/**
 * Демо-режим для показа клиентам (DEMO_SIMULATOR=true).
 *
 * Все водители таксопарка DEMO_TENANT_SLUG становятся виртуальными: сами выходят
 * на линию, катаются рядом с центром карты, принимают предложенные заказы, едут
 * к пассажиру, ждут посадку, везут и завершают поездку. Это настоящие заказы
 * в настоящей системе — пассажир в Telegram и диспетчер видят всё вживую.
 *
 * На реальном таксопарке не включать: водители этого таксопарка управляются симулятором.
 */
let DemoService = class DemoService {
    db;
    drivers;
    orders;
    log = new common_1.Logger('Demo');
    timer = null;
    running = false;
    sims = new Map();
    constructor(db, drivers, orders) {
        this.db = db;
        this.drivers = drivers;
        this.orders = orders;
    }
    onModuleInit() {
        if (!config_1.config.demo.simulator)
            return;
        this.log.warn(`Демо-режим: водители таксопарка «${config_1.config.demo.tenantSlug}» управляются симулятором`);
        this.timer = setInterval(() => void this.tick(), TICK_MS);
    }
    onModuleDestroy() {
        if (this.timer)
            clearInterval(this.timer);
    }
    async tick() {
        if (this.running)
            return;
        this.running = true;
        try {
            const tenant = await this.db.one(`SELECT id, settings FROM tenants WHERE slug = $1 AND is_active`, [config_1.config.demo.tenantSlug]);
            if (!tenant)
                return;
            const center = toLatLng(tenant.settings?.center) ?? { lat: 55.7558, lng: 37.6173 };
            const list = await this.db.many(`SELECT d.id, d.status, d.last_lat, d.last_lng,
                a.id AS order_id, a.status AS order_status,
                a.pickup_lat, a.pickup_lng, a.dropoff_lat, a.dropoff_lng,
                f.id AS offer_order_id
           FROM drivers d
           LEFT JOIN orders a ON a.driver_id = d.id AND a.status IN ('assigned', 'arrived', 'in_progress')
           LEFT JOIN orders f ON f.offered_driver_id = d.id AND f.status = 'searching' AND f.offer_expires_at > now()
          WHERE d.tenant_id = $1 AND d.is_active`, [tenant.id]);
            for (const d of list) {
                try {
                    await this.stepDriver(tenant.id, center, d);
                }
                catch (e) {
                    this.log.debug(`Водитель ${d.id}: ${e.message}`);
                }
            }
        }
        catch (e) {
            this.log.warn(`Ошибка симулятора: ${e.message}`);
        }
        finally {
            this.running = false;
        }
    }
    async stepDriver(tenantId, center, d) {
        const user = { sub: d.id, role: 'driver', tid: tenantId };
        let sim = this.sims.get(d.id);
        if (!sim) {
            sim = { pos: d.last_lat !== null ? { lat: d.last_lat, lng: d.last_lng } : null, offerSeenTicks: 0, waitTicks: 0 };
            this.sims.set(d.id, sim);
        }
        // далеко от города (например, центр карты поменяли) — переносим ближе
        if (!sim.pos || (0, pricing_1.haversineM)(sim.pos.lat, sim.pos.lng, center.lat, center.lng) > SPAWN_RADIUS_M * 4) {
            sim.pos = (0, movement_1.randomNear)(center, SPAWN_RADIUS_M);
        }
        if (d.status === 'offline') {
            await this.drivers.startShift(tenantId, d.id, sim.pos);
            return;
        }
        // 1. Есть предложение — принимаем после небольшой паузы
        if (d.offer_order_id && !d.order_id) {
            sim.offerSeenTicks++;
            if (sim.offerSeenTicks > ACCEPT_AFTER_TICKS) {
                sim.offerSeenTicks = 0;
                await this.orders.accept(user, d.offer_order_id);
            }
            await this.drivers.updateLocation(tenantId, d.id, sim.pos.lat, sim.pos.lng);
            return;
        }
        sim.offerSeenTicks = 0;
        // 2. Везём заказ
        if (d.order_id) {
            const pickup = { lat: d.pickup_lat, lng: d.pickup_lng };
            if (d.order_status === 'assigned') {
                const m = (0, movement_1.moveToward)(sim.pos, pickup, (0, movement_1.demoStepM)((0, pricing_1.haversineM)(sim.pos.lat, sim.pos.lng, pickup.lat, pickup.lng)));
                sim.pos = m.pos;
                await this.drivers.updateLocation(tenantId, d.id, sim.pos.lat, sim.pos.lng);
                if (m.arrived) {
                    sim.waitTicks = 0;
                    await this.orders.arrived(user, d.order_id);
                }
            }
            else if (d.order_status === 'arrived') {
                sim.waitTicks++;
                if (sim.waitTicks >= WAIT_AT_PICKUP_TICKS)
                    await this.orders.start(user, d.order_id);
            }
            else if (d.order_status === 'in_progress') {
                // без точки назначения — короткая поездка в случайную сторону
                const target = d.dropoff_lat !== null ? { lat: d.dropoff_lat, lng: d.dropoff_lng } : (0, movement_1.randomNear)(pickup, 1500);
                const m = (0, movement_1.moveToward)(sim.pos, target, (0, movement_1.demoStepM)((0, pricing_1.haversineM)(sim.pos.lat, sim.pos.lng, target.lat, target.lng)));
                sim.pos = m.pos;
                await this.drivers.updateLocation(tenantId, d.id, sim.pos.lat, sim.pos.lng);
                if (m.arrived || d.dropoff_lat === null)
                    await this.orders.complete(user, d.order_id);
            }
            return;
        }
        // 3. Свободен — немного катается, не уезжая далеко от центра
        const wander = (0, pricing_1.haversineM)(sim.pos.lat, sim.pos.lng, center.lat, center.lng) > SPAWN_RADIUS_M
            ? (0, movement_1.moveToward)(sim.pos, center, IDLE_WANDER_M * 3).pos
            : (0, movement_1.randomNear)(sim.pos, IDLE_WANDER_M);
        sim.pos = wander;
        await this.drivers.updateLocation(tenantId, d.id, sim.pos.lat, sim.pos.lng);
    }
};
exports.DemoService = DemoService;
exports.DemoService = DemoService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [typeof (_a = typeof db_service_1.DbService !== "undefined" && db_service_1.DbService) === "function" ? _a : Object, typeof (_b = typeof drivers_service_1.DriversService !== "undefined" && drivers_service_1.DriversService) === "function" ? _b : Object, typeof (_c = typeof orders_service_1.OrdersService !== "undefined" && orders_service_1.OrdersService) === "function" ? _c : Object])
], DemoService);
function toLatLng(v) {
    return Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number') ? { lat: v[0], lng: v[1] } : null;
}
let DemoModule = class DemoModule {
};
exports.DemoModule = DemoModule;
exports.DemoModule = DemoModule = __decorate([
    (0, common_1.Module)({
        imports: [drivers_module_1.DriversModule, orders_module_1.OrdersModule],
        providers: [DemoService],
    })
], DemoModule);

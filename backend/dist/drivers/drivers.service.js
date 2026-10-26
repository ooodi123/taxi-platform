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
exports.DriversService = void 0;
const common_1 = require("@nestjs/common");
const db_service_1 = require("../db/db.service");
const redis_service_1 = require("../db/redis.service");
const realtime_service_1 = require("../realtime/realtime.service");
const ACTIVE_ORDER = `status IN ('assigned', 'arrived', 'in_progress')`;
let DriversService = class DriversService {
    db;
    redis;
    realtime;
    constructor(db, redis, realtime) {
        this.db = db;
        this.redis = redis;
        this.realtime = realtime;
    }
    // ---------- Управление водителями (владелец / диспетчер) ----------
    async list(tenantId, status) {
        const rows = await this.db.many(`SELECT * FROM drivers WHERE tenant_id = $1 AND ($2::text IS NULL OR status = $2) ORDER BY name`, [tenantId, status ?? null]);
        return rows.map(db_service_1.camel);
    }
    /** Водители на линии с последними координатами — для карты диспетчера */
    async live(tenantId) {
        const rows = await this.db.many(`SELECT d.id, d.name, d.car_model, d.car_color, d.car_plate, d.status, d.last_lat, d.last_lng, d.last_seen_at,
              o.id AS order_id, o.status AS order_status
         FROM drivers d
         LEFT JOIN orders o ON o.driver_id = d.id AND o.${ACTIVE_ORDER}
        WHERE d.tenant_id = $1 AND d.status <> 'offline'
        ORDER BY d.name`, [tenantId]);
        return rows.map(db_service_1.camel);
    }
    async create(tenantId, input) {
        try {
            const row = await this.db.one(`INSERT INTO drivers (tenant_id, name, phone, telegram_id, car_model, car_color, car_plate, tariff_codes, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`, [
                tenantId, input.name, input.phone ?? null, input.telegramId ?? null, input.carModel ?? null,
                input.carColor ?? null, input.carPlate ?? null, input.tariffCodes ?? [], input.isActive ?? true,
            ]);
            return (0, db_service_1.camel)(row);
        }
        catch (e) {
            if ((0, db_service_1.isUniqueViolation)(e))
                throw new common_1.ConflictException('Водитель с таким Telegram ID уже есть');
            throw e;
        }
    }
    async update(tenantId, id, p) {
        let row;
        try {
            row = await this.db.one(`UPDATE drivers SET
           name = COALESCE($3, name), phone = COALESCE($4, phone),
           telegram_id = CASE WHEN $5::boolean THEN $6::bigint ELSE telegram_id END,
           car_model = COALESCE($7, car_model), car_color = COALESCE($8, car_color), car_plate = COALESCE($9, car_plate),
           tariff_codes = COALESCE($10, tariff_codes), is_active = COALESCE($11, is_active)
         WHERE id = $1 AND tenant_id = $2 RETURNING *`, [
                id, tenantId, p.name ?? null, p.phone ?? null, p.telegramId !== undefined, p.telegramId ?? null,
                p.carModel ?? null, p.carColor ?? null, p.carPlate ?? null, p.tariffCodes ?? null, p.isActive ?? null,
            ]);
        }
        catch (e) {
            if ((0, db_service_1.isUniqueViolation)(e))
                throw new common_1.ConflictException('Водитель с таким Telegram ID уже есть');
            throw e;
        }
        if (!row)
            throw new common_1.NotFoundException('Водитель не найден');
        // отключённого водителя снимаем с линии (если он не везёт пассажира)
        if (p.isActive === false && row.status === 'online')
            await this.goOffline(tenantId, id);
        return (0, db_service_1.camel)(await this.getRow(tenantId, id));
    }
    // ---------- Действия самого водителя ----------
    async me(tenantId, driverId) {
        return (0, db_service_1.camel)(await this.getRow(tenantId, driverId));
    }
    /**
     * Итоги смены за сегодня: поездки и выручка.
     * «Сегодня» — по часовому поясу таксопарка (settings.timezone, по умолчанию Europe/Moscow).
     */
    async stats(tenantId, driverId) {
        const row = await this.db.one(`WITH tz AS (SELECT COALESCE(settings->>'timezone', 'Europe/Moscow') AS name FROM tenants WHERE id = $1)
       SELECT count(*) FILTER (WHERE o.status = 'completed')                         AS trips,
              COALESCE(sum(o.final_price) FILTER (WHERE o.status = 'completed'), 0)  AS earned,
              COALESCE(sum(o.distance_m) FILTER (WHERE o.status = 'completed'), 0)   AS distance_m
         FROM orders o, tz
        WHERE o.tenant_id = $1 AND o.driver_id = $2
          AND o.completed_at >= (date_trunc('day', now() AT TIME ZONE tz.name) AT TIME ZONE tz.name)`, [tenantId, driverId]);
        return { today: { trips: row?.trips ?? 0, earned: row?.earned ?? 0, distanceM: row?.distance_m ?? 0 } };
    }
    /** Выйти на линию. Координаты можно передать сразу. */
    async startShift(tenantId, driverId, loc) {
        const d = await this.getRow(tenantId, driverId);
        if (!d.is_active)
            throw new common_1.ForbiddenException('Водитель отключён');
        if (d.status === 'offline') {
            await this.db.one(`UPDATE drivers SET status = 'online' WHERE id = $1 AND status = 'offline' RETURNING id`, [driverId]);
        }
        if (loc)
            await this.updateLocation(tenantId, driverId, loc.lat, loc.lng);
        else if (d.last_lat !== null && d.last_seen_at) {
            // свежие координаты уже есть — сразу добавляем в поиск
            await this.redis.setDriverLocation(tenantId, driverId, d.last_lat, d.last_lng);
        }
        const updated = await this.getRow(tenantId, driverId);
        this.emitStatus(updated);
        return (0, db_service_1.camel)(updated);
    }
    /** Уйти с линии. Нельзя, пока везёшь заказ. */
    async endShift(tenantId, driverId) {
        const active = await this.db.one(`SELECT id FROM orders WHERE driver_id = $1 AND ${ACTIVE_ORDER}`, [driverId]);
        if (active)
            throw new common_1.ConflictException('Сначала завершите текущий заказ');
        await this.goOffline(tenantId, driverId);
        return (0, db_service_1.camel)(await this.getRow(tenantId, driverId));
    }
    async goOffline(tenantId, driverId) {
        await this.db.tx(async (c) => {
            // если водителю сейчас предложен заказ — снимаем предложение, заказ уйдёт следующему
            const offered = await this.db.many(`UPDATE orders SET offered_driver_id = NULL, offer_expires_at = NULL, updated_at = now()
          WHERE offered_driver_id = $1 AND status = 'searching' RETURNING id`, [driverId], c);
            for (const o of offered) {
                await this.db.many(`UPDATE order_offers SET result = 'dropped', responded_at = now()
            WHERE order_id = $1 AND driver_id = $2 AND result = 'pending'`, [o.id, driverId], c);
            }
            await this.db.one(`UPDATE drivers SET status = 'offline' WHERE id = $1 AND status = 'online' RETURNING id`, [driverId], c);
        });
        await this.redis.removeDriver(tenantId, driverId);
        this.emitStatus(await this.getRow(tenantId, driverId));
    }
    /** Водитель присылает координаты (каждые 3–10 секунд, пока на линии) */
    async updateLocation(tenantId, driverId, lat, lng) {
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
            throw new common_1.BadRequestException('Некорректные координаты');
        }
        const d = await this.db.one(`UPDATE drivers SET last_lat = $3, last_lng = $4, last_seen_at = now()
        WHERE id = $1 AND tenant_id = $2 RETURNING id, status`, [driverId, tenantId, lat, lng]);
        if (!d)
            throw new common_1.NotFoundException('Водитель не найден');
        if (d.status !== 'offline')
            await this.redis.setDriverLocation(tenantId, driverId, lat, lng);
        this.realtime.toDispatch(tenantId, 'driver:location', { driverId, lat, lng, status: d.status });
        // пассажир видит, как едет его машина
        const order = await this.db.one(`SELECT id, passenger_id FROM orders WHERE driver_id = $1 AND ${ACTIVE_ORDER}`, [driverId]);
        if (order?.passenger_id) {
            this.realtime.toPassenger(order.passenger_id, 'driver:location', { orderId: order.id, lat, lng });
        }
        return { ok: true, status: d.status };
    }
    async getRow(tenantId, driverId) {
        const d = await this.db.one(`SELECT * FROM drivers WHERE id = $1 AND tenant_id = $2`, [driverId, tenantId]);
        if (!d)
            throw new common_1.NotFoundException('Водитель не найден');
        return d;
    }
    emitStatus(d) {
        this.realtime.toDispatch(d.tenant_id, 'driver:status', { driverId: d.id, status: d.status });
        this.realtime.toDriver(d.id, 'driver:status', { status: d.status });
    }
};
exports.DriversService = DriversService;
exports.DriversService = DriversService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [typeof (_a = typeof db_service_1.DbService !== "undefined" && db_service_1.DbService) === "function" ? _a : Object, typeof (_b = typeof redis_service_1.RedisService !== "undefined" && redis_service_1.RedisService) === "function" ? _b : Object, typeof (_c = typeof realtime_service_1.RealtimeService !== "undefined" && realtime_service_1.RealtimeService) === "function" ? _c : Object])
], DriversService);

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
exports.OrderViewService = void 0;
exports.forRole = forRole;
const common_1 = require("@nestjs/common");
const telegram_service_1 = require("../telegram/telegram.service");
const db_service_1 = require("../db/db.service");
const realtime_service_1 = require("../realtime/realtime.service");
const order_status_1 = require("./order-status");
const VIEW_SQL = `
  SELECT o.*, t.code AS t_code, t.name AS t_name, tn.currency,
         d.name AS d_name, d.phone AS d_phone, d.car_model, d.car_color, d.car_plate, d.last_lat AS d_lat, d.last_lng AS d_lng,
         p.name AS p_name, p.phone AS p_phone
    FROM orders o
    JOIN tariffs t  ON t.id = o.tariff_id
    JOIN tenants tn ON tn.id = o.tenant_id
    LEFT JOIN drivers d    ON d.id = o.driver_id
    LEFT JOIN passengers p ON p.id = o.passenger_id`;
/** Сборка «карточки заказа» и рассылка обновлений всем участникам */
let OrderViewService = class OrderViewService {
    db;
    realtime;
    telegram;
    log = new common_1.Logger('OrderView');
    constructor(db, realtime, telegram) {
        this.db = db;
        this.realtime = realtime;
        this.telegram = telegram;
    }
    async get(tenantId, orderId, db) {
        const row = await this.db.one(`${VIEW_SQL} WHERE o.id = $1 AND o.tenant_id = $2`, [orderId, tenantId], db);
        if (!row)
            throw new common_1.NotFoundException('Заказ не найден');
        return toView(row);
    }
    async list(where, params, limit, offset) {
        const rows = await this.db.many(`${VIEW_SQL} WHERE ${where} ORDER BY o.created_at DESC LIMIT ${Math.trunc(limit)} OFFSET ${Math.trunc(offset)}`, params);
        return rows.map(toView);
    }
    /** Отправить свежую карточку заказа диспетчерам, пассажиру и водителю */
    async notify(tenantId, orderId) {
        const v = await this.get(tenantId, orderId);
        this.realtime.toDispatch(tenantId, 'order:updated', v);
        if (v.passenger.id)
            this.realtime.toPassenger(v.passenger.id, 'order:updated', forRole(v, 'passenger'));
        if (v.driver)
            this.realtime.toDriver(v.driver.id, 'order:updated', forRole(v, 'driver', v.driver.id));
        // сообщение в Telegram — в фоне, чтобы не задерживать ответ API
        this.telegram.onOrderUpdated(v).catch((e) => this.log.warn(`Telegram-уведомление: ${e.message}`));
        return v;
    }
    async addEvent(db, orderId, type, actor, payload = {}) {
        await this.db.many(`INSERT INTO order_events (order_id, type, actor_type, actor_id, payload) VALUES ($1, $2, $3, $4, $5)`, [
            orderId, type, actor?.role ?? 'system',
            actor && actor.role !== 'superadmin' ? actor.sub : null,
            JSON.stringify(payload),
        ], db);
    }
    async events(tenantId, orderId) {
        await this.get(tenantId, orderId); // проверка доступа к таксопарку
        return this.db.many(`SELECT type, actor_type AS "actorType", actor_id AS "actorId", payload, created_at AS "createdAt"
         FROM order_events WHERE order_id = $1 ORDER BY id`, [orderId]);
    }
};
exports.OrderViewService = OrderViewService;
exports.OrderViewService = OrderViewService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [typeof (_a = typeof db_service_1.DbService !== "undefined" && db_service_1.DbService) === "function" ? _a : Object, typeof (_b = typeof realtime_service_1.RealtimeService !== "undefined" && realtime_service_1.RealtimeService) === "function" ? _b : Object, typeof (_c = typeof telegram_service_1.TelegramService !== "undefined" && telegram_service_1.TelegramService) === "function" ? _c : Object])
], OrderViewService);
function toView(r) {
    return {
        id: r.id,
        number: r.number,
        tenantId: r.tenant_id,
        status: r.status,
        statusLabel: order_status_1.STATUS_LABELS[r.status],
        source: r.source,
        tariff: { id: r.tariff_id, code: r.t_code, name: r.t_name },
        pickup: { lat: r.pickup_lat, lng: r.pickup_lng, address: r.pickup_address },
        dropoff: r.dropoff_lat === null ? null : { lat: r.dropoff_lat, lng: r.dropoff_lng, address: r.dropoff_address },
        distanceM: r.distance_m,
        durationS: r.duration_s,
        estimatedPrice: r.estimated_price,
        finalPrice: r.final_price,
        currency: r.currency,
        comment: r.comment,
        passenger: { id: r.passenger_id, name: r.p_name ?? r.customer_name, phone: r.p_phone ?? r.customer_phone },
        driver: r.driver_id
            ? {
                id: r.driver_id,
                name: r.d_name,
                phone: r.d_phone,
                car: { model: r.car_model, color: r.car_color, plate: r.car_plate },
                location: r.d_lat === null ? null : { lat: r.d_lat, lng: r.d_lng },
            }
            : null,
        offer: r.offered_driver_id ? { driverId: r.offered_driver_id, expiresAt: iso(r.offer_expires_at) } : null,
        createdAt: iso(r.created_at),
        assignedAt: iso(r.assigned_at),
        arrivedAt: iso(r.arrived_at),
        startedAt: iso(r.started_at),
        completedAt: iso(r.completed_at),
        cancelledAt: iso(r.cancelled_at),
        cancelledBy: r.cancelled_by,
        cancelReason: r.cancel_reason,
    };
}
function iso(d) {
    return d ? new Date(d).toISOString() : null;
}
/**
 * Что видит конкретная роль.
 * Пассажир не видит, кому сейчас предлагается заказ.
 * Водитель видит телефон пассажира только после того, как взял заказ.
 */
function forRole(v, role, driverId) {
    if (role === 'passenger') {
        const { offer, ...rest } = v;
        return rest;
    }
    if (role === 'driver') {
        const mine = !!v.driver && v.driver.id === driverId;
        return {
            ...v,
            offer: null,
            passenger: { id: null, name: v.passenger.name, phone: mine ? v.passenger.phone : null },
        };
    }
    return v;
}

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
var _a, _b, _c, _d, _e, _f, _g;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrdersService = void 0;
const common_1 = require("@nestjs/common");
const auth_types_1 = require("../auth/auth.types");
const db_service_1 = require("../db/db.service");
const pricing_1 = require("../pricing/pricing");
const routing_service_1 = require("../pricing/routing.service");
const realtime_service_1 = require("../realtime/realtime.service");
const tariffs_service_1 = require("../tariffs/tariffs.service");
const telegram_service_1 = require("../telegram/telegram.service");
const dispatch_service_1 = require("./dispatch.service");
const order_status_1 = require("./order-status");
const order_view_service_1 = require("./order-view.service");
let OrdersService = class OrdersService {
    db;
    tariffs;
    routing;
    dispatch;
    views;
    realtime;
    telegram;
    log = new common_1.Logger('Orders');
    constructor(db, tariffs, routing, dispatch, views, realtime, telegram) {
        this.db = db;
        this.tariffs = tariffs;
        this.routing = routing;
        this.dispatch = dispatch;
        this.views = views;
        this.realtime = realtime;
        this.telegram = telegram;
    }
    // ================= Расчёт и создание =================
    /** Цена поездки по всем активным тарифам */
    async estimate(tenantId, pickup, dropoff) {
        const tariffs = await this.tariffs.list(tenantId, true);
        const route = dropoff ? await this.routing.route(pickup, dropoff) : null;
        return {
            distanceM: route?.distanceM ?? null,
            durationS: route?.durationS ?? null,
            routeSource: route?.source ?? null,
            options: tariffs.map((t) => ({
                tariffId: t.id,
                code: t.code,
                name: t.name,
                price: this.price(t, route),
            })),
        };
    }
    price(t, route) {
        // без точки назначения — минимальная стоимость, водитель довезёт «куда скажут»
        return route ? (0, pricing_1.calcPrice)(t, route.distanceM, route.durationS) : (0, pricing_1.calcPrice)(t, 0, 0);
    }
    async create(user, input) {
        const isStaff = auth_types_1.STAFF_ROLES.includes(user.role);
        if (isStaff && !input.customerPhone)
            throw new common_1.BadRequestException('Укажите телефон клиента');
        const tenant = await this.db.one(`SELECT is_active FROM tenants WHERE id = $1`, [user.tid]);
        if (!tenant?.is_active)
            throw new common_1.ForbiddenException('Таксопарк отключён');
        const tariff = input.tariffId
            ? await this.tariffs.get(user.tid, input.tariffId)
            : (await this.tariffs.list(user.tid, true))[0];
        if (!tariff || !tariff.isActive)
            throw new common_1.BadRequestException('Тариф недоступен');
        const route = input.dropoff ? await this.routing.route(input.pickup, input.dropoff) : null;
        const price = this.price(tariff, route);
        let orderId;
        try {
            orderId = await this.db.tx(async (c) => {
                const o = await this.db.one(`INSERT INTO orders (
             tenant_id, passenger_id, tariff_id, source, customer_name, customer_phone, comment,
             pickup_lat, pickup_lng, pickup_address, dropoff_lat, dropoff_lng, dropoff_address,
             distance_m, duration_s, estimated_price)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`, [
                    user.tid, user.role === 'passenger' ? user.sub : null, tariff.id, isStaff ? 'dispatcher' : 'app',
                    input.customerName ?? null, input.customerPhone ?? null, input.comment ?? null,
                    input.pickup.lat, input.pickup.lng, input.pickup.address ?? null,
                    input.dropoff?.lat ?? null, input.dropoff?.lng ?? null, input.dropoff?.address ?? null,
                    route?.distanceM ?? null, route?.durationS ?? null, price,
                ], c);
                await this.views.addEvent(c, o.id, 'created', user, { price, tariff: tariff.code });
                return o.id;
            });
        }
        catch (e) {
            if ((0, db_service_1.isUniqueViolation)(e, 'orders_one_active_per_passenger')) {
                throw new common_1.ConflictException('У вас уже есть активный заказ');
            }
            throw e;
        }
        await this.views.notify(user.tid, orderId);
        // сразу ищем водителя, не дожидаясь фонового цикла
        await this.dispatch.dispatchOrder(orderId);
        return this.getForUser(user, orderId);
    }
    // ================= Просмотр =================
    async getForUser(user, orderId) {
        const v = await this.views.get(user.tid, orderId);
        this.assertCanSee(user, v);
        if (user.role === 'passenger')
            return (0, order_view_service_1.forRole)(v, 'passenger');
        if (user.role === 'driver')
            return (0, order_view_service_1.forRole)(v, 'driver', user.sub);
        return v;
    }
    assertCanSee(user, v) {
        if (auth_types_1.STAFF_ROLES.includes(user.role))
            return;
        if (user.role === 'passenger' && v.passenger.id === user.sub)
            return;
        if (user.role === 'driver' && (v.driver?.id === user.sub || v.offer?.driverId === user.sub))
            return;
        throw new common_1.NotFoundException('Заказ не найден');
    }
    async list(user, f) {
        const params = [user.tid];
        let where = 'o.tenant_id = $1';
        if (user.role === 'passenger') {
            params.push(user.sub);
            where += ` AND o.passenger_id = $${params.length}`;
        }
        else if (user.role === 'driver') {
            params.push(user.sub);
            where += ` AND o.driver_id = $${params.length}`;
        }
        if (f.status) {
            params.push(f.status);
            where += ` AND o.status = $${params.length}`;
        }
        if (f.scope === 'active') {
            params.push(order_status_1.ACTIVE_STATUSES);
            where += ` AND o.status = ANY($${params.length})`;
        }
        else if (f.scope === 'today') {
            where += ` AND o.created_at >= (
        SELECT date_trunc('day', now() AT TIME ZONE z.tz) AT TIME ZONE z.tz
          FROM (SELECT COALESCE(settings->>'timezone', 'Europe/Moscow') AS tz FROM tenants WHERE id = $1) z)`;
        }
        const rows = await this.views.list(where, params, Math.min(f.limit ?? 50, 200), f.offset ?? 0);
        if (user.role === 'passenger')
            return rows.map((v) => (0, order_view_service_1.forRole)(v, 'passenger'));
        if (user.role === 'driver')
            return rows.map((v) => (0, order_view_service_1.forRole)(v, 'driver', user.sub));
        return rows;
    }
    /** Текущий заказ пассажира, или текущий заказ / предложение водителя */
    async current(user) {
        if (user.role === 'passenger') {
            const r = await this.db.one(`SELECT id FROM orders WHERE tenant_id = $1 AND passenger_id = $2 AND status = ANY($3)`, [user.tid, user.sub, order_status_1.ACTIVE_STATUSES]);
            return { order: r ? await this.getForUser(user, r.id) : null };
        }
        const active = await this.db.one(`SELECT id FROM orders WHERE tenant_id = $1 AND driver_id = $2 AND status IN ('assigned','arrived','in_progress')`, [user.tid, user.sub]);
        if (active)
            return { order: await this.getForUser(user, active.id), offer: null };
        const offered = await this.db.one(`SELECT id, offer_expires_at FROM orders
        WHERE tenant_id = $1 AND offered_driver_id = $2 AND status = 'searching' AND offer_expires_at > now()`, [user.tid, user.sub]);
        if (!offered)
            return { order: null, offer: null };
        return {
            order: null,
            offer: {
                order: await this.getForUser(user, offered.id),
                expiresAt: new Date(offered.offer_expires_at).toISOString(),
            },
        };
    }
    events(user, orderId) {
        return this.views.events(user.tid, orderId);
    }
    // ================= Действия водителя =================
    /** Водитель принимает предложенный заказ */
    async accept(user, orderId) {
        try {
            await this.db.tx(async (c) => {
                const o = await this.db.one(`UPDATE orders SET status = 'assigned', driver_id = $3, assigned_at = now(),
                             offered_driver_id = NULL, offer_expires_at = NULL, updated_at = now()
            WHERE id = $1 AND tenant_id = $2 AND status = 'searching'
              AND offered_driver_id = $3 AND offer_expires_at > now()
            RETURNING id`, [orderId, user.tid, user.sub], c);
                if (!o)
                    throw new common_1.ConflictException('Заказ уже недоступен');
                await this.resolveOffer(c, orderId, user.sub, 'accepted');
                await this.db.many(`UPDATE drivers SET status = 'busy' WHERE id = $1`, [user.sub], c);
                await this.views.addEvent(c, orderId, 'accepted', user);
            });
        }
        catch (e) {
            if ((0, db_service_1.isUniqueViolation)(e, 'orders_one_active_per_driver'))
                throw new common_1.ConflictException('Сначала завершите текущий заказ');
            throw e;
        }
        return this.afterChange(user, orderId);
    }
    /** Водитель отказывается от предложения — сразу ищем следующего */
    async decline(user, orderId) {
        await this.db.tx(async (c) => {
            const o = await this.db.one(`UPDATE orders SET offered_driver_id = NULL, offer_expires_at = NULL, updated_at = now()
          WHERE id = $1 AND tenant_id = $2 AND status = 'searching' AND offered_driver_id = $3
          RETURNING id`, [orderId, user.tid, user.sub], c);
            if (!o)
                throw new common_1.ConflictException('Предложение уже неактуально');
            await this.resolveOffer(c, orderId, user.sub, 'declined');
            await this.views.addEvent(c, orderId, 'declined', user);
        });
        await this.dispatch.dispatchOrder(orderId);
        return { ok: true };
    }
    /** Водитель подъехал */
    arrived(user, orderId) {
        return this.driverStep(user, orderId, 'assigned', 'arrived', 'arrived_at');
    }
    /** Пассажир сел, поездка началась */
    start(user, orderId) {
        return this.driverStep(user, orderId, 'arrived', 'in_progress', 'started_at');
    }
    /** Поездка завершена — водитель снова свободен */
    async complete(user, orderId) {
        await this.db.tx(async (c) => {
            const o = await this.db.one(`UPDATE orders SET status = 'completed', completed_at = now(), final_price = estimated_price, updated_at = now()
          WHERE id = $1 AND tenant_id = $2 AND driver_id = $3 AND status = 'in_progress'
          RETURNING id`, [orderId, user.tid, user.sub], c);
            if (!o)
                throw new common_1.ConflictException('Завершить можно только поездку в пути');
            await this.releaseDriver(c, user.sub);
            await this.views.addEvent(c, orderId, 'completed', user);
        });
        return this.afterChange(user, orderId);
    }
    /** Водитель отказывается от уже принятого заказа (до посадки) — заказ снова ищет машину */
    async refuse(user, orderId, reason) {
        await this.db.tx(async (c) => {
            const o = await this.db.one(`UPDATE orders SET status = 'searching', driver_id = NULL, assigned_at = NULL, arrived_at = NULL,
                           offered_driver_id = NULL, offer_expires_at = NULL, search_radius_idx = 0, updated_at = now()
          WHERE id = $1 AND tenant_id = $2 AND driver_id = $3 AND status = ANY($4)
          RETURNING id`, [orderId, user.tid, user.sub, order_status_1.DRIVER_REFUSABLE], c);
            if (!o)
                throw new common_1.ConflictException('Отказаться можно только до посадки пассажира');
            // этому водителю заказ больше не предлагаем
            await this.db.many(`UPDATE order_offers SET result = 'cancelled', responded_at = now()
          WHERE order_id = $1 AND driver_id = $2 AND result IN ('accepted', 'pending')`, [orderId, user.sub], c);
            await this.releaseDriver(c, user.sub);
            await this.views.addEvent(c, orderId, 'driver_refused', user, { reason: reason ?? null });
        });
        await this.views.notify(user.tid, orderId);
        await this.dispatch.dispatchOrder(orderId);
        return { ok: true };
    }
    async driverStep(user, orderId, from, to, tsColumn) {
        await this.db.tx(async (c) => {
            const o = await this.db.one(`UPDATE orders SET status = $4, ${tsColumn} = now(), updated_at = now()
          WHERE id = $1 AND tenant_id = $2 AND driver_id = $3 AND status = $5
          RETURNING id`, [orderId, user.tid, user.sub, to, from], c);
            if (!o)
                throw new common_1.ConflictException('Действие недоступно в текущем статусе заказа');
            await this.views.addEvent(c, orderId, to, user);
        });
        return this.afterChange(user, orderId);
    }
    // ================= Отмена и ручное назначение =================
    /** Отмена пассажиром или диспетчером */
    async cancel(user, orderId, reason) {
        if (user.role === 'driver')
            return this.refuse(user, orderId, reason);
        const allowed = user.role === 'passenger' ? order_status_1.PASSENGER_CANCELLABLE : order_status_1.STAFF_CANCELLABLE;
        const prev = await this.db.tx(async (c) => {
            const o = await this.db.one(`SELECT * FROM orders WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [orderId, user.tid], c);
            if (!o || (user.role === 'passenger' && o.passenger_id !== user.sub))
                throw new common_1.NotFoundException('Заказ не найден');
            if (!allowed.includes(o.status)) {
                throw new common_1.ConflictException(o.status === 'in_progress' ? 'Поездка уже идёт — отменить может только диспетчер' : 'Заказ уже нельзя отменить');
            }
            await this.db.one(`UPDATE orders SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3,
                           offered_driver_id = NULL, offer_expires_at = NULL, updated_at = now()
          WHERE id = $1 RETURNING id`, [orderId, user.role, reason ?? null], c);
            if (o.offered_driver_id)
                await this.resolveOffer(c, orderId, o.offered_driver_id, 'cancelled');
            if (o.driver_id)
                await this.releaseDriver(c, o.driver_id);
            await this.views.addEvent(c, orderId, 'cancelled', user, { reason: reason ?? null, prevStatus: o.status });
            return o;
        });
        if (prev.offered_driver_id) {
            this.realtime.toDriver(prev.offered_driver_id, 'order:offer_cancelled', { orderId, reason: 'cancelled' });
        }
        if (prev.driver_id) {
            const who = user.role === 'passenger' ? 'Пассажир' : 'Диспетчер';
            this.telegram
                .notifyDriver(prev.driver_id, `❌ ${who} отменил заказ${reason ? `: ${reason}` : ''}. Вы снова свободны.`)
                .catch(() => undefined);
        }
        return this.afterChange(user, orderId);
    }
    /** Диспетчер вручную назначает свободного водителя на заказ в поиске */
    async assign(user, orderId, driverId) {
        let withdrawnFrom = null;
        try {
            await this.db.tx(async (c) => {
                const o = await this.db.one(`SELECT * FROM orders WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [orderId, user.tid], c);
                if (!o)
                    throw new common_1.NotFoundException('Заказ не найден');
                if (o.status !== 'searching')
                    throw new common_1.ConflictException('Назначить можно только заказ в поиске');
                const d = await this.db.one(`SELECT * FROM drivers WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [driverId, user.tid], c);
                if (!d)
                    throw new common_1.NotFoundException('Водитель не найден');
                if (!d.is_active)
                    throw new common_1.ConflictException('Водитель отключён');
                if (d.status !== 'online')
                    throw new common_1.ConflictException('Водитель не на линии или занят');
                if (o.offered_driver_id) {
                    await this.resolveOffer(c, orderId, o.offered_driver_id, o.offered_driver_id === driverId ? 'accepted' : 'cancelled');
                    if (o.offered_driver_id !== driverId)
                        withdrawnFrom = o.offered_driver_id;
                }
                // водитель мог думать над другим заказом — снимаем то предложение
                const other = await this.db.many(`UPDATE orders SET offered_driver_id = NULL, offer_expires_at = NULL, updated_at = now()
            WHERE offered_driver_id = $1 AND status = 'searching' AND id <> $2 RETURNING id`, [driverId, orderId], c);
                for (const x of other)
                    await this.resolveOffer(c, x.id, driverId, 'dropped');
                await this.db.one(`UPDATE orders SET status = 'assigned', driver_id = $2, assigned_at = now(),
                             offered_driver_id = NULL, offer_expires_at = NULL, updated_at = now()
            WHERE id = $1 RETURNING id`, [orderId, driverId], c);
                await this.db.many(`UPDATE drivers SET status = 'busy' WHERE id = $1`, [driverId], c);
                await this.views.addEvent(c, orderId, 'assigned_by_dispatcher', user, { driverId });
            });
        }
        catch (e) {
            if ((0, db_service_1.isUniqueViolation)(e, 'orders_one_active_per_driver'))
                throw new common_1.ConflictException('У водителя уже есть активный заказ');
            throw e;
        }
        if (withdrawnFrom)
            this.realtime.toDriver(withdrawnFrom, 'order:offer_cancelled', { orderId, reason: 'reassigned' });
        const result = await this.afterChange(user, orderId);
        const v = result;
        this.telegram
            .notifyDriver(driverId, `📋 Диспетчер назначил вам заказ.\nПодача: ${v.pickup?.address ?? 'точка на карте'}${v.comment ? `\nКомментарий: ${v.comment}` : ''}`, { button: 'Открыть заказ' })
            .catch(() => undefined);
        return result;
    }
    // ================= Вспомогательное =================
    async resolveOffer(c, orderId, driverId, result) {
        await this.db.many(`UPDATE order_offers SET result = $3, responded_at = now()
        WHERE order_id = $1 AND driver_id = $2 AND result = 'pending'`, [orderId, driverId, result], c);
    }
    /** Водитель снова свободен (если он не ушёл с линии) */
    async releaseDriver(c, driverId) {
        await this.db.many(`UPDATE drivers SET status = 'online' WHERE id = $1 AND status = 'busy'`, [driverId], c);
    }
    async afterChange(user, orderId) {
        await this.views.notify(user.tid, orderId);
        return this.getForUser(user, orderId);
    }
};
exports.OrdersService = OrdersService;
exports.OrdersService = OrdersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [typeof (_a = typeof db_service_1.DbService !== "undefined" && db_service_1.DbService) === "function" ? _a : Object, typeof (_b = typeof tariffs_service_1.TariffsService !== "undefined" && tariffs_service_1.TariffsService) === "function" ? _b : Object, typeof (_c = typeof routing_service_1.RoutingService !== "undefined" && routing_service_1.RoutingService) === "function" ? _c : Object, typeof (_d = typeof dispatch_service_1.DispatchService !== "undefined" && dispatch_service_1.DispatchService) === "function" ? _d : Object, typeof (_e = typeof order_view_service_1.OrderViewService !== "undefined" && order_view_service_1.OrderViewService) === "function" ? _e : Object, typeof (_f = typeof realtime_service_1.RealtimeService !== "undefined" && realtime_service_1.RealtimeService) === "function" ? _f : Object, typeof (_g = typeof telegram_service_1.TelegramService !== "undefined" && telegram_service_1.TelegramService) === "function" ? _g : Object])
], OrdersService);

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
var _a, _b, _c, _d, _e;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DispatchService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("../config");
const db_service_1 = require("../db/db.service");
const redis_service_1 = require("../db/redis.service");
const realtime_service_1 = require("../realtime/realtime.service");
const telegram_service_1 = require("../telegram/telegram.service");
const order_view_service_1 = require("./order-view.service");
/**
 * Подбор водителя.
 *
 * Заказ в статусе `searching` по очереди предлагается ближайшим свободным водителям.
 * У водителя есть OFFER_TIMEOUT_SEC секунд, чтобы принять. Отказался или промолчал —
 * предлагаем следующему. Рядом никого — расширяем радиус (SEARCH_RADII_KM).
 * Никто не взял за ORDER_SEARCH_TIMEOUT_SEC — заказ `expired`.
 *
 * Состояние хранится в базе (offered_driver_id, offer_expires_at), а фоновый цикл
 * раз в секунду обрабатывает заказы с истёкшим предложением. Поэтому перезапуск
 * сервера ничего не ломает, а FOR UPDATE SKIP LOCKED позволяет запускать несколько
 * копий бэкенда.
 */
let DispatchService = class DispatchService {
    db;
    redis;
    views;
    realtime;
    telegram;
    log = new common_1.Logger('Dispatch');
    timer = null;
    sweeping = false;
    constructor(db, redis, views, realtime, telegram) {
        this.db = db;
        this.redis = redis;
        this.views = views;
        this.realtime = realtime;
        this.telegram = telegram;
    }
    onModuleInit() {
        if (config_1.config.dispatch.sweepIntervalMs > 0) {
            this.timer = setInterval(() => void this.sweep(), config_1.config.dispatch.sweepIntervalMs);
        }
    }
    onModuleDestroy() {
        if (this.timer)
            clearInterval(this.timer);
    }
    /** Один проход: все заказы в поиске, у которых истекло предложение или его нет */
    async sweep() {
        if (this.sweeping)
            return;
        this.sweeping = true;
        try {
            const due = await this.db.many(`SELECT id FROM orders
          WHERE status = 'searching' AND (offer_expires_at IS NULL OR offer_expires_at <= now())
          ORDER BY created_at LIMIT 100`);
            for (const { id } of due)
                await this.dispatchOrder(id);
        }
        catch (e) {
            this.log.error(`Ошибка цикла подбора: ${e.message}`);
        }
        finally {
            this.sweeping = false;
        }
    }
    /** Обработать один заказ: снять истёкшее предложение и предложить следующему водителю */
    async dispatchOrder(orderId) {
        let after = null;
        try {
            after = await this.db.tx((c) => this.step(c, orderId));
        }
        catch (e) {
            // водителя параллельно забрал другой заказ — попробуем на следующем проходе
            if ((0, db_service_1.isUniqueViolation)(e, 'orders_one_offer_per_driver'))
                return;
            this.log.error(`Заказ ${orderId}: ${e.message}`);
            return;
        }
        if (after)
            await this.publish(after);
    }
    async step(c, orderId) {
        const o = await this.db.one(`SELECT o.*, t.code AS tariff_code FROM orders o JOIN tariffs t ON t.id = o.tariff_id
        WHERE o.id = $1 AND o.status = 'searching' AND (o.offer_expires_at IS NULL OR o.offer_expires_at <= now())
        FOR UPDATE OF o SKIP LOCKED`, [orderId], c);
        if (!o)
            return null; // уже обработан, взят или заблокирован другим процессом
        const after = { tenantId: o.tenant_id, orderId, changed: false };
        // 1. Водитель не ответил вовремя
        if (o.offered_driver_id) {
            await this.db.many(`UPDATE order_offers SET result = 'timeout', responded_at = now()
          WHERE order_id = $1 AND driver_id = $2 AND result = 'pending'`, [orderId, o.offered_driver_id], c);
            await this.views.addEvent(c, orderId, 'offer_timeout', null, { driverId: o.offered_driver_id });
            after.offerWithdrawnFrom = o.offered_driver_id;
            after.changed = true;
        }
        // 2. Слишком долго ищем — заказ просрочен
        const ageSec = (Date.now() - new Date(o.created_at).getTime()) / 1000;
        if (ageSec >= config_1.config.dispatch.orderSearchTimeoutSec) {
            await this.db.one(`UPDATE orders SET status = 'expired', offered_driver_id = NULL, offer_expires_at = NULL, updated_at = now()
          WHERE id = $1 RETURNING id`, [orderId], c);
            await this.views.addEvent(c, orderId, 'expired', null);
            after.changed = true;
            return after;
        }
        // 3. Ищем следующего водителя, расширяя радиус
        const radii = config_1.config.dispatch.searchRadiiKm.length ? config_1.config.dispatch.searchRadiiKm : [5];
        const startIdx = Math.min(o.search_radius_idx, radii.length - 1);
        for (let idx = startIdx; idx < radii.length; idx++) {
            const nearby = await this.redis.findNearby(o.tenant_id, o.pickup_lat, o.pickup_lng, radii[idx]);
            if (!nearby.length)
                continue;
            const eligible = await this.eligibleDrivers(c, o, nearby.map((n) => n.driverId));
            if (!eligible.length)
                continue;
            const driverId = eligible[0];
            const distanceM = nearby.find((n) => n.driverId === driverId).distanceM;
            const upd = await this.db.one(`UPDATE orders SET offered_driver_id = $2, offer_expires_at = now() + make_interval(secs => $3),
                           search_radius_idx = $4, updated_at = now()
          WHERE id = $1 RETURNING offer_expires_at`, [orderId, driverId, config_1.config.dispatch.offerTimeoutSec, idx], c);
            await this.db.many(`INSERT INTO order_offers (order_id, driver_id, distance_m) VALUES ($1, $2, $3)`, [orderId, driverId, distanceM], c);
            await this.views.addEvent(c, orderId, 'offered', null, { driverId, distanceM, radiusKm: radii[idx] });
            after.offeredTo = { driverId, distanceM, expiresAt: upd.offer_expires_at };
            after.changed = true;
            return after;
        }
        // 4. Никого нет — повторим через несколько секунд
        await this.db.one(`UPDATE orders SET offered_driver_id = NULL, offer_expires_at = now() + make_interval(secs => $2),
                         search_radius_idx = $3, updated_at = now()
        WHERE id = $1 RETURNING id`, [orderId, config_1.config.dispatch.retryDelaySec, radii.length - 1], c);
        return after;
    }
    /** Из водителей рядом (в порядке удалённости) оставить тех, кому можно предложить заказ */
    async eligibleDrivers(c, o, candidateIds) {
        const rows = await this.db.many(`SELECT d.id FROM drivers d
        WHERE d.tenant_id = $1
          AND d.id = ANY($2::uuid[])
          AND d.is_active AND d.status = 'online'
          AND d.last_seen_at > now() - make_interval(secs => $3)
          AND (cardinality(d.tariff_codes) = 0 OR $4 = ANY(d.tariff_codes))
          -- водитель не думает сейчас над другим заказом
          AND NOT EXISTS (SELECT 1 FROM orders x WHERE x.offered_driver_id = d.id AND x.status = 'searching' AND x.id <> $5)
          -- не отказывался от этого заказа; пропустивших не беспокоим какое-то время
          AND NOT EXISTS (
            SELECT 1 FROM order_offers f WHERE f.order_id = $5 AND f.driver_id = d.id
               AND (f.result IN ('declined', 'cancelled') OR f.offered_at > now() - make_interval(secs => $6)))
        ORDER BY array_position($2::uuid[], d.id)`, [
            o.tenant_id, candidateIds, config_1.config.dispatch.driverLocationTtlSec, o.tariff_code, o.id,
            config_1.config.dispatch.timeoutCooldownSec,
        ], c);
        return rows.map((r) => r.id);
    }
    async publish(a) {
        if (a.offerWithdrawnFrom) {
            this.realtime.toDriver(a.offerWithdrawnFrom, 'order:offer_cancelled', { orderId: a.orderId, reason: 'timeout' });
        }
        if (!a.changed)
            return;
        const view = await this.views.notify(a.tenantId, a.orderId);
        if (a.offeredTo) {
            this.realtime.toDriver(a.offeredTo.driverId, 'order:offer', {
                order: (0, order_view_service_1.forRole)(view, 'driver', a.offeredTo.driverId),
                distanceToPickupM: a.offeredTo.distanceM,
                expiresAt: new Date(a.offeredTo.expiresAt).toISOString(),
            });
            // приложение водителя закрыто — дублируем в Telegram, чтобы не пропустил
            this.telegram
                .notifyDriver(a.offeredTo.driverId, (0, telegram_service_1.offerMessage)(view, a.offeredTo.distanceM, config_1.config.dispatch.offerTimeoutSec), { button: 'Открыть заказ' })
                .catch((e) => this.log.warn(`Telegram водителю: ${e.message}`));
        }
    }
};
exports.DispatchService = DispatchService;
exports.DispatchService = DispatchService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [typeof (_a = typeof db_service_1.DbService !== "undefined" && db_service_1.DbService) === "function" ? _a : Object, typeof (_b = typeof redis_service_1.RedisService !== "undefined" && redis_service_1.RedisService) === "function" ? _b : Object, typeof (_c = typeof order_view_service_1.OrderViewService !== "undefined" && order_view_service_1.OrderViewService) === "function" ? _c : Object, typeof (_d = typeof realtime_service_1.RealtimeService !== "undefined" && realtime_service_1.RealtimeService) === "function" ? _d : Object, typeof (_e = typeof telegram_service_1.TelegramService !== "undefined" && telegram_service_1.TelegramService) === "function" ? _e : Object])
], DispatchService);

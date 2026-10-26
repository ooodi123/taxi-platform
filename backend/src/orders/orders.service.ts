import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { AuthUser, STAFF_ROLES } from '../auth/auth.types';
import { DbService, isUniqueViolation } from '../db/db.service';
import { calcPrice } from '../pricing/pricing';
import { Point, RouteInfo, RoutingService } from '../pricing/routing.service';
import { RealtimeService } from '../realtime/realtime.service';
import { Tariff, TariffsService } from '../tariffs/tariffs.service';
import { TelegramService } from '../telegram/telegram.service';
import { DispatchService } from './dispatch.service';
import {
  ACTIVE_STATUSES, DRIVER_REFUSABLE, OrderStatus, PASSENGER_CANCELLABLE, STAFF_CANCELLABLE,
} from './order-status';
import { forRole, OrderView, OrderViewService } from './order-view.service';

export interface Place extends Point {
  address?: string;
}

export interface CreateOrderInput {
  pickup: Place;
  dropoff?: Place;
  tariffId?: string;
  comment?: string;
  customerName?: string;
  customerPhone?: string;
}

export interface ListFilter {
  status?: OrderStatus;
  /** active — все активные; today — созданные сегодня (по часовому поясу таксопарка) */
  scope?: 'active' | 'today';
  limit?: number;
  offset?: number;
}

@Injectable()
export class OrdersService {
  private readonly log = new Logger('Orders');

  constructor(
    private readonly db: DbService,
    private readonly tariffs: TariffsService,
    private readonly routing: RoutingService,
    private readonly dispatch: DispatchService,
    private readonly views: OrderViewService,
    private readonly realtime: RealtimeService,
    private readonly telegram: TelegramService,
  ) {}

  // ================= Расчёт и создание =================

  /** Цена поездки по всем активным тарифам */
  async estimate(tenantId: string, pickup: Point, dropoff?: Point) {
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

  private price(t: Tariff, route: RouteInfo | null): number {
    // без точки назначения — минимальная стоимость, водитель довезёт «куда скажут»
    return route ? calcPrice(t, route.distanceM, route.durationS) : calcPrice(t, 0, 0);
  }

  async create(user: AuthUser, input: CreateOrderInput): Promise<Partial<OrderView>> {
    const isStaff = STAFF_ROLES.includes(user.role);
    if (isStaff && !input.customerPhone) throw new BadRequestException('Укажите телефон клиента');

    const tenant = await this.db.one(`SELECT is_active FROM tenants WHERE id = $1`, [user.tid]);
    if (!tenant?.is_active) throw new ForbiddenException('Таксопарк отключён');

    const tariff = input.tariffId
      ? await this.tariffs.get(user.tid, input.tariffId)
      : (await this.tariffs.list(user.tid, true))[0];
    if (!tariff || !tariff.isActive) throw new BadRequestException('Тариф недоступен');

    const route = input.dropoff ? await this.routing.route(input.pickup, input.dropoff) : null;
    const price = this.price(tariff, route);

    let orderId: string;
    try {
      orderId = await this.db.tx(async (c) => {
        const o = await this.db.one(
          `INSERT INTO orders (
             tenant_id, passenger_id, tariff_id, source, customer_name, customer_phone, comment,
             pickup_lat, pickup_lng, pickup_address, dropoff_lat, dropoff_lng, dropoff_address,
             distance_m, duration_s, estimated_price)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
          [
            user.tid, user.role === 'passenger' ? user.sub : null, tariff.id, isStaff ? 'dispatcher' : 'app',
            input.customerName ?? null, input.customerPhone ?? null, input.comment ?? null,
            input.pickup.lat, input.pickup.lng, input.pickup.address ?? null,
            input.dropoff?.lat ?? null, input.dropoff?.lng ?? null, input.dropoff?.address ?? null,
            route?.distanceM ?? null, route?.durationS ?? null, price,
          ],
          c,
        );
        await this.views.addEvent(c, o!.id, 'created', user, { price, tariff: tariff.code });
        return o!.id as string;
      });
    } catch (e) {
      if (isUniqueViolation(e, 'orders_one_active_per_passenger')) {
        throw new ConflictException('У вас уже есть активный заказ');
      }
      throw e;
    }

    await this.views.notify(user.tid, orderId);
    // сразу ищем водителя, не дожидаясь фонового цикла
    await this.dispatch.dispatchOrder(orderId);
    return this.getForUser(user, orderId);
  }

  // ================= Просмотр =================

  async getForUser(user: AuthUser, orderId: string): Promise<Partial<OrderView>> {
    const v = await this.views.get(user.tid, orderId);
    this.assertCanSee(user, v);
    if (user.role === 'passenger') return forRole(v, 'passenger');
    if (user.role === 'driver') return forRole(v, 'driver', user.sub);
    return v;
  }

  private assertCanSee(user: AuthUser, v: OrderView) {
    if (STAFF_ROLES.includes(user.role)) return;
    if (user.role === 'passenger' && v.passenger.id === user.sub) return;
    if (user.role === 'driver' && (v.driver?.id === user.sub || v.offer?.driverId === user.sub)) return;
    throw new NotFoundException('Заказ не найден');
  }

  async list(user: AuthUser, f: ListFilter) {
    const params: unknown[] = [user.tid];
    let where = 'o.tenant_id = $1';
    if (user.role === 'passenger') {
      params.push(user.sub);
      where += ` AND o.passenger_id = $${params.length}`;
    } else if (user.role === 'driver') {
      params.push(user.sub);
      where += ` AND o.driver_id = $${params.length}`;
    }
    if (f.status) {
      params.push(f.status);
      where += ` AND o.status = $${params.length}`;
    }
    if (f.scope === 'active') {
      params.push(ACTIVE_STATUSES);
      where += ` AND o.status = ANY($${params.length})`;
    } else if (f.scope === 'today') {
      where += ` AND o.created_at >= (
        SELECT date_trunc('day', now() AT TIME ZONE z.tz) AT TIME ZONE z.tz
          FROM (SELECT COALESCE(settings->>'timezone', 'Europe/Moscow') AS tz FROM tenants WHERE id = $1) z)`;
    }
    const rows = await this.views.list(where, params, Math.min(f.limit ?? 50, 200), f.offset ?? 0);
    if (user.role === 'passenger') return rows.map((v) => forRole(v, 'passenger'));
    if (user.role === 'driver') return rows.map((v) => forRole(v, 'driver', user.sub));
    return rows;
  }

  /** Текущий заказ пассажира, или текущий заказ / предложение водителя */
  async current(user: AuthUser) {
    if (user.role === 'passenger') {
      const r = await this.db.one(
        `SELECT id FROM orders WHERE tenant_id = $1 AND passenger_id = $2 AND status = ANY($3)`,
        [user.tid, user.sub, ACTIVE_STATUSES],
      );
      return { order: r ? await this.getForUser(user, r.id) : null };
    }
    const active = await this.db.one(
      `SELECT id FROM orders WHERE tenant_id = $1 AND driver_id = $2 AND status IN ('assigned','arrived','in_progress')`,
      [user.tid, user.sub],
    );
    if (active) return { order: await this.getForUser(user, active.id), offer: null };
    const offered = await this.db.one(
      `SELECT id, offer_expires_at FROM orders
        WHERE tenant_id = $1 AND offered_driver_id = $2 AND status = 'searching' AND offer_expires_at > now()`,
      [user.tid, user.sub],
    );
    if (!offered) return { order: null, offer: null };
    return {
      order: null,
      offer: {
        order: await this.getForUser(user, offered.id),
        expiresAt: new Date(offered.offer_expires_at).toISOString(),
      },
    };
  }

  events(user: AuthUser, orderId: string) {
    return this.views.events(user.tid, orderId);
  }

  // ================= Действия водителя =================

  /** Водитель принимает предложенный заказ */
  async accept(user: AuthUser, orderId: string) {
    try {
      await this.db.tx(async (c) => {
        const o = await this.db.one(
          `UPDATE orders SET status = 'assigned', driver_id = $3, assigned_at = now(),
                             offered_driver_id = NULL, offer_expires_at = NULL, updated_at = now()
            WHERE id = $1 AND tenant_id = $2 AND status = 'searching'
              AND offered_driver_id = $3 AND offer_expires_at > now()
            RETURNING id`,
          [orderId, user.tid, user.sub], c,
        );
        if (!o) throw new ConflictException('Заказ уже недоступен');
        await this.resolveOffer(c, orderId, user.sub, 'accepted');
        await this.db.many(`UPDATE drivers SET status = 'busy' WHERE id = $1`, [user.sub], c);
        await this.views.addEvent(c, orderId, 'accepted', user);
      });
    } catch (e) {
      if (isUniqueViolation(e, 'orders_one_active_per_driver')) throw new ConflictException('Сначала завершите текущий заказ');
      throw e;
    }
    return this.afterChange(user, orderId);
  }

  /** Водитель отказывается от предложения — сразу ищем следующего */
  async decline(user: AuthUser, orderId: string) {
    await this.db.tx(async (c) => {
      const o = await this.db.one(
        `UPDATE orders SET offered_driver_id = NULL, offer_expires_at = NULL, updated_at = now()
          WHERE id = $1 AND tenant_id = $2 AND status = 'searching' AND offered_driver_id = $3
          RETURNING id`,
        [orderId, user.tid, user.sub], c,
      );
      if (!o) throw new ConflictException('Предложение уже неактуально');
      await this.resolveOffer(c, orderId, user.sub, 'declined');
      await this.views.addEvent(c, orderId, 'declined', user);
    });
    await this.dispatch.dispatchOrder(orderId);
    return { ok: true };
  }

  /** Водитель подъехал */
  arrived(user: AuthUser, orderId: string) {
    return this.driverStep(user, orderId, 'assigned', 'arrived', 'arrived_at');
  }

  /** Пассажир сел, поездка началась */
  start(user: AuthUser, orderId: string) {
    return this.driverStep(user, orderId, 'arrived', 'in_progress', 'started_at');
  }

  /** Поездка завершена — водитель снова свободен */
  async complete(user: AuthUser, orderId: string) {
    await this.db.tx(async (c) => {
      const o = await this.db.one(
        `UPDATE orders SET status = 'completed', completed_at = now(), final_price = estimated_price, updated_at = now()
          WHERE id = $1 AND tenant_id = $2 AND driver_id = $3 AND status = 'in_progress'
          RETURNING id`,
        [orderId, user.tid, user.sub], c,
      );
      if (!o) throw new ConflictException('Завершить можно только поездку в пути');
      await this.releaseDriver(c, user.sub);
      await this.views.addEvent(c, orderId, 'completed', user);
    });
    return this.afterChange(user, orderId);
  }

  /** Водитель отказывается от уже принятого заказа (до посадки) — заказ снова ищет машину */
  async refuse(user: AuthUser, orderId: string, reason?: string) {
    await this.db.tx(async (c) => {
      const o = await this.db.one(
        `UPDATE orders SET status = 'searching', driver_id = NULL, assigned_at = NULL, arrived_at = NULL,
                           offered_driver_id = NULL, offer_expires_at = NULL, search_radius_idx = 0, updated_at = now()
          WHERE id = $1 AND tenant_id = $2 AND driver_id = $3 AND status = ANY($4)
          RETURNING id`,
        [orderId, user.tid, user.sub, DRIVER_REFUSABLE], c,
      );
      if (!o) throw new ConflictException('Отказаться можно только до посадки пассажира');
      // этому водителю заказ больше не предлагаем
      await this.db.many(
        `UPDATE order_offers SET result = 'cancelled', responded_at = now()
          WHERE order_id = $1 AND driver_id = $2 AND result IN ('accepted', 'pending')`,
        [orderId, user.sub], c,
      );
      await this.releaseDriver(c, user.sub);
      await this.views.addEvent(c, orderId, 'driver_refused', user, { reason: reason ?? null });
    });
    await this.views.notify(user.tid, orderId);
    await this.dispatch.dispatchOrder(orderId);
    return { ok: true };
  }

  private async driverStep(user: AuthUser, orderId: string, from: OrderStatus, to: OrderStatus, tsColumn: string) {
    await this.db.tx(async (c) => {
      const o = await this.db.one(
        `UPDATE orders SET status = $4, ${tsColumn} = now(), updated_at = now()
          WHERE id = $1 AND tenant_id = $2 AND driver_id = $3 AND status = $5
          RETURNING id`,
        [orderId, user.tid, user.sub, to, from], c,
      );
      if (!o) throw new ConflictException('Действие недоступно в текущем статусе заказа');
      await this.views.addEvent(c, orderId, to, user);
    });
    return this.afterChange(user, orderId);
  }

  // ================= Отмена и ручное назначение =================

  /** Отмена пассажиром или диспетчером */
  async cancel(user: AuthUser, orderId: string, reason?: string) {
    if (user.role === 'driver') return this.refuse(user, orderId, reason);
    const allowed = user.role === 'passenger' ? PASSENGER_CANCELLABLE : STAFF_CANCELLABLE;

    const prev = await this.db.tx(async (c) => {
      const o = await this.db.one(
        `SELECT * FROM orders WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [orderId, user.tid], c,
      );
      if (!o || (user.role === 'passenger' && o.passenger_id !== user.sub)) throw new NotFoundException('Заказ не найден');
      if (!allowed.includes(o.status)) {
        throw new ConflictException(
          o.status === 'in_progress' ? 'Поездка уже идёт — отменить может только диспетчер' : 'Заказ уже нельзя отменить',
        );
      }
      await this.db.one(
        `UPDATE orders SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3,
                           offered_driver_id = NULL, offer_expires_at = NULL, updated_at = now()
          WHERE id = $1 RETURNING id`,
        [orderId, user.role, reason ?? null], c,
      );
      if (o.offered_driver_id) await this.resolveOffer(c, orderId, o.offered_driver_id, 'cancelled');
      if (o.driver_id) await this.releaseDriver(c, o.driver_id);
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
  async assign(user: AuthUser, orderId: string, driverId: string) {
    let withdrawnFrom: string | null = null;
    try {
      await this.db.tx(async (c) => {
        const o = await this.db.one(
          `SELECT * FROM orders WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [orderId, user.tid], c,
        );
        if (!o) throw new NotFoundException('Заказ не найден');
        if (o.status !== 'searching') throw new ConflictException('Назначить можно только заказ в поиске');

        const d = await this.db.one(
          `SELECT * FROM drivers WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [driverId, user.tid], c,
        );
        if (!d) throw new NotFoundException('Водитель не найден');
        if (!d.is_active) throw new ConflictException('Водитель отключён');
        if (d.status !== 'online') throw new ConflictException('Водитель не на линии или занят');

        if (o.offered_driver_id) {
          await this.resolveOffer(c, orderId, o.offered_driver_id, o.offered_driver_id === driverId ? 'accepted' : 'cancelled');
          if (o.offered_driver_id !== driverId) withdrawnFrom = o.offered_driver_id;
        }
        // водитель мог думать над другим заказом — снимаем то предложение
        const other = await this.db.many(
          `UPDATE orders SET offered_driver_id = NULL, offer_expires_at = NULL, updated_at = now()
            WHERE offered_driver_id = $1 AND status = 'searching' AND id <> $2 RETURNING id`,
          [driverId, orderId], c,
        );
        for (const x of other) await this.resolveOffer(c, x.id, driverId, 'dropped');

        await this.db.one(
          `UPDATE orders SET status = 'assigned', driver_id = $2, assigned_at = now(),
                             offered_driver_id = NULL, offer_expires_at = NULL, updated_at = now()
            WHERE id = $1 RETURNING id`,
          [orderId, driverId], c,
        );
        await this.db.many(`UPDATE drivers SET status = 'busy' WHERE id = $1`, [driverId], c);
        await this.views.addEvent(c, orderId, 'assigned_by_dispatcher', user, { driverId });
      });
    } catch (e) {
      if (isUniqueViolation(e, 'orders_one_active_per_driver')) throw new ConflictException('У водителя уже есть активный заказ');
      throw e;
    }
    if (withdrawnFrom) this.realtime.toDriver(withdrawnFrom, 'order:offer_cancelled', { orderId, reason: 'reassigned' });
    const result = await this.afterChange(user, orderId);
    const v = result as OrderView;
    this.telegram
      .notifyDriver(
        driverId,
        `📋 Диспетчер назначил вам заказ.\nПодача: ${v.pickup?.address ?? 'точка на карте'}${v.comment ? `\nКомментарий: ${v.comment}` : ''}`,
        { button: 'Открыть заказ' },
      )
      .catch(() => undefined);
    return result;
  }

  // ================= Вспомогательное =================

  private async resolveOffer(c: PoolClient, orderId: string, driverId: string, result: string) {
    await this.db.many(
      `UPDATE order_offers SET result = $3, responded_at = now()
        WHERE order_id = $1 AND driver_id = $2 AND result = 'pending'`,
      [orderId, driverId, result], c,
    );
  }

  /** Водитель снова свободен (если он не ушёл с линии) */
  private async releaseDriver(c: PoolClient, driverId: string) {
    await this.db.many(`UPDATE drivers SET status = 'online' WHERE id = $1 AND status = 'busy'`, [driverId], c);
  }

  private async afterChange(user: AuthUser, orderId: string) {
    await this.views.notify(user.tid, orderId);
    return this.getForUser(user, orderId);
  }
}

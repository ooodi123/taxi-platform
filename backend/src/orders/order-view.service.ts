import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { TelegramService } from '../telegram/telegram.service';
import { DbService, Queryable } from '../db/db.service';
import { AuthUser, Role } from '../auth/auth.types';
import { RealtimeService } from '../realtime/realtime.service';
import { OrderStatus, STATUS_LABELS } from './order-status';

export interface OrderView {
  id: string;
  number: number;
  tenantId: string;
  status: OrderStatus;
  statusLabel: string;
  source: 'app' | 'dispatcher';
  tariff: { id: string; code: string; name: string };
  pickup: { lat: number; lng: number; address: string | null };
  dropoff: { lat: number; lng: number; address: string | null } | null;
  distanceM: number | null;
  durationS: number | null;
  estimatedPrice: number;
  finalPrice: number | null;
  currency: string;
  comment: string | null;
  passenger: { id: string | null; name: string | null; phone: string | null };
  driver: {
    id: string;
    name: string;
    phone: string | null;
    car: { model: string | null; color: string | null; plate: string | null };
    location: { lat: number; lng: number } | null;
  } | null;
  offer: { driverId: string; expiresAt: string } | null;
  createdAt: string;
  assignedAt: string | null;
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
}

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
@Injectable()
export class OrderViewService {
  private readonly log = new Logger('OrderView');

  constructor(
    private readonly db: DbService,
    private readonly realtime: RealtimeService,
    private readonly telegram: TelegramService,
  ) {}

  async get(tenantId: string, orderId: string, db?: Queryable): Promise<OrderView> {
    const row = await this.db.one(`${VIEW_SQL} WHERE o.id = $1 AND o.tenant_id = $2`, [orderId, tenantId], db);
    if (!row) throw new NotFoundException('Заказ не найден');
    return toView(row);
  }

  async list(where: string, params: unknown[], limit: number, offset: number): Promise<OrderView[]> {
    const rows = await this.db.many(
      `${VIEW_SQL} WHERE ${where} ORDER BY o.created_at DESC LIMIT ${Math.trunc(limit)} OFFSET ${Math.trunc(offset)}`,
      params,
    );
    return rows.map(toView);
  }

  /** Отправить свежую карточку заказа диспетчерам, пассажиру и водителю */
  async notify(tenantId: string, orderId: string) {
    const v = await this.get(tenantId, orderId);
    this.realtime.toDispatch(tenantId, 'order:updated', v);
    if (v.passenger.id) this.realtime.toPassenger(v.passenger.id, 'order:updated', forRole(v, 'passenger'));
    if (v.driver) this.realtime.toDriver(v.driver.id, 'order:updated', forRole(v, 'driver', v.driver.id));
    // сообщение в Telegram — в фоне, чтобы не задерживать ответ API
    this.telegram.onOrderUpdated(v).catch((e) => this.log.warn(`Telegram-уведомление: ${e.message}`));
    return v;
  }

  async addEvent(db: Queryable, orderId: string, type: string, actor: AuthUser | null, payload: Record<string, unknown> = {}) {
    await this.db.many(
      `INSERT INTO order_events (order_id, type, actor_type, actor_id, payload) VALUES ($1, $2, $3, $4, $5)`,
      [
        orderId, type, actor?.role ?? 'system',
        actor && actor.role !== 'superadmin' ? actor.sub : null,
        JSON.stringify(payload),
      ],
      db,
    );
  }

  async events(tenantId: string, orderId: string) {
    await this.get(tenantId, orderId); // проверка доступа к таксопарку
    return this.db.many(
      `SELECT type, actor_type AS "actorType", actor_id AS "actorId", payload, created_at AS "createdAt"
         FROM order_events WHERE order_id = $1 ORDER BY id`,
      [orderId],
    );
  }
}

function toView(r: any): OrderView {
  return {
    id: r.id,
    number: r.number,
    tenantId: r.tenant_id,
    status: r.status,
    statusLabel: STATUS_LABELS[r.status as OrderStatus],
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
    offer: r.offered_driver_id ? { driverId: r.offered_driver_id, expiresAt: iso(r.offer_expires_at)! } : null,
    createdAt: iso(r.created_at)!,
    assignedAt: iso(r.assigned_at),
    arrivedAt: iso(r.arrived_at),
    startedAt: iso(r.started_at),
    completedAt: iso(r.completed_at),
    cancelledAt: iso(r.cancelled_at),
    cancelledBy: r.cancelled_by,
    cancelReason: r.cancel_reason,
  };
}

function iso(d: Date | null): string | null {
  return d ? new Date(d).toISOString() : null;
}

/**
 * Что видит конкретная роль.
 * Пассажир не видит, кому сейчас предлагается заказ.
 * Водитель видит телефон пассажира только после того, как взял заказ.
 */
export function forRole(v: OrderView, role: Role, driverId?: string): Partial<OrderView> {
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

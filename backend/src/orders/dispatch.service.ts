import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PoolClient } from 'pg';
import { config } from '../config';
import { DbService, isUniqueViolation } from '../db/db.service';
import { RedisService } from '../db/redis.service';
import { RealtimeService } from '../realtime/realtime.service';
import { offerMessage, TelegramService } from '../telegram/telegram.service';
import { forRole, OrderViewService } from './order-view.service';

/** Что нужно сделать после коммита транзакции (рассылки) */
interface AfterCommit {
  tenantId: string;
  orderId: string;
  offeredTo?: { driverId: string; distanceM: number; expiresAt: Date };
  offerWithdrawnFrom?: string;
  changed: boolean;
}

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
@Injectable()
export class DispatchService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Dispatch');
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;

  constructor(
    private readonly db: DbService,
    private readonly redis: RedisService,
    private readonly views: OrderViewService,
    private readonly realtime: RealtimeService,
    private readonly telegram: TelegramService,
  ) {}

  onModuleInit() {
    if (config.dispatch.sweepIntervalMs > 0) {
      this.timer = setInterval(() => void this.sweep(), config.dispatch.sweepIntervalMs);
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Один проход: все заказы в поиске, у которых истекло предложение или его нет */
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const due = await this.db.many<{ id: string }>(
        `SELECT id FROM orders
          WHERE status = 'searching' AND (offer_expires_at IS NULL OR offer_expires_at <= now())
          ORDER BY created_at LIMIT 100`,
      );
      for (const { id } of due) await this.dispatchOrder(id);
    } catch (e: any) {
      this.log.error(`Ошибка цикла подбора: ${e.message}`);
    } finally {
      this.sweeping = false;
    }
  }

  /** Обработать один заказ: снять истёкшее предложение и предложить следующему водителю */
  async dispatchOrder(orderId: string): Promise<void> {
    let after: AfterCommit | null = null;
    try {
      after = await this.db.tx((c) => this.step(c, orderId));
    } catch (e: any) {
      // водителя параллельно забрал другой заказ — попробуем на следующем проходе
      if (isUniqueViolation(e, 'orders_one_offer_per_driver')) return;
      this.log.error(`Заказ ${orderId}: ${e.message}`);
      return;
    }
    if (after) await this.publish(after);
  }

  private async step(c: PoolClient, orderId: string): Promise<AfterCommit | null> {
    const o = await this.db.one(
      `SELECT o.*, t.code AS tariff_code FROM orders o JOIN tariffs t ON t.id = o.tariff_id
        WHERE o.id = $1 AND o.status = 'searching' AND (o.offer_expires_at IS NULL OR o.offer_expires_at <= now())
        FOR UPDATE OF o SKIP LOCKED`,
      [orderId], c,
    );
    if (!o) return null; // уже обработан, взят или заблокирован другим процессом

    const after: AfterCommit = { tenantId: o.tenant_id, orderId, changed: false };

    // 1. Водитель не ответил вовремя
    if (o.offered_driver_id) {
      await this.db.many(
        `UPDATE order_offers SET result = 'timeout', responded_at = now()
          WHERE order_id = $1 AND driver_id = $2 AND result = 'pending'`,
        [orderId, o.offered_driver_id], c,
      );
      await this.views.addEvent(c, orderId, 'offer_timeout', null, { driverId: o.offered_driver_id });
      after.offerWithdrawnFrom = o.offered_driver_id;
      after.changed = true;
    }

    // 2. Слишком долго ищем — заказ просрочен
    const ageSec = (Date.now() - new Date(o.created_at).getTime()) / 1000;
    if (ageSec >= config.dispatch.orderSearchTimeoutSec) {
      await this.db.one(
        `UPDATE orders SET status = 'expired', offered_driver_id = NULL, offer_expires_at = NULL, updated_at = now()
          WHERE id = $1 RETURNING id`,
        [orderId], c,
      );
      await this.views.addEvent(c, orderId, 'expired', null);
      after.changed = true;
      return after;
    }

    // 3. Ищем следующего водителя, расширяя радиус
    const radii = config.dispatch.searchRadiiKm.length ? config.dispatch.searchRadiiKm : [5];
    const startIdx = Math.min(o.search_radius_idx, radii.length - 1);
    for (let idx = startIdx; idx < radii.length; idx++) {
      const nearby = await this.redis.findNearby(o.tenant_id, o.pickup_lat, o.pickup_lng, radii[idx]);
      if (!nearby.length) continue;
      const eligible = await this.eligibleDrivers(c, o, nearby.map((n) => n.driverId));
      if (!eligible.length) continue;

      const driverId = eligible[0];
      const distanceM = nearby.find((n) => n.driverId === driverId)!.distanceM;
      const upd = await this.db.one(
        `UPDATE orders SET offered_driver_id = $2, offer_expires_at = now() + make_interval(secs => $3),
                           search_radius_idx = $4, updated_at = now()
          WHERE id = $1 RETURNING offer_expires_at`,
        [orderId, driverId, config.dispatch.offerTimeoutSec, idx], c,
      );
      await this.db.many(
        `INSERT INTO order_offers (order_id, driver_id, distance_m) VALUES ($1, $2, $3)`,
        [orderId, driverId, distanceM], c,
      );
      await this.views.addEvent(c, orderId, 'offered', null, { driverId, distanceM, radiusKm: radii[idx] });
      after.offeredTo = { driverId, distanceM, expiresAt: upd!.offer_expires_at };
      after.changed = true;
      return after;
    }

    // 4. Никого нет — повторим через несколько секунд
    await this.db.one(
      `UPDATE orders SET offered_driver_id = NULL, offer_expires_at = now() + make_interval(secs => $2),
                         search_radius_idx = $3, updated_at = now()
        WHERE id = $1 RETURNING id`,
      [orderId, config.dispatch.retryDelaySec, radii.length - 1], c,
    );
    return after;
  }

  /** Из водителей рядом (в порядке удалённости) оставить тех, кому можно предложить заказ */
  private async eligibleDrivers(c: PoolClient, o: any, candidateIds: string[]): Promise<string[]> {
    const rows = await this.db.many<{ id: string }>(
      `SELECT d.id FROM drivers d
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
        ORDER BY array_position($2::uuid[], d.id)`,
      [
        o.tenant_id, candidateIds, config.dispatch.driverLocationTtlSec, o.tariff_code, o.id,
        config.dispatch.timeoutCooldownSec,
      ],
      c,
    );
    return rows.map((r) => r.id);
  }

  private async publish(a: AfterCommit) {
    if (a.offerWithdrawnFrom) {
      this.realtime.toDriver(a.offerWithdrawnFrom, 'order:offer_cancelled', { orderId: a.orderId, reason: 'timeout' });
    }
    if (!a.changed) return;
    const view = await this.views.notify(a.tenantId, a.orderId);
    if (a.offeredTo) {
      this.realtime.toDriver(a.offeredTo.driverId, 'order:offer', {
        order: forRole(view, 'driver', a.offeredTo.driverId),
        distanceToPickupM: a.offeredTo.distanceM,
        expiresAt: new Date(a.offeredTo.expiresAt).toISOString(),
      });
      // приложение водителя закрыто — дублируем в Telegram, чтобы не пропустил
      this.telegram
        .notifyDriver(a.offeredTo.driverId, offerMessage(view, a.offeredTo.distanceM, config.dispatch.offerTimeoutSec), { button: 'Открыть заказ' })
        .catch((e) => this.log.warn(`Telegram водителю: ${e.message}`));
    }
  }
}

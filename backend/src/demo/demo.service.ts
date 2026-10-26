import { Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { config } from '../config';
import { DbService } from '../db/db.service';
import { DriversModule } from '../drivers/drivers.module';
import { DriversService } from '../drivers/drivers.service';
import { OrdersModule } from '../orders/orders.module';
import { OrdersService } from '../orders/orders.service';
import { haversineM } from '../pricing/pricing';
import { demoStepM, LatLng, moveToward, randomNear } from './movement';

const TICK_MS = 3000;
const ACCEPT_AFTER_TICKS = 1;     // «подумать» перед принятием
const WAIT_AT_PICKUP_TICKS = 2;   // пассажир садится
const IDLE_WANDER_M = 40;
const SPAWN_RADIUS_M = 2500;

interface SimDriver {
  pos: LatLng | null;
  offerSeenTicks: number;
  waitTicks: number;
}

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
@Injectable()
export class DemoService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Demo');
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private sims = new Map<string, SimDriver>();

  constructor(
    private readonly db: DbService,
    private readonly drivers: DriversService,
    private readonly orders: OrdersService,
  ) {}

  onModuleInit() {
    if (!config.demo.simulator) return;
    this.log.warn(`Демо-режим: водители таксопарка «${config.demo.tenantSlug}» управляются симулятором`);
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const tenant = await this.db.one(
        `SELECT id, settings FROM tenants WHERE slug = $1 AND is_active`,
        [config.demo.tenantSlug],
      );
      if (!tenant) return;
      const center = toLatLng(tenant.settings?.center) ?? { lat: 55.7558, lng: 37.6173 };
      const list = await this.db.many(
        `SELECT d.id, d.status, d.last_lat, d.last_lng,
                a.id AS order_id, a.status AS order_status,
                a.pickup_lat, a.pickup_lng, a.dropoff_lat, a.dropoff_lng,
                f.id AS offer_order_id
           FROM drivers d
           LEFT JOIN orders a ON a.driver_id = d.id AND a.status IN ('assigned', 'arrived', 'in_progress')
           LEFT JOIN orders f ON f.offered_driver_id = d.id AND f.status = 'searching' AND f.offer_expires_at > now()
          WHERE d.tenant_id = $1 AND d.is_active`,
        [tenant.id],
      );
      for (const d of list) {
        try {
          await this.stepDriver(tenant.id, center, d);
        } catch (e: any) {
          this.log.debug(`Водитель ${d.id}: ${e.message}`);
        }
      }
    } catch (e: any) {
      this.log.warn(`Ошибка симулятора: ${e.message}`);
    } finally {
      this.running = false;
    }
  }

  private async stepDriver(tenantId: string, center: LatLng, d: any) {
    const user: AuthUser = { sub: d.id, role: 'driver', tid: tenantId };
    let sim = this.sims.get(d.id);
    if (!sim) {
      sim = { pos: d.last_lat !== null ? { lat: d.last_lat, lng: d.last_lng } : null, offerSeenTicks: 0, waitTicks: 0 };
      this.sims.set(d.id, sim);
    }
    // далеко от города (например, центр карты поменяли) — переносим ближе
    if (!sim.pos || haversineM(sim.pos.lat, sim.pos.lng, center.lat, center.lng) > SPAWN_RADIUS_M * 4) {
      sim.pos = randomNear(center, SPAWN_RADIUS_M);
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
        const m = moveToward(sim.pos, pickup, demoStepM(haversineM(sim.pos.lat, sim.pos.lng, pickup.lat, pickup.lng)));
        sim.pos = m.pos;
        await this.drivers.updateLocation(tenantId, d.id, sim.pos.lat, sim.pos.lng);
        if (m.arrived) {
          sim.waitTicks = 0;
          await this.orders.arrived(user, d.order_id);
        }
      } else if (d.order_status === 'arrived') {
        sim.waitTicks++;
        if (sim.waitTicks >= WAIT_AT_PICKUP_TICKS) await this.orders.start(user, d.order_id);
      } else if (d.order_status === 'in_progress') {
        // без точки назначения — короткая поездка в случайную сторону
        const target = d.dropoff_lat !== null ? { lat: d.dropoff_lat, lng: d.dropoff_lng } : randomNear(pickup, 1500);
        const m = moveToward(sim.pos, target, demoStepM(haversineM(sim.pos.lat, sim.pos.lng, target.lat, target.lng)));
        sim.pos = m.pos;
        await this.drivers.updateLocation(tenantId, d.id, sim.pos.lat, sim.pos.lng);
        if (m.arrived || d.dropoff_lat === null) await this.orders.complete(user, d.order_id);
      }
      return;
    }

    // 3. Свободен — немного катается, не уезжая далеко от центра
    const wander = haversineM(sim.pos.lat, sim.pos.lng, center.lat, center.lng) > SPAWN_RADIUS_M
      ? moveToward(sim.pos, center, IDLE_WANDER_M * 3).pos
      : randomNear(sim.pos, IDLE_WANDER_M);
    sim.pos = wander;
    await this.drivers.updateLocation(tenantId, d.id, sim.pos.lat, sim.pos.lng);
  }
}

function toLatLng(v: unknown): LatLng | null {
  return Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number') ? { lat: v[0], lng: v[1] } : null;
}

@Module({
  imports: [DriversModule, OrdersModule],
  providers: [DemoService],
})
export class DemoModule {}

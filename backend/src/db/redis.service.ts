import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { config } from '../config';
import { haversineM } from '../pricing/pricing';

export interface NearbyDriver {
  driverId: string;
  distanceM: number;
}

/**
 * Живые координаты водителей «на линии» и небольшой кэш.
 *
 * Обычно хранится в Redis (GEO-индекс на таксопарк). Если Redis не задан
 * (нет REDIS_URL / REDIS_HOST, или REDIS_URL=memory) — всё держится в памяти процесса.
 * Это годится для теста и одного сервера; координаты после перезапуска
 * восстанавливаются сами — водители присылают их каждые несколько секунд.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly log = new Logger('Redis');
  readonly memory = config.redisUrl === 'memory';
  readonly client: Redis | null = this.memory ? null : new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });

  private readonly geo = new Map<string, Map<string, { lat: number; lng: number }>>();
  private readonly cache = new Map<string, { value: string; expiresAt: number }>();

  constructor() {
    if (this.memory) this.log.warn('Redis не задан — координаты водителей и кэш хранятся в памяти (подходит для теста)');
  }

  private geoKey(tenantId: string) {
    return `geo:drivers:${tenantId}`;
  }

  private tenantGeo(tenantId: string) {
    let m = this.geo.get(tenantId);
    if (!m) this.geo.set(tenantId, (m = new Map()));
    return m;
  }

  async ping(): Promise<void> {
    if (this.client) await this.client.ping();
  }

  async setDriverLocation(tenantId: string, driverId: string, lat: number, lng: number) {
    if (!this.client) return void this.tenantGeo(tenantId).set(driverId, { lat, lng });
    await this.client.geoadd(this.geoKey(tenantId), lng, lat, driverId);
  }

  async removeDriver(tenantId: string, driverId: string) {
    if (!this.client) return void this.tenantGeo(tenantId).delete(driverId);
    await this.client.zrem(this.geoKey(tenantId), driverId);
  }

  async getDriverLocations(tenantId: string, driverIds: string[]): Promise<Map<string, { lat: number; lng: number }>> {
    const result = new Map<string, { lat: number; lng: number }>();
    if (!driverIds.length) return result;
    if (!this.client) {
      const m = this.tenantGeo(tenantId);
      for (const id of driverIds) {
        const p = m.get(id);
        if (p) result.set(id, p);
      }
      return result;
    }
    const positions = await this.client.geopos(this.geoKey(tenantId), ...driverIds);
    positions.forEach((pos, i) => {
      if (pos) result.set(driverIds[i], { lng: Number(pos[0]), lat: Number(pos[1]) });
    });
    return result;
  }

  /** Водители в радиусе radiusKm от точки, ближайшие первыми */
  async findNearby(tenantId: string, lat: number, lng: number, radiusKm: number, limit = 30): Promise<NearbyDriver[]> {
    if (!this.client) {
      const out: NearbyDriver[] = [];
      for (const [driverId, p] of this.tenantGeo(tenantId)) {
        const d = haversineM(lat, lng, p.lat, p.lng);
        if (d <= radiusKm * 1000) out.push({ driverId, distanceM: Math.round(d) });
      }
      return out.sort((a, b) => a.distanceM - b.distanceM).slice(0, limit);
    }
    let raw: [string, string][];
    try {
      raw = (await this.client.call(
        'GEOSEARCH', this.geoKey(tenantId),
        'FROMLONLAT', String(lng), String(lat),
        'BYRADIUS', String(radiusKm), 'km',
        'ASC', 'COUNT', String(limit), 'WITHDIST',
      )) as [string, string][];
    } catch (e: any) {
      // Redis старше 6.2 не знает GEOSEARCH — используем GEORADIUS
      if (!/unknown command/i.test(e?.message ?? '')) throw e;
      raw = (await this.client.call(
        'GEORADIUS', this.geoKey(tenantId), String(lng), String(lat), String(radiusKm), 'km',
        'WITHDIST', 'COUNT', String(limit), 'ASC',
      )) as [string, string][];
    }
    return raw.map(([driverId, distKm]) => ({ driverId, distanceM: Math.round(Number(distKm) * 1000) }));
  }

  /** Кэш с временем жизни (поиск адресов) */
  async cacheGet(key: string): Promise<string | null> {
    if (this.client) return this.client.get(key);
    const hit = this.cache.get(key);
    if (!hit) return null;
    if (hit.expiresAt < Date.now()) {
      this.cache.delete(key);
      return null;
    }
    return hit.value;
  }

  async cacheSet(key: string, value: string, ttlSec: number): Promise<void> {
    if (this.client) return void (await this.client.set(key, value, 'EX', ttlSec));
    if (this.cache.size > 5000) this.cache.clear(); // не даём памяти расти бесконечно
    this.cache.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
  }

  async onModuleDestroy() {
    this.client?.disconnect();
  }
}

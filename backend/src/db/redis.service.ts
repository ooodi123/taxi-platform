import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { config } from '../config';

export interface NearbyDriver {
  driverId: string;
  distanceM: number;
}

/**
 * Redis хранит живые координаты водителей «на линии» (GEO-индекс на таксопарк).
 * Поиск ближайших машин идёт здесь — это быстрее, чем в Postgres.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });

  private geoKey(tenantId: string) {
    return `geo:drivers:${tenantId}`;
  }

  async setDriverLocation(tenantId: string, driverId: string, lat: number, lng: number) {
    await this.client.geoadd(this.geoKey(tenantId), lng, lat, driverId);
  }

  async removeDriver(tenantId: string, driverId: string) {
    await this.client.zrem(this.geoKey(tenantId), driverId);
  }

  async getDriverLocations(tenantId: string, driverIds: string[]): Promise<Map<string, { lat: number; lng: number }>> {
    const result = new Map<string, { lat: number; lng: number }>();
    if (!driverIds.length) return result;
    const positions = await this.client.geopos(this.geoKey(tenantId), ...driverIds);
    positions.forEach((pos, i) => {
      if (pos) result.set(driverIds[i], { lng: Number(pos[0]), lat: Number(pos[1]) });
    });
    return result;
  }

  /** Водители в радиусе radiusKm от точки, ближайшие первыми */
  async findNearby(tenantId: string, lat: number, lng: number, radiusKm: number, limit = 30): Promise<NearbyDriver[]> {
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

  async onModuleDestroy() {
    this.client.disconnect();
  }
}

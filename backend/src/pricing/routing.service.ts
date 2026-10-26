import { Injectable, Logger } from '@nestjs/common';
import { config } from '../config';
import { haversineM } from './pricing';

export interface Point {
  lat: number;
  lng: number;
}

export interface RouteInfo {
  distanceM: number;
  durationS: number;
  source: 'osrm' | 'estimate';
}

/** Поправка «по дорогам длиннее, чем по прямой» и средняя скорость в городе */
const ROAD_FACTOR = 1.35;
const CITY_SPEED_KMH = 25;

/**
 * Расстояние и время поездки.
 * Если задан OSRM_URL — берём реальный маршрут по дорогам (бесплатный OSRM на своём сервере).
 * Иначе (или если OSRM не ответил) — оценка по прямой с поправкой.
 */
@Injectable()
export class RoutingService {
  private readonly log = new Logger('Routing');

  async route(from: Point, to: Point): Promise<RouteInfo> {
    if (config.osrmUrl) {
      try {
        return await this.osrm(from, to);
      } catch (e: any) {
        this.log.warn(`OSRM недоступен, считаю по прямой: ${e.message}`);
      }
    }
    return estimateRoute(from, to);
  }

  private async osrm(from: Point, to: Point): Promise<RouteInfo> {
    const url = `${config.osrmUrl}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body: any = await res.json();
    const r = body?.routes?.[0];
    if (body?.code !== 'Ok' || !r) throw new Error(`маршрут не найден (${body?.code})`);
    return { distanceM: Math.round(r.distance), durationS: Math.round(r.duration), source: 'osrm' };
  }
}

export function estimateRoute(from: Point, to: Point): RouteInfo {
  const distanceM = Math.round(haversineM(from.lat, from.lng, to.lat, to.lng) * ROAD_FACTOR);
  const durationS = Math.round((distanceM / 1000 / CITY_SPEED_KMH) * 3600);
  return { distanceM, durationS, source: 'estimate' };
}

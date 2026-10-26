import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'crypto';
import { config } from '../config';
import { RedisService } from '../db/redis.service';

export interface GeoPlace {
  lat: number;
  lng: number;
  title: string; // коротко: «Тверская улица, 7»
  subtitle: string; // уточнение: «Москва»
}

const CACHE_TTL_SEC = 7 * 24 * 3600;

/**
 * Поиск адресов (геокодер). Работает через сервер, а не из браузера, чтобы:
 *  - можно было поменять провайдера в одном месте (свой Nominatim, Photon, 2ГИС, Яндекс);
 *  - кэшировать ответы в Redis и не упираться в лимиты;
 *  - передавать User-Agent, которого требует публичный Nominatim.
 *
 * Публичный nominatim.openstreetmap.org разрешает ~1 запрос в секунду — для старта хватит,
 * под нагрузкой поднимите свой Nominatim и укажите GEOCODER_URL.
 */
@Injectable()
export class GeoService {
  private readonly log = new Logger('Geo');
  private lastRequestAt = 0;

  constructor(private readonly redis: RedisService) {}

  async search(query: string, near?: { lat: number; lng: number }): Promise<GeoPlace[]> {
    const q = query.trim().replace(/\s+/g, ' ');
    if (q.length < 3) return [];
    const params = new URLSearchParams({
      q, format: 'jsonv2', addressdetails: '1', limit: '7', 'accept-language': config.geocoderLanguage,
    });
    if (near) {
      // ищем в первую очередь рядом (±0.5° ≈ 50 км), но не только там
      const d = 0.5;
      params.set('viewbox', `${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}`);
    }
    const rows = await this.cached('s', params, () => this.request('/search', params));
    return (rows as any[]).map(toPlace).filter((p): p is GeoPlace => !!p);
  }

  async reverse(lat: number, lng: number): Promise<GeoPlace | null> {
    // округление до ~10 м — соседние точки берутся из кэша
    const params = new URLSearchParams({
      lat: lat.toFixed(4), lon: lng.toFixed(4), format: 'jsonv2', addressdetails: '1', zoom: '18',
      'accept-language': config.geocoderLanguage,
    });
    const row = await this.cached('r', params, () => this.request('/reverse', params));
    const place = toPlace(row);
    return place ? { ...place, lat, lng } : null;
  }

  private async cached(kind: string, params: URLSearchParams, load: () => Promise<unknown>) {
    const key = `geo:${kind}:${createHash('sha1').update(params.toString()).digest('hex')}`;
    const hit = await this.redis.client.get(key).catch(() => null);
    if (hit) return JSON.parse(hit);
    const value = await load();
    await this.redis.client.set(key, JSON.stringify(value), 'EX', CACHE_TTL_SEC).catch(() => undefined);
    return value;
  }

  private async request(path: string, params: URLSearchParams): Promise<unknown> {
    // не чаще ~1 запроса в секунду с одного сервера (правило публичного Nominatim)
    const wait = this.lastRequestAt + 1000 - Date.now();
    this.lastRequestAt = Date.now() + Math.max(0, wait);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      const res = await fetch(`${config.geocoderUrl}${path}?${params}`, {
        headers: { 'User-Agent': config.geocoderUserAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e: any) {
      this.log.warn(`Геокодер не ответил: ${e.message}`);
      throw new ServiceUnavailableException('Поиск адресов временно недоступен');
    }
  }
}

/** Ответ Nominatim → короткий адрес для интерфейса */
export function toPlace(r: any): GeoPlace | null {
  if (!r || r.error || r.lat === undefined) return null;
  const a = r.address ?? {};
  const street = a.road ?? a.pedestrian ?? a.footway ?? a.square ?? a.neighbourhood ?? null;
  const house = a.house_number ?? null;
  const city = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality ?? a.state ?? '';
  const named = r.name && r.name !== street ? r.name : null; // ТЦ, вокзал, кафе
  let title: string;
  if (named) title = named;
  else if (street) title = house ? `${street}, ${house}` : street;
  else title = String(r.display_name ?? '').split(',')[0] || 'Точка на карте';
  const subtitle = named && street ? [house ? `${street}, ${house}` : street, city].filter(Boolean).join(', ') : city;
  return { lat: Number(r.lat), lng: Number(r.lon), title, subtitle };
}

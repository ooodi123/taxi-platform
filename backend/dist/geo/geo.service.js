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
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeoService = void 0;
exports.toPlace = toPlace;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const config_1 = require("../config");
const redis_service_1 = require("../db/redis.service");
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
let GeoService = class GeoService {
    redis;
    log = new common_1.Logger('Geo');
    lastRequestAt = 0;
    constructor(redis) {
        this.redis = redis;
    }
    async search(query, near) {
        const q = query.trim().replace(/\s+/g, ' ');
        if (q.length < 3)
            return [];
        const params = new URLSearchParams({
            q, format: 'jsonv2', addressdetails: '1', limit: '7', 'accept-language': config_1.config.geocoderLanguage,
        });
        if (near) {
            // ищем в первую очередь рядом (±0.5° ≈ 50 км), но не только там
            const d = 0.5;
            params.set('viewbox', `${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}`);
        }
        const rows = await this.cached('s', params, () => this.request('/search', params));
        return rows.map(toPlace).filter((p) => !!p);
    }
    async reverse(lat, lng) {
        // округление до ~10 м — соседние точки берутся из кэша
        const params = new URLSearchParams({
            lat: lat.toFixed(4), lon: lng.toFixed(4), format: 'jsonv2', addressdetails: '1', zoom: '18',
            'accept-language': config_1.config.geocoderLanguage,
        });
        const row = await this.cached('r', params, () => this.request('/reverse', params));
        const place = toPlace(row);
        return place ? { ...place, lat, lng } : null;
    }
    async cached(kind, params, load) {
        const key = `geo:${kind}:${(0, crypto_1.createHash)('sha1').update(params.toString()).digest('hex')}`;
        const hit = await this.redis.cacheGet(key).catch(() => null);
        if (hit)
            return JSON.parse(hit);
        const value = await load();
        await this.redis.cacheSet(key, JSON.stringify(value), CACHE_TTL_SEC).catch(() => undefined);
        return value;
    }
    async request(path, params) {
        // не чаще ~1 запроса в секунду с одного сервера (правило публичного Nominatim)
        const wait = this.lastRequestAt + 1000 - Date.now();
        this.lastRequestAt = Date.now() + Math.max(0, wait);
        if (wait > 0)
            await new Promise((r) => setTimeout(r, wait));
        try {
            const res = await fetch(`${config_1.config.geocoderUrl}${path}?${params}`, {
                headers: { 'User-Agent': config_1.config.geocoderUserAgent, Accept: 'application/json' },
                signal: AbortSignal.timeout(5000),
            });
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
            return await res.json();
        }
        catch (e) {
            this.log.warn(`Геокодер не ответил: ${e.message}`);
            throw new common_1.ServiceUnavailableException('Поиск адресов временно недоступен');
        }
    }
};
exports.GeoService = GeoService;
exports.GeoService = GeoService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [typeof (_a = typeof redis_service_1.RedisService !== "undefined" && redis_service_1.RedisService) === "function" ? _a : Object])
], GeoService);
/** Ответ Nominatim → короткий адрес для интерфейса */
function toPlace(r) {
    if (!r || r.error || r.lat === undefined)
        return null;
    const a = r.address ?? {};
    const street = a.road ?? a.pedestrian ?? a.footway ?? a.square ?? a.neighbourhood ?? null;
    const house = a.house_number ?? null;
    const city = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality ?? a.state ?? '';
    const named = r.name && r.name !== street ? r.name : null; // ТЦ, вокзал, кафе
    let title;
    if (named)
        title = named;
    else if (street)
        title = house ? `${street}, ${house}` : street;
    else
        title = String(r.display_name ?? '').split(',')[0] || 'Точка на карте';
    const subtitle = named && street ? [house ? `${street}, ${house}` : street, city].filter(Boolean).join(', ') : city;
    return { lat: Number(r.lat), lng: Number(r.lon), title, subtitle };
}

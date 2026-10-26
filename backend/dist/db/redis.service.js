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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisService = void 0;
const common_1 = require("@nestjs/common");
const ioredis_1 = __importDefault(require("ioredis"));
const config_1 = require("../config");
const pricing_1 = require("../pricing/pricing");
/**
 * Живые координаты водителей «на линии» и небольшой кэш.
 *
 * Обычно хранится в Redis (GEO-индекс на таксопарк). Если Redis не задан
 * (нет REDIS_URL / REDIS_HOST, или REDIS_URL=memory) — всё держится в памяти процесса.
 * Это годится для теста и одного сервера; координаты после перезапуска
 * восстанавливаются сами — водители присылают их каждые несколько секунд.
 */
let RedisService = class RedisService {
    log = new common_1.Logger('Redis');
    memory = config_1.config.redisUrl === 'memory';
    client = this.memory ? null : new ioredis_1.default(config_1.config.redisUrl, { maxRetriesPerRequest: 3 });
    geo = new Map();
    cache = new Map();
    constructor() {
        if (this.memory)
            this.log.warn('Redis не задан — координаты водителей и кэш хранятся в памяти (подходит для теста)');
    }
    geoKey(tenantId) {
        return `geo:drivers:${tenantId}`;
    }
    tenantGeo(tenantId) {
        let m = this.geo.get(tenantId);
        if (!m)
            this.geo.set(tenantId, (m = new Map()));
        return m;
    }
    async ping() {
        if (this.client)
            await this.client.ping();
    }
    async setDriverLocation(tenantId, driverId, lat, lng) {
        if (!this.client)
            return void this.tenantGeo(tenantId).set(driverId, { lat, lng });
        await this.client.geoadd(this.geoKey(tenantId), lng, lat, driverId);
    }
    async removeDriver(tenantId, driverId) {
        if (!this.client)
            return void this.tenantGeo(tenantId).delete(driverId);
        await this.client.zrem(this.geoKey(tenantId), driverId);
    }
    async getDriverLocations(tenantId, driverIds) {
        const result = new Map();
        if (!driverIds.length)
            return result;
        if (!this.client) {
            const m = this.tenantGeo(tenantId);
            for (const id of driverIds) {
                const p = m.get(id);
                if (p)
                    result.set(id, p);
            }
            return result;
        }
        const positions = await this.client.geopos(this.geoKey(tenantId), ...driverIds);
        positions.forEach((pos, i) => {
            if (pos)
                result.set(driverIds[i], { lng: Number(pos[0]), lat: Number(pos[1]) });
        });
        return result;
    }
    /** Водители в радиусе radiusKm от точки, ближайшие первыми */
    async findNearby(tenantId, lat, lng, radiusKm, limit = 30) {
        if (!this.client) {
            const out = [];
            for (const [driverId, p] of this.tenantGeo(tenantId)) {
                const d = (0, pricing_1.haversineM)(lat, lng, p.lat, p.lng);
                if (d <= radiusKm * 1000)
                    out.push({ driverId, distanceM: Math.round(d) });
            }
            return out.sort((a, b) => a.distanceM - b.distanceM).slice(0, limit);
        }
        let raw;
        try {
            raw = (await this.client.call('GEOSEARCH', this.geoKey(tenantId), 'FROMLONLAT', String(lng), String(lat), 'BYRADIUS', String(radiusKm), 'km', 'ASC', 'COUNT', String(limit), 'WITHDIST'));
        }
        catch (e) {
            // Redis старше 6.2 не знает GEOSEARCH — используем GEORADIUS
            if (!/unknown command/i.test(e?.message ?? ''))
                throw e;
            raw = (await this.client.call('GEORADIUS', this.geoKey(tenantId), String(lng), String(lat), String(radiusKm), 'km', 'WITHDIST', 'COUNT', String(limit), 'ASC'));
        }
        return raw.map(([driverId, distKm]) => ({ driverId, distanceM: Math.round(Number(distKm) * 1000) }));
    }
    /** Кэш с временем жизни (поиск адресов) */
    async cacheGet(key) {
        if (this.client)
            return this.client.get(key);
        const hit = this.cache.get(key);
        if (!hit)
            return null;
        if (hit.expiresAt < Date.now()) {
            this.cache.delete(key);
            return null;
        }
        return hit.value;
    }
    async cacheSet(key, value, ttlSec) {
        if (this.client)
            return void (await this.client.set(key, value, 'EX', ttlSec));
        if (this.cache.size > 5000)
            this.cache.clear(); // не даём памяти расти бесконечно
        this.cache.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
    }
    async onModuleDestroy() {
        this.client?.disconnect();
    }
};
exports.RedisService = RedisService;
exports.RedisService = RedisService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], RedisService);

"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoutingService = void 0;
exports.estimateRoute = estimateRoute;
const common_1 = require("@nestjs/common");
const config_1 = require("../config");
const pricing_1 = require("./pricing");
/** Поправка «по дорогам длиннее, чем по прямой» и средняя скорость в городе */
const ROAD_FACTOR = 1.35;
const CITY_SPEED_KMH = 25;
/**
 * Расстояние и время поездки.
 * Если задан OSRM_URL — берём реальный маршрут по дорогам (бесплатный OSRM на своём сервере).
 * Иначе (или если OSRM не ответил) — оценка по прямой с поправкой.
 */
let RoutingService = class RoutingService {
    log = new common_1.Logger('Routing');
    async route(from, to) {
        if (config_1.config.osrmUrl) {
            try {
                return await this.osrm(from, to);
            }
            catch (e) {
                this.log.warn(`OSRM недоступен, считаю по прямой: ${e.message}`);
            }
        }
        return estimateRoute(from, to);
    }
    async osrm(from, to) {
        const url = `${config_1.config.osrmUrl}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
        const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        const r = body?.routes?.[0];
        if (body?.code !== 'Ok' || !r)
            throw new Error(`маршрут не найден (${body?.code})`);
        return { distanceM: Math.round(r.distance), durationS: Math.round(r.duration), source: 'osrm' };
    }
};
exports.RoutingService = RoutingService;
exports.RoutingService = RoutingService = __decorate([
    (0, common_1.Injectable)()
], RoutingService);
function estimateRoute(from, to) {
    const distanceM = Math.round((0, pricing_1.haversineM)(from.lat, from.lng, to.lat, to.lng) * ROAD_FACTOR);
    const durationS = Math.round((distanceM / 1000 / CITY_SPEED_KMH) * 3600);
    return { distanceM, durationS, source: 'estimate' };
}

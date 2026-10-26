"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calcPrice = calcPrice;
exports.haversineM = haversineM;
/**
 * Цена поездки: подача + км + минуты, не меньше минималки,
 * округление вверх до шага тарифа.
 */
function calcPrice(t, distanceM, durationS) {
    const raw = t.baseFare + (t.perKm * Math.max(0, distanceM)) / 1000 + (t.perMin * Math.max(0, durationS)) / 60;
    const price = Math.max(raw, t.minFare);
    const step = t.roundTo > 0 ? t.roundTo : 0.01;
    // -1e-9 защищает от ошибок плавающей точки: 240.00000001 не должно стать 250
    const rounded = Math.ceil(price / step - 1e-9) * step;
    return Math.round(rounded * 100) / 100;
}
const EARTH_RADIUS_M = 6_371_000;
/** Расстояние по прямой между двумя точками, в метрах */
function haversineM(lat1, lng1, lat2, lng2) {
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

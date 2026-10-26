"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.moveToward = moveToward;
exports.randomNear = randomNear;
exports.demoStepM = demoStepM;
const pricing_1 = require("../pricing/pricing");
/**
 * Сдвинуть точку в сторону цели не больше чем на stepM метров (по прямой).
 * Возвращает новую точку и признак «доехали».
 */
function moveToward(from, to, stepM) {
    const dist = (0, pricing_1.haversineM)(from.lat, from.lng, to.lat, to.lng);
    if (dist <= stepM)
        return { pos: { lat: to.lat, lng: to.lng }, arrived: true };
    const k = stepM / dist;
    return { pos: { lat: from.lat + (to.lat - from.lat) * k, lng: from.lng + (to.lng - from.lng) * k }, arrived: false };
}
/** Случайная точка в радиусе radiusM от центра (равномерно по площади) */
function randomNear(center, radiusM, rnd = Math.random) {
    const r = radiusM * Math.sqrt(rnd());
    const a = rnd() * 2 * Math.PI;
    const dLat = (r * Math.cos(a)) / 111_320;
    const dLng = (r * Math.sin(a)) / (111_320 * Math.cos((center.lat * Math.PI) / 180));
    return { lat: center.lat + dLat, lng: center.lng + dLng };
}
/**
 * Шаг машины за один тик симулятора. Едет быстро (демо!), но так, чтобы путь
 * занимал около 8–12 тиков: видно движение на карте, и ждать недолго.
 */
function demoStepM(distanceM) {
    return Math.min(Math.max(distanceM / 6, 80), 700);
}

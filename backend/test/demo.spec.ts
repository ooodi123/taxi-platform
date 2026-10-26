import { demoStepM, moveToward, randomNear } from '../src/demo/movement';
import { haversineM } from '../src/pricing/pricing';

describe('Движение машин в демо-режиме', () => {
  const a = { lat: 55.75, lng: 37.6 };
  const b = { lat: 55.76, lng: 37.6 }; // ≈ 1112 м севернее

  it('шаг в сторону цели на заданное расстояние', () => {
    const m = moveToward(a, b, 100);
    expect(m.arrived).toBe(false);
    expect(Math.round(haversineM(a.lat, a.lng, m.pos.lat, m.pos.lng))).toBe(100);
    expect(m.pos.lat).toBeGreaterThan(a.lat);
  });

  it('последний шаг — точно в цель', () => {
    const m = moveToward(a, b, 5000);
    expect(m.arrived).toBe(true);
    expect(m.pos).toEqual(b);
  });

  it('путь занимает около 10 тиков', () => {
    let pos = a, ticks = 0;
    for (; ticks < 50; ticks++) {
      const m = moveToward(pos, b, demoStepM(haversineM(pos.lat, pos.lng, b.lat, b.lng)));
      pos = m.pos;
      if (m.arrived) break;
    }
    expect(ticks).toBeGreaterThan(3);
    expect(ticks).toBeLessThan(20);
  });

  it('случайная точка не дальше радиуса', () => {
    for (let i = 0; i < 200; i++) {
      const p = randomNear(a, 2500);
      expect(haversineM(a.lat, a.lng, p.lat, p.lng)).toBeLessThanOrEqual(2501);
    }
  });
});

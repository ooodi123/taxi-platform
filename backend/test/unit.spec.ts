import { calcPrice, haversineM } from '../src/pricing/pricing';
import { estimateRoute } from '../src/pricing/routing.service';
import { canTransition } from '../src/orders/order-status';

describe('Расчёт цены', () => {
  const econom = { baseFare: 50, perKm: 15, perMin: 5, minFare: 150, roundTo: 10 };

  it('подача + км + минуты, округление вверх до 10', () => {
    // 50 + 15*10 + 5*20 = 300
    expect(calcPrice(econom, 10_000, 1200)).toBe(300);
    // 50 + 15*10.3 + 5*20 = 304.5 → 310
    expect(calcPrice(econom, 10_300, 1200)).toBe(310);
  });

  it('не меньше минималки', () => {
    expect(calcPrice(econom, 500, 60)).toBe(150);
    expect(calcPrice(econom, 0, 0)).toBe(150);
  });

  it('ровная сумма не округляется лишний раз', () => {
    expect(calcPrice({ ...econom, minFare: 0 }, 2_000, 0)).toBe(80);
  });

  it('копейки при шаге 0.01', () => {
    expect(calcPrice({ baseFare: 0, perKm: 10, perMin: 0, minFare: 0, roundTo: 0.01 }, 1_234, 0)).toBe(12.34);
  });
});

describe('Маршрут без OSRM', () => {
  it('расстояние по прямой ~ 1 км на 0.009° широты', () => {
    expect(Math.round(haversineM(55.75, 37.6, 55.759, 37.6))).toBeGreaterThan(990);
    expect(Math.round(haversineM(55.75, 37.6, 55.759, 37.6))).toBeLessThan(1010);
  });

  it('оценка учитывает поправку на дороги', () => {
    const r = estimateRoute({ lat: 55.75, lng: 37.6 }, { lat: 55.759, lng: 37.6 });
    expect(r.distanceM).toBeGreaterThan(1300);
    expect(r.durationS).toBeGreaterThan(150);
    expect(r.source).toBe('estimate');
  });
});

describe('Статусы заказа', () => {
  it('разрешённые переходы', () => {
    expect(canTransition('searching', 'assigned')).toBe(true);
    expect(canTransition('assigned', 'arrived')).toBe(true);
    expect(canTransition('arrived', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'completed')).toBe(true);
    expect(canTransition('assigned', 'searching')).toBe(true);
  });

  it('запрещённые переходы', () => {
    expect(canTransition('searching', 'completed')).toBe(false);
    expect(canTransition('in_progress', 'searching')).toBe(false);
    expect(canTransition('completed', 'cancelled')).toBe(false);
  });
});

import { InitDataError, signInitData, verifyInitData } from '../src/telegram/init-data';
import { formatPrice, offerMessage, statusMessage } from '../src/telegram/telegram.service';
import { toPlace } from '../src/geo/geo.service';

const TOKEN = '123456789:AAFakeTokenForTestsOnly_abcdefghijklmnop';
const NOW = 1_760_000_000;
const user = JSON.stringify({ id: 7001, first_name: 'Анна', username: 'anna' });

describe('Проверка подписи Telegram Mini App', () => {
  const initData = signInitData({ auth_date: String(NOW - 60), query_id: 'AAE1', user }, TOKEN);

  it('принимает правильную подпись', () => {
    const r = verifyInitData(initData, TOKEN, 86400, NOW);
    expect(r.user.id).toBe(7001);
    expect(r.user.first_name).toBe('Анна');
  });

  it('отклоняет подпись чужого бота', () => {
    expect(() => verifyInitData(initData, TOKEN.replace('AAF', 'AAG'), 86400, NOW)).toThrow(InitDataError);
  });

  it('отклоняет подменённого пользователя', () => {
    const forged = initData.replace(encodeURIComponent('7001'), encodeURIComponent('7002'));
    expect(forged).not.toBe(initData);
    expect(() => verifyInitData(forged, TOKEN, 86400, NOW)).toThrow('Неверная подпись');
  });

  it('отклоняет устаревшую сессию', () => {
    expect(() => verifyInitData(initData, TOKEN, 30, NOW)).toThrow('устарела');
  });

  it('отклоняет данные без подписи', () => {
    expect(() => verifyInitData('user=%7B%7D&auth_date=1', TOKEN, 86400, NOW)).toThrow('Нет подписи');
  });

  it('читает start_param', () => {
    const d = signInitData({ auth_date: String(NOW), user, start_param: 'demo' }, TOKEN);
    expect(verifyInitData(d, TOKEN, 86400, NOW).startParam).toBe('demo');
  });
});

describe('Уведомления пассажиру', () => {
  const base: any = {
    status: 'assigned', currency: 'RUB', estimatedPrice: 420, finalPrice: null, cancelledBy: null, cancelReason: null,
    driver: { name: 'Иван', car: { model: 'Kia Rio', color: 'белый', plate: 'А001АА' } },
  };

  it('машина найдена — с номером', () => {
    expect(statusMessage(base, 'searching')).toContain('белый Kia Rio, А001АА');
  });

  it('первый поиск не дублируется в чат', () => {
    expect(statusMessage({ ...base, status: 'searching' }, null)).toBeNull();
  });

  it('водитель отказался — сообщаем о новом поиске', () => {
    expect(statusMessage({ ...base, status: 'searching' }, 'assigned')).toContain('Ищем другую');
  });

  it('свою отмену пассажиру не пишем, чужую — пишем', () => {
    expect(statusMessage({ ...base, status: 'cancelled', cancelledBy: 'passenger' }, 'assigned')).toBeNull();
    expect(statusMessage({ ...base, status: 'cancelled', cancelledBy: 'dispatcher', cancelReason: 'нет машин' }, 'searching'))
      .toBe('❌ Заказ отменён: нет машин.');
  });

  it('итог поездки с ценой', () => {
    expect(statusMessage({ ...base, status: 'completed', finalPrice: 1250 }, 'in_progress')).toContain('1 250 ₽');
    expect(formatPrice(99.5, 'MDL')).toBe('99.50 лей');
  });
});

describe('Адрес из геокодера', () => {
  it('улица и дом', () => {
    expect(toPlace({ lat: '55.7', lon: '37.6', address: { road: 'Тверская улица', house_number: '7', city: 'Москва' } }))
      .toEqual({ lat: 55.7, lng: 37.6, title: 'Тверская улица, 7', subtitle: 'Москва' });
  });

  it('место с названием', () => {
    const p = toPlace({ lat: '55.7', lon: '37.6', name: 'Парк Горького', address: { road: 'Крымский Вал', house_number: '9', city: 'Москва' } });
    expect(p!.title).toBe('Парк Горького');
    expect(p!.subtitle).toBe('Крымский Вал, 9, Москва');
  });

  it('пустой ответ', () => {
    expect(toPlace({ error: 'Unable to geocode' })).toBeNull();
  });
});

describe('Сообщение водителю о заказе', () => {
  const v: any = {
    estimatedPrice: 610, currency: 'RUB', tariff: { name: 'Комфорт' }, distanceM: 4120, comment: 'Второй подъезд',
    pickup: { address: 'Тверская улица, 7' }, dropoff: { address: 'Парк Горького' },
  };

  it('цена, подача, куда, комментарий и время на ответ', () => {
    const m = offerMessage(v, 420, 15);
    expect(m).toContain('610 ₽ (Комфорт)');
    expect(m).toContain('Подача: 420 м от вас, Тверская улица, 7');
    expect(m).toContain('Куда: Парк Горького (4,1 км)');
    expect(m).toContain('Комментарий: Второй подъезд');
    expect(m).toContain('за 15 сек');
  });

  it('без точки назначения', () => {
    expect(offerMessage({ ...v, dropoff: null, comment: null }, 1500, 15)).not.toContain('Куда');
  });
});

/**
 * Полный цикл через HTTP и сокеты на настоящих Postgres и Redis.
 * Нужна отдельная тестовая база: TEST_DATABASE_URL (по умолчанию taxi_test) — она ОЧИЩАЕТСЯ.
 */
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://taxi:taxi@localhost:5432/taxi_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15';
process.env.DEV_AUTH = 'true';
process.env.SUPER_ADMIN_KEY = 'test-super-key-123456';
process.env.OFFER_TIMEOUT_SEC = '2';
process.env.OFFER_TIMEOUT_COOLDOWN_SEC = '60';
process.env.DISPATCH_SWEEP_MS = '200';
process.env.DISPATCH_RETRY_SEC = '1';
process.env.SEARCH_RADII_KM = '2,5';
process.env.OSRM_URL = '';

import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import Redis from 'ioredis';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';

jest.setTimeout(60_000);

// точка подачи и места водителей (≈ 100 м и ≈ 1 км от неё)
const A = { lat: 55.7558, lng: 37.6173, address: 'Красная площадь' };
const B = { lat: 55.7298, lng: 37.6033, address: 'Парк Горького' };
const NEAR = { lat: 55.7567, lng: 37.6173 };
const FAR = { lat: 55.7648, lng: 37.6173 };

let app: INestApplication;
let http: any;
let baseUrl: string;
const sockets: Socket[] = [];

async function resetStores() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await pool.end();
  const redis = new Redis(process.env.REDIS_URL!);
  await redis.flushdb();
  redis.disconnect();
}

async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, what: string, timeoutMs = 8000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - start > timeoutMs) throw new Error(`Не дождались: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

function connect(token: string): Promise<Socket & { log: { event: string; data: any }[] }> {
  return new Promise((resolve, reject) => {
    const s = io(baseUrl, { auth: { token }, transports: ['websocket'], forceNew: true }) as any;
    s.log = [];
    s.onAny((event: string, data: any) => s.log.push({ event, data }));
    s.on('ready', () => resolve(s));
    s.on('connect_error', reject);
    sockets.push(s);
  });
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const get = (path: string, token: string) => request(http).get(`/api${path}`).set(auth(token));
const post = (path: string, token: string, body: object = {}) => request(http).post(`/api${path}`).set(auth(token)).send(body);

describe('Платформа такси: полный цикл', () => {
  let owner: string;
  let tenantSlug: string;
  let d1: { id: string; token: string };
  let d2: { id: string; token: string };
  let pass: string;
  let comfortId: string;

  beforeAll(async () => {
    await resetStores();
    const { createApp } = await import('../src/app.factory');
    app = await createApp({ logger: false });
    await app.listen(0);
    http = app.getHttpServer();
    const addr = http.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await app?.close();
  });

  it('health', async () => {
    const r = await request(http).get('/api/health').expect(200);
    expect(r.body.ok).toBe(true);
  });

  it('без ключа супер-админа таксопарк не создать', async () => {
    await request(http).post('/api/admin/tenants').send({ name: 'X', slug: 'x' }).expect(401);
    await request(http).post('/api/admin/tenants').set('X-Super-Admin-Key', 'wrong').send({ name: 'X', slug: 'x' }).expect(401);
  });

  it('супер-админ создаёт таксопарк, владелец входит', async () => {
    const r = await request(http)
      .post('/api/admin/tenants')
      .set('X-Super-Admin-Key', 'test-super-key-123456')
      .send({ name: 'Такси Тест', slug: 'test-taxi' })
      .expect(201);
    tenantSlug = r.body.tenant.slug;
    expect(r.body.owner.password).toBeTruthy();

    const login = await request(http).post('/api/auth/login').send(r.body.owner).expect(200);
    owner = login.body.token;
    expect(login.body.user.role).toBe('owner');
    await request(http).post('/api/auth/login').send({ login: r.body.owner.login, password: 'nope' }).expect(401);
  });

  it('владелец настраивает тариф и водителей', async () => {
    const tariffs = await get('/tariffs', owner).expect(200);
    expect(tariffs.body).toHaveLength(1);

    const comfort = await post('/tariffs', owner, { code: 'comfort', name: 'Комфорт', baseFare: 100, perKm: 25, perMin: 8, minFare: 300, roundTo: 10 }).expect(201);
    comfortId = comfort.body.id;
    await post('/tariffs', owner, { code: 'comfort', name: 'Дубль' }).expect(409);

    const a = await post('/drivers', owner, { name: 'Ближний', telegramId: 501, carModel: 'Kia Rio', carPlate: 'А111АА', tariffCodes: ['econom'] }).expect(201);
    const b = await post('/drivers', owner, { name: 'Дальний', telegramId: 502, carModel: 'Skoda Octavia', carPlate: 'В222ВВ' }).expect(201);
    await post('/drivers', owner, { name: 'Дубль', telegramId: 501 }).expect(409);

    const t1 = await request(http).post('/api/auth/dev/token').send({ tenantSlug, role: 'driver', telegramId: 501 }).expect(200);
    const t2 = await request(http).post('/api/auth/dev/token').send({ tenantSlug, role: 'driver', telegramId: 502 }).expect(200);
    d1 = { id: a.body.id, token: t1.body.token };
    d2 = { id: b.body.id, token: t2.body.token };
    await request(http).post('/api/auth/dev/token').send({ tenantSlug, role: 'driver', telegramId: 999 }).expect(404);

    const p = await request(http).post('/api/auth/dev/token').send({ tenantSlug, role: 'passenger', telegramId: 7001, name: 'Анна' }).expect(200);
    pass = p.body.token;
  });

  it('права: пассажир не управляет водителями, водитель не создаёт заказы', async () => {
    await get('/drivers', pass).expect(403);
    await post('/orders', d1.token, { pickup: A }).expect(403);
    await post('/tariffs', d1.token, { code: 'x1', name: 'x' }).expect(403);
  });

  it('водители выходят на линию', async () => {
    const s1 = await post('/driver/shift/start', d1.token, { location: NEAR }).expect(200);
    expect(s1.body.status).toBe('online');
    await post('/driver/shift/start', d2.token, { location: FAR }).expect(200);
    const live = await get('/drivers/live', owner).expect(200);
    expect(live.body).toHaveLength(2);
  });

  it('расчёт цены по тарифам', async () => {
    const r = await post('/orders/estimate', pass, { pickup: A, dropoff: B }).expect(200);
    expect(r.body.distanceM).toBeGreaterThan(3000);
    expect(r.body.options).toHaveLength(2);
    const [econom, comfort] = r.body.options;
    expect(econom.code).toBe('econom');
    expect(comfort.price).toBeGreaterThan(econom.price);
  });

  it('валидация координат', async () => {
    await post('/orders', pass, { pickup: { lat: 200, lng: 0 } }).expect(400);
    await post('/orders', pass, { pickup: A, hack: 1 }).expect(400);
  });

  let orderId: string;

  it('заказ → предложение ближнему → отказ → предложение дальнему → принят', async () => {
    const s1 = await connect(d1.token);
    const s2 = await connect(d2.token);
    const sp = await connect(pass);
    const disp = await connect(owner);

    const created = await post('/orders', pass, { pickup: A, dropoff: B, comment: 'у входа' }).expect(201);
    orderId = created.body.id;
    expect(created.body.status).toBe('searching');
    expect(created.body.offer).toBeUndefined(); // пассажир не видит, кому предложено

    // предложение уходит ближнему водителю
    const offer1 = await waitFor(async () => s1.log.find((e) => e.event === 'order:offer'), 'оффер водителю 1');
    expect(offer1.data.order.id).toBe(orderId);
    expect(offer1.data.order.passenger.phone).toBeNull();
    expect(offer1.data.distanceToPickupM).toBeLessThan(200);
    const cur = await get('/orders/current', d1.token).expect(200);
    expect(cur.body.offer.order.id).toBe(orderId);

    // второй заказ тем же пассажиром нельзя
    await post('/orders', pass, { pickup: A, dropoff: B }).expect(409);

    // чужой водитель не может принять
    await post(`/orders/${orderId}/accept`, d2.token).expect(409);

    await post(`/orders/${orderId}/decline`, d1.token).expect(200);
    const offer2 = await waitFor(async () => s2.log.find((e) => e.event === 'order:offer'), 'оффер водителю 2');
    expect(offer2.data.order.id).toBe(orderId);

    const acc = await post(`/orders/${orderId}/accept`, d2.token).expect(200);
    expect(acc.body.status).toBe('assigned');
    expect(acc.body.passenger.phone).toBeDefined();

    // пассажир получает карточку с водителем
    const upd = await waitFor(
      async () => sp.log.find((e) => e.event === 'order:updated' && e.data.status === 'assigned'),
      'пассажир видит назначение',
    );
    expect(upd.data.driver.name).toBe('Дальний');
    expect(upd.data.driver.car.plate).toBe('В222ВВ');
    // диспетчер тоже
    await waitFor(async () => disp.log.find((e) => e.event === 'order:updated' && e.data.status === 'assigned'), 'диспетчер видит назначение');

    const me = await get('/driver/me', d2.token).expect(200);
    expect(me.body.status).toBe('busy');
  });

  it('пассажир видит, как едет машина', async () => {
    const sp = sockets[2] as any;
    await post('/driver/location', d2.token, { lat: 55.76, lng: 37.6173 }).expect(200);
    const loc = await waitFor(async () => sp.log.find((e: any) => e.event === 'driver:location'), 'координаты у пассажира');
    expect(loc.data.orderId).toBe(orderId);

    // и через сокет
    const s2 = sockets[1];
    const ack = await s2.emitWithAck('driver:location', { lat: 55.7595, lng: 37.6173 });
    expect(ack.ok).toBe(true);
  });

  it('водитель подъехал, но отказался — заказ снова ищет машину', async () => {
    await post(`/orders/${orderId}/start`, d2.token).expect(409); // нельзя начать, не подъехав
    await post(`/orders/${orderId}/arrived`, d2.token).expect(200);
    await post(`/orders/${orderId}/cancel`, d2.token, { reason: 'сломалась машина' }).expect(200);

    const o = (await get(`/orders/${orderId}`, owner).expect(200)).body;
    expect(o.status).toBe('searching');
    expect(o.driver).toBeNull();
    expect((await get('/driver/me', d2.token)).body.status).toBe('online');
    // оба водителя уже отказались от этого заказа — повторно он им не предлагается
    await new Promise((r) => setTimeout(r, 600));
    expect((await get(`/orders/${orderId}`, owner)).body.offer).toBeNull();

    const sp = sockets[2] as any;
    await waitFor(async () => sp.log.find((e: any) => e.event === 'order:updated' && e.data.status === 'searching' && e.data.id === orderId), 'пассажир видит повторный поиск');
    const c = await post(`/orders/${orderId}/cancel`, pass).expect(200);
    expect(c.body.status).toBe('cancelled');
  });

  it('обычная поездка до конца', async () => {
    const created = await post('/orders', pass, { pickup: A, dropoff: B }).expect(201);
    const id = created.body.id;
    await waitFor(async () => (await get('/orders/current', d1.token)).body.offer, 'оффер водителю 1');
    await post(`/orders/${id}/accept`, d1.token).expect(200);
    await post(`/orders/${id}/arrived`, d1.token).expect(200);
    await post(`/orders/${id}/start`, d1.token).expect(200);
    await post(`/orders/${id}/cancel`, pass).expect(409); // в пути пассажир не отменяет
    await post('/driver/shift/end', d1.token).expect(409); // с заказом с линии не уйти
    const done = await post(`/orders/${id}/complete`, d1.token).expect(200);
    expect(done.body.status).toBe('completed');
    expect(done.body.finalPrice).toBe(created.body.estimatedPrice);
    expect((await get('/driver/me', d1.token)).body.status).toBe('online');

    const hist = await get('/orders?status=completed', pass).expect(200);
    expect(hist.body.map((o: any) => o.id)).toContain(id);
    const ev = await get(`/orders/${id}/events`, owner).expect(200);
    expect(ev.body.map((e: any) => e.type)).toEqual(
      expect.arrayContaining(['created', 'offered', 'accepted', 'arrived', 'in_progress', 'completed']),
    );
  });

  it('водитель не ответил — заказ уходит следующему', async () => {
    const created = await post('/orders', pass, { pickup: A, dropoff: B }).expect(201);
    const id = created.body.id;
    const first = await waitFor(async () => (await get(`/orders/${id}`, owner)).body.offer, 'первый оффер');
    expect(first.driverId).toBe(d1.id);
    // ждём таймаут 2 сек — предложение переходит ко второму
    const second = await waitFor(async () => {
      const o = (await get(`/orders/${id}`, owner)).body;
      return o.offer && o.offer.driverId !== d1.id ? o.offer : null;
    }, 'оффер второму после таймаута');
    expect(second.driverId).toBe(d2.id);

    // пассажир отменяет — у водителя 2 снимается предложение
    const s2 = sockets[1] as any;
    await post(`/orders/${id}/cancel`, pass, { reason: 'передумал' }).expect(200);
    await waitFor(async () => s2.log.find((e: any) => e.event === 'order:offer_cancelled' && e.data.orderId === id), 'снятие оффера');
  });

  it('тариф «Комфорт» предлагается только подходящим водителям', async () => {
    const created = await post('/orders', pass, { pickup: A, dropoff: B, tariffId: comfortId }).expect(201);
    const id = created.body.id;
    // водитель 1 возит только эконом, поэтому сразу второй, хоть он и дальше
    const offer = await waitFor(async () => (await get(`/orders/${id}`, owner)).body.offer, 'оффер комфорт');
    expect(offer.driverId).toBe(d2.id);
    await post(`/orders/${id}/cancel`, pass).expect(200);
  });

  it('диспетчер принимает заказ по телефону и назначает водителя вручную', async () => {
    await post('/orders', owner, { pickup: A }).expect(400); // нужен телефон клиента
    const created = await post('/orders', owner, { pickup: A, customerPhone: '+79990001122', customerName: 'Олег' }).expect(201);
    const id = created.body.id;
    expect(created.body.source).toBe('dispatcher');
    expect(created.body.estimatedPrice).toBe(150); // без точки назначения — минималка

    const assigned = await post(`/orders/${id}/assign`, owner, { driverId: d2.id }).expect(200);
    expect(assigned.body.status).toBe('assigned');
    expect(assigned.body.driver.id).toBe(d2.id);
    await post(`/orders/${id}/assign`, owner, { driverId: d1.id }).expect(409);
    // водитель видит телефон клиента
    const cur = await get('/orders/current', d2.token).expect(200);
    expect(cur.body.order.passenger.phone).toBe('+79990001122');
    await post(`/orders/${id}/cancel`, owner, { reason: 'клиент не вышел' }).expect(200);
    expect((await get('/driver/me', d2.token)).body.status).toBe('online');
  });

  it('никто не взял за отведённое время — заказ просрочен', async () => {
    await post('/driver/shift/end', d1.token).expect(200);
    await post('/driver/shift/end', d2.token).expect(200);
    const created = await post('/orders', pass, { pickup: A, dropoff: B }).expect(201);
    const id = created.body.id;
    // ускоряем время: заказ «создан» 10 минут назад
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(`UPDATE orders SET created_at = now() - interval '10 minutes' WHERE id = $1`, [id]);
    await pool.end();
    const o = await waitFor(async () => {
      const r = (await get(`/orders/${id}`, pass)).body;
      return r.status === 'expired' ? r : null;
    }, 'статус expired');
    expect(o.statusLabel).toBe('Машина не найдена');
  });

  it('таксопарки изолированы друг от друга', async () => {
    const r = await request(http)
      .post('/api/admin/tenants')
      .set('X-Super-Admin-Key', 'test-super-key-123456')
      .send({ name: 'Другой', slug: 'other' })
      .expect(201);
    const other = (await request(http).post('/api/auth/login').send(r.body.owner).expect(200)).body.token;
    await get(`/orders/${orderId}`, other).expect(404);
    expect((await get('/drivers', other)).body).toHaveLength(0);
    expect((await get('/orders', other)).body).toHaveLength(0);
    await post(`/orders/${orderId}/cancel`, other).expect(404);

    // отключённый таксопарк не может войти
    await request(http)
      .patch(`/api/admin/tenants/${r.body.tenant.id}`)
      .set('X-Super-Admin-Key', 'test-super-key-123456')
      .send({ isActive: false })
      .expect(200);
    await request(http).post('/api/auth/login').send(r.body.owner).expect(403);
  });

  it('сокет без токена отклоняется', async () => {
    const s = io(baseUrl, { transports: ['websocket'], forceNew: true, reconnection: false });
    sockets.push(s);
    const reason = await new Promise<string>((resolve) => s.on('disconnect', resolve));
    expect(reason).toBe('io server disconnect');
  });
});

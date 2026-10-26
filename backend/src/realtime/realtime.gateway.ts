import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayInit, SubscribeMessage, WebSocketGateway,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { verifyToken } from '../auth/auth.guard';
import { AuthUser } from '../auth/auth.types';
import { DriversService } from '../drivers/drivers.service';
import { rooms, RealtimeService } from './realtime.service';

/**
 * Сокеты для живых обновлений.
 * Подключение: io(URL, { auth: { token: '<jwt>' } })
 *
 * Сервер → клиенту:
 *   order:updated          карточка заказа изменилась (всем участникам)
 *   order:offer            водителю предложен заказ (есть expiresAt)
 *   order:offer_cancelled  предложение снято (таймаут / отмена / назначен другой)
 *   driver:location        координаты водителя (диспетчеру; пассажиру — его машины)
 *   driver:status          водитель вышел на линию / ушёл / занят
 *
 * Клиент → серверу:
 *   driver:location {lat, lng}   водитель шлёт координаты (вместо POST /api/driver/location)
 */
@WebSocketGateway({ cors: { origin: true } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly log = new Logger('Gateway');

  constructor(
    private readonly jwt: JwtService,
    private readonly realtime: RealtimeService,
    private readonly drivers: DriversService,
  ) {}

  afterInit(server: Server) {
    this.realtime.attach(server);
  }

  handleConnection(socket: Socket) {
    const token = socket.handshake.auth?.token ?? socket.handshake.query?.token;
    let user: AuthUser;
    try {
      if (typeof token !== 'string') throw new Error('нет токена');
      user = verifyToken(this.jwt, token);
    } catch {
      socket.emit('error', { message: 'Нужна авторизация' });
      socket.disconnect(true);
      return;
    }
    socket.data.user = user;
    if (user.role === 'driver') socket.join(rooms.driver(user.sub));
    else if (user.role === 'passenger') socket.join(rooms.passenger(user.sub));
    else if (user.role === 'owner' || user.role === 'dispatcher') socket.join(rooms.dispatch(user.tid));
    socket.emit('ready', { role: user.role });
  }

  @SubscribeMessage('driver:location')
  async onDriverLocation(@ConnectedSocket() socket: Socket, @MessageBody() body: { lat: number; lng: number }) {
    const user: AuthUser | undefined = socket.data.user;
    if (user?.role !== 'driver') return { ok: false, error: 'Только для водителей' };
    try {
      return await this.drivers.updateLocation(user.tid, user.sub, Number(body?.lat), Number(body?.lng));
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  }
}

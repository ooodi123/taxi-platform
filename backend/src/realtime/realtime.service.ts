import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

/** Комнаты Socket.IO */
export const rooms = {
  driver: (id: string) => `driver:${id}`,
  passenger: (id: string) => `passenger:${id}`,
  dispatch: (tenantId: string) => `dispatch:${tenantId}`,
};

/**
 * Отправка событий клиентам. Сервер сокетов подключает RealtimeGateway при старте.
 * Если сокеты не подняты (например, в скриптах), события просто пропускаются.
 */
@Injectable()
export class RealtimeService {
  private readonly log = new Logger('Realtime');
  private server: Server | null = null;

  attach(server: Server) {
    this.server = server;
  }

  private emit(room: string, event: string, data: unknown) {
    if (!this.server) return;
    try {
      this.server.to(room).emit(event, data);
    } catch (e: any) {
      this.log.warn(`Не удалось отправить ${event} в ${room}: ${e.message}`);
    }
  }

  /** Есть ли сейчас открытое подключение в комнате (например, открыто ли приложение водителя) */
  async isConnected(room: string): Promise<boolean> {
    if (!this.server) return false;
    try {
      const sockets = await this.server.in(room).fetchSockets();
      return sockets.length > 0;
    } catch {
      return false;
    }
  }

  toDriver(driverId: string, event: string, data: unknown) {
    this.emit(rooms.driver(driverId), event, data);
  }

  toPassenger(passengerId: string, event: string, data: unknown) {
    this.emit(rooms.passenger(passengerId), event, data);
  }

  toDispatch(tenantId: string, event: string, data: unknown) {
    this.emit(rooms.dispatch(tenantId), event, data);
  }
}

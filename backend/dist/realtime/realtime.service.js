"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RealtimeService = exports.rooms = void 0;
const common_1 = require("@nestjs/common");
/** Комнаты Socket.IO */
exports.rooms = {
    driver: (id) => `driver:${id}`,
    passenger: (id) => `passenger:${id}`,
    dispatch: (tenantId) => `dispatch:${tenantId}`,
};
/**
 * Отправка событий клиентам. Сервер сокетов подключает RealtimeGateway при старте.
 * Если сокеты не подняты (например, в скриптах), события просто пропускаются.
 */
let RealtimeService = class RealtimeService {
    log = new common_1.Logger('Realtime');
    server = null;
    attach(server) {
        this.server = server;
    }
    emit(room, event, data) {
        if (!this.server)
            return;
        try {
            this.server.to(room).emit(event, data);
        }
        catch (e) {
            this.log.warn(`Не удалось отправить ${event} в ${room}: ${e.message}`);
        }
    }
    /** Есть ли сейчас открытое подключение в комнате (например, открыто ли приложение водителя) */
    async isConnected(room) {
        if (!this.server)
            return false;
        try {
            const sockets = await this.server.in(room).fetchSockets();
            return sockets.length > 0;
        }
        catch {
            return false;
        }
    }
    toDriver(driverId, event, data) {
        this.emit(exports.rooms.driver(driverId), event, data);
    }
    toPassenger(passengerId, event, data) {
        this.emit(exports.rooms.passenger(passengerId), event, data);
    }
    toDispatch(tenantId, event, data) {
        this.emit(exports.rooms.dispatch(tenantId), event, data);
    }
};
exports.RealtimeService = RealtimeService;
exports.RealtimeService = RealtimeService = __decorate([
    (0, common_1.Injectable)()
], RealtimeService);

"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var _a, _b, _c;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RealtimeGateway = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const websockets_1 = require("@nestjs/websockets");
const auth_guard_1 = require("../auth/auth.guard");
const drivers_service_1 = require("../drivers/drivers.service");
const realtime_service_1 = require("./realtime.service");
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
let RealtimeGateway = class RealtimeGateway {
    jwt;
    realtime;
    drivers;
    log = new common_1.Logger('Gateway');
    constructor(jwt, realtime, drivers) {
        this.jwt = jwt;
        this.realtime = realtime;
        this.drivers = drivers;
    }
    afterInit(server) {
        this.realtime.attach(server);
    }
    handleConnection(socket) {
        const token = socket.handshake.auth?.token ?? socket.handshake.query?.token;
        let user;
        try {
            if (typeof token !== 'string')
                throw new Error('нет токена');
            user = (0, auth_guard_1.verifyToken)(this.jwt, token);
        }
        catch {
            socket.emit('error', { message: 'Нужна авторизация' });
            socket.disconnect(true);
            return;
        }
        socket.data.user = user;
        if (user.role === 'driver')
            socket.join(realtime_service_1.rooms.driver(user.sub));
        else if (user.role === 'passenger')
            socket.join(realtime_service_1.rooms.passenger(user.sub));
        else if (user.role === 'owner' || user.role === 'dispatcher')
            socket.join(realtime_service_1.rooms.dispatch(user.tid));
        socket.emit('ready', { role: user.role });
    }
    async onDriverLocation(socket, body) {
        const user = socket.data.user;
        if (user?.role !== 'driver')
            return { ok: false, error: 'Только для водителей' };
        try {
            return await this.drivers.updateLocation(user.tid, user.sub, Number(body?.lat), Number(body?.lng));
        }
        catch (e) {
            return { ok: false, error: e.message };
        }
    }
};
exports.RealtimeGateway = RealtimeGateway;
__decorate([
    (0, websockets_1.SubscribeMessage)('driver:location'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], RealtimeGateway.prototype, "onDriverLocation", null);
exports.RealtimeGateway = RealtimeGateway = __decorate([
    (0, websockets_1.WebSocketGateway)({ cors: { origin: true } }),
    __metadata("design:paramtypes", [typeof (_a = typeof jwt_1.JwtService !== "undefined" && jwt_1.JwtService) === "function" ? _a : Object, typeof (_b = typeof realtime_service_1.RealtimeService !== "undefined" && realtime_service_1.RealtimeService) === "function" ? _b : Object, typeof (_c = typeof drivers_service_1.DriversService !== "undefined" && drivers_service_1.DriversService) === "function" ? _c : Object])
], RealtimeGateway);

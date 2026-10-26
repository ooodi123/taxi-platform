"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATUS_LABELS = exports.DRIVER_REFUSABLE = exports.STAFF_CANCELLABLE = exports.PASSENGER_CANCELLABLE = exports.TRANSITIONS = exports.FINAL_STATUSES = exports.ACTIVE_STATUSES = void 0;
exports.canTransition = canTransition;
exports.ACTIVE_STATUSES = ['searching', 'assigned', 'arrived', 'in_progress'];
exports.FINAL_STATUSES = ['completed', 'cancelled', 'expired'];
exports.TRANSITIONS = {
    searching: ['assigned', 'cancelled', 'expired'],
    assigned: ['arrived', 'searching', 'cancelled'],
    arrived: ['in_progress', 'searching', 'cancelled'],
    in_progress: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
    expired: [],
};
function canTransition(from, to) {
    return exports.TRANSITIONS[from]?.includes(to) ?? false;
}
/** Из каких статусов пассажир может отменить заказ (в пути — только через диспетчера) */
exports.PASSENGER_CANCELLABLE = ['searching', 'assigned', 'arrived'];
/** Диспетчер может отменить любой активный */
exports.STAFF_CANCELLABLE = exports.ACTIVE_STATUSES;
/** Водитель может отказаться от принятого заказа до посадки пассажира */
exports.DRIVER_REFUSABLE = ['assigned', 'arrived'];
exports.STATUS_LABELS = {
    searching: 'Ищем машину',
    assigned: 'Водитель едет к вам',
    arrived: 'Водитель на месте',
    in_progress: 'В пути',
    completed: 'Поездка завершена',
    cancelled: 'Отменён',
    expired: 'Машина не найдена',
};

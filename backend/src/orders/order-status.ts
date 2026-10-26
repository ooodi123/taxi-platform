/**
 * Жизненный цикл заказа:
 *
 *   searching ──(водитель принял / диспетчер назначил)──► assigned ──► arrived ──► in_progress ──► completed
 *       │                                                   │            │              │
 *       ├──► expired (никто не взял за ORDER_SEARCH_TIMEOUT) │            │              │
 *       └──► cancelled ◄─────────────────────────────────────┴────────────┴──────────────┘
 *
 *   assigned / arrived ──(водитель отказался)──► searching (ищем другого)
 */
export type OrderStatus = 'searching' | 'assigned' | 'arrived' | 'in_progress' | 'completed' | 'cancelled' | 'expired';

export const ACTIVE_STATUSES: OrderStatus[] = ['searching', 'assigned', 'arrived', 'in_progress'];
export const FINAL_STATUSES: OrderStatus[] = ['completed', 'cancelled', 'expired'];

export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  searching: ['assigned', 'cancelled', 'expired'],
  assigned: ['arrived', 'searching', 'cancelled'],
  arrived: ['in_progress', 'searching', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  expired: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Из каких статусов пассажир может отменить заказ (в пути — только через диспетчера) */
export const PASSENGER_CANCELLABLE: OrderStatus[] = ['searching', 'assigned', 'arrived'];
/** Диспетчер может отменить любой активный */
export const STAFF_CANCELLABLE: OrderStatus[] = ACTIVE_STATUSES;
/** Водитель может отказаться от принятого заказа до посадки пассажира */
export const DRIVER_REFUSABLE: OrderStatus[] = ['assigned', 'arrived'];

export const STATUS_LABELS: Record<OrderStatus, string> = {
  searching: 'Ищем машину',
  assigned: 'Водитель едет к вам',
  arrived: 'Водитель на месте',
  in_progress: 'В пути',
  completed: 'Поездка завершена',
  cancelled: 'Отменён',
  expired: 'Машина не найдена',
};

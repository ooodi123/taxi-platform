import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { safeEqual } from '../auth/auth.guard';
import { config } from '../config';
import { DbService } from '../db/db.service';
import type { OrderView } from '../orders/order-view.service';
import { RealtimeService, rooms } from '../realtime/realtime.service';

const TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;

export class TelegramApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

/**
 * Боты таксопарков. У каждого таксопарка свой бот (создаётся в @BotFather),
 * все они работают через этот один сервер: Telegram присылает обновления
 * на /api/telegram/webhook/<id таксопарка>.
 */
@Injectable()
export class TelegramService {
  private readonly log = new Logger('Telegram');

  constructor(private readonly db: DbService, private readonly realtime: RealtimeService) {}

  // ---------------- Bot API ----------------

  async call<T = any>(token: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${config.telegramApiUrl}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e: any) {
      throw new TelegramApiError(`Telegram недоступен: ${e.message}`);
    }
    const body: any = await res.json().catch(() => ({}));
    if (!body.ok) throw new TelegramApiError(body.description ?? `HTTP ${res.status}`, res.status);
    return body.result as T;
  }

  /** Адрес Mini App: пассажирское — /app/, водительское — /app/driver/ */
  miniAppUrl(slug: string, app: 'passenger' | 'driver' = 'passenger'): string {
    return `${config.publicUrl}/app/${app === 'driver' ? 'driver/' : ''}?t=${encodeURIComponent(slug)}`;
  }

  // ---------------- Подключение бота ----------------

  /**
   * Подключить бота к таксопарку: проверить токен, поставить webhook,
   * кнопку меню «Такси» и команду /start.
   */
  async connectBot(tenantId: string, botToken: string) {
    if (!TOKEN_RE.test(botToken)) throw new BadRequestException('Это не похоже на токен бота от @BotFather');
    if (!config.publicUrl.startsWith('https://')) {
      throw new BadRequestException('Задайте PUBLIC_URL с https:// — Telegram работает только по HTTPS');
    }
    const tenant = await this.db.one(`SELECT id, slug, name FROM tenants WHERE id = $1`, [tenantId]);
    if (!tenant) throw new NotFoundException('Таксопарк не найден');

    let me: { username: string };
    try {
      me = await this.call(botToken, 'getMe');
    } catch (e: any) {
      throw new BadRequestException(`Telegram не принял токен: ${e.message}`);
    }
    const secret = randomBytes(24).toString('hex');
    const appUrl = this.miniAppUrl(tenant.slug);
    try {
      await this.call(botToken, 'setWebhook', {
        url: `${config.publicUrl}/api/telegram/webhook/${tenant.id}`,
        secret_token: secret,
        allowed_updates: ['message'],
        drop_pending_updates: true,
      });
      await this.call(botToken, 'setChatMenuButton', {
        menu_button: { type: 'web_app', text: 'Такси', web_app: { url: appUrl } },
      });
      await this.call(botToken, 'setMyCommands', {
        commands: [
          { command: 'start', description: 'Заказать такси' },
          { command: 'driver', description: 'Режим водителя' },
        ],
      });
    } catch (e: any) {
      throw new BadRequestException(`Не удалось настроить бота: ${e.message}`);
    }
    await this.db.one(
      `UPDATE tenants SET bot_token = $2, bot_username = $3, webhook_secret = $4 WHERE id = $1 RETURNING id`,
      [tenantId, botToken, me.username, secret],
    );
    return { botUsername: me.username, botUrl: `https://t.me/${me.username}`, miniAppUrl: appUrl };
  }

  async disconnectBot(tenantId: string) {
    const t = await this.db.one(`SELECT bot_token FROM tenants WHERE id = $1`, [tenantId]);
    if (!t) throw new NotFoundException('Таксопарк не найден');
    if (t.bot_token) {
      await this.call(t.bot_token, 'deleteWebhook').catch((e) => this.log.warn(`deleteWebhook: ${e.message}`));
    }
    await this.db.one(
      `UPDATE tenants SET bot_token = NULL, bot_username = NULL, webhook_secret = NULL WHERE id = $1 RETURNING id`,
      [tenantId],
    );
    return { ok: true };
  }

  async botStatus(tenantId: string) {
    const t = await this.db.one(`SELECT slug, bot_username, bot_token FROM tenants WHERE id = $1`, [tenantId]);
    if (!t) throw new NotFoundException('Таксопарк не найден');
    return {
      connected: !!t.bot_token,
      botUsername: t.bot_username,
      botUrl: t.bot_username ? `https://t.me/${t.bot_username}` : null,
      miniAppUrl: config.publicUrl ? this.miniAppUrl(t.slug) : null,
    };
  }

  /** Токен бота таксопарка — для проверки initData */
  async botTokenBySlug(slug: string): Promise<{ tenantId: string; botToken: string | null; isActive: boolean } | null> {
    const t = await this.db.one(`SELECT id, bot_token, is_active FROM tenants WHERE slug = $1`, [slug]);
    return t ? { tenantId: t.id, botToken: t.bot_token, isActive: t.is_active } : null;
  }

  // ---------------- Входящие сообщения ----------------

  async handleUpdate(tenantId: string, secretHeader: string | undefined, update: any) {
    const t = await this.db.one(
      `SELECT id, slug, name, bot_token, webhook_secret, is_active FROM tenants WHERE id = $1`,
      [tenantId],
    );
    if (!t?.webhook_secret || !secretHeader || !safeEqual(secretHeader, t.webhook_secret)) {
      throw new UnauthorizedException();
    }
    const msg = update?.message;
    if (!msg?.chat?.id || msg.chat.type !== 'private' || !t.bot_token) return { ok: true };

    if (!t.is_active) {
      await this.send(t.bot_token, msg.chat.id, 'Сервис временно недоступен.');
      return { ok: true };
    }
    const text: string = msg.text ?? '';
    const name = msg.from?.first_name ? `, ${msg.from.first_name}` : '';

    // водитель этого таксопарка получает ещё и кнопку своего приложения
    const driver = msg.from?.id
      ? await this.db.one(
          `SELECT id, is_active FROM drivers WHERE tenant_id = $1 AND telegram_id = $2`,
          [t.id, msg.from.id],
        )
      : null;
    if (text.startsWith('/driver')) {
      if (!driver?.is_active) {
        await this.send(
          t.bot_token, msg.chat.id,
          `Вы не зарегистрированы как водитель ${t.name}.\nВаш Telegram ID: ${msg.from?.id} — сообщите его диспетчеру.`,
        );
      } else {
        await this.send(t.bot_token, msg.chat.id, 'Приложение водителя:', this.appButton(t.slug, '🚖 Выйти на линию', 'driver'));
      }
      return { ok: true };
    }

    const greeting = text.startsWith('/start')
      ? `Здравствуйте${name}! Это ${t.name}.\n\nНажмите кнопку ниже, чтобы заказать такси.`
      : 'Чтобы заказать такси, нажмите кнопку ниже.';
    const keyboard = this.appButton(t.slug, '🚕 Заказать такси');
    if (keyboard && driver?.is_active) {
      keyboard.inline_keyboard.push([{ text: '🚖 Я водитель', web_app: { url: this.miniAppUrl(t.slug, 'driver') } }]);
    }
    await this.send(t.bot_token, msg.chat.id, greeting, keyboard);
    return { ok: true };
  }

  // ---------------- Уведомления пассажиру ----------------

  /** Вызывается при каждом изменении заказа. Пишет пассажиру в Telegram о важных событиях. */
  async onOrderUpdated(v: OrderView): Promise<void> {
    if (!v.passenger.id) return;
    const row = await this.db.one(
      `SELECT p.telegram_id, t.bot_token, t.slug, o.passenger_notified_status AS prev
         FROM orders o
         JOIN passengers p ON p.id = o.passenger_id
         JOIN tenants t ON t.id = o.tenant_id
        WHERE o.id = $1`,
      [v.id],
    );
    if (!row?.telegram_id || !row.bot_token) return;

    const text = statusMessage(v, row.prev);
    // помечаем статус как отправленный атомарно — повторные вызовы не пришлют дубль
    const claimed = await this.db.one(
      `UPDATE orders SET passenger_notified_status = $2
        WHERE id = $1 AND passenger_notified_status IS DISTINCT FROM $2 RETURNING id`,
      [v.id, v.status],
    );
    if (!claimed || !text) return;

    const button = ['assigned', 'arrived', 'searching'].includes(v.status)
      ? this.appButton(row.slug, 'Открыть заказ')
      : ['expired', 'cancelled', 'completed'].includes(v.status)
        ? this.appButton(row.slug, '🚕 Заказать снова')
        : undefined;
    await this.send(row.bot_token, row.telegram_id, text, button);
  }

  // ---------------- Уведомления водителю ----------------

  /**
   * Сообщение водителю в Telegram. Если приложение водителя сейчас открыто
   * (есть сокет-подключение), не пишем: он и так видит заказ на экране.
   */
  async notifyDriver(driverId: string, text: string, opts: { force?: boolean; button?: string } = {}): Promise<void> {
    if (!opts.force && (await this.realtime.isConnected(rooms.driver(driverId)))) return;
    const row = await this.db.one(
      `SELECT d.telegram_id, t.bot_token, t.slug FROM drivers d JOIN tenants t ON t.id = d.tenant_id WHERE d.id = $1`,
      [driverId],
    );
    if (!row?.telegram_id || !row.bot_token) return;
    await this.send(row.bot_token, row.telegram_id, text, this.appButton(row.slug, opts.button ?? 'Открыть приложение', 'driver'));
  }

  private appButton(slug: string, text: string, app: 'passenger' | 'driver' = 'passenger') {
    if (!config.publicUrl) return undefined;
    return { inline_keyboard: [[{ text, web_app: { url: this.miniAppUrl(slug, app) } }]] as any[][] };
  }

  private async send(token: string, chatId: number, text: string, replyMarkup?: unknown) {
    try {
      await this.call(token, 'sendMessage', { chat_id: chatId, text, reply_markup: replyMarkup });
    } catch (e: any) {
      // 403 — пассажир заблокировал бота; это не ошибка сервера
      this.log.warn(`Сообщение в чат ${chatId} не отправлено: ${e.message}`);
    }
  }
}

const CURRENCY: Record<string, string> = { RUB: '₽', MDL: 'лей', KZT: '₸', UAH: '₴', BYN: 'Br', USD: '$', EUR: '€' };

export function formatPrice(amount: number, currency: string): string {
  const n = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return `${n.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ${CURRENCY[currency] ?? currency}`;
}

function carLine(v: OrderView): string {
  const c = v.driver?.car;
  if (!c) return '';
  return [c.color, c.model].filter(Boolean).join(' ') + (c.plate ? `, ${c.plate}` : '');
}

function km(m: number): string {
  return m < 1000 ? `${m} м` : `${(Math.round(m / 100) / 10).toString().replace('.', ',')} км`;
}

/** Сообщение водителю о новом предложении */
export function offerMessage(v: OrderView, distanceToPickupM: number, timeoutSec: number): string {
  const lines = [
    `🔔 Новый заказ — ${formatPrice(v.estimatedPrice, v.currency)} (${v.tariff.name})`,
    `Подача: ${km(distanceToPickupM)} от вас${v.pickup.address ? `, ${v.pickup.address}` : ''}`,
  ];
  if (v.dropoff) lines.push(`Куда: ${v.dropoff.address ?? 'точка на карте'}${v.distanceM ? ` (${km(v.distanceM)})` : ''}`);
  if (v.comment) lines.push(`Комментарий: ${v.comment}`);
  lines.push(`Откройте приложение и примите за ${timeoutSec} сек.`);
  return lines.join('\n');
}

/** Текст уведомления для перехода статуса prev → v.status (null — не писать) */
export function statusMessage(v: OrderView, prev: string | null): string | null {
  switch (v.status) {
    case 'searching':
      // первый поиск пассажир видит в приложении; пишем, только если водитель отказался
      return prev && prev !== 'searching' ? 'Водитель отказался от заказа. Ищем другую машину…' : null;
    case 'assigned':
      return `🚕 Машина найдена!\n${carLine(v)}\nВодитель: ${v.driver?.name ?? ''}`.trim();
    case 'arrived':
      return `📍 Водитель на месте.\n${carLine(v)}`.trim();
    case 'in_progress':
      return null;
    case 'completed':
      return `✅ Поездка завершена.\nСтоимость: ${formatPrice(v.finalPrice ?? v.estimatedPrice, v.currency)}\nСпасибо, что выбрали нас!`;
    case 'cancelled':
      if (v.cancelledBy === 'passenger') return null; // сам отменил — знает
      return `❌ Заказ отменён${v.cancelReason ? `: ${v.cancelReason}` : ''}.`;
    case 'expired':
      return '😔 К сожалению, свободных машин не нашлось. Попробуйте заказать ещё раз.';
  }
  return null;
}

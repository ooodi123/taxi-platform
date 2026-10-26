import { createHmac, timingSafeEqual } from 'crypto';

export interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface VerifiedInitData {
  user: TelegramWebAppUser;
  authDate: number;
  startParam: string | null;
}

export class InitDataError extends Error {}

/**
 * Проверка подписи Telegram Mini App (initData).
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Telegram подписывает данные о пользователе токеном бота. Подделать их без токена нельзя,
 * поэтому именно так мы узнаём, кто открыл приложение.
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  maxAgeSec: number,
  nowSec: number = Math.floor(Date.now() / 1000),
): VerifiedInitData {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) throw new InitDataError('Нет подписи Telegram');
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) throw new InitDataError('Неверная подпись Telegram');

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || authDate <= 0) throw new InitDataError('Нет даты авторизации');
  if (nowSec - authDate > maxAgeSec) throw new InitDataError('Сессия Telegram устарела, откройте приложение заново');

  let user: TelegramWebAppUser;
  try {
    user = JSON.parse(params.get('user') ?? '');
  } catch {
    throw new InitDataError('Нет данных пользователя');
  }
  if (!user || typeof user.id !== 'number') throw new InitDataError('Нет данных пользователя');

  return { user, authDate, startParam: params.get('start_param') };
}

/** Сформировать подписанный initData — для тестов */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

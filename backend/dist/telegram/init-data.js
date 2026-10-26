"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InitDataError = void 0;
exports.verifyInitData = verifyInitData;
exports.signInitData = signInitData;
const crypto_1 = require("crypto");
class InitDataError extends Error {
}
exports.InitDataError = InitDataError;
/**
 * Проверка подписи Telegram Mini App (initData).
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Telegram подписывает данные о пользователе токеном бота. Подделать их без токена нельзя,
 * поэтому именно так мы узнаём, кто открыл приложение.
 */
function verifyInitData(initData, botToken, maxAgeSec, nowSec = Math.floor(Date.now() / 1000)) {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash || !/^[0-9a-f]{64}$/.test(hash))
        throw new InitDataError('Нет подписи Telegram');
    params.delete('hash');
    const dataCheckString = [...params.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');
    const secret = (0, crypto_1.createHmac)('sha256', 'WebAppData').update(botToken).digest();
    const expected = (0, crypto_1.createHmac)('sha256', secret).update(dataCheckString).digest();
    if (!(0, crypto_1.timingSafeEqual)(expected, Buffer.from(hash, 'hex')))
        throw new InitDataError('Неверная подпись Telegram');
    const authDate = Number(params.get('auth_date'));
    if (!Number.isFinite(authDate) || authDate <= 0)
        throw new InitDataError('Нет даты авторизации');
    if (nowSec - authDate > maxAgeSec)
        throw new InitDataError('Сессия Telegram устарела, откройте приложение заново');
    let user;
    try {
        user = JSON.parse(params.get('user') ?? '');
    }
    catch {
        throw new InitDataError('Нет данных пользователя');
    }
    if (!user || typeof user.id !== 'number')
        throw new InitDataError('Нет данных пользователя');
    return { user, authDate, startParam: params.get('start_param') };
}
/** Сформировать подписанный initData — для тестов */
function signInitData(fields, botToken) {
    const dataCheckString = Object.keys(fields)
        .sort()
        .map((k) => `${k}=${fields[k]}`)
        .join('\n');
    const secret = (0, crypto_1.createHmac)('sha256', 'WebAppData').update(botToken).digest();
    const hash = (0, crypto_1.createHmac)('sha256', secret).update(dataCheckString).digest('hex');
    return new URLSearchParams({ ...fields, hash }).toString();
}

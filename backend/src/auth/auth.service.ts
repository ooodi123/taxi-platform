import { Injectable, NotFoundException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { config } from '../config';
import { camel, DbService } from '../db/db.service';
import { InitDataError, verifyInitData, VerifiedInitData } from '../telegram/init-data';
import { AuthUser } from './auth.types';

@Injectable()
export class AuthService {
  constructor(private readonly db: DbService, private readonly jwt: JwtService) {}

  sign(user: AuthUser): string {
    return this.jwt.sign({ sub: user.sub, role: user.role, tid: user.tid });
  }

  /** Вход владельца или диспетчера таксопарка */
  async staffLogin(login: string, password: string) {
    const row = await this.db.one(
      `SELECT s.*, t.is_active AS tenant_active, t.name AS tenant_name
         FROM staff_users s JOIN tenants t ON t.id = s.tenant_id
        WHERE lower(s.login) = lower($1)`,
      [login],
    );
    // одинаковое сообщение, чтобы не подсказывать, существует ли логин
    if (!row || !(await bcrypt.compare(password, row.password_hash))) {
      throw new UnauthorizedException('Неверный логин или пароль');
    }
    if (!row.is_active || !row.tenant_active) throw new ForbiddenException('Доступ отключён');
    const user: AuthUser = { sub: row.id, role: row.role, tid: row.tenant_id };
    return {
      token: this.sign(user),
      user: { id: row.id, login: row.login, name: row.name, role: row.role },
      tenant: { id: row.tenant_id, name: row.tenant_name },
    };
  }

  /**
   * Тестовый вход пассажира или водителя без Telegram (только при DEV_AUTH=true).
   * На этапе 2 появится настоящий вход через Telegram initData.
   */
  async devToken(input: { tenantSlug: string; role: 'passenger' | 'driver'; telegramId: number; name?: string }) {
    if (!config.devAuth) throw new NotFoundException();
    const tenant = await this.activeTenantBySlug(input.tenantSlug);

    if (input.role === 'passenger') {
      const p = await this.db.one(
        `INSERT INTO passengers (tenant_id, telegram_id, name) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, telegram_id) DO UPDATE SET name = COALESCE(EXCLUDED.name, passengers.name)
         RETURNING *`,
        [tenant.id, input.telegramId, input.name ?? null],
      );
      return { token: this.sign({ sub: p.id, role: 'passenger', tid: tenant.id }), passenger: camel(p) };
    }

    const d = await this.db.one(`SELECT * FROM drivers WHERE tenant_id = $1 AND telegram_id = $2`, [tenant.id, input.telegramId]);
    if (!d) throw new NotFoundException('Водитель с таким Telegram ID не найден в этом таксопарке');
    if (!d.is_active) throw new ForbiddenException('Водитель отключён');
    return { token: this.sign({ sub: d.id, role: 'driver', tid: tenant.id }), driver: camel(d) };
  }

  /**
   * Вход из Telegram Mini App. initData подписан ботом таксопарка — проверяем подпись
   * его токеном, затем находим (или создаём) пассажира / находим водителя по Telegram ID.
   */
  async telegramLogin(input: { tenantSlug: string; initData: string; role: 'passenger' | 'driver' }) {
    const tenant = await this.activeTenantBySlug(input.tenantSlug);
    if (!tenant.bot_token) throw new ForbiddenException('У таксопарка не подключён Telegram-бот');

    let data: VerifiedInitData;
    try {
      data = verifyInitData(input.initData, tenant.bot_token, config.telegramAuthMaxAgeSec);
    } catch (e) {
      if (e instanceof InitDataError) throw new UnauthorizedException(e.message);
      throw e;
    }
    const u = data.user;
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || null;

    if (input.role === 'passenger') {
      const p = await this.db.one(
        `INSERT INTO passengers (tenant_id, telegram_id, name, username, language_code) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, telegram_id) DO UPDATE
           SET name = COALESCE(passengers.name, EXCLUDED.name),
               username = EXCLUDED.username, language_code = EXCLUDED.language_code
         RETURNING *`,
        [tenant.id, u.id, name, u.username ?? null, u.language_code ?? null],
      );
      return { token: this.sign({ sub: p.id, role: 'passenger', tid: tenant.id }), passenger: camel(p) };
    }

    const d = await this.db.one(`SELECT * FROM drivers WHERE tenant_id = $1 AND telegram_id = $2`, [tenant.id, u.id]);
    if (!d) throw new ForbiddenException(`Вы не зарегистрированы как водитель. Ваш Telegram ID: ${u.id} — сообщите его диспетчеру.`);
    if (!d.is_active) throw new ForbiddenException('Водитель отключён');
    return { token: this.sign({ sub: d.id, role: 'driver', tid: tenant.id }), driver: camel(d) };
  }

  /** Имя и телефон пассажир может поправить сам */
  async updatePassenger(user: AuthUser, patch: { name?: string; phone?: string }) {
    const p = await this.db.one(
      `UPDATE passengers SET name = COALESCE($3, name), phone = COALESCE($4, phone)
        WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [user.sub, user.tid, patch.name ?? null, patch.phone ?? null],
    );
    if (!p) throw new NotFoundException('Пассажир не найден');
    return camel(p);
  }

  private async activeTenantBySlug(slug: string) {
    const t = await this.db.one(`SELECT * FROM tenants WHERE slug = $1`, [slug]);
    if (!t) throw new NotFoundException('Таксопарк не найден');
    if (!t.is_active) throw new ForbiddenException('Таксопарк отключён');
    return t;
  }

  async me(user: AuthUser) {
    switch (user.role) {
      case 'superadmin':
        return { role: 'superadmin' };
      case 'owner':
      case 'dispatcher': {
        const s = await this.db.one(`SELECT id, login, name, role FROM staff_users WHERE id = $1`, [user.sub]);
        const t = await this.db.one(
          `SELECT id, name, slug, currency, branding, settings, bot_username FROM tenants WHERE id = $1`,
          [user.tid],
        );
        return { role: user.role, tenantId: user.tid, user: camel(s), tenant: camel(t) };
      }
      case 'driver': {
        const d = await this.db.one(`SELECT * FROM drivers WHERE id = $1 AND tenant_id = $2`, [user.sub, user.tid]);
        return { role: 'driver', tenantId: user.tid, driver: camel(d) };
      }
      case 'passenger': {
        const p = await this.db.one(`SELECT * FROM passengers WHERE id = $1 AND tenant_id = $2`, [user.sub, user.tid]);
        return { role: 'passenger', tenantId: user.tid, passenger: camel(p) };
      }
    }
  }
}

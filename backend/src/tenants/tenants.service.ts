import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { camel, DbService, isUniqueViolation } from '../db/db.service';

export interface CreateTenantInput {
  name: string;
  slug: string;
  currency?: string;
  ownerLogin?: string;
  ownerPassword?: string;
}

/** Таксопарки — управляет супер-админ (владелец платформы) */
@Injectable()
export class TenantsService {
  constructor(private readonly db: DbService) {}

  /** Создаёт таксопарк, базовый тариф и аккаунт владельца */
  async create(input: CreateTenantInput) {
    const ownerLogin = input.ownerLogin ?? `${input.slug}-owner`;
    const ownerPassword = input.ownerPassword ?? randomBytes(9).toString('base64url');
    const hash = await bcrypt.hash(ownerPassword, 10);
    try {
      return await this.db.tx(async (c) => {
        const tenant = await this.db.one(
          `INSERT INTO tenants (name, slug, currency) VALUES ($1, $2, $3) RETURNING *`,
          [input.name, input.slug, input.currency ?? 'RUB'],
          c,
        );
        await this.db.one(
          `INSERT INTO tariffs (tenant_id, code, name, base_fare, per_km, per_min, min_fare, round_to, sort_order)
           VALUES ($1, 'econom', 'Эконом', 50, 15, 5, 150, 10, 0) RETURNING id`,
          [tenant.id],
          c,
        );
        await this.db.one(
          `INSERT INTO staff_users (tenant_id, login, password_hash, name, role)
           VALUES ($1, $2, $3, 'Владелец', 'owner') RETURNING id`,
          [tenant.id, ownerLogin, hash],
          c,
        );
        return { tenant: this.view(tenant), owner: { login: ownerLogin, password: ownerPassword } };
      });
    } catch (e) {
      if (isUniqueViolation(e, 'tenants_slug_key')) throw new ConflictException('Такой slug уже занят');
      if (isUniqueViolation(e, 'staff_users_login_key')) throw new ConflictException('Такой логин уже занят');
      throw e;
    }
  }

  async list() {
    const rows = await this.db.many(
      `SELECT t.*,
              (SELECT count(*) FROM drivers d WHERE d.tenant_id = t.id) AS drivers_count,
              (SELECT count(*) FROM orders o WHERE o.tenant_id = t.id) AS orders_count
         FROM tenants t ORDER BY t.created_at DESC`,
    );
    return rows.map((r) => this.view(r));
  }

  async update(
    id: string,
    patch: { name?: string; isActive?: boolean; currency?: string; branding?: Record<string, unknown>; settings?: Record<string, unknown> },
  ) {
    const t = await this.db.one(
      `UPDATE tenants SET
         name      = COALESCE($2, name),
         is_active = COALESCE($3, is_active),
         currency  = COALESCE($4, currency),
         branding  = COALESCE($5, branding),
         settings  = COALESCE($6, settings)
       WHERE id = $1 RETURNING *`,
      [id, patch.name ?? null, patch.isActive ?? null, patch.currency ?? null, patch.branding ? JSON.stringify(patch.branding) : null,
        patch.settings ? JSON.stringify(patch.settings) : null,
      ],
    );
    if (!t) throw new NotFoundException('Таксопарк не найден');
    return this.view(t);
  }

  async getOwn(tenantId: string) {
    const t = await this.db.one(`SELECT * FROM tenants WHERE id = $1`, [tenantId]);
    if (!t) throw new NotFoundException('Таксопарк не найден');
    return this.view(t);
  }

  /** Владелец меняет своё: название, брендинг, центр карты, часовой пояс */
  async updateOwn(
    tenantId: string,
    p: { name?: string; appName?: string; primaryColor?: string; center?: [number, number]; timezone?: string },
  ) {
    const branding: Record<string, unknown> = {};
    if (p.appName !== undefined) branding.appName = p.appName;
    if (p.primaryColor !== undefined) branding.primaryColor = p.primaryColor;
    const settings: Record<string, unknown> = {};
    if (p.center !== undefined) settings.center = p.center;
    if (p.timezone !== undefined) settings.timezone = p.timezone;
    // jsonb || jsonb — дописываем ключи, не стирая остальные
    const t = await this.db.one(
      `UPDATE tenants SET name = COALESCE($2, name), branding = branding || $3::jsonb, settings = settings || $4::jsonb
        WHERE id = $1 RETURNING *`,
      [tenantId, p.name ?? null, JSON.stringify(branding), JSON.stringify(settings)],
    );
    if (!t) throw new NotFoundException('Таксопарк не найден');
    return this.view(t);
  }

  /** Публичная информация о таксопарке (название, брендинг) — для приложения пассажира */
  async publicInfo(slug: string) {
    const t = await this.db.one(`SELECT id, name, slug, currency, branding, settings->'center' AS center FROM tenants WHERE slug = $1 AND is_active`, [slug]);
    if (!t) throw new NotFoundException('Таксопарк не найден');
    return camel(t);
  }

  private view(row: any) {
    const { botToken, webhookSecret, ...rest } = camel(row);
    return { ...rest, hasBot: !!botToken };
  }
}

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { camel, DbService, isUniqueViolation } from '../db/db.service';

/** Диспетчеры таксопарка — управляет владелец */
@Injectable()
export class StaffService {
  constructor(private readonly db: DbService) {}

  async list(tenantId: string) {
    const rows = await this.db.many(
      `SELECT id, login, name, role, is_active, created_at FROM staff_users WHERE tenant_id = $1 ORDER BY created_at`,
      [tenantId],
    );
    return rows.map(camel);
  }

  async create(tenantId: string, input: { login: string; password: string; name?: string }) {
    try {
      const row = await this.db.one(
        `INSERT INTO staff_users (tenant_id, login, password_hash, name, role)
         VALUES ($1, $2, $3, $4, 'dispatcher')
         RETURNING id, login, name, role, is_active, created_at`,
        [tenantId, input.login, await bcrypt.hash(input.password, 10), input.name ?? null],
      );
      return camel(row);
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('Такой логин уже занят');
      throw e;
    }
  }

  async update(tenantId: string, id: string, patch: { name?: string; password?: string; isActive?: boolean }) {
    const hash = patch.password ? await bcrypt.hash(patch.password, 10) : null;
    const row = await this.db.one(
      `UPDATE staff_users SET
         name          = COALESCE($3, name),
         password_hash = COALESCE($4, password_hash),
         is_active     = CASE WHEN role = 'owner' THEN is_active ELSE COALESCE($5, is_active) END
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, login, name, role, is_active, created_at`,
      [id, tenantId, patch.name ?? null, hash, patch.isActive ?? null],
    );
    if (!row) throw new NotFoundException('Сотрудник не найден');
    return camel(row);
  }
}

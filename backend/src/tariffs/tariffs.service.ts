import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { camel, DbService, isUniqueViolation, Queryable } from '../db/db.service';
import { TariffRates } from '../pricing/pricing';

export interface Tariff extends TariffRates {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
}

export interface TariffInput {
  code?: string;
  name?: string;
  baseFare?: number;
  perKm?: number;
  perMin?: number;
  minFare?: number;
  roundTo?: number;
  isActive?: boolean;
  sortOrder?: number;
}

@Injectable()
export class TariffsService {
  constructor(private readonly db: DbService) {}

  async list(tenantId: string, onlyActive: boolean): Promise<Tariff[]> {
    const rows = await this.db.many(
      `SELECT * FROM tariffs WHERE tenant_id = $1 ${onlyActive ? 'AND is_active' : ''} ORDER BY sort_order, created_at`,
      [tenantId],
    );
    return rows.map((r) => camel<Tariff>(r));
  }

  async get(tenantId: string, id: string, db?: Queryable): Promise<Tariff> {
    const row = await this.db.one(`SELECT * FROM tariffs WHERE id = $1 AND tenant_id = $2`, [id, tenantId], db);
    if (!row) throw new NotFoundException('Тариф не найден');
    return camel<Tariff>(row);
  }

  async create(tenantId: string, input: Required<Pick<TariffInput, 'code' | 'name'>> & TariffInput): Promise<Tariff> {
    try {
      const row = await this.db.one(
        `INSERT INTO tariffs (tenant_id, code, name, base_fare, per_km, per_min, min_fare, round_to, is_active, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [
          tenantId, input.code, input.name,
          input.baseFare ?? 0, input.perKm ?? 0, input.perMin ?? 0, input.minFare ?? 0,
          input.roundTo ?? 1, input.isActive ?? true, input.sortOrder ?? 0,
        ],
      );
      return camel<Tariff>(row);
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('Тариф с таким кодом уже есть');
      throw e;
    }
  }

  async update(tenantId: string, id: string, p: TariffInput): Promise<Tariff> {
    try {
      const row = await this.db.one(
        `UPDATE tariffs SET
           code = COALESCE($3, code), name = COALESCE($4, name),
           base_fare = COALESCE($5, base_fare), per_km = COALESCE($6, per_km), per_min = COALESCE($7, per_min),
           min_fare = COALESCE($8, min_fare), round_to = COALESCE($9, round_to),
           is_active = COALESCE($10, is_active), sort_order = COALESCE($11, sort_order)
         WHERE id = $1 AND tenant_id = $2 RETURNING *`,
        [
          id, tenantId, p.code ?? null, p.name ?? null, p.baseFare ?? null, p.perKm ?? null, p.perMin ?? null,
          p.minFare ?? null, p.roundTo ?? null, p.isActive ?? null, p.sortOrder ?? null,
        ],
      );
      if (!row) throw new NotFoundException('Тариф не найден');
      return camel<Tariff>(row);
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('Тариф с таким кодом уже есть');
      throw e;
    }
  }
}

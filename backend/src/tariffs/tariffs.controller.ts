import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../auth/auth.types';
import { TariffsService } from './tariffs.service';

const money = { maxDecimalPlaces: 2 };

class TariffFieldsDto {
  @IsOptional() @IsNumber(money) @Min(0) @Max(1_000_000) baseFare?: number;
  @IsOptional() @IsNumber(money) @Min(0) @Max(1_000_000) perKm?: number;
  @IsOptional() @IsNumber(money) @Min(0) @Max(1_000_000) perMin?: number;
  @IsOptional() @IsNumber(money) @Min(0) @Max(1_000_000) minFare?: number;
  @IsOptional() @IsNumber(money) @Min(0.01) @Max(10_000) roundTo?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}

class CreateTariffDto extends TariffFieldsDto {
  @Matches(/^[a-z0-9_-]{2,30}$/, { message: 'code: латиница, цифры, _ и -' }) code: string;
  @IsString() @MinLength(1) @MaxLength(60) name: string;
}

class UpdateTariffDto extends TariffFieldsDto {
  @IsOptional() @Matches(/^[a-z0-9_-]{2,30}$/) code?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(60) name?: string;
}

@Controller('tariffs')
export class TariffsController {
  constructor(private readonly tariffs: TariffsService) {}

  /** Пассажиры и водители видят только активные тарифы, сотрудники — все */
  @Get()
  @Roles('owner', 'dispatcher', 'driver', 'passenger')
  list(@CurrentUser() u: AuthUser) {
    return this.tariffs.list(u.tid, u.role === 'driver' || u.role === 'passenger');
  }

  @Post()
  @Roles('owner')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateTariffDto) {
    return this.tariffs.create(u.tid, dto);
  }

  @Patch(':id')
  @Roles('owner')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTariffDto) {
    return this.tariffs.update(u.tid, id, dto);
  }
}

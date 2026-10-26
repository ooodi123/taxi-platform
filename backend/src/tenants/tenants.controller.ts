import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsNumber, IsObject, IsOptional, IsString, Length, Matches, MaxLength,
  MinLength,
} from 'class-validator';
import { AuthUser, CurrentUser, Public, Roles } from '../auth/auth.types';
import { StaffService } from './staff.service';
import { TenantsService } from './tenants.service';

class CreateTenantDto {
  @IsString() @MinLength(2) @MaxLength(100) name: string;
  @Matches(/^[a-z0-9][a-z0-9-]{1,40}$/, { message: 'slug: латиница в нижнем регистре, цифры и дефис' }) slug: string;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(100) ownerLogin?: string;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(200) ownerPassword?: string;
}

class UpdateTenantDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) name?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  /** { appName, primaryColor: '#FFC72C' } */
  @IsOptional() @IsObject() branding?: Record<string, unknown>;
  /** { center: [lat, lng] } — где открывать карту по умолчанию */
  @IsOptional() @IsObject() settings?: Record<string, unknown>;
}

class CreateStaffDto {
  @IsString() @MinLength(3) @MaxLength(100) login: string;
  @IsString() @MinLength(8) @MaxLength(200) password: string;
  @IsOptional() @IsString() @MaxLength(100) name?: string;
}

class UpdateStaffDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(200) password?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

/** Супер-админка: таксопарки платформы */
@Controller('admin/tenants')
@Roles('superadmin')
export class AdminTenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Post()
  create(@Body() dto: CreateTenantDto) {
    return this.tenants.create(dto);
  }

  @Get()
  list() {
    return this.tenants.list();
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTenantDto) {
    return this.tenants.update(id, dto);
  }
}

/** Публичная карточка таксопарка для приложения пассажира */
@Controller('tenants')
export class PublicTenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Public()
  @Get(':slug')
  info(@Param('slug') slug: string) {
    return this.tenants.publicInfo(slug);
  }
}

const TIMEZONES = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [];

class OwnerTenantDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(60) appName?: string;
  @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Цвет в формате #RRGGBB' }) primaryColor?: string;
  @IsOptional() @IsArray() @ArrayMinSize(2) @ArrayMaxSize(2) @IsNumber({}, { each: true }) center?: [number, number];
  @IsOptional() @IsString() timezone?: string;
}

/** Свой таксопарк: владелец меняет название, цвет, центр карты, часовой пояс */
@Controller('tenant')
export class OwnerTenantController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  @Roles('owner', 'dispatcher')
  get(@CurrentUser() u: AuthUser) {
    return this.tenants.getOwn(u.tid);
  }

  @Patch()
  @Roles('owner')
  update(@CurrentUser() u: AuthUser, @Body() dto: OwnerTenantDto) {
    if (dto.timezone && TIMEZONES.length && !TIMEZONES.includes(dto.timezone)) {
      throw new BadRequestException('Неизвестный часовой пояс, пример: Europe/Moscow');
    }
    if (dto.center && (Math.abs(dto.center[0]) > 90 || Math.abs(dto.center[1]) > 180)) {
      throw new BadRequestException('Некорректные координаты центра');
    }
    return this.tenants.updateOwn(u.tid, dto);
  }
}

/** Диспетчеры — управляет владелец таксопарка */
@Controller('staff')
@Roles('owner')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.staff.list(u.tid);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateStaffDto) {
    return this.staff.create(u.tid, dto);
  }

  @Patch(':id')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStaffDto) {
    return this.staff.update(u.tid, id, dto);
  }
}

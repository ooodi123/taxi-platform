import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, MaxLength, Min,
  MinLength, ValidateNested,
} from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../auth/auth.types';
import { DriversService } from './drivers.service';

class DriverFieldsDto {
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsInt() @Min(1) telegramId?: number;
  @IsOptional() @IsString() @MaxLength(60) carModel?: string;
  @IsOptional() @IsString() @MaxLength(30) carColor?: string;
  @IsOptional() @IsString() @MaxLength(20) carPlate?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) tariffCodes?: string[];
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class CreateDriverDto extends DriverFieldsDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
}

class UpdateDriverDto extends DriverFieldsDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
}

export class LocationDto {
  @IsLatitude() lat: number;
  @IsLongitude() lng: number;
}

class StartShiftDto {
  @IsOptional() @ValidateNested() @Type(() => LocationDto) location?: LocationDto;
}

class ListQuery {
  @IsOptional() @IsIn(['offline', 'online', 'busy']) status?: string;
}

/** Водители — управление (владелец, диспетчер) */
@Controller('drivers')
@Roles('owner', 'dispatcher')
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: ListQuery) {
    return this.drivers.list(u.tid, q.status);
  }

  @Get('live')
  live(@CurrentUser() u: AuthUser) {
    return this.drivers.live(u.tid);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateDriverDto) {
    return this.drivers.create(u.tid, dto);
  }

  @Patch(':id')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDriverDto) {
    return this.drivers.update(u.tid, id, dto);
  }
}

/** Действия водителя в своём приложении */
@Controller('driver')
@Roles('driver')
export class DriverSelfController {
  constructor(private readonly drivers: DriversService) {}

  @Get('me')
  me(@CurrentUser() u: AuthUser) {
    return this.drivers.me(u.tid, u.sub);
  }

  /** Поездки и выручка за сегодня */
  @Get('stats')
  stats(@CurrentUser() u: AuthUser) {
    return this.drivers.stats(u.tid, u.sub);
  }

  @Post('shift/start')
  @HttpCode(200)
  startShift(@CurrentUser() u: AuthUser, @Body() dto: StartShiftDto) {
    return this.drivers.startShift(u.tid, u.sub, dto.location);
  }

  @Post('shift/end')
  @HttpCode(200)
  endShift(@CurrentUser() u: AuthUser) {
    return this.drivers.endShift(u.tid, u.sub);
  }

  @Post('location')
  @HttpCode(200)
  location(@CurrentUser() u: AuthUser, @Body() dto: LocationDto) {
    return this.drivers.updateLocation(u.tid, u.sub, dto.lat, dto.lng);
  }
}

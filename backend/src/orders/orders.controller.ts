import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../auth/auth.types';
import { OrderStatus } from './order-status';
import { OrdersService } from './orders.service';

class PlaceDto {
  @IsLatitude() lat: number;
  @IsLongitude() lng: number;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
}

class EstimateDto {
  @ValidateNested() @Type(() => PlaceDto) pickup: PlaceDto;
  @IsOptional() @ValidateNested() @Type(() => PlaceDto) dropoff?: PlaceDto;
}

class CreateOrderDto extends EstimateDto {
  @IsOptional() @IsUUID() tariffId?: string;
  @IsOptional() @IsString() @MaxLength(500) comment?: string;
  /** Для заказов, принятых диспетчером по телефону */
  @IsOptional() @IsString() @MaxLength(100) customerName?: string;
  @IsOptional() @IsString() @MaxLength(30) customerPhone?: string;
}

class CancelDto {
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

class AssignDto {
  @IsUUID() driverId: string;
}

class ListQuery {
  @IsOptional() @IsIn(['searching', 'assigned', 'arrived', 'in_progress', 'completed', 'cancelled', 'expired'])
  status?: OrderStatus;
  @IsOptional() @IsIn(['active', 'today']) scope?: 'active' | 'today';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

const ALL = ['owner', 'dispatcher', 'driver', 'passenger'] as const;

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** Цена по всем тарифам до заказа */
  @Post('estimate')
  @HttpCode(200)
  @Roles('passenger', 'owner', 'dispatcher')
  estimate(@CurrentUser() u: AuthUser, @Body() dto: EstimateDto) {
    return this.orders.estimate(u.tid, dto.pickup, dto.dropoff);
  }

  @Post()
  @Roles('passenger', 'owner', 'dispatcher')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orders.create(u, dto);
  }

  @Get()
  @Roles(...ALL)
  list(@CurrentUser() u: AuthUser, @Query() q: ListQuery) {
    return this.orders.list(u, q);
  }

  /** Активный заказ пассажира / заказ или предложение водителя */
  @Get('current')
  @Roles('passenger', 'driver')
  current(@CurrentUser() u: AuthUser) {
    return this.orders.current(u);
  }

  @Get(':id')
  @Roles(...ALL)
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.getForUser(u, id);
  }

  /** История событий заказа — для диспетчера */
  @Get(':id/events')
  @Roles('owner', 'dispatcher')
  events(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.events(u, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(...ALL)
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto) {
    return this.orders.cancel(u, id, dto.reason);
  }

  @Post(':id/assign')
  @HttpCode(200)
  @Roles('owner', 'dispatcher')
  assign(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignDto) {
    return this.orders.assign(u, id, dto.driverId);
  }

  // ----- водитель -----

  @Post(':id/accept')
  @HttpCode(200)
  @Roles('driver')
  accept(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.accept(u, id);
  }

  @Post(':id/decline')
  @HttpCode(200)
  @Roles('driver')
  decline(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.decline(u, id);
  }

  @Post(':id/arrived')
  @HttpCode(200)
  @Roles('driver')
  arrived(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.arrived(u, id);
  }

  @Post(':id/start')
  @HttpCode(200)
  @Roles('driver')
  start(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.start(u, id);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @Roles('driver')
  complete(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.complete(u, id);
  }
}

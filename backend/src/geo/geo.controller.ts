import { Controller, Get, Module, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../auth/auth.types';
import { GeoService } from './geo.service';

class SearchQuery {
  @IsString() @MaxLength(200) q: string;
  @IsOptional() @Type(() => Number) @IsLatitude() lat?: number;
  @IsOptional() @Type(() => Number) @IsLongitude() lng?: number;
}

class ReverseQuery {
  @Type(() => Number) @IsLatitude() lat: number;
  @Type(() => Number) @IsLongitude() lng: number;
}

@Controller('geo')
@Roles('passenger', 'driver', 'owner', 'dispatcher')
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  /** Поиск адреса по тексту: /api/geo/search?q=Тверская 7&lat=..&lng=.. */
  @Get('search')
  search(@Query() q: SearchQuery) {
    const near = q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : undefined;
    return this.geo.search(q.q, near);
  }

  /** Адрес по точке на карте */
  @Get('reverse')
  reverse(@Query() q: ReverseQuery) {
    return this.geo.reverse(q.lat, q.lng);
  }
}

@Module({
  controllers: [GeoController],
  providers: [GeoService],
})
export class GeoModule {}

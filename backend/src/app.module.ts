import { Controller, Get, Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { Public } from './auth/auth.types';
import { DbModule } from './db/db.module';
import { DbService } from './db/db.service';
import { RedisService } from './db/redis.service';
import { DriversModule } from './drivers/drivers.module';
import { OrdersModule } from './orders/orders.module';
import { RealtimeModule } from './realtime/realtime.module';
import { TariffsModule } from './tariffs/tariffs.module';
import { TenantsModule } from './tenants/tenants.module';
import { TelegramModule } from './telegram/telegram.module';
import { GeoModule } from './geo/geo.controller';
import { DemoModule } from './demo/demo.service';

@Controller('health')
class HealthController {
  constructor(private readonly db: DbService, private readonly redis: RedisService) {}

  @Public()
  @Get()
  async health() {
    await this.db.one('SELECT 1');
    await this.redis.ping();
    return { ok: true, time: new Date().toISOString() };
  }
}

@Module({
  imports: [DbModule, RealtimeModule, TelegramModule, AuthModule, GeoModule, TenantsModule, TariffsModule, DriversModule, OrdersModule, DemoModule],
  controllers: [HealthController],
})
export class AppModule {}

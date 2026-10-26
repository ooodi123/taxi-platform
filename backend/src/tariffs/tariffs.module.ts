import { Global, Module } from '@nestjs/common';
import { RoutingService } from '../pricing/routing.service';
import { TariffsController } from './tariffs.controller';
import { TariffsService } from './tariffs.service';

@Global()
@Module({
  controllers: [TariffsController],
  providers: [TariffsService, RoutingService],
  exports: [TariffsService, RoutingService],
})
export class TariffsModule {}

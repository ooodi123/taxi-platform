import { Module } from '@nestjs/common';
import { DispatchService } from './dispatch.service';
import { OrderViewService } from './order-view.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, DispatchService, OrderViewService],
  exports: [OrdersService, DispatchService],
})
export class OrdersModule {}

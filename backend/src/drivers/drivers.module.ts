import { Module } from '@nestjs/common';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { DriverSelfController, DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';

@Module({
  controllers: [DriversController, DriverSelfController],
  // сокет-шлюз живёт здесь: ему нужен DriversService для приёма координат
  providers: [DriversService, RealtimeGateway],
  exports: [DriversService],
})
export class DriversModule {}

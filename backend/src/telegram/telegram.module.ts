import { Global, Module } from '@nestjs/common';
import { AdminBotController, OwnerBotController, TelegramWebhookController } from './telegram.controller';
import { TelegramService } from './telegram.service';

@Global()
@Module({
  controllers: [TelegramWebhookController, OwnerBotController, AdminBotController],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}

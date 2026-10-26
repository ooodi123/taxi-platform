import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { AuthUser, CurrentUser, Public, Roles } from '../auth/auth.types';
import { TelegramService } from './telegram.service';

class ConnectBotDto {
  @IsString() @MinLength(20) @MaxLength(100) botToken: string;
}

/** Сюда Telegram присылает сообщения ботам таксопарков */
@Controller('telegram')
export class TelegramWebhookController {
  constructor(private readonly telegram: TelegramService) {}

  @Public()
  @Post('webhook/:tenantId')
  @HttpCode(200)
  webhook(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() update: any,
  ) {
    return this.telegram.handleUpdate(tenantId, secret, update);
  }
}

/** Владелец таксопарка подключает своего бота */
@Controller('bot')
@Roles('owner')
export class OwnerBotController {
  constructor(private readonly telegram: TelegramService) {}

  @Get()
  status(@CurrentUser() u: AuthUser) {
    return this.telegram.botStatus(u.tid);
  }

  @Put()
  connect(@CurrentUser() u: AuthUser, @Body() dto: ConnectBotDto) {
    return this.telegram.connectBot(u.tid, dto.botToken.trim());
  }

  @Delete()
  disconnect(@CurrentUser() u: AuthUser) {
    return this.telegram.disconnectBot(u.tid);
  }
}

/** Супер-админ подключает бота любому таксопарку */
@Controller('admin/tenants/:id/bot')
@Roles('superadmin')
export class AdminBotController {
  constructor(private readonly telegram: TelegramService) {}

  @Get()
  status(@Param('id', ParseUUIDPipe) id: string) {
    return this.telegram.botStatus(id);
  }

  @Put()
  connect(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConnectBotDto) {
    return this.telegram.connectBot(id, dto.botToken.trim());
  }

  @Delete()
  disconnect(@Param('id', ParseUUIDPipe) id: string) {
    return this.telegram.disconnectBot(id);
  }
}

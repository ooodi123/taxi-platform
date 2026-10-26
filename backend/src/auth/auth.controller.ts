import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { AuthUser, CurrentUser, Public, Roles } from './auth.types';

class StaffLoginDto {
  @IsString() @MinLength(1) @MaxLength(100) login: string;
  @IsString() @MinLength(1) @MaxLength(200) password: string;
}

class DevTokenDto {
  @IsString() tenantSlug: string;
  @IsIn(['passenger', 'driver']) role: 'passenger' | 'driver';
  @IsInt() @Min(1) telegramId: number;
  @IsOptional() @IsString() @MaxLength(100) name?: string;
}

class TelegramLoginDto {
  @IsString() tenantSlug: string;
  @IsString() @MinLength(10) @MaxLength(4096) initData: string;
  @IsOptional() @IsIn(['passenger', 'driver']) role?: 'passenger' | 'driver';
}

class UpdateProfileDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @Matches(/^\+?[0-9 ()-]{6,20}$/, { message: 'Некорректный телефон' }) phone?: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Вход владельца/диспетчера таксопарка */
  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: StaffLoginDto) {
    return this.auth.staffLogin(dto.login, dto.password);
  }

  /** Тестовый вход пассажира/водителя (DEV_AUTH=true) */
  @Public()
  @Post('dev/token')
  @HttpCode(200)
  devToken(@Body() dto: DevTokenDto) {
    return this.auth.devToken(dto);
  }

  /** Вход из Telegram Mini App (пассажир или водитель) */
  @Public()
  @Post('telegram')
  @HttpCode(200)
  telegram(@Body() dto: TelegramLoginDto) {
    return this.auth.telegramLogin({ ...dto, role: dto.role ?? 'passenger' });
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  /** Пассажир указывает имя и телефон (телефон увидит водитель) */
  @Patch('me')
  @Roles('passenger')
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.auth.updatePassenger(user, dto);
  }
}

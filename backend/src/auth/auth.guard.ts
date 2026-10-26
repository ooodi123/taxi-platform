import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { timingSafeEqual } from 'crypto';
import { config } from '../config';
import { AuthUser, IS_PUBLIC_KEY, Role, ROLES_KEY } from './auth.types';

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Глобальная защита HTTP-маршрутов.
 * Токен: заголовок `Authorization: Bearer <jwt>`.
 * Супер-админ: заголовок `X-Super-Admin-Key: <SUPER_ADMIN_KEY>`.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtService) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true; // сокеты проверяются в RealtimeGateway
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    req.user = this.resolveUser(req);
    if (!req.user) throw new UnauthorizedException('Нужна авторизация');

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (roles?.length && !roles.includes(req.user.role)) throw new ForbiddenException('Недостаточно прав');
    return true;
  }

  private resolveUser(req: any): AuthUser | null {
    const superKey = req.headers['x-super-admin-key'];
    if (typeof superKey === 'string' && config.superAdminKey) {
      if (!safeEqual(superKey, config.superAdminKey)) throw new UnauthorizedException('Неверный ключ супер-админа');
      return { sub: 'superadmin', role: 'superadmin', tid: '' };
    }
    const header: string | undefined = req.headers['authorization'];
    if (!header?.startsWith('Bearer ')) return null;
    return verifyToken(this.jwt, header.slice(7));
  }
}

export function verifyToken(jwt: JwtService, token: string): AuthUser {
  try {
    const p = jwt.verify<AuthUser & { iat: number; exp: number }>(token);
    return { sub: p.sub, role: p.role, tid: p.tid };
  } catch {
    throw new UnauthorizedException('Токен недействителен или истёк');
  }
}

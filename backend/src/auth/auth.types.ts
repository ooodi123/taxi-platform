import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export type Role = 'superadmin' | 'owner' | 'dispatcher' | 'driver' | 'passenger';

/** Содержимое токена. tid — id таксопарка (у супер-админа пусто). */
export interface AuthUser {
  sub: string;
  role: Role;
  tid: string;
}

export const STAFF_ROLES: Role[] = ['owner', 'dispatcher'];

export const IS_PUBLIC_KEY = 'isPublic';
/** Маршрут без авторизации */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
/** Какие роли допускаются к маршруту */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Текущий пользователь из токена */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

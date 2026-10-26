"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CurrentUser = exports.Roles = exports.ROLES_KEY = exports.Public = exports.IS_PUBLIC_KEY = exports.STAFF_ROLES = void 0;
const common_1 = require("@nestjs/common");
exports.STAFF_ROLES = ['owner', 'dispatcher'];
exports.IS_PUBLIC_KEY = 'isPublic';
/** Маршрут без авторизации */
const Public = () => (0, common_1.SetMetadata)(exports.IS_PUBLIC_KEY, true);
exports.Public = Public;
exports.ROLES_KEY = 'roles';
/** Какие роли допускаются к маршруту */
const Roles = (...roles) => (0, common_1.SetMetadata)(exports.ROLES_KEY, roles);
exports.Roles = Roles;
/** Текущий пользователь из токена */
exports.CurrentUser = (0, common_1.createParamDecorator)((_, ctx) => {
    return ctx.switchToHttp().getRequest().user;
});

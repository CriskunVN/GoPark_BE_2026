import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [ // Lấy metadata roles từ decorator, có thể lấy từ handler hoặc class
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    if (!user || !user.roles) {
      throw new ForbiddenException('Bạn không có quyền truy cập');
    }
// Kiểm tra xem user có ít nhất một role trong số các role yêu cầu hay không
    const hasRole = requiredRoles.some((role) => user.roles.includes(role));
    if (!hasRole) {
        throw new ForbiddenException('Bạn không có quyền thực hiện hành động này');
    }

    return true;
  }
}
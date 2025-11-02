/**
 * RolesGuard enforces RBAC metadata by comparing required role names with the user payload.
 */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { RoleName } from '@app/prisma/prisma.constants';
import { CurrentUserPayload } from '../decorators/current-user.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
/**
 * Checks whether the authenticated user satisfies the roles declared via the Roles decorator.
 */
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  /**
   * Resolves required roles metadata and verifies that the current user possesses at least one.
   * @throws ForbiddenException when no user context exists or required roles are missing.
   */
  canActivate(context: ExecutionContext): boolean {
    const requiredRoles =
      this.reflector.getAllAndOverride<RoleName[]>(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: CurrentUserPayload }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('دسترسی برای کاربر ناشناس مجاز نیست.');
    }

    const hasRole = user.roles?.some((role) =>
      requiredRoles.includes(role as RoleName),
    );

    if (!hasRole) {
      throw new ForbiddenException('دسترسی به این منبع مجاز نیست.');
    }

    return true;
  }
}

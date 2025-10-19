/**
 * Decorator helpers to declare required role names on route handlers for RolesGuard.
 */
import { SetMetadata } from '@nestjs/common';
import { RoleName } from '../../core/roles/role.entity';

/**
 * Metadata key used to store role requirements on route handlers.
 */
export const ROLES_KEY = 'roles';

/**
 * Marks a controller/handler as requiring the listed roles for access.
 */
export const Roles = (...roles: RoleName[]) => SetMetadata(ROLES_KEY, roles);

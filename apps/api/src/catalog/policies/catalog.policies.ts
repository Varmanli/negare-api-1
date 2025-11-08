import { CurrentUserPayload } from '@app/common/decorators/current-user.decorator';
import { RoleName } from '@prisma/client';

export function hasRole(
  user: CurrentUserPayload | undefined,
  role: RoleName,
): boolean {
  return Boolean(user?.roles?.includes(role));
}

export function isAdmin(user: CurrentUserPayload | undefined): boolean {
  return hasRole(user, RoleName.admin);
}

export function isSupplier(user: CurrentUserPayload | undefined): boolean {
  return hasRole(user, RoleName.supplier);
}

export function canManageProduct(
  user: CurrentUserPayload | undefined,
): boolean {
  return isAdmin(user) || isSupplier(user);
}

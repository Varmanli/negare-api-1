/**
 * Provides access to the `request.user` payload assigned by authentication guards.
 */
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/**
 * Shape of the minimal user context that guards attach to Express requests.
 */
export interface CurrentUserPayload {
  id: string;
  roles: string[];
}

/**
 * Parameter decorator that resolves the authenticated user context, if available.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentUserPayload | undefined => {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: CurrentUserPayload }>();
    return request.user;
  },
);

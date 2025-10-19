/**
 * JwtAuthGuard enforces access-token authentication on protected routes by verifying
 * bearer tokens and attaching a minimal user payload to the request for downstream use.
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { JwtPayload, verify } from 'jsonwebtoken';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';

interface AccessJwtPayload extends JwtPayload {
  sub: string;
  roles?: string[];
  username?: string;
}

@Injectable()
/**
 * Validates bearer access tokens and populates `request.user` with user id and roles.
 */
export class JwtAuthGuard implements CanActivate {
  private readonly accessSecret: string;

  constructor(private readonly config: ConfigService) {
    this.accessSecret = this.config.getOrThrow<string>('ACCESS_JWT_SECRET');
  }

  /**
   * Extracts and verifies the bearer access token, attaching the decoded payload to the request.
   * @throws UnauthorizedException when the token is absent or invalid.
   */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<
      Request & { user?: CurrentUserPayload }
    >();

    const token = this.extractBearerToken(request);
    const payload = this.verifyToken(token);

    request.user = {
      id: payload.sub,
      roles: Array.isArray(payload.roles)
        ? payload.roles.map((role) => String(role))
        : [],
    };

    return true;
  }

  /**
   * Reads the authorization header and returns the bearer token string.
   * @param request Incoming Express request.
   * @throws UnauthorizedException when the header is missing, malformed, or not bearer.
   */
  private extractBearerToken(request: Request): string {
    const authHeader =
      request.headers.authorization || request.headers.Authorization;
    if (!authHeader || Array.isArray(authHeader)) {
      throw new UnauthorizedException('توکن دسترسی ارسال نشده است');
    }
    const [scheme, token] = authHeader.split(' ');
    if (!token || scheme?.toLowerCase() !== 'bearer') {
      throw new UnauthorizedException('نوع احراز هویت پشتیبانی نمی‌شود');
    }
    return token;
  }

  /**
   * Validates the access token signature and required claims.
   * @param token Raw JWT string from the header.
   * @throws UnauthorizedException on signature issues, missing subject, or other verification errors.
   */
  private verifyToken(token: string): AccessJwtPayload {
    try {
      const payload = verify(token, this.accessSecret) as AccessJwtPayload;
      if (!payload.sub) {
        throw new UnauthorizedException('توکن دسترسی معتبر نیست');
      }
      return payload;
    } catch (error) {
      throw new UnauthorizedException('توکن دسترسی معتبر نیست');
    }
  }
}

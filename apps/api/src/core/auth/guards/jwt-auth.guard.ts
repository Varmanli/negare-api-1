/**
 * JwtAuthGuard enforces access-token authentication on protected routes by verifying
 * bearer tokens and attaching a minimal user payload to the request for downstream use.
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { JwtPayload, verify } from 'jsonwebtoken';
import { CurrentUserPayload } from '@app/common/decorators/current-user.decorator';
import { AllConfig } from '@app/config/config.module';
import { AuthConfig } from '@app/config/auth.config';

interface AccessJwtPayload extends JwtPayload {
  sub: string;
  roles?: string[];
  username?: string;
}

@Injectable()
/**
 * Validates bearer access tokens and populates `request.user` with user id and roles.
 */
export class JwtAuthGuard implements CanActivate, OnModuleInit {
  private accessSecret =
    process.env.AUTH_ACCESS_SECRET ?? 'dev_access_secret_for_tests';

  constructor(private readonly config: ConfigService<AllConfig>) {}

  onModuleInit() {
    const auth = this.config.get<AuthConfig>('auth', { infer: true });
    if (auth?.accessSecret) {
      this.accessSecret = auth.accessSecret;
      return;
    }
    if (process.env.AUTH_ACCESS_SECRET) {
      this.accessSecret = process.env.AUTH_ACCESS_SECRET;
    }
  }

  /**
   * Extracts and verifies the bearer access token, attaching the decoded payload to the request.
   * @throws UnauthorizedException when the token is absent or invalid.
   */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<
      Request & { user?: CurrentUserPayload }
    >();

    const token =
      this.extractBearerToken(request) ?? this.extractCookieToken(request);

    if (!token) {
      throw new UnauthorizedException('Authorization token not found');
    }

    const payload = this.verifyToken(token);

    request.user = {
      id: payload.sub,
      roles: Array.isArray(payload.roles)
        ? payload.roles.map((role) => String(role))
        : [],
      username: payload.username,
    };

    return true;
  }

  /**
   * Reads the authorization header and returns the bearer token string.
   * @param request Incoming Express request.
   * @throws UnauthorizedException when the scheme is present but not bearer.
   */
  private extractBearerToken(request: Request): string | null {
    const authHeader =
      request.headers.authorization ?? request.headers.Authorization;
    if (!authHeader || Array.isArray(authHeader)) {
      return null;
    }
    const [scheme, token] = authHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer') {
      throw new UnauthorizedException('Authorization token not found');
    }
    if (!token) {
      throw new UnauthorizedException('Authorization token not found');
    }
    return token;
  }

  /**
   * Extracts an access token from HttpOnly cookies when the Authorization header is absent.
   * @param request Incoming Express request.
   * @returns JWT string or null when no cookie was provided.
   */
  private extractCookieToken(request: Request): string | null {
    const cookies = (
      request as Request & {
        cookies?: Record<string, string | undefined>;
      }
    ).cookies;
    const token = cookies?.access_token;
    if (typeof token === 'string' && token.length > 0) {
      return token;
    }
    return null;
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
        throw new UnauthorizedException('Invalid or expired access token');
      }
      return payload;
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}

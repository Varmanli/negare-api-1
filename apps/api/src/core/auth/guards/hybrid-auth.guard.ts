/**
 * HybridAuthGuard supports both signed bearer tokens and local development mock headers.
 * It prioritizes JWT verification, only accepting mock headers when explicitly enabled.
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { JwtPayload, verify } from 'jsonwebtoken';
import {
  CurrentUserPayload,
} from '@app/common/decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '@app/common/decorators/public.decorator';
import { AllConfig } from '@app/config/config.module';
import { AuthConfig } from '@app/config/auth.config';

interface MockUserHeaderPayload {
  id: string;
  roles?: string[];
}

interface AccessJwtPayload extends JwtPayload {
  sub: string;
  roles?: string[];
  username?: string;
}

@Injectable()
/**
 * Applies hybrid authentication: bearer JWTs in production and optional mock headers in dev.
 */
export class HybridAuthGuard implements CanActivate {
  private readonly logger = new Logger(HybridAuthGuard.name);
  private readonly accessSecret: string;

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService<AllConfig>,
  ) {
    const auth = this.config.get<AuthConfig>('auth', { infer: true });
    if (!auth) {
      throw new Error('Auth configuration is not available.');
    }
    this.accessSecret = auth.accessSecret;
  }

  /**
   * Resolves whether a request can proceed by checking public metadata first,
   * then attempting bearer authentication, and finally falling back to mock headers.
   * @throws UnauthorizedException when neither bearer nor mock access is allowed.
   */
  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<
      Request & { user?: CurrentUserPayload }
    >();

    if (isPublic || this.isPublicPath(request)) {
      return true;
    }

    const bearerResult = this.tryAuthenticateWithBearer(request);
    if (bearerResult) {
      request.user = bearerResult;
      return true;
    }

    if (!this.isMockEnabled()) {
      throw new UnauthorizedException('توکن دسترسی ارسال نشده است');
    }

    const mockUser = this.authenticateWithMockHeader(request);
    request.user = mockUser;
    return true;
  }

  /**
   * Attempts to authenticate via Authorization bearer token and returns a user payload.
   * @param request Incoming HTTP request.
   * @returns Current user payload when successful, otherwise null.
   * @throws UnauthorizedException when the scheme is not bearer or verification fails.
   */
  private tryAuthenticateWithBearer(
    request: Request,
  ): CurrentUserPayload | null {
    const authHeader =
      request.headers.authorization || request.headers.Authorization;
    if (!authHeader || Array.isArray(authHeader)) {
      return null;
    }
    const [scheme, token] = authHeader.split(' ');
    if (!token) {
      return null;
    }
    if (scheme?.toLowerCase() !== 'bearer') {
      throw new UnauthorizedException('نوع احراز هویت پشتیبانی نمی‌شود');
    }
    try {
      const payload = verify(token, this.accessSecret) as AccessJwtPayload;
      if (!payload.sub) {
        throw new UnauthorizedException('توکن دسترسی معتبر نیست');
      }
      return {
        id: payload.sub,
        roles: Array.isArray(payload.roles)
          ? payload.roles.map((role) => String(role))
          : [],
        username: payload.username,
      };
    } catch (error) {
      this.logger.debug(`Failed bearer auth: ${String(error)}`);
      throw new UnauthorizedException('توکن دسترسی معتبر نیست');
    }
  }

  /**
   * Parses the `x-mock-user` header and returns a user payload for local workflows.
   * @param request Current request expected to contain the header.
   * @throws UnauthorizedException when the header is missing or malformed.
   */
  private authenticateWithMockHeader(request: Request): CurrentUserPayload {
    const headerValue = request.headers['x-mock-user'];
    if (!headerValue) {
      throw new UnauthorizedException(' x-mock-user   ');
    }

    const serialized =
      Array.isArray(headerValue) && headerValue.length > 0
        ? headerValue[0]
        : (headerValue as string);

    try {
      const parsed = JSON.parse(serialized) as MockUserHeaderPayload;
      if (!parsed?.id || typeof parsed.id !== 'string') {
        throw new Error('Invalid id');
      }
      if (parsed.roles && !Array.isArray(parsed.roles)) {
        throw new Error('Invalid roles array');
      }
      const user: CurrentUserPayload = {
        id: parsed.id,
        roles: Array.from(
          new Set((parsed.roles ?? []).map((role) => String(role))),
        ),
        username: undefined,
      };
      this.logger.debug(
        `Authenticated mock user ${user.id} roles=${user.roles.join(',')}`,
      );
      return user;
    } catch (error) {
      this.logger.warn(`Failed to parse x-mock-user header: ${String(error)}`);
      throw new UnauthorizedException('  x-mock-user  ');
    }
  }

  /**
   * Whitelists doc, swagger, and health endpoints regardless of auth settings.
   * @param request Current HTTP request.
   * @returns True if the path is intentionally public.
   */
  private isPublicPath(request: Request): boolean {
    const path = request.path ?? request.url ?? '';
    return (
      path.startsWith('/api/docs') ||
      path.startsWith('/docs') ||
      path.startsWith('/swagger-ui') ||
      path.startsWith('/health')
    );
  }

  /**
   * Checks environment configuration to determine if mock authentication is allowed.
   * @returns True when the mock header fallback is enabled.
   */
  private isMockEnabled(): boolean {
    const flag = this.config.get<string>('MOCK_AUTH_ENABLED');
    if (typeof flag === 'string') {
      return ['1', 'true', 'yes', 'on'].includes(flag.toLowerCase());
    }
    const env =
      this.config.get<string>('NODE_ENV') ??
      process.env.NODE_ENV ??
      'development';
    return env !== 'production';
  }
}

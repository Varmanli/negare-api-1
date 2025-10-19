/**
 * RefreshService manages JWT issuance, rotation, and revocation for access/refresh tokens,
 * using Redis for refresh token allow-list semantics and UsersService for role hydration.
 */
import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtPayload, SignOptions, sign, verify } from 'jsonwebtoken';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { UsersService } from '../core/users/users.service';
import { User } from '../core/users/user.entity';
import { parseDurationToSeconds } from '../shared/utils/parse-duration.util';
import { RoleName } from '../core/roles/role.entity';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface RefreshJwtPayload extends JwtPayload {
  sub: string;
  jti?: string;
  purpose?: string;
}

@Injectable()
/**
 * Issues access/refresh token pairs, verifies refresh tokens, and enforces single-use JTIs.
 * Acts as the central point for token lifecycle operations referenced by controllers/services.
 */
export class RefreshService {
  private readonly logger = new Logger(RefreshService.name);

  private readonly accessSecret: string;
  private readonly accessExpires: string;
  private readonly refreshSecret: string;
  private readonly refreshExpires: string;
  private readonly refreshTtlSeconds: number;

  constructor(
    @Inject('REDIS') private readonly redis: Redis,
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
  ) {
    this.accessSecret = this.config.getOrThrow<string>('ACCESS_JWT_SECRET');
    this.accessExpires = this.config.get<string>('ACCESS_JWT_EXPIRES') || '1h';
    this.refreshSecret = this.config.getOrThrow<string>('REFRESH_JWT_SECRET');
    this.refreshExpires =
      this.config.get<string>('REFRESH_JWT_EXPIRES') || '30d';
    this.refreshTtlSeconds = parseDurationToSeconds(
      this.refreshExpires,
      30 * 24 * 3600,
    );
  }

  /**
   * Issues a token pair for an already-loaded user entity, hydrating roles when necessary.
   * @param user Entity that may or may not already include relations.
   * @returns Promise resolving to access/refresh tokens.
   */
  async issueTokensForUser(user: User): Promise<TokenPair> {
    const hydrated =
      user.userRoles && user.userRoles.length > 0
        ? user
        : await this.ensureUserWithRoles(user.id);
    return this.issuePair(hydrated);
  }

  /**
   * Convenience wrapper that loads a user by id and issues tokens with role context.
   * @param userId UUID of the subject.
   * @returns Token pair ready for client consumption.
   */
  async issueTokensForUserId(userId: string): Promise<TokenPair> {
    const hydrated = await this.ensureUserWithRoles(userId);
    return this.issuePair(hydrated);
  }

  /**
   * Verifies the supplied refresh token, rotates it, and returns a fresh token pair.
   * @param refreshToken JWT string provided by the client.
   * @returns New access/refresh tokens.
   * @throws UnauthorizedException when the refresh token is invalid or revoked.
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const payload = this.verifyRefreshToken(refreshToken);
    const key = this.refreshKey(payload.sub, payload.jti);

    const exists = await this.redis.get(key);
    if (!exists) {
      throw new UnauthorizedException(
        'رفرش توکن نامعتبر است یا قبلاً استفاده شده است',
      );
    }

    await this.redis.del(key);

    const user = await this.ensureUserWithRoles(payload.sub);
    const pair = await this.issuePair(user);

    return pair;
  }

  /**
   * Revokes a refresh token by deleting its JTI entry from Redis.
   * Safe to call multiple times thanks to Redis DEL semantics.
   * @param refreshToken JWT string which may or may not be expired.
   */
  async revoke(refreshToken: string): Promise<void> {
    const payload = this.verifyRefreshToken(refreshToken, true);
    if (!payload.sub || !payload.jti) {
      return;
    }
    await this.redis.del(this.refreshKey(payload.sub, payload.jti));
  }

  /**
   * Internal helper that constructs and stores access/refresh tokens while
   * registering the refresh JTI for later revocation checks.
   * @param user User entity with roles loaded.
   */
  private async issuePair(user: User): Promise<TokenPair> {
    const jti = randomUUID();
    const rawRoles = (user.userRoles ?? [])
      .map((relation) => relation.role?.name)
      .filter((name): name is RoleName => Boolean(name));
    const roleNames = Array.from(new Set(rawRoles)).map((role) =>
      role.toString(),
    );

    const accessToken = sign(
      {
        sub: user.id,
        username: user.username,
        roles: roleNames,
      },
      this.accessSecret,
      { expiresIn: this.accessExpires } as SignOptions,
    );

    const refreshToken = sign(
      {
        sub: user.id,
        purpose: 'refresh',
      },
      this.refreshSecret,
      {
        expiresIn: this.refreshExpires,
        jwtid: jti,
      } as SignOptions,
    );

    const ttl = Math.max(this.refreshTtlSeconds, 60);
    await this.redis.set(this.refreshKey(user.id, jti), '1', 'EX', ttl);

    return { accessToken, refreshToken };
  }

  /**
   * Verifies a refresh token signature and validates semantics such as JTI and purpose.
   * @param token JWT string to inspect.
   * @param ignoreExpiration True when we only need to revoke an expired token explicitly.
   * @returns Decoded payload containing subject and jti claims.
   * @throws UnauthorizedException when the token fails validation.
   */
  private verifyRefreshToken(
    token: string,
    ignoreExpiration = false,
  ): RefreshJwtPayload {
    if (!token) {
      throw new UnauthorizedException('رفرش توکن ارسال نشده است');
    }
    try {
      const payload = verify(token, this.refreshSecret, {
        ignoreExpiration,
      }) as RefreshJwtPayload;

      if (!payload.sub || !payload.jti) {
        throw new UnauthorizedException('رفرش توکن معتبر نیست');
      }
      if (payload.purpose && payload.purpose !== 'refresh') {
        throw new UnauthorizedException('رفرش توکن معتبر نیست');
      }

      return payload;
    } catch (error) {
      if (ignoreExpiration) {
        this.logger.debug(`Ignore expiration verification failed: ${String(error)}`);
      }
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.debug(`Failed to verify refresh token: ${String(error)}`);
      throw new UnauthorizedException('رفرش توکن معتبر نیست');
    }
  }

  /**
   * Ensures we operate on an active user entity with roles preloaded.
   * @param userId UUID of the subject.
   */
  private async ensureUserWithRoles(userId: string): Promise<User> {
    const user = await this.usersService.findById(userId);
    if (!user || user.isActive === false) {
      throw new UnauthorizedException('کاربر یافت نشد یا غیرفعال است');
    }
    return user;
  }

  /**
   * Generates the Redis key storing a refresh token's allow-list entry.
   * @param userId Subject id.
   * @param jti Refresh token unique identifier.
   * @returns Namespaced key string.
   */
  private refreshKey(userId: string, jti?: string) {
    if (!jti) {
      return `rt:${userId}:unknown`;
    }
    return `rt:${userId}:${jti}`;
  }
}

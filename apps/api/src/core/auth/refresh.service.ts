import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { UsersService, UserWithRelations } from '@app/core/users/users.service';
import { parseDurationToSeconds } from '@app/shared/utils/parse-duration.util';
import { RoleName } from '@app/prisma/prisma.constants';
import { AllConfig } from '@app/config/config.module';
import { AuthConfig } from '@app/config/auth.config';
import { SessionService } from './session/session.service';
import { RefreshAllowRecord, refreshAllowKey } from './auth.constants';
import { TokenService, RefreshTokenPayload } from './token/token.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface IssueOpts {
  sessionId?: string;
}

@Injectable()
export class RefreshService {
  private readonly logger = new Logger(RefreshService.name);

  private readonly refreshTtlSeconds: number;

  constructor(
    @Inject('REDIS') private readonly redis: Redis,
    private readonly config: ConfigService<AllConfig>,
    private readonly usersService: UsersService,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
  ) {
    const auth = this.config.get<AuthConfig>('auth', { infer: true });
    if (!auth) {
      throw new Error('Auth configuration is not available.');
    }
    this.refreshTtlSeconds = parseDurationToSeconds(
      auth.refreshExpires,
      30 * 24 * 3600,
    );
  }

  /** قبلی: فقط userId می‌گرفت — حالا opts اختیاری هم دارد */
  async issueTokensForUserId(
    userId: string,
    opts: IssueOpts = {},
  ): Promise<TokenPair> {
    const hydrated = await this.usersService.ensureActiveWithRoles(userId);
    return this.buildPair(hydrated, opts.sessionId); // ➜ sessionId پاس داده می‌شود
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const payload = await this.verifyRefreshToken(refreshToken);
    const key = this.refreshKey(payload.jti);

    const stored = await this.redis.get(key);
    if (!stored) {
      this.logger.debug(
        `Rejecting refresh for user ${payload.sub}: JTI ${payload.jti} not allow-listed`,
      );
      throw new UnauthorizedException(
        'Refresh token is no longer valid. Please sign in again.',
      );
    }

    let record: RefreshAllowRecord | null = null;
    try {
      record = JSON.parse(stored) as RefreshAllowRecord;
    } catch {
      if (stored === '1') {
        record = {
          userId: payload.sub,
          sessionId: payload.sid ?? null,
        };
      } else {
        record = null;
      }
    }

    if (!record || record.userId !== payload.sub) {
      throw new UnauthorizedException('Malformed refresh token state.');
    }

    if (record.sessionId && record.sessionId !== payload.sid) {
      throw new UnauthorizedException('Refresh token session mismatch.');
    }

    await this.redis.del(key);

    await this.tokens
      .blacklistRefreshJti(payload.jti, this.refreshTtlSeconds)
      .catch((err) =>
        this.logger.warn(
          `Failed to blacklist refresh JTI=${payload.jti}: ${err?.message ?? err}`,
        ),
      );

    if (record.sessionId) {
      await this.sessions
        .unlinkRefreshJti(payload.sub, record.sessionId, payload.jti)
        .catch(() => undefined);
    }

    const user = await this.usersService.ensureActiveWithRoles(payload.sub);
    return this.buildPair(user, record.sessionId ?? payload.sid);
  }

  async revoke(refreshToken: string): Promise<void> {
    const payload = await this.verifyRefreshToken(refreshToken, true, true);
    if (!payload.sub || !payload.jti) return;

    await this.redis.del(this.refreshKey(payload.jti));

    await this.tokens
      .blacklistRefreshJti(payload.jti, this.refreshTtlSeconds)
      .catch((err) =>
        this.logger.warn(
          `Failed to blacklist revoked refresh JTI=${payload.jti}: ${err?.message ?? err}`,
        ),
      );

    if (payload.sid) {
      await this.sessions
        .unlinkRefreshJti(payload.sub, payload.sid, payload.jti)
        .catch(() => undefined);
    }
  }

  /** NEW: فقط payload را برمی‌گرداند (برای logout/touch سناریوها) */
  async peekPayload(
    token: string,
    ignoreExpiration = false,
  ): Promise<RefreshTokenPayload | null> {
    return this.tokens.peekRefresh(token, {
      ignoreExpiration,
      allowBlacklisted: true,
    });
  }

  // ----------------- داخلی‌ها -----------------

  private async buildPair(
    user: UserWithRelations,
    sessionId?: string,
  ): Promise<TokenPair> {
    const jti = randomUUID();
    const rawRoles = (user.userRoles ?? [])
      .map((relation) => relation.role?.name)
      .filter((name): name is RoleName => Boolean(name));
    const roleNames = Array.from(new Set(rawRoles)).map((role) =>
      role.toString(),
    );

    const accessToken = this.tokens.signAccess({
      userId: user.id,
      roles: roleNames as RoleName[],
    });

    const refreshToken = this.tokens.signRefresh({
      userId: user.id,
      sessionId: sessionId ?? jti,
      jti,
    });

    const ttl = Math.max(this.refreshTtlSeconds, 60);

    const record: RefreshAllowRecord = {
      userId: user.id,
      sessionId: sessionId ?? null,
    };

    await this.redis.set(this.refreshKey(jti), JSON.stringify(record), 'EX', ttl);

    // اگر sessionId داریم، JTI را به سشن لینک کن تا بعداً بتوانیم revoke/touch کنیم
    if (sessionId) {
      await this.sessions.linkRefreshJti(user.id, sessionId, jti);
    }

    return { accessToken, refreshToken };
  }

  private async verifyRefreshToken(
    token: string,
    ignoreExpiration = false,
    skipBlacklist = false,
  ): Promise<RefreshTokenPayload> {
    if (!token) {
      throw new UnauthorizedException('Refresh token must be provided.');
    }

    try {
      return await this.tokens.verifyRefresh(token, {
        ignoreExpiration,
        skipBlacklist,
      });
    } catch (error) {
      throw new UnauthorizedException('Refresh token verification failed.');
    }
  }

  private refreshKey(jti: string | undefined): string {
    if (!jti) return refreshAllowKey('unknown');
    return refreshAllowKey(jti);
  }
}

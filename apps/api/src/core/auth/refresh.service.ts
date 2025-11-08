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
import { AllConfig } from '@app/config/config.module';
import { AuthConfig } from '@app/config/auth.config';
import { SessionService } from './session/session.service';
import { RefreshAllowRecord, refreshAllowKey } from './auth.constants';
import { TokenService, RefreshTokenPayload } from './token/token.service';
import { RoleName } from '@prisma/client';
import { requestTraceStorage } from '@app/common/tracing/request-trace';

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
    if (!auth) throw new Error('Auth configuration is not available.');
    this.refreshTtlSeconds = parseDurationToSeconds(
      auth.refreshExpires,
      30 * 24 * 3600,
    );
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  async issueTokensForUserId(
    userId: string,
    opts: IssueOpts = {},
  ): Promise<TokenPair> {
    const hydrated = await this.usersService.ensureActiveWithRoles(userId);
    return this.buildPair(hydrated, opts.sessionId);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const payload = await this.verifyRefreshToken(refreshToken);
    if (!payload?.sub || !payload?.jti) {
      this.logger.warn(
        this.withTrace(
          `Invalid refresh payload: sub=${payload?.sub} jti=${payload?.jti}`,
        ),
      );
      throw new UnauthorizedException('Malformed refresh token.');
    }

    const key = this.refreshKey(payload.jti);
    const ttl = await this.safeTtl(key);

    this.logger.debug(
      this.withTrace(
        `refresh attempt sub=${payload.sub} sid=${payload.sid ?? '-'} jti=${payload.jti} key=${key} ttl=${ttl}`,
      ),
    );

    // --- ATOMIC read+consume allow-list
    const stored = await this.atomicGetDel(key);
    if (!stored) {
      this.logger.debug(
        this.withTrace(`Allow-list MISS jti=${payload.jti} key=${key}`),
      );
      throw new UnauthorizedException(
        'Refresh token is no longer valid. Please sign in again.',
      );
    }
    this.logger.debug(this.withTrace(`Allow-list HIT jti=${payload.jti}`));

    const record = this.parseAllowRecord(stored, payload.sub, payload.sid);
    if (!record) {
      this.logger.warn(
        this.withTrace(
          `Refresh state mismatch user=${payload.sub} jti=${payload.jti}`,
        ),
      );
      throw new UnauthorizedException('Refresh state mismatch.');
    }
    if (record.sessionId && record.sessionId !== payload.sid) {
      this.logger.warn(
        this.withTrace(
          `Session mismatch rec=${record.sessionId} payload=${payload.sid}`,
        ),
      );
      throw new UnauthorizedException('Refresh token session mismatch.');
    }

    // blacklist old jti (best-effort)
    await this.safeBlacklist(payload.jti);

    // unlink old jti from session (best-effort)
    if (record.sessionId) {
      await this.sessions
        .unlinkRefreshJti(payload.sub, record.sessionId, payload.jti)
        .catch(() => undefined);
    }

    const user = await this.usersService.ensureActiveWithRoles(payload.sub);
    // prefer a real sid if present
    return this.buildPair(user, record.sessionId ?? payload.sid);
  }

  async revoke(refreshToken: string): Promise<void> {
    const payload = await this.verifyRefreshToken(refreshToken, true, true);
    if (!payload?.sub || !payload?.jti) return;

    await this.redis.del(this.refreshKey(payload.jti)).catch(() => undefined);
    await this.safeBlacklist(payload.jti);

    if (payload.sid) {
      await this.sessions
        .unlinkRefreshJti(payload.sub, payload.sid, payload.jti)
        .catch(() => undefined);
    }
  }

  async peekPayload(
    token: string,
    ignoreExpiration = false,
  ): Promise<RefreshTokenPayload | null> {
    return this.tokens.peekRefresh(token, {
      ignoreExpiration,
      allowBlacklisted: true,
    });
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private async buildPair(
    user: UserWithRelations,
    sessionId?: string,
  ): Promise<TokenPair> {
    const jti = randomUUID();

    const rawRoles = (user.userRoles ?? [])
      .map((rel) => rel.role?.name)
      .filter((name): name is RoleName => Boolean(name));
    const roleNames = Array.from(new Set(rawRoles)) as RoleName[];

    const accessToken = this.tokens.signAccess({
      userId: user.id,
      roles: roleNames,
    });

    const refreshToken = this.tokens.signRefresh({
      userId: user.id,
      sessionId: sessionId ?? jti,
      jti,
    });

    const ttl = Math.max(this.refreshTtlSeconds, 60);

    const record: RefreshAllowRecord = {
      userId: user.id,
      // اگر می‌خواهی کاملاً سفت باشد می‌توانی این را به (sessionId ?? jti) تغییر دهی
      sessionId: sessionId ?? null,
    };

    await this.redis
      .set(this.refreshKey(jti), JSON.stringify(record), 'EX', ttl)
      .catch((err) =>
        this.logger.warn(
          this.withTrace(
            `Failed to set allow-list for jti=${jti}: ${err?.message ?? err}`,
          ),
        ),
      );

    if (sessionId) {
      await this.sessions
        .linkRefreshJti(user.id, sessionId, jti)
        .catch(() => undefined);
    }

    this.logger.debug(
      this.withTrace(
        `Issued new refresh pair user=${user.id} session=${sessionId ?? jti} newJti=${jti}`,
      ),
    );

    return { accessToken, refreshToken };
  }

  private async verifyRefreshToken(
    token: string,
    ignoreExpiration = false,
    skipBlacklist = false,
  ): Promise<RefreshTokenPayload> {
    if (!token)
      throw new UnauthorizedException('Refresh token must be provided.');
    try {
      return await this.tokens.verifyRefresh(token, {
        ignoreExpiration,
        skipBlacklist,
      });
    } catch {
      throw new UnauthorizedException('Refresh token verification failed.');
    }
  }

  private refreshKey(jti: string | undefined): string {
    return refreshAllowKey(jti ?? 'unknown');
  }

  private withTrace(message: string): string {
    const traceId = requestTraceStorage.getStore()?.traceId;
    return traceId ? `[traceId=${traceId}] ${message}` : message;
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /** Atomic read+delete: uses GETDEL when available; falls back to MULTI(get+del) */
  private async atomicGetDel(key: string): Promise<string | null> {
    const anyRedis = this.redis as unknown as {
      getdel?: (k: string) => Promise<string | null>;
    };
    if (typeof anyRedis.getdel === 'function') {
      return await anyRedis.getdel(key);
    }
    // fallback for older Redis/ioredis
    const pipeline = this.redis.multi();
    pipeline.get(key);
    pipeline.del(key);
    const res = await pipeline.exec();
    // res: [[err|null, getValue], [err|null, delCount]]
    const getRes = res?.[0]?.[1] as string | null;
    return getRes ?? null;
  }

  private parseAllowRecord(
    stored: string,
    expectedUserId: string,
    payloadSid?: string | null,
  ): RefreshAllowRecord | null {
    try {
      const rec = JSON.parse(stored) as RefreshAllowRecord;
      if (!rec?.userId) return null;
      if (rec.userId !== expectedUserId) return null;
      // اگر لازم داری سخت‌تر باشی می‌توانی در اینجا sid را هم الزاماً مقایسه کنی
      return rec;
    } catch {
      // backward compatibility: legacy '1' value
      if (stored === '1') {
        return {
          userId: expectedUserId,
          sessionId: payloadSid ?? null,
        };
      }
      return null;
    }
  }

  private async safeBlacklist(jti?: string | null): Promise<void> {
    if (!jti) return;
    await this.tokens
      .blacklistRefreshJti(jti, this.refreshTtlSeconds)
      .catch((err) =>
        this.logger.warn(
          this.withTrace(
            `Failed to blacklist JTI=${jti}: ${err?.message ?? err}`,
          ),
        ),
      );
  }

  private async safeTtl(key: string): Promise<number> {
    try {
      return await this.redis.ttl(key);
    } catch {
      return -2; // unknown / error
    }
  }
}

import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JwtPayload, Secret, SignOptions } from 'jsonwebtoken';
import { decode, sign, verify } from 'jsonwebtoken';
import type Redis from 'ioredis';
import { RoleName } from '@app/prisma/prisma.constants';
import type { AllConfig } from '@app/config/config.module';
import { parseDurationToSeconds } from '@app/shared/utils/parse-duration.util';

/* ===================== Types ===================== */

export type AccessTokenPayload = JwtPayload & {
  sub: string;
  roles: RoleName[];
  typ: 'access';
};

export type RefreshTokenPayload = JwtPayload & {
  sub: string;
  sid: string;
  jti: string;
  typ: 'refresh';
};

interface VerifyRefreshOptions {
  ignoreExpiration?: boolean;
  skipBlacklist?: boolean;
}

interface PeekRefreshOptions {
  ignoreExpiration?: boolean;
  allowBlacklisted?: boolean;
}

type SignAccessInput = {
  userId: string;
  roles: RoleName[];
};

type SignRefreshInput = {
  userId: string;
  sessionId: string;
  jti: string;
};

type AuthConfigLike =
  | {
      accessSecret: string;
      accessExpires: string;
      refreshSecret: string;
      refreshExpires: string;
      cookie?: {
        sameSite: 'strict' | 'lax' | 'none';
        secure: boolean;
        refreshPath: string;
        accessPath: string;
      };
    }
  | {
      jwt: {
        issuer?: string;
        audience?: string;
        accessSecret: string;
        refreshSecret: string;
      };
      accessExpires: string;
      refreshExpires: string;
      cookie?: {
        sameSite: 'strict' | 'lax' | 'none';
        secure: boolean;
        refreshPath: string;
        accessPath: string;
      };
    };

/* ===================== Service ===================== */

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  private static readonly RBL_PREFIX = 'auth:rbl:'; // refresh blacklist
  private static readonly ONCE_PREFIX = 'auth:once:'; // one-time token

  private readonly accessSecret: Secret;
  private readonly refreshSecret: Secret;

  private readonly issuer: string | undefined;
  private readonly audience: string | undefined;

  private readonly accessTtlSec: number;
  private readonly refreshTtlSec: number;

  constructor(
    private readonly config: ConfigService<AllConfig>,
    @Inject('REDIS') private readonly redis: Redis,
  ) {
    const auth = this.config.get<AuthConfigLike>('auth', { infer: true });
    if (!auth) throw new Error('Auth config missing');

    this.issuer = 'jwt' in auth ? auth.jwt?.issuer : undefined;
    this.audience = 'jwt' in auth ? auth.jwt?.audience : undefined;

    this.accessSecret = (
      'jwt' in auth ? auth.jwt.accessSecret : auth.accessSecret
    ) as Secret;
    this.refreshSecret = (
      'jwt' in auth ? auth.jwt.refreshSecret : auth.refreshSecret
    ) as Secret;

    if (!this.accessSecret || !this.refreshSecret) {
      throw new Error('Missing JWT secrets (accessSecret/refreshSecret)');
    }

    const accessExpires = (auth as any).accessExpires ?? '10m';
    const refreshExpires = (auth as any).refreshExpires ?? '30d';

    this.accessTtlSec = parseDurationToSeconds(accessExpires, 600);
    this.refreshTtlSec = parseDurationToSeconds(refreshExpires, 30 * 24 * 3600);

    // لاگ مختصر کانفیگ (حساسیت‌ها را لو نمی‌دهیم)
    this.logger.debug(
      `init: issuer=${this.issuer ?? '-'} audience=${this.audience ?? '-'} accessTTL=${this.accessTtlSec}s refreshTTL=${this.refreshTtlSec}s aSecLen=${
        String(this.accessSecret).length
      } rSecLen=${String(this.refreshSecret).length}`,
    );
  }

  /* -------------------- Sign -------------------- */

  signAccess({ userId, roles }: SignAccessInput): string {
    const payload: Partial<AccessTokenPayload> = {
      sub: userId,
      roles,
      typ: 'access',
    };
    const opts: SignOptions = {
      algorithm: 'HS256',
      expiresIn: this.accessTtlSec,
      ...(this.issuer ? { issuer: this.issuer } : {}),
      ...(this.audience ? { audience: this.audience } : {}),
    };
    const tok = sign(payload, this.accessSecret, opts);
    this.logger.debug(
      `signAccess: sub=${userId} roles=${roles.join(',')} iss=${this.issuer ?? '-'} aud=${this.audience ?? '-'} alg=HS256`,
    );
    return tok;
  }

  signRefresh({ userId, sessionId, jti }: SignRefreshInput): string {
    const payload: Partial<RefreshTokenPayload> = {
      sub: userId,
      sid: sessionId,
      typ: 'refresh',
    };
    const opts: SignOptions = {
      algorithm: 'HS256',
      expiresIn: this.refreshTtlSec,
      ...(this.issuer ? { issuer: this.issuer } : {}),
      ...(this.audience ? { audience: this.audience } : {}),
      jwtid: jti,
    };
    const tok = sign(payload, this.refreshSecret, opts);
    this.logger.debug(
      `signRefresh: sub=${userId} sid=${sessionId} jti=${jti} iss=${this.issuer ?? '-'} aud=${this.audience ?? '-'} alg=HS256`,
    );
    return tok;
  }

  /* -------------------- Verify -------------------- */

  verifyAccess(token: string): AccessTokenPayload {
    const decoded = this.safeVerify<AccessTokenPayload>(
      token,
      this.accessSecret,
      false,
      'access',
    );
    if (decoded.typ !== 'access') {
      throw new UnauthorizedException('Invalid token type.');
    }
    if (
      !decoded.sub ||
      !Array.isArray(decoded.roles) ||
      decoded.roles.some((r) => typeof r !== 'string')
    ) {
      throw new UnauthorizedException('Malformed access token.');
    }
    return decoded;
  }

  async verifyRefresh(
    token: string,
    options: VerifyRefreshOptions = {},
  ): Promise<RefreshTokenPayload> {
    const decoded = this.safeVerify<RefreshTokenPayload>(
      token,
      this.refreshSecret,
      options.ignoreExpiration ?? false,
      'refresh',
    );
    if (decoded.typ !== 'refresh' || !decoded.jti || !decoded.sid) {
      throw new UnauthorizedException('Malformed refresh token.');
    }

    if (!(options.skipBlacklist ?? false)) {
      if (await this.isRefreshBlacklisted(decoded.jti)) {
        throw new UnauthorizedException('Refresh token is revoked.');
      }
    }

    return decoded;
  }

  async peekRefresh(
    token: string,
    options: PeekRefreshOptions = {},
  ): Promise<RefreshTokenPayload | null> {
    try {
      const decoded = this.safeVerify<RefreshTokenPayload>(
        token,
        this.refreshSecret,
        options.ignoreExpiration ?? false,
        'refresh',
      );
      if (decoded.typ !== 'refresh' || !decoded.jti || !decoded.sid)
        return null;

      if (!(options.allowBlacklisted ?? true)) {
        if (await this.isRefreshBlacklisted(decoded.jti)) return null;
      }
      return decoded;
    } catch {
      // fallback: decode خام برای دیباگ
      try {
        const raw = this.decodeUnsafe(token);
        if (raw && typeof raw === 'object') return raw as any;
      } catch {}
      return null;
    }
  }

  /* -------- Blacklist / One-time helpers -------- */

  async blacklistRefreshJti(jti: string, ttlSec?: number): Promise<void> {
    const key = TokenService.keyRefreshBlacklist(jti);
    const ttl = Number.isFinite(ttlSec) && ttlSec ? ttlSec : this.refreshTtlSec;
    await this.redis.set(key, '1', 'EX', ttl);
  }

  async isRefreshBlacklisted(jti: string): Promise<boolean> {
    const key = TokenService.keyRefreshBlacklist(jti);
    const val = await this.redis.get(key);
    return val === '1';
  }

  async allowOneTime(jti: string, ttlSec: number): Promise<void> {
    await this.redis.set(TokenService.keyOneTime(jti), '1', 'EX', ttlSec);
  }

  async consumeOneTime(jti: string): Promise<boolean> {
    const key = TokenService.keyOneTime(jti);
    const exists = await this.redis.get(key);
    if (!exists) return false;
    await this.redis.del(key);
    return true;
  }

  /* -------------------- Utilities -------------------- */

  decodeUnsafe(token: string): JwtPayload | string | null {
    return decode(token);
  }

  extractBearer(authHeader?: string): string | null {
    if (!authHeader) return null;
    const [type, ...rest] = authHeader.trim().split(/\s+/);
    const token = rest.join(' ');
    return type?.toLowerCase() === 'bearer' && token ? token : null;
  }

  /* -------------------- Private helpers -------------------- */

  private safeVerify<T extends JwtPayload>(
    token: string,
    secret: Secret,
    ignoreExpiration = false,
    expectedTyp?: 'access' | 'refresh',
  ): T {
    try {
      const opts: import('jsonwebtoken').VerifyOptions & {
        ignoreExpiration: boolean;
        clockTolerance: number;
      } = {
        algorithms: ['HS256'],
        clockTolerance: 5,
        ignoreExpiration,
      };
      if (this.issuer) opts.issuer = this.issuer;
      if (this.audience) opts.audience = this.audience;

      const decoded = verify(token, secret, opts) as T;

      // typ چک اولیه (اگر خواستیم)
      if (
        expectedTyp &&
        (decoded as any)?.typ &&
        (decoded as any).typ !== expectedTyp
      ) {
        this.logger.warn(
          `verify typ mismatch: expected=${expectedTyp} got=${(decoded as any).typ}`,
        );
        throw new UnauthorizedException('Wrong token type');
      }
      return decoded;
    } catch (err: any) {
      // تشخیص mismatch: header/payload را decode کنیم
      try {
        const [h, p] = token.split('.');
        const header = JSON.parse(Buffer.from(h, 'base64').toString('utf8'));
        const payload = JSON.parse(Buffer.from(p, 'base64').toString('utf8'));
        this.logger.warn(
          `verify failed: ${err?.message ?? err}\n` +
            `expected => alg=HS256 iss=${this.issuer ?? '-'} aud=${this.audience ?? '-'} ignoreExp=${ignoreExpiration}\n` +
            `got      => alg=${header?.alg ?? '-'} typ=${payload?.typ ?? '-'} iss=${payload?.iss ?? '-'} aud=${payload?.aud ?? '-'}\n` +
            `claims   => sub=${payload?.sub ?? '-'} sid=${payload?.sid ?? '-'} jti=${payload?.jti ?? '-'} exp=${payload?.exp ?? '-'}`,
        );
      } catch {
        this.logger.warn(
          `verify failed (also decode failed): ${err?.message ?? err}`,
        );
      }
      throw new UnauthorizedException('Invalid token.');
    }
  }

  private static keyRefreshBlacklist(jti: string): string {
    return `${TokenService.RBL_PREFIX}${jti}`;
  }

  private static keyOneTime(jti: string): string {
    return `${TokenService.ONCE_PREFIX}${jti}`;
  }
}

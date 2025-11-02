import {
  Inject,
  Injectable,
  UnauthorizedException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PasswordService } from './password/password.service';
import { RefreshService } from './refresh.service';
import { SessionService } from './session/session.service';
import { TokenService } from './token/token.service';
import { UsersService } from '@app/core/users/users.service';

type LoginInput = {
  identifier: string;
  password: string;
  req: Request;
  res: Response;
};

type LoginOutput = {
  accessToken: string;
  user?: { id: string; username?: string | null; email?: string | null };
};

@Injectable()
export class AuthService {
  constructor(
    private readonly password: PasswordService,
    private readonly refresh: RefreshService,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
    private readonly users: UsersService,
  ) {}

  /**
   * ورود همه‌کاره برای فرانت:
   *  - اعتبارسنجی پسورد (با مهاجرت legacy در PasswordService)
   *  - ساخت سشن (IP/UserAgent)
   *  - صدور جفت‌توکن لینک‌شده به سشن (JTI↔Session)
   *  - پاس‌دادن refreshToken برای ست‌کوکی در کنترلر
   *  - برگرداندن accessToken + خلاصه کاربر
   */
  async login({
    identifier,
    password,
    req,
    res,
  }: LoginInput): Promise<LoginOutput> {
    // ورودی‌های خالی
    if (!identifier || !password) {
      throw new BadRequestException({
        code: 'InvalidInput',
        message: 'Identifier and password are required.',
      });
    }

    try {
      // 1) اعتبارسنجی: فقط userId
      const { userId } = await this.password.login(
        identifier,
        password,
        this.getIp(req),
      );

      // 2) ساخت سشن
      const session = await this.sessions.create({
        userId,
        ip: this.getIp(req),
        userAgent: (req.headers['user-agent'] as string) || undefined,
      });

      // 3) صدور جفت‌توکن لینک‌شده به سشن
      const pair = await this.refresh.issueTokensForUserId(userId, {
        sessionId: session.id,
      });

      // 4) پاس‌دادن رفرش‌توکن به کنترلر برای ست‌کوکی HttpOnly
      (res as any).__refreshToken = pair.refreshToken;

      // 5) خلاصه کاربر
      const me = await this.users.findById(userId).catch(() => null);

      return {
        accessToken: pair.accessToken,
        user: me
          ? { id: me.id, username: me.username, email: me.email }
          : { id: userId },
      };
    } catch (err: any) {
      // خطاهای شناخته‌شده از PasswordService (InvalidCredentials / TooManyAttempts / WeakPassword ...)
      if (err?.status && err?.response?.code) {
        // همون خطای ساختاریافته را پاس بدهیم
        throw err;
      }

      // خطای ناشناخته
      throw new InternalServerErrorException({
        code: 'AuthLoginFailed',
        message: 'Login failed due to an internal error.',
        details: err?.message ?? String(err),
      });
    }
  }

  /**
   * خروج:
   *  - payload رفرش را peek می‌کنیم تا JTI را بگیریم
   *  - رفرش را revoke می‌کنیم
   *  - اگر سشن مرتبط پیدا شد، همان را revoke می‌کنیم
   */
  async logout(refreshToken: string) {
    if (!refreshToken) {
      throw new BadRequestException({
        code: 'MissingRefresh',
        message: 'Refresh token is required.',
      });
    }

    try {
      const payload = await this.refresh.peekPayload(refreshToken, true); // verify with ignoreExpiration=true
      await this.refresh.revoke(refreshToken);

      if (payload?.sub && payload?.sid) {
        await this.sessions
          .revoke(payload.sub, payload.sid)
          .catch(() => undefined);
      } else if (payload?.jti) {
        const loc = await this.sessions
          .findSessionByJti(payload.jti)
          .catch(() => null);
        if (loc) {
          await this.sessions
            .revoke(loc.userId, loc.sessionId)
            .catch(() => undefined);
        }
      }

      return { success: true };
    } catch (err: any) {
      // اگر رفرش نامعتبر بود
      if (err?.status === 401) {
        throw new UnauthorizedException({
          code: 'InvalidRefresh',
          message: 'Invalid or expired refresh token.',
        });
      }
      throw new InternalServerErrorException({
        code: 'LogoutFailed',
        message: 'Logout failed due to an internal error.',
        details: err?.message ?? String(err),
      });
    }
  }

  /**
   * رفرش:
   *  - payload رفرش را peek می‌کنیم (برای پیدا کردن سشن)
   *  - چرخش جفت‌توکن
   *  - touch سشن
   *  - برگرداندن جفت جدید (کنترلر کوکی را ست می‌کند)
   */
  async rotate(refreshToken: string) {
    if (!refreshToken) {
      throw new BadRequestException({
        code: 'MissingRefresh',
        message: 'Refresh token is required.',
      });
    }

    try {
      const payload = await this.refresh.peekPayload(refreshToken); // may throw 401
      const pair = await this.refresh.refresh(refreshToken); // rotates + returns { accessToken, refreshToken }

      if (payload?.sub && payload?.sid) {
        await this.sessions
          .touch(payload.sub, payload.sid)
          .catch(() => undefined);
      } else if (payload?.jti) {
        const loc = await this.sessions
          .findSessionByJti(payload.jti)
          .catch(() => null);
        if (loc) {
          await this.sessions
            .touch(loc.userId, loc.sessionId)
            .catch(() => undefined);
        }
      }

      return pair; // کنترلر: __refreshToken = pair.refreshToken و accessToken در پاسخ
    } catch (err: any) {
      if (err?.status === 401) {
        throw new UnauthorizedException({
          code: 'InvalidRefresh',
          message: 'Invalid or expired refresh token.',
        });
      }
      throw new InternalServerErrorException({
        code: 'RotateFailed',
        message: 'Token rotation failed due to an internal error.',
        details: err?.message ?? String(err),
      });
    }
  }

  // ----------------- helpers -----------------
  private getIp(req: Request): string | undefined {
    const xfwd = (req.headers['x-forwarded-for'] as string) || '';
    const ip =
      (Array.isArray(req.ips) && req.ips.length > 0
        ? req.ips[0]
        : xfwd.split(',')[0]?.trim()) ||
      (req.ip as string) ||
      (req.socket?.remoteAddress as string | undefined);
    return ip || undefined;
  }
}

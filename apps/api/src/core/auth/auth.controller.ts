/**
 * AuthController (simplified single-cookie version)
 */

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '@app/common/decorators/public.decorator';

import { PasswordService } from './password/password.service';
import { RefreshService } from './refresh.service';
import { SessionService } from './session/session.service';
import { RefreshRateLimitService } from './refresh-rate-limit.service';

import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

import { ConfigService } from '@nestjs/config';
import type { AllConfig } from '@app/config/config.module';
import type { AuthConfig } from '@app/config/auth.config';
import { parseDurationToSeconds } from '@app/shared/utils/parse-duration.util';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  private readonly refreshCookieMaxAgeMs: number;
  private readonly cookieSameSite: 'lax' | 'strict' | 'none';
  private readonly cookieSecure: boolean;
  private readonly refreshCookiePath: string;
  private readonly allowedOrigins: Set<string>;

  private static readonly REFRESH_COOKIE_NAME = 'refresh_token' as const;

  constructor(
    private readonly password: PasswordService,
    private readonly refreshService: RefreshService,
    private readonly sessions: SessionService,
    private readonly config: ConfigService<AllConfig>,
    private readonly refreshRateLimit: RefreshRateLimitService,
  ) {
    const auth = this.config.get<AuthConfig>('auth', { infer: true });
    if (!auth) throw new Error('Auth configuration not found.');

    const refreshTtlSeconds = parseDurationToSeconds(
      auth.refreshExpires,
      30 * 24 * 3600,
    );
    this.refreshCookieMaxAgeMs = refreshTtlSeconds * 1000;
    this.cookieSameSite = auth.cookie.sameSite ?? 'none';
    this.cookieSecure = auth.cookie.secure;
    this.refreshCookiePath = auth.cookie.refreshPath ?? '/';
    this.allowedOrigins = this.resolveAllowedOrigins();
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private setNoStore(res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    const prev = res.getHeader('Vary');
    res.setHeader('Vary', prev ? String(prev) + ', Cookie' : 'Cookie');
  }

  private setRefreshCookie(res: Response, token: string | null | undefined) {
    if (!token) return;
    res.cookie(AuthController.REFRESH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: this.cookieSameSite,
      path: this.refreshCookiePath,
      maxAge: this.refreshCookieMaxAgeMs,
    });
  }

  private clearRefreshCookie(res: Response) {
    res.clearCookie(AuthController.REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: this.cookieSameSite,
      path: this.refreshCookiePath,
    });
  }

  private getRefreshToken(
    req: Request,
    fallback?: string | null,
  ): string | null {
    const cookieToken = (
      req.cookies?.[AuthController.REFRESH_COOKIE_NAME] ?? ''
    ).trim();
    if (cookieToken) return cookieToken;
    const fb = (fallback ?? '').trim();
    return fb || null;
  }

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

  private resolveAllowedOrigins(): Set<string> {
    const raw =
      this.config.get<string>('FRONTEND_URL') ??
      process.env.FRONTEND_URL ??
      this.config.get<string>('CORS_ORIGIN') ??
      'http://localhost:3000';
    const origins = raw
      .split(',')
      .map((origin) => this.normalizeOrigin(origin))
      .filter(Boolean);
    return new Set(origins);
  }

  private normalizeOrigin(value?: string | string[]): string {
    if (!value) return '';
    const raw = Array.isArray(value) ? value[0] : value;
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      return parsed.origin.replace(/\/+$/, '').toLowerCase();
    } catch {
      return raw.replace(/\/+$/, '').toLowerCase();
    }
  }

  private assertAllowedOrigin(req: Request): void {
    if (!this.allowedOrigins.size) return;
    const originHeader = this.normalizeOrigin(
      (req.headers.origin ?? req.headers.Origin) as string | undefined,
    );
    const refererHeader = this.normalizeOrigin(
      (req.headers.referer ?? req.headers.Referer) as string | undefined,
    );
    const allowed =
      (originHeader && this.allowedOrigins.has(originHeader)) ||
      (refererHeader && this.allowedOrigins.has(refererHeader));
    if (allowed) {
      return;
    }
    throw new ForbiddenException({
      code: 'OriginNotAllowed',
      message: 'Origin is not allowed for refresh.',
    });
  }

  private assertJsonRequest(req: Request): void {
    const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
    if (!contentType.includes('application/json')) {
      throw new BadRequestException({
        code: 'InvalidContentType',
        message: 'Content-Type must be application/json.',
      });
    }
  }

  private getRateLimitKey(req: Request): string {
    const ip = this.getIp(req) ?? 'unknown';
    const ua = (req.headers['user-agent'] as string) ?? 'unknown';
    return `${ip}|${ua}`;
  }

  // ------------------------------------------------------------------
  // Login
  // ------------------------------------------------------------------

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login using email/phone/username + password' })
  @ApiResponse({
    status: 200,
    description:
      'Authenticated. Returns accessToken; sets refresh_token cookie for session rotation.',
    schema: { example: { accessToken: 'eyJhbGciOi...' } },
  })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.setNoStore(res);
    if (!dto?.identifier || !dto?.password) {
      throw new BadRequestException({
        code: 'InvalidInput',
        message: 'Identifier and password are required.',
      });
    }

    try {
      const ip = this.getIp(req);
      const { userId } = await this.password.login(
        dto.identifier,
        dto.password,
        ip,
      );
      const session = await this.sessions.create({
        userId,
        ip,
        userAgent: (req.headers['user-agent'] as string) ?? undefined,
      });
      const pair = await this.refreshService.issueTokensForUserId(userId, {
        sessionId: session.id,
      });

      this.setRefreshCookie(res, pair.refreshToken);
      return { accessToken: pair.accessToken };
    } catch (err) {
      throw new UnauthorizedException({
        code: 'InvalidCredentials',
        message: 'Invalid credentials.',
      });
    }
  }

  // ------------------------------------------------------------------
  // Refresh
  // ------------------------------------------------------------------

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh & mint new access token' })
  @ApiCookieAuth('refresh_token')
  @ApiResponse({
    status: 200,
    schema: { example: { success: true, data: { accessToken: '...' } } },
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // همیشه پاسخ non-cache
    this.setNoStore(res);

    // اجازه بده درخواستِ بی‌بدنه رد نشه؛ اگر بدنه دارد باید JSON باشد
    this.assertJsonOrEmpty(req);

    // ضد-CSRF (Origin/Referer) — اگر FRONTEND_URL ست نیست، سخت‌گیری نکن
    this.assertAllowedOrigin(req);

    // ریت‌لیمیت با لاگ واضح
    try {
      await this.refreshRateLimit.consume(this.getRateLimitKey(req));
    } catch (e) {
      this.logger.warn(
        `[refresh] rate-limited key=${this.getRateLimitKey(req)}`,
      );
      throw e; // معمولاً 429
    }

    const hasCookie = Boolean(req.headers?.cookie);
    this.logger.debug(`[refresh] cookie present? ${hasCookie}`);

    const refreshToken = this.getRefreshToken(req, null);
    if (!refreshToken) {
      throw new UnauthorizedException({
        code: 'MissingRefresh',
        message: 'No refresh cookie',
      });
    }

    try {
      const pair = await this.refreshService.refresh(refreshToken);

      // چرخش کوکی رفرش با تنظیمات کانفیگ
      this.setRefreshCookie(res, pair.refreshToken);

      // قرارداد پاسخ ثابت
      return {
        success: true as const,
        data: { accessToken: pair.accessToken },
      };
    } catch (err) {
      // لاگ کوتاه و پیام استاندارد برای کلاینت
      this.logger.warn(
        `[refresh] deny: ${err instanceof Error ? err.message : err}`,
      );
      throw new UnauthorizedException({
        code: 'InvalidRefresh',
        message: 'Invalid or expired refresh token.',
      });
    }
  }

  /* ================== Helpers (در همین کنترلر) ================== */

  /** اگر بدنه ندارد، سخت‌گیری نکن؛ اگر بدنه دارد، باید JSON باشد. */
  private assertJsonOrEmpty(req: Request) {
    const ct = String(req.headers['content-type'] || '').toLowerCase();
    const len = Number(req.headers['content-length'] || 0);
    if (!len) return; // بدون بدنه → عبور
    if (!ct.includes('application/json')) {
      throw new BadRequestException('Content-Type must be application/json.');
    }
  }

  // ------------------------------------------------------------------
  // Logout
  // ------------------------------------------------------------------

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke refresh token and clear cookie' })
  @ApiCookieAuth('refresh_token')
  @ApiResponse({
    status: 200,
    description: 'Logged out (idempotent).',
    schema: { example: { success: true } },
  })
  async logout(
    @Req() req: Request,
    @Body() dto: RefreshTokenDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.setNoStore(res);
    const refreshToken =
      (dto?.refreshToken ?? '').trim() || this.getRefreshToken(req, null);

    // همیشه کوکی رو پاک کن
    this.clearRefreshCookie(res);

    if (!refreshToken) return { success: true };

    try {
      await this.refreshService.revoke(refreshToken);
      return { success: true };
    } catch {
      // logout همیشه idempotent
      return { success: true };
    }
  }
}

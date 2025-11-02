/**
 * AuthController (simplified single-cookie version)
 */

import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
  UnauthorizedException,
  InternalServerErrorException,
  Inject,
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

import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

import { ConfigService } from '@nestjs/config';
import type { AllConfig } from '@app/config/config.module';
import type { AuthConfig } from '@app/config/auth.config';
import { parseDurationToSeconds } from '@app/shared/utils/parse-duration.util';

import type Redis from 'ioredis';
import { refreshAllowKey } from './auth.constants';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  private readonly refreshCookieMaxAgeMs: number;
  private readonly cookieSameSite: 'lax' | 'strict' | 'none';
  private readonly cookieSecure: boolean;

  private static readonly REFRESH_COOKIE_NAME = 'refresh_token' as const;

  constructor(
    private readonly password: PasswordService,
    private readonly refreshService: RefreshService,
    private readonly sessions: SessionService,
    private readonly config: ConfigService<AllConfig>,
    @Inject('REDIS') private readonly redis: Redis,
  ) {
    const auth = this.config.get<AuthConfig>('auth', { infer: true });
    if (!auth) throw new Error('Auth configuration not found.');

    const refreshTtlSeconds = parseDurationToSeconds(
      auth.refreshExpires,
      30 * 24 * 3600,
    );
    this.refreshCookieMaxAgeMs = refreshTtlSeconds * 1000;
    this.cookieSameSite = auth.cookie.sameSite;
    this.cookieSecure = auth.cookie.secure;
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
      path: '/', // ✅ فقط یک مسیر
      maxAge: this.refreshCookieMaxAgeMs,
    });
  }

  private clearRefreshCookie(res: Response) {
    res.clearCookie(AuthController.REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: this.cookieSameSite,
      path: '/', // ✅ فقط همین مسیر
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
  @ApiResponse({ status: 200, schema: { example: { accessToken: '...' } } })
  async refresh(
    @Req() req: Request,
    @Body() dto: RefreshTokenDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.setNoStore(res);

    const refreshToken =
      (dto?.refreshToken ?? '').trim() || this.getRefreshToken(req, null);

    if (!refreshToken) {
      throw new BadRequestException({
        code: 'MissingRefresh',
        message: 'Refresh token not provided.',
      });
    }

    try {
      const pair = await this.refreshService.refresh(refreshToken);
      this.setRefreshCookie(res, pair.refreshToken);
      return { accessToken: pair.accessToken };
    } catch {
      throw new UnauthorizedException({
        code: 'InvalidRefresh',
        message: 'Invalid or expired refresh token.',
      });
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

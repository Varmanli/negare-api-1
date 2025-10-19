/**
 * AuthController exposes OTP bootstrap, password provisioning, credential login,
 * and token lifecycle endpoints. Each handler validates transport concerns
 * before delegating to dedicated application services to maintain cohesive business logic.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { OtpService } from './otp.service';
import { PasswordService } from './password.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { LoginDto } from './dto/login.dto';
import { OtpChannel } from './entities/otp-code.entity';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RefreshService } from './refresh.service';
import { parseDurationToSeconds } from '../shared/utils/parse-duration.util';

@ApiTags('Authentication')
@Controller('auth')
/**
 * Coordinates the OTP → password → login → refresh → logout lifecycle,
 * relying on OtpService, PasswordService, and RefreshService to encapsulate behavior.
 */
export class AuthController {
  private readonly refreshCookieMaxAgeMs: number;
  private readonly cookiePath: string;
  private readonly cookieSameSite: 'strict' | 'lax' | 'none';
  private readonly cookieSecure: boolean;

  constructor(
    private readonly otp: OtpService,
    private readonly password: PasswordService,
    private readonly refreshService: RefreshService,
    private readonly config: ConfigService,
  ) {
    const refreshExpires =
      this.config.get<string>('REFRESH_JWT_EXPIRES') || '30d';
    const ttlSeconds = parseDurationToSeconds(refreshExpires, 30 * 24 * 3600);
    this.refreshCookieMaxAgeMs = ttlSeconds * 1000;
    this.cookiePath =
      this.config.get<string>('COOKIE_REFRESH_PATH') || '/auth/refresh';
    this.cookieSameSite = this.resolveSameSite(
      this.config.get<string>('COOKIE_SAMESITE'),
    );
    const secureFlag = this.resolveBoolean(
      this.config.get<string>('COOKIE_SECURE'),
    );
    const nodeEnv =
      this.config.get<string>('NODE_ENV') ?? process.env.NODE_ENV ?? 'development';
    this.cookieSecure =
      secureFlag ?? nodeEnv.toLowerCase() === 'production';
  }

  private resolveBoolean(value?: string | boolean | null): boolean | undefined {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true;
      }
      if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false;
      }
    }
    return undefined;
  }

  private resolveSameSite(value?: string | null): 'strict' | 'lax' | 'none' {
    const normalized = (value ?? 'strict').toLowerCase();
    if (normalized === 'none') {
      return 'none';
    }
    if (normalized === 'lax') {
      return 'lax';
    }
    return 'strict';
  }

  private setRefreshCookie(res: Response, refreshToken: string) {
    if (!refreshToken) {
      this.clearRefreshCookie(res);
      return;
    }
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: this.cookieSameSite,
      path: this.cookiePath,
      maxAge: this.refreshCookieMaxAgeMs,
    });
  }

  private clearRefreshCookie(res: Response) {
    res.clearCookie('refresh_token', {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: this.cookieSameSite,
      path: this.cookiePath,
    });
  }

  private getRefreshTokenFromRequest(
    req: Request,
    fallback?: string | null,
  ): string | null {
    const cookies = (req as Request & {
      cookies?: Record<string, string | undefined>;
    }).cookies;
    const cookieToken = cookies?.refresh_token;
    const normalizedCookie =
      typeof cookieToken === 'string' && cookieToken.length > 0
        ? cookieToken
        : null;
    if (normalizedCookie) {
      return normalizedCookie;
    }
    if (fallback && fallback.length > 0) {
      return fallback;
    }
    return null;
  }

  /**
   * Issues an OTP via SMS or email so that a user can prove possession of their identifier.
   * @param dto channel selection and identifier (phone/email) gathered from client input.
   * @returns Success flag with OTP expiry so clients can show countdown timers.
   * @throws BadRequestException when the identifier is missing or mismatched with the channel.
   * @security Public endpoint but subject to OTP service rate limits.
   */
  @Public()
  @Post('otp/request')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Request OTP code',
    description:
      'Dispatches a one-time password to the provided identifier using the selected channel. The identifier must correspond to the channel.',
  })
  @ApiBody({
    description:
      'Provide `phone` when channel is `sms`, and provide `email` when channel is `email`.',
    schema: { $ref: '#/components/schemas/RequestOtpDto' },
    examples: {
      email: {
        summary: 'Email request sample',
        value: { channel: 'email', email: 'user@example.com' },
      },
      sms: {
        summary: 'SMS request sample',
        value: { channel: 'sms', phone: '09123456789' },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'OTP request accepted.',
    schema: { example: { success: true, expiresIn: 120 } },
  })

  request(@Body() dto: RequestOtpDto) {
    const identifier =
      dto.channel === OtpChannel.sms ? dto.phone : dto.email;
    if (!identifier) {
      throw new BadRequestException('Identifier is required for the selected channel.');
    }
    return this.otp.requestOtp(dto.channel, identifier);
  }

  /**
   * Checks the submitted OTP against the most recent valid issuance and returns
   * a short-lived JWT that authorizes the caller to call `password/set`.
   * @param dto payload including channel, identifier, and OTP code.
   * @returns Success flag plus `token` JWT containing `set_password` purpose claim.
   * @throws BadRequestException when OTP is expired, incorrect, or the identifier is missing.
   * @security Public endpoint; downstream rate limits enforce brute-force resistance.
   */
  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify OTP and issue password token',
    description:
      'Validates the latest OTP for the identifier and returns a short-lived token that allows password creation.',
  })
  @ApiBody({
    description: 'Submit the same identifier and channel combination together with the received OTP code.',
    schema: { $ref: '#/components/schemas/VerifyOtpDto' },
    examples: {
      email: {
        summary: 'Email verification sample',
        value: {
          channel: 'email',
          email: 'user@example.com',
          code: '123456',
        },
      },
      sms: {
        summary: 'SMS verification sample',
        value: { channel: 'sms', phone: '09123456789', code: '123456' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'OTP verified and password token issued.',
    schema: { example: { success: true, token: 'jwt-token' } },
  })

  verify(@Body() dto: VerifyOtpDto) {
    const identifier =
      dto.channel === OtpChannel.sms ? dto.phone : dto.email;
    if (!identifier) {
      throw new BadRequestException('Identifier is required for the selected channel.');
    }
    return this.otp.verifyOtp(dto.channel, identifier, dto.code);
  }

  /**
   * Stores a new password for the user identified by the OTP verification token
   * and immediately returns session tokens for the fresh credential.
   * @param authHeader Authorization header expected to include `Bearer <set_password JWT>`.
   * @param dto body with the new password string to hash.
   * @returns Access and refresh token pair for downstream authenticated requests.
   * @throws BadRequestException when the token is missing or not a bearer token.
   * @security Requires possession of the OTP verification JWT; tokens rotate post-success.
   */
  @Public()
  @Post('password/set')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set password with OTP token',
    description:
      'Consumes the short-lived OTP verification token to set or update the password and returns a fresh token pair.',
  })
  @ApiBearerAuth('bearer')
  @ApiBody({
    description: 'Provide the new password value that should be stored for the user.',
    schema: { $ref: '#/components/schemas/SetPasswordDto' },
  })
  @ApiResponse({
    status: 200,
    description: 'Password stored and tokens issued.',
    schema: {
      example: {
        success: true,
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      },
    },
  })

  async setPassword(
    @Headers('authorization') authHeader: string,
    @Body() dto: SetPasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = this.extractBearer(authHeader);
    if (!token) {
      throw new BadRequestException('Bearer token not found');
    }
    const response = await this.password.setPassword(token, dto.password);
    this.setRefreshCookie(res, response.refreshToken);
    return response;
  }

  /**
   * Authenticates an existing account using email/phone plus password and returns tokens.
   * @param dto form data containing `identifier` and `password`.
   * @returns Access and refresh token pair along with a success indicator.
   * @throws UnauthorizedException bubbled from PasswordService when credentials fail.
   * @security Public route guarded implicitly by credential verification and rate limits.
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log in with identifier and password',
    description:
      'Authenticates using email or mobile number together with the account password and returns an access/refresh token pair.',
  })
  @ApiBody({
    schema: { $ref: '#/components/schemas/LoginDto' },
    examples: {
      email: {
        summary: 'Email login sample',
        value: {
          identifier: 'user@example.com',
          password: 'P@ssw0rd!',
        },
      },
      phone: {
        summary: 'SMS login sample',
        value: { identifier: '09123456789', password: 'P@ssw0rd!' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Login successful.',
    schema: {
      example: {
        success: true,
        token: 'access-token',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      },
    },
  })

  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const response = await this.password.login(dto.identifier, dto.password);
    this.setRefreshCookie(res, response.refreshToken);
    return response;
  }

  /**
   * Rotates the caller's access and refresh tokens using a still-valid refresh token.
   * @param dto container for the refresh token to verify and exchange.
   * @returns Fresh token pair with identical response shape as login.
   * @throws UnauthorizedException when the refresh token is expired, revoked, or invalid.
   * @security Public route that relies on possession of a valid refresh token.
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refresh token pair',
    description:
      'Validates the provided refresh token and issues a new access/refresh token pair.',
  })
  @ApiBody({
    description: 'Use this body when the refresh token cookie is unavailable (for example, during native app flows).',
    schema: { $ref: '#/components/schemas/RefreshTokenDto' },
  })
  @ApiCookieAuth('refresh_token')
  @ApiBearerAuth('bearer')
  @ApiResponse({
    status: 200,
    description: 'Tokens refreshed successfully.',
    schema: {
      example: {
        success: true,
        token: 'new-access-token',
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      },
    },
  })

  async refresh(
    @Req() req: Request,
    @Body() dto: RefreshTokenDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = this.getRefreshTokenFromRequest(req, dto.refreshToken ?? null);
    if (!token) {
      throw new BadRequestException('Refresh token was not provided');
    }
    const pair = await this.refreshService.refresh(token);
    this.setRefreshCookie(res, pair.refreshToken);
    return {
      success: true,
      token: pair.accessToken,
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
    };
  }

  /**
   * Revokes a refresh token so that subsequent refresh attempts fail fast.
   * @param dto body containing the refresh token to invalidate.
   * @returns Simple success acknowledgement once the token has been deleted.
   * @security Requires the refresh token to authorize revocation; idempotent by design.
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoke refresh token',
    description:
      'Revokes the supplied refresh token so that future refresh attempts are rejected.',
  })
  @ApiBody({
    description: 'Provide the refresh token explicitly when the HttpOnly cookie cannot be sent.',
    schema: { $ref: '#/components/schemas/RefreshTokenDto' },
  })
  @ApiBearerAuth('bearer')
  @ApiResponse({
    status: 200,
    description: 'Refresh token revoked successfully.',
    schema: { example: { success: true } },
  })

  async logout(
    @Req() req: Request,
    @Body() dto: RefreshTokenDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = this.getRefreshTokenFromRequest(req, dto.refreshToken ?? null);
    this.clearRefreshCookie(res);
    if (!token) {
      throw new BadRequestException('Refresh token was not provided');
    }
    await this.refreshService.revoke(token);
    return { success: true };
  }

  /**
   * Normalizes the `Authorization` header by extracting the bearer token component.
   * @param authHeader raw value sent by the client.
   * @returns JWT string when present, otherwise `null`.
   */
  private extractBearer(authHeader?: string) {
    if (!authHeader) {
      return null;
    }
    const [type, token] = authHeader.split(' ');
    if (!token || type.toLowerCase() !== 'bearer') {
      return null;
    }
    return token;
  }
}


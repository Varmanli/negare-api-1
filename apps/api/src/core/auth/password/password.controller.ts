import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '@app/common/decorators/public.decorator';
import { OtpService } from '../otp/otp.service';
import { OtpChannel, OtpPurpose } from '@app/prisma/prisma.constants';
import { TokenService } from '../token/token.service';
import { PasswordService } from './password.service';
import { RequestOtpDto } from '../dto/otp/otp-request.dto';
import { ResendOtpDto } from '../dto/otp/otp-resend.dto';
import { VerifyOtpDto } from '../dto/otp/otp-verify.dto';
import {
  ChangePasswordDto,
  PasswordStrengthDto,
  ResetPasswordDto,
  SetPasswordDto,
} from '../dto/password/password.dto';

@ApiTags('Authentication - Password')
@Controller('auth/password')
export class PasswordController {
  constructor(
    private readonly otp: OtpService,
    private readonly password: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  // 1) شروع ریست پسورد (purpose=reset)
  @Public()
  @Post('forgot')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start password reset via OTP (purpose=reset)' })
  @ApiResponse({ status: 200 })
  async forgot(
    @Body() dto: RequestOtpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.otp.requestOtp(
      dto.channel as OtpChannel,
      dto.identifier,
      OtpPurpose.reset,
      this.getIp(req),
      (req.headers['user-agent'] as string) || undefined,
    );
    if (out?.data?.alreadyActive && out.data.resendAvailableIn) {
      res.setHeader('Retry-After', String(out.data.resendAvailableIn));
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Cookie');
    return out; // { success, data }
  }

  // 2) بازارسال OTP برای reset
  @Public()
  @Post('forgot/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend reset OTP (purpose=reset)' })
  @ApiResponse({ status: 200 })
  async forgotResend(
    @Body() dto: ResendOtpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.otp.resendOtp(
      dto.channel as OtpChannel,
      dto.identifier,
      OtpPurpose.reset,
      this.getIp(req),
      (req.headers['user-agent'] as string) || undefined,
    );
    if (out?.data?.alreadyActive && out.data.resendAvailableIn) {
      res.setHeader('Retry-After', String(out.data.resendAvailableIn));
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Cookie');
    return out;
  }

  // 3) تأیید OTP و صدور تیکت reset
  @Public()
  @Post('forgot/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify reset OTP and mint a reset ticket' })
  @ApiResponse({ status: 200 })
  async forgotVerify(
    @Body() dto: VerifyOtpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.otp.verifyOtp(
      dto.channel as OtpChannel,
      dto.identifier,
      dto.code,
      OtpPurpose.reset,
      this.getIp(req),
      (req.headers['user-agent'] as string) || undefined,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Cookie');
    return out;
  }

  // 4) ریست پسورد با تیکت (Bearer)
  @Public()
  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using OTP-issued ticket (Bearer)' })
  @ApiBearerAuth()
  @ApiResponse({ status: 200 })
  async reset(
    @Headers('authorization') authHeader: string,
    @Body() dto: ResetPasswordDto,
  ) {
    const token = this.tokens.extractBearer(authHeader);
    if (!token) {
      throw new BadRequestException({
        code: 'MissingBearer',
        message: 'Bearer ticket missing.',
      });
    }
    const out = await this.password.setPassword(token, dto.password);
    return { success: true, data: out };
  }

  // 5) ست اولیه پسورد (signup/login via OTP)
  @Public()
  @Post('set')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set initial password using OTP-issued ticket (Bearer)',
  })
  @ApiBearerAuth()
  @ApiResponse({ status: 200 })
  async set(
    @Headers('authorization') authHeader: string,
    @Body() dto: SetPasswordDto,
  ) {
    const token = this.tokens.extractBearer(authHeader);
    if (!token) {
      throw new BadRequestException({
        code: 'MissingBearer',
        message: 'Bearer ticket missing.',
      });
    }
    const out = await this.password.setPassword(token, dto.password);
    return { success: true, data: out };
  }

  // 6) تغییر پسورد (نیازمند auth)
  @Post('change')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change password (requires auth)' })
  @ApiBearerAuth()
  @ApiCookieAuth('access_token')
  @ApiResponse({ status: 200 })
  async change(@Req() req: Request, @Body() dto: ChangePasswordDto) {
    const userId = (req as any)?.user?.sub as string | undefined;
    if (!userId) {
      throw new BadRequestException({
        code: 'Unauthorized',
        message: 'Unauthorized context.',
      });
    }
    const out = await this.password.changePassword(
      userId,
      dto.currentPassword,
      dto.newPassword,
    );
    return { success: true, data: out };
  }

  // 7) محاسبه strength (لوکال)
  @Public()
  @Post('strength')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Estimate password strength locally' })
  @ApiResponse({ status: 200 })
  async strength(@Body() dto: PasswordStrengthDto) {
    const score = this.estimateStrength(dto.password);
    return { success: true, data: { score } };
  }

  // 8) policy برای UI
  @Public()
  @Get('policy')
  @ApiOperation({ summary: 'Return password policy for UI validation' })
  @ApiResponse({ status: 200 })
  policy() {
    return {
      success: true,
      data: {
        minLength: 8,
        requireNumber: true,
        requireLower: true,
        requireUpper: false,
        requireSymbol: false,
      },
    };
  }

  // 9) وضعیت OTP (اختیاری)
  @Public()
  @Post('forgot/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check remaining cooldown/expiry (optional)' })
  @ApiResponse({ status: 200 })
  async status() {
    return {
      success: true,
      data: { expiresIn: null, resendAvailableIn: null },
    };
  }

  // 10) بررسی payload تیکت (فقط دیباگ؛ در پرود غیرفعال کن)
  @Public()
  @Post('ticket/inspect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Inspect bearer ticket payload (debug only)' })
  @ApiBearerAuth()
  @ApiResponse({ status: 200 })
  debugInspect(@Headers('authorization') authHeader: string) {
    const token = this.tokens.extractBearer(authHeader);
    if (!token) {
      throw new BadRequestException({
        code: 'MissingBearer',
        message: 'Bearer token missing.',
      });
    }
    const payload = this.tokens.decodeUnsafe(token);
    return { success: true, data: { payload } };
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

  private estimateStrength(pwd: string): 0 | 1 | 2 | 3 | 4 {
    let score = 0 as 0 | 1 | 2 | 3 | 4;
    if (!pwd) return 0;
    if (pwd.length >= 8) score = (score + 1) as 0 | 1 | 2 | 3 | 4;
    if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd))
      score = (score + 1) as 0 | 1 | 2 | 3 | 4;
    if (/\d/.test(pwd)) score = (score + 1) as 0 | 1 | 2 | 3 | 4;
    if (/[^A-Za-z0-9]/.test(pwd)) score = (score + 1) as 0 | 1 | 2 | 3 | 4;
    return score;
  }
}

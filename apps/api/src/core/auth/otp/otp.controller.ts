import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  HttpCode,
  Headers,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '@app/common/decorators/public.decorator';
import { OtpService } from './otp.service';
import { RequestOtpDto } from '../dto/otp/otp-request.dto';
import { ResendOtpDto } from '../dto/otp/otp-resend.dto';
import { VerifyOtpDto } from '../dto/otp/otp-verify.dto';
import { OtpPurpose } from '@prisma/client';

@ApiTags('Authentication - OTP')
@Controller('auth/otp')
export class OtpController {
  constructor(private readonly otp: OtpService) {}

  // ─────────────────────────────────────────────
  // 1) درخواست ارسال کد (Signup / Login / Reset)
  // ─────────────────────────────────────────────
  @Public()
  @Post('request')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Request a 6-digit OTP code via SMS or Email',
    description:
      'ارسال یا بازیابی کد تأیید ۶ رقمی. اگر کدی هنوز فعال است، تایمرها برمی‌گردند.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        success: true,
        data: {
          alreadyActive: false,
          expiresIn: 300,
          resendAvailableIn: 120,
        },
      },
    },
  })
  async request(
    @Body() dto: RequestOtpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') ua?: string,
  ) {
    const out = await this.otp.requestOtp(
      dto.channel,
      dto.identifier,
      dto.purpose ?? OtpPurpose.login,
      this.getIp(req),
      ua,
    );

    // اگر کد فعال بود → هدر Retry-After تنظیم شود
    if (
      out?.data?.alreadyActive &&
      typeof out.data.resendAvailableIn === 'number' &&
      out.data.resendAvailableIn > 0
    ) {
      res.setHeader('Retry-After', String(out.data.resendAvailableIn));
    }

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Cookie');
    return out;
  }

  // ─────────────────────────────────────────────
  // 2) بازارسال OTP (بدون تغییر purpose)
  // ─────────────────────────────────────────────
  @Public()
  @Post('resend')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Resend active OTP code (respects cooldown)',
    description:
      'بازارسال کد فعال در صورت گذشت کول‌داون. در غیر اینصورت، تایمرها برمی‌گردند.',
  })
  @ApiResponse({ status: 200 })
  async resend(
    @Body() dto: ResendOtpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') ua?: string,
  ) {
    const out = await this.otp.resendOtp(
      dto.channel,
      dto.identifier,
      dto.purpose ?? OtpPurpose.login,
      this.getIp(req),
      ua,
    );

    // تنظیم هدرها برای UX
    if (
      out?.data?.alreadyActive &&
      typeof out.data.resendAvailableIn === 'number' &&
      out.data.resendAvailableIn > 0
    ) {
      res.setHeader('Retry-After', String(out.data.resendAvailableIn));
    }

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Cookie');
    return out;
  }

  // ─────────────────────────────────────────────
  // 3) بررسی OTP و صدور تیکت (JWT ticket)
  // ─────────────────────────────────────────────
  @Public()
  @Post('verify')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Verify a 6-digit OTP and issue a temporary ticket',
    description:
      'اعتبارسنجی کد ۶ رقمی و صدور تیکت یک‌بارمصرف (JWT) برای مرحله‌ی بعدی مانند set-password.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        success: true,
        data: {
          ticket: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          next: 'set-password',
          expiresIn: 600,
        },
      },
    },
  })
  async verify(
    @Body() dto: VerifyOtpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') ua?: string,
  ) {
    const out = await this.otp.verifyOtp(
      dto.channel,
      dto.identifier,
      dto.code,
      dto.purpose ?? OtpPurpose.login,
      this.getIp(req),
      ua,
    );

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Cookie');
    return out;
  }

  // ─────────────────────────────────────────────
  // Helper برای تشخیص IP کاربر (proxy-aware)
  // ─────────────────────────────────────────────
  private getIp(req: Request): string | undefined {
    const ip =
      (req.headers['cf-connecting-ip'] as string) ||
      (req.headers['x-real-ip'] as string) ||
      (Array.isArray(req.ips) && req.ips.length > 0 && req.ips[0]) ||
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      req.socket?.remoteAddress;
    return ip || undefined;
  }
}

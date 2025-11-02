import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { createHash } from 'crypto';
import { OtpChannel, OtpPurpose } from '@app/prisma/prisma.constants';

@Injectable()
export class OtpRateLimitService {
  constructor(
    @Inject('REDIS') private readonly redis: Redis,
    private readonly cfg: ConfigService,
  ) {}

  // --- helpers ---

  /** کوتاه‌سازی SHA-256 تا 40 کاراکتر برای استفاده در کلید Redis */
  private h(v: string): string {
    return createHash('sha256').update(v).digest('hex').slice(0, 40);
  }

  /** ساخت کلید نام‌فضادار بدون PII (identifier/ip هش می‌شود) */
  private key(
    scope: 'req' | 'ver', // request or verify
    subject: 'id' | 'ip', // identifier or ip
    value: string, // raw identifier or raw ip
    channel?: OtpChannel,
    purpose?: OtpPurpose | string,
  ): string {
    const parts = ['otp', 'rl', scope, subject, this.h(value)];
    if (channel) parts.push(String(channel));
    if (purpose) parts.push(String(purpose));
    return parts.join(':'); // e.g. otp:rl:req:id:abc123:sms:login
  }

  /** افزایش شمارنده و ست کردن TTL در اولین ضربه (fixed window ساده) */
  private async bump(
    key: string,
    windowSec: number,
  ): Promise<{ count: number; ttl: number }> {
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, windowSec);
    }
    const ttl = await this.redis.ttl(key);
    return { count, ttl: Math.max(ttl, 0) };
  }

  // --- public API ---

  /**
   * مصرف سهمیهٔ درخواست OTP برای شناسه و (اختیاری) IP.
   * اگر هرکدام از سقف عبور کنند، 429 می‌دهد.
   */
  async consumeRequestBucket(
    identifier: string,
    ip?: string,
    channel?: OtpChannel,
    purpose?: OtpPurpose | string,
  ): Promise<void> {
    const win = Number(this.cfg.get('OTP_REQUEST_WINDOW') ?? 60);
    const maxId = Number(this.cfg.get('OTP_REQUEST_MAX') ?? 3);
    const maxIp = Number(this.cfg.get('OTP_REQUEST_IP_MAX') ?? 10);

    // per-identifier
    {
      const idKey = this.key('req', 'id', identifier, channel, purpose);
      const { count } = await this.bump(idKey, win);
      if (count > maxId) {
        throw new HttpException(
          {
            code: 'TooManyRequests',
            message:
              'تعداد درخواست‌های ارسال کد بیش از حد مجاز است. لطفاً بعداً دوباره تلاش کنید.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    // per-ip (اختیاری)
    if (ip) {
      const ipKey = this.key('req', 'ip', ip, channel, purpose);
      const { count } = await this.bump(ipKey, win);
      if (count > maxIp) {
        throw new HttpException(
          {
            code: 'TooManyRequests',
            message:
              'تعداد درخواست‌های این IP بیش از حد مجاز است. لطفاً بعداً دوباره تلاش کنید.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
  }

  /**
   * مصرف سهمیهٔ تأیید OTP برای شناسه و (اختیاری) IP.
   * اگر هرکدام از سقف عبور کنند، 429 می‌دهد.
   * معمولاً پنجرهٔ VERIFY برابر TTL خود OTP در نظر گرفته می‌شود.
   */
  async consumeVerifyBucket(
    identifier: string,
    ip?: string,
    channel?: OtpChannel,
    purpose?: OtpPurpose | string,
  ): Promise<void> {
    const win = Number(this.cfg.get('OTP_VERIFY_WINDOW') ?? 120);
    const maxId = Number(this.cfg.get('OTP_VERIFY_MAX') ?? 5);
    const maxIp = Number(this.cfg.get('OTP_VERIFY_IP_MAX') ?? 30);

    // per-identifier
    {
      const idKey = this.key('ver', 'id', identifier, channel, purpose);
      const { count } = await this.bump(idKey, win);
      if (count > maxId) {
        throw new HttpException(
          {
            code: 'TooManyRequests',
            message:
              'تعداد تلاش‌های تأیید کد بیش از حد مجاز است. لطفاً بعداً دوباره تلاش کنید.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    // per-ip (اختیاری)
    if (ip) {
      const ipKey = this.key('ver', 'ip', ip, channel, purpose);
      const { count } = await this.bump(ipKey, win);
      if (count > maxIp) {
        throw new HttpException(
          {
            code: 'TooManyRequests',
            message:
              'تعداد تلاش‌های تأیید کد از این IP بیش از حد مجاز است. لطفاً بعداً دوباره تلاش کنید.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
  }
}

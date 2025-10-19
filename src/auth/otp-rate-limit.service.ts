/**
 * Enforces Redis-backed token bucket limits for OTP request and verification flows.
 * Keeping throttling logic centralized makes both controllers and services lean.
 */
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
/**
 * Provides helper methods that increment and evaluate request/verify counters in Redis.
 */
export class OtpRateLimitService {
  constructor(
    @Inject("REDIS") private readonly redis: Redis,
    private readonly cfg: ConfigService,
  ) {}

  /**
   * Builds a namespaced Redis key for a specific OTP action bucket.
   * @param prefix Action type such as req (request) or ver (verify).
   * @param id Unique identifier such as phone or email.
   */
  private key(prefix: string, id: string) {
    return 'otp:' + prefix + ':' + id;
  }

  /**
   * Applies a token bucket to OTP issuance attempts per identifier.
   * @throws HttpException (429) when the number of requests exceeds the configured window.
   */
  async consumeRequestBucket(identifier: string) {
    const win = Number(this.cfg.get('OTP_REQUEST_WINDOW') || 60);
    const max = Number(this.cfg.get('OTP_REQUEST_MAX') || 3);
    const key = this.key('req', identifier);
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, win);
    }
    if (count > max) {
      throw new HttpException(
        'درخواست‌های بیش از حد. لطفاً کمی صبر کنید.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Applies a token bucket to OTP verification attempts per identifier.
   * @throws HttpException (429) when the number of verifications exceeds the configured window.
   */
  async consumeVerifyBucket(identifier: string) {
    const win = Number(this.cfg.get('OTP_VERIFY_WINDOW') || 120);
    const max = Number(this.cfg.get('OTP_VERIFY_MAX') || 5);
    const key = this.key('ver', identifier);
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, win);
    }
    if (count > max) {
      throw new HttpException(
        'تلاش‌های بیش از حد. لطفاً کمی صبر کنید.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}

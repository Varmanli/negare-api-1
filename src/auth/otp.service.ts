/**
 * OTP service encapsulates issuing and validating one-time codes for onboarding,
 * enforcing rate limits, delivering via SMS/email channels, and minting the follow-up JWT
 * that authorizes password creation during the auth bootstrap flow.
 */
import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, IsNull } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { sign, Secret, SignOptions } from 'jsonwebtoken';
import { OtpCode, OtpChannel } from './entities/otp-code.entity';
import { SmsService } from '../sms/sms.service';
import { MailService } from '../mail/mail.service';
import { OtpRateLimitService } from './otp-rate-limit.service';
import Redis from 'ioredis';
import { parseDurationToSeconds } from '../shared/utils/parse-duration.util';

// Use a stable hash for OTP comparison to avoid storing secrets in plain text.
function sha256Hex(v: string) {
  return crypto.createHash('sha256').update(v).digest('hex');
}

// Generate a six-digit numeric code; randomness quality delegated to Math.random bounds.
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

@Injectable()
/**
 * Manages OTP issuance, verification, and the ephemeral JWT used to gate password setup.
 * Depends on Redis for revocation tracking and TypeORM for OTP persistence.
 */
export class OtpService {
  private readonly ttlSeconds: number;
  private readonly setPwdSecret: Secret;
  private readonly setPwdExpires: string;
  private readonly setPwdExpiresSeconds: number;

  constructor(
    @InjectRepository(OtpCode) private readonly repo: Repository<OtpCode>,
    private readonly sms: SmsService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly rateLimit: OtpRateLimitService,
    @Inject('REDIS') private readonly redis: Redis,
  ) {
    this.ttlSeconds = Number(this.config.get('OTP_TTL_SECONDS') || 120);
    this.setPwdSecret = this.config.getOrThrow<string>('SET_PWD_JWT_SECRET');
    this.setPwdExpires = this.config.get<string>('SET_PWD_JWT_EXPIRES') || '10m';
    this.setPwdExpiresSeconds = parseDurationToSeconds(this.setPwdExpires);
  }

  /**
   * Issues a new OTP tied to the provided identifier while respecting rate limits,
   * persists it, and delivers it via the configured channel provider.
   * @param channel delivery medium (SMS or email) to use.
   * @param identifier phone number or email address belonging to the subject.
   * @returns Success object with the TTL so the client can render the countdown.
   * @throws HttpException surfaced from rate limit service when the identifier is throttled.
   */
  async requestOtp(channel: OtpChannel, identifier: string) {
    await this.rateLimit.consumeRequestBucket(identifier);
    const code = generateCode();
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);

    await this.repo.save(
      this.repo.create({
        channel,
        identifier,
        codeHash: sha256Hex(code),
        expiresAt,
      }),
    );

    if (channel === OtpChannel.sms) {
      await this.sms.sendOtp(identifier, code);
    } else {
      await this.mail.sendOtp(identifier, code);
    }

    return { success: true, expiresIn: this.ttlSeconds };
  }

  /**
   * Verifies the supplied OTP code, marks it as consumed, and mints a JWT that
   * authorizes password creation. The JWT JTI is stored in Redis to enforce one-time usage.
   * @param channel delivery channel originally used so lookups hit the correct record.
   * @param identifier phone/email string used during issuance.
   * @param code numeric OTP text the user received.
   * @returns Success flag plus the follow-up JWT for password setting.
   * @throws BadRequestException when no valid OTP is found or the code hash mismatches.
   */
  async verifyOtp(channel: OtpChannel, identifier: string, code: string) {
    await this.rateLimit.consumeVerifyBucket(identifier);
    const now = new Date();
    const record = await this.repo.findOne({
      where: {
        channel,
        identifier,
        expiresAt: MoreThan(now),
        consumedAt: IsNull(),
      },
      order: { createdAt: 'DESC' },
    });

    if (!record) {
      throw new BadRequestException('کد معتبر یافت نشد یا منقضی شده است');
    }

    record.attempts += 1;
    await this.repo.save(record);

    if (record.codeHash !== sha256Hex(code)) {
      throw new BadRequestException('کد وارد شده نادرست است');
    }

    record.consumedAt = new Date();
    await this.repo.save(record);

    const jti = crypto.randomUUID();
    const token = sign(
      { purpose: 'set_password', channel, identifier },
      this.setPwdSecret,
      { expiresIn: this.setPwdExpires, jwtid: jti } as SignOptions,
    );

    await this.redis.set(
      this.tokenKey(jti),
      '1',
      'EX',
      this.setPwdExpiresSeconds || 600,
    );

    return { success: true, token };
  }

  /**
   * Builds the Redis key used to track single-use password tokens.
   * @param jti JWT ID claim.
   * @returns Namespaced Redis key string.
   */
  private tokenKey(jti: string) {
    return `otp:setpwd:${jti}`;
  }
}

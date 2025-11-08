import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sign, SignOptions } from 'jsonwebtoken';
import * as crypto from 'crypto';
import type Redis from 'ioredis';
import { SmsService } from '@app/sms/sms.service';
import { MailService } from '@app/mail/mail.service';
import { OtpRateLimitService } from './otp-rate-limit.service';
import { OtpChannel, OtpPurpose } from '@prisma/client';

export interface AuditService {
  log(
    action: string,
    data: {
      userId?: string;
      ipHash?: string;
      uaHash?: string;
      traceId?: string;
      meta?: unknown;
    },
  ): Promise<void>;
}

type RedisHash = Record<string, string>;

// ───────────────────────────────
// Helpers
// ───────────────────────────────
function sha256Hex(v: string): string {
  return crypto.createHash('sha256').update(v).digest('hex');
}
function random6Digits(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}
function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}
function normalizeIdentifier(channel: OtpChannel, raw: string): string {
  let v = (raw ?? '').trim();
  if (channel === OtpChannel.sms && typeof v === 'string')
    v = v.replace(/\s+/g, '');
  if (channel === OtpChannel.email && typeof v === 'string')
    v = v.toLowerCase();
  return v;
}

@Injectable()
export class OtpService {
  // ---------- Config ----------
  private readonly OTP_TTL: number;
  private readonly RESEND_COOLDOWN: number;
  private readonly OTP_MAX_ATTEMPTS: number;
  private readonly OTP_MAX_RESENDS_PER_CODE: number;
  private readonly OTP_MIN_REGEN_IF_REMAINING: number;

  // Ticket
  private readonly TICKET_SECRET: string;
  private readonly TICKET_EXPIRES: string;
  private readonly TICKET_TTL_SEC: number;
  private readonly TICKET_ISSUER = 'negare-auth';
  private readonly TICKET_AUDIENCE = 'negare-core';

  constructor(
    private readonly config: ConfigService,
    private readonly rateLimit: OtpRateLimitService,
    private readonly sms: SmsService,
    private readonly mail: MailService,
    @Inject('REDIS') private readonly redis: Redis,
    @Inject('AuditService') private readonly audit?: AuditService,
  ) {
    this.OTP_TTL = Number(this.config.get('OTP_VERIFY_WINDOW') ?? 300);
    this.RESEND_COOLDOWN = Number(this.config.get('OTP_REQUEST_WINDOW') ?? 120);
    this.OTP_MAX_ATTEMPTS = Number(this.config.get('OTP_VERIFY_MAX') ?? 5);
    this.OTP_MAX_RESENDS_PER_CODE = Number(
      this.config.get('OTP_MAX_RESENDS_PER_CODE') ?? 3,
    );
    this.OTP_MIN_REGEN_IF_REMAINING = Number(
      this.config.get('OTP_MIN_REGEN_IF_REMAINING_SECONDS') ?? 60,
    );

    this.TICKET_SECRET = this.config.getOrThrow<string>('SET_PWD_JWT_SECRET');
    this.TICKET_EXPIRES =
      this.config.get<string>('SET_PWD_JWT_EXPIRES') ?? '10m';
    this.TICKET_TTL_SEC = this.parseDurationToSeconds(this.TICKET_EXPIRES);
  }

  // ───────────────────────────────
  // Public APIs
  // ───────────────────────────────

  async requestOtp(
    channel: OtpChannel,
    rawIdentifier: string,
    purpose: OtpPurpose = OtpPurpose.login,
    requestIp?: string,
    userAgent?: string,
  ) {
    const identifier = normalizeIdentifier(channel, rawIdentifier);

    await this.rateLimit.consumeRequestBucket(
      identifier,
      requestIp,
      channel,
      purpose,
    );

    if (await this.redis.exists(this.keyBlock(purpose, channel, identifier))) {
      throw new ForbiddenException('Too many attempts. Try again later.');
    }

    const activeKey = this.keyActive(purpose, channel, identifier);
    const cooldownKey = this.keyCooldown(purpose, channel, identifier);
    const now = nowEpoch();

    let hash: RedisHash | null = await this.redis.hgetall(activeKey);
    if (hash && Object.keys(hash).length === 0) hash = null;

    if (hash) {
      const resendAt = Number(hash.resendAt ?? '0');
      const exp = Number(hash.exp ?? '0');
      const resendRemaining = Math.max(0, resendAt - now);
      const expiresIn = Math.max(0, exp - now);

      if (resendRemaining > 0) {
        return {
          success: true as const,
          data: {
            alreadyActive: true,
            expiresIn,
            resendAvailableIn: resendRemaining,
          },
        };
      }
    }

    await this.issueNewCode(
      channel,
      identifier,
      purpose,
      requestIp,
      activeKey,
      cooldownKey,
    );

    await this.audit?.log('OTP_REQUEST', {
      meta: { channel, purpose },
      ipHash: this.maskIp(requestIp),
      uaHash: this.hashUa(userAgent),
    });

    return {
      success: true as const,
      data: {
        alreadyActive: false,
        expiresIn: this.OTP_TTL,
        resendAvailableIn: this.RESEND_COOLDOWN,
      },
    };
  }

  async verifyOtp(
    channel: OtpChannel,
    rawIdentifier: string,
    code: string,
    purpose: OtpPurpose = OtpPurpose.login,
    requestIp?: string,
    userAgent?: string,
  ) {
    const identifier = normalizeIdentifier(channel, rawIdentifier);

    await this.rateLimit.consumeVerifyBucket(
      identifier,
      requestIp,
      channel,
      purpose,
    );

    const activeKey = this.keyActive(purpose, channel, identifier);
    const blockKey = this.keyBlock(purpose, channel, identifier);

    if (await this.redis.exists(blockKey)) {
      throw new ForbiddenException('Too many attempts. Try again later.');
    }

    const hash = await this.redis.hgetall(activeKey);
    if (!hash || Object.keys(hash).length === 0) {
      throw new BadRequestException('Invalid or expired code.');
    }

    const now = nowEpoch();
    const exp = Number(hash.exp ?? '0');
    if (exp <= now) {
      await this.redis.del(activeKey);
      throw new BadRequestException('Invalid or expired code.');
    }

    const attempts = await this.redis.hincrby(activeKey, 'attempts', 1);
    const maxAttempts = Number(hash.maxAttempts ?? this.OTP_MAX_ATTEMPTS);
    if (attempts > maxAttempts) {
      await this.redis
        .multi()
        .del(activeKey)
        .set(blockKey, '1', 'EX', this.blockWindowSeconds())
        .exec();
      throw new ForbiddenException('Too many attempts. Try again later.');
    }

    const ok = hash.codeHash === sha256Hex(code);
    if (!ok) {
      throw new BadRequestException('Invalid or expired code.');
    }

    // موفقیت: پاکسازی و صدور تیکت
    const jti = crypto.randomUUID();
    const payload = { purpose, channel, identifier };
    const opts: SignOptions = {
      expiresIn: this.TICKET_TTL_SEC,
      jwtid: jti,
      issuer: this.TICKET_ISSUER,
      audience: this.TICKET_AUDIENCE,
      subject: identifier,
    };
    const ticket = sign(payload, this.TICKET_SECRET, opts);

    // ✅ ذخیره هش تیکت (برای هماهنگی با PasswordService)
    await this.redis
      .multi()
      .del(activeKey)
      .del(this.keyCooldown(purpose, channel, identifier))
      .set(this.keyTicket(jti), sha256Hex(ticket), 'EX', this.TICKET_TTL_SEC)
      .exec();

    await this.audit?.log('OTP_VERIFY_SUCCESS', {
      meta: { channel, purpose },
      ipHash: this.maskIp(requestIp),
      uaHash: this.hashUa(userAgent),
    });

    return {
      success: true as const,
      data: {
        ticket,
        next: purpose === OtpPurpose.reset ? 'reset-password' : 'set-password',
        expiresIn: this.TICKET_TTL_SEC,
      },
    };
  }

  // ───────────────────────────────
  // Helpers
  // ───────────────────────────────
  private async issueNewCode(
    channel: OtpChannel,
    identifier: string,
    purpose: OtpPurpose,
    requestIp: string | undefined,
    activeKey: string,
    cooldownKey: string,
  ): Promise<void> {
    const now = nowEpoch();
    const code = random6Digits();
    const multi = this.redis.multi();

    multi.hset(activeKey, {
      codeHash: sha256Hex(code),
      attempts: '0',
      maxAttempts: String(this.OTP_MAX_ATTEMPTS),
      exp: String(now + this.OTP_TTL),
      resendAt: String(now + this.RESEND_COOLDOWN),
      sendCount: '1',
      ip: this.maskIp(requestIp) ?? '',
      ch: channel,
      pu: purpose,
    });
    multi.expire(activeKey, this.OTP_TTL);
    multi.set(cooldownKey, '1', 'EX', this.RESEND_COOLDOWN);

    await multi.exec();

    // ارسال کد
    if (channel === OtpChannel.sms) {
      await this.sms.sendOtp(identifier, code);
    } else {
      await this.mail.sendOtp(identifier, code);
    }
  }

  private keyBase(
    purpose: OtpPurpose,
    channel: OtpChannel,
    identifier: string,
  ): string {
    const idHash = sha256Hex(`${purpose}|${channel}|${identifier}`).slice(
      0,
      40,
    );
    return `otp:${idHash}`;
  }
  private keyActive(
    purpose: OtpPurpose,
    channel: OtpChannel,
    identifier: string,
  ): string {
    return this.keyBase(purpose, channel, identifier);
  }
  private keyCooldown(
    purpose: OtpPurpose,
    channel: OtpChannel,
    identifier: string,
  ): string {
    return `${this.keyBase(purpose, channel, identifier)}:cd`;
  }
  private keyBlock(
    purpose: OtpPurpose,
    channel: OtpChannel,
    identifier: string,
  ): string {
    return `${this.keyBase(purpose, channel, identifier)}:blk`;
  }
  private keyTicket(jti: string): string {
    return `otp:ticket:${jti}`;
  }

  private parseDurationToSeconds(s: string): number {
    const m = /^(\d+)([smh])$/.exec(String(s).trim());
    if (!m) return Number(s) || 600;
    const n = Number(m[1]);
    return m[2] === 's' ? n : m[2] === 'm' ? n * 60 : n * 3600;
  }

  private blockWindowSeconds(): number {
    return Number(this.config.get('OTP_BLOCK_WINDOW') ?? 900);
  }

  private maskIp(ip?: string): string | undefined {
    if (!ip) return undefined;
    const parts = ip.split('.');
    return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.0/24` : ip;
  }
  private hashUa(ua?: string): string | undefined {
    return ua ? sha256Hex(ua).slice(0, 32) : undefined;
  }

  async resendOtp(
    channel: OtpChannel,
    rawIdentifier: string,
    purpose: OtpPurpose = OtpPurpose.login,
    requestIp?: string,
    userAgent?: string,
  ) {
    const identifier = normalizeIdentifier(channel, rawIdentifier);

    await this.rateLimit.consumeRequestBucket(
      identifier,
      requestIp,
      channel,
      purpose,
    );

    const activeKey = this.keyActive(purpose, channel, identifier);
    const cooldownKey = this.keyCooldown(purpose, channel, identifier);
    const now = nowEpoch();

    let hash: Record<string, string> | null =
      await this.redis.hgetall(activeKey);
    if (hash && Object.keys(hash).length === 0) hash = null;

    if (!hash) {
      // اگر کدی فعال نیست، مثل request رفتار کن
      return this.requestOtp(
        channel,
        identifier,
        purpose,
        requestIp,
        userAgent,
      );
    }

    const resendAt = Number(hash.resendAt ?? '0');
    const exp = Number(hash.exp ?? '0');
    const resendRemaining = Math.max(0, resendAt - now);

    if (resendRemaining > 0) {
      const expiresIn = Math.max(0, exp - now);
      return {
        success: true as const,
        data: {
          alreadyActive: true,
          expiresIn,
          resendAvailableIn: resendRemaining,
        },
      };
    }

    // بعد از اتمام کول‌داون، کد جدید صادر کن
    await this.issueNewCode(
      channel,
      identifier,
      purpose,
      requestIp,
      activeKey,
      cooldownKey,
    );

    await this.audit?.log('OTP_REQUEST', {
      meta: { channel, purpose, resend: true },
      ipHash: this.maskIp(requestIp),
      uaHash: this.hashUa(userAgent),
    });

    return {
      success: true as const,
      data: {
        alreadyActive: false,
        expiresIn: this.OTP_TTL,
        resendAvailableIn: this.RESEND_COOLDOWN,
      },
    };
  }
}

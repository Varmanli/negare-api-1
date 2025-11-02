// apps/api/src/core/auth/password/password.service.ts

import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
  InternalServerErrorException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import type { Prisma } from '@prisma/client';
import { Secret, verify } from 'jsonwebtoken';
import type Redis from 'ioredis';
import { PrismaService } from '@app/prisma/prisma.service';
import { MailService } from '@app/mail/mail.service';
import type { AllConfig } from '@app/config/config.module';
import { createHash, timingSafeEqual } from 'crypto';

/** 429 اختصاصی (Nest v8-compatible) */
class TooManyRequestsException extends HttpException {
  constructor(response?: unknown) {
    super(response ?? 'Too many requests', HttpStatus.TOO_MANY_REQUESTS);
  }
}

/** Payload تیکت set-password */
interface SetPasswordPayload {
  purpose: 'login' | 'signup' | 'reset';
  channel: 'sms' | 'email';
  identifier: string;
  jti: string;
}

/** نمای باریک کاربر برای Login */
type UserSlim = {
  id: string;
  passwordHash: string | null;
  email: string | null;
  phone: string | null;
  username: string | null;
  name: string | null;
  status: string;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
};

function sha256Hex(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}
function safeEqHex(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  private readonly setPwdSecret: Secret;
  private readonly setPwdIssuer = 'negare-auth';
  private readonly setPwdAudience = 'negare-core';
  private readonly bcryptRounds: number;
  private readonly loginThrottleLimit: number;
  private readonly loginThrottleWindowSec: number;
  private readonly dummyBcryptHash: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AllConfig>,
    private readonly mail: MailService,
    @Inject('REDIS') private readonly redis: Redis,
  ) {
    this.setPwdSecret = this.config.getOrThrow<string>('SET_PWD_JWT_SECRET');
    this.bcryptRounds = Number(this.config.get('BCRYPT_ROUNDS') ?? 10);
    this.loginThrottleLimit = Number(
      this.config.get('LOGIN_THROTTLE_LIMIT') ?? 6,
    );
    this.loginThrottleWindowSec = Number(
      this.config.get('LOGIN_THROTTLE_WINDOW_SEC') ?? 300,
    );
    // bcrypt hash of "dummy"
    this.dummyBcryptHash =
      this.config.get('DUMMY_BCRYPT_HASH') ??
      '$2b$10$Cj2EoHjE7k0eJw1v1jv7ruo3Y4nH7C3d9xYd1p6kq6nWlYwX0r0uW';
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Normalizers
  // ────────────────────────────────────────────────────────────────────────────
  private normalizeEmail(raw?: string | null): string | null {
    const v = (raw ?? '').trim();
    if (!v || !v.includes('@')) return null;
    return v.toLowerCase();
  }
  /** موبایل به E.164 ایران (+98...) */
  private normalizePhone(raw?: string | null): string | null {
    const v = (raw ?? '').trim();
    if (!v) return null;
    if (/^\+\d{7,15}$/.test(v)) return v;
    const digits = v.replace(/\D/g, '');
    if (!digits) return null;
    if (digits.startsWith('0098')) return `+${digits.slice(2)}`;
    if (digits.startsWith('98')) return `+${digits}`;
    if (digits.startsWith('0') && digits.length === 11)
      return `+98${digits.slice(1)}`;
    if (digits.length === 10 && digits.startsWith('9')) return `+98${digits}`;
    return null;
  }
  private splitIdentifier(raw: string): {
    email?: string;
    phone?: string;
    username?: string;
  } {
    const email = this.normalizeEmail(raw);
    if (email) return { email };
    const phone = this.normalizePhone(raw);
    if (phone) return { phone };
    const username = (raw ?? '').trim().toLowerCase();
    if (username) return { username };
    return {};
  }

  // ────────────────────────────────────────────────────────────────────────────
  // OTP Ticket (اختیاری برای set-password)
  // ────────────────────────────────────────────────────────────────────────────
  async issueSetPasswordTicket(
    token: string,
    jti: string,
    ttlSec?: number,
  ): Promise<void> {
    const key = `otp:ticket:${jti}`;
    const value = sha256Hex(token);
    const ttl =
      ttlSec ?? Number(this.config.get('SET_PWD_JWT_EXPIRES_SEC') ?? 600);
    try {
      await this.redis.set(key, value, 'EX', ttl);
      this.logger.debug(`SET_PWD ticket stored jti=${jti} ttl=${ttl}s`);
    } catch (err) {
      throw new InternalServerErrorException({
        code: 'RedisError',
        message: 'Failed to store OTP ticket.',
        details: (err as Error).message,
      });
    }
  }

  private async verifyAndConsumeOtpTicket(
    token: string,
  ): Promise<SetPasswordPayload> {
    let decoded: Partial<SetPasswordPayload> & { jti?: string };
    try {
      decoded = verify(token, this.setPwdSecret, {
        algorithms: ['HS256'],
        issuer: this.setPwdIssuer,
        audience: this.setPwdAudience,
      }) as Partial<SetPasswordPayload> & { jti?: string };
    } catch {
      throw new BadRequestException({
        code: 'InvalidOrExpiredToken',
        message: 'Set-password token is invalid or expired.',
      });
    }

    if (!decoded?.jti) {
      throw new BadRequestException({
        code: 'MissingJti',
        message: 'Token missing its unique ID (jti).',
      });
    }
    if (!decoded.identifier || !decoded.channel || !decoded.purpose) {
      throw new BadRequestException({
        code: 'IncompletePayload',
        message: 'Set-password token payload incomplete.',
      });
    }

    const key = `otp:ticket:${decoded.jti}`;
    const redisAny = this.redis as unknown as {
      getdel?: (k: string) => Promise<string | null>;
    };

    let storedHex: string | null = null;
    try {
      storedHex =
        typeof redisAny.getdel === 'function'
          ? await redisAny.getdel(key)
          : await this.redis.get(key);
      if (!redisAny.getdel && storedHex) await this.redis.del(key);
    } catch (err) {
      throw new InternalServerErrorException({
        code: 'RedisError',
        message: 'Failed to validate OTP ticket.',
        details: (err as Error).message,
      });
    }

    if (!storedHex) {
      throw new BadRequestException({
        code: 'TicketUsedOrMissing',
        message: 'Set-password token already used or missing.',
      });
    }

    const actualHex = sha256Hex(token);
    if (!safeEqHex(storedHex, actualHex)) {
      throw new BadRequestException({
        code: 'TicketIntegrity',
        message: 'Set-password token integrity check failed.',
      });
    }

    return {
      purpose: decoded.purpose as SetPasswordPayload['purpose'],
      channel: decoded.channel as SetPasswordPayload['channel'],
      identifier: decoded.identifier as string,
      jti: decoded.jti as string,
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // SET PASSWORD (consume ticket + upsert user + hash)
  // ────────────────────────────────────────────────────────────────────────────
  async setPassword(
    token: string,
    password: string,
  ): Promise<{ success: true; userId: string }> {
    const payload = await this.verifyAndConsumeOtpTicket(token);
    const { identifier, channel } = payload;

    if (typeof password !== 'string' || password.length < 8) {
      throw new BadRequestException({
        code: 'WeakPassword',
        message: 'Password must be at least 8 characters long.',
      });
    }

    const passwordHash = await bcrypt.hash(password, this.bcryptRounds);
    const persisted = await this.upsertUserForChannel(
      channel,
      identifier,
      passwordHash,
    );

    if (persisted.email) {
      this.mail
        .sendWelcome(
          persisted.email,
          persisted.name ?? persisted.username ?? identifier,
        )
        .catch(() => undefined);
    }

    this.logger.debug(`SET_PWD success userId=${persisted.id}`);
    return { success: true, userId: persisted.id };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // LOGIN (Throttle + OR-lookup + Dummy bcrypt)
  // ────────────────────────────────────────────────────────────────────────────
  async login(
    identifier: string,
    password: string,
    ip?: string,
  ): Promise<{ userId: string }> {
    const idn = (identifier ?? '').trim();
    this.logger.debug(`LOGIN start idn="${idn}" ip="${ip ?? 'n/a'}"`);
    if (!idn) {
      this.logger.debug('LOGIN early-exit: empty identifier');
      throw new UnauthorizedException({
        code: 'InvalidCredentials',
        message: 'Invalid credentials.',
      });
    }

    // throttle
    const throttleKey = ip
      ? `auth:login:throttle:${idn}:${ip}`
      : `auth:login:throttle:${idn}`;
    try {
      const attempts = await this.redis.incr(throttleKey);
      if (attempts === 1)
        await this.redis.expire(throttleKey, this.loginThrottleWindowSec);
      this.logger.debug(
        `LOGIN throttle attempts=${attempts}/${this.loginThrottleLimit} window=${this.loginThrottleWindowSec}s`,
      );
      if (attempts > this.loginThrottleLimit) {
        this.logger.warn(`LOGIN too-many-attempts key=${throttleKey}`);
        throw new TooManyRequestsException({
          code: 'TooManyAttempts',
          message: 'Too many login attempts. Try again later.',
        });
      }
    } catch (e) {
      this.logger.warn(
        `LOGIN throttle error (ignored): ${(e as Error).message}`,
      );
    }

    const { email, phone, username } = this.splitIdentifier(idn);
    this.logger.debug(
      `LOGIN split email=${email ?? '-'} phone=${phone ?? '-'} username=${username ?? '-'}`,
    );

    // select فقط فیلدهای موجود در جدول شما
    const selectFields: Prisma.UserSelect = {
      id: true,
      passwordHash: true,
      email: true,
      phone: true,
      username: true,
      name: true,
      status: true as unknown as never,
      isEmailVerified: true as unknown as never,
      isPhoneVerified: true as unknown as never,
    };

    let user: UserSlim | null = null;
    try {
      user = (await this.prisma.user.findFirst({
        where: {
          OR: [
            ...(email ? [{ email }] : []),
            ...(phone ? [{ phone }] : []),
            ...(username ? [{ username }] : []),
          ],
        },
        select: selectFields,
      })) as unknown as UserSlim;
    } catch (e) {
      this.logger.error(`LOGIN DB error: ${(e as Error).message}`);
      user = null;
    }

    this.logger.debug(
      `LOGIN post-find found=${!!user} id=${user?.id ?? '-'} status=${user?.status ?? '-'} ` +
        `emailVer=${user?.isEmailVerified ?? '-'} phoneVer=${user?.isPhoneVerified ?? '-'} hasHash=${!!user?.passwordHash}`,
    );

    const hashToCheck = user?.passwordHash ?? this.dummyBcryptHash;
    const okBcrypt = await bcrypt.compare(password, hashToCheck);
    this.logger.debug(
      `LOGIN compare okBcrypt=${okBcrypt} userId=${user?.id ?? '-'}`,
    );

    if (user?.id && okBcrypt) {
      try {
        await this.redis.del(throttleKey);
      } catch {}
      this.logger.debug(`LOGIN success userId=${user.id}`);
      return { userId: user.id };
    }

    // شکست
    try {
      await this.redis.incr(throttleKey);
    } catch {}
    this.logger.debug(`LOGIN fail -> 401 idn="${idn}"`);
    throw new UnauthorizedException({
      code: 'InvalidCredentials',
      message: 'Invalid credentials.',
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // CHANGE PASSWORD
  // ────────────────────────────────────────────────────────────────────────────
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ success: true }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        passwordHash: true,
        email: true,
        username: true,
        name: true,
      },
    });

    if (!user?.passwordHash) {
      throw new UnauthorizedException({
        code: 'InvalidCredentials',
        message: 'Invalid credentials.',
      });
    }

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException({
        code: 'InvalidCredentials',
        message: 'Invalid credentials.',
      });
    }

    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      throw new BadRequestException({
        code: 'WeakPassword',
        message: 'New password is too weak.',
      });
    }

    const hash = await bcrypt.hash(newPassword, this.bcryptRounds);

    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: hash } as Prisma.UserUpdateInput,
      });
    } catch (err) {
      throw new InternalServerErrorException({
        code: 'DatabaseError',
        message: 'Failed to update password.',
        details: (err as Error).message,
      });
    }

    return { success: true };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Upsert user by channel (email/sms)
  // ────────────────────────────────────────────────────────────────────────────
  private async upsertUserForChannel(
    channel: 'sms' | 'email',
    identifier: string,
    passwordHash: string,
  ): Promise<{
    id: string;
    username: string | null;
    name: string | null;
    email: string | null;
  }> {
    if (channel === 'sms') {
      const phone = this.normalizePhone(identifier);
      if (!phone)
        throw new BadRequestException({
          code: 'InvalidPhone',
          message: 'Invalid phone format.',
        });

      try {
        return (await this.prisma.user.upsert({
          where: { phone },
          create: {
            username: await this.generateUsername(phone),
            phone,
            email: null,
            name: null,
            passwordHash,
          } as Prisma.UserCreateInput,
          update: { passwordHash, phone } as Prisma.UserUpdateInput,
          select: { id: true, username: true, name: true, email: true },
        })) as {
          id: string;
          username: string | null;
          name: string | null;
          email: string | null;
        };
      } catch (err) {
        if ((err as { code?: string })?.code === 'P2002') {
          const existing = await this.prisma.user.findUnique({
            where: { phone },
            select: { id: true, phone: true },
          });
          if (existing) {
            return (await this.prisma.user.update({
              where: { id: existing.id },
              data: {
                passwordHash,
                phone: existing.phone ?? phone,
              } as Prisma.UserUpdateInput,
              select: { id: true, username: true, name: true, email: true },
            })) as {
              id: string;
              username: string | null;
              name: string | null;
              email: string | null;
            };
          }
        }
        throw new InternalServerErrorException({
          code: 'DatabaseError',
          message: 'Failed to upsert user (sms).',
          details: (err as Error).message,
        });
      }
    }

    // email channel
    const email = this.normalizeEmail(identifier);
    if (!email)
      throw new BadRequestException({
        code: 'InvalidEmail',
        message: 'Invalid email format.',
      });

    try {
      return (await this.prisma.user.upsert({
        where: { email },
        create: {
          username: await this.generateUsername(email),
          email,
          phone: null,
          name: null,
          passwordHash,
        } as Prisma.UserCreateInput,
        update: { passwordHash, email } as Prisma.UserUpdateInput,
        select: { id: true, username: true, name: true, email: true },
      })) as {
        id: string;
        username: string | null;
        name: string | null;
        email: string | null;
      };
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') {
        const existing = await this.prisma.user.findUnique({
          where: { email },
          select: { id: true, email: true },
        });
        if (existing) {
          return (await this.prisma.user.update({
            where: { id: existing.id },
            data: {
              passwordHash,
              email: existing.email ?? email,
            } as Prisma.UserUpdateInput,
            select: { id: true, username: true, name: true, email: true },
          })) as {
            id: string;
            username: string | null;
            name: string | null;
            email: string | null;
          };
        }
      }
      throw new InternalServerErrorException({
        code: 'DatabaseError',
        message: 'Failed to upsert user (email).',
        details: (err as Error).message,
      });
    }
  }

  private async generateUsername(seed: string): Promise<string> {
    const base =
      (seed ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 20) || 'user';
    for (let i = 0; i < 1000; i += 1) {
      const cand = i === 0 ? base : `${base}${i + 1}`;
      const exists = await this.prisma.user.findUnique({
        where: { username: cand },
        select: { id: true },
      });
      if (!exists) return cand;
    }
    return `${base}${Math.floor(Math.random() * 1_000_000)}`;
  }
}

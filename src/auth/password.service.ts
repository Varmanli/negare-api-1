/**
 * PasswordService handles password persistence, welcome notifications, and
 * issuing token pairs after either OTP onboarding or traditional login.
 * It verifies the single-use OTP JWT, hashes passwords, and coordinates token issuance.
 */
import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { Secret, verify } from 'jsonwebtoken';
import Redis from 'ioredis';
import { User } from '../core/users/user.entity';
import { OtpChannel } from './entities/otp-code.entity';
import { MailService } from '../mail/mail.service';
import { welcomeHtml } from '../mail/templates/welcome';
import { RefreshService } from './refresh.service';

interface SetPasswordPayload {
  purpose: string;
  channel: OtpChannel;
  identifier: string;
  jti?: string;
}

@Injectable()
/**
 * Provides password lifecycle operations and defers token issuance to RefreshService.
 * Responsible for bridging OTP bootstrap into persistent user accounts.
 */
export class PasswordService {
  private readonly setPwdSecret: Secret;

  constructor(
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    @Inject('REDIS') private readonly redis: Redis,
    private readonly refresh: RefreshService,
  ) {
    this.setPwdSecret = this.config.getOrThrow<string>('SET_PWD_JWT_SECRET');
  }

  /**
   * Completes OTP onboarding by validating the set-password JWT, creating or updating
   * the user record, hashing the password, and issuing access/refresh tokens.
   * @param token JWT issued by OTP verification with `purpose = set_password`.
   * @param password raw password string provided by the client.
   * @returns Access and refresh tokens tied to the saved user.
   * @throws BadRequestException when the token is invalid, reused, or mismatched.
   */
  async setPassword(token: string, password: string) {
    const payload = await this.verifySetPasswordToken(token);
    const { identifier, channel } = payload;

    let user: User | null = null;
    if (channel === OtpChannel.sms) {
      user = await this.usersRepo.findOne({ where: { phone: identifier } });
    } else {
      user = await this.usersRepo.findOne({ where: { email: identifier } });
    }

    if (!user) {
      user = this.usersRepo.create({
        username: await this.generateUsername(identifier),
        email: channel === OtpChannel.email ? identifier : null,
        phone: channel === OtpChannel.sms ? identifier : null,
        isActive: true,
      });
    } else {
      if (channel === OtpChannel.email && !user.email) {
        user.email = identifier;
      }
      if (channel === OtpChannel.sms && !user.phone) {
        user.phone = identifier;
      }
      user.isActive = true;
    }

    user.passwordHash = await bcrypt.hash(password, 10);
    const saved = await this.usersRepo.save(user);

    if (saved.email) {
      this.mail
        .sendWelcome(saved.email, saved.name || saved.username)
        .catch(() => undefined);
    }

    const tokens = await this.refresh.issueTokensForUserId(saved.id);

    return {
      success: true,
      token: tokens.accessToken,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  /**
   * Authenticates an existing user by comparing the supplied password hash and,
   * on success, issuing a fresh token pair containing the user's roles.
   * @param identifier email or phone string supplied during login.
   * @param password raw password to validate via bcrypt.
   * @returns Access/refresh token pair with success flag for parity with other flows.
   * @throws UnauthorizedException when the identifier is unknown or password mismatch occurs.
   */
  async login(identifier: string, password: string) {
    const isEmail = identifier.includes('@');
    const qb = this.usersRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .leftJoinAndSelect('user.userRoles', 'userRoles')
      .leftJoinAndSelect('userRoles.role', 'role');

    if (isEmail) {
      qb.where('user.email = :identifier', { identifier });
    } else {
      qb.where('user.phone = :identifier', { identifier });
    }

    const user = await qb.getOne();
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('اطلاعات ورود نادرست است');
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('اطلاعات ورود نادرست است');
    }

    const tokens = await this.refresh.issueTokensForUser(user);

    return {
      success: true,
      token: tokens.accessToken,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  /**
   * Validates and consumes the set-password JWT, enforcing single-use semantics via Redis.
   * @param token JWT supplied by the caller.
   * @returns Decoded payload with identifier and channel info.
   * @throws BadRequestException when the token signature is invalid, expired, or reused.
   */
  private async verifySetPasswordToken(
    token: string,
  ): Promise<SetPasswordPayload> {
    let decoded: SetPasswordPayload;
    try {
      decoded = verify(token, this.setPwdSecret) as SetPasswordPayload;
    } catch {
      throw new BadRequestException('توکن نامعتبر یا منقضی شده است');
    }

    if (decoded.purpose !== 'set_password') {
      throw new BadRequestException('توکن برای این عملیات معتبر نیست');
    }
    if (!decoded.jti) {
      throw new BadRequestException('شناسه توکن یافت نشد');
    }

    const key = this.setPwdTokenKey(decoded.jti);
    const exists = await this.redis.get(key);
    if (!exists) {
      throw new BadRequestException('توکن معتبر نیست یا قبلاً استفاده شده است');
    }
    await this.redis.del(key);

    return decoded;
  }

  /**
   * Generates a unique username by normalizing the seed and appending a counter if needed.
   * @param seed source string (email/phone) used to derive the username.
   * @returns Unique username value safe to persist.
   */
  private async generateUsername(seed: string) {
    const base =
      seed
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 20) || 'user';

    let candidate = base;
    let counter = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const exists = await this.usersRepo.exist({
        where: { username: candidate },
      });
      if (!exists) {
        return candidate;
      }
      counter += 1;
      candidate = `${base}${counter}`;
    }
  }

  /**
   * Constructs the Redis key for tracking single-use set-password JWTs.
   * @param jti JWT ID claim extracted from the token.
   * @returns Namespaced key string.
   */
  private setPwdTokenKey(jti: string) {
    return `otp:setpwd:${jti}`;
  }
}

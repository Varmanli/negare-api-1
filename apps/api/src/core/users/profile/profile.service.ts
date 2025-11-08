// apps/api/src/core/profile/profile.service.ts

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma as PrismaNS } from '@prisma/client';
import { PrismaService } from '@app/prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

// قوانین نام‌کاربری (قبلاً ساختیم)
import {
  USERNAME_MIN,
  USERNAME_MAX,
  USERNAME_REGEX,
  RESERVED_USERNAMES,
} from './username.rules';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

type RoleSlim = { id: string; name: string };

type ProfileRecord = PrismaNS.UserGetPayload<{
  select: {
    id: true;
    username: true;
    name: true;
    email: true;
    phone: true;
    bio: true;
    city: true;
    avatarUrl: true;
    createdAt: true;
    updatedAt: true;
    userRoles: { select: { role: { select: { id: true; name: true } } } };
  };
}>;

type UsernameAvailability =
  | { ok: true; available: true; username: string }
  | { ok: true; available: false; username: string; reason: string }
  | { ok: false; available: false; username: string; reason: string };

@Injectable()
export class ProfileService {
  protected static readonly profileSelect = {
    id: true,
    username: true,
    name: true,
    email: true,
    phone: true,
    bio: true,
    city: true,
    avatarUrl: true,
    createdAt: true,
    updatedAt: true,
    userRoles: { select: { role: { select: { id: true, name: true } } } },
  } as const;

  private static readonly contactChangeError =
    'برای تغییر ایمیل یا موبایل لطفاً از مسیر تایید OTP استفاده کنید.';

  constructor(private readonly prisma: PrismaService) {}

  // ────────────────────────────────────────────────────────────────────────────
  // Public APIs
  // ────────────────────────────────────────────────────────────────────────────

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: ProfileService.profileSelect,
    });

    if (!user) {
      throw new NotFoundException('پروفایل کاربر یافت نشد');
    }

    return this.serialize(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    if (dto.email !== undefined || dto.phone !== undefined) {
      throw new BadRequestException(ProfileService.contactChangeError);
    }

    const data: PrismaNS.UserUpdateInput = {
      name: this.normalizeNullable(dto.name),
      bio: this.normalizeNullable(dto.bio),
      city: this.normalizeNullable(dto.city),
      avatarUrl: this.normalizeNullable(dto.avatarUrl),
    };

    try {
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data,
        select: ProfileService.profileSelect,
      });
      return this.serialize(updated);
    } catch (error) {
      if (
        error instanceof PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('پروفایل کاربر یافت نشد');
      }
      throw error;
    }
  }

  async updateAvatar(userId: string, avatarUrl: string): Promise<void> {
    const data: PrismaNS.UserUpdateInput = {
      avatarUrl: this.normalizeNullable(avatarUrl),
    };

    try {
      await this.prisma.user.update({
        where: { id: userId },
        data,
        select: { id: true },
      });
    } catch (error) {
      if (
        error instanceof PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('پروفایل کاربر یافت نشد');
      }
      throw error;
    }
  }

  /**
   * چک سریع اعتبار و موجودبودن نام‌کاربری
   */
  async checkUsernameAvailability(raw: string): Promise<UsernameAvailability> {
    const username = this.normalizeUsername(raw);

    // اعتبارسنجی اولیه
    if (!username) {
      return {
        ok: false,
        available: false,
        username,
        reason: 'نام کاربری نمی‌تواند خالی باشد.',
      };
    }
    if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
      return {
        ok: false,
        available: false,
        username,
        reason: `طول نام کاربری باید بین ${USERNAME_MIN} تا ${USERNAME_MAX} باشد.`,
      };
    }
    if (!USERNAME_REGEX.test(username)) {
      return {
        ok: false,
        available: false,
        username,
        reason:
          'فقط حروف انگلیسی، عدد و زیرخط مجاز است؛ با زیرخط شروع/تمام نشود و زیرخط‌های متوالی نداشته باشد.',
      };
    }

    // رزروها
    if (RESERVED_USERNAMES.has(username)) {
      return {
        ok: true,
        available: false,
        username,
        reason: 'این نام کاربری رزرو شده و قابل استفاده نیست.',
      };
    }

    // یونیک بودن (CITEXT در DB)
    const exists = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true },
    });
    if (exists) {
      return {
        ok: true,
        available: false,
        username,
        reason: 'این نام کاربری قبلاً گرفته شده است.',
      };
    }

    return { ok: true, available: true, username };
  }

  /**
   * تغییر نام‌کاربری کاربر
   */
  async updateUsername(userId: string, raw: string) {
    const check = await this.checkUsernameAvailability(raw);

    if (!check.ok) {
      throw new BadRequestException({
        code: 'InvalidUsername',
        message: check.reason,
      });
    }
    if (!check.available) {
      throw new BadRequestException({
        code: 'UsernameTakenOrReserved',
        message: check.reason,
      });
    }

    // اعمال تغییر
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { username: check.username } satisfies PrismaNS.UserUpdateInput,
      select: ProfileService.profileSelect,
    });

    return this.serialize(updated);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────────────────

  private serialize(user: ProfileRecord) {
    const roles: RoleSlim[] =
      user.userRoles?.map((ur) => ur.role).filter(Boolean) ?? [];

    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      phone: user.phone,
      bio: user.bio,
      city: user.city,
      avatarUrl: user.avatarUrl,
      roles,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private normalizeNullable(value: string | null | undefined) {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  private normalizeUsername(raw: string | null | undefined): string {
    if (!raw) return '';
    return raw.trim().toLowerCase();
  }
}

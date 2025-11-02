import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma as PrismaNS } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@app/prisma/prisma.constants';
import { PrismaService } from '@app/prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

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
}

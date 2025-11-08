import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '@app/prisma/prisma.service';
import { FindUsersQueryDto } from './dto/find-users-query.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

/** include واحد و تایپ همگام با Prisma */
const userWithRelations = {
  include: {
    userRoles: { include: { role: true } },
    wallet: true,
  },
} satisfies Prisma.UserDefaultArgs;
export type UserWithRelations = Prisma.UserGetPayload<typeof userWithRelations>;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * لیست کاربران با جستجو و صفحه‌بندی cursor-based.
   * - مرتب‌سازی: id DESC (ساده و پایدار برای cursor)
   * - cursor: اگر داده شد، رکورد بعد از آن را برمی‌گردانیم.
   */
  async findAll(query: FindUsersQueryDto): Promise<UserWithRelations[]> {
    const take = query.limit ?? 25;

    const where: Prisma.UserWhereInput = {};
    if (query.search) {
      where.OR = [
        { username: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.user.findMany({
      where,
      include: userWithRelations.include,
      orderBy: { id: 'desc' },
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take,
    });
  }

  findById(id: string): Promise<UserWithRelations | null> {
    return this.prisma.user.findUnique({
      where: { id },
      include: userWithRelations.include,
    });
  }

  /**
   * برگرداندن کاربر فعال به‌همراه نقش‌ها.
   * اگر فیلد isActive را در schema داری، چک را اضافه کن (در حال حاضر حذف شده تا با schema فعلی خطا ندهد).
   */
  async ensureActiveWithRoles(id: string): Promise<UserWithRelations> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: userWithRelations.include,
    });

    if (!user) {
      throw new UnauthorizedException('User not found.');
    }

    // اگر isActive در schema وجود دارد، این چک را برگردان:
    // if (!user.isActive) {
    //   throw new UnauthorizedException('User account is inactive.');
    // }

    return user;
  }

  /**
   * ایجاد کاربر.
   * نکته امنیتی: برای رمز بهتره از argon2/bcrypt استفاده بشه؛ sha256 صرفاً موقت برای dev.
   */
  async create(dto: CreateUserDto): Promise<UserWithRelations> {
    const passwordHash = dto.password
      ? createHash('sha256').update(dto.password).digest('hex')
      : null;

    return this.prisma.user.create({
      data: {
        username: dto.username,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        name: dto.name ?? null,
        bio: dto.bio ?? null,
        city: dto.city ?? null,
        avatarUrl: dto.avatarUrl ?? null,
        passwordHash,
        // isActive: dto.isActive ?? true, // ← بعد از اضافه کردن به schema، این را آزاد کن
      } satisfies Prisma.UserCreateInput,
      include: userWithRelations.include,
    });
  }

  /**
   * ویرایش کاربر.
   */
  async update(id: string, dto: UpdateUserDto): Promise<UserWithRelations> {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`User ${id} was not found.`);
    }

    const data: Prisma.UserUpdateInput = {};

    if (dto.email !== undefined) data.email = dto.email ?? null;
    if (dto.phone !== undefined) data.phone = dto.phone ?? null;
    if (dto.name !== undefined) data.name = dto.name ?? null;
    if (dto.bio !== undefined) data.bio = dto.bio ?? null;
    if (dto.city !== undefined) data.city = dto.city ?? null;
    if (dto.avatarUrl !== undefined) data.avatarUrl = dto.avatarUrl ?? null;
    if (dto.username !== undefined) data.username = dto.username;

    // اگر در schema فیلد isActive موجود است:
    // if (dto.isActive !== undefined) data.isActive = dto.isActive;

    if (dto.password) {
      data.passwordHash = createHash('sha256')
        .update(dto.password)
        .digest('hex');
      // بهتر: data.passwordHash = await argon2.hash(dto.password);
    }

    return this.prisma.user.update({
      where: { id },
      data,
      include: userWithRelations.include,
    });
  }
}

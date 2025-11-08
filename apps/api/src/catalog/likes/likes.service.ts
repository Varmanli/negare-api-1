// apps/api/src/core/catalog/likes/likes.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ProductMapper,
  productInclude,
  type ProductWithRelations,
} from '../product/product.mapper';
import { Prisma } from '@prisma/client';
import { Buffer } from 'buffer';
import { LikeToggleResponseDto } from './dtos/like-toggle.dto';
import { UserLikeItemDto, UserLikesResultDto } from './dtos/likes-response.dto';

/* ---------------- Helpers ---------------- */
function encodeCursor(obj: Record<string, string | number>) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}
function decodeCursor<T>(cursor?: string | null): T | null {
  if (!cursor) return null;
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
function toBigIntOrThrow(id: string): bigint {
  if (!/^\d+$/.test(id)) throw new BadRequestException('Invalid product id');
  return BigInt(id);
}

/** Like + product include typing */
type LikeWithProduct = Prisma.LikeGetPayload<{
  include: { product: { include: typeof productInclude } };
}>;

@Injectable()
export class LikesService {
  constructor(private readonly prisma: PrismaService) {}

  /** لایک یا آن‌لایک کردن محصول */
  async toggle(
    userId: string,
    productIdStr: string,
  ): Promise<LikeToggleResponseDto> {
    const productId = toBigIntOrThrow(productIdStr);

    const existing = await this.prisma.like.findUnique({
      where: { userId_productId: { userId, productId } },
    });

    if (existing) {
      // آن‌لایک: حذف رکورد + کاهش شمارنده‌ی محصول
      await this.prisma.$transaction([
        this.prisma.like.delete({
          where: { userId_productId: { userId, productId } },
        }),
        this.prisma.product.update({
          where: { id: productId },
          data: { likesCount: { decrement: 1 } },
        }),
      ]);
      return { liked: false };
    }

    // لایک: ساخت رکورد + افزایش شمارنده‌ی محصول
    await this.prisma.$transaction([
      this.prisma.like.create({
        data: {
          product: { connect: { id: productId } },
          user: { connect: { id: userId } },
        },
      }),
      this.prisma.product.update({
        where: { id: productId },
        data: { likesCount: { increment: 1 } },
      }),
    ]);
    return { liked: true };
  }

  /** لیست محصولات لایک‌شده‌ی کاربر (Load more با cursor: createdAt, productId) */
  async listForUser(
    userId: string,
    limit = 24,
    cursor?: string,
  ): Promise<UserLikesResultDto> {
    const take = Math.min(Math.max(limit, 1), 60);

    type CursorT = { createdAt: string; productId: string };
    const c = decodeCursor<CursorT>(cursor);

    let cursorWhere: Prisma.LikeWhereInput | undefined;
    if (c) {
      const createdAt = new Date(c.createdAt);
      const pid = BigInt(c.productId);
      cursorWhere = {
        OR: [
          { createdAt: { lt: createdAt } },
          { AND: [{ createdAt: createdAt }, { productId: { lt: pid } }] },
        ],
      };
    }

    const where: Prisma.LikeWhereInput = cursorWhere
      ? { AND: [{ userId }, cursorWhere] }
      : { userId };

    const rows = await this.prisma.like.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { productId: 'desc' }], // ⬅️ به‌جای id
      take,
      include: { product: { include: productInclude } },
    });

    const typed = rows as LikeWithProduct[];

    const items: UserLikeItemDto[] = typed.map((l) => ({
      product: ProductMapper.toBrief(l.product as ProductWithRelations),
      likedAt: l.createdAt.toISOString(),
    }));

    let nextCursor: string | undefined;
    if (typed.length === take) {
      const last = typed[typed.length - 1];
      nextCursor = encodeCursor({
        createdAt: last.createdAt.toISOString(),
        productId: String(last.productId),
      });
    }

    return { items, nextCursor };
  }
}

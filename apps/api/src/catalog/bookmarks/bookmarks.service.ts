import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Buffer } from 'buffer';
import { PrismaService } from '../../prisma/prisma.service';
import { BookmarkListQueryDto } from './dtos/bookmark-query.dto';
import {
  UserBookmarkItemDto,
  UserBookmarksResultDto,
} from './dtos/bookmark-response.dto';
import {
  ProductMapper,
  productInclude,
  type ProductWithRelations,
} from '../product/product.mapper';

function toBigIntNullable(id?: string): bigint | null {
  if (!id || !/^\d+$/.test(id)) return null;
  return BigInt(id);
}

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

@Injectable()
export class BookmarksService {
  constructor(private readonly prisma: PrismaService) {}

  /* -------------------------------------------
   * Toggle bookmark for a user/product
   * ----------------------------------------- */
  async toggle(
    userId: string,
    productIdStr: string,
  ): Promise<{ bookmarked: boolean }> {
    const productId = toBigIntNullable(productIdStr);
    if (productId === null) throw new BadRequestException('Invalid product id');

    const existed = await this.prisma.bookmark.findUnique({
      where: { userId_productId: { userId, productId } },
    });

    if (existed) {
      await this.prisma.bookmark.delete({
        where: { userId_productId: { userId, productId } },
      });
      return { bookmarked: false };
    }
    await this.prisma.bookmark.create({ data: { userId, productId } });
    return { bookmarked: true };
  }

  /* -------------------------------------------
   * Remove (explicit unbookmark)
   * ----------------------------------------- */
  async remove(userId: string, productIdStr: string): Promise<void> {
    const productId = toBigIntNullable(productIdStr);
    if (productId === null) throw new BadRequestException('Invalid product id');
    await this.prisma.bookmark.deleteMany({ where: { userId, productId } });
  }

  /* -------------------------------------------
   * Check if bookmarked
   * ----------------------------------------- */
  async isBookmarked(
    userId: string,
    productIdStr: string,
  ): Promise<{ bookmarked: boolean }> {
    const productId = toBigIntNullable(productIdStr);
    if (productId === null) throw new BadRequestException('Invalid product id');
    const existed = await this.prisma.bookmark.findUnique({
      where: { userId_productId: { userId, productId } },
      select: { userId: true },
    });
    return { bookmarked: !!existed };
  }

  /* -------------------------------------------
   * List bookmarks for current user (Load more)
   * Order: newest bookmarked first
   * ----------------------------------------- */
  async listForUser(
    userId: string,
    q: BookmarkListQueryDto,
  ): Promise<UserBookmarksResultDto> {
    const limit = Math.min(Math.max(q.limit ?? 24, 1), 60);

    type CursorT = { createdAt: string; productId: string };
    const c = decodeCursor<CursorT>(q.cursor);
    let cursorWhere: Prisma.BookmarkWhereInput | undefined;

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

    const where: Prisma.BookmarkWhereInput = cursorWhere
      ? { AND: [{ userId }, cursorWhere] }
      : { userId };

    const rows = await this.prisma.bookmark.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { productId: 'desc' }],
      take: limit,
      include: { product: { include: productInclude } },
    });

    const items: UserBookmarkItemDto[] = rows.map((b) => ({
      product: ProductMapper.toBrief(b.product as ProductWithRelations),
      bookmarkedAt: b.createdAt.toISOString(),
    }));

    let nextCursor: string | undefined;
    if (rows.length === limit) {
      const last = rows[rows.length - 1];
      nextCursor = encodeCursor({
        createdAt: last.createdAt.toISOString(),
        productId: String(last.productId),
      });
    }

    return { items, nextCursor };
  }
}

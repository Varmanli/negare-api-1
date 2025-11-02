import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma as PrismaNamespace } from '@prisma/client';
import { Prisma, PrismaClientKnownRequestError } from '@app/prisma/prisma.constants';
import { PrismaService } from '@app/prisma/prisma.service';
import {
  mapProduct,
  productWithRelations,
  ProductWithRelations,
} from '../products/product.mapper';
import { ListQueryDto } from '../dtos/list-query.dto';
import {
  PaginationResult,
  clampPagination,
  toPaginationResult,
} from '../utils/pagination.util';
import { ProductResponseDto } from '../products/dtos/product-response.dto';

export interface ToggleBookmarkResult {
  bookmarked: boolean;
}

const bookmarkInclude = Prisma.validator<PrismaNamespace.BookmarkInclude>()({
  product: productWithRelations,
});

type BookmarkWithProduct = PrismaNamespace.BookmarkGetPayload<{
  include: typeof bookmarkInclude;
}>;

@Injectable()
export class BookmarksService {
  constructor(private readonly prisma: PrismaService) {}

  async toggleBookmark(
    userId: string,
    productId: string,
    desiredState?: boolean,
  ): Promise<ToggleBookmarkResult> {
    const numericId = this.ensureNumericId(productId);

    const product = await this.prisma.product.findUnique({
      where: { id: numericId },
      select: { id: true },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const bookmarkWhere: PrismaNamespace.BookmarkWhereUniqueInput = {
      userId_productId: { userId, productId: numericId },
    };

    const existing = await this.prisma.bookmark.findUnique({
      where: bookmarkWhere,
    });

    let bookmarked: boolean;

    if (desiredState === undefined) {
      bookmarked = !existing;
      if (existing) {
        await this.prisma.bookmark.delete({ where: bookmarkWhere });
      } else {
        await this.createBookmark(userId, numericId);
      }
    } else if (desiredState) {
      bookmarked = true;
      if (!existing) {
        await this.createBookmark(userId, numericId);
      }
    } else {
      bookmarked = false;
      if (existing) {
        await this.prisma.bookmark.delete({ where: bookmarkWhere });
      }
    }

    return { bookmarked };
  }

  async isBookmarked(userId: string, productId: string): Promise<boolean> {
    const numericId = this.ensureNumericId(productId);
    const bookmark = await this.prisma.bookmark.findUnique({
      where: {
        userId_productId: { userId, productId: numericId },
      },
      select: { userId: true },
    });
    return Boolean(bookmark);
  }

  async listBookmarkedProducts(
    userId: string,
    query: ListQueryDto,
  ): Promise<PaginationResult<ProductResponseDto>> {
    const { page, limit, skip } = clampPagination(query.page, query.limit);

    const [total, bookmarks] = (await this.prisma.$transaction([
      this.prisma.bookmark.count({ where: { userId } }),
      this.prisma.bookmark.findMany({
        where: { userId },
        orderBy: [
          { createdAt: 'desc' },
          { productId: 'desc' },
        ],
        skip,
        take: limit,
        include: bookmarkInclude,
      }),
    ])) as [number, BookmarkWithProduct[]];

    const data = bookmarks
      .map((bookmark) => bookmark.product)
      .filter((product): product is ProductWithRelations => Boolean(product))
      .map((product) => Object.assign(mapProduct(product), { bookmarked: true }));

    return toPaginationResult(data, total, page, limit);
  }

  private ensureNumericId(productId: string): bigint {
    if (!/^\d+$/.test(productId)) {
      throw new BadRequestException('Product id must be numeric');
    }
    return BigInt(productId);
  }

  private async createBookmark(userId: string, productId: bigint): Promise<void> {
    try {
      await this.prisma.bookmark.create({
        data: {
          userId,
          productId,
        },
      });
    } catch (error) {
      if (
        error instanceof PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return;
      }
      throw error;
    }
  }
}

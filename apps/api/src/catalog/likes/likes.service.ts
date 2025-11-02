import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma as PrismaNamespace } from '@prisma/client';
import { Prisma, PrismaClientKnownRequestError } from '@app/prisma/prisma.constants';
import { PrismaService } from '@app/prisma/prisma.service';
import {
  clampPagination,
  PaginationResult,
  toPaginationResult,
} from '../utils/pagination.util';
import { ListQueryDto } from '../dtos/list-query.dto';
import {
  mapProduct,
  productWithRelations,
  ProductWithRelations,
} from '../products/product.mapper';
import { ProductResponseDto } from '../products/dtos/product-response.dto';

export interface ToggleLikeResult {
  liked: boolean;
  likesCount: number;
}

const likeInclude = Prisma.validator<PrismaNamespace.LikeInclude>()({
  product: productWithRelations,
});

type LikeWithProduct = PrismaNamespace.LikeGetPayload<{
  include: typeof likeInclude;
}>;

@Injectable()
export class LikesService {
  constructor(private readonly prisma: PrismaService) {}

  async toggleLike(
    userId: string,
    productId: string,
    desiredState?: boolean,
  ): Promise<ToggleLikeResult> {
    const numericId = this.ensureNumericId(productId);

    return this.prisma.$transaction(
      async (tx) => {
        const product = await tx.product.findUnique({
          where: { id: numericId },
          select: { id: true },
        });

        if (!product) {
          throw new NotFoundException('Product not found');
        }

        const likeWhere: PrismaNamespace.LikeWhereUniqueInput = {
          userId_productId: { userId, productId: numericId },
        };

        const existing = await tx.like.findUnique({ where: likeWhere });

        let liked: boolean;

        if (desiredState === undefined) {
          liked = !existing;
          if (existing) {
            await tx.like.delete({ where: likeWhere });
            await this.adjustLikesCount(tx, numericId, -1);
          } else {
            await this.createLike(tx, userId, numericId);
            await this.adjustLikesCount(tx, numericId, 1);
          }
        } else if (desiredState) {
          liked = true;
          if (!existing) {
            await this.createLike(tx, userId, numericId);
            await this.adjustLikesCount(tx, numericId, 1);
          }
        } else {
          liked = false;
          if (existing) {
            await tx.like.delete({ where: likeWhere });
            await this.adjustLikesCount(tx, numericId, -1);
          }
        }

        const refreshed = await tx.product.findUnique({
          where: { id: numericId },
          select: { likesCount: true },
        });

        return {
          liked,
          likesCount: refreshed?.likesCount ?? 0,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async isProductLiked(userId: string, productId: string): Promise<boolean> {
    const numericId = this.ensureNumericId(productId);
    const like = await this.prisma.like.findUnique({
      where: { userId_productId: { userId, productId: numericId } },
      select: { userId: true },
    });
    return Boolean(like);
  }

  async listLikedProducts(
    userId: string,
    query: ListQueryDto,
  ): Promise<PaginationResult<ProductResponseDto>> {
    const { page, limit, skip } = clampPagination(query.page, query.limit);

    const [total, likes] = (await this.prisma.$transaction([
      this.prisma.like.count({ where: { userId } }),
      this.prisma.like.findMany({
        where: { userId },
        orderBy: [
          { createdAt: 'desc' },
          { productId: 'desc' },
        ],
        skip,
        take: limit,
        include: likeInclude,
      }),
    ])) as [number, LikeWithProduct[]];

    const data = likes
      .map((like) => like.product)
      .filter((product): product is ProductWithRelations => Boolean(product))
      .map((product) => Object.assign(mapProduct(product), { liked: true }));

    return toPaginationResult(data, total, page, limit);
  }

  private ensureNumericId(productId: string): bigint {
    if (!/^\d+$/.test(productId)) {
      throw new BadRequestException('Product id must be numeric');
    }
    return BigInt(productId);
  }

  private async createLike(
    tx: PrismaNamespace.TransactionClient,
    userId: string,
    productId: bigint,
  ): Promise<void> {
    try {
      await tx.like.create({
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

  private async adjustLikesCount(
    tx: PrismaNamespace.TransactionClient,
    productId: bigint,
    delta: number,
  ): Promise<void> {
    if (delta >= 0) {
      const data: PrismaNamespace.ProductUpdateInput = {};
      (data as Record<string, unknown>).likesCount = { increment: delta };
      await tx.product.update({
        where: { id: productId },
        data,
      });
      return;
    }

    const absoluteDelta = Math.abs(delta);
    const where: PrismaNamespace.ProductWhereInput = { id: productId };
    (where as Record<string, unknown>).likesCount = { gte: absoluteDelta };

    const decrementData: PrismaNamespace.ProductUpdateManyMutationInput = {};
    (decrementData as Record<string, unknown>).likesCount = {
      decrement: absoluteDelta,
    };

    const updated = await tx.product.updateMany({
      where,
      data: decrementData,
    });

    if (updated.count === 0) {
      const resetData: PrismaNamespace.ProductUpdateInput = {};
      (resetData as Record<string, unknown>).likesCount = 0;
      await tx.product.update({
        where: { id: productId },
        data: resetData,
      });
    }
  }
}

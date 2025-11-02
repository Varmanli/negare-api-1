import { Injectable, Logger } from '@nestjs/common';
import type { Prisma as PrismaNamespace } from '@prisma/client';
import { Prisma, PrismaClientKnownRequestError } from '@app/prisma/prisma.constants';
import { PrismaService } from '@app/prisma/prisma.service';

@Injectable()
export class CountersService {
  private readonly logger = new Logger(CountersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async incrementViews(productId: string): Promise<void> {
    await this.incrementColumn(productId, 'viewsCount', 1);
  }

  async incrementDownloads(productId: string): Promise<void> {
    await this.incrementColumn(productId, 'downloadsCount', 1);
  }

  async incrementLikes(productId: string): Promise<void> {
    await this.incrementColumn(productId, 'likesCount', 1);
  }

  async decrementLikes(productId: string): Promise<void> {
    await this.incrementColumn(productId, 'likesCount', -1);
  }

  private async incrementColumn(
    productId: string,
    column: 'viewsCount' | 'downloadsCount' | 'likesCount',
    delta: number,
  ): Promise<void> {
    try {
      const id = BigInt(productId);

      if (delta >= 0) {
        const data: PrismaNamespace.ProductUpdateInput = {};
        (data as Record<string, unknown>)[column] = { increment: delta };
        await this.prisma.product.update({
          where: { id },
          data,
        });
        return;
      }

      const absoluteDelta = Math.abs(delta);
      const decrementData: PrismaNamespace.ProductUpdateManyMutationInput = {};
      (decrementData as Record<string, unknown>)[column] = {
        decrement: absoluteDelta,
      };

      const where: PrismaNamespace.ProductWhereInput = { id };
      (where as Record<string, unknown>)[column] = { gte: absoluteDelta };

      const updated = await this.prisma.product.updateMany({
        where,
        data: decrementData,
      });

      if (updated.count === 0) {
        const resetData: PrismaNamespace.ProductUpdateInput = {};
        (resetData as Record<string, unknown>)[column] = 0;
        await this.prisma.product.update({
          where: { id },
          data: resetData,
        });
      }
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError) {
        this.logger.error(
          `Prisma error adjusting ${column} for product ${productId}: ${error.code}`,
        );
      }
      this.logger.error(
        `Failed to adjust ${column} for product ${productId}`,
        (error as Error).stack,
      );
      throw error;
    }
  }
}

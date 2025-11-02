import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { PricingType } from '@app/prisma/prisma.constants';
import { PrismaService } from '@app/prisma/prisma.service';
import { CountersService } from '../counters/counters.service';
import { StorageService } from '../storage/storage.service';

const DAILY_CAP = 15;
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

export interface DownloadResult {
  stream: NodeJS.ReadableStream;
  filename?: string | null;
  mimeType?: string | null;
  size?: number;
  downloadsCount: number;
}

@Injectable()
export class DownloadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly countersService: CountersService,
    private readonly storageService: StorageService,
  ) {}

  async enforceDailyCap(userId: string): Promise<void> {
    const windowStart = new Date(Date.now() - TWENTY_FOUR_HOURS);

    const downloadCount = await this.prisma.productDownload.count({
      where: {
        userId,
        createdAt: { gte: windowStart },
      },
    });

    if (downloadCount >= DAILY_CAP) {
      throw new HttpException(
        'Daily download limit reached. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async downloadProduct(
    productId: string,
    userId?: string,
  ): Promise<DownloadResult> {
    if (!userId) {
      throw new UnauthorizedException(
        'Authentication is required to download this product',
      );
    }

    const numericId = this.ensureNumericId(productId);

    const product = await this.prisma.product.findUnique({
      where: { id: numericId },
      select: {
        id: true,
        pricingType: true,
        downloadsCount: true,
        file: {
          select: {
            id: true,
            storageKey: true,
            originalName: true,
            size: true,
            mimeType: true,
            createdAt: true,
          },
        },
      },
    });

    if (!product || !product.file) {
      throw new NotFoundException('Product file not found');
    }

    await this.enforceDailyCap(userId);
    await this.checkPricingRequirements(
      { id: product.id, pricingType: product.pricingType },
      userId,
    );

    await this.prisma.productDownload.create({
      data: {
        productId: numericId,
        userId,
      },
    });

    await this.countersService.incrementDownloads(productId);

    const refreshed = await this.prisma.product.findUnique({
      where: { id: numericId },
      select: { downloadsCount: true },
    });

    const stream = this.storageService.getDownloadStream(
      product.file.storageKey,
    );
    const downloadsCount =
      refreshed?.downloadsCount ?? product.downloadsCount + 1;

    return {
      stream,
      filename: product.file.originalName ?? null,
      mimeType: product.file.mimeType ?? null,
      size: product.file.size ? Number(product.file.size) : undefined,
      downloadsCount,
    };
  }

  private async checkPricingRequirements(
    product: { id: bigint; pricingType: PricingType },
    userId: string,
  ): Promise<void> {
    switch (product.pricingType) {
      case PricingType.PAID: {
        const owns = await this.checkPaidOwnership(userId, product.id);
        if (!owns) {
          throw new ForbiddenException(
            'Purchase required to download this product.',
          );
        }
        break;
      }
      case PricingType.SUBSCRIPTION:
      case PricingType.PAID_OR_SUBSCRIPTION: {
        const active = await this.checkActiveSubscription(userId);
        if (!active) {
          throw new ForbiddenException(
            'Active subscription required to download this product.',
          );
        }
        break;
      }
      default:
        break;
    }
  }

  private async checkPaidOwnership(
    userId: string,
    productId: bigint,
  ): Promise<boolean> {
    void userId;
    void productId;
    return true;
  }

  private async checkActiveSubscription(userId: string): Promise<boolean> {
    void userId;
    return true;
  }

  private ensureNumericId(productId: string): bigint {
    if (!/^\d+$/.test(productId)) {
      throw new BadRequestException('Product id must be numeric');
    }
    return BigInt(productId);
  }
}

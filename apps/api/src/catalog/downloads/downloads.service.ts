import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Buffer } from 'buffer';
import { PrismaService } from '../../prisma/prisma.service';
import { CountersService } from '../counters/counters.service';
import { DownloadStartDto } from './dtos/download-start.dto';
import {
  DownloadCreatedDto,
  UserDownloadItemDto,
  UserDownloadsResultDto,
} from './dtos/download-response.dto';
import {
  ProductMapper,
  productInclude,
  type ProductWithRelations,
} from '../product/product.mapper';
import { StorageService } from '../storage/storage.service';

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

@Injectable()
export class DownloadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly counters: CountersService,
    private readonly storage: StorageService, // LocalStorageService در ماژول bind شده
  ) {}

  /**
   * ثبت دانلود برای کاربر و (در صورت وجود فایل) برگرداندن URL دانلود
   * این متد کنترل دسترسی/قیمت‌گذاری را ساده فرض می‌کند؛ اگر Paywall داری همین‌جا چک کن.
   */
  async start(
    userId: string,
    productIdStr: string,
    dto: DownloadStartDto,
  ): Promise<DownloadCreatedDto> {
    const productId = toBigIntOrThrow(productIdStr);

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { file: true },
    });
    if (!product) throw new NotFoundException('Product not found');

    // افزایش شمارنده
    await this.counters.bump(productId, 'downloads', 1);

    // ✅ ساخت رکورد دانلود با connect روابط (نه با productId/userId مستقیم)
    await this.prisma.productDownload.create({
      data: {
        product: { connect: { id: productId } },
        user: { connect: { id: userId } },
        // اگر مدل این فیلدها رو داره
        ...(dto.bytes !== undefined ? { bytes: BigInt(dto.bytes) } : {}),
        ...(dto.pricePaid !== undefined ? { pricePaid: dto.pricePaid } : {}),
      },
    });

    // ✅ لینک دانلود
    let url: string | undefined;
    if (product.file?.storageKey) {
      url = await this.storage.getDownloadUrl(product.file.storageKey);
    }

    return { url };
  }

  /** لیست دانلودهای کاربر (cursor: createdAt,id) newest-first */
  async listForUser(
    userId: string,
    limit = 24,
    cursor?: string,
  ): Promise<UserDownloadsResultDto> {
    const take = Math.min(Math.max(limit, 1), 60);

    type CursorT = { createdAt: string; id: string };
    const c = decodeCursor<CursorT>(cursor);
    let cursorWhere: Prisma.ProductDownloadWhereInput | undefined;

    if (c) {
      const createdAt = new Date(c.createdAt);
      const id = BigInt(c.id);
      cursorWhere = {
        OR: [
          { createdAt: { lt: createdAt } },
          { AND: [{ createdAt: createdAt }, { id: { lt: id } }] },
        ],
      };
    }

    const where: Prisma.ProductDownloadWhereInput = cursorWhere
      ? { AND: [{ userId }, cursorWhere] }
      : { userId };

    const rows = await this.prisma.productDownload.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      include: { product: { include: productInclude } },
    });

    const items: UserDownloadItemDto[] = rows.map((d) => ({
      product: ProductMapper.toBrief(d.product as ProductWithRelations),
      downloadedAt: d.createdAt.toISOString(),
      bytes:
        d.bytes !== null && d.bytes !== undefined ? Number(d.bytes) : undefined,
      pricePaid: d.pricePaid ?? undefined,
    }));

    let nextCursor: string | undefined;
    if (rows.length === take) {
      const last = rows[rows.length - 1];
      nextCursor = encodeCursor({
        createdAt: last.createdAt.toISOString(),
        id: String(last.id),
      });
    }

    return { items, nextCursor };
  }
}

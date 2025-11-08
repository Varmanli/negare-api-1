// apps/api/src/core/catalog/product/product.service.ts
import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  PricingType,
  ProductStatus,
  GraphicFormat,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Buffer } from 'buffer';

import { CreateProductDto } from './dtos/product-create.dto';
import { UpdateProductDto } from './dtos/product-update.dto';
import { ProductFindQueryDto, ProductSort } from './dtos/product-query.dto';
import {
  ProductBriefDto,
  ProductDetailDto,
  ProductListResultDto,
} from './dtos/product-response.dto';

import {
  ProductMapper,
  productInclude,
  type ProductWithRelations,
} from './product.mapper';

/* ============================================================
 * انواع کمکی (بدون any)
 * ========================================================== */
export type Actor = { id: string; isAdmin: boolean };

/* ============================================================
 * ابزارهای کمکی: cursor, تبدیل‌ها، و …
 * ========================================================== */
function encodeCursor(obj: Record<string, string | number>): string {
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
function uniq<T>(arr: T[] | null | undefined): T[] {
  if (!arr) return [];
  return Array.from(new Set(arr));
}
function toBigIntNullable(id?: string): bigint | null {
  if (!id) return null;
  if (!/^\d+$/.test(id)) return null;
  return BigInt(id);
}

/** جستجوی ساده روی title/description/topic/slug */
function makeTextWhere(q?: string): Prisma.ProductWhereInput | undefined {
  if (!q) return undefined;
  const term = q.trim();
  if (!term) return undefined;
  return {
    OR: [
      { title: { contains: term, mode: 'insensitive' } },
      { description: { contains: term, mode: 'insensitive' } },
      { topic: { contains: term, mode: 'insensitive' } },
      { slug: { contains: term, mode: 'insensitive' } },
    ],
  };
}

/* ============================================================
 * Service
 * ========================================================== */
@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

  /* ------------------------------
   * Create
   * ---------------------------- */
  async create(dto: CreateProductDto, actor: Actor): Promise<ProductDetailDto> {
    const authorIds = uniq(dto.authorIds ?? []);
    if (authorIds.length === 0) authorIds.push(actor.id);
    if (authorIds.length > 3) {
      throw new BadRequestException('A product can have at most 3 authors.');
    }

    const created = await this.prisma.product.create({
      data: {
        slug: dto.slug,
        title: dto.title,
        description: dto.description ?? null,

        coverUrl: dto.coverUrl ?? null,
        // ✅ nested relation برای فایل
        ...(dto.fileId
          ? { file: { connect: { id: BigInt(dto.fileId) } } }
          : {}),

        topic: dto.topic ?? null,
        graphicFormat: dto.graphicFormat as GraphicFormat,

        // SEO
        seoTitle: dto.seoTitle ?? null,
        seoDescription: dto.seoDescription ?? null,
        seoKeywords: dto.seoKeywords ?? [],

        // قیمت/انتشار
        pricingType: dto.pricingType as PricingType,
        price:
          dto.price !== undefined && dto.price !== null
            ? new Prisma.Decimal(dto.price)
            : null,
        status: (dto.status ?? ProductStatus.DRAFT) as ProductStatus,
        publishedAt: dto.publishedAt ? new Date(dto.publishedAt) : null,

        // روابط
        supplierLinks: {
          create: authorIds.map((userId) => ({ userId })),
        },
        categoryLinks: {
          create: uniq(dto.categoryIds ?? []).map((cid) => ({
            categoryId: BigInt(cid),
          })),
        },
        tagLinks: {
          create: uniq(dto.tagIds ?? []).map((tid) => ({
            tagId: BigInt(tid),
          })),
        },
      },
      include: productInclude,
    });

    return ProductMapper.toDetail(created as ProductWithRelations);
  }

  /* ------------------------------
   * Update
   * ---------------------------- */
  async update(
    idOrSlug: string,
    dto: UpdateProductDto,
    actor: Actor,
  ): Promise<ProductDetailDto> {
    const product = await this.getByIdOrSlugStrict(idOrSlug);

    if (!(await this.canEdit(product.id, actor))) {
      throw new ForbiddenException('You are not allowed to edit this product.');
    }
    if (dto.authorIds && uniq(dto.authorIds).length > 3) {
      throw new BadRequestException('A product can have at most 3 authors.');
    }

    const data: Prisma.ProductUpdateInput = {
      slug: dto.slug ?? undefined,
      title: dto.title ?? undefined,
      description: dto.description ?? undefined,
      coverUrl: dto.coverUrl ?? undefined,
      topic: dto.topic ?? undefined,
      seoTitle: dto.seoTitle ?? undefined,
      seoDescription: dto.seoDescription ?? undefined,
      seoKeywords: dto.seoKeywords ? { set: dto.seoKeywords } : undefined,
      pricingType: dto.pricingType ?? undefined,
      price:
        dto.price !== undefined
          ? dto.price === null
            ? null
            : new Prisma.Decimal(dto.price)
          : undefined,
      status: dto.status ?? undefined,
      publishedAt: dto.publishedAt ? new Date(dto.publishedAt) : undefined,
      graphicFormat: dto.graphicFormat ?? undefined,

      // ✅ مدیریت رابطه فایل
      ...(dto.fileId === undefined
        ? {}
        : dto.fileId
          ? { file: { connect: { id: BigInt(dto.fileId) } } }
          : { file: { disconnect: true } }),
    };

    const updated = await this.prisma.$transaction(async (trx) => {
      if (dto.authorIds) {
        const authors = uniq(dto.authorIds);
        await trx.productSupplier.deleteMany({
          where: { productId: product.id },
        });
        if (authors.length > 0) {
          await trx.productSupplier.createMany({
            data: authors.map((userId) => ({ productId: product.id, userId })),
            skipDuplicates: true,
          });
        }
      }

      if (dto.categoryIds) {
        const categoryIds = uniq(dto.categoryIds).map((cid) => BigInt(cid));
        await trx.productCategory.deleteMany({
          where: {
            productId: product.id,
            NOT: { categoryId: { in: categoryIds } },
          },
        });
        const existing = await trx.productCategory.findMany({
          where: { productId: product.id },
          select: { categoryId: true },
        });
        const existingIds = new Set(existing.map((x) => x.categoryId));
        const toCreate = categoryIds.filter((id) => !existingIds.has(id));
        if (toCreate.length > 0) {
          await trx.productCategory.createMany({
            data: toCreate.map((categoryId) => ({
              productId: product.id,
              categoryId,
            })),
            skipDuplicates: true,
          });
        }
      }

      if (dto.tagIds) {
        const tagIds = uniq(dto.tagIds).map((tid) => BigInt(tid));
        await trx.productTag.deleteMany({
          where: { productId: product.id, NOT: { tagId: { in: tagIds } } },
        });
        const existing = await trx.productTag.findMany({
          where: { productId: product.id },
          select: { tagId: true },
        });
        const existingIds = new Set(existing.map((x) => x.tagId));
        const toCreate = tagIds.filter((id) => !existingIds.has(id));
        if (toCreate.length > 0) {
          await trx.productTag.createMany({
            data: toCreate.map((tagId) => ({ productId: product.id, tagId })),
            skipDuplicates: true,
          });
        }
      }

      return trx.product.update({
        where: { id: product.id },
        data,
        include: productInclude,
      });
    });

    return ProductMapper.toDetail(updated as ProductWithRelations);
  }

  /* ------------------------------
   * FindOne
   * ---------------------------- */
  async findOne(
    idOrSlug: string,
    viewerId?: string,
  ): Promise<ProductDetailDto> {
    const prod = await this.prisma.product.findFirst({
      where: this.idOrSlugWhere(idOrSlug),
      include: productInclude,
    });
    if (!prod) throw new NotFoundException('Product not found');
    return ProductMapper.toDetail(prod as ProductWithRelations);
  }

  /* ------------------------------
   * FindAll — Load More with cursor
   * ---------------------------- */
  async findAll(query: ProductFindQueryDto): Promise<ProductListResultDto> {
    const limit = Math.min(Math.max(query.limit ?? 24, 1), 60);
    const sort: ProductSort = (query.sort ?? 'latest') as ProductSort;

    const ands: Prisma.ProductWhereInput[] = [];
    const text = makeTextWhere(query.q);
    if (text) ands.push(text);

    if (query.pricingType)
      ands.push({ pricingType: query.pricingType as PricingType });
    if (query.graphicFormat)
      ands.push({ graphicFormat: query.graphicFormat as GraphicFormat });
    if (query.status) ands.push({ status: query.status as ProductStatus });

    if (query.categoryId) {
      const cid = toBigIntNullable(query.categoryId);
      if (cid) ands.push({ categoryLinks: { some: { categoryId: cid } } });
    }
    if (query.tagId) {
      const tid = toBigIntNullable(query.tagId);
      if (tid) ands.push({ tagLinks: { some: { tagId: tid } } });
    }
    if (query.authorId)
      ands.push({ supplierLinks: { some: { userId: query.authorId } } });

    const baseWhere: Prisma.ProductWhereInput = ands.length
      ? { AND: ands }
      : {};

    type LatestCursor = { createdAt: string; id: string };
    type CountCursor = { primary: number; id: string };

    let orderBy: Prisma.ProductOrderByWithRelationInput[] = [];
    let cursorWhere: Prisma.ProductWhereInput | undefined;

    if (sort === 'latest') {
      orderBy = [{ createdAt: 'desc' }, { id: 'desc' }];
      const c = decodeCursor<LatestCursor>(query.cursor);
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
    } else if (sort === 'popular') {
      orderBy = [
        { downloadsCount: 'desc' },
        { likesCount: 'desc' },
        { id: 'desc' },
      ];
      const c = decodeCursor<CountCursor>(query.cursor);
      if (c) {
        const primary = Number(c.primary);
        const id = BigInt(c.id);
        cursorWhere = {
          OR: [
            { downloadsCount: { lt: primary } },
            { AND: [{ downloadsCount: primary }, { id: { lt: id } }] },
          ],
        };
      }
    } else if (sort === 'viewed') {
      orderBy = [{ viewsCount: 'desc' }, { id: 'desc' }];
      const c = decodeCursor<CountCursor>(query.cursor);
      if (c) {
        const primary = Number(c.primary);
        const id = BigInt(c.id);
        cursorWhere = {
          OR: [
            { viewsCount: { lt: primary } },
            { AND: [{ viewsCount: primary }, { id: { lt: id } }] },
          ],
        };
      }
    } else if (sort === 'liked') {
      orderBy = [{ likesCount: 'desc' }, { id: 'desc' }];
      const c = decodeCursor<CountCursor>(query.cursor);
      if (c) {
        const primary = Number(c.primary);
        const id = BigInt(c.id);
        cursorWhere = {
          OR: [
            { likesCount: { lt: primary } },
            { AND: [{ likesCount: primary }, { id: { lt: id } }] },
          ],
        };
      }
    }

    const finalWhere: Prisma.ProductWhereInput = cursorWhere
      ? { AND: [baseWhere, cursorWhere] }
      : baseWhere;

    const rows = await this.prisma.product.findMany({
      where: finalWhere,
      orderBy,
      take: limit,
      include: productInclude,
    });

    const items: ProductBriefDto[] = (rows as ProductWithRelations[]).map(
      ProductMapper.toBrief,
    );

    let nextCursor: string | undefined;
    if (rows.length === limit) {
      const last = rows[rows.length - 1] as ProductWithRelations;
      if (sort === 'latest') {
        nextCursor = encodeCursor({
          createdAt: last.createdAt.toISOString(),
          id: String(last.id),
        });
      } else if (sort === 'popular') {
        nextCursor = encodeCursor({
          primary: last.downloadsCount,
          id: String(last.id),
        });
      } else if (sort === 'viewed') {
        nextCursor = encodeCursor({
          primary: last.viewsCount,
          id: String(last.id),
        });
      } else if (sort === 'liked') {
        nextCursor = encodeCursor({
          primary: last.likesCount,
          id: String(last.id),
        });
      }
    }

    return { items, nextCursor };
  }

  /* ------------------------------
   * Remove (Archive)
   * ---------------------------- */
  async remove(idOrSlug: string, actor: Actor): Promise<ProductDetailDto> {
    const product = await this.getByIdOrSlugStrict(idOrSlug);
    if (!(await this.canEdit(product.id, actor))) {
      throw new ForbiddenException(
        'You are not allowed to remove this product.',
      );
    }
    const updated = await this.prisma.product.update({
      where: { id: product.id },
      data: { status: ProductStatus.ARCHIVED },
      include: productInclude,
    });
    return ProductMapper.toDetail(updated as ProductWithRelations);
  }

  /* ------------------------------
   * Toggle Like
   * ---------------------------- */
  async toggleLike(
    productIdStr: string,
    userId: string,
  ): Promise<{ liked: boolean }> {
    const productId = toBigIntNullable(productIdStr);
    if (productId === null) throw new BadRequestException('Invalid product id');

    const existed = await this.prisma.like.findUnique({
      where: { userId_productId: { userId, productId } },
    });

    if (existed) {
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

    await this.prisma.$transaction([
      this.prisma.like.create({ data: { userId, productId } }),
      this.prisma.product.update({
        where: { id: productId },
        data: { likesCount: { increment: 1 } },
      }),
    ]);
    return { liked: true };
  }

  /* ------------------------------
   * Toggle Bookmark
   * ---------------------------- */
  async toggleBookmark(
    productIdStr: string,
    userId: string,
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

  /* ------------------------------
   * Increment View (analytics-lite)
   * ---------------------------- */
  async incrementView(
    productId: bigint,
    viewerId?: string,
    ip?: string,
    ua?: string,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.product.update({
        where: { id: productId },
        data: { viewsCount: { increment: 1 } },
      }),
      this.prisma.productView.create({
        data: {
          productId,
          userId: viewerId ?? undefined,
          ip: ip ?? null,
          ua: ua ?? null,
        },
      }),
    ]);
  }

  /* ------------------------------
   * Register Download (and count)
   * ---------------------------- */
  async registerDownload(
    productIdStr: string,
    userId: string,
    bytes?: number,
    pricePaid?: number,
    ip?: string,
  ): Promise<void> {
    const productId = toBigIntNullable(productIdStr);
    if (productId === null) throw new BadRequestException('Invalid product id');

    await this.prisma.$transaction([
      this.prisma.product.update({
        where: { id: productId },
        data: { downloadsCount: { increment: 1 } },
      }),
      this.prisma.productDownload.create({
        data: {
          productId,
          userId,
          bytes: bytes !== undefined ? BigInt(bytes) : null,
          pricePaid: pricePaid ?? null,
          ip: ip ?? null,
        },
      }),
    ]);
  }

  /* ============================================================
   * Helpers
   * ========================================================== */

  private async canEdit(productId: bigint, actor: Actor): Promise<boolean> {
    if (actor.isAdmin) return true;
    const link = await this.prisma.productSupplier.findFirst({
      where: { productId, userId: actor.id },
      select: { productId: true },
    });
    return !!link;
  }

  private async getByIdOrSlugStrict(idOrSlug: string) {
    const where = this.idOrSlugWhere(idOrSlug);
    const prod = await this.prisma.product.findFirst({
      where,
      include: productInclude,
    });
    if (!prod) throw new NotFoundException('Product not found');
    return prod as ProductWithRelations;
  }

  private idOrSlugWhere(idOrSlug: string): Prisma.ProductWhereInput {
    if (/^\d+$/.test(idOrSlug)) {
      return { id: BigInt(idOrSlug) };
    }
    return { slug: idOrSlug };
  }
}

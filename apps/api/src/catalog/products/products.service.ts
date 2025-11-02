import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma as PrismaNamespace } from '@prisma/client';
import { Prisma, PricingType, JsonNull } from '@app/prisma/prisma.constants';
import { CurrentUserPayload } from '@app/common/decorators/current-user.decorator';
import { PrismaService } from '@app/prisma/prisma.service';
import { CountersService } from '../counters/counters.service';
import { LikesService } from '../likes/likes.service';
import { BookmarksService } from '../bookmarks/bookmarks.service';
import { StorageService, UploadedFile } from '../storage/storage.service';
import { ProductDetailResponseDto } from './dtos/product-detail-response.dto';
import { CreateProductDto } from './dtos/create-product.dto';
import { UpdateProductDto } from './dtos/update-product.dto';
import {
  ListProductsQueryDto,
  ProductSortOption,
} from './dtos/list-products-query.dto';
import {
  mapProduct,
  mapProductDetail,
  productWithRelations,
  ProductWithRelations,
} from './product.mapper';
import { ProductResponseDto } from './dtos/product-response.dto';
import { ProductFileResponseDto } from './dtos/product-file-response.dto';
import {
  PaginationResult,
  clampPagination,
  toPaginationResult,
} from '../utils/pagination.util';
import { isAdmin, isSupplier } from '../policies/catalog.policies';
import { buildUniqueSlugCandidate, slugify } from '../utils/slug.util';

@Injectable()
export class ProductsService {
  private readonly slugMaxAttempts = 10;

  constructor(
    private readonly prisma: PrismaService,
    private readonly countersService: CountersService,
    private readonly likesService: LikesService,
    private readonly bookmarksService: BookmarksService,
    private readonly storageService: StorageService,
  ) {}

  async listProducts(
    query: ListProductsQueryDto,
  ): Promise<PaginationResult<ProductResponseDto>> {
    const { page, limit, skip } = clampPagination(query.page, query.limit);
    const where = this.buildWhere(query);
    const orderBy = this.buildOrder(query.sort);

    const [total, products] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        ...productWithRelations,
        where,
        orderBy,
        skip,
        take: limit,
      }),
    ]);

    const data = products.map((product) => mapProduct(product));

    return toPaginationResult(data, total, page, limit);
  }

  async findByIdOrSlug(idOrSlug: string): Promise<ProductWithRelations> {
    const where: PrismaNamespace.ProductWhereInput = /^\d+$/.test(idOrSlug)
      ? { id: BigInt(idOrSlug) }
      : { slug: idOrSlug };

    return this.findProductOrThrow(where);
  }

  async recordView(
    productId: bigint,
    options: {
      currentUser?: CurrentUserPayload;
      ip?: string;
      userAgent?: string;
    },
  ): Promise<void> {
    const { currentUser, ip, userAgent } = options;

    await this.prisma.productView.create({
      data: {
        productId,
        userId: currentUser?.id ?? null,
        ip: ip ?? null,
        ua: userAgent ?? null,
      },
    });

    await this.countersService.incrementViews(productId.toString());
  }

  async decorateProductWithUserState(
    product: ProductWithRelations,
    currentUser?: CurrentUserPayload,
  ): Promise<ProductDetailResponseDto> {
    if (!currentUser) {
      return mapProductDetail(product, false, false);
    }

    const [liked, bookmarked] = await Promise.all([
      this.likesService.isProductLiked(currentUser.id, product.id.toString()),
      this.bookmarksService.isBookmarked(currentUser.id, product.id.toString()),
    ]);

    return mapProductDetail(product, liked, bookmarked);
  }

  async attachOrReplaceFile(
    productId: string,
    file: UploadedFile,
  ): Promise<ProductFileResponseDto> {
    if (!file) {
      throw new BadRequestException('File payload is required');
    }

    const id = this.ensureNumericId(productId);

    const product = await this.prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
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

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const existingFile = product.file;
    const stored = await this.storageService.saveUploadedFile(file);

    const fallbackSize =
      typeof file.size === 'number'
        ? file.size
        : file.buffer && Buffer.isBuffer(file.buffer)
          ? file.buffer.length
          : undefined;
    const derivedSize = stored.size ?? fallbackSize;
    const sizeValue =
      derivedSize !== undefined ? BigInt(Math.max(derivedSize, 0)) : null;

    let savedFile: {
      id: bigint;
      storageKey: string;
      originalName: string | null;
      size: bigint | null;
      mimeType: string | null;
      createdAt: Date;
    };

    try {
      savedFile = await this.prisma.$transaction(async (tx) => {
        const baseData = {
          storageKey: stored.storageKey,
          originalName:
            stored.originalName ??
            file.originalname ??
            existingFile?.originalName ??
            null,
          size: sizeValue,
          mimeType:
            stored.mimeType ?? file.mimetype ?? existingFile?.mimeType ?? null,
          meta: (stored.meta as PrismaNamespace.JsonValue | undefined) ?? JsonNull,
        };

        if (existingFile) {
          const updated = await tx.productFile.update({
            where: { id: existingFile.id },
            data: baseData,
          });
          return updated;
        }

        const created = await tx.productFile.create({
          data: {
            ...baseData,
            createdAt: new Date(),
          },
        });

        await tx.product.update({
          where: { id: product.id },
          data: { fileId: created.id },
        });

        return created;
      });
    } catch (error) {
      await this.storageService
        .deleteFile(stored.storageKey)
        .catch(() => undefined);
      throw error;
    }

    if (
      existingFile?.storageKey &&
      existingFile.storageKey !== stored.storageKey
    ) {
      await this.storageService
        .deleteFile(existingFile.storageKey)
        .catch(() => undefined);
    }

    const response = new ProductFileResponseDto();
    response.id = savedFile.id.toString();
    response.originalName = savedFile.originalName;
    response.size = savedFile.size ? Number(savedFile.size) : undefined;
    response.mimeType = savedFile.mimeType;
    response.createdAt = savedFile.createdAt;

    return response;
  }

  async createProduct(
    dto: CreateProductDto,
    currentUser: CurrentUserPayload,
  ): Promise<ProductDetailResponseDto> {
    const slug = await this.resolveUniqueSlug(dto.slug ?? slugify(dto.title));
    this.validatePricing(dto.pricingType, dto.price);

    const categoryIds = await this.resolveCategoryIds(dto.categories);
    const tagIds = await this.resolveTagIds(dto.tags);
    const supplierIds = await this.resolveSupplierIds(
      dto.suppliers,
      currentUser,
    );

    const product = await this.prisma.product.create({
      data: {
        slug,
        title: dto.title,
        description: dto.description ?? null,
        coverUrl: dto.coverUrl ?? null,
        pricingType: dto.pricingType,
        price: dto.price ?? null,
        active: dto.active ?? true,
        publishedAt: dto.publishedAt ? new Date(dto.publishedAt) : null,
        assets: dto.assets?.length
          ? {
              create: dto.assets.map((asset, index) => ({
                url: asset.url,
                alt: asset.alt ?? null,
                order: asset.order ?? index,
              })),
            }
          : undefined,
        categoryLinks: categoryIds.length
          ? {
              create: categoryIds.map((id) => ({
                category: { connect: { id } },
              })),
            }
          : undefined,
        tagLinks: tagIds.length
          ? {
              create: tagIds.map((id) => ({
                tag: { connect: { id } },
              })),
            }
          : undefined,
        supplierLinks: supplierIds.length
          ? {
              create: supplierIds.map((id) => ({
                user: { connect: { id } },
              })),
            }
          : undefined,
      },
      ...productWithRelations,
    });

    return mapProductDetail(product, false, false);
  }

  async updateProduct(
    id: string,
    dto: UpdateProductDto,
  ): Promise<ProductDetailResponseDto> {
    const productId = this.ensureNumericId(id);
    const existingProduct = await this.findProductOrThrow({ id: productId });

    if (dto.pricingType ?? dto.price) {
      const currentPrice =
        existingProduct.price !== null
          ? existingProduct.price.toString()
          : undefined;
      this.validatePricing(
        dto.pricingType ?? existingProduct.pricingType,
        dto.price ?? currentPrice,
      );
    }

    const data: PrismaNamespace.ProductUpdateInput = {};

    if (dto.title !== undefined) {
      data.title = dto.title;
    }
    if (dto.description !== undefined) {
      data.description = dto.description ?? null;
    }
    if (dto.coverUrl !== undefined) {
      data.coverUrl = dto.coverUrl ?? null;
    }
    if (dto.slug !== undefined) {
      data.slug = await this.resolveUniqueSlug(dto.slug, id);
    } else if (dto.title) {
      data.slug = await this.resolveUniqueSlug(slugify(dto.title), id);
    }
    if (dto.pricingType !== undefined) {
      data.pricingType = dto.pricingType;
    }
    if (dto.price !== undefined) {
      data.price = dto.price ?? null;
    }
    if (dto.active !== undefined) {
      data.active = dto.active;
    }
    if (dto.publishedAt !== undefined) {
      data.publishedAt = dto.publishedAt ? new Date(dto.publishedAt) : null;
    }

    if (dto.categories !== undefined) {
      const categoryIds = await this.resolveCategoryIds(dto.categories);
      data.categoryLinks = categoryIds.length
        ? {
            deleteMany: {},
            create: categoryIds.map((categoryId) => ({
              category: { connect: { id: categoryId } },
            })),
          }
        : { deleteMany: {} };
    }

    if (dto.tags !== undefined) {
      const tagIds = await this.resolveTagIds(dto.tags);
      data.tagLinks = tagIds.length
        ? {
            deleteMany: {},
            create: tagIds.map((tagId) => ({
              tag: { connect: { id: tagId } },
            })),
          }
        : { deleteMany: {} };
    }

    if (dto.suppliers !== undefined) {
      const supplierIds = await this.resolveSupplierIds(dto.suppliers);
      data.supplierLinks = supplierIds.length
        ? {
            deleteMany: {},
            create: supplierIds.map((supplierId) => ({
              user: { connect: { id: supplierId } },
            })),
          }
        : { deleteMany: {} };
    }

    if (dto.assets !== undefined) {
      data.assets = dto.assets.length
        ? {
            deleteMany: {},
            create: dto.assets.map((asset, index) => ({
              url: asset.url,
              alt: asset.alt ?? null,
              order: asset.order ?? index,
            })),
          }
        : { deleteMany: {} };
    }

    await this.prisma.product.update({
      where: { id: productId },
      data,
    });

    const updated = await this.findProductOrThrow({ id: productId });
    return mapProductDetail(updated, false, false);
  }

  async removeProduct(id: string): Promise<void> {
    const productId = this.ensureNumericId(id);

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        file: { select: { storageKey: true } },
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.productAsset.deleteMany({ where: { productId } });
      await tx.productCategory.deleteMany({ where: { productId } });
      await tx.productTag.deleteMany({ where: { productId } });
      await tx.productSupplier.deleteMany({ where: { productId } });
      await tx.productView.deleteMany({ where: { productId } });
      await tx.productDownload.deleteMany({ where: { productId } });
      await tx.like.deleteMany({ where: { productId } });
      await tx.bookmark.deleteMany({ where: { productId } });
      await tx.product.delete({ where: { id: productId } });
    });

    if (product.file?.storageKey) {
      await this.storageService
        .deleteFile(product.file.storageKey)
        .catch(() => undefined);
    }
  }

  private buildWhere(query: ListProductsQueryDto): PrismaNamespace.ProductWhereInput {
    const where: PrismaNamespace.ProductWhereInput = {};

    if (query.q) {
      where.OR = [
        { title: { contains: query.q, mode: Prisma.QueryMode.insensitive } },
        { description: { contains: query.q, mode: Prisma.QueryMode.insensitive } },
      ];
    }

    if (query.category) {
      const categoryFilter: PrismaNamespace.ProductCategoryWhereInput = /^\d+$/.test(
        query.category,
      )
        ? { categoryId: this.ensureNumericId(query.category) }
        : {
            category: {
              is: {
                slug: {
                  equals: query.category,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
            },
          };
      where.categoryLinks = { some: categoryFilter };
    }

    if (query.tag) {
      const tagFilter: PrismaNamespace.ProductTagWhereInput = /^\d+$/.test(
        query.tag,
      )
        ? { tagId: this.ensureNumericId(query.tag) }
        : {
            tag: {
              is: {
                slug: {
                  equals: query.tag,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
            },
          };
      where.tagLinks = { some: tagFilter };
    }

    if (query.supplierId) {
      where.supplierLinks = {
        some: { userId: query.supplierId },
      };
    }

    if (query.pricingType) {
      const pricingTypes = query.pricingType
        .split(',')
        .map((value) => value.trim().toUpperCase())
        .filter((value): value is PricingType =>
          Object.values(PricingType).includes(value as PricingType),
        );

      if (pricingTypes.length > 0) {
        where.pricingType = { in: pricingTypes };
      }
    }

    if (typeof query.active === 'boolean') {
      where.active = query.active;
    }

    return where;
  }

  private buildOrder(
    sort: ProductSortOption = ProductSortOption.NEWEST,
  ): PrismaNamespace.ProductOrderByWithRelationInput[] {
    switch (sort) {
      case ProductSortOption.DOWNLOADS:
        return [{ downloadsCount: 'desc' }, { createdAt: 'desc' }];
      case ProductSortOption.LIKES:
        return [{ likesCount: 'desc' }, { createdAt: 'desc' }];
      case ProductSortOption.POPULAR:
        return [{ viewsCount: 'desc' }, { createdAt: 'desc' }];
      case ProductSortOption.PRICE_ASC:
        return [{ price: 'asc' }, { createdAt: 'desc' }];
      case ProductSortOption.PRICE_DESC:
        return [{ price: 'desc' }, { createdAt: 'desc' }];
      default:
        return [{ publishedAt: 'desc' }, { createdAt: 'desc' }];
    }
  }

  private async findProductOrThrow(
    where: PrismaNamespace.ProductWhereInput,
  ): Promise<ProductWithRelations> {
    const product = await this.prisma.product.findFirst({
      where,
      ...productWithRelations,
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return product;
  }

  private async resolveUniqueSlug(
    baseSlug: string,
    ignoreId?: string,
  ): Promise<string> {
    if (!baseSlug) {
      throw new BadRequestException('Slug could not be generated');
    }

    for (let attempt = 0; attempt < this.slugMaxAttempts; attempt += 1) {
      const candidate = buildUniqueSlugCandidate(baseSlug, attempt);
      const existing = await this.prisma.product.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });

      if (!existing || (ignoreId && existing.id.toString() === ignoreId)) {
        return candidate;
      }
    }

    throw new BadRequestException('Unable to generate unique slug');
  }

  private validatePricing(pricingType: PricingType, price?: string): void {
    const requiresPrice =
      pricingType === PricingType.PAID ||
      pricingType === PricingType.PAID_OR_SUBSCRIPTION;
    const forbidsPrice = pricingType === PricingType.FREE;

    if (requiresPrice && (!price || Number(price) <= 0)) {
      throw new BadRequestException('Price is required for paid pricing types');
    }

    if (forbidsPrice && price) {
      throw new BadRequestException('Price must be omitted for free products');
    }
  }

  private async resolveCategoryIds(
    categoryIds: Array<number | string> | undefined,
  ): Promise<bigint[]> {
    if (!categoryIds?.length) {
      return [];
    }

    const ids = categoryIds.map((value) => this.ensureNumericId(value));
    const categories = await this.prisma.category.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });

    if (categories.length !== ids.length) {
      throw new BadRequestException('One or more categories do not exist');
    }

    return ids;
  }

  private async resolveTagIds(
    tagIds: Array<number | string> | undefined,
  ): Promise<bigint[]> {
    if (!tagIds?.length) {
      return [];
    }

    const ids = tagIds.map((value) => this.ensureNumericId(value));
    const tags = await this.prisma.tag.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });

    if (tags.length !== ids.length) {
      throw new BadRequestException('One or more tags do not exist');
    }

    return ids;
  }

  private async resolveSupplierIds(
    supplierIds: Array<string> | undefined,
    currentUser?: CurrentUserPayload,
  ): Promise<string[]> {
    if (supplierIds === undefined) {
      if (!currentUser) {
        throw new BadRequestException('Suppliers are required');
      }

      if (isSupplier(currentUser)) {
        await this.ensureSupplierExists(currentUser.id);
        return [currentUser.id];
      }

      if (isAdmin(currentUser)) {
        throw new BadRequestException(
          'At least one supplier must be specified',
        );
      }

      return [];
    }

    if (supplierIds.length === 0) {
      return [];
    }

    const unique = Array.from(new Set(supplierIds));
    const suppliers = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true },
    });

    if (suppliers.length !== unique.length) {
      throw new BadRequestException('One or more suppliers do not exist');
    }

    return unique;
  }

  private async ensureSupplierExists(userId: string): Promise<void> {
    const exists = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!exists) {
      throw new BadRequestException('Supplier does not exist');
    }
  }

  private ensureNumericId(value: number | string): bigint {
    const asString = String(value);
    if (!/^\d+$/.test(asString)) {
      throw new BadRequestException('Identifier must be numeric');
    }
    return BigInt(asString);
  }
}

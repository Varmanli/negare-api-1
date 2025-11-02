import type { Prisma as PrismaNamespace } from '@prisma/client';
import { Prisma } from '@app/prisma/prisma.constants';
import {
  ProductAssetDto,
  ProductCategoryDto,
  ProductResponseDto,
  ProductSupplierDto,
  ProductTagDto,
} from './dtos/product-response.dto';
import { ProductFileResponseDto } from './dtos/product-file-response.dto';
import { ProductDetailResponseDto } from './dtos/product-detail-response.dto';

export const productWithRelations = Prisma.validator<PrismaNamespace.ProductDefaultArgs>()({
  include: {
    assets: true,
    file: true,
    categoryLinks: { include: { category: true } },
    tagLinks: { include: { tag: true } },
    supplierLinks: {
      include: {
        user: {
          select: {
            id: true,
            username: true,
            name: true,
            avatarUrl: true,
          },
        },
      },
    },
  },
});

export type ProductWithRelations = PrismaNamespace.ProductGetPayload<
  typeof productWithRelations
>;

const toStringId = (value: bigint | number | string | null | undefined) =>
  value === null || value === undefined ? null : value.toString();

export function mapProduct(product: ProductWithRelations): ProductResponseDto {
  const dto = new ProductResponseDto();
  dto.id = product.id.toString();
  dto.slug = product.slug;
  dto.title = product.title;
  dto.description = product.description ?? null;
  dto.coverUrl = product.coverUrl ?? null;
  dto.pricingType = product.pricingType;
  dto.price = product.price ? product.price.toString() : null;
  dto.active = product.active;
  dto.publishedAt = product.publishedAt ?? null;
  dto.viewsCount = product.viewsCount;
  dto.downloadsCount = product.downloadsCount;
  dto.likesCount = product.likesCount;
  dto.createdAt = product.createdAt;
  dto.updatedAt = product.updatedAt;

  dto.file = product.file
    ? Object.assign(new ProductFileResponseDto(), {
        id: product.file.id.toString(),
        originalName: product.file.originalName ?? null,
        size: product.file.size ? Number(product.file.size) : undefined,
        mimeType: product.file.mimeType ?? null,
        createdAt: product.file.createdAt,
      })
    : null;

  // Fallback to empty arrays so lean Prisma selections do not break mapping.
  const assets = Array.isArray(product.assets) ? product.assets : [];
  dto.assets = assets
    .map<ProductAssetDto>((asset) =>
      Object.assign(new ProductAssetDto(), {
        id: asset.id.toString(),
        url: asset.url,
        alt: asset.alt ?? null,
        order: asset.sortOrder ?? 0,
        createdAt: asset.createdAt,
      }),
    )
    .sort((a, b) => {
      const orderDelta = (a.order ?? 0) - (b.order ?? 0);
      if (orderDelta !== 0) {
        return orderDelta;
      }
      const aId = Number(a.id);
      const bId = Number(b.id);
      if (!Number.isNaN(aId) && !Number.isNaN(bId)) {
        return aId - bId;
      }
      return a.id.localeCompare(b.id);
    });

  const categoryLinks = Array.isArray(product.categoryLinks)
    ? product.categoryLinks
    : [];
  dto.categories = categoryLinks.map((link) =>
    Object.assign(new ProductCategoryDto(), {
      id: link.category.id.toString(),
      name: link.category.name,
      slug: link.category.slug,
      parentId: toStringId(link.category.parentId),
    }),
  );

  const tagLinks = Array.isArray(product.tagLinks) ? product.tagLinks : [];
  dto.tags = tagLinks.map((link) =>
    Object.assign(new ProductTagDto(), {
      id: link.tag.id.toString(),
      name: link.tag.name,
      slug: link.tag.slug,
    }),
  );

  const supplierLinks = Array.isArray(product.supplierLinks)
    ? product.supplierLinks
    : [];
  dto.suppliers = supplierLinks.map((link) =>
    Object.assign(new ProductSupplierDto(), {
      id: link.user.id,
      username: link.user.username,
      name: link.user.name ?? null,
      avatarUrl: link.user.avatarUrl ?? null,
    }),
  );

  return dto;
}

export function mapProductDetail(
  product: ProductWithRelations,
  liked = false,
  bookmarked = false,
): ProductDetailResponseDto {
  const base = mapProduct(product);
  return Object.assign(new ProductDetailResponseDto(), base, {
    liked,
    bookmarked,
  });
}

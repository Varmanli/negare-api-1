import {
  Prisma,
  GraphicFormat,
  PricingType,
  ProductStatus,
} from '@prisma/client';
import {
  ProductAssetDto,
  ProductAuthorDto,
  ProductBriefDto,
  ProductCategoryDto,
  ProductDetailDto,
  ProductTagDto,
} from './dtos/product-response.dto';

/** include استاندارد که سرویس هم باید ازش استفاده کند تا تایپ‌ها درست Resolve شوند */
export const productInclude = {
  assets: true,
  categoryLinks: { include: { category: true } },
  tagLinks: { include: { tag: true } },
  supplierLinks: { include: { user: true } },
} as const;

export type ProductWithRelations = Prisma.ProductGetPayload<{
  include: typeof productInclude;
}>;

export class ProductMapper {
  /** تبدیل مدل کامل به خروجی خلاصه برای لیست‌ها */
  static toBrief(p: ProductWithRelations): ProductBriefDto {
    return {
      id: String(p.id),
      slug: p.slug,
      title: p.title,
      coverUrl: p.coverUrl ?? undefined,

      graphicFormat: p.graphicFormat as GraphicFormat,
      pricingType: p.pricingType as PricingType,
      // اگر 0 هم معتبر است، از چک صریح استفاده کن
      price:
        p.price !== null && p.price !== undefined ? Number(p.price) : undefined,

      status: p.status as ProductStatus,

      viewsCount: p.viewsCount,
      downloadsCount: p.downloadsCount,
      likesCount: p.likesCount,

      shortLink: p.shortLink ?? undefined,
      topic: p.topic ?? undefined,

      seoKeywords: p.seoKeywords ?? undefined,
      seoTitle: p.seoTitle ?? undefined,
      seoDescription: p.seoDescription ?? undefined,

      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  /** تبدیل مدل کامل به خروجی جزئیات */
  static toDetail(p: ProductWithRelations): ProductDetailDto {
    const brief = this.toBrief(p);

    const assets: ProductAssetDto[] = (p.assets ?? []).map((a) => ({
      id: String(a.id),
      url: a.url,
      alt: a.alt ?? undefined,
      order: a.sortOrder,
    }));

    const categories: ProductCategoryDto[] = (p.categoryLinks ?? []).map(
      (pc) => ({
        id: String(pc.category.id),
        name: pc.category.name,
        slug: pc.category.slug,
        parentId: pc.category.parentId
          ? String(pc.category.parentId)
          : undefined,
      }),
    );

    const tags: ProductTagDto[] = (p.tagLinks ?? []).map((pt) => ({
      id: String(pt.tag.id),
      name: pt.tag.name,
      slug: pt.tag.slug,
    }));

    const authors: ProductAuthorDto[] = (p.supplierLinks ?? []).map((ps) => ({
      userId: ps.userId,
      role: null,
    }));

    return {
      ...brief,
      description: p.description ?? undefined,
      fileId: p.fileId ? String(p.fileId) : undefined,
      assets,
      categories,
      tags,
      authors,
    };
  }
}

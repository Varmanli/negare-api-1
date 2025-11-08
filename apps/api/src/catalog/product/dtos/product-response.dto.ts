// apps/api/src/core/catalog/product/dto/product-response.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PricingType, ProductStatus, GraphicFormat } from '@prisma/client';

export class ProductAuthorDto {
  @ApiProperty() userId!: string;
  @ApiPropertyOptional() role?: string | null;
}

export class ProductTagDto {
  @ApiProperty() id!: string; // BigInt → string
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
}

export class ProductCategoryDto {
  @ApiProperty() id!: string; // BigInt → string
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiPropertyOptional() parentId?: string | null; // BigInt → string
}

export class ProductAssetDto {
  @ApiProperty() id!: string; // BigInt → string
  @ApiProperty() url!: string;
  @ApiPropertyOptional() alt?: string | null;
  @ApiProperty() order!: number;
}

export class ProductBriefDto {
  @ApiProperty() id!: string; // BigInt → string
  @ApiProperty() slug!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional() coverUrl?: string | null;

  @ApiProperty({ enum: GraphicFormat }) graphicFormat!: GraphicFormat;
  @ApiProperty({ enum: PricingType }) pricingType!: PricingType;
  @ApiPropertyOptional() price?: number | null;

  @ApiProperty({ enum: ProductStatus }) status!: ProductStatus;

  @ApiProperty() viewsCount!: number;
  @ApiProperty() downloadsCount!: number;
  @ApiProperty() likesCount!: number;

  @ApiPropertyOptional() shortLink?: string | null;
  @ApiPropertyOptional() topic?: string | null;

  @ApiPropertyOptional({ type: [String] }) seoKeywords?: string[];
  @ApiPropertyOptional() seoTitle?: string | null;
  @ApiPropertyOptional() seoDescription?: string | null;

  @ApiPropertyOptional() createdAt?: string;
  @ApiPropertyOptional() updatedAt?: string;
}

export class ProductDetailDto extends ProductBriefDto {
  @ApiPropertyOptional() description?: string | null;
  @ApiPropertyOptional() fileId?: string | null; // BigInt → string
  @ApiPropertyOptional() fileBytes?: string | null; // اگر می‌فرستی

  @ApiPropertyOptional({ type: [ProductAssetDto] }) assets?: ProductAssetDto[];
  @ApiPropertyOptional({ type: [ProductCategoryDto] })
  categories?: ProductCategoryDto[];
  @ApiPropertyOptional({ type: [ProductTagDto] }) tags?: ProductTagDto[];
  @ApiPropertyOptional({ type: [ProductAuthorDto] })
  authors?: ProductAuthorDto[];
}

export class ProductListResultDto {
  @ApiProperty({ type: [ProductBriefDto] }) items!: ProductBriefDto[];
  @ApiPropertyOptional({ description: 'cursor opaque (base64)' })
  nextCursor?: string;
}

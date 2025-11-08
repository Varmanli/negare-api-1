// apps/api/src/core/catalog/product/dto/product-update.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  ArrayMaxSize,
  ArrayUnique,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PricingType, ProductStatus, GraphicFormat } from '@prisma/client';
import {
  toBigIntString,
  toBigIntStringArray,
  toStringArray,
  toTrimmedString,
} from './transformers';

export class UpdateProductDto {
  @ApiPropertyOptional({ example: 'ghalam-siah-vector' })
  @IsOptional()
  @IsString()
  @Length(3, 255)
  @Transform(toTrimmedString)
  slug?: string;

  @ApiPropertyOptional({ example: 'قلم سیاه – وکتور خوشنویسی' })
  @IsOptional()
  @IsString()
  @Length(2, 255)
  @Transform(toTrimmedString)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 20000)
  @Transform(toTrimmedString)
  description?: string;

  // Media
  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  coverUrl?: string;

  @ApiPropertyOptional({ description: 'ID فایل اصلی (BigInt به صورت رشته)' })
  @IsOptional()
  @Transform(toBigIntString)
  @IsString()
  fileId?: string;

  // Catalog
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 120)
  @Transform(toTrimmedString)
  topic?: string;

  @ApiPropertyOptional({ enum: GraphicFormat })
  @IsOptional()
  @IsEnum(GraphicFormat)
  graphicFormat?: GraphicFormat;

  // SEO
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 160)
  seoTitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 240)
  seoDescription?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Transform(toStringArray)
  seoKeywords?: string[];

  // Pricing/Publish
  @ApiPropertyOptional({ enum: PricingType })
  @IsOptional()
  @IsEnum(PricingType)
  pricingType?: PricingType;

  @ApiPropertyOptional({ example: 49000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ enum: ProductStatus })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @ApiPropertyOptional({ example: '2025-11-08T12:00:00.000Z' })
  @IsOptional()
  @IsString()
  publishedAt?: string;

  // Relations (sync کامل در سرویس انجام می‌شود)
  @ApiPropertyOptional({
    type: [String],
    description: 'آیدی‌های دسته‌بندی (BigInt به صورت رشته)',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Transform(toBigIntStringArray)
  categoryIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'آیدی‌های تگ (BigInt به صورت رشته)',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Transform(toBigIntStringArray)
  tagIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'نویسندگان محصول (UUID، حداکثر ۳ نفر)',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(3)
  @Transform(toStringArray)
  authorIds?: string[];
}

// apps/api/src/core/catalog/product/dto/product-create.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  ArrayMaxSize,
  ArrayUnique,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
  ValidateIf,
  IsNotEmpty,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PricingType, ProductStatus, GraphicFormat } from '@prisma/client';
import {
  toBigIntString,
  toBigIntStringArray,
  toStringArray,
  toTrimmedString,
} from './transformers';

export class CreateProductDto {
  @ApiProperty({ example: 'ghalam-siah-vector' })
  @IsString()
  @Length(3, 255)
  @Transform(toTrimmedString)
  slug!: string;

  @ApiProperty({ example: 'قلم سیاه – وکتور خوشنویسی' })
  @IsString()
  @Length(2, 255)
  @Transform(toTrimmedString)
  title!: string;

  @ApiPropertyOptional({ example: 'فایل وکتور مناسب چاپ، فرمت EPS و SVG' })
  @IsOptional()
  @IsString()
  @Length(0, 20000)
  @Transform(toTrimmedString)
  description?: string;

  // Media
  @ApiPropertyOptional({ example: 'https://cdn.example.com/cover/abc.jpg' })
  @IsOptional()
  @IsUrl()
  coverUrl?: string;

  @ApiPropertyOptional({
    description: 'ID فایل اصلی (BigInt به صورت رشته)',
    example: '1234567890123',
  })
  @IsOptional()
  @Transform(toBigIntString)
  @IsString()
  fileId?: string;

  // Catalog
  @ApiPropertyOptional({ example: 'خوشنویسی' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  @Transform(toTrimmedString)
  topic?: string;

  @ApiProperty({ enum: GraphicFormat, example: GraphicFormat.SVG })
  @IsEnum(GraphicFormat)
  graphicFormat!: GraphicFormat;

  // SEO
  @ApiPropertyOptional({ example: 'دانلود وکتور خوشنویسی قلم سیاه' })
  @IsOptional()
  @IsString()
  @Length(0, 160)
  seoTitle?: string;

  @ApiPropertyOptional({
    example: 'وکتور خوشنویسی مناسب چاپ و وب، فرمت SVG/EPS.',
  })
  @IsOptional()
  @IsString()
  @Length(0, 240)
  seoDescription?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['وکتور', 'خوشنویسی', 'قلم سیاه'],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Transform(toStringArray)
  seoKeywords?: string[];

  // Pricing/Publish
  @ApiProperty({ enum: PricingType, example: PricingType.PAID_OR_SUBSCRIPTION })
  @IsEnum(PricingType)
  pricingType!: PricingType;

  @ApiPropertyOptional({
    description: 'قیمت نقدی (تومان). برای FREE/اشتراکی اختیاری است.',
    example: 49000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ enum: ProductStatus, example: ProductStatus.DRAFT })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @ApiPropertyOptional({
    description: 'در صورت انتشار',
    example: '2025-11-08T12:00:00.000Z',
  })
  @IsOptional()
  @IsString()
  publishedAt?: string;

  // Relations
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
    description: 'نویسندگان محصول (UUID کاربران، حداکثر ۳ نفر)',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(3)
  @Transform(toStringArray)
  authorIds?: string[];
}

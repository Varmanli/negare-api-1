// apps/api/src/core/catalog/product/dto/product-query.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PricingType, ProductStatus, GraphicFormat } from '@prisma/client';
import { toBigIntString, toTrimmedString } from './transformers';

export type ProductSort = 'latest' | 'popular' | 'viewed' | 'liked';

export class ProductFindQueryDto {
  // متن جستجو
  @ApiPropertyOptional({ example: 'خوشنویسی' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  @Transform(toTrimmedString)
  q?: string;

  // فیلترها
  @ApiPropertyOptional({ description: 'BigInt به صورت رشته' })
  @IsOptional()
  @Transform(toBigIntString)
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'BigInt به صورت رشته' })
  @IsOptional()
  @Transform(toBigIntString)
  @IsString()
  tagId?: string;

  @ApiPropertyOptional({ description: 'UUID نویسنده' })
  @IsOptional()
  @IsString()
  authorId?: string;

  @ApiPropertyOptional({ enum: PricingType })
  @IsOptional()
  @IsEnum(PricingType)
  pricingType?: PricingType;

  @ApiPropertyOptional({ enum: GraphicFormat })
  @IsOptional()
  @IsEnum(GraphicFormat)
  graphicFormat?: GraphicFormat;

  @ApiPropertyOptional({ enum: ProductStatus })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  // سورت و بارگیری
  @ApiPropertyOptional({
    enum: ['latest', 'popular', 'viewed', 'liked'],
    example: 'latest',
  })
  @IsOptional()
  @IsString()
  sort?: ProductSort;

  @ApiPropertyOptional({ minimum: 1, maximum: 60, example: 24 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  limit?: number;

  @ApiPropertyOptional({ description: 'cursor opaque (base64)' })
  @IsOptional()
  @IsString()
  cursor?: string;
}

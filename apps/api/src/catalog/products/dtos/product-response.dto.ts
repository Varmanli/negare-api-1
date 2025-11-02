import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PricingType } from '@app/prisma/prisma.constants';
import { ProductFileResponseDto } from './product-file-response.dto';

export class ProductAssetDto {
  @ApiProperty({ example: '101' })
  id: string;

  @ApiProperty({ example: 'https://cdn.negare.com/assets/hero.png' })
  url: string;

  @ApiPropertyOptional({ example: 'Hero image' })
  alt?: string | null;

  @ApiProperty({ example: 0 })
  order: number;

  @ApiProperty({ example: '2024-05-01T10:00:00.000Z' })
  createdAt: Date;
}

export class ProductCategoryDto {
  @ApiProperty({ example: '10' })
  id: string;

  @ApiProperty({ example: 'UI Kits' })
  name: string;

  @ApiProperty({ example: 'ui-kits' })
  slug: string;

  @ApiPropertyOptional({ example: '5' })
  parentId?: string | null;
}

export class ProductTagDto {
  @ApiProperty({ example: '15' })
  id: string;

  @ApiProperty({ example: 'figma' })
  name: string;

  @ApiProperty({ example: 'figma' })
  slug: string;
}

export class ProductSupplierDto {
  @ApiProperty({ example: '8a7f0c9e-5d1a-4c3a-bc83-6d618983ef45' })
  id: string;

  @ApiProperty({ example: 'designer123' })
  username: string;

  @ApiPropertyOptional({ example: 'Negare Studio' })
  name?: string | null;

  @ApiPropertyOptional({ example: 'https://cdn.negare.com/avatars/supplier.png' })
  avatarUrl?: string | null;
}

export class ProductResponseDto {
  @ApiProperty({ example: '1001' })
  id: string;

  @ApiProperty({ example: 'ultimate-ui-kit' })
  slug: string;

  @ApiProperty({ example: 'Ultimate UI Kit' })
  title: string;

  @ApiPropertyOptional({
    example: 'The most comprehensive UI kit for modern web applications.',
  })
  description?: string | null;

  @ApiPropertyOptional({
    example: 'https://cdn.negare.com/covers/ultimate-ui-kit.png',
  })
  coverUrl?: string | null;

  @ApiProperty({ enum: PricingType, example: PricingType.PAID })
  pricingType: PricingType;

  @ApiPropertyOptional({ example: '49.90' })
  price?: string | null;

  @ApiProperty({ example: true })
  active: boolean;

  @ApiPropertyOptional({ example: '2024-05-02T08:00:00.000Z' })
  publishedAt?: Date | null;

  @ApiProperty({ example: 540 })
  viewsCount: number;

  @ApiProperty({ example: 120 })
  downloadsCount: number;

  @ApiProperty({ example: 85 })
  likesCount: number;

  @ApiPropertyOptional({ type: ProductFileResponseDto, nullable: true })
  file?: ProductFileResponseDto | null;

  @ApiProperty({ type: [ProductAssetDto] })
  assets: ProductAssetDto[];

  @ApiProperty({ type: [ProductCategoryDto] })
  categories: ProductCategoryDto[];

  @ApiProperty({ type: [ProductTagDto] })
  tags: ProductTagDto[];

  @ApiProperty({ type: [ProductSupplierDto] })
  suppliers: ProductSupplierDto[];

  @ApiPropertyOptional({ example: false })
  liked?: boolean;

  @ApiPropertyOptional({ example: false })
  bookmarked?: boolean;

  @ApiProperty({ example: '2024-04-30T09:15:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2024-05-10T11:45:00.000Z' })
  updatedAt: Date;
}

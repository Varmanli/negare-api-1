// apps/api/src/core/catalog/product/dto/product-id.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class ProductIdParamDto {
  @ApiProperty({ description: 'ID (BigInt به صورت رشته) یا slug' })
  @IsString()
  @Length(1, 255)
  idOrSlug!: string;
}

export class ProductIdBodyDto {
  @ApiProperty({ description: 'ID (BigInt به صورت رشته)' })
  @IsString()
  @Length(1, 50)
  productId!: string;
}

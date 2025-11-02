import { ApiProperty } from '@nestjs/swagger';
import { ProductResponseDto } from './product-response.dto';

export class ProductDetailResponseDto extends ProductResponseDto {
  @ApiProperty({
    description:
      'Indicates whether the authenticated user likes this product. Always false when unauthenticated.',
    example: true,
  })
  declare liked: boolean;

  @ApiProperty({
    description:
      'Indicates whether the authenticated user bookmarked this product. Always false when unauthenticated.',
    example: false,
  })
  declare bookmarked: boolean;
}

import { ApiProperty } from '@nestjs/swagger';
import { ProductResponseDto } from './product-response.dto';

export class ProductListResponseDto {
  @ApiProperty({
    type: [ProductResponseDto],
    description: 'Collection of products for the current page.',
  })
  data: ProductResponseDto[];

  @ApiProperty({
    description: 'Total number of products matching the applied filters.',
  })
  total: number;

  @ApiProperty({ description: 'Current page number.' })
  page: number;

  @ApiProperty({ description: 'Maximum number of items per page.' })
  limit: number;

  @ApiProperty({
    description: 'Indicates whether more pages are available after this one.',
  })
  hasNext: boolean;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CategoryResponseDto {
  @ApiProperty({ example: '12' })
  id: string;

  @ApiProperty({ example: 'UI Kits' })
  name: string;

  @ApiProperty({ example: 'ui-kits' })
  slug: string;

  @ApiPropertyOptional({ example: '5' })
  parentId?: string | null;

  @ApiProperty({
    type: () => [CategoryResponseDto],
    description: 'Nested child categories.',
    required: false,
  })
  children?: CategoryResponseDto[];
}

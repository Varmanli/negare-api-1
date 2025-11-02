import { ApiProperty } from '@nestjs/swagger';

export class TagResponseDto {
  @ApiProperty({ example: '42' })
  id: string;

  @ApiProperty({ example: 'figma' })
  name: string;

  @ApiProperty({ example: 'figma' })
  slug: string;
}

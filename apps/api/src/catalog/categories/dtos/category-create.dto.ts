import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({ example: 'وکتور' })
  @IsString()
  @Length(2, 255)
  name!: string;

  @ApiProperty({ example: 'vector' })
  @IsString()
  @Length(2, 255)
  slug!: string;

  @ApiPropertyOptional({
    description: 'Parent ID (BigInt as string)',
    example: '123',
  })
  @IsOptional()
  @IsString()
  parentId?: string; // BigInt string
}

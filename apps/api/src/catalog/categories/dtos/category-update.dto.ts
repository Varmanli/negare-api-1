import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

export class UpdateCategoryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 255)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 255)
  slug?: string;

  @ApiPropertyOptional({
    description: 'Parent ID (BigInt as string) or empty to detach',
  })
  @IsOptional()
  @IsString()
  parentId?: string;
}

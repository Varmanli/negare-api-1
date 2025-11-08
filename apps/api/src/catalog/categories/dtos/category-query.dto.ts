import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CategoryFindQueryDto {
  @ApiPropertyOptional({ example: 'vector' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  q?: string;

  @ApiPropertyOptional({ example: '0' })
  @IsOptional()
  @IsString()
  parentId?: string; // BigInt string

  @ApiPropertyOptional({ minimum: 1, maximum: 200, example: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

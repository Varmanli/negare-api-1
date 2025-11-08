import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBooleanString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class TagFindQueryDto {
  @ApiPropertyOptional({ example: 'vector' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    example: 'true',
    description: 'فقط تگ‌هایی که حداقل یک محصول دارند',
  })
  @IsOptional()
  @IsBooleanString()
  usedOnly?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, example: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

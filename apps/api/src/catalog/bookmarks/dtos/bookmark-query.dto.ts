import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class BookmarkListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 60, example: 24 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  limit?: number;

  @ApiPropertyOptional({ description: 'cursor opaque (base64)' })
  @IsOptional()
  @IsString()
  cursor?: string;
}

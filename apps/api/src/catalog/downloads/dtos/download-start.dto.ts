import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional } from 'class-validator';

export class DownloadStartDto {
  @ApiPropertyOptional({
    description: 'File size in bytes (optional)',
    example: 123456,
  })
  @IsOptional()
  @IsNumber()
  bytes?: number;

  @ApiPropertyOptional({
    description: 'Amount paid for this download (if any)',
    example: 0,
  })
  @IsOptional()
  @IsNumber()
  pricePaid?: number;
}

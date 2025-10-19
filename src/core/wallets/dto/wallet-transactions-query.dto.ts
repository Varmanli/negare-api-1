import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class WalletTransactionsQueryDto {
  @ApiPropertyOptional({
    description: 'Number of records per page',
    example: 20,
    default: 20,
    minimum: 1,
    maximum: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'Cursor for pagination. Suggested format: ISO8601|<transactionId>. Example: 2024-01-01T00:00:00.000Z|f6b6...',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Transaction type filter. The value `all` disables filtering.',
    example: 'all',
    enum: ['all', 'credit', 'debit'],
    default: 'all',
  })
  @IsOptional()
  @IsString()
  @IsIn(['all', 'credit', 'debit'])
  type?: 'all' | 'credit' | 'debit';

  @ApiPropertyOptional({
    description: 'Filter start time (ISO 8601).',
    example: '2024-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @ApiPropertyOptional({
    description: 'Filter end time (ISO 8601).',
    example: '2024-01-31T23:59:59.999Z',
  })
  @IsOptional()
  @IsDateString()
  toDate?: string;
}

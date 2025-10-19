import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class CreateWalletTransactionDto {
  @ApiProperty({
    enum: ['credit', 'debit'],
    description: 'Transaction type: credit for deposits, debit for withdrawals.',
  })
  @IsString()
  @IsIn(['credit', 'debit'])
  type: 'credit' | 'debit';

  @ApiProperty({
    example: 250000,
    description:
      'Transaction amount in IRR. Must be positive with up to two decimal places.',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(999999999999)
  amount: number;

  @ApiProperty({
    example: 'txn-1234-test',
    description:
      'Idempotency key used to ensure the operation is not duplicated; repeated values will not create a new transaction.',
  })
  @IsString()
  @Length(3, 255)
  idempotencyKey: string;

  @ApiPropertyOptional({
    example: 'Increase balance for a sample product sale',
    description: 'Optional transaction description (max 1000 characters).',
  })
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  description?: string;

  @ApiPropertyOptional({
    description: 'Payment provider name (used for pending transactions).',
    example: 'mock-gateway',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  provider?: string;

  @ApiPropertyOptional({
    description: 'External reference identifier supplied by the provider.',
    example: 'PG-123456',
  })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  externalRef?: string;

  @ApiPropertyOptional({
    description: 'Transaction status. Defaults to success.',
    enum: ['success', 'pending'],
    default: 'success',
  })
  @IsOptional()
  @IsString()
  @IsIn(['success', 'pending'])
  status?: 'success' | 'pending';
}

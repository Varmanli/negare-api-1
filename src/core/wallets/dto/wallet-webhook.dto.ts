import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class WalletWebhookDto {
  @ApiProperty({ description: 'ID of the user who owns the transaction', format: 'uuid' })
  @IsUUID('4')
  userId: string;

  @ApiProperty({ description: 'New transaction status', enum: ['success', 'failed'] })
  @IsString()
  @IsIn(['success', 'failed'])
  status: 'success' | 'failed';

  @ApiProperty({ description: 'Transaction type', enum: ['credit', 'debit'] })
  @IsString()
  @IsIn(['credit', 'debit'])
  type: 'credit' | 'debit';

  @ApiProperty({ description: 'External reference identifier (gateway)', example: 'PG-123456' })
  @IsString()
  @Length(1, 255)
  externalRef: string;

  @ApiProperty({ description: 'Transaction amount in IRR', example: 200000 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  amount: number;

  @ApiPropertyOptional({ description: 'Optional idempotency key' })
  @IsOptional()
  @IsString()
  @Length(3, 255)
  idempotencyKey?: string;

  @ApiPropertyOptional({ description: 'Transaction description' })
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  description?: string;
}

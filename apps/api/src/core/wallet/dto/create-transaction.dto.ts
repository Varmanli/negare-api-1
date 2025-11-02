import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import {
  WalletTransactionRefType,
  WalletTransactionType,
} from '@app/prisma/prisma.constants';
import type { Prisma } from '@prisma/client';

export class CreateWalletTransactionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  userId: string;

  @ApiProperty({ enum: WalletTransactionType })
  @IsEnum(WalletTransactionType)
  type: WalletTransactionType;

  @ApiProperty({
    description: 'Positive integer amount in the smallest currency unit',
    example: '50000',
  })
  @IsString()
  @Matches(/^\d+$/)
  amount: string;

  @ApiProperty({
    description: 'Idempotency key to prevent duplicate operations',
    example: 'manual-credit-1',
  })
  @IsString()
  @Length(8, 128)
  idempotencyKey: string;

  @ApiProperty({ enum: WalletTransactionRefType })
  @IsEnum(WalletTransactionRefType)
  refType: WalletTransactionRefType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  refId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  metadata?: Prisma.InputJsonValue;
}

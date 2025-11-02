import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import type { Prisma } from '@prisma/client';
import { WalletTransactionRefType } from '@app/prisma/prisma.constants';

export class WalletOperationDto {
  @ApiProperty({
    description: 'Amount to apply as a positive integer (in the smallest currency unit)',
    example: '100000',
  })
  @IsString()
  @Matches(/^\d+$/)
  amount: string;

  @ApiProperty({
    description: 'Idempotency key to prevent duplicate processing',
    example: 'credit-20231018-001',
  })
  @IsString()
  @Length(8, 128)
  idempotencyKey: string;

  @ApiProperty({ enum: WalletTransactionRefType })
  @IsString()
  @IsNotEmpty()
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

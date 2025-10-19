import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsString, IsUUID, Length, Min } from 'class-validator';

export class CreateWalletTransferDto {
  @ApiProperty({
    description: 'Destination user identifier (UUID)',
    format: 'uuid',
  })
  @IsUUID('4')
  toUserId: string;

  @ApiProperty({
    description: 'Transfer amount in IRR (must be greater than zero)',
    example: 200000,
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({
    description: 'Optional transfer description (max 1000 characters)',
  })
  @IsString()
  @Length(0, 1000)
  description?: string;

  @ApiProperty({
    description: 'Idempotency key to guarantee transfer uniqueness',
    example: 'xfer-20240101-0001',
  })
  @IsString()
  @Length(3, 255)
  idempotencyKey: string;
}

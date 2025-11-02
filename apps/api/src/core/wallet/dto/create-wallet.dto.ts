import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { WalletCurrency } from '@app/prisma/prisma.constants';

export class CreateWalletDto {
  @ApiPropertyOptional({ enum: WalletCurrency, default: WalletCurrency.IRR })
  @IsOptional()
  @IsEnum(WalletCurrency)
  currency?: WalletCurrency;
}

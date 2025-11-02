import { ApiProperty } from '@nestjs/swagger';
import { WalletCurrency } from '@app/prisma/prisma.constants';

export class WalletBalanceDto {
  @ApiProperty({ example: '250000' })
  balance: string;

  @ApiProperty({ enum: WalletCurrency, example: WalletCurrency.IRR })
  currency: WalletCurrency;
}

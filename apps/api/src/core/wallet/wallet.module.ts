import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WalletAuditService } from './wallet-audit.service';
import { WalletController } from './wallet.controller';
import { WalletRateLimitService } from './wallet-rate-limit.service';
import { WalletReadService } from './wallet-read.service';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';
import { WalletTransactionsController } from './wallet-transactions.controller';
import { WalletTransactionsService } from './wallet-transactions.service';
import { RedisModule } from '@app/redis/redis.module';

@Module({
  imports: [
    ConfigModule,
    RedisModule,
  ],
  controllers: [
    WalletController,
    WalletsController,
    WalletTransactionsController,
  ],
  providers: [
    WalletsService,
    WalletReadService,
    WalletTransactionsService,
    WalletAuditService,
    WalletRateLimitService,
  ],
  exports: [
    WalletsService,
    WalletReadService,
    WalletTransactionsService,
    WalletAuditService,
    WalletRateLimitService,
  ],
})
export class WalletModule {}

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletTransaction } from '../wallet-transactions/wallet-transaction.entity';
import { Wallet } from './wallet.entity';
import { WalletsController } from './wallets.controller';
import { WalletController } from './wallet.controller';
import { WalletsService } from './wallets.service';
import { WalletReadService } from './wallet-read.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { WalletAuditLog } from './entities/wallet-audit-log.entity';
import { WalletAuditService } from './wallet-audit.service';
import { WalletRateLimitService } from './wallet-rate-limit.service';
import { RedisModule } from '../../redis/redis.module';

@Module({
  imports: [
    ConfigModule,
    RedisModule,
    TypeOrmModule.forFeature([Wallet, WalletTransaction, WalletAuditLog]),
  ],
  controllers: [WalletsController, WalletController],
  providers: [
    WalletsService,
    WalletReadService,
    JwtAuthGuard,
    WalletAuditService,
    WalletRateLimitService,
  ],
  exports: [WalletsService, TypeOrmModule, WalletAuditService, WalletRateLimitService],
})
export class WalletsModule {}

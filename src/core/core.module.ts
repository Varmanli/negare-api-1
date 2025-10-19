import { Module } from '@nestjs/common';
import { RolesModule } from './roles/roles.module';
import { UserRolesModule } from './user-roles/user-roles.module';
import { UsersModule } from './users/users.module';
import { WalletTransactionsModule } from './wallet-transactions/wallet-transactions.module';
import { WalletsModule } from './wallets/wallets.module';
import { ProfileModule } from './profile/profile.module';

@Module({
  imports: [
    UsersModule,
    RolesModule,
    UserRolesModule,
    WalletsModule,
    WalletTransactionsModule,
    ProfileModule,
  ],
  exports: [
    UsersModule,
    RolesModule,
    UserRolesModule,
    WalletsModule,
    WalletTransactionsModule,
    ProfileModule,
  ],
})
export class CoreModule {}

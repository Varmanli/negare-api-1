import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ProfileModule } from './users/profile/profile.module';
import { RolesModule } from './roles/roles.module';
import { UsersModule } from './users/users.module';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [AuthModule, ProfileModule, RolesModule, UsersModule, WalletModule],
  exports: [AuthModule, ProfileModule, RolesModule, UsersModule, WalletModule],
})
export class CoreModule {}

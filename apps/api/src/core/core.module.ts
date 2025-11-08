import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ProfileModule } from './users/profile/profile.module';
import { RolesModule } from './roles/roles.module';
import { UsersModule } from './users/users.module';
import { UploadModule } from './upload/upload.module';

@Module({
  imports: [AuthModule, ProfileModule, RolesModule, UsersModule, UploadModule],
  exports: [AuthModule, ProfileModule, RolesModule, UsersModule, UploadModule],
})
export class CoreModule {}

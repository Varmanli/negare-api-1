/**
 * AuthModule wires authentication services, guards, and controllers together,
 * exporting utilities that other Core modules may re-use (e.g., guards).
 */
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HybridAuthGuard } from './guards/hybrid-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { OtpCode } from './entities/otp-code.entity';
import { OtpService } from './otp.service';
import { SmsModule } from '../sms/sms.module';
import { AuthController } from './auth.controller';
import { MailModule } from '../mail/mail.module';
import { PasswordService } from './password.service';
import { User } from '../core/users/user.entity';
import { RedisModule } from '../redis/redis.module';
import { OtpRateLimitService } from './otp-rate-limit.service';
import { RefreshService } from './refresh.service';
import { UsersModule } from '../core/users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([OtpCode, User]),
    SmsModule,
    MailModule,
    RedisModule,
    UsersModule,
  ],
  controllers: [AuthController],
  providers: [
    OtpService,
    PasswordService,
    RefreshService,
    OtpRateLimitService,
    HybridAuthGuard,
    JwtAuthGuard,
    {
      provide: APP_GUARD,
      useClass: HybridAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
  exports: [OtpService, PasswordService, RefreshService, JwtAuthGuard],
})
/**
 * Nest module that bundles controllers, providers, and guards for authentication flows.
 */
export class AuthModule {}

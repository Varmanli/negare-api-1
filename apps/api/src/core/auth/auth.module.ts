import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { HybridAuthGuard } from './guards/hybrid-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from '@app/common/guards/roles.guard';
import { SmsModule } from '@app/sms/sms.module';
import { MailModule } from '@app/mail/mail.module';
import { RedisModule } from '@app/redis/redis.module';
import { UsersModule } from '@app/core/users/users.module';
import { TokenModule } from './token/token.module';

// Controllers
import { AuthController } from './auth.controller';
import { OtpController } from './otp/otp.controller';
import { PasswordController } from './password/password.controller';

// Services
import { OtpService } from './otp/otp.service';
import { OtpRateLimitService } from './otp/otp-rate-limit.service';
import { PasswordService } from './password/password.service';
import { RefreshService } from './refresh.service';
import { SessionService } from './session/session.service';

@Module({
  imports: [SmsModule, MailModule, RedisModule, UsersModule, TokenModule],
  controllers: [AuthController, OtpController, PasswordController],
  providers: [
    OtpService,
    PasswordService,
    RefreshService,
    OtpRateLimitService,
    HybridAuthGuard,
    JwtAuthGuard,
    SessionService,
    { provide: 'LEGACY_PASSWORD_ADAPTER', useValue: null },

    {
      provide: 'AuditService',
      useValue: { log: async () => void 0 },
    },
    {
      provide: APP_GUARD,
      useClass: HybridAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
  exports: [
    OtpService,
    PasswordService,
    RefreshService,
    JwtAuthGuard,
    SessionService,
  ],
})
export class AuthModule {}

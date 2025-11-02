import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AllConfig } from '@app/config/config.module';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'REDIS',
      inject: [ConfigService],
      useFactory: (cfg: ConfigService<AllConfig>) => {
        const url =
          cfg.get<string>('REDIS_URL', { infer: true }) ??
          'redis://localhost:6379';
        return new Redis(url, { lazyConnect: true });
      },
    },
  ],
  exports: ['REDIS'],
})
export class RedisModule {}

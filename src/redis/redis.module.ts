import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  providers: [
    {
      provide: 'REDIS',
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) =>
        new Redis({
          host: cfg.get<string>('REDIS_HOST') || 'redis',
          port: Number(cfg.get('REDIS_PORT') || 6379),
          lazyConnect: true,
        }),
    },
  ],
  exports: ['REDIS'],
})
export class RedisModule {}

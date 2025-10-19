import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { WalletAuditService } from './wallet-audit.service';

@Injectable()
export class WalletRateLimitService {
  constructor(
    @Inject('REDIS') private readonly redis: Redis,
    private readonly config: ConfigService,
    private readonly audit: WalletAuditService,
  ) {}

  private key(userId: string, action: string) {
    return `wallet:rate:${action}:${userId}`;
  }

  async consume(userId: string, action = 'tx'): Promise<void> {
    const windowSeconds = Number(this.config.get('WALLET_TX_WINDOW') || 60);
    const max = Number(this.config.get('WALLET_TX_MAX') || 10);
    const redisKey = this.key(userId, action);

    const count = await this.redis.incr(redisKey);
    if (count === 1) {
      await this.redis.expire(redisKey, windowSeconds);
    }

    if (count > max) {
      await this.audit.log({
        userId,
        action: 'rate_limit_hit',
        meta: { action, windowSeconds, max, count },
      });
      throw new HttpException(
        'تعداد درخواست‌ها از حد مجاز بیشتر است. لطفاً کمی بعد دوباره تلاش کنید.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}

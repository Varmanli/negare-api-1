import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type Redis from 'ioredis';
import type { AllConfig } from '@app/config/config.module';

@Injectable()
export class RefreshRateLimitService {
  private readonly windowSec: number;
  private readonly maxHits: number;

  constructor(
    @Inject('REDIS') private readonly redis: Redis,
    private readonly config: ConfigService<AllConfig>,
  ) {
    const windowRaw = Number(this.config.get('REFRESH_RL_WINDOW') ?? 10);
    const maxRaw = Number(this.config.get('REFRESH_RL_MAX') ?? 5);
    this.windowSec = Number.isFinite(windowRaw) ? Math.max(1, windowRaw) : 10;
    this.maxHits = Number.isFinite(maxRaw) ? Math.max(1, maxRaw) : 5;
  }

  async consume(identifier: string): Promise<void> {
    const subject = identifier || 'anonymous';
    const key = this.key(subject);
    const hits = await this.redis.incr(key);
    if (hits === 1) {
      await this.redis.expire(key, this.windowSec);
    }
    if (hits > this.maxHits) {
      throw new HttpException(
        {
          code: 'TooManyRefreshRequests',
          message: 'Too many refresh attempts. Please try again later.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private key(identifier: string): string {
    const digest = createHash('sha256')
      .update(identifier)
      .digest('hex')
      .slice(0, 32);
    return `auth:refresh:rl:${digest}`;
  }
}

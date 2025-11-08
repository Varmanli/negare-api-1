// apps/api/src/core/catalog/counters/counters.service.ts
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import IORedis, { Redis } from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';

type CounterKind = 'views' | 'downloads' | 'likes';

function key(productId: bigint, kind: CounterKind) {
  return `cnt:product:${productId}:${kind}`;
}

@Injectable()
export class CountersService {
  private readonly log = new Logger('CountersService');
  private readonly redis?: Redis;

  constructor(private readonly prisma: PrismaService) {
    // اگر env نداشتی، می‌تونی this.redis رو undefined بگذاری تا مسیر fallback فعال شود
    const url = process.env.REDIS_URL || process.env.REDIS_HOST;
    if (url) {
      this.redis = new IORedis(url);
      this.redis.on('error', (e) => this.log.warn(`Redis error: ${e.message}`));
    } else {
      this.log.warn(
        'Redis not configured; falling back to direct DB increments.',
      );
    }
  }

  /** افزایش شمارنده (اتمیک در Redis؛ یا fallback روی DB) */
  async bump(productId: bigint, kind: CounterKind, delta = 1): Promise<void> {
    if (!Number.isFinite(delta)) return;
    if (this.redis) {
      await this.redis.incrby(key(productId, kind), delta);
      return;
    }
    // fallback: مستقیم DB
    await this.applyDbIncrement([{ productId, kind, value: delta }]);
  }

  /** میان‌بری برای لایک/آن‌لایک */
  async bumpLikeDelta(productId: bigint, delta: 1 | -1): Promise<void> {
    return this.bump(productId, 'likes', delta);
  }

  /** خواندن مقدار جاری (فقط Redis؛ fallback مقدار 0) */
  async readCurrent(productId: bigint): Promise<Record<CounterKind, number>> {
    if (!this.redis) return { views: 0, downloads: 0, likes: 0 };
    const [v, d, l] = await this.redis.mget(
      key(productId, 'views'),
      key(productId, 'downloads'),
      key(productId, 'likes'),
    );
    return {
      views: Number(v ?? 0),
      downloads: Number(d ?? 0),
      likes: Number(l ?? 0),
    };
  }

  /** فلش: همه‌ی کلیدهای cnt:product:* را می‌خواند و به DB اعمال می‌کند */
  async flushBatch(): Promise<void> {
    if (!this.redis) return; // اگر Redis نیست، چیزی برای فلش نداریم
    const scanPattern = 'cnt:product:*';
    const updates: Array<{
      productId: bigint;
      kind: CounterKind;
      value: number;
    }> = [];

    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        scanPattern,
        'COUNT',
        '1000',
      );
      cursor = next;
      if (keys.length === 0) continue;

      // مقادیر فعلی
      const values = await this.redis.mget(...keys);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const raw = Number(values[i] ?? 0);
        if (!raw) continue;
        // parse key: cnt:product:{id}:{kind}
        const parts = k.split(':'); // ['cnt','product','{id}','{kind}']
        const pid = BigInt(parts[2]);
        const kind = parts[3] as CounterKind;
        updates.push({ productId: pid, kind, value: raw });
      }
    } while (cursor !== '0');

    if (updates.length === 0) return;

    // اعمال به DB در دسته‌های کوچک
    await this.applyDbIncrement(updates);

    // پس از موفقیت، مقادیر فلش‌شده را از Redis کم کن (به‌جای DEL؛ برای جلوگیری از race)
    const multi = this.redis.multi();
    for (const u of updates) {
      multi.decrby(key(u.productId, u.kind), u.value);
    }
    await multi.exec();
  }

  /** اعمال تغییر شمارنده‌ها روی DB */
  private async applyDbIncrement(
    updates: Array<{ productId: bigint; kind: CounterKind; value: number }>,
  ): Promise<void> {
    // گروه‌بندی بر اساس productId برای کاهش round-trip
    const groups = new Map<
      bigint,
      { views: number; downloads: number; likes: number }
    >();
    for (const u of updates) {
      const g = groups.get(u.productId) ?? { views: 0, downloads: 0, likes: 0 };
      g[u.kind] += u.value;
      groups.set(u.productId, g);
    }

    await this.prisma.$transaction(
      Array.from(groups.entries()).map(([productId, g]) =>
        this.prisma.product.update({
          where: { id: productId },
          data: {
            ...(g.views ? { viewsCount: { increment: g.views } } : {}),
            ...(g.downloads
              ? { downloadsCount: { increment: g.downloads } }
              : {}),
            ...(g.likes ? { likesCount: { increment: g.likes } } : {}),
          },
          select: { id: true },
        }),
      ),
    );
  }
}

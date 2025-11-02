// apps/api/src/core/auth/session/session.service.ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import type { AllConfig } from '@app/config/config.module';
import { parseDurationToSeconds } from '@app/shared/utils/parse-duration.util';
import { refreshAllowKey } from '../auth.constants';

/**
 * رکورد سشن که در Redis ذخیره می‌شود.
 */
export interface SessionRecord {
  id: string; // شناسه سشن (sid)
  userId: string; // شناسه کاربر
  ip?: string;
  userAgent?: string;
  device?: string; // اختیاری: نام دستگاه/پلتفرم برای UI
  createdAt: number; // ms epoch
  lastUsedAt: number; // ms epoch
  revokedAt?: number; // اگر ست شد یعنی سشن بسته شده
}

/** ورودی ساخت سشن */
export interface CreateSessionInput {
  userId: string;
  ip?: string;
  userAgent?: string;
  device?: string;
}

/** آپشن‌های صفحه‌بندی برای listPage */
export interface ListPageOptions {
  offset?: number; // پیش‌فرض 0
  limit?: number; // پیش‌فرض 20
}

/**
 * سرویس مدیریت سشن
 *
 * کلیدها (namespace = "auth"):
 *   auth:session:<userId>:<sessionId>          -> JSON(SessionRecord) (EX=SESSION_TTL)
 *   auth:session:index:<userId>                -> SET از <sessionId> (برای سازگاری)
 *   auth:session:index:z:<userId>              -> ZSET از <sessionId> با score=lastUsedAt
 *   auth:session:jtis:<userId>:<sessionId>     -> SET از <jti>های رفرش
 *   auth:session:jti:index:<jti>               -> "<userId>:<sessionId>" (reverse map)
 */
@Injectable()
export class SessionService {
  private static readonly NS = 'auth';
  private readonly sessionTtlSec: number;

  constructor(
    @Inject('REDIS') private readonly redis: Redis,
    private readonly config: ConfigService<AllConfig>,
  ) {
    // SESSION_TTL مثل "45d" یا "2592000" (ثانیه). پیش‌فرض: 45 روز
    const raw = this.config.get<string>('SESSION_TTL') ?? '45d';
    this.sessionTtlSec = parseDurationToSeconds(raw, 45 * 24 * 3600);
  }

  // ------------------------ Public API ------------------------

  /**
   * ساخت سشن جدید (API هماهنگ با کنترلر/سرویس‌های تو)
   */
  async create(input: CreateSessionInput): Promise<SessionRecord> {
    const now = Date.now();
    const sid = randomUUID();

    const rec: SessionRecord = {
      id: sid,
      userId: input.userId,
      ip: input.ip,
      userAgent: input.userAgent,
      device: input.device,
      createdAt: now,
      lastUsedAt: now,
    };

    await this.redis
      .multi()
      .set(
        this.keySession(input.userId, sid),
        JSON.stringify(rec),
        'EX',
        this.sessionTtlSec,
      )
      .sadd(this.keyIndex(input.userId), sid) // سازگاری با کدهای قدیمی
      .zadd(this.keyIndexZ(input.userId), rec.lastUsedAt, sid) // ایندکس مرتب برای pagination
      .exec();

    return rec;
  }

  /** دریافت یک سشن؛ اگر نبود → null */
  async get(userId: string, sessionId: string): Promise<SessionRecord | null> {
    const data = await this.redis.get(this.keySession(userId, sessionId));
    return data ? (JSON.parse(data) as SessionRecord) : null;
  }

  /**
   * لیست همهٔ سشن‌های فعال کاربر (بدون pagination).
   * self-heal: اندیس‌های کهنه پاک می‌شوند.
   */
  async list(userId: string): Promise<SessionRecord[]> {
    const sids = await this.redis.smembers(this.keyIndex(userId));
    if (sids.length === 0) return [];

    const pipe = this.redis.pipeline();
    for (const sid of sids) pipe.get(this.keySession(userId, sid));
    const execRes = (await pipe.exec()) as Array<[Error | null, string | null]>;

    const items: SessionRecord[] = [];
    const stale: string[] = [];

    for (let i = 0; i < execRes.length; i++) {
      const val = execRes[i]?.[1];
      if (typeof val === 'string' && val.length > 0) {
        try {
          items.push(JSON.parse(val) as SessionRecord);
        } catch {
          stale.push(sids[i]!);
        }
      } else {
        stale.push(sids[i]!);
      }
    }

    if (stale.length) {
      const clean = this.redis.pipeline();
      for (const sid of stale) {
        clean.srem(this.keyIndex(userId), sid);
        clean.zrem(this.keyIndexZ(userId), sid);
      }
      await clean.exec();
    }

    items.sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
    return items;
  }

  /**
   * لیست صفحه‌بندی شده بر اساس lastUsedAt (جدیدترین‌ها اول)
   */
  async listPage(
    userId: string,
    opts: ListPageOptions = {},
  ): Promise<SessionRecord[]> {
    const offset = Math.max(0, opts.offset ?? 0);
    const limit = Math.max(1, opts.limit ?? 20);
    const start = offset;
    const stop = offset + limit - 1;

    const sids = await this.redis.zrevrange(
      this.keyIndexZ(userId),
      start,
      stop,
    );
    if (sids.length === 0) return [];

    const pipe = this.redis.pipeline();
    for (const sid of sids) pipe.get(this.keySession(userId, sid));
    const execRes = (await pipe.exec()) as Array<[Error | null, string | null]>;

    const items: SessionRecord[] = [];
    const stale: string[] = [];

    for (let i = 0; i < execRes.length; i++) {
      const val = execRes[i]?.[1];
      const sid = sids[i]!;
      if (typeof val === 'string' && val.length > 0) {
        try {
          items.push(JSON.parse(val) as SessionRecord);
        } catch {
          stale.push(sid);
        }
      } else {
        stale.push(sid);
      }
    }

    if (stale.length) {
      const clean = this.redis.pipeline();
      for (const sid of stale) {
        clean.srem(this.keyIndex(userId), sid);
        clean.zrem(this.keyIndexZ(userId), sid);
      }
      await clean.exec();
    }

    return items; // zrevrange خودش جدید→قدیم برمی‌گرداند
  }

  /** تاچ کردن سشن: آپدیت lastUsedAt + تمدید TTL + آپدیت ZSET */
  async touch(userId: string, sessionId: string): Promise<SessionRecord> {
    const key = this.keySession(userId, sessionId);
    const data = await this.redis.get(key);
    if (!data) throw new NotFoundException('Session not found.');

    const rec = JSON.parse(data) as SessionRecord;
    rec.lastUsedAt = Date.now();

    await this.redis
      .multi()
      .set(key, JSON.stringify(rec), 'EX', this.sessionTtlSec)
      .zadd(this.keyIndexZ(userId), rec.lastUsedAt, sessionId)
      .exec();

    return rec;
  }

  /**
   * لینک‌کردن JTI رفرش به سشن (برای revoke per-session)
   * و ساخت reverse-index برای lookup با JTI.
   */
  async linkRefreshJti(
    userId: string,
    sessionId: string,
    jti: string,
  ): Promise<void> {
    await this.redis
      .multi()
      .sadd(this.keySessionJtis(userId, sessionId), jti)
      .set(
        this.keyJtiIndex(jti),
        `${userId}:${sessionId}`,
        'EX',
        this.sessionTtlSec,
      )
      .exec();
  }

  /** unlink یک JTI از سشن (در مواقع rotate/cleanup) */
  async unlinkRefreshJti(
    userId: string,
    sessionId: string,
    jti: string,
  ): Promise<void> {
    await this.redis
      .multi()
      .srem(this.keySessionJtis(userId, sessionId), jti)
      .del(this.keyJtiIndex(jti))
      .exec();
  }

  /** با JTI، سشن مربوطه را پیدا می‌کند؛ اگر نبود → null */
  async findSessionByJti(
    jti: string,
  ): Promise<{ userId: string; sessionId: string } | null> {
    const v = await this.redis.get(this.keyJtiIndex(jti));
    if (!v) return null;
    const [userId, sessionId] = v.split(':');
    return { userId, sessionId };
  }

  /**
   * revoke یک سشن:
   * - unlink همهٔ JTIها + حذف reverse-index
   * - حذف رکورد سشن + پاک‌سازی ایندکس‌ها
   * - (در صورت داشتن allow-list رفرش، آن را هم پاک کن)
   */
  async revoke(userId: string, sessionId: string): Promise<void> {
    const jtiKey = this.keySessionJtis(userId, sessionId);
    const jtis = await this.redis.smembers(jtiKey);

    const pipe = this.redis.pipeline();
    for (const jti of jtis) {
      pipe.del(this.keyJtiIndex(jti));
      pipe.del(refreshAllowKey(jti));
    }
    pipe.del(jtiKey);
    pipe.del(this.keySession(userId, sessionId));
    pipe.srem(this.keyIndex(userId), sessionId);
    pipe.zrem(this.keyIndexZ(userId), sessionId);

    await pipe.exec();
  }

  /** بستن همهٔ سشن‌های کاربر (logout all devices) */
  async revokeAll(userId: string): Promise<void> {
    const sids = await this.redis.smembers(this.keyIndex(userId));
    if (sids.length === 0) return;

    // 1) خواندن JTIهای هر سشن
    const readPipe = this.redis.pipeline();
    for (const sid of sids) readPipe.smembers(this.keySessionJtis(userId, sid));
    const jtiResults = (await readPipe.exec()) as Array<
      [Error | null, string[] | null]
    >;

    // 2) حذف‌ها
    const delPipe = this.redis.pipeline();
    for (let i = 0; i < sids.length; i++) {
      const sid = sids[i]!;
      const tuple = jtiResults?.[i];
      const jtis = Array.isArray(tuple?.[1]) ? (tuple![1] as string[]) : [];

      for (const jti of jtis) {
        delPipe.del(this.keyJtiIndex(jti));
        delPipe.del(refreshAllowKey(jti));
      }

      delPipe.del(this.keySessionJtis(userId, sid));
      delPipe.del(this.keySession(userId, sid));
      delPipe.srem(this.keyIndex(userId), sid);
      delPipe.zrem(this.keyIndexZ(userId), sid);
    }

    await delPipe.exec();
  }

  // ------------------------ Keys & helpers ------------------------

  private keySession(userId: string, sessionId: string): string {
    return `${SessionService.NS}:session:${userId}:${sessionId}`;
  }
  private keyIndex(userId: string): string {
    return `${SessionService.NS}:session:index:${userId}`;
  }
  private keyIndexZ(userId: string): string {
    return `${SessionService.NS}:session:index:z:${userId}`;
  }
  private keySessionJtis(userId: string, sessionId: string): string {
    return `${SessionService.NS}:session:jtis:${userId}:${sessionId}`;
  }
  private keyJtiIndex(jti: string): string {
    return `${SessionService.NS}:session:jti:index:${jti}`;
  }

}

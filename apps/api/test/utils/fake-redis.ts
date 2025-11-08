type CommandResult<T = unknown> = [Error | null, T];

class FakeRedisPipeline {
  private readonly commands: Array<() => Promise<unknown>> = [];

  constructor(private readonly redis: FakeRedis) {}

  set(...args: Parameters<FakeRedis['set']>) {
    this.commands.push(() => this.redis.set(...args));
    return this;
  }

  get(...args: Parameters<FakeRedis['get']>) {
    this.commands.push(() => this.redis.get(...args));
    return this;
  }

  del(...args: Parameters<FakeRedis['del']>) {
    this.commands.push(() => this.redis.del(...args));
    return this;
  }

  sadd(...args: Parameters<FakeRedis['sadd']>) {
    this.commands.push(() => this.redis.sadd(...args));
    return this;
  }

  srem(...args: Parameters<FakeRedis['srem']>) {
    this.commands.push(() => this.redis.srem(...args));
    return this;
  }

  smembers(...args: Parameters<FakeRedis['smembers']>) {
    this.commands.push(() => this.redis.smembers(...args));
    return this;
  }

  zadd(...args: Parameters<FakeRedis['zadd']>) {
    this.commands.push(() => this.redis.zadd(...args));
    return this;
  }

  zrem(...args: Parameters<FakeRedis['zrem']>) {
    this.commands.push(() => this.redis.zrem(...args));
    return this;
  }

  zrevrange(...args: Parameters<FakeRedis['zrevrange']>) {
    this.commands.push(() => this.redis.zrevrange(...args));
    return this;
  }

  exec(): Promise<CommandResult[]> {
    return Promise.all(
      this.commands.map(async (command) => {
        try {
          const result = await command();
          return [null, result] as CommandResult;
        } catch (error) {
          return [error as Error, null] as CommandResult;
        }
      }),
    );
  }
}

export class FakeRedis {
  private readonly values = new Map<string, string>();
  private readonly sets = new Map<string, Set<string>>();
  private readonly zsets = new Map<string, Map<string, number>>();
  private readonly expirations = new Map<string, number>();

  pipeline() {
    return new FakeRedisPipeline(this);
  }

  multi() {
    return new FakeRedisPipeline(this);
  }

  async set(
    key: string,
    value: string,
    mode?: 'EX',
    ttl?: number,
  ): Promise<'OK'> {
    this.values.set(key, value);
    if (mode === 'EX' && typeof ttl === 'number') {
      this.scheduleExpiration(key, ttl * 1000);
    } else {
      this.expirations.delete(key);
    }
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    if (this.isExpired(key)) {
      return null;
    }
    return this.values.has(key) ? this.values.get(key)! : null;
  }

  async getdel(key: string): Promise<string | null> {
    const value = await this.get(key);
    await this.del(key);
    return value;
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.values.delete(key)) removed++;
      this.expirations.delete(key);
      const set = this.sets.get(key);
      if (set) {
        removed += set.size;
        this.sets.delete(key);
      }
      if (this.zsets.delete(key)) {
        removed++;
      }
    }
    return removed;
  }

  async sadd(key: string, member: string): Promise<number> {
    const set = this.ensureSet(key);
    const before = set.size;
    set.add(member);
    return set.size - before;
  }

  async srem(key: string, member: string): Promise<number> {
    const set = this.ensureSet(key, false);
    if (!set) return 0;
    return set.delete(member) ? 1 : 0;
  }

  async smembers(key: string): Promise<string[]> {
    const set = this.ensureSet(key, false);
    return set ? Array.from(set.values()) : [];
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    const zset = this.ensureZSet(key);
    const existed = zset.has(member);
    zset.set(member, score);
    return existed ? 0 : 1;
  }

  async zrem(key: string, member: string): Promise<number> {
    const zset = this.ensureZSet(key, false);
    if (!zset) return 0;
    return zset.delete(member) ? 1 : 0;
  }

  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    const zset = this.ensureZSet(key, false);
    if (!zset) return [];
    const sorted = Array.from(zset.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([member]) => member);
    const normalizedStop = stop >= 0 ? stop : sorted.length + stop;
    return sorted.slice(start, normalizedStop + 1);
  }

  async expire(key: string, ttl: number): Promise<number> {
    if (!this.values.has(key)) return 0;
    if (ttl <= 0) {
      await this.del(key);
      return 1;
    }
    this.scheduleExpiration(key, ttl * 1000);
    return 1;
  }

  async incr(key: string): Promise<number> {
    if (this.isExpired(key)) {
      // freshly expired -> treat as absent
    }
    const current = Number(this.values.get(key) ?? '0');
    const next = current + 1;
    this.values.set(key, String(next));
    return next;
  }

  async ttl(key: string): Promise<number> {
    if (!this.values.has(key)) return -2;
    const expiry = this.expirations.get(key);
    if (!expiry) return -1;
    const msLeft = expiry - Date.now();
    if (msLeft <= 0) {
      this.values.delete(key);
      this.expirations.delete(key);
      return -2;
    }
    return Math.ceil(msLeft / 1000);
  }

  async keys(pattern: string): Promise<string[]> {
    this.purgeExpiredValues();
    const escaped = pattern.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&');
    const regex = new RegExp(`^${escaped.replace(/\\\*/g, '.*')}$`);
    const bag = new Set<string>([
      ...this.values.keys(),
      ...this.sets.keys(),
      ...this.zsets.keys(),
    ]);
    return Array.from(bag).filter((key) => regex.test(key));
  }

  private ensureSet(key: string): Set<string>;
  private ensureSet(key: string, create: false): Set<string> | undefined;
  private ensureSet(key: string, create = true): Set<string> | undefined {
    if (!this.sets.has(key) && create) {
      this.sets.set(key, new Set());
    }
    return this.sets.get(key);
  }

  private ensureZSet(key: string): Map<string, number>;
  private ensureZSet(
    key: string,
    create: false,
  ): Map<string, number> | undefined;
  private ensureZSet(
    key: string,
    create = true,
  ): Map<string, number> | undefined {
    if (!this.zsets.has(key) && create) {
      this.zsets.set(key, new Map());
    }
    return this.zsets.get(key);
  }

  private scheduleExpiration(key: string, ttlMs: number): void {
    const expiresAt = Date.now() + ttlMs;
    this.expirations.set(key, expiresAt);
    const ms = Math.min(Math.max(ttlMs, 0), 0x7fffffff);
    const timeout = setTimeout(() => {
      this.values.delete(key);
      this.expirations.delete(key);
    }, ms);
    (timeout as any).unref?.();
  }

  private isExpired(key: string): boolean {
    const expiry = this.expirations.get(key);
    if (!expiry) {
      return false;
    }
    if (expiry <= Date.now()) {
      this.expirations.delete(key);
      this.values.delete(key);
      return true;
    }
    return false;
  }

  private purgeExpiredValues(): void {
    for (const key of Array.from(this.expirations.keys())) {
      this.isExpired(key);
    }
  }
}

export type FakeRedisType = FakeRedis;

export const createFakeRedis = (): FakeRedis => new FakeRedis();

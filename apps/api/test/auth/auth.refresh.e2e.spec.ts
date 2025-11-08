import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { AuthController } from '@app/core/auth/auth.controller';
import { PasswordService } from '@app/core/auth/password/password.service';
import { RefreshService } from '@app/core/auth/refresh.service';
import { RefreshRateLimitService } from '@app/core/auth/refresh-rate-limit.service';
import { SessionService } from '@app/core/auth/session/session.service';
import { TokenService } from '@app/core/auth/token/token.service';
import { UsersService } from '@app/core/users/users.service';
import { TransformResponseInterceptor } from '@app/common/interceptors/transform-response.interceptor';
import { HttpExceptionFilter } from '@app/common/filters/http-exception.filter';
import { RoleName } from '@app/prisma/prisma.constants';
import { createFakeRedis, FakeRedisType } from '@test/utils/fake-redis';
import { refreshAllowKey } from '@app/core/auth/auth.constants';
import { decode } from 'jsonwebtoken';

const frontendOrigin = 'http://localhost:3000';

class ConfigServiceStub {
  constructor(private readonly overrides: Record<string, any> = {}) {}

  get<T = unknown>(key: string): T | undefined {
    if (key === 'auth') {
      return (this.overrides.auth ?? ConfigServiceStub.defaultAuth) as T;
    }
    if (key in this.overrides) {
      return this.overrides[key] as T;
    }
    return (ConfigServiceStub.defaults[key] ?? undefined) as T;
  }

  static defaultAuth = {
    accessSecret: 'e2e-access-secret',
    accessExpires: '5m',
    refreshSecret: 'e2e-refresh-secret',
    refreshExpires: '7d',
    cookie: {
      sameSite: 'lax' as const,
      secure: false,
      refreshPath: '/api/auth/refresh',
      accessPath: '/',
    },
  };

  static defaults: Record<string, any> = {
    GLOBAL_PREFIX: 'api',
    FRONTEND_URL: frontendOrigin,
    CORS_ORIGIN: frontendOrigin,
    corsOrigins: undefined,
    SESSION_TTL: '30d',
    REFRESH_RL_MAX: '100',
    REFRESH_RL_WINDOW: '10',
  };
}

class StubPasswordService {
  async login(identifier: string, password: string) {
    if (
      ['negare_user', 'user@example.com'].includes(identifier) &&
      password === 'Password!1'
    ) {
      return { userId: 'user-1' };
    }
    throw new Error('Invalid credentials');
  }
}

const usersServiceStub = {
  ensureActiveWithRoles: jest.fn().mockImplementation(async (userId: string) => ({
    id: userId,
    username: 'negare_user',
    userRoles: [{ role: { name: RoleName.USER } }],
  })),
};

const flushRedis = async (redis: FakeRedisType) => {
  const keys = await redis.keys('*');
  if (keys.length) {
    await redis.del(...keys);
  }
};

const extractCookie = (setCookie: string[] | string | undefined, name: string) => {
  const list = Array.isArray(setCookie)
    ? setCookie
    : setCookie
    ? [setCookie]
    : [];
  const target = list.find((entry) => entry.startsWith(`${name}=`));
  if (!target) return null;
  const token = target.split(';')[0]?.split('=').slice(1).join('=');
  return {
    raw: target,
    value: token,
  };
};

const login = async (server: any) => {
  const res = await request(server)
    .post('/api/auth/login')
    .set('Origin', frontendOrigin)
    .send({ identifier: 'negare_user', password: 'Password!1' })
    .expect(200);
  const cookie = extractCookie(res.headers['set-cookie'], 'refresh_token');
  if (!cookie) {
    throw new Error('refresh cookie missing');
  }
  return { res, cookie };
};

describe('Auth refresh endpoint (dev config)', () => {
  let app: INestApplication;
  let server: any;
  let redis: FakeRedisType;

  beforeAll(async () => {
    redis = createFakeRedis();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        TokenService,
        SessionService,
        RefreshService,
        RefreshRateLimitService,
        { provide: PasswordService, useClass: StubPasswordService },
        { provide: UsersService, useValue: usersServiceStub },
        { provide: ConfigService, useValue: new ConfigServiceStub() },
        { provide: 'REDIS', useValue: redis },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new TransformResponseInterceptor());
    app.enableCors({ origin: frontendOrigin, credentials: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await flushRedis(redis);
    usersServiceStub.ensureActiveWithRoles.mockClear();
  });

  it('login sets refresh cookie with expected flags and allow-list entry', async () => {
    const { res, cookie } = await login(server);

    expect(res.body.success).toBe(true);
    expect(cookie.raw).toContain('Path=/api/auth/refresh');
    expect(cookie.raw).toContain('SameSite=Lax');
    expect(cookie.raw).not.toMatch(/Secure/i);

    const keys = await redis.keys('auth:refresh:allow:*');
    expect(keys.length).toBe(1);
    expect(await redis.get(keys[0]!)).toContain('"userId":"user-1"');
  });

  it('refresh rotates cookie, deletes old allow-list key, and blacklists jti', async () => {
    const { cookie } = await login(server);
    const oldToken = cookie.value;
    const oldPayload = decode(oldToken) as { jti: string };
    const oldJti = oldPayload?.jti;
    expect(oldJti).toBeDefined();

    const refreshRes = await request(server)
      .post('/api/auth/refresh')
      .set('Origin', frontendOrigin)
      .set('Content-Type', 'application/json')
      .set('Cookie', cookie.raw)
      .send({})
      .expect(200);

    expect(refreshRes.body.success).toBe(true);
    expect(refreshRes.body.data.accessToken).toEqual(expect.any(String));
    const newCookie = extractCookie(refreshRes.headers['set-cookie'], 'refresh_token');
    expect(newCookie).not.toBeNull();
    expect(newCookie!.value).not.toEqual(oldToken);
    expect(newCookie!.raw).toContain('Path=/api/auth/refresh');

    expect(await redis.get(refreshAllowKey(oldJti!))).toBeNull();
    const blacklist = await redis.get(`auth:rbl:${oldJti}`);
    expect(blacklist).toBe('1');

    const newPayload = decode(newCookie!.value) as { jti: string };
    expect(await redis.get(refreshAllowKey(newPayload.jti))).toBeTruthy();
  });

  it('returns 401 when cookie is missing', async () => {
    const res = await request(server)
      .post('/api/auth/refresh')
      .set('Origin', frontendOrigin)
      .set('Content-Type', 'application/json')
      .send({})
      .expect(401);

    expect(res.body.message).toContain('No refresh cookie');
  });

  it('fails second refresh with the same cookie (concurrency)', async () => {
    const { cookie } = await login(server);

    await request(server)
      .post('/api/auth/refresh')
      .set('Origin', frontendOrigin)
      .set('Content-Type', 'application/json')
      .set('Cookie', cookie.raw)
      .send({})
      .expect(200);

    const res = await request(server)
      .post('/api/auth/refresh')
      .set('Origin', frontendOrigin)
      .set('Content-Type', 'application/json')
      .set('Cookie', cookie.raw)
      .send({})
      .expect(401);

    expect(res.body.message).toContain('Invalid or expired refresh token');
  });

  it('rejects malformed allow-list records', async () => {
    const { cookie } = await login(server);
    const payload = decode(cookie.value) as { jti: string };
    await redis.set(refreshAllowKey(payload.jti), 'not-json');

    const res = await request(server)
      .post('/api/auth/refresh')
      .set('Origin', frontendOrigin)
      .set('Content-Type', 'application/json')
      .set('Cookie', cookie.raw)
      .send({})
      .expect(401);

    expect(res.body.message).toContain('Malformed refresh token state');
  });

  it('rejects session mismatches', async () => {
    const { cookie } = await login(server);
    const payload = decode(cookie.value) as { jti: string };
    await redis.set(
      refreshAllowKey(payload.jti),
      JSON.stringify({ userId: 'user-1', sessionId: 'different' }),
    );

    const res = await request(server)
      .post('/api/auth/refresh')
      .set('Origin', frontendOrigin)
      .set('Content-Type', 'application/json')
      .set('Cookie', cookie.raw)
      .send({})
      .expect(401);

    expect(res.body.message).toContain('session mismatch');
  });

  it('returns 403 when Origin does not match FRONTEND_URL', async () => {
    const { cookie } = await login(server);

    const res = await request(server)
      .post('/api/auth/refresh')
      .set('Origin', 'http://malicious.test')
      .set('Content-Type', 'application/json')
      .set('Cookie', cookie.raw)
      .send({})
      .expect(403);

    expect(res.body.message).toContain('Origin is not allowed');
  });

  it('returns 400 when Content-Type is not application/json', async () => {
    const { cookie } = await login(server);

    const res = await request(server)
      .post('/api/auth/refresh')
      .set('Origin', frontendOrigin)
      .set('Content-Type', 'text/plain')
      .set('Cookie', cookie.raw)
      .send('noop')
      .expect(400);

    expect(res.body.message).toContain('Content-Type must be application/json');
  });
});

describe('Auth refresh endpoint (prod cookie flags)', () => {
  let app: INestApplication;
  let server: any;
  let redis: FakeRedisType;

  beforeAll(async () => {
    redis = createFakeRedis();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        TokenService,
        SessionService,
        RefreshService,
        RefreshRateLimitService,
        { provide: PasswordService, useClass: StubPasswordService },
        { provide: UsersService, useValue: usersServiceStub },
        {
          provide: ConfigService,
          useValue: new ConfigServiceStub({
            auth: {
              ...ConfigServiceStub.defaultAuth,
              cookie: {
                sameSite: 'none',
                secure: true,
                refreshPath: '/api/auth/refresh',
                accessPath: '/',
              },
            },
            REFRESH_RL_MAX: '50',
          }),
        },
        { provide: 'REDIS', useValue: redis },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new TransformResponseInterceptor());
    app.enableCors({ origin: frontendOrigin, credentials: true });
    app.setGlobalPrefix('api');
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await flushRedis(redis);
    usersServiceStub.ensureActiveWithRoles.mockClear();
  });

  it('issues Secure + SameSite=None refresh cookies', async () => {
    const { cookie } = await login(server);
    expect(cookie.raw).toContain('SameSite=None');
    expect(cookie.raw).toMatch(/Secure/i);
  });
});

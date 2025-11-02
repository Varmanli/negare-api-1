import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { newDb } from 'pg-mem';
import pg from 'pg';
import bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import { AuthModule } from '@app/core/auth/auth.module';
import { CoreModule } from '../../core/core.module';
import { User } from '@app/core/users/user.entity';
import { Role } from '@app/core/roles/entities/role.entity';
import { UserRole } from '@app/core/roles/entities/user-role.entity';
import { Wallet } from '@app/core/wallet/wallet.entity';
import { WalletTransaction } from '@app/core/wallet/wallet-transaction.entity';
import { NotificationsModule } from '../../notifications/notifications.module';
import { HttpExceptionFilter } from '@app/common/filters/http-exception.filter';
import { TracingInterceptor } from '@app/common/interceptors/tracing.interceptor';
import { TransformResponseInterceptor } from '@app/common/interceptors/transform-response.interceptor';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { authConfig } from '@app/config/auth.config';

describe('CoreModule (e2e)', () => {
  let app: INestApplication;
  let userRepository: Repository<User>;

  const adminHeader = {
    'x-mock-user': JSON.stringify({ id: 'admin-user', roles: ['admin'] }),
  };

  async function createTestingApp(): Promise<INestApplication> {
    const db = newDb({ autoCreateForeignKeyIndices: true });
    const pgMem = db.adapters.createPg();
    Object.assign(pg, pgMem);
    const publicSchema = db.public;
    publicSchema.registerFunction({
      name: 'uuid_generate_v4',
      implementation: () => randomUUID(),
    });
    publicSchema.registerFunction({
      name: 'version',
      implementation: () => 'PostgreSQL 14.0 (pg-mem)',
    });
    publicSchema.registerFunction({
      name: 'current_database',
      implementation: () => 'pg_mem',
    });

    const dataSource = await db.adapters.createTypeormDataSource({
      type: 'postgres',
      database: 'test',
      username: 'test',
      password: 'test',
      synchronize: true,
      entities: [User, Role, UserRole, Wallet, WalletTransaction],
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          cache: true,
          expandVariables: true,
          envFilePath: ['.env.test', '.env'],
          load: [authConfig],
        }),
        TypeOrmModule.forRootAsync({
          useFactory: async () => ({
            type: 'postgres',
            database: 'test',
            username: 'test',
            password: 'test',
            entities: [User, Role, UserRole, Wallet, WalletTransaction],
            synchronize: true,
            dataSourceFactory: async () => {
              if (!dataSource.isInitialized) {
                await dataSource.initialize();
              }
              return dataSource;
            },
          }),
        }),
        AuthModule,
        NotificationsModule,
        CoreModule,
      ],
    })
      .overrideProvider('KAVENEGAR_CLIENT')
      .useValue({ send: jest.fn().mockResolvedValue({ status: 'ok' }) })
      .overrideProvider('REDIS')
      .useValue(createInMemoryRedis())
      .compile();

    const nestApp = moduleFixture.createNestApplication();

    nestApp.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
        forbidNonWhitelisted: true,
      }),
    );
    nestApp.useGlobalFilters(new HttpExceptionFilter());
    nestApp.useGlobalInterceptors(
      new TracingInterceptor(),
      new TransformResponseInterceptor(),
    );
    nestApp.use(cookieParser());

    const config = new DocumentBuilder()
      .setTitle('Test API')
      .setDescription('Test docs')
      .setVersion('1.0.0')
      .build();
    const swaggerDocument = SwaggerModule.createDocument(nestApp, config);
    SwaggerModule.setup('/api/docs', nestApp, swaggerDocument);

    await nestApp.init();

    return nestApp;
  }

  beforeEach(async () => {
    app = await createTestingApp();
    userRepository = app.get<Repository<User>>(getRepositoryToken(User));
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  async function createUser(
    username: string,
    email: string,
  ): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/core/users')
      .set(adminHeader)
      .send({
        username,
        email,
        password: 'Password123!',
      })
      .expect(201);

    return response.body.data.id;
  }

  async function ensureWallet(userId: string) {
    await request(app.getHttpServer())
      .post(`/core/wallets/${userId}`)
      .set(adminHeader)
      .send({})
      .expect(201);
  }

  async function setUserPassword(
    userId: string,
    password = 'P@ssw0rd!',
  ): Promise<void> {
    const user = await userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }
    user.passwordHash = await bcrypt.hash(password, 10);
    await userRepository.save(user);
  }

  function userHeader(userId: string, roles: string[] = ['user']) {
    return {
      'x-mock-user': JSON.stringify({ id: userId, roles }),
    };
  }

  function findCookie(cookies: string[], name: string): string | undefined {
    return cookies.find((cookie) => cookie.startsWith(`${name}=`));
  }

  function joinCookies(...cookies: Array<string | undefined>): string {
    return cookies
      .filter(
        (cookie): cookie is string =>
          typeof cookie === 'string' && cookie.length > 0,
      )
      .join('; ');
  }

  function createInMemoryRedis() {
    const store = new Map<string, string>();
    return {
      get: jest.fn(async (key: string) => store.get(key) ?? null),
      set: jest.fn(
        async (
          key: string,
          value: string,
          _mode?: string,
          _ttl?: number,
        ) => {
          store.set(key, value);
          return 'OK';
        },
      ),
      del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    };
  }

  async function loginAs(userId: string, email: string) {
    await setUserPassword(userId);
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ identifier: email, password: 'P@ssw0rd!' })
      .expect(200);

    const cookies = response.get('Set-Cookie') ?? [];
    return {
      accessToken: response.body.accessToken as string,
      refreshToken: response.body.refreshToken as string,
      cookieHeader: joinCookies(...cookies),
    };
  }

  it('rejects profile access without authentication', async () => {
    await request(app.getHttpServer()).get('/core/profile').expect(401);
  });

  it('returns profile with non-cacheable headers for authenticated user', async () => {
    const email = 'profile_cache_user@example.com';
    const userId = await createUser('profile_cache_user', email);
    const { accessToken } = await loginAs(userId, email);

    const response = await request(app.getHttpServer())
      .get('/core/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.id).toEqual(userId);
    expect(response.headers['cache-control']).toEqual('no-store');
    expect(response.headers.pragma).toEqual('no-cache');
    expect(response.headers.expires).toEqual('0');
  });

  it('returns 400 when attempting to update email or phone fields', async () => {
    const email = 'profile_forbidden_fields@example.com';
    const userId = await createUser('profile_forbidden_fields', email);
    const { accessToken } = await loginAs(userId, email);

    await request(app.getHttpServer())
      .patch('/core/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ email: 'new-email@example.com' })
      .expect(400);

    await request(app.getHttpServer())
      .patch('/core/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ phone: '09120000000' })
      .expect(400);
  });

  it('issues HttpOnly access and refresh cookies across the auth lifecycle', async () => {
    const email = 'authcookie@example.com';
    const userId = await createUser('auth_cookie_user', email);
    await setUserPassword(userId);

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ identifier: email, password: 'P@ssw0rd!' })
      .expect(200);

    expect(loginRes.body.accessToken).toBeDefined();
    expect(loginRes.body.refreshToken).toBeDefined();

    const loginCookies: string[] = loginRes.get('Set-Cookie') ?? [];
    const loginAccessCookie = findCookie(loginCookies, 'access_token');
    const loginRefreshCookie = findCookie(loginCookies, 'refresh_token');

    expect(loginAccessCookie).toBeDefined();
    expect(loginRefreshCookie).toBeDefined();

    const loginCookieHeader = joinCookies(loginAccessCookie, loginRefreshCookie);
    let currentAccessToken = loginRes.body.accessToken as string;

    const profileRes = await request(app.getHttpServer())
      .get('/core/profile')
      .set('Cookie', loginCookieHeader)
      .set('Authorization', `Bearer ${currentAccessToken}`)
      .expect(200);

    expect(profileRes.body.success).toBe(true);
    expect(profileRes.body.data.id).toEqual(userId);

    const cookieRefreshRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', loginCookieHeader)
      .set('Authorization', `Bearer ${currentAccessToken}`)
      .set(userHeader(userId))
      .send({})
      .expect(200);

    expect(cookieRefreshRes.body.accessToken).toBeDefined();
    expect(cookieRefreshRes.body.refreshToken).toBeDefined();
    currentAccessToken = cookieRefreshRes.body.accessToken as string;

    const cookieRefreshCookies: string[] =
      cookieRefreshRes.get('Set-Cookie') ?? [];
    const refreshedAccessCookie = findCookie(
      cookieRefreshCookies,
      'access_token',
    );
    const refreshedRefreshCookie = findCookie(
      cookieRefreshCookies,
      'refresh_token',
    );

    expect(refreshedAccessCookie).toBeDefined();
    expect(refreshedRefreshCookie).toBeDefined();

    const refreshedCookieHeader = joinCookies(
      refreshedAccessCookie,
      refreshedRefreshCookie,
    );

    await request(app.getHttpServer())
      .get('/core/profile')
      .set('Cookie', refreshedCookieHeader)
      .set('Authorization', `Bearer ${currentAccessToken}`)
      .expect(200);

    const fallbackRefreshRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Authorization', `Bearer ${currentAccessToken}`)
      .set(userHeader(userId))
      .send({ refreshToken: cookieRefreshRes.body.refreshToken })
      .expect(200);

    expect(fallbackRefreshRes.body.accessToken).toBeDefined();
    expect(fallbackRefreshRes.body.refreshToken).toBeDefined();
    currentAccessToken = fallbackRefreshRes.body.accessToken as string;

    const fallbackCookies: string[] = fallbackRefreshRes.get('Set-Cookie') ?? [];
    const latestAccessCookie = findCookie(fallbackCookies, 'access_token');
    const latestRefreshCookie = findCookie(fallbackCookies, 'refresh_token');

    expect(latestAccessCookie).toBeDefined();
    expect(latestRefreshCookie).toBeDefined();

    const latestCookieHeader = joinCookies(
      latestAccessCookie,
      latestRefreshCookie,
    );

    const logoutRes = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', latestCookieHeader)
      .set('Authorization', `Bearer ${currentAccessToken}`)
      .set(userHeader(userId))
      .send({})
      .expect(200);

    const clearedCookies: string[] = logoutRes.get('Set-Cookie') ?? [];
    expect(
      clearedCookies.some(
        (cookie) =>
          cookie.startsWith('access_token=') &&
          (cookie.includes('Expires=') || cookie.includes('Max-Age=0')),
      ),
    ).toBe(true);
    expect(
      clearedCookies.some(
        (cookie) =>
          cookie.startsWith('refresh_token=') &&
          (cookie.includes('Expires=') || cookie.includes('Max-Age=0')),
      ),
    ).toBe(true);

    await request(app.getHttpServer())
      .get('/core/profile')
      .set('Cookie', latestCookieHeader)
      .expect(401);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: fallbackRefreshRes.body.refreshToken })
      .expect(401);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', latestCookieHeader)
      .send({})
      .expect(401);
  });

  it('creates user, credits and debits wallet, then returns balance', async () => {
    const userId = await createUser('e2e_user1', 'e2e1@example.com');
    await ensureWallet(userId);

    await request(app.getHttpServer())
      .post(`/core/wallets/${userId}/credit`)
      .set(userHeader(userId))
      .send({
        amount: '2000',
        idempotencyKey: 'credit-flow-1',
        refType: 'order',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/core/wallets/${userId}/debit`)
      .set(userHeader(userId))
      .send({
        amount: '500',
        idempotencyKey: 'debit-flow-1',
        refType: 'payout',
      })
      .expect(201);

    const balanceRes = await request(app.getHttpServer())
      .get(`/core/wallets/${userId}/balance`)
      .set(userHeader(userId))
      .expect(200);

    expect(String(balanceRes.body.data.balance)).toEqual('1500.00');
  });

  it('prevents overdraft and returns structured error', async () => {
    const userId = await createUser('e2e_user2', 'e2e2@example.com');
    await ensureWallet(userId);

    await request(app.getHttpServer())
      .post(`/core/wallets/${userId}/credit`)
      .set(userHeader(userId))
      .send({
        amount: '100',
        idempotencyKey: 'credit-overdraft',
        refType: 'order',
      })
      .expect(201);

    const debitRes = await request(app.getHttpServer())
      .post(`/core/wallets/${userId}/debit`)
      .set(userHeader(userId))
      .send({
        amount: '200',
        idempotencyKey: 'debit-overdraft',
        refType: 'payout',
      })
      .expect(400);

    expect(debitRes.body.success).toBe(false);
    expect(debitRes.body.error.code).toEqual('INSUFFICIENT_FUNDS');
  });

  it('enforces owner or admin access for wallet operations', async () => {
    const userId = await createUser('e2e_user3', 'e2e3@example.com');
    await ensureWallet(userId);
    const otherUserId = await createUser('e2e_user4', 'e2e4@example.com');
    await ensureWallet(otherUserId);

    await request(app.getHttpServer())
      .post(`/core/wallets/${userId}/credit`)
      .set(userHeader(otherUserId))
      .send({
        amount: '100',
        idempotencyKey: 'unauthorized-credit',
        refType: 'order',
      })
      .expect(403);
  });

  it('returns same transaction when idempotency key is reused', async () => {
    const userId = await createUser('e2e_user5', 'e2e5@example.com');
    await ensureWallet(userId);

    const first = await request(app.getHttpServer())
      .post(`/core/wallets/${userId}/credit`)
      .set(userHeader(userId))
      .send({
        amount: '2000',
        idempotencyKey: 'idempotent-credit',
        refType: 'order',
      })
      .expect(201);

    const second = await request(app.getHttpServer())
      .post(`/core/wallets/${userId}/credit`)
      .set(userHeader(userId))
      .send({
        amount: '2000',
        idempotencyKey: 'idempotent-credit',
        refType: 'order',
      })
      .expect(201);

    expect(second.body.data.id).toEqual(first.body.data.id);

    const balanceRes = await request(app.getHttpServer())
      .get(`/core/wallets/${userId}/balance`)
      .set(userHeader(userId))
      .expect(200);

    expect(String(balanceRes.body.data.balance)).toEqual('2000.00');
  });
});


import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as request from 'supertest';
import { randomUUID } from 'node:crypto';
import { newDb } from 'pg-mem';
import * as pg from 'pg';
import * as bcrypt from 'bcrypt';
import * as cookieParser from 'cookie-parser';
import { AuthModule } from '../../auth/auth.module';
import { CoreModule } from '../../core/core.module';
import { Role } from '../../core/roles/role.entity';
import { UserRole } from '../../core/user-roles/user-role.entity';
import { User } from '../../core/users/user.entity';
import { WalletTransaction } from '../../core/wallet-transactions/wallet-transaction.entity';
import { Wallet } from '../../core/wallets/wallet.entity';
import { NotificationsModule } from '../../notifications/notifications.module';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { TracingInterceptor } from '../../common/interceptors/tracing.interceptor';
import { TransformResponseInterceptor } from '../../common/interceptors/transform-response.interceptor';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

process.env.ACCESS_JWT_SECRET ??= 'test-access-secret';
process.env.REFRESH_JWT_SECRET ??= 'test-refresh-secret';
process.env.REFRESH_JWT_EXPIRES ??= '30d';
process.env.MOCK_AUTH_ENABLED ??= 'true';
process.env.COOKIE_SECURE ??= 'false';
process.env.COOKIE_SAMESITE ??= 'strict';
process.env.COOKIE_REFRESH_PATH ??= '/auth/refresh';

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
    }).compile();

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

  it('issues refresh token cookie and supports cookie + body refresh flows', async () => {
    const email = 'authcookie@example.com';
    const userId = await createUser('auth_cookie_user', email);
    await setUserPassword(userId);

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ identifier: email, password: 'P@ssw0rd!' })
      .expect(200);

    const loginCookies: string[] = loginRes.get('Set-Cookie') ?? [];
    expect(loginRes.body.refreshToken).toBeDefined();
    const loginCookie = loginCookies.find((cookie) =>
      cookie.startsWith('refresh_token='),
    );
    expect(loginCookie).toBeDefined();

    const cookieRefreshRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', loginCookie as string)
      .send({})
      .expect(200);

    const cookieRefreshCookies: string[] =
      cookieRefreshRes.get('Set-Cookie') ?? [];
    const cookieModeToken = cookieRefreshRes.body.refreshToken;
    expect(cookieModeToken).toBeDefined();
    const cookieFromCookieFlow = cookieRefreshCookies.find((cookie) =>
      cookie.startsWith('refresh_token='),
    );
    expect(cookieFromCookieFlow).toBeDefined();

    const legacyRefreshRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: cookieModeToken })
      .expect(200);

    const legacyCookies: string[] = legacyRefreshRes.get('Set-Cookie') ?? [];
    const latestCookie = legacyCookies.find((cookie) =>
      cookie.startsWith('refresh_token='),
    );
    expect(latestCookie).toBeDefined();
    const latestToken = legacyRefreshRes.body.refreshToken;
    expect(latestToken).toBeDefined();

    const logoutRes = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', latestCookie as string)
      .send({})
      .expect(200);

    const clearedCookies: string[] = logoutRes.get('Set-Cookie') ?? [];
    expect(
      clearedCookies.some(
        (cookie) =>
          cookie.startsWith('refresh_token=') &&
          (cookie.includes('Expires=') || cookie.includes('Max-Age=0')),
      ),
    ).toBe(true);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: latestToken })
      .expect(401);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', latestCookie as string)
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


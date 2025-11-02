import {
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { AuthController } from '@app/core/auth/auth.controller';
import { PasswordService } from '@app/core/auth/password/password.service';
import { RefreshService } from '@app/core/auth/refresh.service';
import { SessionService } from '@app/core/auth/session/session.service';
import { TokenService } from '@app/core/auth/token/token.service';
import { JwtAuthGuard } from '@app/core/auth/guards/jwt-auth.guard';
import { ProfileController } from '@app/core/users/profile/profile.controller';
import { ProfileService } from '@app/core/users/profile/profile.service';
import { UsersService } from '@app/core/users/users.service';
import { TransformResponseInterceptor } from '@app/common/interceptors/transform-response.interceptor';
import { HttpExceptionFilter } from '@app/common/filters/http-exception.filter';
import { RoleName } from '@app/prisma/prisma.constants';
import { createFakeRedis } from '@test/utils/fake-redis';
import type { Request, Response, NextFunction } from 'express';

const authConfig = {
  accessSecret: 'e2e-access-secret',
  accessExpires: '5m',
  refreshSecret: 'e2e-refresh-secret',
  refreshExpires: '7d',
  cookie: {
    sameSite: 'lax' as const,
    secure: false,
    refreshPath: '/',
    accessPath: '/',
  },
};

class ConfigServiceStub {
  get<T = any>(key: string): T | undefined {
    switch (key) {
      case 'auth':
        return authConfig as T;
      case 'SESSION_TTL':
        return '30d' as T;
      case 'GLOBAL_PREFIX':
        return 'api' as T;
      case 'CORS_ORIGIN':
        return 'http://localhost:3000' as T;
      case 'corsOrigins':
        return undefined;
      default:
        return undefined;
    }
  }
}

class StubPasswordService {
  async login(identifier: string, password: string) {
    if (
      ['negare_user', 'user@example.com'].includes(identifier) &&
      password === 'Password!1'
    ) {
      return { userId: 'user-1' };
    }
    throw new UnauthorizedException({
      code: 'InvalidCredentials',
      message: 'Invalid credentials.',
    });
  }
}

class StubProfileService {
  async getProfile(userId: string) {
    return {
      id: userId,
      username: 'negare_user',
      email: 'user@example.com',
      name: 'Negare User',
    };
  }

  async updateProfile(userId: string) {
    return this.getProfile(userId);
  }
}

describe('Auth flows (e2e)', () => {
  let app: INestApplication;
  let agent: ReturnType<typeof request.agent>;
  let redis: ReturnType<typeof createFakeRedis>;

  const usersServiceStub = {
    ensureActiveWithRoles: jest.fn().mockImplementation(async (userId: string) => ({
      id: userId,
      username: 'negare_user',
      userRoles: [{ role: { name: RoleName.USER } }],
    })),
  };

  beforeAll(async () => {
    redis = createFakeRedis();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AuthController, ProfileController],
      providers: [
        JwtAuthGuard,
        TokenService,
        SessionService,
        RefreshService,
        { provide: PasswordService, useClass: StubPasswordService },
        { provide: ProfileService, useClass: StubProfileService },
        { provide: ConfigService, useClass: ConfigServiceStub },
        { provide: 'REDIS', useValue: redis },
        { provide: UsersService, useValue: usersServiceStub },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new TransformResponseInterceptor());
    app.enableCors({
      origin: 'http://localhost:3000',
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      optionsSuccessStatus: 204,
    });
    app.use((_req: Request, res: Response, next: NextFunction) => {
      const existingVary = res.getHeader('Vary');
      const value = existingVary
        ? `${existingVary}, Origin`
        : 'Origin';
      res.setHeader('Vary', value);
      next();
    });
    app.setGlobalPrefix('api');

    await app.init();
    const server = app.getHttpServer();
    agent = request.agent(server as any);
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/auth/login issues tokens and sets refresh cookie (Path=/, HttpOnly)', async () => {
    const res = await agent
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({ identifier: 'negare_user', password: 'Password!1' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toEqual(expect.any(String));

    const setCookie = res.headers['set-cookie'];
    const cookies = Array.isArray(setCookie)
      ? setCookie
      : setCookie
      ? [setCookie]
      : [];
    const firstCookie = cookies[0] ?? '';
    expect(firstCookie).toContain('refresh_token=');
    expect(firstCookie).toContain('Path=/');
    expect(firstCookie).toContain('HttpOnly');
    expect(firstCookie).toMatch(/SameSite=Lax/i);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.headers['vary']).toContain('Cookie');
  });

  it('POST /api/auth/refresh rotates the refresh cookie and returns a new access token', async () => {
    const res = await agent
      .post('/api/auth/refresh')
      .set('Origin', 'http://localhost:3000')
      .send()
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    const setCookie = res.headers['set-cookie'];
    const cookies = Array.isArray(setCookie)
      ? setCookie
      : setCookie
      ? [setCookie]
      : [];
    expect(cookies).toEqual(
      expect.arrayContaining([expect.stringContaining('refresh_token=')]),
    );
    expect(cookies.join(';')).toContain('Path=/');
    expect(cookies.join(';')).toContain('HttpOnly');
  });

  it('GET /api/core/profile succeeds with bearer token', async () => {
    // refresh again to ensure we have a fresh access token
    const refreshRes = await agent.post('/api/auth/refresh').send().expect(200);
    const accessToken = refreshRes.body.data.accessToken;

    const res = await agent
      .get('/api/core/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      id: 'user-1',
      username: 'negare_user',
    });
  });

  it('POST /api/auth/logout revokes refresh cookie across paths', async () => {
    const res = await agent.post('/api/auth/logout').send().expect(200);
    expect(res.body.success).toBe(true);

    const setCookie = res.headers['set-cookie'];
    const cookies = Array.isArray(setCookie)
      ? setCookie
      : setCookie
      ? [setCookie]
      : [];
    expect(cookies.length).toBeGreaterThanOrEqual(1);
    expect(cookies.join(';')).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    expect(cookies.join(';')).toContain('Path=/');
  });

  it('CORS preflight honours credentials for auth endpoints', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/auth/login')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Content-Type')
      .expect(204);

    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['vary']).toContain('Origin');
  });
});

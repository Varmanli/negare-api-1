import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthController } from './auth.controller';

const authConfig = {
  accessSecret: 'spec-access',
  accessExpires: '10m',
  refreshSecret: 'spec-refresh',
  refreshExpires: '30d',
  cookie: {
    sameSite: 'lax' as const,
    secure: false,
    refreshPath: '/api/auth/refresh',
    accessPath: '/',
  },
};

class ConfigStub {
  get<T = unknown>(key: string): T | undefined {
    switch (key) {
      case 'auth':
        return authConfig as T;
      case 'FRONTEND_URL':
        return 'http://localhost:3000' as T;
      case 'CORS_ORIGIN':
        return 'http://localhost:3000' as T;
      default:
        return undefined;
    }
  }
}

const createResponseStub = () => {
  const headers: Record<string, string> = {};
  const cookies: Array<{ name: string; value: string; options: any }> = [];
  const cleared: Array<{ name: string; options: any }> = [];

  return {
    cookies,
    cleared,
    headers,
    cookie(name: string, value: string, options: any) {
      cookies.push({ name, value, options });
    },
    clearCookie(name: string, options: any) {
      cleared.push({ name, options });
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    getHeader(name: string) {
      return headers[name];
    },
  } as unknown as import('express').Response;
};

const baseRequest = (): Request =>
  ({
    cookies: {},
    headers: {
      'user-agent': 'jest',
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
    } as any,
    ips: [],
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' } as any,
  }) as Request;

describe('AuthController', () => {
  const refreshToken = 'refresh-token';
  const newRefreshToken = 'refresh-token-rotated';

  const createController = () => {
    const passwordService = {
      login: jest.fn().mockResolvedValue({ userId: 'user-1' }),
    };
    const refreshService = {
      issueTokensForUserId: jest
        .fn()
        .mockResolvedValue({
          accessToken: 'access-token',
          refreshToken,
        }),
      refresh: jest.fn().mockResolvedValue({
        accessToken: 'access-rotated',
        refreshToken: newRefreshToken,
      }),
      revoke: jest.fn().mockResolvedValue(undefined),
    };
    const sessionService = {
      create: jest.fn().mockResolvedValue({ id: 'sess-1', userId: 'user-1' }),
      revoke: jest.fn().mockResolvedValue(undefined),
    };
    const rateLimit = {
      consume: jest.fn().mockResolvedValue(undefined),
    };

    const controller = new AuthController(
      passwordService as any,
      refreshService as any,
      sessionService as any,
      new ConfigStub() as any,
      rateLimit as any,
    );

    return {
      controller,
      passwordService,
      refreshService,
      sessionService,
      rateLimit,
    };
  };

  it('logins, sets refresh cookie, and returns access token', async () => {
    const { controller, passwordService } = createController();
    const req = baseRequest();
    const res = createResponseStub();

    const result = await controller.login(
      { identifier: 'user@example.com', password: 'password' } as any,
      req,
      res,
    );

    expect(passwordService.login).toHaveBeenCalledWith(
      'user@example.com',
      'password',
      '127.0.0.1',
    );
    expect(result.accessToken).toBe('access-token');
    expect(res.cookies).toHaveLength(1);
    expect(res.cookies[0]).toMatchObject({
      name: 'refresh_token',
      value: refreshToken,
      options: expect.objectContaining({
        httpOnly: true,
        path: '/api/auth/refresh',
        sameSite: 'lax',
      }),
    });
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.headers['Vary']).toContain('Cookie');
  });

  it('refreshes tokens, rotates cookie, and rate-limits per ip+ua', async () => {
    const { controller, refreshService, rateLimit } = createController();
    const req = {
      ...baseRequest(),
      headers: {
        ...baseRequest().headers,
        cookie: `refresh_token=${refreshToken}`,
      },
      cookies: { refresh_token: refreshToken },
    } as Request;
    const res = createResponseStub();

    const result = await controller.refresh(req, res);

    expect(rateLimit.consume).toHaveBeenCalledWith('127.0.0.1|jest');
    expect(refreshService.refresh).toHaveBeenCalledWith(refreshToken);
    expect(result).toEqual({
      success: true,
      data: { accessToken: 'access-rotated' },
    });
    expect(res.cookies[0]).toMatchObject({
      name: 'refresh_token',
      value: newRefreshToken,
      options: expect.objectContaining({ path: '/api/auth/refresh' }),
    });
  });

  it('throws when refresh cookie is missing', async () => {
    const { controller } = createController();
    const req = baseRequest();
    const res = createResponseStub();

    await expect(controller.refresh(req, res)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('logs out, revokes refresh token, and clears cookie once', async () => {
    const { controller, refreshService } = createController();
    const req = {
      ...baseRequest(),
      cookies: { refresh_token: refreshToken },
    } as Request;
    const res = createResponseStub();

    const result = await controller.logout(req, {} as any, res);
    expect(result.success).toBe(true);
    expect(refreshService.revoke).toHaveBeenCalledWith(refreshToken);
    expect(res.cleared).toHaveLength(1);
    expect(res.cleared[0]).toMatchObject({
      name: 'refresh_token',
      options: expect.objectContaining({ path: '/api/auth/refresh' }),
    });
  });
});

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
    refreshPath: '/',
    accessPath: '/',
  },
};

class ConfigStub {
  get() {
    return authConfig;
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
    headers: { 'user-agent': 'jest' } as any,
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
      peekPayload: jest.fn().mockImplementation(async (_token: string) => ({
        sub: 'user-1',
        sid: 'sess-1',
        jti: 'jti-1',
        typ: 'refresh',
      })),
      revoke: jest.fn().mockResolvedValue(undefined),
    };
    const sessionService = {
      create: jest.fn().mockResolvedValue({ id: 'sess-1', userId: 'user-1' }),
      touch: jest.fn().mockResolvedValue(undefined),
      revoke: jest.fn().mockResolvedValue(undefined),
      findSessionByJti: jest.fn().mockResolvedValue({
        userId: 'user-1',
        sessionId: 'sess-1',
      }),
    };

    const controller = new AuthController(
      passwordService as any,
      refreshService as any,
      sessionService as any,
      new ConfigStub() as any,
    );

    return { controller, passwordService, refreshService, sessionService };
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
        path: '/',
        sameSite: 'lax',
      }),
    });
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.headers['Vary']).toContain('Cookie');
  });

  it('refreshes tokens, rotates cookie, and touches session', async () => {
    const { controller, refreshService, sessionService } = createController();
    const req = {
      ...baseRequest(),
      cookies: { refresh_token: refreshToken },
    } as Request;
    const res = createResponseStub();

    const result = await controller.refresh(req, {} as any, res);

    expect(refreshService.refresh).toHaveBeenCalledWith(refreshToken);
    expect(result.accessToken).toBe('access-rotated');
    expect(res.cookies[0]).toMatchObject({
      name: 'refresh_token',
      value: newRefreshToken,
      options: expect.objectContaining({ path: '/' }),
    });
    expect(sessionService.touch).toHaveBeenCalledWith('user-1', 'sess-1');
    expect(res.cleared.map((c) => c.options.path)).toEqual([
      '/api/auth',
      '/api',
      '/',
    ]);
  });

  it('logs out, revokes refresh token, and clears cookies', async () => {
    const { controller, refreshService, sessionService } = createController();
    const req = {
      ...baseRequest(),
      cookies: { refresh_token: refreshToken },
    } as Request;
    const res = createResponseStub();

    const result = await controller.logout(req, {} as any, res);
    expect(result.success).toBe(true);
    expect(refreshService.revoke).toHaveBeenCalledWith(refreshToken);
    expect(sessionService.revoke).toHaveBeenCalledWith('user-1', 'sess-1');
    expect(res.cleared.map((c) => c.options.path)).toEqual([
      '/api/auth',
      '/api',
      '/',
    ]);
  });
});

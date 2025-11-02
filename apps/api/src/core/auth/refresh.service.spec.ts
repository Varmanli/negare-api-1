import { RoleName } from '@app/prisma/prisma.constants';
import { refreshAllowKey } from './auth.constants';
import { RefreshService } from './refresh.service';
import { SessionService } from './session/session.service';
import { TokenService } from './token/token.service';
import { createFakeRedis } from '@test/utils/fake-redis';

class ConfigStub {
  constructor(private readonly authConfig: any) {}

  get(key: string) {
    if (key === 'auth') {
      return this.authConfig;
    }
    if (key === 'SESSION_TTL') {
      return '30d';
    }
    return undefined;
  }
}

describe('RefreshService', () => {
  const authConfig = {
    accessSecret: 'unit-access-secret',
    accessExpires: '5m',
    refreshSecret: 'unit-refresh-secret',
    refreshExpires: '7d',
    cookie: {
      sameSite: 'lax' as const,
      secure: false,
      refreshPath: '/',
      accessPath: '/',
    },
  };

  const fakeUser = {
    id: 'user-1',
    username: 'tester',
    userRoles: [{ role: { name: RoleName.USER } }],
  } as const;

  const setup = () => {
    const redis = createFakeRedis();
    const config = new ConfigStub(authConfig);
    const usersService = {
      ensureActiveWithRoles: jest
        .fn()
        .mockResolvedValue({ ...fakeUser }),
    };

    const tokenService = new TokenService(config as any, redis as any);
    const sessionService = new SessionService(redis as any, config as any);
    const refreshService = new RefreshService(
      redis as any,
      config as any,
      usersService as any,
      sessionService,
      tokenService,
    );

    return {
      refreshService,
      sessionService,
      tokenService,
      usersService,
      redis,
    };
  };

  it('issues refresh tokens linked to sessions and rotates them securely', async () => {
    const { refreshService, tokenService, sessionService, redis } = setup();

    const pair = await refreshService.issueTokensForUserId('user-1', {
      sessionId: 'sess-1',
    });

    const payload = await tokenService.verifyRefresh(pair.refreshToken);
    expect(payload.sid).toBe('sess-1');

    const allowBefore = await redis.get(refreshAllowKey(payload.jti));
    expect(allowBefore).not.toBeNull();

    const rotated = await refreshService.refresh(pair.refreshToken);
    const rotatedPayload = await tokenService.verifyRefresh(rotated.refreshToken);

    expect(rotatedPayload.jti).not.toBe(payload.jti);
    expect(await redis.get(refreshAllowKey(payload.jti))).toBeNull();
    expect(await tokenService.isRefreshBlacklisted(payload.jti)).toBe(true);

    const linked = await sessionService.findSessionByJti(rotatedPayload.jti);
    expect(linked).toEqual({ userId: 'user-1', sessionId: 'sess-1' });
  });

  it('revokes refresh tokens and unlinks sessions', async () => {
    const { refreshService, tokenService, sessionService, redis } = setup();

    const pair = await refreshService.issueTokensForUserId('user-1', {
      sessionId: 'sess-1',
    });

    const payload = await tokenService.verifyRefresh(pair.refreshToken);
    await refreshService.revoke(pair.refreshToken);

    expect(await redis.get(refreshAllowKey(payload.jti))).toBeNull();
    expect(await tokenService.isRefreshBlacklisted(payload.jti)).toBe(true);
    expect(await sessionService.findSessionByJti(payload.jti)).toBeNull();
  });

  it('peekPayload returns session-aware payload data', async () => {
    const { refreshService, tokenService } = setup();

    const pair = await refreshService.issueTokensForUserId('user-1', {
      sessionId: 'sess-1',
    });

    const payload = await refreshService.peekPayload(pair.refreshToken);
    const verified = await tokenService.verifyRefresh(pair.refreshToken);

    expect(payload?.sid).toBe(verified.sid);
    expect(payload?.jti).toBe(verified.jti);
  });
});

import { RoleName } from '@app/prisma/prisma.constants';
import { TokenService } from './token.service';
import { createFakeRedis } from '@test/utils/fake-redis';

class ConfigServiceStub {
  constructor(private readonly authConfig: any) {}

  get(key: string) {
    if (key === 'auth') {
      return this.authConfig;
    }
    return undefined;
  }
}

describe('TokenService', () => {
  const authConfig = {
    accessSecret: 'access-secret',
    accessExpires: '10m',
    refreshSecret: 'refresh-secret',
    refreshExpires: '30d',
    cookie: {
      sameSite: 'lax' as const,
      secure: false,
      refreshPath: '/',
      accessPath: '/',
    },
  };

  const createService = () => {
    const redis = createFakeRedis();
    const config = new ConfigServiceStub(authConfig);
    const service = new TokenService(config as any, redis as any);
    return { service, redis };
  };

  it('signs and verifies access tokens', () => {
    const { service } = createService();
    const token = service.signAccess({
      userId: 'user-1',
      roles: [RoleName.USER],
    });

    const payload = service.verifyAccess(token);
    expect(payload.sub).toBe('user-1');
    expect(payload.roles).toEqual([RoleName.USER]);
    expect(payload.typ).toBe('access');
  });

  it('signs and verifies refresh tokens with session linkage', async () => {
    const { service } = createService();
    const refreshToken = service.signRefresh({
      userId: 'user-1',
      sessionId: 'sess-1',
      jti: 'jti-1',
    });

    const payload = await service.verifyRefresh(refreshToken);
    expect(payload.sub).toBe('user-1');
    expect(payload.sid).toBe('sess-1');
    expect(payload.jti).toBe('jti-1');
    expect(payload.typ).toBe('refresh');
  });

  it('blacklists refresh JTIs and blocks reuse', async () => {
    const { service } = createService();
    const refreshToken = service.signRefresh({
      userId: 'user-1',
      sessionId: 'sess-1',
      jti: 'jti-1',
    });

    await service.blacklistRefreshJti('jti-1');
    await expect(service.verifyRefresh(refreshToken)).rejects.toThrow(
      /revoked/i,
    );

    const peek = await service.peekRefresh(refreshToken, {
      allowBlacklisted: true,
      ignoreExpiration: true,
    });
    expect(peek).not.toBeNull();
    expect(peek?.jti).toBe('jti-1');
  });

  it('extracts bearer tokens from headers', () => {
    const { service } = createService();
    expect(service.extractBearer('Bearer abc123')).toBe('abc123');
    expect(service.extractBearer('bearer token-value')).toBe('token-value');
    expect(service.extractBearer('Basic something')).toBeNull();
  });
});

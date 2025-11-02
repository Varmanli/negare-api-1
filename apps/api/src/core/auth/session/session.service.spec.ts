import { SessionService } from './session.service';
import { createFakeRedis } from '@test/utils/fake-redis';

class ConfigStub {
  get(key: string) {
    if (key === 'SESSION_TTL') {
      return '1d';
    }
    return undefined;
  }
}

describe('SessionService', () => {
  const createService = () => {
    const redis = createFakeRedis();
    const config = new ConfigStub();
    const service = new SessionService(redis as any, config as any);
    return { service, redis };
  };

  it('creates, retrieves, and touches sessions', async () => {
    const { service } = createService();
    const created = await service.create({
      userId: 'user-1',
      ip: '127.0.0.1',
      userAgent: 'jest-test',
    });

    const fetched = await service.get('user-1', created.id);
    expect(fetched?.id).toBe(created.id);

    const touched = await service.touch('user-1', created.id);
    expect(touched.lastUsedAt).toBeGreaterThanOrEqual(created.lastUsedAt);
  });

  it('links refresh JTIs to sessions and can find them back', async () => {
    const { service } = createService();
    const session = await service.create({ userId: 'user-1' });

    await service.linkRefreshJti('user-1', session.id, 'jti-1');
    const found = await service.findSessionByJti('jti-1');
    expect(found).toEqual({ userId: 'user-1', sessionId: session.id });

    await service.unlinkRefreshJti('user-1', session.id, 'jti-1');
    expect(await service.findSessionByJti('jti-1')).toBeNull();
  });

  it('revokes sessions and cleans up indices', async () => {
    const { service } = createService();
    const session = await service.create({ userId: 'user-1' });
    await service.linkRefreshJti('user-1', session.id, 'jti-1');

    await service.revoke('user-1', session.id);

    expect(await service.get('user-1', session.id)).toBeNull();
    expect(await service.findSessionByJti('jti-1')).toBeNull();

    const sessions = await service.list('user-1');
    expect(sessions).toHaveLength(0);
  });
});

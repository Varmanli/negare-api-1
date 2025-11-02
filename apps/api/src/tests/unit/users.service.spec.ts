import { UsersService } from '@app/core/users/users.service';
import { PrismaService } from '@app/prisma/prisma.service';

const createPrismaMock = () =>
  ({
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  } as unknown as PrismaService);

describe('UsersService', () => {
  let prisma: PrismaService;
  let service: UsersService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new UsersService(prisma);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('creates a user with hashed password', async () => {
    (prisma.user.create as jest.Mock).mockImplementationOnce(async ({ data }) => ({
      id: 'user-1',
      ...data,
      userRoles: [],
      wallet: null,
    }));

    const result = await service.create({
      username: 'john_doe',
      email: 'john@example.com',
      password: 'StrongPass123',
    });

    const call = (prisma.user.create as jest.Mock).mock.calls[0]?.[0];
    expect(call.data.passwordHash).toHaveLength(64); // sha256 hex
    expect(call.data.passwordHash).not.toEqual('StrongPass123');
    expect(result.username).toBe('john_doe');
  });

  it('filters users via findAll', async () => {
    (prisma.user.findMany as jest.Mock).mockResolvedValueOnce([
      { id: 'user-1', username: 'active_user', userRoles: [], wallet: null },
    ]);

    const users = await service.findAll({
      search: 'active',
      limit: 10,
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ username: expect.any(Object) }),
          ]),
        }),
      }),
    );
    expect(users).toHaveLength(1);
  });

  it('updates user and re-hashes password when provided', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'user-1',
    });
    (prisma.user.update as jest.Mock).mockImplementationOnce(async ({ data }) => ({
      id: 'user-1',
      ...data,
      userRoles: [],
      wallet: null,
    }));

    const updated = await service.update('user-1', {
      email: 'new@example.com',
      password: 'NewPass456',
    });

    const call = (prisma.user.update as jest.Mock).mock.calls[0]?.[0];
    expect(call.data.passwordHash).toHaveLength(64);
    expect(updated.email).toBe('new@example.com');
  });
});

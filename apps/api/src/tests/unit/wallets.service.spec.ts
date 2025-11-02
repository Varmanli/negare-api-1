import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WalletTransactionRefType } from '@app/prisma/prisma.constants';
import { WalletsService } from '@app/core/wallet/wallets.service';
import { WalletAuditService } from '@app/core/wallet/wallet-audit.service';
import { WalletRateLimitService } from '@app/core/wallet/wallet-rate-limit.service';
import {
  createWalletPrismaStub,
  WalletPrismaStub,
} from '../utils/prisma-wallet.stub';

const userId = 'user-1';

const configStub = {
  get: () => 'test',
} as unknown as ConfigService;

const auditStub = {
  log: jest.fn(),
} as unknown as WalletAuditService;

const rateLimitStub = {
  consume: jest.fn(),
} as unknown as WalletRateLimitService;

describe('WalletsService', () => {
  let prisma: WalletPrismaStub;
  let service: WalletsService;

  beforeEach(async () => {
    prisma = createWalletPrismaStub();
    await prisma.user.upsert({ where: { id: userId }, create: { id: userId } });
    service = new WalletsService(prisma as any, configStub, auditStub, rateLimitStub);
    await service.createForUser(userId, {});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('credits wallet balance and records transaction atomically', async () => {
    const tx = await service.credit(userId, {
      amount: '10000',
      idempotencyKey: 'credit-1',
      refType: WalletTransactionRefType.ORDER,
      refId: 'order-1',
      description: 'Initial top-up',
      metadata: { source: 'test' },
    });

    expect(String(tx.amount)).toEqual('10000.00');
    expect(tx.idempotencyKey).toEqual('credit-1');
    expect(tx.walletId).toBeDefined();

    const balance = await service.getBalance(userId);
    expect(balance.balance).toEqual('10000.00');
  });

  it('prevents overdraft with descriptive error', async () => {
    await expect(
      service.debit(userId, {
        amount: '500',
        idempotencyKey: 'debit-1',
        refType: WalletTransactionRefType.PAYOUT,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'INSUFFICIENT_FUNDS',
      },
    });
  });

  it('ensures idempotent processing using idempotency key', async () => {
    await service.credit(userId, {
      amount: '2000',
      idempotencyKey: 'credit-dup',
      refType: WalletTransactionRefType.ADJUSTMENT,
    });

    const secondCall = await service.credit(userId, {
      amount: '2000',
      idempotencyKey: 'credit-dup',
      refType: WalletTransactionRefType.ADJUSTMENT,
    });

    const balance = await service.getBalance(userId);
    expect(balance.balance).toEqual('2000.00');
    expect(secondCall.idempotencyKey).toEqual('credit-dup');
  });

  it('debits wallet when sufficient balance exists', async () => {
    await service.credit(userId, {
      amount: '5000',
      idempotencyKey: 'credit-for-debit',
      refType: WalletTransactionRefType.ORDER,
    });

    const tx = await service.debit(userId, {
      amount: '2000',
      idempotencyKey: 'debit-2',
      refType: WalletTransactionRefType.PAYOUT,
      description: 'Payout to supplier',
    });

    expect(String(tx.amount)).toEqual('2000.00');
    expect(tx.type).toEqual('debit');

    const balance = await service.getBalance(userId);
    expect(balance.balance).toEqual('3000.00');
  });

  it('throws when amount format is invalid', async () => {
    await expect(
      service.credit(userId, {
        amount: 'not-a-number',
        idempotencyKey: 'credit-invalid',
        refType: WalletTransactionRefType.ORDER,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

import { WalletTransactionRefType, WalletTransactionType } from '@app/prisma/prisma.constants';
import { WalletTransactionsService } from '@app/core/wallet/wallet-transactions.service';
import { WalletsService } from '@app/core/wallet/wallets.service';
import { ConfigService } from '@nestjs/config';
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

describe('WalletTransactionsService', () => {
  let prisma: WalletPrismaStub;
  let walletsService: WalletsService;
  let service: WalletTransactionsService;

  beforeEach(async () => {
    prisma = createWalletPrismaStub();
    await prisma.user.upsert({ where: { id: userId }, create: { id: userId } });
    walletsService = new WalletsService(
      prisma as any,
      configStub,
      auditStub,
      rateLimitStub,
    );
    service = new WalletTransactionsService(prisma as any);
    await walletsService.createForUser(userId, {});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('filters transactions by user and type', async () => {
    const creditTx = await walletsService.credit(userId, {
      amount: '7000',
      idempotencyKey: 'tx-credit-1',
      refType: WalletTransactionRefType.ORDER,
    });

    await walletsService.debit(userId, {
      amount: '2000',
      idempotencyKey: 'tx-debit-1',
      refType: WalletTransactionRefType.PAYOUT,
    });

    const result = await service.findAll({
      userId,
      type: WalletTransactionType.CREDIT,
      limit: 10,
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toEqual(creditTx.id);
  });

  it('returns transactions scoped by wallet id', async () => {
    await walletsService.credit(userId, {
      amount: '5000',
      idempotencyKey: 'tx-credit-2',
      refType: WalletTransactionRefType.ADJUSTMENT,
    });

    const wallet = await walletsService.findByUserId(userId);
    const transactions = await service.findByWallet(wallet!.id, {
      limit: 5,
    });

    expect(transactions).toHaveLength(1);
    expect(transactions[0].walletId).toEqual(wallet!.id);
  });

  it('finds transactions by id and idempotency key', async () => {
    const tx = await walletsService.credit(userId, {
      amount: '3000',
      idempotencyKey: 'tx-credit-3',
      refType: WalletTransactionRefType.ORDER,
    });

    const byId = await service.findById(tx.id);
    const byKey = await service.findByIdempotencyKey('tx-credit-3');

    expect(byId?.id).toEqual(tx.id);
    expect(byId?.userId).toEqual(userId);
    expect(byKey?.id).toEqual(tx.id);
  });

  it('supports date range filtering', async () => {
    await walletsService.credit(userId, {
      amount: '1000',
      idempotencyKey: 'tx-credit-4',
      refType: WalletTransactionRefType.ORDER,
    });

    const from = new Date(Date.now() + 1000).toISOString();

    const filtered = await service.findAll({
      userId,
      from,
    });

    expect(filtered).toHaveLength(0);
  });
});

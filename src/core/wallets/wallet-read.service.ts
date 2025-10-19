import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WalletsService } from './wallets.service';
import { Wallet } from './wallet.entity';
import {
  WalletTransaction,
  WalletTransactionStatus,
  WalletTransactionType,
} from '../wallet-transactions/wallet-transaction.entity';
import { WalletTransactionsQueryDto } from './dto/wallet-transactions-query.dto';
import { normalizeDecimalString } from './utils/amount.util';

export interface WalletTransactionItem {
  id: string;
  type: 'credit' | 'debit';
  status: 'pending' | 'success' | 'failed';
  amount: string;
  createdAt: string;
  balanceAfter: string;
  meta: Record<string, unknown> | null;
}

export interface WalletTransactionsResult {
  items: WalletTransactionItem[];
  nextCursor: string | null;
}

@Injectable()
export class WalletReadService {
  private readonly logger = new Logger(WalletReadService.name);
  private static readonly SEED_FLAG = 'wallet-dev-seed';

  constructor(
    private readonly config: ConfigService,
    private readonly walletsService: WalletsService,
    @InjectRepository(Wallet)
    private readonly walletsRepository: Repository<Wallet>,
    @InjectRepository(WalletTransaction)
    private readonly walletTransactionsRepository: Repository<WalletTransaction>,
  ) {}

  async seedIfNeeded(userId: string): Promise<void> {
    if (!this.shouldSeed()) {
      return;
    }

    const wallet = await this.ensureWallet(userId);
    const transactionCount = await this.walletTransactionsRepository.count({
      where: { walletId: wallet.id },
    });
    if (transactionCount > 0) {
      return;
    }

    const creditKey = this.seedKey(userId, 'credit');
    const debitKey = this.seedKey(userId, 'debit');

    await this.walletsService.createUserTransaction(userId, {
      type: 'credit',
      amount: 1_000_000,
      idempotencyKey: creditKey,
      description: 'Seed credit transaction (dev only)',
    });

    await this.walletsService.createUserTransaction(userId, {
      type: 'debit',
      amount: 200_000,
      idempotencyKey: debitKey,
      description: 'Seed debit transaction (dev only)',
    });
  }

  async getBalance(userId: string): Promise<{ currency: string; balance: string }> {
    const wallet = await this.ensureWallet(userId);
    return {
      currency: wallet.currency,
      balance: normalizeDecimalString(wallet.balance ?? '0'),
    };
  }

  async listTransactions(
    userId: string,
    query: WalletTransactionsQueryDto,
  ): Promise<WalletTransactionsResult> {
    const wallet = await this.ensureWallet(userId);
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 50);

    const qb = this.walletTransactionsRepository
      .createQueryBuilder('tx')
      .where('tx.walletId = :walletId', { walletId: wallet.id })
      .orderBy('tx.createdAt', 'DESC')
      .addOrderBy('tx.id', 'DESC')
      .take(limit);

    if (query.type && query.type !== 'all') {
      qb.andWhere('tx.type = :type', {
        type:
          query.type === 'credit'
            ? WalletTransactionType.CREDIT
            : WalletTransactionType.DEBIT,
      });
    }

    if (query.fromDate) {
      qb.andWhere('tx.createdAt >= :fromDate', { fromDate: query.fromDate });
    }

    if (query.toDate) {
      qb.andWhere('tx.createdAt <= :toDate', { toDate: query.toDate });
    }

    if (query.cursor) {
      const cursor = this.parseCursor(query.cursor);
      if (cursor) {
        qb.andWhere(
          '(tx.createdAt < :cursorDate OR (tx.createdAt = :cursorDate AND tx.id < :cursorId))',
          {
            cursorDate: cursor.createdAt,
            cursorId: cursor.id,
          },
        );
      }
    }

    const transactions = await qb.getMany();
    const items: WalletTransactionItem[] = transactions.map((tx) => ({
      id: tx.id,
      type: tx.type,
      status: this.mapStatus(tx.status),
      amount: normalizeDecimalString(tx.amount),
      createdAt: tx.createdAt.toISOString(),
      balanceAfter: normalizeDecimalString(
        tx.balanceAfter ?? wallet.balance ?? '0',
      ),
      meta: tx.metadata ?? null,
    }));

    const last = transactions.at(-1);
    const nextCursor =
      last && transactions.length === limit
        ? this.buildCursor(last)
        : null;

    return { items, nextCursor };
  }

  private async ensureWallet(userId: string): Promise<Wallet> {
    let wallet = await this.walletsRepository.findOne({ where: { userId } });
    if (!wallet) {
      this.logger.debug(`Creating wallet for user ${userId}`);
      wallet = await this.walletsRepository.save(
        this.walletsRepository.create({
          userId,
          balance: '0',
        }),
      );
    }
    return wallet;
  }

  private shouldSeed(): boolean {
    const explicit =
      this.config.get<string>('WALLET_SEED') ?? process.env.WALLET_SEED;
    if (explicit) {
      return ['1', 'true', 'yes', 'on'].includes(explicit.toLowerCase());
    }
    const env =
      this.config.get<string>('NODE_ENV') ??
      process.env.NODE_ENV ??
      'development';
    return env.toLowerCase() === 'development';
  }

  private seedKey(userId: string, suffix: string): string {
    return `${WalletReadService.SEED_FLAG}-${suffix}-${userId}`;
  }

  private mapStatus(
    status: WalletTransactionStatus,
  ): 'pending' | 'success' | 'failed' {
    switch (status) {
      case WalletTransactionStatus.COMPLETED:
        return 'success';
      case WalletTransactionStatus.PENDING:
        return 'pending';
      case WalletTransactionStatus.FAILED:
      default:
        return 'failed';
    }
  }

  private parseCursor(
    cursor: string,
  ):
    | {
        createdAt: Date;
        id: string;
      }
    | null {
    const [datePart, idPart] = cursor.split('|');
    if (!datePart || !idPart) {
      return null;
    }
    const date = new Date(datePart);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return { createdAt: date, id: idPart };
  }

  private buildCursor(tx: WalletTransaction): string {
    return `${tx.createdAt.toISOString()}|${tx.id}`;
  }
}

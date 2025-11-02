import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '@app/prisma/prisma.service';
import { WalletsService } from './wallets.service';
import { WalletTransactionsQueryDto } from './dto/wallet-transactions-query.dto';
import { normalizeDecimalString } from './utils/amount.util';

// Literal unions به‌جای import کردن enum از کلاینت
type TxType = 'credit' | 'debit';
type TxStatusDb = 'pending' | 'completed' | 'failed';

type WalletModel = Prisma.WalletGetPayload<{}>;
type WalletTxModel = Prisma.WalletTransactionGetPayload<{}>;
type WhereType = Prisma.WalletTransactionFindManyArgs['where'];

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
    private readonly prisma: PrismaService,
  ) {}

  async seedIfNeeded(userId: string): Promise<void> {
    if (!this.shouldSeed()) return;

    const wallet = await this.ensureWallet(userId);
    const transactionCount = await this.prisma.walletTransaction.count({
      where: { walletId: wallet.id },
    });
    if (transactionCount > 0) return;

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

  async getBalance(
    userId: string,
  ): Promise<{ currency: string; balance: string }> {
    const wallet = await this.ensureWallet(userId);
    return {
      currency: String(wallet.currency),
      balance: normalizeDecimalString(wallet.balance.toString()),
    };
  }

  async listTransactions(
    userId: string,
    query: WalletTransactionsQueryDto,
  ): Promise<WalletTransactionsResult> {
    const wallet = await this.ensureWallet(userId);
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 50);

    // where را به‌صورت generic از روی FindManyArgs تایپ می‌کنیم
    let where: WhereType = { walletId: wallet.id };

    if (query.type && query.type !== 'all') {
      // cast ایمن بدون any (unknown → نوع دقیق)
      where = {
        ...where,
        type: (query.type === 'credit'
          ? 'credit'
          : 'debit') as unknown as WhereType extends { type?: infer T }
          ? T
          : never,
      };
    }

    if (query.fromDate) {
      const fromDate = new Date(query.fromDate);
      if (!Number.isNaN(fromDate.getTime())) {
        where = {
          ...where,
          createdAt: {
            ...((where?.createdAt as object) ?? {}),
            gte: fromDate,
          } as unknown as WhereType extends { createdAt?: infer T } ? T : never,
        };
      }
    }

    if (query.toDate) {
      const toDate = new Date(query.toDate);
      if (!Number.isNaN(toDate.getTime())) {
        where = {
          ...where,
          createdAt: {
            ...((where?.createdAt as object) ?? {}),
            lte: toDate,
          } as unknown as WhereType extends { createdAt?: infer T } ? T : never,
        };
      }
    }

    const extraConds: WhereType[] = [];
    if (query.cursor) {
      const cursor = this.parseCursor(query.cursor);
      if (cursor) {
        extraConds.push({
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        } as WhereType);
      }
    }

    const finalWhere: WhereType =
      extraConds.length > 0
        ? ({ AND: [where, ...extraConds] } as WhereType)
        : where;

    const transactions = await this.prisma.walletTransaction.findMany({
      where: finalWhere,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });

    const items: WalletTransactionItem[] = transactions.map((tx) => ({
      id: tx.id,
      type: tx.type as TxType,
      status: this.mapStatus(tx.status as TxStatusDb),
      amount: normalizeDecimalString(tx.amount.toString()),
      createdAt: tx.createdAt.toISOString(),
      balanceAfter: normalizeDecimalString(
        (tx.balanceAfter ?? wallet.balance).toString(),
      ),
      meta: (tx.metadata as Record<string, unknown> | null) ?? null,
    }));

    const last = transactions.at(-1);
    const nextCursor =
      last && transactions.length === limit ? this.buildCursor(last) : null;

    return { items, nextCursor };
  }

  private async ensureWallet(userId: string): Promise<WalletModel> {
    const existing = await this.prisma.wallet.findUnique({ where: { userId } });
    if (existing) return existing;

    try {
      return await this.prisma.wallet.create({ data: { userId } });
    } catch (error) {
      this.logger.debug(
        `Wallet creation race detected for user ${userId}: ${String(error)}`,
      );
      const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new NotFoundException('کیف پول پیدا نشد');
      return wallet;
    }
  }

  private shouldSeed(): boolean {
    const explicit =
      this.config.get<string>('WALLET_SEED') ?? process.env.WALLET_SEED;
    if (explicit)
      return ['1', 'true', 'yes', 'on'].includes(explicit.toLowerCase());
    const env =
      this.config.get<string>('NODE_ENV') ??
      process.env.NODE_ENV ??
      'development';
    return env.toLowerCase() === 'development';
  }

  private seedKey(userId: string, suffix: string): string {
    return `${WalletReadService.SEED_FLAG}-${suffix}-${userId}`;
  }

  private mapStatus(status: TxStatusDb): 'pending' | 'success' | 'failed' {
    switch (status) {
      case 'completed':
        return 'success';
      case 'pending':
        return 'pending';
      default:
        return 'failed';
    }
  }

  private parseCursor(cursor: string): { createdAt: Date; id: string } | null {
    const [datePart, idPart] = cursor.split('|');
    if (!datePart || !idPart) return null;
    const date = new Date(datePart);
    if (Number.isNaN(date.getTime())) return null;
    return { createdAt: date, id: idPart };
  }

  private buildCursor(tx: WalletTxModel): string {
    return `${tx.createdAt.toISOString()}|${tx.id}`;
  }
}

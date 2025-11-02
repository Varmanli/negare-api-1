import { Injectable } from '@nestjs/common';
import type { Prisma as PrismaNamespace, WalletTransaction } from '@prisma/client';
import { Prisma } from '@app/prisma/prisma.constants';
import { PrismaService } from '@app/prisma/prisma.service';
import { FindWalletTransactionsQueryDto } from './dto/find-wallet-transactions-query.dto';

@Injectable()
export class WalletTransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(query: FindWalletTransactionsQueryDto): Promise<WalletTransaction[]> {
    return this.queryTransactions(query);
  }

  findByWallet(
    walletId: string,
    query: FindWalletTransactionsQueryDto,
  ): Promise<WalletTransaction[]> {
    return this.queryTransactions({ ...query, walletId });
  }

  findById(id: string): Promise<WalletTransaction | null> {
    return this.prisma.walletTransaction.findUnique({
      where: { id },
      include: {
        wallet: true,
        user: true,
      },
    });
  }

  findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<WalletTransaction | null> {
    return this.prisma.walletTransaction.findFirst({
      where: { idempotencyKey },
      include: {
        wallet: true,
        user: true,
      },
    });
  }

  private async queryTransactions(
    query: FindWalletTransactionsQueryDto,
  ): Promise<WalletTransaction[]> {
    const take = Math.min(Math.max(query.limit ?? 25, 1), 100);
    const where: PrismaNamespace.WalletTransactionWhereInput = {};

    if (query.userId) {
      where.userId = query.userId;
    }

    if (query.walletId) {
      where.walletId = query.walletId;
    }

    if (query.type) {
      where.type = query.type;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.refType) {
      where.refType = query.refType;
    }

    const mergeCreatedAtFilter = (
      existing: PrismaNamespace.WalletTransactionWhereInput['createdAt'],
      patch: PrismaNamespace.DateTimeFilter,
    ): PrismaNamespace.DateTimeFilter => {
      if (
        existing &&
        typeof existing === 'object' &&
        !Array.isArray(existing)
      ) {
        return { ...(existing as PrismaNamespace.DateTimeFilter), ...patch };
      }
      return { ...patch };
    };

    if (query.from) {
      const fromDate = new Date(query.from);
      if (!Number.isNaN(fromDate.getTime())) {
        where.createdAt = mergeCreatedAtFilter(where.createdAt, { gte: fromDate });
      }
    }

    if (query.to) {
      const toDate = new Date(query.to);
      if (!Number.isNaN(toDate.getTime())) {
        where.createdAt = mergeCreatedAtFilter(where.createdAt, { lte: toDate });
      }
    }

    const andConditions: PrismaNamespace.WalletTransactionWhereInput[] = [];

    if (query.cursor) {
      const cursorEntity = await this.prisma.walletTransaction.findUnique({
        where: { id: query.cursor },
        select: { createdAt: true, id: true },
      });

      if (cursorEntity) {
        andConditions.push({
          OR: [
            { createdAt: { lt: cursorEntity.createdAt } },
            {
              createdAt: cursorEntity.createdAt,
              id: { lt: cursorEntity.id },
            },
          ],
        });
      }
    }

    const finalWhere =
      andConditions.length > 0
        ? { AND: [where, ...andConditions] }
        : where;

    return this.prisma.walletTransaction.findMany({
      where: finalWhere,
      include: {
        wallet: true,
        user: true,
      },
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      take,
    });
  }
}

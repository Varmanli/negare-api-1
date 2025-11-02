type WalletRecord = {
  id: string;
  userId: string;
  balance: string;
  currency: string;
};

type WalletTransactionRecord = {
  id: string;
  walletId: string;
  userId: string;
  type: 'credit' | 'debit';
  status: 'pending' | 'completed' | 'failed';
  amount: string;
  balanceAfter: string | null;
  idempotencyKey: string;
  refType?: string | null;
  refId?: string | null;
  description?: string | null;
  metadata?: unknown;
  createdById?: string | null;
  provider?: string | null;
  externalRef?: string | null;
  groupId?: string | null;
  createdAt: Date;
};

export type WalletPrismaStub = ReturnType<typeof createWalletPrismaStub>;

export const createWalletPrismaStub = () => {
  let walletSeq = 1;
  let txSeq = 1;
  const wallets = new Map<string, WalletRecord>();
  const transactions: WalletTransactionRecord[] = [];
  const users = new Map<string, { id: string }>();

  const findWallet = (query: { userId?: string; id?: string }) => {
    if (query.userId) {
      return Array.from(wallets.values()).find(
        (wallet) => wallet.userId === query.userId,
      );
    }
    if (query.id) {
      return wallets.get(query.id) ?? null;
    }
    return null;
  };

  const prisma = {
    user: {
      upsert: async ({ where, create }: any) => {
        if (!users.has(where.id)) {
          users.set(where.id, { id: where.id });
        }
        return users.get(where.id);
      },
    },
    wallet: {
      findUnique: async ({ where }: any) => {
        return findWallet(where) ?? null;
      },
      create: async ({ data }: any) => {
        const id = `wallet-${walletSeq++}`;
        const record: WalletRecord = {
          id,
          userId: data.userId,
          balance: data.balance ?? '0',
          currency: data.currency ?? 'IRR',
        };
        wallets.set(id, record);
        if (!users.has(record.userId)) {
          users.set(record.userId, { id: record.userId });
        }
        return { ...record };
      },
      update: async ({ where, data }: any) => {
        const wallet = findWallet(where);
        if (!wallet) throw new Error('Wallet not found');
        wallet.balance = data.balance ?? wallet.balance;
        return { ...wallet };
      },
    },
    walletTransaction: {
      findUnique: async ({ where, select }: any) => {
        if (where.id) {
          const tx = transactions.find((t) => t.id === where.id);
          if (!tx) return null;
          return select ? { createdAt: tx.createdAt, id: tx.id } : { ...tx };
        }
        if (where.walletId_idempotencyKey) {
          const { walletId, idempotencyKey } = where.walletId_idempotencyKey;
          const tx = transactions.find(
            (t) =>
              t.walletId === walletId && t.idempotencyKey === idempotencyKey,
          );
          return tx ? { ...tx } : null;
        }
        return null;
      },
      findFirst: async ({ where }: any) => {
        if (where?.idempotencyKey) {
          return (
            transactions.find(
              (t) => t.idempotencyKey === where.idempotencyKey,
            ) ?? null
          );
        }
        if (where?.walletId) {
          return (
            transactions.find((t) => t.walletId === where.walletId) ?? null
          );
        }
        if (where?.provider) {
          return (
            transactions.find(
              (t) =>
                t.provider === where.provider &&
                t.externalRef === where.externalRef,
            ) ?? null
          );
        }
        return null;
      },
      findMany: async ({ where, orderBy, take, include }: any) => {
        let list = [...transactions];
        const filters = Array.isArray(where?.AND)
          ? where.AND
          : where
            ? [where]
            : [];

        const applyFilter = (
          source: WalletTransactionRecord[],
          filter: any,
        ) => {
          let result = [...source];
          if (filter?.userId) {
            result = result.filter((t) => t.userId === filter.userId);
          }
          if (filter?.walletId) {
            result = result.filter((t) => t.walletId === filter.walletId);
          }
          if (filter?.type) {
            result = result.filter((t) => t.type === filter.type);
          }
          if (filter?.status) {
            result = result.filter((t) => t.status === filter.status);
          }
          if (filter?.createdAt?.gte) {
            const gte = new Date(filter.createdAt.gte);
            result = result.filter((t) => t.createdAt >= gte);
          }
          if (filter?.createdAt?.lte) {
            const lte = new Date(filter.createdAt.lte);
            result = result.filter((t) => t.createdAt <= lte);
          }
          return result;
        };

        for (const filter of filters) {
          if (filter?.OR) {
            // نتایج OR را صریحاً تایپ کن تا any نشه
            const orResults: WalletTransactionRecord[] = (
              filter.OR as any[]
            ).flatMap((sub) => applyFilter(list, sub));

            // Map را با جنریک‌های مشخص بساز و tx را تایپ کن
            const unique = new Map<string, WalletTransactionRecord>(
              orResults.map(
                (tx: WalletTransactionRecord) => [tx.id, tx] as const,
              ),
            );

            // خروجی الان WalletTransactionRecord[] می‌شود
            list = Array.from(unique.values());
          } else {
            list = applyFilter(list, filter);
          }
        }

        if (filters.length === 0) {
          list = applyFilter(list, where ?? {});
        }

        if (orderBy) {
          list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        const slice = list.slice(0, take ?? list.length);
        return slice.map((tx) => ({
          ...tx,
          ...(include?.wallet
            ? { wallet: findWallet({ id: tx.walletId }) }
            : {}),
          ...(include?.user ? { user: users.get(tx.userId) ?? null } : {}),
        }));
      },
      create: async ({ data }: any) => {
        const id = `tx-${txSeq++}`;
        const record: WalletTransactionRecord = {
          id,
          walletId: data.walletId,
          userId: data.userId,
          type: data.type,
          status: data.status ?? 'completed',
          amount: data.amount,
          balanceAfter: data.balanceAfter ?? null,
          idempotencyKey: data.idempotencyKey,
          refType: data.refType ?? null,
          refId: data.refId ?? null,
          description: data.description ?? null,
          metadata: data.metadata ?? null,
          createdById: data.createdById ?? null,
          provider: data.provider ?? null,
          externalRef: data.externalRef ?? null,
          groupId: data.groupId ?? null,
          createdAt: new Date(),
        };
        transactions.push(record);
        return {
          ...record,
          wallet: findWallet({ id: record.walletId }) ?? null,
          user: users.get(record.userId) ?? null,
        };
      },
      update: async ({ where, data }: any) => {
        const idx = transactions.findIndex((t) => t.id === where.id);
        if (idx === -1) throw new Error('Transaction not found');
        const existing = transactions[idx];
        const updated = { ...existing, ...data };
        transactions[idx] = updated;
        return { ...updated };
      },
      count: async ({ where }: any) => {
        return transactions.filter((t) => t.userId === where.userId).length;
      },
    },
    $transaction: async (callbackOrArray: any) => {
      if (typeof callbackOrArray === 'function') {
        return callbackOrArray(prisma);
      }
      if (Array.isArray(callbackOrArray)) {
        return Promise.all(callbackOrArray);
      }
      throw new TypeError('callback is not a function');
    },
  };

  return prisma;
};

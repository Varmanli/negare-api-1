import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma as PrismaNamespace, Wallet, WalletTransaction } from '@prisma/client';
import {
  Prisma,
  PrismaClientKnownRequestError,
  WalletCurrency,
  WalletTransactionRefType,
  WalletTransactionStatus,
  WalletTransactionType,
  JsonNull,
} from '@app/prisma/prisma.constants';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@app/prisma/prisma.service';
import {
  decimalStringToMinorUnits,
  minorUnitsToDecimalString,
  normalizeDecimalString,
  parseAmountToMinorUnits,
} from './utils/amount.util';
import { WalletAuditService } from './wallet-audit.service';
import { WalletRateLimitService } from './wallet-rate-limit.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { WalletBalanceDto } from './dto/wallet-balance.dto';
import { WalletOperationDto } from './dto/wallet-operation.dto';
import { CreateWalletTransactionDto } from './dto/create-wallet-transaction.dto';
import { WalletWebhookDto } from './dto/wallet-webhook.dto';
import { CreateWalletTransferDto } from './dto/create-wallet-transfer.dto';

interface ApplyTransactionOptions {
  userId: string;
  type: WalletTransactionType;
  amount: number | string;
  idempotencyKey: string;
  description?: string | null;
  refType?: WalletTransactionRefType;
  refId?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  createdById?: string | null;
  resolveOnDuplicate?: boolean;
  provider?: string | null;
  externalRef?: string | null;
  groupId?: string | null;
}

type WalletWithRelations = PrismaNamespace.WalletGetPayload<{
  include: { user: true; transactions: true };
}>;

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: WalletAuditService,
    private readonly rateLimit: WalletRateLimitService,
  ) {}

  findAll(): Promise<WalletWithRelations[]> {
    return this.prisma.wallet.findMany({
      include: { user: true, transactions: true },
    });
  }

  findByUserId(userId: string): Promise<WalletWithRelations | null> {
    return this.prisma.wallet.findUnique({
      where: { userId },
      include: { user: true, transactions: true },
    });
  }

  async getBalance(userId: string): Promise<WalletBalanceDto> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundException(`Wallet for user ${userId} not found`);
    }

    return {
      balance: normalizeDecimalString(wallet.balance.toString()),
      currency: wallet.currency,
    };
  }

  async createForUser(
    userId: string,
    dto?: CreateWalletDto,
  ): Promise<Wallet> {
    try {
      return await this.prisma.wallet.create({
        data: {
          userId,
          balance: '0',
          currency: dto?.currency ?? WalletCurrency.IRR,
        },
      });
    } catch (error) {
      if (
        error instanceof PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Wallet already exists for user');
      }
      throw error;
    }
  }

  async credit(
    userId: string,
    dto: WalletOperationDto,
  ): Promise<WalletTransaction> {
    const result = await this.applyTransaction({
      userId,
      type: WalletTransactionType.CREDIT,
      amount: dto.amount,
      idempotencyKey: dto.idempotencyKey,
      description: dto.description ?? null,
      refType: dto.refType,
      refId: dto.refId ?? null,
      metadata: dto.metadata ?? null,
      createdById: null,
      resolveOnDuplicate: true,
    });
    return result.transaction;
  }

  async debit(
    userId: string,
    dto: WalletOperationDto,
  ): Promise<WalletTransaction> {
    const result = await this.applyTransaction({
      userId,
      type: WalletTransactionType.DEBIT,
      amount: dto.amount,
      idempotencyKey: dto.idempotencyKey,
      description: dto.description ?? null,
      refType: dto.refType,
      refId: dto.refId ?? null,
      metadata: dto.metadata ?? null,
      createdById: null,
      resolveOnDuplicate: true,
    });
    return result.transaction;
  }

  async transfer(
    fromUserId: string,
    dto: CreateWalletTransferDto,
  ): Promise<{
    groupId: string;
    debit: WalletTransaction;
    credit: WalletTransaction;
    fromBalanceAfter: string;
    toBalanceAfter: string;
  }> {
    if (fromUserId === dto.toUserId) {
      throw new BadRequestException({
        code: 'INVALID_RECIPIENT',
        message: 'امکان انتقال به کیف پول خودتان وجود ندارد',
      });
    }

    await this.rateLimit.consume(fromUserId, 'transfer');

    const amountMinor = this.parseAmount(dto.amount);
    if (amountMinor <= 0n) {
      throw new BadRequestException({
        code: 'INVALID_AMOUNT',
        message: 'مبلغ انتقال باید بیشتر از صفر باشد',
      });
    }

    const groupId = randomUUID();

    const result = await this.prisma.$transaction(
      async (tx) => {
        const [fromWallet, toWallet] = await Promise.all([
          tx.wallet.findUnique({
            where: { userId: fromUserId },
            select: { id: true, userId: true, balance: true },
          }),
          tx.wallet.findUnique({
            where: { userId: dto.toUserId },
            select: { id: true, userId: true, balance: true },
          }),
        ]);

        if (!fromWallet) {
          throw new NotFoundException('کیف پول مبدا یافت نشد');
        }
        if (!toWallet) {
          throw new NotFoundException('کیف پول مقصد یافت نشد');
        }

        const existingDebit = await tx.walletTransaction.findUnique({
          where: {
            walletId_idempotencyKey: {
              walletId: fromWallet.id,
              idempotencyKey: dto.idempotencyKey,
            },
          },
        });

        if (existingDebit) {
          const related = await tx.walletTransaction.findMany({
            where: { groupId: existingDebit.groupId ?? undefined },
          });
          throw new ConflictException({
            code: 'TX_ALREADY_PROCESSED',
            message: 'تراکنش با این کلید قبلاً ثبت شده است',
            groupId: existingDebit.groupId,
            transactionIds: related.map((txItem) => txItem.id),
          });
        }

        const fromBalanceMinor = decimalStringToMinorUnits(
          fromWallet.balance.toString(),
        );
        if (fromBalanceMinor < amountMinor) {
          throw new BadRequestException({
            code: 'INSUFFICIENT_FUNDS',
            message: 'موجودی کافی نیست',
          });
        }
        const toBalanceMinor = decimalStringToMinorUnits(
          toWallet.balance.toString(),
        );

        const newFromBalanceMinor = fromBalanceMinor - amountMinor;
        const newToBalanceMinor = toBalanceMinor + amountMinor;

        const debit = await tx.walletTransaction.create({
          data: {
            walletId: fromWallet.id,
            userId: fromWallet.userId,
            type: WalletTransactionType.DEBIT,
            status: WalletTransactionStatus.COMPLETED,
            amount: minorUnitsToDecimalString(amountMinor),
            balanceAfter: minorUnitsToDecimalString(newFromBalanceMinor),
            refType: WalletTransactionRefType.ADJUSTMENT,
            refId: null,
            description: dto.description ?? null,
            idempotencyKey: dto.idempotencyKey,
            metadata: {
              origin: 'wallet-transfer',
              direction: 'out',
              toUserId: dto.toUserId,
            },
            createdById: fromUserId,
            groupId,
          },
        });

        const credit = await tx.walletTransaction.create({
          data: {
            walletId: toWallet.id,
            userId: toWallet.userId,
            type: WalletTransactionType.CREDIT,
            status: WalletTransactionStatus.COMPLETED,
            amount: minorUnitsToDecimalString(amountMinor),
            balanceAfter: minorUnitsToDecimalString(newToBalanceMinor),
            refType: WalletTransactionRefType.ADJUSTMENT,
            refId: null,
            description: dto.description ?? null,
            idempotencyKey: groupId,
            metadata: {
              origin: 'wallet-transfer',
              direction: 'in',
              fromUserId,
            },
            createdById: fromUserId,
            groupId,
          },
        });

        const [updatedFrom, updatedTo] = await Promise.all([
          tx.wallet.update({
            where: { id: fromWallet.id },
            data: {
              balance: minorUnitsToDecimalString(newFromBalanceMinor),
            },
          }),
          tx.wallet.update({
            where: { id: toWallet.id },
            data: {
              balance: minorUnitsToDecimalString(newToBalanceMinor),
            },
          }),
        ]);

        return {
          groupId,
          debit,
          credit,
          fromBalanceAfter: updatedFrom.balance.toString(),
          toBalanceAfter: updatedTo.balance.toString(),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    await this.audit.log({
      userId: fromUserId,
      walletId: result.debit.walletId,
      action: 'transfer',
      meta: {
        groupId: result.groupId,
        debitId: result.debit.id,
        creditId: result.credit.id,
        amount: result.debit.amount,
        toUserId: dto.toUserId,
      },
    });

    await this.audit.log({
      userId: result.credit.userId,
      walletId: result.credit.walletId,
      action: 'transfer_received',
      meta: {
        groupId: result.groupId,
        debitId: result.debit.id,
        creditId: result.credit.id,
        amount: result.credit.amount,
        fromUserId,
      },
    });

    this.logDevSuccess(result.debit, result.fromBalanceAfter);
    this.logDevSuccess(result.credit, result.toBalanceAfter);

    return result;
  }

  async createUserTransaction(
    userId: string,
    dto: CreateWalletTransactionDto,
  ): Promise<{ transaction: WalletTransaction; balanceAfter: string }> {
    await this.rateLimit.consume(userId, 'tx');

    const refType = WalletTransactionRefType.ADJUSTMENT;

    if (dto.status === 'pending') {
      const pending = await this.createPendingTransaction({
        userId,
        type: dto.type,
        amount: dto.amount,
        idempotencyKey: dto.idempotencyKey,
        description: dto.description ?? null,
        provider: dto.provider ?? null,
        externalRef: dto.externalRef ?? null,
      });

      await this.audit.log({
        userId,
        walletId: pending.transaction.walletId,
        action: 'create_tx_pending',
        meta: {
          transactionId: pending.transaction.id,
          type: dto.type,
          amount: pending.transaction.amount,
          idempotencyKey: dto.idempotencyKey,
          provider: dto.provider ?? null,
          externalRef: dto.externalRef ?? null,
        },
      });

      return pending;
    }

    const metadata: Prisma.InputJsonValue = {
      origin: 'wallet-api',
      provider: dto.provider ?? null,
      externalRef: dto.externalRef ?? null,
    };

    const result = await this.applyTransaction({
      userId,
      type:
        dto.type === 'credit'
          ? WalletTransactionType.CREDIT
          : WalletTransactionType.DEBIT,
      amount: dto.amount,
      idempotencyKey: dto.idempotencyKey,
      description: dto.description ?? null,
      refType,
      refId: null,
      metadata,
      createdById: userId,
      provider: dto.provider ?? null,
      externalRef: dto.externalRef ?? null,
    });

    await this.audit.log({
      userId,
      walletId: result.transaction.walletId,
      action: 'create_tx',
      meta: {
        transactionId: result.transaction.id,
        type: result.transaction.type,
        amount: result.transaction.amount,
        idempotencyKey: dto.idempotencyKey,
      },
    });

    this.logDevSuccess(result.transaction, result.balanceAfter);

    return result;
  }

  async confirmWebhook(
    provider: string,
    dto: WalletWebhookDto,
  ): Promise<{
    transaction: WalletTransaction;
    balanceAfter: string;
    updated: boolean;
  }> {
    const amountMinor = this.parseAmount(dto.amount);

    const outcome = await this.prisma.$transaction(
      async (tx) => {
        const transaction = await tx.walletTransaction.findFirst({
          where: {
            provider,
            externalRef: dto.externalRef,
          },
        });

        if (!transaction) {
          throw new NotFoundException('تراکنش با این مرجع یافت نشد');
        }

        if (transaction.userId !== dto.userId) {
          throw new BadRequestException({
            code: 'USER_MISMATCH',
            message: 'شناسه کاربر در درخواست تطابق ندارد',
          });
        }

        if (transaction.type !== dto.type) {
          throw new BadRequestException({
            code: 'TYPE_MISMATCH',
            message: 'نوع تراکنش با درخواست اولیه سازگار نیست',
          });
        }

        const wallet = await tx.wallet.findUnique({
          where: { id: transaction.walletId },
        });

        if (!wallet) {
          throw new NotFoundException('کیف پول مرتبط یافت نشد');
        }

        const normalizedAmount = minorUnitsToDecimalString(amountMinor);
        if (
          normalizeDecimalString(transaction.amount.toString()) !==
          normalizedAmount
        ) {
          throw new BadRequestException({
            code: 'AMOUNT_MISMATCH',
            message: 'مبلغ تأیید شده با مبلغ اولیه متفاوت است',
          });
        }

        if (transaction.status !== WalletTransactionStatus.PENDING) {
          return {
            transaction,
            balanceAfter: normalizeDecimalString(
              (transaction.balanceAfter ?? wallet.balance).toString(),
            ),
            updated: false,
          };
        }

        const currentBalanceMinor = decimalStringToMinorUnits(
          wallet.balance.toString(),
        );

        let balanceAfter = normalizeDecimalString(wallet.balance.toString());
        let status: WalletTransactionStatus;
        let newBalanceMinor = currentBalanceMinor;

        if (dto.status === 'success') {
          if (transaction.type === WalletTransactionType.CREDIT) {
            newBalanceMinor = currentBalanceMinor + amountMinor;
          } else {
            if (currentBalanceMinor < amountMinor) {
              status = WalletTransactionStatus.FAILED;
              const failedTx = await tx.walletTransaction.update({
                where: { id: transaction.id },
                data: {
                  status,
                  balanceAfter,
                  metadata: {
                    ...(transaction.metadata as Record<string, unknown> ?? {}),
                    webhookStatus: dto.status,
                    failedReason: 'insufficient_balance_on_confirm',
                  },
                },
              });
              return {
                transaction: failedTx,
                balanceAfter,
                updated: true,
              };
            }
            newBalanceMinor = currentBalanceMinor - amountMinor;
          }

          balanceAfter = minorUnitsToDecimalString(newBalanceMinor);
          status = WalletTransactionStatus.COMPLETED;

          await tx.wallet.update({
            where: { id: wallet.id },
            data: { balance: balanceAfter },
          });
          this.logDevSuccess(transaction, balanceAfter);
        } else {
          status = WalletTransactionStatus.FAILED;
        }

        const saved = await tx.walletTransaction.update({
          where: { id: transaction.id },
          data: {
            status,
            balanceAfter,
            metadata: {
              ...(transaction.metadata as Record<string, unknown> ?? {}),
              webhookStatus: dto.status,
              confirmedAt: new Date().toISOString(),
            },
          },
        });

        return {
          transaction: saved,
          balanceAfter,
          updated: true,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    await this.audit.log({
      userId: outcome.transaction.userId,
      walletId: outcome.transaction.walletId,
      action: 'confirm_webhook',
      meta: {
        provider,
        externalRef: dto.externalRef,
        updated: outcome.updated,
        status: outcome.transaction.status,
      },
    });

    return outcome;
  }

  private async createPendingTransaction(input: {
    userId: string;
    type: 'credit' | 'debit';
    amount: number;
    idempotencyKey: string;
    description?: string | null;
    provider?: string | null;
    externalRef?: string | null;
  }): Promise<{ transaction: WalletTransaction; balanceAfter: string }> {
    const amountMinor = this.parseAmount(input.amount);

    return this.prisma.$transaction(
      async (tx) => {
        const wallet = await tx.wallet.findUnique({
          where: { userId: input.userId },
        });

        if (!wallet) {
          throw new NotFoundException('کیف پول یافت نشد');
        }

        const existing = await tx.walletTransaction.findUnique({
          where: {
            walletId_idempotencyKey: {
              walletId: wallet.id,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });

        if (existing) {
          throw new ConflictException({
            code: 'TX_ALREADY_PROCESSED',
            message: 'تراکنش با این کلید قبلاً ثبت شده است',
            transactionId: existing.id,
          });
        }

        const currentBalance = normalizeDecimalString(wallet.balance.toString());

        const pending = await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            userId: wallet.userId,
            type:
              input.type === 'credit'
                ? WalletTransactionType.CREDIT
                : WalletTransactionType.DEBIT,
            status: WalletTransactionStatus.PENDING,
            amount: minorUnitsToDecimalString(amountMinor),
            balanceAfter: currentBalance,
            refType: WalletTransactionRefType.ADJUSTMENT,
            refId: null,
            description: input.description ?? null,
            idempotencyKey: input.idempotencyKey,
            metadata: {
              origin: 'wallet-api',
              mode: 'pending',
              provider: input.provider ?? null,
              externalRef: input.externalRef ?? null,
            },
            provider: input.provider ?? null,
            externalRef: input.externalRef ?? null,
            createdById: input.userId,
          },
        });

        return {
          transaction: pending,
          balanceAfter: currentBalance,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async applyTransaction(
    options: ApplyTransactionOptions,
  ): Promise<{ transaction: WalletTransaction; balanceAfter: string }> {
    const amountMinor = this.parseAmount(options.amount);

    return this.prisma.$transaction(
      async (tx) => {
        const wallet = await tx.wallet.findUnique({
          where: { userId: options.userId },
        });

        if (!wallet) {
          throw new NotFoundException('Wallet not found');
        }

        const existing = await tx.walletTransaction.findUnique({
          where: {
            walletId_idempotencyKey: {
              walletId: wallet.id,
              idempotencyKey: options.idempotencyKey,
            },
          },
        });

        if (existing) {
          if (options.resolveOnDuplicate) {
            const balanceAfter = normalizeDecimalString(
              (existing.balanceAfter ?? wallet.balance).toString(),
            );
            return { transaction: existing, balanceAfter };
          }
          throw new ConflictException({
            code: 'TX_ALREADY_PROCESSED',
            message: 'تراکنش با این کلید قبلاً ثبت شده است',
            transactionId: existing.id,
          });
        }

        const currentBalanceMinor = decimalStringToMinorUnits(
          wallet.balance.toString(),
        );

        let newBalanceMinor = currentBalanceMinor;
        if (options.type === WalletTransactionType.CREDIT) {
          newBalanceMinor += amountMinor;
        } else {
          if (currentBalanceMinor < amountMinor) {
            throw new BadRequestException({
              code: 'INSUFFICIENT_FUNDS',
              message: 'موجودی کافی نیست',
            });
          }
          newBalanceMinor -= amountMinor;
        }

        const balanceAfter = minorUnitsToDecimalString(newBalanceMinor);

        const transaction = await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            userId: wallet.userId,
            type: options.type,
            status: WalletTransactionStatus.COMPLETED,
            amount: minorUnitsToDecimalString(amountMinor),
            balanceAfter,
            refType: options.refType ?? WalletTransactionRefType.ADJUSTMENT,
            refId: options.refId ?? null,
            description: options.description ?? null,
            idempotencyKey: options.idempotencyKey,
            metadata: this.normalizeJsonInput(options.metadata),
            createdById: options.createdById ?? null,
            provider: options.provider ?? null,
            externalRef: options.externalRef ?? null,
            groupId: options.groupId ?? null,
          },
        });

        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: balanceAfter },
        });

        return {
          transaction,
          balanceAfter,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private normalizeJsonInput(
    value: Prisma.InputJsonValue | null | undefined,
  ): Prisma.InputJsonValue {
    return (value ?? Prisma.JsonNull) as Prisma.InputJsonValue;
  }

  private parseAmount(amount: number | string): bigint {
    try {
      return parseAmountToMinorUnits(amount);
    } catch {
      throw new BadRequestException({
        code: 'INVALID_AMOUNT_FORMAT',
        message: 'فرمت مبلغ صحیح نیست. مثال: 250000 یا 250000.50',
      });
    }
  }

  private isDev(): boolean {
    const env =
      this.config.get<string>('NODE_ENV') ?? process.env.NODE_ENV ?? 'development';
    return env.toLowerCase() === 'development';
  }

  private logDevSuccess(tx: WalletTransaction, balanceAfter: string) {
    if (!this.isDev()) {
      return;
    }
    const amount = normalizeDecimalString(tx.amount.toString());
    this.logger.log(
      `تراکنش موفق: مبلغ ${amount} نوع ${tx.type} برای کاربر ${tx.userId}، موجودی جدید ${balanceAfter}`,
    );
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import {
  WalletTransaction,
  WalletTransactionStatus,
  WalletTransactionType,
  WalletTransactionRefType,
} from '../wallet-transactions/wallet-transaction.entity';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { WalletBalanceDto } from './dto/wallet-balance.dto';
import { WalletOperationDto } from './dto/wallet-operation.dto';
import { CreateWalletTransactionDto } from './dto/create-wallet-transaction.dto';
import { Wallet, WalletCurrency } from './wallet.entity';
import {
  decimalStringToMinorUnits,
  minorUnitsToDecimalString,
  normalizeDecimalString,
  parseAmountToMinorUnits,
} from './utils/amount.util';
import { WalletAuditService } from './wallet-audit.service';
import { WalletRateLimitService } from './wallet-rate-limit.service';
import { randomUUID } from 'node:crypto';
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
  metadata?: Record<string, unknown> | null;
  createdById?: string | null;
  resolveOnDuplicate?: boolean;
  provider?: string | null;
  externalRef?: string | null;
  groupId?: string | null;
}

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  constructor(
    @InjectRepository(Wallet)
    private readonly walletsRepository: Repository<Wallet>,
    @InjectRepository(WalletTransaction)
    private readonly walletTransactionsRepository: Repository<WalletTransaction>,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly audit: WalletAuditService,
    private readonly rateLimit: WalletRateLimitService,
  ) {}

  findAll(): Promise<Wallet[]> {
    return this.walletsRepository.find({
      relations: {
        user: true,
        transactions: true,
      },
    });
  }

  findByUserId(userId: string): Promise<Wallet | null> {
    return this.walletsRepository.findOne({
      where: { userId },
      relations: {
        user: true,
        transactions: true,
      },
    });
  }

  async getBalance(userId: string): Promise<WalletBalanceDto> {
    const wallet = await this.walletsRepository.findOne({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundException(`Wallet for user ${userId} not found`);
    }

    return {
      balance: normalizeDecimalString(wallet.balance ?? '0'),
      currency: wallet.currency,
    };
  }

  async createForUser(
    userId: string,
    dto?: CreateWalletDto,
  ): Promise<Wallet> {
    const existing = await this.findByUserId(userId);
    if (existing) {
      throw new ConflictException('Wallet already exists for user');
    }

    return this.walletsRepository.save(
      this.walletsRepository.create({
        userId,
        balance: '0',
        currency: dto?.currency ?? WalletCurrency.IRR,
      }),
    );
  }

  async credit(userId: string, dto: WalletOperationDto): Promise<WalletTransaction> {
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

  async debit(userId: string, dto: WalletOperationDto): Promise<WalletTransaction> {
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

    const result = await this.dataSource.transaction(async (manager) => {
      const walletRepo = manager.getRepository(Wallet);
      const txRepo = manager.getRepository(WalletTransaction);

      const wallets = await walletRepo
        .createQueryBuilder('wallet')
        .setLock('pessimistic_write')
        .where('wallet.userId IN (:...userIds)', {
          userIds: [fromUserId, dto.toUserId],
        })
        .orderBy('wallet.id', 'ASC')
        .getMany();

      const fromWallet = wallets.find((wallet) => wallet.userId === fromUserId);
      const toWallet = wallets.find((wallet) => wallet.userId === dto.toUserId);

      if (!fromWallet) {
        throw new NotFoundException('کیف پول مبدا یافت نشد');
      }
      if (!toWallet) {
        throw new NotFoundException('کیف پول مقصد یافت نشد');
      }

      const existingDebit = await txRepo.findOne({
        where: {
          walletId: fromWallet.id,
          idempotencyKey: dto.idempotencyKey,
        },
      });

      if (existingDebit) {
        const related = existingDebit.groupId
          ? await txRepo.find({ where: { groupId: existingDebit.groupId } })
          : [existingDebit];
        throw new ConflictException({
          code: 'TX_ALREADY_PROCESSED',
          message: 'این انتقال قبلاً ثبت شده است',
          groupId: existingDebit.groupId,
          transactionIds: related.map((tx) => tx.id),
        });
      }

      const fromBalanceMinor = decimalStringToMinorUnits(
        fromWallet.balance ?? '0',
      );
      if (fromBalanceMinor < amountMinor) {
        throw new BadRequestException({
          code: 'INSUFFICIENT_FUNDS',
          message: 'موجودی کیف پول کافی نیست',
        });
      }
      const toBalanceMinor = decimalStringToMinorUnits(toWallet.balance ?? '0');

      const newFromBalance = fromBalanceMinor - amountMinor;
      const newToBalance = toBalanceMinor + amountMinor;

      const debitTx = txRepo.create({
        walletId: fromWallet.id,
        userId: fromWallet.userId,
        type: WalletTransactionType.DEBIT,
        status: WalletTransactionStatus.COMPLETED,
        amount: minorUnitsToDecimalString(amountMinor),
        balanceAfter: minorUnitsToDecimalString(newFromBalance),
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
      });

      const creditTx = txRepo.create({
        walletId: toWallet.id,
        userId: toWallet.userId,
        type: WalletTransactionType.CREDIT,
        status: WalletTransactionStatus.COMPLETED,
        amount: minorUnitsToDecimalString(amountMinor),
        balanceAfter: minorUnitsToDecimalString(newToBalance),
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
      });

      const savedDebit = await txRepo.save(debitTx);
      const savedCredit = await txRepo.save(creditTx);

      fromWallet.balance = minorUnitsToDecimalString(newFromBalance);
      toWallet.balance = minorUnitsToDecimalString(newToBalance);
      await walletRepo.save(fromWallet);
      await walletRepo.save(toWallet);

      return {
        groupId,
        debit: savedDebit,
        credit: savedCredit,
        fromBalanceAfter: fromWallet.balance,
        toBalanceAfter: toWallet.balance,
      };
    });

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

    const metadata = {
      origin: 'wallet-api',
      provider: dto.provider ?? null,
      externalRef: dto.externalRef ?? null,
    } as Record<string, unknown>;

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

    return this.dataSource.transaction(async (manager) => {
      const walletRepo = manager.getRepository(Wallet);
      const txRepo = manager.getRepository(WalletTransaction);

      const wallet = await walletRepo
        .createQueryBuilder('wallet')
        .setLock('pessimistic_write')
        .where('wallet.userId = :userId', { userId: input.userId })
        .getOne();

      if (!wallet) {
        throw new NotFoundException('کیف پولی برای این کاربر یافت نشد');
      }

      const existing = await txRepo.findOne({
        where: {
          walletId: wallet.id,
          idempotencyKey: input.idempotencyKey,
        },
      });

      if (existing) {
        throw new ConflictException({
          code: 'TX_ALREADY_PROCESSED',
          message: 'تراکنش با این کلید قبلاً ثبت شده است',
          transactionId: existing.id,
        });
      }

      const currentBalance = normalizeDecimalString(wallet.balance ?? '0');

      const pending = txRepo.create({
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
      });

      const saved = await txRepo.save(pending);

      return {
        transaction: saved,
        balanceAfter: currentBalance,
      };
    });
  }

  async confirmWebhook(
    provider: string,
    dto: WalletWebhookDto,
  ): Promise<{ transaction: WalletTransaction; balanceAfter: string; updated: boolean }>
  {
    const amountMinor = this.parseAmount(dto.amount);

    const result = await this.dataSource.transaction(async (manager) => {
      const txRepo = manager.getRepository(WalletTransaction);
      const walletRepo = manager.getRepository(Wallet);

      const transaction = await txRepo
        .createQueryBuilder('tx')
        .setLock('pessimistic_write')
        .where('tx.provider = :provider AND tx.externalRef = :externalRef', {
          provider,
          externalRef: dto.externalRef,
        })
        .getOne();

      if (!transaction) {
        throw new NotFoundException('تراکنش در انتظار برای تایید یافت نشد');
      }

      if (transaction.userId !== dto.userId) {
        throw new BadRequestException({
          code: 'USER_MISMATCH',
          message: 'اطلاعات کاربر با تراکنش در انتظار همخوانی ندارد',
        });
      }

      if (transaction.type !== dto.type) {
        throw new BadRequestException({
          code: 'TYPE_MISMATCH',
          message: 'نوع تراکنش با اطلاعات وب‌هوک همخوانی ندارد',
        });
      }

      const wallet = await walletRepo
        .createQueryBuilder('wallet')
        .setLock('pessimistic_write')
        .where('wallet.id = :walletId', { walletId: transaction.walletId })
        .getOne();

      if (!wallet) {
        throw new NotFoundException('کیف پول مرتبط با تراکنش یافت نشد');
      }

      const normalizedAmount = minorUnitsToDecimalString(amountMinor);
      if (normalizeDecimalString(transaction.amount) !== normalizedAmount) {
        throw new BadRequestException({
          code: 'AMOUNT_MISMATCH',
          message: 'مبلغ اعلام شده با تراکنش در انتظار مطابقت ندارد',
        });
      }

      const alreadyFinal =
        transaction.status !== WalletTransactionStatus.PENDING;
      if (alreadyFinal) {
        return {
          transaction,
          balanceAfter: normalizeDecimalString(
            transaction.balanceAfter ?? wallet.balance ?? '0',
          ),
          updated: false,
        };
      }

      const currentBalanceMinor = decimalStringToMinorUnits(
        wallet.balance ?? '0',
      );

      let balanceAfter = normalizeDecimalString(wallet.balance ?? '0');

      if (dto.status === 'success') {
        let newBalanceMinor = currentBalanceMinor;
        if (transaction.type === WalletTransactionType.CREDIT) {
          newBalanceMinor = currentBalanceMinor + amountMinor;
        } else {
          if (currentBalanceMinor < amountMinor) {
            transaction.status = WalletTransactionStatus.FAILED;
            transaction.balanceAfter = balanceAfter;
            transaction.metadata = {
              ...(transaction.metadata ?? {}),
              webhookStatus: dto.status,
              failedReason: 'insufficient_balance_on_confirm',
            };

            const failedTx = await txRepo.save(transaction);

            return {
              transaction: failedTx,
              balanceAfter,
              updated: true,
            };
          }
          newBalanceMinor = currentBalanceMinor - amountMinor;
        }

        wallet.balance = minorUnitsToDecimalString(newBalanceMinor);
        balanceAfter = wallet.balance;
        transaction.balanceAfter = balanceAfter;
        transaction.status = WalletTransactionStatus.COMPLETED;
        await walletRepo.save(wallet);
        this.logDevSuccess(transaction, balanceAfter);
      } else {
        transaction.status = WalletTransactionStatus.FAILED;
        transaction.balanceAfter = balanceAfter;
      }

      transaction.metadata = {
        ...(transaction.metadata ?? {}),
        webhookStatus: dto.status,
        confirmedAt: new Date().toISOString(),
      };

      const saved = await txRepo.save(transaction);

      return {
        transaction: saved,
        balanceAfter,
        updated: true,
      };
    });

    await this.audit.log({
      userId: result.transaction.userId,
      walletId: result.transaction.walletId,
      action: 'webhook_confirm',
      meta: {
        provider,
        externalRef: result.transaction.externalRef,
        status: result.transaction.status,
        transactionId: result.transaction.id,
      },
    });

    return result;
  }


  private async applyTransaction(
    options: ApplyTransactionOptions,
  ): Promise<{ transaction: WalletTransaction; balanceAfter: string }> {
    const {
      userId,
      type,
      amount,
      idempotencyKey,
      description,
      refType = WalletTransactionRefType.ADJUSTMENT,
      refId = null,
      metadata = null,
      createdById = null,
      resolveOnDuplicate = false,
      provider = null,
      externalRef = null,
      groupId = null,
    } = options;

    const amountMinor = this.parseAmount(amount);
    if (amountMinor <= 0n) {
      throw new BadRequestException({
        code: 'INVALID_AMOUNT',
        message: 'مبلغ تراکنش باید بزرگتر از صفر باشد',
      });
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        const walletRepository = manager.getRepository(Wallet);
        const txRepository = manager.getRepository(WalletTransaction);

        const wallet = await walletRepository
          .createQueryBuilder('wallet')
          .setLock('pessimistic_write')
          .where('wallet.userId = :userId', { userId })
          .getOne();

        if (!wallet) {
          throw new NotFoundException('کیف پولی برای این کاربر یافت نشد');
        }

        const existing = await txRepository
          .createQueryBuilder('tx')
          .setLock('pessimistic_read')
          .where('tx.walletId = :walletId AND tx.idempotencyKey = :key', {
            walletId: wallet.id,
            key: idempotencyKey,
          })
          .getOne();

        if (existing) {
          if (resolveOnDuplicate) {
            return {
              transaction: existing,
              balanceAfter: normalizeDecimalString(wallet.balance ?? '0'),
            };
          }
          throw new ConflictException({
            code: 'TX_ALREADY_PROCESSED',
            message: 'تراکنش با این کلید قبلاً ثبت شده است',
            transactionId: existing.id,
          });
        }

        const currentBalanceMinor = decimalStringToMinorUnits(
          wallet.balance ?? '0',
        );

        if (
          type === WalletTransactionType.DEBIT &&
          currentBalanceMinor < amountMinor
        ) {
          throw new BadRequestException({
            code: 'INSUFFICIENT_FUNDS',
            message: 'موجودی کیف پول کافی نیست',
          });
        }

        const newBalanceMinor =
          type === WalletTransactionType.CREDIT
            ? currentBalanceMinor + amountMinor
            : currentBalanceMinor - amountMinor;

        const pendingTx = txRepository.create({
          walletId: wallet.id,
          userId: wallet.userId,
          type,
          status: WalletTransactionStatus.PENDING,
          amount: minorUnitsToDecimalString(amountMinor),
          balanceAfter: minorUnitsToDecimalString(newBalanceMinor),
          refType,
          refId,
          description: description ?? null,
          idempotencyKey,
          metadata: metadata ?? null,
          createdById,
          provider,
          externalRef,
          groupId,
        });

        const savedPending = await txRepository.save(pendingTx);

        wallet.balance = minorUnitsToDecimalString(newBalanceMinor);
        await walletRepository.save(wallet);

        savedPending.status = WalletTransactionStatus.COMPLETED;
        savedPending.balanceAfter = wallet.balance;
        const completedTx = await txRepository.save(savedPending);

        return {
          transaction: completedTx,
          balanceAfter: wallet.balance,
        };
      });
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      if (this.isDuplicateKeyError(error)) {
        const existingResult = await this.getExistingResult(
          userId,
          idempotencyKey,
        );
        if (existingResult) {
          if (resolveOnDuplicate) {
            return existingResult;
          }
          throw new ConflictException({
            code: 'TX_ALREADY_PROCESSED',
            message: 'تراکنش با این کلید قبلاً ثبت شده است',
            transactionId: existingResult.transaction.id,
          });
        }
      }

      throw error;
    }
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

  private isDuplicateKeyError(error: unknown): boolean {
    if (error instanceof QueryFailedError) {
      const code = error.driverError?.code;
      if (code === '23505') {
        return true;
      }
      const message: string | undefined = error.driverError?.message;
      if (message && message.includes('SQLITE_CONSTRAINT')) {
        return true;
      }
    }
    return false;
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
    const amount = normalizeDecimalString(tx.amount);
    this.logger.log(
      `تراکنش موفق: مبلغ ${amount} نوع ${tx.type} برای کاربر ${tx.userId}، موجودی جدید ${balanceAfter}`,
    );
  }

  private async getExistingResult(
    userId: string,
    idempotencyKey: string,
  ): Promise<{ transaction: WalletTransaction; balanceAfter: string } | null> {
    const wallet = await this.walletsRepository.findOne({ where: { userId } });
    if (!wallet) {
      return null;
    }

    const transaction = await this.walletTransactionsRepository.findOne({
      where: { walletId: wallet.id, idempotencyKey },
    });

    if (!transaction) {
      return null;
    }

    return {
      transaction,
      balanceAfter: normalizeDecimalString(
        transaction.balanceAfter ?? wallet.balance ?? '0',
      ),
    };
  }
}

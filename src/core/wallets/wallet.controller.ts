import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  WalletReadService,
  WalletTransactionsResult,
} from './wallet-read.service';
import { WalletTransactionsQueryDto } from './dto/wallet-transactions-query.dto';
import { WalletsService } from './wallets.service';
import { CreateWalletTransactionDto } from './dto/create-wallet-transaction.dto';
import { normalizeDecimalString } from './utils/amount.util';
import {
  WalletTransaction,
  WalletTransactionStatus,
} from '../wallet-transactions/wallet-transaction.entity';
import { CreateWalletTransferDto } from './dto/create-wallet-transfer.dto';
import { WalletWebhookDto } from './dto/wallet-webhook.dto';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('Core / Wallet')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(
    private readonly walletRead: WalletReadService,
    private readonly walletsService: WalletsService,
    private readonly config: ConfigService,
  ) {}

  @Get('balance')
  @ApiOperation({
    summary: 'Get wallet balance',
    description:
      'Returns the current wallet balance for the authenticated user, seeding demo data when necessary in development.',
  })
  @ApiResponse({
    status: 200,
    description: 'Balance fetched successfully',
    schema: {
      example: {
        success: true,
        data: {
          currency: 'IRR',
          balance: '800000.00',
        },
      },
    },
  })
  async getBalance(
    @CurrentUser() currentUser: CurrentUserPayload | undefined,
  ): Promise<{ currency: string; balance: string }> {
    const userId = this.ensureUser(currentUser);
    await this.walletRead.seedIfNeeded(userId);
    return this.walletRead.getBalance(userId);
  }

  @Get('transactions')
  @ApiOperation({
    summary: 'List wallet transactions',
    description:
      'Returns transactions ordered by createdAt then id in descending order. Cursor format: <ISO timestamp>|<transactionId>.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Maximum number of records per request (1-50).',
    example: 20,
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    type: String,
    description:
      'Cursor for pagination. Example: 2024-01-01T00:00:00.000Z|<transactionId>',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: ['all', 'credit', 'debit'],
    description: 'Transaction type filter (defaults to all).',
  })
  @ApiQuery({
    name: 'fromDate',
    required: false,
    type: String,
    description: 'Inclusive start of the date range (ISO 8601).',
  })
  @ApiQuery({
    name: 'toDate',
    required: false,
    type: String,
    description: 'Inclusive end of the date range (ISO 8601).',
  })
  @ApiResponse({
    status: 200,
    description: 'Transactions listed successfully',
    schema: {
      example: {
        success: true,
        data: {
          items: [
            {
              id: 'uuid-tx-credit',
              type: 'credit',
              status: 'success',
              amount: '1000000.00',
              balanceAfter: '1200000.00',
              createdAt: '2024-01-01T00:00:00.000Z',
              meta: { seedTag: 'wallet-dev-seed', direction: 'credit' },
            },
            {
              id: 'uuid-tx-debit',
              type: 'debit',
              status: 'success',
              amount: '200000.00',
              balanceAfter: '1000000.00',
              createdAt: '2024-01-01T00:01:00.000Z',
              meta: { seedTag: 'wallet-dev-seed', direction: 'debit' },
            },
          ],
          nextCursor: null,
        },
      },
    },
  })
  async listTransactions(
    @CurrentUser() currentUser: CurrentUserPayload | undefined,
    @Query() query: WalletTransactionsQueryDto,
  ): Promise<WalletTransactionsResult> {
    const userId = this.ensureUser(currentUser);
    await this.walletRead.seedIfNeeded(userId);
    return this.walletRead.listTransactions(userId, query);
  }

  @Post('transactions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create wallet transaction',
    description:
      'Creates a credit or debit transaction using an idempotency key while atomically updating the balance.',
  })
  @ApiBody({
    type: CreateWalletTransactionDto,
    description:
      'If the idempotencyKey is reused the transaction is not recreated and a Conflict response is returned.',
    examples: {
      credit: {
        summary: 'Sample credit',
        value: {
          type: 'credit',
          amount: 250000,
          description: 'Increase balance for a sample product sale',
          idempotencyKey: 'txn-1234-test',
        },
      },
      debit: {
        summary: 'Sample debit',
        value: {
          type: 'debit',
          amount: 50000,
          description: 'Debit for settling an order',
          idempotencyKey: 'txn-1234-debit',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Transaction created successfully',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid-tx',
          type: 'credit',
          amount: '250000.00',
          status: 'success',
          balanceAfter: '1050000.00',
          createdAt: '2024-01-01T10:00:00.000Z',
        },
      },
    },
  })
  @ApiResponse({
    status: 409,
    description: 'Duplicate idempotency key',
    schema: {
      example: {
        success: false,
        error: {
          code: 'TX_ALREADY_PROCESSED',
          message: 'A transaction with this idempotency key already exists',
          transactionId: 'existing-tx-id',
        },
      },
    },
  })
  async createTransaction(
    @CurrentUser() currentUser: CurrentUserPayload | undefined,
    @Body() dto: CreateWalletTransactionDto,
  ): Promise<{
    id: string;
    type: 'credit' | 'debit';
    amount: string;
    status: 'pending' | 'success' | 'failed';
    balanceAfter: string;
    createdAt: string;
    description: string | null;
  }> {
    const userId = this.ensureUser(currentUser);
    try {
      await this.walletRead.seedIfNeeded(userId);
      const result = await this.walletsService.createUserTransaction(
        userId,
        dto,
      );
      return this.mapTransactionResponse(result.transaction, result.balanceAfter);
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      throw error;
    }
  }

  @Post('transfer')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Transfer between users',
    description:
      "Moves funds from the current user's wallet to the target wallet atomically.",
  })
  @ApiBody({ type: CreateWalletTransferDto })
  @ApiResponse({ status: 201, description: 'Transfer completed successfully' })
  @ApiResponse({ status: 409, description: 'Duplicate transfer idempotency key' })
  async transfer(
    @CurrentUser() currentUser: CurrentUserPayload | undefined,
    @Body() dto: CreateWalletTransferDto,
  ) {
    const fromUserId = this.ensureUser(currentUser);
    const result = await this.walletsService.transfer(fromUserId, dto);

    return {
      groupId: result.groupId,
      debit: this.mapTransactionResponse(
        result.debit,
        result.fromBalanceAfter,
      ),
      credit: this.mapTransactionResponse(
        result.credit,
        result.toBalanceAfter,
      ),
    };
  }

  @Public()
  @Post('webhook/:provider')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Webhook for pending transactions',
    description:
      'The provider updates the transaction status to success or failed after processing the payment.',
  })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid webhook signature' })
  async confirmWebhook(
    @Param('provider') provider: string,
    @Body() dto: WalletWebhookDto,
    @Headers('x-signature') signature: string | undefined,
  ) {
    this.verifySignature(dto, signature);

    const result = await this.walletsService.confirmWebhook(provider, dto);

    return {
      updated: result.updated,
      transaction: this.mapTransactionResponse(
        result.transaction,
        result.balanceAfter,
      ),
    };
  }

  private ensureUser(currentUser: CurrentUserPayload | undefined): string {
    if (!currentUser?.id) {
      throw new UnauthorizedException('Access token is not valid');
    }
    return currentUser.id;
  }

  private mapTransactionResponse(
    tx: WalletTransaction,
    balanceAfter: string,
  ) {
    return {
      id: tx.id,
      type: tx.type,
      amount: normalizeDecimalString(tx.amount),
      status: this.mapStatus(tx.status),
      balanceAfter: normalizeDecimalString(balanceAfter),
      createdAt: tx.createdAt.toISOString(),
      description: tx.description ?? null,
    };
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

  private verifySignature(body: WalletWebhookDto, signature?: string) {
    const secret = this.config.getOrThrow<string>('WALLET_WEBHOOK_SECRET');
    if (!signature) {
      throw new UnauthorizedException('Webhook signature header was not provided');
    }

    const normalizedSignature = signature.trim().toLowerCase();
    const payload = JSON.stringify(body);
    const expected = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    if (normalizedSignature.length !== expected.length) {
      throw new UnauthorizedException('Webhook signature is invalid');
    }

    try {
      const providedBuffer = Buffer.from(normalizedSignature, 'hex');
      const expectedBuffer = Buffer.from(expected, 'hex');
      if (!timingSafeEqual(providedBuffer, expectedBuffer)) {
        throw new UnauthorizedException('Webhook signature is invalid');
      }
    } catch {
      throw new UnauthorizedException('Webhook signature is invalid');
    }
  }
}

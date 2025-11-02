import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  CurrentUserPayload,
} from '@app/common/decorators/current-user.decorator';
import { RoleName } from '@app/prisma/prisma.constants';
import { FindWalletTransactionsQueryDto } from './dto/find-wallet-transactions-query.dto';
import { WalletTransactionIdParamDto } from './dto/transaction-id-param.dto';
import { WalletTransactionResponseDto } from './dto/transaction-response.dto';
import { WalletTransactionsService } from './wallet-transactions.service';

@ApiTags('Wallet Transactions')
@ApiBearerAuth()
@Controller('core/wallet-transactions')
export class WalletTransactionsController {
  constructor(
    private readonly walletTransactionsService: WalletTransactionsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List wallet transactions' })
  @ApiResponse({ status: 200, description: 'Transactions listed' })
  async findAll(
    @Query() query: FindWalletTransactionsQueryDto,
    @CurrentUser() currentUser: CurrentUserPayload | undefined,
  ): Promise<WalletTransactionResponseDto[]> {
    const effectiveQuery = this.resolveQueryForUser(query, currentUser);
    const result = await this.walletTransactionsService.findAll(effectiveQuery);
    return result.map((transaction) => new WalletTransactionResponseDto(transaction));
  }

  @Get('wallet/:walletId')
  @ApiOperation({ summary: 'List wallet transactions by wallet id' })
  @ApiResponse({ status: 200, description: 'Transactions listed' })
  async findByWallet(
    @Param('walletId') walletId: string,
    @Query() query: FindWalletTransactionsQueryDto,
    @CurrentUser() currentUser: CurrentUserPayload | undefined,
  ): Promise<WalletTransactionResponseDto[]> {
    this.ensureTransactionAccess(walletId, currentUser);
    const result = await this.walletTransactionsService.findByWallet(walletId, query);
    return result.map((transaction) => new WalletTransactionResponseDto(transaction));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get transaction by id' })
  @ApiResponse({ status: 200, description: 'Transaction returned' })
  async findById(
    @Param() params: WalletTransactionIdParamDto,
    @CurrentUser() currentUser: CurrentUserPayload | undefined,
  ): Promise<WalletTransactionResponseDto> {
    if (!currentUser) {
      throw new ForbiddenException('Access denied');
    }

    const transaction = await this.walletTransactionsService.findById(params.id);
    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    this.assertOwnership(transaction.userId, currentUser);

    return new WalletTransactionResponseDto(transaction);
  }

  private resolveQueryForUser(
    query: FindWalletTransactionsQueryDto,
    currentUser: CurrentUserPayload | undefined,
  ): FindWalletTransactionsQueryDto {
    if (!currentUser) {
      throw new ForbiddenException('Access denied');
    }

    const isAdmin = currentUser.roles?.includes(RoleName.ADMIN);
    if (isAdmin) {
      return query;
    }

    return {
      ...query,
      userId: currentUser.id,
    };
  }

  private ensureTransactionAccess(
    _walletId: string,
    currentUser: CurrentUserPayload | undefined,
  ) {
    if (!currentUser) {
      throw new ForbiddenException('Access denied');
    }

    const isAdmin = currentUser.roles?.includes(RoleName.ADMIN);
    if (!isAdmin) {
      throw new ForbiddenException('Only administrators can query by wallet id');
    }
  }

  private assertOwnership(
    ownerId: string,
    currentUser: CurrentUserPayload,
  ) {
    const isOwner = currentUser.id === ownerId;
    const isAdmin = currentUser.roles?.includes(RoleName.ADMIN);

    if (!isOwner && !isAdmin) {
      throw new ForbiddenException('Access denied');
    }
  }
}

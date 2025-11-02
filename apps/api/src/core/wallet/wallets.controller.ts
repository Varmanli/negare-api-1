import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
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
import { Roles } from '@app/common/decorators/roles.decorator';
import { RoleName } from '@app/prisma/prisma.constants';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { WalletOperationDto } from './dto/wallet-operation.dto';
import { WalletUserIdParamDto } from './dto/wallet-user-id-param.dto';
import { WalletsService } from './wallets.service';
import { ParseBigIntPipe } from '@app/common/pipes/parse-bigint.pipe';

@ApiTags('Wallets')
@ApiBearerAuth()
@Controller('core/wallets')
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Get()
  @Roles(RoleName.ADMIN)
  @ApiOperation({ summary: 'List wallets' })
  @ApiResponse({ status: 200, description: 'Wallets listed' })
  findAll() {
    return this.walletsService.findAll();
  }

  @Get(':userId/balance')
  @ApiOperation({ summary: 'Get wallet balance for user' })
  @ApiResponse({ status: 200, description: 'Wallet balance returned' })
  async getBalance(
    @Param() params: WalletUserIdParamDto,
    @CurrentUser() currentUser: CurrentUserPayload | undefined,
  ) {
    this.ensureWalletAccess(params.userId, currentUser);
    return this.walletsService.getBalance(params.userId);
  }

  @Get(':userId')
  @ApiOperation({ summary: 'Get wallet for user' })
  @ApiResponse({ status: 200, description: 'Wallet returned' })
  async findByUser(
    @Param() params: WalletUserIdParamDto,
    @CurrentUser() currentUser: CurrentUserPayload | undefined,
  ) {
    this.ensureWalletAccess(params.userId, currentUser);
    return this.walletsService.findByUserId(params.userId);
  }

  @Post(':userId')
  @Roles(RoleName.ADMIN)
  @ApiOperation({ summary: 'Create wallet for user' })
  @ApiResponse({ status: 201, description: 'Wallet created' })
  createForUser(
    @Param() params: WalletUserIdParamDto,
    @Body() dto: CreateWalletDto,
  ) {
    return this.walletsService.createForUser(params.userId, dto);
  }

  @Post(':userId/credit')
  @ApiOperation({ summary: 'Credit wallet for user' })
  @ApiResponse({ status: 201, description: 'Wallet credited' })
  credit(
    @Param() params: WalletUserIdParamDto,
    @Body() dto: WalletOperationDto,
    @Body('amount', ParseBigIntPipe) amount: bigint,
    @CurrentUser() currentUser: CurrentUserPayload | undefined,
  ) {
    this.ensureWalletAccess(params.userId, currentUser);
    const payload: WalletOperationDto = {
      ...dto,
      amount: amount.toString(),
    };
    return this.walletsService.credit(params.userId, payload);
  }

  @Post(':userId/debit')
  @ApiOperation({ summary: 'Debit wallet for user' })
  @ApiResponse({ status: 201, description: 'Wallet debited' })
  debit(
    @Param() params: WalletUserIdParamDto,
    @Body() dto: WalletOperationDto,
    @Body('amount', ParseBigIntPipe) amount: bigint,
    @CurrentUser() currentUser: CurrentUserPayload | undefined,
  ) {
    this.ensureWalletAccess(params.userId, currentUser);
    const payload: WalletOperationDto = {
      ...dto,
      amount: amount.toString(),
    };
    return this.walletsService.debit(params.userId, payload);
  }

  private ensureWalletAccess(
    userId: string,
    currentUser: CurrentUserPayload | undefined,
  ) {
    if (!currentUser) {
      throw new ForbiddenException('Access denied');
    }

    const isOwner = currentUser.id === userId;
    const isAdmin = currentUser.roles?.includes(RoleName.ADMIN);

    if (!isOwner && !isAdmin) {
      throw new ForbiddenException('Access denied');
    }
  }
}

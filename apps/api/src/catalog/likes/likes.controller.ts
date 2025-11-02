import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@app/core/auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '@app/common/decorators/current-user.decorator';
import { LikesService } from './likes.service';
import { ToggleLikeDto } from './dtos/toggle-like.dto';
import { ToggleLikeResponseDto } from './dtos/toggle-like-response.dto';
import { ListQueryDto } from '../dtos/list-query.dto';
import { ProductListResponseDto } from '../products/dtos/product-list-response.dto';

@ApiTags('Catalog Likes')
@Controller('catalog/products')
export class LikesController {
  constructor(private readonly likesService: LikesService) {}

  @Post(':id/like')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiCookieAuth('refresh_token')
  @ApiOperation({
    summary: 'Toggle like state for a product',
    description:
      'Adds or removes a like for the authenticated user. Accepts an optional body to enforce a specific state and keeps counters in sync.',
  })
  @ApiOkResponse({
    description: 'Updated like state and current product like counter.',
    type: ToggleLikeResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required.' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions to like this product.' })
  @ApiNotFoundResponse({ description: 'Product not found.' })
  @ApiConflictResponse({ description: 'Like state could not be updated due to a conflict.' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded.' })
  @ApiInternalServerErrorResponse({ description: 'Unexpected server error.' })
  async toggleLike(
    @Param('id') productId: string,
    @Body() dto: ToggleLikeDto,
    @CurrentUser() currentUser: CurrentUserPayload,
  ): Promise<ToggleLikeResponseDto> {
    return this.likesService.toggleLike(
      currentUser.id,
      productId,
      dto?.liked,
    );
  }
}

@ApiTags('Profile Likes')
@Controller('profile/likes')
export class ProfileLikesController {
  constructor(private readonly likesService: LikesService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiCookieAuth('refresh_token')
  @ApiOperation({
    summary: 'List liked products',
    description:
      'Returns a paginated list of products liked by the authenticated user ordered by most recent likes first.',
  })
  @ApiOkResponse({
    description: 'Paginated liked products for the current user.',
    type: ProductListResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required.' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions to view liked products.' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded.' })
  @ApiInternalServerErrorResponse({ description: 'Unexpected server error.' })
  async listLikedProducts(
    @Query() query: ListQueryDto,
    @CurrentUser() currentUser: CurrentUserPayload,
  ): Promise<ProductListResponseDto> {
    const result = await this.likesService.listLikedProducts(
      currentUser.id,
      query,
    );

    return {
      data: result.data,
      total: result.total,
      page: result.page,
      limit: result.limit,
      hasNext: result.hasNext,
    };
  }
}

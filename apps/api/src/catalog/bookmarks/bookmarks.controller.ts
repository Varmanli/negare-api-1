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
import { BookmarksService } from './bookmarks.service';
import { ToggleBookmarkDto } from './dtos/toggle-bookmark.dto';
import { ToggleBookmarkResponseDto } from './dtos/toggle-bookmark-response.dto';
import { ListQueryDto } from '../dtos/list-query.dto';
import { ProductListResponseDto } from '../products/dtos/product-list-response.dto';

@ApiTags('Catalog Bookmarks')
@Controller('catalog/products')
export class BookmarksController {
  constructor(private readonly bookmarksService: BookmarksService) {}

  @Post(':id/bookmark')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiCookieAuth('refresh_token')
  @ApiOperation({
    summary: 'Toggle bookmark state for a product',
    description:
      'Adds or removes a bookmark for the authenticated user. Accepts an optional body to enforce a specific state.',
  })
  @ApiOkResponse({
    description: 'Updated bookmark state for the product.',
    type: ToggleBookmarkResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required.' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions to bookmark this product.' })
  @ApiNotFoundResponse({ description: 'Product not found.' })
  @ApiConflictResponse({ description: 'Bookmark state could not be updated due to a conflict.' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded.' })
  @ApiInternalServerErrorResponse({ description: 'Unexpected server error.' })
  async toggleBookmark(
    @Param('id') productId: string,
    @Body() dto: ToggleBookmarkDto,
    @CurrentUser() currentUser: CurrentUserPayload,
  ): Promise<ToggleBookmarkResponseDto> {
    return this.bookmarksService.toggleBookmark(
      currentUser.id,
      productId,
      dto?.bookmarked,
    );
  }
}

@ApiTags('Profile Bookmarks')
@Controller('profile/bookmarks')
export class ProfileBookmarksController {
  constructor(private readonly bookmarksService: BookmarksService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiCookieAuth('refresh_token')
  @ApiOperation({
    summary: 'List bookmarked products',
    description:
      'Returns a paginated list of products bookmarked by the authenticated user ordered by most recent bookmarks first.',
  })
  @ApiOkResponse({
    description: 'Paginated bookmarked products for the current user.',
    type: ProductListResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required.' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions to view bookmarked products.' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded.' })
  @ApiInternalServerErrorResponse({ description: 'Unexpected server error.' })
  async listBookmarkedProducts(
    @Query() query: ListQueryDto,
    @CurrentUser() currentUser: CurrentUserPayload,
  ): Promise<ProductListResponseDto> {
    const result = await this.bookmarksService.listBookmarkedProducts(
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

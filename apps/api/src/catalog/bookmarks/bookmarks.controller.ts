import {
  Controller,
  Post,
  Delete,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { BookmarksService } from './bookmarks.service';
import { BookmarkListQueryDto } from './dtos/bookmark-query.dto';
import { UserBookmarksResultDto } from './dtos/bookmark-response.dto';

// جایگزین با گارد واقعی پروژه‌ات: AuthGuard('jwt')
class AuthGuardRequired {}

function currentUserId(req: any): string {
  return req?.user?.sub ?? req?.user?.id;
}

@ApiTags('Catalog / Bookmarks')
@ApiBearerAuth()
@UseGuards(AuthGuardRequired as any)
@Controller('catalog/bookmarks')
export class BookmarksController {
  constructor(private readonly service: BookmarksService) {}

  @Post(':productId/toggle')
  @ApiOperation({ summary: 'Toggle bookmark for a product' })
  @ApiOkResponse({
    schema: { properties: { bookmarked: { type: 'boolean' } } },
  })
  async toggle(@Param('productId') productId: string, @Req() req: any) {
    const userId = currentUserId(req);
    return this.service.toggle(userId, productId);
  }

  @Delete(':productId')
  @ApiOperation({ summary: 'Remove bookmark explicitly' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async remove(
    @Param('productId') productId: string,
    @Req() req: any,
  ): Promise<void> {
    const userId = currentUserId(req);
    await this.service.remove(userId, productId);
  }

  @Get(':productId/check')
  @ApiOperation({ summary: 'Check if current user bookmarked the product' })
  @ApiOkResponse({
    schema: { properties: { bookmarked: { type: 'boolean' } } },
  })
  async check(@Param('productId') productId: string, @Req() req: any) {
    const userId = currentUserId(req);
    return this.service.isBookmarked(userId, productId);
  }
}

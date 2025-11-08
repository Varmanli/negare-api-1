import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
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

@ApiTags('Profile / Bookmarks')
@ApiBearerAuth()
@UseGuards(AuthGuardRequired as any)
@Controller('catalog/profile/bookmarks')
export class ProfileBookmarksController {
  constructor(private readonly service: BookmarksService) {}

  @Get()
  @ApiOperation({ summary: 'List current user bookmarks (Load more)' })
  @ApiOkResponse({ type: UserBookmarksResultDto })
  async listMine(
    @Query() q: BookmarkListQueryDto,
    @Req() req: any,
  ): Promise<UserBookmarksResultDto> {
    const userId = currentUserId(req);
    return this.service.listForUser(userId, q);
  }
}

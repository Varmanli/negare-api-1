import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { LikesService } from './likes.service';
import { UserLikesResultDto } from './dtos/likes-response.dto';

// جایگزین با گارد واقعی‌ات مثلاً AuthGuard('jwt')
class AuthGuardRequired {}
function currentUserId(req: any): string {
  return req?.user?.sub ?? req?.user?.id;
}

@ApiTags('Profile / Likes')
@ApiBearerAuth()
@UseGuards(AuthGuardRequired as any)
@Controller('catalog/profile/likes')
export class ProfileLikesController {
  constructor(private readonly service: LikesService) {}

  @Get()
  @ApiOperation({ summary: 'List current user liked products' })
  @ApiOkResponse({ type: UserLikesResultDto })
  async listMine(
    @Req() req: any,
    @Query('limit') limit = '24',
    @Query('cursor') cursor?: string,
  ): Promise<UserLikesResultDto> {
    const userId = currentUserId(req);
    return this.service.listForUser(userId, Number(limit), cursor);
  }
}

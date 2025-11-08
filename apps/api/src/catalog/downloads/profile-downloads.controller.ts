import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { DownloadsService } from './downloads.service';
import { UserDownloadsResultDto } from './dtos/download-response.dto';

// جایگزین با گارد واقعی‌ات: AuthGuard('jwt')
class AuthGuardRequired {}
function currentUserId(req: any): string {
  return req?.user?.sub ?? req?.user?.id;
}

@ApiTags('Profile / Downloads')
@ApiBearerAuth()
@UseGuards(AuthGuardRequired as any)
@Controller('catalog/profile/downloads')
export class ProfileDownloadsController {
  constructor(private readonly service: DownloadsService) {}

  @Get()
  @ApiOperation({ summary: 'List current user downloads (Load more)' })
  @ApiOkResponse({ type: UserDownloadsResultDto })
  async listMine(
    @Req() req: any,
    @Query('limit') limit = '24',
    @Query('cursor') cursor?: string,
  ): Promise<UserDownloadsResultDto> {
    const userId = currentUserId(req);
    return this.service.listForUser(userId, Number(limit), cursor);
  }
}

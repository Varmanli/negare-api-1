import { Controller, Post, Param, Body, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { DownloadsService } from './downloads.service';
import { DownloadStartDto } from './dtos/download-start.dto';
import { DownloadCreatedDto } from './dtos/download-response.dto';

// جایگزین با گارد واقعی‌ات: AuthGuard('jwt')
class AuthGuardRequired {}
function currentUserId(req: any): string {
  return req?.user?.sub ?? req?.user?.id;
}

@ApiTags('Catalog / Downloads')
@ApiBearerAuth()
@UseGuards(AuthGuardRequired as any)
@Controller('catalog/downloads')
export class DownloadsController {
  constructor(private readonly service: DownloadsService) {}

  @Post(':productId/start')
  @ApiOperation({
    summary: 'Register a download and return a URL if available',
  })
  @ApiOkResponse({ type: DownloadCreatedDto })
  async start(
    @Param('productId') productId: string,
    @Body() dto: DownloadStartDto,
    @Req() req: any,
  ): Promise<DownloadCreatedDto> {
    const userId = currentUserId(req);
    return this.service.start(userId, productId, dto);
  }
}

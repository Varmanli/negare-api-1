import { Controller, Post, Param, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { LikesService } from './likes.service';
import { LikeToggleResponseDto } from './dtos/like-toggle.dto';

// جایگزین با گارد واقعی‌ات مثلاً AuthGuard('jwt')
class AuthGuardRequired {}
function currentUserId(req: any): string {
  return req?.user?.sub ?? req?.user?.id;
}

@ApiTags('Catalog / Likes')
@ApiBearerAuth()
@UseGuards(AuthGuardRequired as any)
@Controller('catalog/likes')
export class LikesController {
  constructor(private readonly service: LikesService) {}

  @Post(':productId/toggle')
  @ApiOperation({ summary: 'Toggle like on a product (like/unlike)' })
  @ApiOkResponse({ type: LikeToggleResponseDto })
  async toggle(
    @Param('productId') productId: string,
    @Req() req: any,
  ): Promise<LikeToggleResponseDto> {
    const userId = currentUserId(req);
    return this.service.toggle(userId, productId);
  }
}

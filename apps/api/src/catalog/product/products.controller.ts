import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Ip,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
} from '@nestjs/swagger';

import { ProductService, Actor } from './product.service';
import { CreateProductDto } from './dtos/product-create.dto';
import { UpdateProductDto } from './dtos/product-update.dto';
import { ProductFindQueryDto } from './dtos/product-query.dto';
import {
  ProductBriefDto,
  ProductDetailDto,
  ProductListResultDto,
} from './dtos/product-response.dto';
import { ProductIdBodyDto, ProductIdParamDto } from './dtos/product-id.dto';

// اگر گارد احراز هویت داری، اینجا ایمپورت و استفاده کن.
// این نمونه‌ی خنثی است؛ در پروژه‌ی واقعی‌ات از AuthGuard('jwt') استفاده کن.
class OptionalAuthGuard {}
class AuthGuardRequired {} // جایگزین با AuthGuard('jwt')

function buildActor(req: any): Actor {
  // سازگار با استراتژی‌های JWT سفارشی شما
  const user = req?.user;
  return {
    id: user?.sub ?? user?.id ?? 'anonymous',
    isAdmin: Boolean(user?.roles?.includes?.('admin') || user?.isAdmin),
  };
}

@ApiTags('Catalog / Products')
@Controller('catalog/products')
export class ProductController {
  constructor(private readonly service: ProductService) {}

  // -----------------------------------------------------------
  // Create
  // -----------------------------------------------------------
  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuardRequired as any)
  @ApiOperation({ summary: 'Create a product' })
  @ApiCreatedResponse({ type: ProductDetailDto })
  async create(
    @Body() dto: CreateProductDto,
    @Req() req: any,
  ): Promise<ProductDetailDto> {
    const actor = buildActor(req);
    return this.service.create(dto, actor);
  }

  // -----------------------------------------------------------
  // Update
  // -----------------------------------------------------------
  @Patch(':idOrSlug')
  @ApiBearerAuth()
  @UseGuards(AuthGuardRequired as any)
  @ApiOperation({ summary: 'Update a product (partial)' })
  @ApiOkResponse({ type: ProductDetailDto })
  async update(
    @Param() params: ProductIdParamDto,
    @Body() dto: UpdateProductDto,
    @Req() req: any,
  ): Promise<ProductDetailDto> {
    const actor = buildActor(req);
    return this.service.update(params.idOrSlug, dto, actor);
  }

  // -----------------------------------------------------------
  // Find One
  // -----------------------------------------------------------
  @Get(':idOrSlug')
  @UseGuards(OptionalAuthGuard as any)
  @ApiOperation({ summary: 'Get a product by id or slug' })
  @ApiOkResponse({ type: ProductDetailDto })
  async findOne(
    @Param() params: ProductIdParamDto,
    @Req() req: any,
  ): Promise<ProductDetailDto> {
    const viewerId: string | undefined = req?.user?.sub ?? req?.user?.id;
    return this.service.findOne(params.idOrSlug, viewerId);
  }

  // -----------------------------------------------------------
  // Find All (Load More)
  // -----------------------------------------------------------
  @Get()
  @UseGuards(OptionalAuthGuard as any)
  @ApiOperation({
    summary: 'List products (cursor-based "Load more")',
    description:
      'Supports filters (q, categoryId, tagId, authorId, pricingType, graphicFormat, status) and sort (latest|popular|viewed|liked).',
  })
  @ApiOkResponse({ type: ProductListResultDto })
  async findAll(
    @Query() q: ProductFindQueryDto,
  ): Promise<ProductListResultDto> {
    return this.service.findAll(q);
  }

  // -----------------------------------------------------------
  // Remove (Archive)
  // -----------------------------------------------------------
  @Delete(':idOrSlug')
  @ApiBearerAuth()
  @UseGuards(AuthGuardRequired as any)
  @ApiOperation({ summary: 'Archive a product (soft remove)' })
  @ApiOkResponse({ type: ProductDetailDto })
  async remove(
    @Param() params: ProductIdParamDto,
    @Req() req: any,
  ): Promise<ProductDetailDto> {
    const actor = buildActor(req);
    return this.service.remove(params.idOrSlug, actor);
  }

  // -----------------------------------------------------------
  // Toggle Like
  // -----------------------------------------------------------
  @Post(':id/like')
  @ApiBearerAuth()
  @UseGuards(AuthGuardRequired as any)
  @ApiOperation({ summary: 'Toggle like for current user' })
  @ApiOkResponse({ schema: { properties: { liked: { type: 'boolean' } } } })
  async toggleLike(@Param('id') id: string, @Req() req: any) {
    const userId: string = req?.user?.sub ?? req?.user?.id;
    return this.service.toggleLike(id, userId);
  }

  // -----------------------------------------------------------
  // Toggle Bookmark
  // -----------------------------------------------------------
  @Post(':id/bookmark')
  @ApiBearerAuth()
  @UseGuards(AuthGuardRequired as any)
  @ApiOperation({ summary: 'Toggle bookmark for current user' })
  @ApiOkResponse({
    schema: { properties: { bookmarked: { type: 'boolean' } } },
  })
  async toggleBookmark(@Param('id') id: string, @Req() req: any) {
    const userId: string = req?.user?.sub ?? req?.user?.id;
    return this.service.toggleBookmark(id, userId);
  }

  // -----------------------------------------------------------
  // Register Download
  // -----------------------------------------------------------
  @Post(':id/download')
  @ApiBearerAuth()
  @UseGuards(AuthGuardRequired as any)
  @ApiOperation({ summary: 'Register a download and increment counts' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async registerDownload(
    @Param('id') id: string,
    @Req() req: any,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ): Promise<void> {
    const userId: string = req?.user?.sub ?? req?.user?.id;
    // اگر اندازه‌ی فایل یا مبلغ پرداختی را داری، در بدنه بگیر؛ اینجا ساده نگه داشتیم.
    await this.service.registerDownload(id, userId, undefined, undefined, ip);
  }

  // -----------------------------------------------------------
  // Increment View (public)
  // -----------------------------------------------------------
  @Post(':id/view')
  @UseGuards(OptionalAuthGuard as any)
  @ApiOperation({ summary: 'Increment a view (public endpoint)' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async incrementViewPublic(
    @Param('id') id: string,
    @Req() req: any,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ): Promise<void> {
    const viewerId: string | undefined = req?.user?.sub ?? req?.user?.id;
    await this.service.incrementView(BigInt(id), viewerId, ip, ua);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiConsumes,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { Request } from 'express';
import { ProductsService } from './products.service';
import { ListProductsQueryDto } from './dtos/list-products-query.dto';
import { CreateProductDto } from './dtos/create-product.dto';
import { UpdateProductDto } from './dtos/update-product.dto';
import { ProductListResponseDto } from './dtos/product-list-response.dto';
import { ProductDetailResponseDto } from './dtos/product-detail-response.dto';
import { ProductFileResponseDto } from './dtos/product-file-response.dto';
import { ProductResponseDto } from './dtos/product-response.dto';
import { CurrentUser, CurrentUserPayload } from '@app/common/decorators/current-user.decorator';
import { JwtAuthGuard } from '@app/core/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@app/common/guards/roles.guard';
import { Roles } from '@app/common/decorators/roles.decorator';
import { RoleName } from '@app/prisma/prisma.constants';
import { SupplierOwnershipGuard } from '../guards/supplier-ownership.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UploadedFile as StoredUploadedFile } from '../storage/storage.service';

@ApiTags('Catalog Products')
@ApiExtraModels(ProductResponseDto, ProductDetailResponseDto, ProductFileResponseDto)
@Controller('catalog/products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @ApiOperation({
    summary: 'List catalog products',
    description:
      'Returns a paginated list of catalog products with advanced filtering, sorting, and search options.',
  })
  @ApiOkResponse({
    description: 'Paginated set of products matching the query filters.',
    type: ProductListResponseDto,
  })
  async listProducts(
    @Query() query: ListProductsQueryDto,
  ): Promise<ProductListResponseDto> {
    const result = await this.productsService.listProducts(query);
    return {
      data: result.data,
      total: result.total,
      page: result.page,
      limit: result.limit,
      hasNext: result.hasNext,
    };
  }

  @Get(':idOrSlug')
  @ApiOperation({
    summary: 'Retrieve product details',
    description:
      'Fetch a product by numeric identifier or slug. Records a view for analytics and increments view counters.',
  })
  @ApiOkResponse({
    description: 'Requested product with relations and user engagement flags.',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ProductResponseDto) },
        { $ref: getSchemaPath(ProductDetailResponseDto) },
      ],
    },
  })
  @ApiNotFoundResponse({ description: 'Product not found.' })
  async getProduct(
    @Param('idOrSlug') idOrSlug: string,
    @Req() request: Request,
    @CurrentUser() currentUser?: CurrentUserPayload,
  ): Promise<ProductDetailResponseDto> {
    const product = await this.productsService.findByIdOrSlug(idOrSlug);
    await this.productsService.recordView(product.id, {
      currentUser,
      ip: request.ip,
      userAgent: request.get('user-agent') ?? undefined,
    });
    return this.productsService.decorateProductWithUserState(
      product,
      currentUser,
    );
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleName.ADMIN, RoleName.SUPPLIER)
  @ApiBearerAuth()
  @ApiCookieAuth('refresh_token')
  @ApiOperation({
    summary: 'Create a new product',
    description:
      'Creates a new catalog product. Admins must provide supplier assignments; suppliers are automatically assigned when omitted.',
  })
  @ApiCreatedResponse({
    description: 'Product successfully created.',
    type: ProductDetailResponseDto,
  })
  async createProduct(
    @Body() dto: CreateProductDto,
    @CurrentUser() currentUser: CurrentUserPayload,
  ): Promise<ProductDetailResponseDto> {
    return this.productsService.createProduct(dto, currentUser);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard, SupplierOwnershipGuard)
  @Roles(RoleName.ADMIN, RoleName.SUPPLIER)
  @ApiBearerAuth()
  @ApiCookieAuth('refresh_token')
  @ApiOperation({
    summary: 'Update an existing product',
    description:
      'Updates product metadata, relations, and assets. Suppliers may only update products they own.',
  })
  @ApiOkResponse({
    description: 'Product successfully updated.',
    type: ProductDetailResponseDto,
  })
  async updateProduct(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductDetailResponseDto> {
    return this.productsService.updateProduct(id, dto);
  }

  @Post(':id/file')
  @UseGuards(JwtAuthGuard, RolesGuard, SupplierOwnershipGuard)
  @Roles(RoleName.ADMIN, RoleName.SUPPLIER)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
    }),
  )
  @ApiBearerAuth()
  @ApiCookieAuth('refresh_token')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload or replace the primary product file',
    description:
      'Stores the main downloadable file for the product. Replaces any existing file and updates associated metadata.',
  })
  @ApiOkResponse({
    description: 'Product file uploaded successfully.',
    type: ProductFileResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid or missing file payload.' })
  @ApiUnauthorizedResponse({ description: 'Authentication required.' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions to manage this product.' })
  @ApiNotFoundResponse({ description: 'Product not found.' })
  @ApiInternalServerErrorResponse({ description: 'Unexpected server error while storing the file.' })
  async uploadProductFile(
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipe({
        fileIsRequired: true,
        validators: [
          new MaxFileSizeValidator({
            maxSize: 200 * 1024 * 1024,
            message: 'File size must not exceed 200MB',
          }),
        ],
      }),
    )
    file: StoredUploadedFile,
  ): Promise<ProductFileResponseDto> {
    const stored = await this.productsService.attachOrReplaceFile(id, file);

    return {
      id: stored.id,
      originalName: stored.originalName ?? null,
      size: stored.size ? Number(stored.size) : undefined,
      mimeType: stored.mimeType ?? null,
      createdAt: stored.createdAt,
    };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard, SupplierOwnershipGuard)
  @Roles(RoleName.ADMIN, RoleName.SUPPLIER)
  @ApiBearerAuth()
  @ApiCookieAuth('refresh_token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a product',
    description:
      'Deletes a product. Suppliers may only delete products they own.',
  })
  @ApiNoContentResponse({
    description: 'Product successfully deleted.',
  })
  async deleteProduct(@Param('id') id: string): Promise<void> {
    await this.productsService.removeProduct(id);
  }
}









import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
} from '@nestjs/swagger';

import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dtos/category-create.dto';
import { UpdateCategoryDto } from './dtos/category-update.dto';
import { CategoryFindQueryDto } from './dtos/category-query.dto';
import {
  CategoryDto,
  CategoryListResultDto,
  CategoryTreeNodeDto,
  CategoryBreadcrumbDto,
} from './dtos/category-response.dto';

@ApiTags('Catalog / Categories')
@Controller('catalog/categories')
export class CategoriesController {
  constructor(private readonly service: CategoriesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a category' })
  @ApiCreatedResponse({ type: CategoryDto })
  async create(@Body() dto: CreateCategoryDto): Promise<CategoryDto> {
    return this.service.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a category' })
  @ApiOkResponse({ type: CategoryDto })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryDto> {
    return this.service.update(id, dto);
  }

  @Get(':idOrSlug')
  @ApiOperation({ summary: 'Find category by id or slug' })
  @ApiOkResponse({ type: CategoryDto })
  async findOne(@Param('idOrSlug') idOrSlug: string): Promise<CategoryDto> {
    return this.service.findOne(idOrSlug);
  }

  @Get()
  @ApiOperation({ summary: 'List categories (flat)' })
  @ApiOkResponse({ type: CategoryListResultDto })
  async findAll(
    @Query() q: CategoryFindQueryDto,
  ): Promise<CategoryListResultDto> {
    return this.service.findAll(q);
  }

  @Get('tree/root')
  @ApiOperation({ summary: 'Get full category tree (all roots)' })
  @ApiOkResponse({ type: [CategoryTreeNodeDto] })
  async treeAll(): Promise<CategoryTreeNodeDto[]> {
    return this.service.tree();
  }

  @Get('tree/:rootId')
  @ApiOperation({ summary: 'Get a subtree rooted at :rootId' })
  @ApiOkResponse({ type: [CategoryTreeNodeDto] })
  async tree(@Param('rootId') rootId: string): Promise<CategoryTreeNodeDto[]> {
    return this.service.tree(rootId);
  }

  @Get(':id/breadcrumbs/path')
  @ApiOperation({ summary: 'Get breadcrumbs path for a category (root..self)' })
  @ApiOkResponse({ type: CategoryBreadcrumbDto })
  async breadcrumbs(@Param('id') id: string): Promise<CategoryBreadcrumbDto> {
    return this.service.breadcrumbs(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a category (relink children to parent)' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async remove(@Param('id') id: string): Promise<void> {
    await this.service.remove(id);
  }
}

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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { TagsService } from './tags.service';
import { CreateTagDto } from './dtos/create-tag.dto';
import { UpdateTagDto } from './dtos/update-tag.dto';
import { TagResponseDto } from './dtos/tag-response.dto';
import { JwtAuthGuard } from '@app/core/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@app/common/guards/roles.guard';
import { Roles } from '@app/common/decorators/roles.decorator';
import { RoleName } from '@app/prisma/prisma.constants';

@ApiTags('Catalog Tags')
@Controller('catalog/tags')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get()
  @ApiOperation({
    summary: 'List tags',
    description: 'Returns all catalog tags for filtering and metadata.',
  })
  @ApiResponse({
    status: 200,
    description: 'Tags fetched successfully.',
    type: TagResponseDto,
    isArray: true,
  })
  findAll(): Promise<TagResponseDto[]> {
    return this.tagsService.findAll();
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleName.ADMIN)
  @ApiBearerAuth()
  @ApiCookieAuth('refresh_token')
  @ApiOperation({
    summary: 'Create tag',
    description: 'Creates a new tag for product classification.',
  })
  @ApiResponse({
    status: 201,
    description: 'Tag created successfully.',
    type: TagResponseDto,
  })
  create(@Body() dto: CreateTagDto): Promise<TagResponseDto> {
    return this.tagsService.create(dto);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleName.ADMIN)
  @ApiBearerAuth()
  @ApiCookieAuth('refresh_token')
  @ApiOperation({
    summary: 'Update tag',
    description: 'Updates tag metadata.',
  })
  @ApiResponse({
    status: 200,
    description: 'Tag updated successfully.',
    type: TagResponseDto,
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTagDto,
  ): Promise<TagResponseDto> {
    return this.tagsService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleName.ADMIN)
  @ApiBearerAuth()
  @ApiCookieAuth('refresh_token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete tag',
    description: 'Removes a tag by identifier.',
  })
  @ApiResponse({
    status: 204,
    description: 'Tag removed successfully.',
  })
  async remove(@Param('id') id: string): Promise<void> {
    await this.tagsService.remove(id);
  }
}

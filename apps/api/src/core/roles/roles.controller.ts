/**
 * RolesController exposes administration endpoints for managing role definitions.
 */
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '@app/common/decorators/roles.decorator';
import { CreateRoleDto } from './dto/create-role.dto';
import { FindRolesQueryDto } from './dto/find-roles-query.dto';
import { RoleNameParamDto } from './dto/role-name-param.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RolesService } from './roles.service';
import { RoleName } from '@app/prisma/prisma.constants';

@ApiTags('Roles')
@ApiBearerAuth('bearer')
@Controller('core/roles')
/**
 * Provides CRUD-style role management guarded by role-based access control.
 */
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  /**
   * Lists roles, optionally filtered, for administrators.
   * @param query Query params including optional name filter.
   */
  @Get()
  @Roles(RoleName.ADMIN)
  @ApiOperation({
    summary: 'List roles',
    description: 'Lists roles with optional filtering by name.',
  })
  @ApiResponse({
    status: 200,
    description: 'Roles retrieved successfully.',
  })

  findAll(@Query() query: FindRolesQueryDto) {
    return this.rolesService.findAll(query);
  }

  /**
   * Fetches a single role by name.
   * @param params Route params enforcing enum validation.
   */
  @Get(':name')
  @ApiOperation({
    summary: 'Get role by name',
    description: 'Returns role details for the provided enum value.',
  })
  @ApiResponse({
    status: 200,
    description: 'Role retrieved successfully.',
  })

  findByName(@Param() params: RoleNameParamDto) {
    return this.rolesService.findByName(params.name);
  }

  /**
   * Creates a new role record (admin-only).
   * @param dto Role creation payload.
   */
  @Post()
  @Roles(RoleName.ADMIN)
  @ApiOperation({
    summary: 'Create role',
    description: 'Creates a new role using one of the predefined enum values.',
  })
  @ApiResponse({ status: 201, description: 'Role created successfully.' })

  create(@Body() dto: CreateRoleDto) {
    return this.rolesService.create(dto);
  }

  /**
   * Renames an existing role.
   * @param params Route params referencing the current role name.
   * @param dto Payload containing the new name.
   */
  @Patch(':name')
  @Roles(RoleName.ADMIN)
  @ApiOperation({
    summary: 'Update role',
    description:
      'Replaces the existing role name with a new enum value. Returns 404 when the role is not found.',
  })
  @ApiResponse({ status: 200, description: 'Role updated successfully.' })

  update(@Param() params: RoleNameParamDto, @Body() dto: UpdateRoleDto) {
    return this.rolesService.update(params.name, dto);
  }
}

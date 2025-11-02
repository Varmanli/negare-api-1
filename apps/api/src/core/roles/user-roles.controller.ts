/**
 * UserRolesController exposes admin endpoints to browse and mutate user-role assignments.
 */
import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '@app/common/decorators/roles.decorator';
import { RoleName } from '@app/prisma/prisma.constants';
import { AssignRoleDto } from './dto/assign-role.dto';
import { FindUserRolesQueryDto } from './dto/find-user-roles-query.dto';
import { UserRoleIdParamDto } from './dto/user-role-id-param.dto';
import { UserRolesService } from './user-roles.service';

@ApiTags('User Roles')
@ApiBearerAuth('bearer')
@Controller('core/user-roles')
/**
 * Provides CRUD-ish operations for the user-role join table.
 */
export class UserRolesController {
  constructor(private readonly userRolesService: UserRolesService) {}

  /**
   * Lists user-role assignments with optional filters (admin-only).
   * @param query Filter options such as userId or roleId.
   */
  @Get()
  @Roles(RoleName.ADMIN)
  @ApiOperation({ summary: 'List user-role assignments', description: 'Lists user-role assignments with optional filters.' })
  @ApiResponse({ status: 200, description: 'Assignments retrieved successfully.' })

  findAll(@Query() query: FindUserRolesQueryDto) {
    return this.userRolesService.findAll(query);
  }

  /**
   * Assigns a role to a user.
   * @param dto Payload containing user and role identifiers.
   */
  @Post()
  @Roles(RoleName.ADMIN)
  @ApiOperation({ summary: 'Assign role to user', description: 'Attaches the specified role to the user.' })
  @ApiResponse({ status: 201, description: 'Role assigned successfully.' })

  assignRole(@Body() dto: AssignRoleDto) {
    return this.userRolesService.assignRole(dto);
  }

  /**
   * Deletes a user-role assignment by id.
   * @param params Route params representing the assignment id.
   */
  @Delete(':id')
  @Roles(RoleName.ADMIN)
  @ApiOperation({ summary: 'Remove role from user', description: 'Deletes the user-role assignment by id.' })
  @ApiResponse({ status: 200, description: 'User-role assignment removed successfully.' })

  remove(@Param() params: UserRoleIdParamDto) {
    return this.userRolesService.remove(params.id);
  }
}


/**
 * UsersController offers admin and self-service endpoints for managing user entities.
 */
import {
  Body,
  Controller,
  ForbiddenException,
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
import {
  CurrentUser,
  CurrentUserPayload,
} from '@app/common/decorators/current-user.decorator';
import { Roles } from '@app/common/decorators/roles.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { FindUsersQueryDto } from './dto/find-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserIdParamDto } from './dto/user-id-param.dto';
import { UsersService } from './users.service';
import { RoleName } from '@app/prisma/prisma.constants';

@ApiTags('Users')
@ApiBearerAuth('bearer')
@Controller('core/users')
/**
 * Exposes CRUD-ish operations for user management while enforcing role checks.
 */
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Returns a paginated list of users for administrators.
   * @param query Filter and pagination options.
   */
  @Get()
  @Roles(RoleName.ADMIN)
  @ApiOperation({
    summary: 'List users',
    description: 'Returns users filtered by the provided pagination and search parameters. Admin only.',
  })
  @ApiResponse({
    status: 200,
    description: 'Users retrieved successfully.',
  })
  findAll(@Query() query: FindUsersQueryDto) {
    return this.usersService.findAll(query);
  }

  /**
   * Retrieves a single user profile; admins can view any user, others only their own record.
   * @param params Route params containing the user id.
   * @param currentUser Currently authenticated payload.
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Get user by id',
    description: 'Fetches a single user. Admins may view any user; others may only view their own profile.',
  })
  @ApiResponse({
    status: 200,
    description: 'User retrieved successfully.',
  })
  findById(
    @Param() params: UserIdParamDto,
    @CurrentUser() currentUser: CurrentUserPayload | undefined,
  ) {
    this.ensureUserAccess(params.id, currentUser);
    return this.usersService.findById(params.id);
  }

  /**
   * Creates a new user record (admin-only).
   * @param createUserDto Payload validated by DTO.
   */
  @Post()
  @Roles(RoleName.ADMIN)
  @ApiOperation({
    summary: 'Create user',
    description: 'Registers a new user record. Accessible to administrators only.',
  })
  @ApiResponse({ status: 201, description: 'User created successfully.' })
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  /**
   * Updates user record fields (admin-only).
   * @param params Route params containing user id.
   * @param updateUserDto Partial update payload.
   */
  @Patch(':id')
  @Roles(RoleName.ADMIN)
  @ApiOperation({
    summary: 'Update user',
    description: 'Updates an existing user record. Accessible to administrators only.',
  })
  @ApiResponse({ status: 200, description: 'User updated successfully.' })
  update(
    @Param() params: UserIdParamDto,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.usersService.update(params.id, updateUserDto);
  }

  /**
   * Ensures a caller is either the user themselves or holds the ADMIN role.
   * @param userId Resource owner id.
   * @param currentUser Authenticated user payload (may be undefined).
   * @throws ForbiddenException when access should be denied.
   */
  private ensureUserAccess(
    userId: string,
    currentUser: CurrentUserPayload | undefined,
  ) {
    if (!currentUser) {
      throw new ForbiddenException('Authenticated user context is required.');
    }

    const isOwner = currentUser.id === userId;
    const isAdmin = currentUser.roles?.includes(RoleName.ADMIN);

    if (!isOwner && !isAdmin) {
      throw new ForbiddenException('You are not permitted to access this user.');
    }
  }
}

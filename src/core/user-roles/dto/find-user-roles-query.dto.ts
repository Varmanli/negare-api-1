/**
 * DTO describing optional filters when querying user-role assignments.
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { RoleName } from '../../roles/role.entity';

/**
 * Filter object used to narrow user-role listings.
 */
export class FindUserRolesQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Filter results by user identifier.' })
  @IsOptional()
  @IsUUID('4')
  userId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Filter results by role identifier.' })
  @IsOptional()
  @IsUUID('4')
  roleId?: string;

  @ApiPropertyOptional({ enum: RoleName, description: 'Filter by role name enum value.' })
  @IsOptional()
  @IsEnum(RoleName)
  roleName?: RoleName;
}

/**
 * DTO for creating new role definitions.
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { RoleName } from '../role.entity';

/**
 * Captures the enum-backed name when creating a role.
 */
export class CreateRoleDto {
  @ApiProperty({ enum: RoleName, description: 'Role name from the predefined enum.' })
  @IsEnum(RoleName)
  name: RoleName;
}

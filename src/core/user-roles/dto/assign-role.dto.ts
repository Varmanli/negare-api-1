/**
 * DTO describing the payload for assigning a role to a user.
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/**
 * Requires both user and role identifiers.
 */
export class AssignRoleDto {
  @ApiProperty({ format: 'uuid', description: 'Target user identifier.' })
  @IsUUID('4')
  userId: string;

  @ApiProperty({ format: 'uuid', description: 'Role identifier to assign.' })
  @IsUUID('4')
  roleId: string;
}

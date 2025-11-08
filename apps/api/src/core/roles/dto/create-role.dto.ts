/**
 * DTO for creating new role definitions.
 */
import { ApiProperty } from '@nestjs/swagger';
import { RoleName } from '@prisma/client';
import { IsEnum } from 'class-validator';

/**
 * Captures the enum-backed name when creating a role.
 */
export class CreateRoleDto {
  @ApiProperty({
    enum: RoleName,
    description: 'Role name from the predefined enum.',
  })
  @IsEnum(RoleName)
  name: RoleName;
}

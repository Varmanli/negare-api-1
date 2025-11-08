/**
 * DTO validating the role name route parameter.
 */
import { ApiProperty } from '@nestjs/swagger';
import { RoleName } from '@prisma/client';
import { IsEnum } from 'class-validator';

/**
 * Ensures the name parameter matches the RoleName enum.
 */
export class RoleNameParamDto {
  @ApiProperty({ enum: RoleName, description: 'Target role name parameter.' })
  @IsEnum(RoleName)
  name: RoleName;
}

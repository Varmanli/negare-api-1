/**
 * DTO validating the role name route parameter.
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { RoleName } from '@app/prisma/prisma.constants';

/**
 * Ensures the name parameter matches the RoleName enum.
 */
export class RoleNameParamDto {
  @ApiProperty({ enum: RoleName, description: 'Target role name parameter.' })
  @IsEnum(RoleName)
  name: RoleName;
}

/**
 * DTO enforcing UUID validation for user-role resource parameters.
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/**
 * Expects a UUID v4 string representing the user-role relation identifier.
 */
export class UserRoleIdParamDto {
  @ApiProperty({ format: 'uuid', description: 'User-role record identifier.' })
  @IsUUID('4')
  id: string;
}

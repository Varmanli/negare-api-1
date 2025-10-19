/**
 * DTO for updating an existing role; leverages CreateRoleDto for validation.
 */
import { PartialType } from '@nestjs/swagger';
import { CreateRoleDto } from './create-role.dto';

/**
 * Partial version of CreateRoleDto used for role updates.
 */
export class UpdateRoleDto extends PartialType(CreateRoleDto) {}

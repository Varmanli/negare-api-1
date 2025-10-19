/**
 * DTO for partial user updates leveraging CreateUserDto definitions.
 */
import { PartialType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';

/**
 * Mirrors CreateUserDto fields but marks them optional for updates.
 */
export class UpdateUserDto extends PartialType(CreateUserDto) {}

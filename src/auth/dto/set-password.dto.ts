/**
 * DTO describing the payload for setting a password after OTP verification.
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/**
 * Encapsulates the new password selected by the user.
 */
export class SetPasswordDto {
  @ApiProperty({
    example: 'P@ssw0rd!',
    description: 'New password (minimum 6 characters including letters and numbers).',
  })
  @IsString()
  @MinLength(6)
  password: string;
}

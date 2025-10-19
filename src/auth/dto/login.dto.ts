/**
 * DTO describing the credential-based login payload accepted by AuthController.
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/**
 * Captures identifier/password pairs submitted during the login phase.
 */
export class LoginDto {
  @ApiProperty({
    example: 'user@example.com or 09123456789',
    description: 'Registered email address or mobile number used for login.',
  })
  @IsString()
  identifier: string;

  @ApiProperty({
    example: 'P@ssw0rd!',
    description: 'Account password that must match the stored credentials.',
  })
  @IsString()
  password: string;
}

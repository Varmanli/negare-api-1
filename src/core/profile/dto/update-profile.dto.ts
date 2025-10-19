/**
 * DTO representing supported profile mutations initiated by authenticated users.
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Allows mutating safe profile fields while deferring contact changes to OTP flows.
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({
    example: 'Negare User',
    description: 'Display name for the user. Provide null to clear the value.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string | null;

  @ApiPropertyOptional({
    example: 'Capital markets enthusiast',
    description: 'Short bio shown in the profile. Null or empty string removes it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string | null;

  @ApiPropertyOptional({
    example: 'Tehran',
    description: 'City where the user is active.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string | null;

  @ApiPropertyOptional({
    example: 'https://cdn.negare.com/avatar.png',
    description: 'URL of the profile avatar image.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  avatarUrl?: string | null;

  @ApiPropertyOptional({
    example: 'new-email@example.com',
    description:
      'Email changes are disabled in this endpoint. Sending this field triggers a validation error.',
  })
  @IsOptional()
  @IsString()
  email?: string | null;

  @ApiPropertyOptional({
    example: '09123456789',
    description:
      'Phone changes are disabled in this endpoint. Sending this field triggers a validation error.',
  })
  @IsOptional()
  @IsString()
  phone?: string | null;
}

/**
 * DTO describing the refresh token payload required for token rotation and logout.
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Encapsulates the refresh token string passed to refresh and logout endpoints.
 */
export class RefreshTokenDto {
  @ApiPropertyOptional({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'Refresh token string supplied when the HttpOnly cookie is not available.',

  })
  @IsOptional()
  @IsString()
  @MinLength(10)
  refreshToken?: string;
}

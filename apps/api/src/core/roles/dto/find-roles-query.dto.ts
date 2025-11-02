/**
 * DTO describing optional filters when listing roles.
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsOptional, Max, Min } from 'class-validator';
import { RoleName } from '@app/prisma/prisma.constants';

/**
 * Allows filtering by name and limiting results.
 */
export class FindRolesQueryDto {
  @ApiPropertyOptional({ enum: RoleName, description: 'Filter by role name.' })
  @IsOptional()
  @IsEnum(RoleName)
  name?: RoleName;

  @ApiPropertyOptional({ default: 25, description: 'Maximum number of records to return.' })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  limit?: number;
}

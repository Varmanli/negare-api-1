import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ example: 'john_doe' })
  @IsString()
  @Length(3, 32)
  username: string;

  @ApiPropertyOptional({ example: 'john@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string | null;

  @ApiPropertyOptional({ example: '+989121234567' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  phone?: string | null;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string | null;

  @ApiPropertyOptional({ example: 'Product designer' })
  @IsOptional()
  @IsString()
  bio?: string | null;

  @ApiPropertyOptional({ example: 'Tehran' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  city?: string | null;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/avatars/john.png',
  })
  @IsOptional()
  @IsString()
  avatarUrl?: string | null;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Plain text password that will be hashed internally',
    minLength: 8,
  })
  @IsOptional()
  @IsString()
  @Length(8, 128)
  password?: string;
}

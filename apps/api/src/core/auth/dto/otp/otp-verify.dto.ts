import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsString,
  IsOptional,
  ValidateIf,
  IsEmail,
  IsMobilePhone,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { OtpChannel, OtpPurpose } from '@prisma/client';

/**
 * DTO for verifying a previously requested OTP.
 * Used for signup/login/password reset verification.
 */
export class VerifyOtpDto {
  @ApiProperty({
    enum: OtpChannel,
    example: OtpChannel.sms,
    description: 'Delivery channel — must match the one used in request.',
  })
  @IsEnum(OtpChannel)
  channel: OtpChannel;

  @ApiProperty({
    example: '09123456789',
    description:
      'Recipient identifier (email or phone). Validation depends on channel.',
  })
  @IsString()
  @Transform(({ value, obj }) => {
    const v = typeof value === 'string' ? value.trim() : value;
    return obj?.channel === OtpChannel.email && typeof v === 'string'
      ? v.toLowerCase()
      : v;
  })
  @ValidateIf((o) => o.channel === OtpChannel.email)
  @IsEmail({}, { message: 'Invalid email format.' })
  @ValidateIf((o) => o.channel === OtpChannel.sms)
  @IsMobilePhone('fa-IR', {}, { message: 'Invalid phone number format.' })
  identifier: string;

  @ApiProperty({
    example: '123456',
    description: '6-digit OTP code sent to the user.',
  })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Code must be exactly 6 digits.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  code: string;

  @ApiPropertyOptional({
    enum: OtpPurpose,
    example: OtpPurpose.signup,
    description: 'Purpose of OTP (signup, login, reset). Default = signup.',
  })
  @IsOptional()
  @IsEnum(OtpPurpose)
  purpose?: OtpPurpose;
}

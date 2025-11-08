import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsString,
  IsEmail,
  IsMobilePhone,
  IsOptional,
  ValidateIf,
  IsPhoneNumber,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { OtpChannel, OtpPurpose } from '@prisma/client';

/**
 * DTO for resending an OTP code.
 * Behavior: same as request, but checks resend cooldown instead of rate-limit window.
 */
export class ResendOtpDto {
  @ApiProperty({
    enum: OtpChannel,
    example: OtpChannel.sms,
    description:
      'Delivery channel — must match the one used in original request.',
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
    let v = typeof value === 'string' ? value.trim() : value;
    if (obj?.channel === OtpChannel.sms && typeof v === 'string')
      v = v.replace(/\s+/g, '');
    if (obj?.channel === OtpChannel.email && typeof v === 'string')
      v = v.toLowerCase();
    return v;
  })
  @ValidateIf((o) => o.channel === OtpChannel.email)
  @IsEmail({}, { message: 'Invalid email format.' })
  @ValidateIf((o) => o.channel === OtpChannel.sms)
  @IsPhoneNumber('IR', { message: 'Invalid phone number format.' })
  identifier: string;

  @ApiPropertyOptional({
    enum: OtpPurpose,
    example: OtpPurpose.login,
    description: 'Purpose of OTP (signup, login, reset). Default = signup.',
  })
  @IsOptional()
  @IsEnum(OtpPurpose)
  purpose?: OtpPurpose;
}

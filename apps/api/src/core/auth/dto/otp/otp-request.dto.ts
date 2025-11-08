import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  ValidateIf,
  IsEmail,
  IsPhoneNumber,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { OtpChannel, OtpPurpose } from '@prisma/client';

export class RequestOtpDto {
  @ApiProperty({
    enum: OtpChannel,
    example: OtpChannel.sms,
    description: 'sms | email',
  })
  @IsEnum(OtpChannel)
  channel: OtpChannel;

  @ApiProperty({
    example: 'user@example.com',
    description: 'ایمیل یا موبایل (بسته به channel). ایمیل lowercase می‌شود.',
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
  @IsPhoneNumber('IR', { message: 'Invalid phone number.' })
  identifier: string;

  @ApiPropertyOptional({
    enum: OtpPurpose,
    example: OtpPurpose.login,
    description: 'Purpose of OTP (signup, login, reset)',
  })
  @IsOptional()
  @IsEnum(OtpPurpose)
  purpose?: OtpPurpose;
}

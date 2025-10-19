/**
 * DTO for verifying an issued OTP, supporting SMS and email identifiers.
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsMobilePhone,
  Length,
  ValidateIf,
} from 'class-validator';
import { OtpChannel } from '../entities/otp-code.entity';

/**
 * Validates the payload submitted to the OTP verification endpoint.
 */
export class VerifyOtpDto {
  @ApiProperty({
    enum: OtpChannel,
    example: OtpChannel.sms,
    description: 'Channel that delivered the OTP; must match the request step.',
  })
  @IsEnum(OtpChannel)
  channel: OtpChannel;

  @ApiProperty({
    example: '09123456789',
    required: false,
    description: 'Phone number used when requesting the OTP (sms channel).',
  })
  @ValidateIf((o) => o.channel === OtpChannel.sms)
  @IsMobilePhone('fa-IR')
  phone?: string;

  @ApiProperty({
    example: 'user@example.com',
    required: false,
    description: 'Email used when requesting the OTP (email channel).',
  })
  @ValidateIf((o) => o.channel === OtpChannel.email)
  @IsEmail()
  email?: string;

  @ApiProperty({
    example: '123456',
    description: 'The 4-6 digit verification code sent to the user.',
  })
  @Length(4, 6)
  code: string;
}

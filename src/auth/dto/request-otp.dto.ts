/**
 * DTO representing an OTP issuance request, allowing either SMS or email channels.
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsEmail, IsMobilePhone, ValidateIf } from 'class-validator';
import { OtpChannel } from '../entities/otp-code.entity';

/**
 * Validates inputs for requesting an OTP for login/onboarding.
 */
export class RequestOtpDto {
  @ApiProperty({
    enum: OtpChannel,
    example: OtpChannel.sms,
    description: 'Code delivery channel (sms or email).',
  })
  @IsEnum(OtpChannel)
  channel: OtpChannel;

  @ApiProperty({
    example: '09123456789',
    required: false,
    description: 'Phone number required when the channel is sms.',
  })
  @ValidateIf((o) => o.channel === OtpChannel.sms)
  @IsMobilePhone('fa-IR')
  phone?: string;

  @ApiProperty({
    example: 'user@example.com',
    required: false,
    description: 'Email address required when the channel is email.',
  })
  @ValidateIf((o) => o.channel === OtpChannel.email)
  @IsEmail()
  email?: string;
}

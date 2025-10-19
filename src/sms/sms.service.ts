import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SmsService {
  private readonly template: string;

  constructor(
    @Inject('KAVENEGAR_CLIENT') private readonly kaveClient: any,
    private readonly config: ConfigService,
  ) {
    this.template = this.config.get<string>('KAVENEGAR_TEMPLATE') || 'sendSMS';
  }

  async sendOtp(phone: string, code: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.kaveClient.VerifyLookup(
        { receptor: phone, token: code, template: this.template, type: 'sms' },
        (entries: any, status: number, message?: string) => {
          if (status === 200) resolve();
          else reject(new Error(message || 'Kavenegar error'));
        },
      );
    });
  }
}

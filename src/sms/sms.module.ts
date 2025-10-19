import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SmsService } from './sms.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  providers: [
    SmsService,
    {
      provide: 'KAVENEGAR_CLIENT',
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { KavenegarApi } = require('../vendors/kavenegar');
        return KavenegarApi({ apikey: config.get<string>('KAVENEGAR_API_KEY') });
      },
    },
  ],
  exports: [SmsService],
})
export class SmsModule {}

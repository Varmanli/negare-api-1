import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  providers: [
    {
      provide: 'MAIL_TRANSPORTER',
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const nodemailer = require('nodemailer');
        return nodemailer.createTransport({
          host: cfg.get<string>('SMTP_HOST'),
          port: Number(cfg.get('SMTP_PORT') || 587),
          secure: false,
          auth: {
            user: cfg.get<string>('SMTP_USER'),
            pass: cfg.get<string>('SMTP_PASS'),
          },
        });
      },
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}

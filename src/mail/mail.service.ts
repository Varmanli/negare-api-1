import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { welcomeHtml } from './templates/welcome';

const otpSubject = 'کد تایید نگاره | Negare Verification Code';

const otpText = (code: string) =>
  [
    'کد تایید شما:',
    code,
    'این کد تا ۲ دقیقه معتبر است.',
    '',
    'Your verification code:',
    code,
    'This code is valid for 2 minutes.',
  ].join('\n');

const otpHtml = (code: string) => `
  <table style="width:100%;max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Tahoma,sans-serif;background:#f8fafc;color:#0f172a;">
    <tr>
      <td style="padding:24px;">
        <h1 style="margin:0 0 16px;font-size:22px;color:#0f172a;text-align:center;">
          نگاره • Negare
        </h1>
        <div style="background:#ffffff;border-radius:16px;padding:24px;box-shadow:0 12px 30px rgba(15,23,42,0.08);">
          <p style="margin:0 0 12px;font-size:16px;text-align:center;color:#0f172a;">
            کد تایید شما برای ورود:
          </p>
          <p style="margin:0;font-size:32px;font-weight:700;letter-spacing:4px;text-align:center;color:#2563eb;">
            ${code}
          </p>
          <p style="margin:20px 0 0;font-size:13px;text-align:center;color:#475569;">
            این کد تا ۲ دقیقه معتبر است. لطفاً آن را با کسی به اشتراک نگذارید.
          </p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
          <p style="margin:0 0 12px;font-size:15px;text-align:center;color:#0f172a;">
            Your verification code:
          </p>
          <p style="margin:0;font-size:28px;font-weight:600;letter-spacing:4px;text-align:center;color:#334155;">
            ${code}
          </p>
          <p style="margin:16px 0 0;font-size:13px;text-align:center;color:#64748b;">
            This code stays valid for 2 minutes. Do not share it with anyone.
          </p>
        </div>
        <p style="margin:24px 0 0;font-size:12px;text-align:center;color:#94a3b8;">
          اگر شما این درخواست را ارسال نکرده‌اید، لطفاً این ایمیل را نادیده بگیرید.
          <br>
          If you did not request this code, please ignore this email.
        </p>
      </td>
    </tr>
  </table>
`;

@Injectable()
export class MailService {
  constructor(
    @Inject('MAIL_TRANSPORTER') private readonly transporter: any,
    private readonly config: ConfigService,
  ) {}

  async sendOtp(toEmail: string, code: string) {
    await this.transporter.sendMail({
      from: this.config.get<string>('MAIL_FROM'),
      to: toEmail,
      subject: otpSubject,
      text: otpText(code),
      html: otpHtml(code),
    });
  }

  async sendWelcome(toEmail: string, displayName?: string) {
    if (!toEmail) {
      return;
    }
    await this.transporter.sendMail({
      from: this.config.get<string>('MAIL_FROM'),
      to: toEmail,
      subject: 'به نگاره خوش آمدید ✨ | Welcome to Negare',
      text: `سلام ${displayName || 'دوست نگاره'}،\nحساب شما با موفقیت فعال شد. می‌توانید با ایمیل یا موبایل و رمز جدید وارد شوید.\n\nWelcome ${displayName || 'friend'}!\nYour account is now active. You can sign in using your email/phone and new password.`,
      html: welcomeHtml(displayName),
    });
  }
}

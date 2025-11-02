import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { welcomeHtml } from './templates/welcome';

/** Minimal Nodemailer typings */
type MailAddress = string | { name?: string; address: string };

interface MailerInfo {
  messageId?: string;
  [k: string]: unknown;
}
interface MailerTransporter {
  sendMail(options: {
    from: MailAddress;
    to: MailAddress | MailAddress[];
    subject: string;
    text: string;
    html: string;
    headers?: Record<string, string>;
  }): Promise<MailerInfo>;
}

/** Shared email constants */
const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Ubuntu, 'Noto Sans', Arial, sans-serif";
const BRAND_NAME_FA = 'نگاره';
const BRAND_NAME_EN = 'Negare';

const OTP_SUBJECT = `${BRAND_NAME_FA} | ${BRAND_NAME_EN} — کد تایید / Verification Code`;

/** Plain text fallback stays very important for deliverability */
const otpText = (code: string) =>
  [
    `${BRAND_NAME_FA} | ${BRAND_NAME_EN}`,
    '',
    'کد تایید شما:',
    code,
    'این کد تا ۲ دقیقه معتبر است.',
    '',
    'Your verification code:',
    code,
    'This code is valid for 2 minutes.',
    '',
    'If you did not request this code, you can safely ignore this email.',
  ].join('\n');

/** Hidden preheader (appears in inbox preview lines) */
const preheader = (code: string) =>
  `کد تایید شما: ${code} • Your verification code: ${code}`;

/** Polished, mobile-friendly HTML with inline styles (safe for major clients) */
const otpHtml = (code: string) => `
  <!doctype html>
  <html lang="fa" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${BRAND_NAME_FA} • ${BRAND_NAME_EN}</title>
    <style>
      /* Some clients honor embedded <style>; inline covers the rest */
      .container { width:100%; max-width: 520px; margin:0 auto; }
      .card { background:#ffffff; border-radius:16px; padding:24px; box-shadow:0 12px 30px rgba(15,23,42,0.08); }
      @media (prefers-color-scheme: dark) {
        body { background:#0b1220 !important; color:#e2e8f0 !important; }
        .card { background:#0f172a !important; box-shadow:0 12px 30px rgba(0,0,0,0.5) !important; }
        .muted { color:#94a3b8 !important; }
        .brand { color:#e2e8f0 !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#f1f5f9;color:#0f172a;font-family:${FONT_STACK};">
    <!-- Preheader (hidden) -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;">
      ${preheader(code)}
    </div>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;">
      <tr>
        <td>
          <div class="container" style="width:100%;max-width:520px;margin:0 auto;padding:24px;">
            <!-- Brand -->
            <h1 class="brand" style="margin:0 0 16px;font-size:22px;line-height:1.4;text-align:center;color:#0f172a;">
              ${BRAND_NAME_FA} • ${BRAND_NAME_EN}
            </h1>

            <!-- Card -->
            <div class="card" style="background:#ffffff;border-radius:16px;padding:24px;box-shadow:0 12px 30px rgba(15,23,42,0.08);">
              <p style="margin:0 0 12px;font-size:16px;text-align:center;">
                کد تایید شما برای ورود:
              </p>

              <!-- OTP code block -->
              <p style="
                margin:0;
                font-size:34px;
                font-weight:800;
                letter-spacing:6px;
                text-align:center;
                color:#1d4ed8;
                direction:ltr;
              ">
                ${code}
              </p>

              <p class="muted" style="margin:18px 0 0;font-size:13px;text-align:center;color:#475569;">
                این کد تا <strong>۲ دقیقه</strong> معتبر است. لطفاً آن را با کسی به اشتراک نگذارید.
              </p>

              <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">

              <p style="margin:0 0 12px;font-size:15px;text-align:center;">
                Your verification code:
              </p>
              <p style="
                margin:0;
                font-size:28px;
                font-weight:700;
                letter-spacing:4px;
                text-align:center;
                color:#334155;
                direction:ltr;
              ">
                ${code}
              </p>

              <p class="muted" style="margin:14px 0 0;font-size:12px;text-align:center;color:#64748b;">
                This code is valid for <strong>2 minutes</strong>. Do not share it with anyone.
              </p>
            </div>

            <p class="muted" style="margin:16px 0 0;font-size:12px;text-align:center;color:#94a3b8;">
              اگر شما این درخواست را ارسال نکرده‌اید، لطفاً این ایمیل را نادیده بگیرید.
              <br />
              If you did not request this code, please ignore this email.
            </p>
          </div>
        </td>
      </tr>
    </table>
  </body>
  </html>
`;

@Injectable()
export class MailService {
  constructor(
    @Inject('MAIL_TRANSPORTER') private readonly transporter: MailerTransporter,
    private readonly config: ConfigService,
  ) {}

  /**
   * Sends a verification code email.
   * Returns the provider messageId (if available) so callers can persist it; otherwise resolves to void.
   */
  async sendOtp(toEmail: string, code: string): Promise<string | void> {
    const from =
      this.config.get<string>('MAIL_FROM') ??
      `${BRAND_NAME_EN} <no-reply@negare.local>`;
    const info = await this.transporter.sendMail({
      from,
      to: toEmail,
      subject: OTP_SUBJECT,
      text: otpText(code),
      html: otpHtml(code),
      headers: {
        'X-Entity-Ref-ID': 'otp', // helpful for routing
        'X-Transactional': 'true', // avoid being treated as promo
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        // add a real URL or mailto if you support unsubscribe from transactional digests
        // 'List-Unsubscribe': '<mailto:unsubscribe@negare.com>, <https://negare.com/unsubscribe>',
      },
    });

    if (info?.messageId) return String(info.messageId);
  }

  /**
   * Sends the welcome/activation email. Returns messageId | void.
   */
  async sendWelcome(
    toEmail: string,
    displayName?: string,
  ): Promise<string | void> {
    if (!toEmail) return;

    const from =
      this.config.get<string>('MAIL_FROM') ??
      `${BRAND_NAME_EN} <no-reply@negare.local>`;
    const subject = 'به نگاره خوش آمدید ✨ | Welcome to Negare';

    // Plain-text fallback
    const text = [
      `سلام ${displayName || 'دوست نگاره'},`,
      'حساب شما با موفقیت فعال شد. می‌توانید با ایمیل یا موبایل و رمز جدید وارد شوید.',
      '',
      `Welcome ${displayName || 'friend'}!`,
      'Your account is now active. You can sign in using your email/phone and new password.',
    ].join('\n');

    // Reuse your existing template (ensure it is also inline-styled)
    const html = welcomeHtml(displayName);

    const info = await this.transporter.sendMail({
      from,
      to: toEmail,
      subject,
      text,
      html,
      headers: {
        'X-Entity-Ref-ID': 'welcome',
        'X-Transactional': 'true',
      },
    });

    if (info?.messageId) return String(info.messageId);
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Minimal typings for Kavenegar VerifyLookup callback payload */
type KavenegarVerifyLookupEntry = {
  messageid?: number | string;
  status?: number;
  statustext?: string;
  receptor?: string;
  date?: number;
  cost?: number;
};

type KavenegarVerifyLookupResponse = {
  entries?: KavenegarVerifyLookupEntry[];
};

type KavenegarVerifyLookupParams = {
  receptor: string;
  token: string;
  template: string;
  type?: 'sms' | 'call';
};

interface KavenegarClient {
  VerifyLookup(
    params: KavenegarVerifyLookupParams,
    cb: (
      resp: KavenegarVerifyLookupResponse,
      status: number,
      message?: string,
    ) => void,
  ): void;
}

@Injectable()
export class SmsService {
  private readonly template: string;
  private readonly timeoutMs: number;

  constructor(
    @Inject('KAVENEGAR_CLIENT') private readonly kaveClient: KavenegarClient,
    private readonly config: ConfigService,
  ) {
    this.template = this.config.get<string>('KAVENEGAR_TEMPLATE') ?? 'sendSMS';
    this.timeoutMs = Number(this.config.get('KAVENEGAR_TIMEOUT_MS') ?? 10000);
  }

  /**
   * Sends an OTP via Kavenegar VerifyLookup.
   * Returns provider messageId (if present) so callers can persist it; otherwise resolves to void.
   * Throws with a descriptive error when the provider returns non-200 status or the call times out.
   */
  async sendOtp(phone: string, code: string): Promise<string | void> {
    const receptor = this.normalizePhone(phone);

    return new Promise<string | void>((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('Kavenegar timeout'));
        }
      }, this.timeoutMs);

      this.kaveClient.VerifyLookup(
        { receptor, token: code, template: this.template, type: 'sms' },
        (resp, status, message) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);

          if (status !== 200) {
            reject(new Error(message || `Kavenegar error (status ${status})`));
            return;
          }

          const msgId =
            resp?.entries && resp.entries.length > 0
              ? resp.entries[0]?.messageid
              : undefined;

          if (typeof msgId === 'number' || typeof msgId === 'string') {
            resolve(String(msgId));
          } else {
            resolve(); // delivered but no messageId available
          }
        },
      );
    });
  }

  /** Basic normalizer; adapt to E.164 if needed */
  private normalizePhone(input: string): string {
    const v = input.trim();
    // Example normalization: convert +98xxxxxxxxxx to 09xxxxxxxxx if you prefer local format.
    // For now, return as-is; you can enforce your preferred format here.
    return v;
  }
}

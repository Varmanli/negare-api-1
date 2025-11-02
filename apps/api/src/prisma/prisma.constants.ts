import {
  Prisma,
  RoleName as PrismaRoleName,
  WalletCurrency as PrismaWalletCurrency,
  WalletTransactionType as PrismaWalletTransactionType,
  WalletTransactionStatus as PrismaWalletTransactionStatus,
  WalletTransactionRefType as PrismaWalletTransactionRefType,
  OtpChannel as PrismaOtpChannel,
  OtpStatus as PrismaOtpStatus,
  OtpPurpose as PrismaOtpPurpose,
  PricingType as PrismaPricingType,
  $Enums,
} from '@prisma/client';
import {
  PrismaClientKnownRequestError as PrismaClientKnownRequestErrorBase,
  PrismaClientValidationError as PrismaClientValidationErrorBase,
  PrismaClientRustPanicError as PrismaClientRustPanicErrorBase,
} from '@prisma/client/runtime/library';

export { Prisma };
export const JsonNull = Prisma.JsonNull;
export const DbNull = Prisma.DbNull;
export const AnyNull = Prisma.AnyNull;

export const RoleName = {
  USER: PrismaRoleName.user,
  SUPPLIER: PrismaRoleName.supplier,
  ADMIN: PrismaRoleName.admin,
} as const satisfies Record<'USER' | 'SUPPLIER' | 'ADMIN', $Enums.RoleName>;
export type RoleName = (typeof RoleName)[keyof typeof RoleName];

export const WalletCurrency = {
  IRR: PrismaWalletCurrency.IRR,
} as const satisfies Record<'IRR', $Enums.WalletCurrency>;
export type WalletCurrency =
  (typeof WalletCurrency)[keyof typeof WalletCurrency];

export const WalletTransactionType = {
  CREDIT: PrismaWalletTransactionType.credit,
  DEBIT: PrismaWalletTransactionType.debit,
} as const satisfies Record<'CREDIT' | 'DEBIT', $Enums.WalletTransactionType>;
export type WalletTransactionType =
  (typeof WalletTransactionType)[keyof typeof WalletTransactionType];

export const WalletTransactionStatus = {
  PENDING: PrismaWalletTransactionStatus.pending,
  COMPLETED: PrismaWalletTransactionStatus.completed,
  FAILED: PrismaWalletTransactionStatus.failed,
} as const satisfies Record<
  'PENDING' | 'COMPLETED' | 'FAILED',
  $Enums.WalletTransactionStatus
>;
export type WalletTransactionStatus =
  (typeof WalletTransactionStatus)[keyof typeof WalletTransactionStatus];

export const WalletTransactionRefType = {
  ORDER: PrismaWalletTransactionRefType.order,
  PAYOUT: PrismaWalletTransactionRefType.payout,
  ADJUSTMENT: PrismaWalletTransactionRefType.adjustment,
} as const satisfies Record<
  'ORDER' | 'PAYOUT' | 'ADJUSTMENT',
  $Enums.WalletTransactionRefType
>;
export type WalletTransactionRefType =
  (typeof WalletTransactionRefType)[keyof typeof WalletTransactionRefType];

// --- OTP enums (lowercase keys to match DTOs/Redis) ---
export const OtpChannel = {
  sms: PrismaOtpChannel.sms,
  email: PrismaOtpChannel.email,
} as const satisfies Record<'sms' | 'email', $Enums.OtpChannel>;
export type OtpChannel = (typeof OtpChannel)[keyof typeof OtpChannel];

export const OtpStatus = {
  active: PrismaOtpStatus.active,
  used: PrismaOtpStatus.used,
  expired: PrismaOtpStatus.expired,
  blocked: PrismaOtpStatus.blocked,
} as const satisfies Record<
  'active' | 'used' | 'expired' | 'blocked',
  $Enums.OtpStatus
>;
export type OtpStatus = (typeof OtpStatus)[keyof typeof OtpStatus];

export const OtpPurpose = {
  signup: PrismaOtpPurpose.signup,
  login: PrismaOtpPurpose.login,
  reset: PrismaOtpPurpose.reset,
} as const satisfies Record<'signup' | 'login' | 'reset', $Enums.OtpPurpose>;
export type OtpPurpose = (typeof OtpPurpose)[keyof typeof OtpPurpose];

export const PricingType = {
  FREE: PrismaPricingType.FREE,
  SUBSCRIPTION: PrismaPricingType.SUBSCRIPTION,
  PAID: PrismaPricingType.PAID,
  PAID_OR_SUBSCRIPTION: PrismaPricingType.PAID_OR_SUBSCRIPTION,
} as const satisfies Record<
  'FREE' | 'SUBSCRIPTION' | 'PAID' | 'PAID_OR_SUBSCRIPTION',
  $Enums.PricingType
>;
export type PricingType = (typeof PricingType)[keyof typeof PricingType];

export const PrismaClientKnownRequestError = PrismaClientKnownRequestErrorBase;
export type PrismaClientKnownRequestError =
  Prisma.PrismaClientKnownRequestError;

export const PrismaClientValidationError = PrismaClientValidationErrorBase;
export type PrismaClientValidationError = Prisma.PrismaClientValidationError;

export const PrismaClientRustPanicError = PrismaClientRustPanicErrorBase;
export type PrismaClientRustPanicError = Prisma.PrismaClientRustPanicError;

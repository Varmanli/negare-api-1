import { registerAs } from '@nestjs/config';
import { z } from 'zod';
import type { CookieOptions } from 'express';

const booleanLike = z
  .union([z.boolean(), z.string(), z.number()])
  .optional()
  .transform((value) => {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'auto') {
        return undefined;
      }
      if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true;
      }
      if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false;
      }
    }
    return undefined;
  });

const ensureLeadingSlash = (value: string): string => {
  if (!value.startsWith('/')) {
    return `/${value}`;
  }
  return value;
};

const sanitizePrefix = (value?: string): string => {
  if (!value) return '';
  const trimmed = value.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) return '';
  return `/${trimmed}`;
};

const applyPrefixIfNeeded = (path: string, prefix: string): string => {
  const normalized = ensureLeadingSlash(path);
  if (!prefix || normalized === '/') {
    return normalized;
  }
  if (
    normalized === prefix ||
    normalized.startsWith(`${prefix}/`) ||
    normalized.startsWith(`${prefix}?`)
  ) {
    return normalized;
  }
  const combined = `${prefix}/${normalized.replace(/^\//, '')}`;
  return combined.replace(/\/{2,}/g, '/');
};

const resolveCookiePath = (): string => '/';

export const authEnvSchema = z.object({
  ACCESS_JWT_SECRET: z
    .string()
    .min(1, { message: 'ACCESS_JWT_SECRET must be provided' }),
  ACCESS_JWT_EXPIRES: z.string().default('10m'),
  REFRESH_JWT_SECRET: z
    .string()
    .min(1, { message: 'REFRESH_JWT_SECRET must be provided' }),
  REFRESH_JWT_EXPIRES: z.string().default('30d'),
  COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('lax'),
  COOKIE_SECURE: booleanLike,
  COOKIE_REFRESH_PATH: z.string().default('/auth/refresh'),
  COOKIE_ACCESS_PATH: z.string().default('/'),
});

export type AuthEnv = z.infer<typeof authEnvSchema>;

export interface AuthConfig {
  accessSecret: string;
  accessExpires: string;
  refreshSecret: string;
  refreshExpires: string;
  cookie: {
    sameSite: 'strict' | 'lax' | 'none';
    secure: boolean;
    refreshPath: string;
    accessPath: string;
  };
}

export const authConfig = registerAs('auth', (): AuthConfig => {
  const raw = authEnvSchema.parse(process.env);
  const nodeEnv = (process.env.NODE_ENV ?? 'development').toLowerCase();
  const globalPrefix = sanitizePrefix(process.env.GLOBAL_PREFIX);
  const refreshCookiePath = resolveCookiePath();

  let secure = raw.COOKIE_SECURE ?? nodeEnv === 'production';
  if (raw.COOKIE_SAMESITE === 'none' && secure === false) {
    secure = true;
  }

  return {
    accessSecret: raw.ACCESS_JWT_SECRET,
    accessExpires: raw.ACCESS_JWT_EXPIRES,
    refreshSecret: raw.REFRESH_JWT_SECRET,
    refreshExpires: raw.REFRESH_JWT_EXPIRES,
    cookie: {
      sameSite: raw.COOKIE_SAMESITE,
      secure,
      refreshPath: refreshCookiePath,
      accessPath: applyPrefixIfNeeded(raw.COOKIE_ACCESS_PATH, globalPrefix),
    },
  };
});

export const buildCookieOptions = (
  cookie: AuthConfig['cookie'],
  type: 'refresh' | 'access',
  overrides: Partial<CookieOptions> = {},
): CookieOptions => {
  const path =
    type === 'refresh' ? cookie.refreshPath : cookie.accessPath || '/';

  return {
    httpOnly: true,
    sameSite: cookie.sameSite,
    secure: cookie.secure,
    path,
    ...overrides,
  };
};

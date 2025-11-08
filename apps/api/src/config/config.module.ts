import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { z } from 'zod';
import { authConfig, AuthConfig } from './auth.config';

/**
 * Base ENV schema
 * - PostgreSQL-only version (DATABASE_URL required)
 */
const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(4000),

    // Database (PostgreSQL only)
    DATABASE_URL: z.string().url({
      message:
        'DATABASE_URL must be a valid URL (e.g. postgres://user:pass@host:port/db)',
    }),

    // Auth / tickets
    SET_PWD_JWT_SECRET: z
      .string()
      .min(1, { message: 'SET_PWD_JWT_SECRET must be provided' }),
    SET_PWD_JWT_EXPIRES: z.string().default('10m'),

    // CORS can be CSV list
    CORS_ORIGIN: z.string().default('http://localhost:3000'),

    // Redis can be URL or host/port
    REDIS_URL: z.string().optional(),
    REDIS_HOST: z.string().optional(),
    REDIS_PORT: z.coerce.number().int().positive().optional(),

    // Optional app-wide settings
    GLOBAL_PREFIX: z.string().optional(),
    MOCK_AUTH_ENABLED: z.string().optional(),
    FRONTEND_URL: z.string().default('http://localhost:3000'),
  })
  .passthrough();

type RawEnv = z.infer<typeof envSchema>;

export type AppConfig = RawEnv & {
  PORT: number;
  REDIS_URL: string;
  corsOrigins: string[];
};

export type AllConfig = AppConfig & {
  auth: AuthConfig;
};

/**
 * Normalize/derive a few fields after successful parse:
 * - Ensure REDIS_URL is always present (fallback from host/port)
 * - Expand CORS_ORIGIN (CSV) → string[]
 */
export const validateEnv = (config: Record<string, unknown>): AppConfig => {
  const parsed = envSchema.safeParse(config);

  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map(
        (issue: z.ZodIssue) =>
          `${issue.path.join('.') || 'ENV'}: ${issue.message}`,
      )
      .join('; ');
    throw new Error(`Environment validation error: ${formatted}`);
  }

  const env = parsed.data;

  const redisUrl =
    env.REDIS_URL ??
    `redis://${env.REDIS_HOST ?? 'localhost'}:${env.REDIS_PORT ?? 6379}`;

  const corsOrigins = env.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return {
    ...env,
    REDIS_URL: redisUrl,
    corsOrigins:
      corsOrigins.length > 0 ? corsOrigins : ['http://localhost:3000'],
  };
};

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      envFilePath: ['.env'],
      validate: validateEnv,
      load: [authConfig],
    }),
  ],
})
export class AppConfigModule {}

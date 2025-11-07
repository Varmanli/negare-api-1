import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformResponseInterceptor } from './common/interceptors/transform-response.interceptor';
import { TracingInterceptor } from './common/interceptors/tracing.interceptor';
import { AllConfig } from './config/config.module';
import type { Request, Response, NextFunction } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const bootstrapLogger = new Logger('Bootstrap');
  const config = app.get<ConfigService<AllConfig>>(ConfigService);

  app.useLogger(bootstrapLogger);
  app.flushLogs();

  // ---- Security headers (Helmet) ----
  app.use(helmet());

  // ---- ValidationPipe (strict) ----
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ---- Cookie parser ----
  app.use(cookieParser());

  // ---- Global prefix ----
  const globalPrefix = config.get<string>('GLOBAL_PREFIX') ?? 'api';
  if (globalPrefix) {
    app.setGlobalPrefix(globalPrefix);
  }

  // ---- Trust proxy in production (for correct req.secure / HTTPS) ----
  if ((process.env.NODE_ENV || '').toLowerCase() === 'production') {
    // @ts-ignore - Express setting is available
    app.set('trust proxy', 1);
  }

  app.enableShutdownHooks();

  // ---- CORS (with credentials) ----
  // Supports either an array config key (corsOrigins) or a CSV env (CORS_ORIGIN)
  const corsFromArray =
    (config.get<string[]>('corsOrigins', { infer: true }) as
      | string[]
      | undefined) ?? undefined;
  const corsFromEnv = (config.get<string>('CORS_ORIGIN') ??
    'http://localhost:3000') as string;

  const allowedOrigins = (corsFromArray ?? corsFromEnv.split(',')).map((s) =>
    s.trim(),
  );

  app.enableCors({
    origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    optionsSuccessStatus: 204,
  });

  app.use((_req: Request, res: Response, next: NextFunction) => {
    const existingVary = res.getHeader('Vary');
    const varyVal = Array.isArray(existingVary)
      ? [...existingVary, 'Origin'].join(', ')
      : existingVary
        ? `${existingVary}, Origin`
        : 'Origin';
    res.setHeader('Vary', varyVal);
    next();
  });

  // ---- Global filters & interceptors ----
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(
    new TracingInterceptor(),
    new TransformResponseInterceptor(),
  );

  // ---- Cache-Control برای مسیرهای هویتی + Vary هدرهای مرتبط ----
  app.use((req: Request, res: Response, next: NextFunction) => {
    const prefix = globalPrefix ? `/${globalPrefix}` : '';
    const path = req.path || req.url;

    // کل auth + مسیرهای حساس قبلی در core
    const isAuth = path.startsWith(`${prefix}/auth`);
    const isSensitiveCore =
      path.startsWith(`${prefix}/core/profile`) ||
      path.startsWith(`${prefix}/auth/session`);

    if (isAuth || isSensitiveCore) {
      res.setHeader('Cache-Control', 'no-store');
      // برای هویت، هر دو منبع تغییر محتوا هستند:
      // - Authorization (Access در Header)
      // - Cookie (Refresh در کوکی)
      const existingVary = res.getHeader('Vary');
      const varyList = new Set<string>(
        (existingVary ? String(existingVary) : '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      );
      varyList.add('Authorization');
      varyList.add('Cookie');
      res.setHeader('Vary', Array.from(varyList).join(', '));
    }

    next();
  });

  // ---- Swagger (only non-production) ----
  if ((process.env.NODE_ENV || '').toLowerCase() !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Negare Core API Documentation')
      .setDescription(
        'Comprehensive API reference for auth, users, roles, profile.',
      )
      .setVersion('1.0.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'bearer',
      )
      .addCookieAuth('refresh_token', {
        type: 'apiKey',
        in: 'cookie',
        name: 'refresh_token',
      })
      .build();

    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
    const docsPath = `${globalPrefix ? `/${globalPrefix}` : ''}/docs`;
    SwaggerModule.setup(docsPath, app, swaggerDocument);
  }

// ---- Listen ----
const defaultPort = 3000; // پورت پیش‌فرض برای لیارا و اکثر هاست‌ها
const port = process.env.PORT
  ? Number(process.env.PORT)
  : config.get<number>('PORT', { infer: true }) ?? defaultPort;

await app.listen(port, '0.0.0.0');
console.log(`🚀 Server is running on port ${port}`);


  const appUrl = await app.getUrl();
  bootstrapLogger.log(`Application running at ${appUrl}`);
  const docsPath = `${globalPrefix ? `/${globalPrefix}` : ''}/docs`;
  if ((process.env.NODE_ENV || '').toLowerCase() !== 'production') {
    bootstrapLogger.log(`Swagger Docs available at ${appUrl}${docsPath}`);
  }
  bootstrapLogger.log(`Allowed CORS Origins: ${allowedOrigins.join(', ')}`);
}

bootstrap().catch((error: unknown) => {
  const logger = new Logger('Bootstrap');
  if (error instanceof Error) {
    logger.error('Failed to start application', error.stack);
  } else {
    logger.error(`Failed to start application: ${String(error)}`);
  }
  process.exitCode = 1;
});

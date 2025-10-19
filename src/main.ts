import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformResponseInterceptor } from './common/interceptors/transform-response.interceptor';
import { TracingInterceptor } from './common/interceptors/tracing.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(new Logger());
  app.flushLogs();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      forbidNonWhitelisted: true,
    }),
  );
  app.use(cookieParser());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(
    new TracingInterceptor(),
    new TransformResponseInterceptor(),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Negare Core API Documentation')
    .setDescription(
      'Comprehensive API reference for authentication, user management, roles, and profile modules of the Negare platform.',
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
      'access-token',
    )
    .addCookieAuth('refresh_token', {
      type: 'apiKey',
      in: 'cookie',
      name: 'refresh_token',
    })
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('/api/docs', app, swaggerDocument);

  const port = Number(process.env.PORT || 3000);
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  const appUrl = await app.getUrl();
  logger.log(`Application running at ${appUrl}`);
  logger.log(`Docs available at ${appUrl}/api/docs`);
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

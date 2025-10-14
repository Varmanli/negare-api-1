import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(new Logger());
  app.flushLogs();

  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Negare API')
    .setDescription('API docs')
    .setVersion('0.0.1')
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

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

/**
 * Application bootstrap.
 *
 * Order matters here:
 *   1. cookie-parser & helmet: must be in place before any handler runs.
 *   2. CORS with credentials: cookies require an explicit origin (no '*').
 *   3. ValidationPipe (whitelist + forbidNonWhitelisted): silently dropped
 *      fields are a real security concern; we fail loudly on unknowns.
 *   4. Global exception filter: every error funnels through one place.
 *   5. Global prefix /api/v1: stable contract from day one.
 *   6. Swagger at /api/docs: behind admin auth in production (TODO).
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = new Logger('Bootstrap');

  app.use(cookieParser());
  app.use(helmet());

  app.enableCors({
    origin: process.env.FRONTEND_ORIGIN,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());
  app.setGlobalPrefix('api/v1');

  const config = new DocumentBuilder()
    .setTitle('BNR Bank Licensing & Compliance Portal')
    .setDescription(
      'Internal API for license applications, review, approval, and audit.',
    )
    .setVersion('1.0.0')
    .addCookieAuth('bnr_session')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`API listening on http://localhost:${port}/api/v1`);
  logger.log(`Swagger UI on http://localhost:${port}/api/docs`);
}

void bootstrap();

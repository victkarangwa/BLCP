import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

import configuration from './config/configuration';
import { validationSchema } from './config/validation.schema';
import { PrismaModule } from './common/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { AuditModule } from './modules/audit/audit.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { CsrfMiddleware } from './modules/auth/middleware/csrf.middleware';

/**
 * Root module.
 *
 * Global guards via APP_GUARD:
 *   - ThrottlerGuard: rate limiting for everything; specific endpoints can
 *     declare tighter buckets via @Throttle().
 *   - JwtAuthGuard: default-deny posture — every endpoint requires auth
 *     unless explicitly @Public().
 *
 * The order in the providers array matters: ThrottlerGuard runs first
 * (cheapest rejection), then JwtAuthGuard.
 *
 * CSRF middleware is applied to all routes; it short-circuits internally
 * for safe methods (GET/HEAD/OPTIONS) and the login endpoint.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
      validationOptions: { abortEarly: true },
    }),
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 100 },
    ]),
    PrismaModule,
    AuthModule,
    UsersModule,
    AuditModule,
    ApplicationsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CsrfMiddleware).forRoutes('*');
  }
}

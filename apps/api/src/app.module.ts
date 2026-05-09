import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';

import configuration from './config/configuration';
import { validationSchema } from './config/validation.schema';
import { PrismaModule } from './common/prisma/prisma.module';

/**
 * Root module.
 *
 * Currently wires only foundational infrastructure:
 *   - ConfigModule: env loading + Joi validation, fails fast on bad config.
 *   - ThrottlerModule: per-IP rate limiting (used selectively on /auth/login).
 *   - PrismaModule: global DB client.
 *
 * Feature modules (Auth, Users, Applications, Documents, Audit) get added
 * here as they're built. Each lives in its own folder under src/modules/.
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
      // Default bucket. Auth controller will declare a tighter throttler.
      { name: 'default', ttl: 60_000, limit: 100 },
    ]),
    PrismaModule,
  ],
})
export class AppModule {}

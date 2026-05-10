import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';

/**
 * Auth module.
 *
 * Imports UsersModule (for credential lookup) and AuditModule (login/logout
 * events). Exports the guards so feature modules can mount them; the strategy
 * is registered globally via JwtAuthGuard in main.ts.
 *
 * JWT config:
 *   - HS256 with secret from env (validated >=32 bytes at boot).
 *   - 1-hour token. Matches Session TTL. No refresh tokens by design.
 *   - getOrThrow ensures a missing JWT_SECRET fails at module init,
 *     not at request time.
 */
@Module({
  imports: [
    PassportModule,
    UsersModule,
    AuditModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '1h', algorithm: 'HS256' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtAuthGuard, RolesGuard],
  exports: [JwtAuthGuard, RolesGuard, AuthService],
})
export class AuthModule {}

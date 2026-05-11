import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AuditModule } from '../audit/audit.module';
import { RolesGuard } from '../auth/guards/roles.guard';

/**
 * Users module.
 *
 *   - AuditModule for user-creation / user-update events.
 *   - RolesGuard is registered as a provider here (rather than importing
 *     AuthModule) to avoid the cycle AuthModule → UsersModule → AuthModule.
 *     RolesGuard depends only on Nest's built-in Reflector.
 */
@Module({
  imports: [AuditModule],
  controllers: [UsersController],
  providers: [UsersService, RolesGuard],
  exports: [UsersService],
})
export class UsersModule {}

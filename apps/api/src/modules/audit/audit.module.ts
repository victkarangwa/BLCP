import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { RolesGuard } from '../auth/guards/roles.guard';

/**
 * Audit module.
 *
 *   - Exports AuditService for other modules (Auth, Workflow, Documents)
 *     to write audit entries.
 *   - Exposes /audit read endpoints via AuditController.
 *
 * We do NOT import AuthModule here even though we use @Roles + RolesGuard:
 * AuthModule already imports AuditModule (login/logout audit writes), so
 * importing back would create a cycle. RolesGuard depends only on Nest's
 * Reflector (built-in) and reads metadata set by the @Roles decorator,
 * so providing it directly works without pulling AuthModule.
 *
 * The write side is intentionally inside the service (no update/delete
 * methods exist on the surface); the read side here is paginated and
 * insider-filtered. Together with the DB-level REVOKE on the AuditLog
 * table, this realizes the append-only contract end-to-end.
 */
@Module({
  controllers: [AuditController],
  providers: [AuditService, RolesGuard],
  exports: [AuditService],
})
export class AuditModule {}

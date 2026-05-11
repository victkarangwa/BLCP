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
 */
@Module({
  controllers: [AuditController],
  providers: [AuditService, RolesGuard],
  exports: [AuditService],
})
export class AuditModule {}

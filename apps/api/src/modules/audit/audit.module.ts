import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * Audit module.
 *
 * Exports AuditService only. Read endpoints (/audit/...) will be added later
 * with their own controller. AuthService and (eventually) WorkflowService
 * depend on this module to record events.
 */
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}

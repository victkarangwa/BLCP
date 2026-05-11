import { Module } from '@nestjs/common';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { WorkflowService } from './workflow/workflow.service';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';

/**
 * Applications module.
 *
 * Imports AuditModule (workflow + create actions write audit entries) and
 * AuthModule (for the RolesGuard re-used in the controller).
 *
 */
@Module({
  imports: [AuditModule, AuthModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService, WorkflowService],
  exports: [ApplicationsService, WorkflowService],
})
export class ApplicationsModule {}

import { Module } from '@nestjs/common';

import {
  DocumentsController,
  DocumentDownloadController,
} from './documents.controller';
import { DocumentsService } from './documents.service';
import { LocalStorageService } from './storage/local-storage.service';
import { StorageService } from './storage/storage.interface';
import { AuditModule } from '../audit/audit.module';
import { ApplicationsModule } from '../applications/applications.module';
import { AuthModule } from '../auth/auth.module';

/**
 * Documents module.
 *
 *   - Imports AuditModule (every upload writes an audit row).
 *   - Imports ApplicationsModule (visibility filter + state lookups).
 *   - Imports AuthModule (RolesGuard/AuthenticatedUser).
 *
 *   - Binds the abstract StorageService class to LocalStorageService.
 *     DocumentsService injects StorageService; Nest resolves it through
 *     this `useClass` mapping. Swapping to S3 is a one-line change here.
 */
@Module({
  imports: [AuditModule, ApplicationsModule, AuthModule],
  controllers: [DocumentsController, DocumentDownloadController],
  providers: [
    DocumentsService,
    { provide: StorageService, useClass: LocalStorageService },
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}

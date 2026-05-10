import { Module } from '@nestjs/common';

import {
  DocumentsController,
  DocumentDownloadController,
} from './documents.controller';
import { DocumentsService } from './documents.service';
import { LocalStorageService } from './storage/local-storage.service';
import { STORAGE_SERVICE } from './storage/storage.interface';
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
 *   - Binds STORAGE_SERVICE to LocalStorageService. Swapping to S3 means
 *     replacing this binding with an S3StorageService; the consumers
 *     don't change.
 */
@Module({
  imports: [AuditModule, ApplicationsModule, AuthModule],
  controllers: [DocumentsController, DocumentDownloadController],
  providers: [
    DocumentsService,
    { provide: STORAGE_SERVICE, useClass: LocalStorageService },
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}

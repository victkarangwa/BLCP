import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  StreamableFile,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ApplicationsService } from '../applications/applications.service';
import { DocumentsService } from './documents.service';
import { UploadDocumentMetaDto } from './dto/upload-document.dto';

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Application-scoped document endpoints.
 *
 *   POST /applications/:applicationId/documents   multipart upload
 *   GET  /applications/:applicationId/documents   list (latest per type)
 *
 * Multer's `limits.fileSize` is the first enforcement of the 5MB cap —
 * it aborts the upload at the network layer if exceeded, before the
 * service ever sees the bytes. The service additionally checks file.size
 * so the constraint is testable without going through HTTP.
 */
@ApiTags('documents')
@Controller('applications/:applicationId/documents')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly applications: ApplicationsService,
  ) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload (or version) a document for an application' })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_BYTES },
      // Reject anything other than the allowlist at the parser level so
      // we don't even buffer disallowed types into memory.
      fileFilter: (_req, file, cb) => {
        const allowed = new Set([
          'application/pdf',
          'image/png',
          'image/jpeg',
        ]);
        if (!allowed.has(file.mimetype)) {
          // Pass an error to multer; the global filter will translate.
          return cb(
            new BadRequestException({
              code: 'UNSUPPORTED_FILE_TYPE',
              message: `Unsupported MIME type: ${file.mimetype}`,
            }) as unknown as Error,
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async upload(
    @Param('applicationId') applicationId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() meta: UploadDocumentMetaDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    return this.documents.upload({
      applicationId,
      user,
      documentType: meta.documentType,
      file: {
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        buffer: file.buffer,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get()
  @ApiOperation({ summary: 'List documents (latest version per type) for an application' })
  async list(
    @Param('applicationId') applicationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // Visibility gate: only let through if the user can see the application.
    // This both 404s strangers and ensures applicants/reviewers etc. see
    // the right list. We do the cheap pre-check via the same filter that
    // ApplicationsService.findOne uses.
    await this.applications.findOne(applicationId, user); // throws 404 if invisible
    return this.documents.listLatestForApplication(applicationId);
  }
}

/**
 * Stand-alone download endpoint.
 *
 *   GET /documents/:id/download
 *
 * Separate from the upload/list controller because download URLs are
 * keyed by document id only, not by application id — useful for
 * bookmarks and email links. Visibility is still re-derived from the
 * parent application, so a bookmarked link from a now-revoked user
 * 404s as expected.
 */
@ApiTags('documents')
@Controller('documents')
export class DocumentDownloadController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly applications: ApplicationsService,
  ) {}

  @Get(':id/download')
  @ApiOperation({ summary: 'Download a specific document' })
  async download(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const visibility = this.applications.visibilityFilterFor(user);
    const { doc, stream } = await this.documents.openForDownload(id, visibility);

    res.status(HttpStatus.OK);
    res.set({
      'Content-Type': doc.mimeType,
      // RFC 5987 encoding so non-ASCII filenames survive the round trip.
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(doc.originalName)}`,
      'Content-Length': String(doc.sizeBytes),
    });
    return new StreamableFile(stream);
  }
}

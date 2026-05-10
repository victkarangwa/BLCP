import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { extname } from 'path';
import {
  ApplicationState,
  AuditAction,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { isTerminal } from '../applications/workflow/state-machine';
import { STORAGE_SERVICE, type StorageService } from './storage/storage.interface';

/**
 * DocumentsService — upload, list, stream.
 *
 * Append-only by design: every upload INSERTs a new row with version+1
 * for its (applicationId, documentType) pair. Old versions remain queryable
 * forever; never UPDATE, never DELETE.
 *
 * Atomicity:
 *   1. Hash the bytes (cheap, in-memory).
 *   2. Write to disk (storage.put). Path is content-addressed by SHA-256.
 *   3. Inside a DB transaction:
 *        a. SELECT current max version for (app, documentType) (FOR UPDATE
 *           via Prisma's transaction isolation — see note below).
 *        b. INSERT the Document row with version = max+1.
 *        c. Audit-log the upload (DOCUMENT_UPLOADED for v1, DOCUMENT_VERSIONED
 *           for v>1).
 *   4. If the DB transaction throws (e.g., unique constraint race),
 *      delete the file we wrote so we don't leak orphan bytes on disk.
 *
 * Note on the SELECT pattern:
 *   We use SERIALIZABLE-like behavior via Prisma's interactive transactions
 *   plus the (applicationId, documentType, version) UNIQUE constraint as
 *   the safety net. If two uploads of the same documentType race, exactly
 *   one INSERT succeeds; the other gets P2002 (unique violation) and we
 *   convert it to 409 CONCURRENT_MODIFICATION. The client retries; the
 *   second attempt sees the new max and gets the next version.
 *
 *   We could use raw SELECT … FOR UPDATE but Prisma's $transaction with
 *   the unique constraint as the arbiter is simpler and just as safe.
 */

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB per spec — also enforced by Multer.

/**
 * MIME type allowlist. We accept the document formats a regulator would
 * realistically need: PDF for filings, PNG/JPEG for scans of signed docs.
 * If/when other formats become necessary (e.g., spreadsheets), expand
 * this set deliberately, not by default.
 */
const ALLOWED_MIME_TYPES = new Set<string>([
  'application/pdf',
  'image/png',
  'image/jpeg',
]);

const MIME_TO_EXT: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
};

interface UploadInput {
  applicationId: string;
  user: AuthenticatedUser;
  documentType: string;
  file: {
    originalname: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
  };
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  // ── Upload ────────────────────────────────────────────────────────────

  async upload(input: UploadInput) {
    const { applicationId, user, documentType, file } = input;

    // Defensive size + MIME checks. Multer's limit + the controller's
    // FileInterceptor already enforce these, but service-layer checks
    // make the constraint visible at this boundary too (and let unit
    // tests target the service directly without HTTP).
    if (!file?.buffer || file.size === 0) {
      throw new BadRequestException('file is required');
    }
    if (file.size > MAX_BYTES) {
      throw new BadRequestException({
        code: 'DOCUMENT_TOO_LARGE',
        message: `File exceeds the 5 MB limit (got ${file.size} bytes)`,
      });
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_FILE_TYPE',
        message: `Unsupported MIME type: ${file.mimetype}`,
      });
    }

    // 1. Find the application and verify the user can upload.
    const app = await this.prisma.application.findUnique({
      where: { id: applicationId },
    });
    if (!app) throw new NotFoundException();

    // Only the application's applicant can attach documents. Reviewers
    // and approvers observe; admins manage users, not documents.
    if (app.applicantId !== user.id) {
      throw new ForbiddenException(
        'Only the applicant who owns this application can upload documents',
      );
    }

    // 2. State gate: documents only attach in mutable states.
    //    Submitted/Under-review/Approved/Rejected reject uploads.
    const mutable: ReadonlyArray<ApplicationState> = [
      ApplicationState.DRAFT,
      ApplicationState.INFO_REQUESTED,
      ApplicationState.RESUBMITTED,
    ];
    if (!mutable.includes(app.state) || isTerminal(app.state)) {
      throw new ConflictException({
        code: 'IMMUTABLE_STATE',
        message: `Cannot upload documents while application is in ${app.state}`,
      });
    }

    // 3. Hash + content-addressed path.
    //    Path layout: <applicationId>/<sha256>.<ext>
    //    Per-app subdirectory keeps storage navigable; SHA-256 in the
    //    filename means identical bytes always collide on the same path
    //    (useful for dedupe; here it's just a hygiene win).
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const ext = MIME_TO_EXT[file.mimetype] ?? extname(file.originalname) ?? '';
    const storagePath = `${applicationId}/${sha256}${ext}`;

    // 4. Write the bytes first. If this fails, we never touch the DB
    //    and no audit is recorded — the upload simply didn't happen.
    //
    //    We tolerate "already exists" here: SHA-256 collision = identical
    //    bytes = same file. We don't refuse the upload, but we also don't
    //    re-write the bytes. The DB row still gets a fresh version because
    //    "the applicant uploaded again" is meaningful even if bytes match.
    try {
      await this.storage.put(storagePath, file.buffer);
    } catch (err) {
      const exists = await this.storage.exists(storagePath);
      if (!exists) throw err; // genuine storage failure
      // else: same bytes already on disk; reuse the path silently.
    }

    // 5. DB write inside a transaction. If anything in here throws, we
    //    clean up the file we just wrote so we don't leak bytes on disk.
    let createdDocument;
    try {
      createdDocument = await this.prisma.$transaction(async (tx) => {
        const previousMax = await tx.document.aggregate({
          where: { applicationId, documentType },
          _max: { version: true },
        });
        const nextVersion = (previousMax._max.version ?? 0) + 1;

        const doc = await tx.document.create({
          data: {
            applicationId,
            uploadedById: user.id,
            documentType,
            version: nextVersion,
            originalName: file.originalname,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            sha256,
            storagePath,
          },
        });

        await this.audit.recordWithTx(tx, {
          actorId: user.id,
          actorEmail: user.email,
          actorRole: user.role,
          action:
            nextVersion === 1
              ? AuditAction.DOCUMENT_UPLOADED
              : AuditAction.DOCUMENT_VERSIONED,
          applicationId,
          metadata: {
            documentId: doc.id,
            documentType,
            version: nextVersion,
            sha256,
            sizeBytes: file.size,
            mimeType: file.mimetype,
          },
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        });

        return doc;
      });
    } catch (err) {
      // Best-effort cleanup. We don't wait for it or fail the request on it;
      // a leftover file is a hygiene problem, not a correctness one. The
      // DB has no row pointing to it, so it'll never be served.
      this.removeOrphanFile(storagePath).catch(() => undefined);

      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Unique-constraint race: someone else inserted version N first.
        throw new ConflictException({
          code: 'CONCURRENT_MODIFICATION',
          message: 'Another document version was uploaded concurrently. Try again.',
        });
      }
      throw err;
    }

    return createdDocument;
  }

  // ── List ──────────────────────────────────────────────────────────────

  /**
   * List documents for an application. Returns the LATEST version per
   * documentType (one row per type), plus a count of historical versions
   * so the UI can offer a "version history" view.
   *
   * Visibility: relies on the caller already having confirmed the user
   * can see the application (ApplicationsService.findOne does this).
   * Wiring is in the controller.
   */
  async listLatestForApplication(applicationId: string) {
    // Strategy: pull all rows ordered desc, then take the first per type
    // in code. Document counts per app are bounded (single-digit types,
    // low-digit versions) so a single query is cheaper than a window
    // function or per-type lookup.
    const rows = await this.prisma.document.findMany({
      where: { applicationId },
      orderBy: [{ documentType: 'asc' }, { version: 'desc' }],
      select: {
        id: true,
        documentType: true,
        version: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        uploadedAt: true,
        uploadedBy: { select: { id: true, fullName: true } },
      },
    });

    // Group: pick the highest version per type, count siblings.
    const byType = new Map<
      string,
      { latest: typeof rows[number]; totalVersions: number }
    >();
    for (const r of rows) {
      const existing = byType.get(r.documentType);
      if (existing) {
        existing.totalVersions += 1;
      } else {
        byType.set(r.documentType, { latest: r, totalVersions: 1 });
      }
    }
    return Array.from(byType.values()).map(({ latest, totalVersions }) => ({
      ...latest,
      totalVersions,
    }));
  }

  // ── Download ──────────────────────────────────────────────────────────

  /**
   * Open a download stream for a specific document by id.
   *
   * Visibility check: caller must be able to see the parent application.
   * We re-derive that here rather than trusting the caller to have checked,
   * because download URLs may be shared/bookmarked and the controller
   * shouldn't be the only gate.
   *
   *   - Applicant: only their own apps.
   *   - Reviewer: assigned reviews + their review queue.
   *   - Approver: their approvals + the approval queue.
   *   - Admin: everything.
   *
   * Implementation: ApplicationsService already has the row-level filter.
   * We re-use the lookup pattern by selecting the document with a nested
   * WHERE on the application visibility.
   */
  async openForDownload(
    documentId: string,
    visibility: Prisma.ApplicationWhereInput,
  ): Promise<{
    doc: {
      id: string;
      originalName: string;
      mimeType: string;
      sizeBytes: number;
      storagePath: string;
    };
    stream: import('stream').Readable;
  }> {
    const doc = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        application: visibility,
      },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        storagePath: true,
      },
    });
    if (!doc) throw new NotFoundException();

    const stream = this.storage.openReadStream(doc.storagePath);
    return { doc, stream };
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async removeOrphanFile(relativePath: string): Promise<void> {
    // Best-effort cleanup if the DB write fails after the disk write.
    // We don't re-throw on cleanup failure — the original error is the
    // one that matters to the caller. A leftover file is a hygiene
    // problem, not a correctness one (DB has no row pointing to it,
    // so nothing will ever serve it).
    try {
      await this.storage.remove(relativePath);
    } catch (err) {
      this.logger.warn(
        `Orphan-file cleanup failed for ${relativePath}: ${String(err)}`,
      );
    }
  }
}

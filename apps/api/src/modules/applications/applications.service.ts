import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { Prisma, UserRole, ApplicationState, AuditAction } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { availableActions, isTerminal } from './workflow/state-machine';
import { ActorContext, WorkflowAction } from './workflow/transitions';
import {
  CreateApplicationDto,
  UpdateApplicationDto,
  ListApplicationsQuery,
} from './dto';

/**
 * ApplicationsService — non-workflow operations.
 *
 *   create()                  — applicant creates a DRAFT.
 *   update()                  — applicant edits content of their DRAFT.
 *   findOne()                 — get with visibility filter.
 *   list()                    — paginated list, visibility-filtered.
 *   availableActionsFor()     — UI button-list driver.
 *
 * State transitions live in WorkflowService. This service exists so the
 * workflow concern doesn't get polluted with read/list/edit logic.
 *
 * Row-level visibility is the heart of this file. Different roles see
 * different slices of the table; the WHERE clause is what enforces it.
 */

interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Create ────────────────────────────────────────────────────────────

  async create(
    dto: CreateApplicationDto,
    user: AuthenticatedUser,
    meta: RequestMeta,
  ) {
    // Reference code generation uses the Postgres sequence we created in
    // the lockdown migration. nextval() is atomic — no race conditions,
    // no row locks. Format: BLCP-YYYY-NNNNN, padded to 5 digits.
    const result = await this.prisma.$queryRaw<{ next: bigint }[]>(
      Prisma.sql`SELECT nextval('application_reference_seq') AS next`,
    );
    const next = result[0].next;
    const referenceCode = `BLCP-${new Date().getFullYear()}-${String(next).padStart(5, '0')}`;

    return this.prisma.$transaction(async (tx) => {
      const app = await tx.application.create({
        data: {
          referenceCode,
          institutionName: dto.institutionName,
          licenseType: dto.licenseType,
          applicantId: user.id,
        },
      });

      // Audit the creation. In the same transaction so we never have an
      // application without a creation audit row.
      await this.audit.recordWithTx(tx, {
        actorId: user.id,
        actorEmail: user.email,
        actorRole: user.role,
        action: AuditAction.APPLICATION_CREATED,
        applicationId: app.id,
        newState: app.state,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });

      return app;
    });
  }

  // ── Update (DRAFT only) ───────────────────────────────────────────────

  async update(
    id: string,
    dto: UpdateApplicationDto,
    user: AuthenticatedUser,
  ) {
    const app = await this.prisma.application.findFirst({
      where: { id, ...this.visibilityFilter(user) },
    });
    // 404 not 403: if you can't see it, you shouldn't be told it exists.
    if (!app) throw new NotFoundException();

    if (app.applicantId !== user.id) {
      throw new ForbiddenException('Only the applicant can edit this application');
    }
    if (app.state !== ApplicationState.DRAFT) {
      // Editing post-submission would let applicants change what was
      // submitted/reviewed — that breaks the audit story.
      throw new ConflictException({
        code: 'IMMUTABLE_STATE',
        message: 'Application content can only be edited while in DRAFT',
      });
    }

    return this.prisma.application.update({
      where: { id },
      data: dto,
    });
  }

  // ── Read ──────────────────────────────────────────────────────────────

  async findOne(id: string, user: AuthenticatedUser) {
    const app = await this.prisma.application.findFirst({
      where: { id, ...this.visibilityFilter(user) },
      include: {
        applicant: { select: { id: true, fullName: true, email: true } },
        reviewer:  { select: { id: true, fullName: true, email: true } },
        approver:  { select: { id: true, fullName: true, email: true } },
        documents: { orderBy: [{ documentType: 'asc' }, { version: 'desc' }] },
      },
    });
    if (!app) throw new NotFoundException();
    return app;
  }

  async list(query: ListApplicationsQuery, user: AuthenticatedUser) {
    const limit = Math.min(query.limit ?? 25, 100);

    const where: Prisma.ApplicationWhereInput = {
      ...this.visibilityFilter(user),
      ...(query.state ? { state: query.state } : {}),
    };

    // Cursor pagination: fetch limit+1, the extra row tells us if there's
    // a next page without us having to do a separate count query.
    const items = await this.prisma.application.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(query.cursor
        ? { cursor: { id: query.cursor }, skip: 1 }
        : {}),
      include: {
        applicant: { select: { id: true, fullName: true } },
        reviewer:  { select: { id: true, fullName: true } },
        approver:  { select: { id: true, fullName: true } },
      },
    });

    const hasMore = items.length > limit;
    const trimmed = hasMore ? items.slice(0, limit) : items;
    return {
      items: trimmed,
      nextCursor: hasMore ? trimmed[trimmed.length - 1].id : null,
    };
  }

  // ── Available actions (UI driver) ─────────────────────────────────────

  async availableActionsFor(id: string, user: AuthenticatedUser): Promise<{
    actions: WorkflowAction[];
    version: number;
    isTerminal: boolean;
  }> {
    const app = await this.findOne(id, user);
    const actor: ActorContext = {
      role: user.role,
      isApplicant: app.applicantId === user.id,
      isAssignedReviewer: app.reviewerId === user.id,
    };
    // For APPROVE/REJECT we additionally have to exclude the case where
    // the user is the assigned reviewer (per reviewer-≠-approver rule).
    // The state-machine layer doesn't know IDs, so we filter here.
    const actions = availableActions(app.state, actor).filter((a) => {
      if (
        (a === WorkflowAction.APPROVE || a === WorkflowAction.REJECT) &&
        app.reviewerId === user.id
      ) {
        return false;
      }
      return true;
    });

    return {
      actions,
      version: app.version,
      isTerminal: isTerminal(app.state),
    };
  }

  // ── Visibility filter (row-level security) ────────────────────────────

  /**
   * Public accessor for the visibility filter. Other modules (Documents)
   * need to scope queries by the same row-level rules; rather than
   * re-implement them, they call this and compose into their own WHERE.
   */
  visibilityFilterFor(user: AuthenticatedUser): Prisma.ApplicationWhereInput {
    return this.visibilityFilter(user);
  }

  /**
   * Returns a Prisma WHERE fragment that restricts which application rows
   * this user can see. This is THE row-level security mechanism for reads.
   *
   *   ADMIN     — everything.
   *   APPLICANT — only their own applications.
   *   REVIEWER  — applications they're assigned to,
   *               OR unassigned items in the review queue
   *               (SUBMITTED, RESUBMITTED) so they can pick work up.
   *   APPROVER  — applications they decided on,
   *               OR applications currently UNDER_REVIEW (their queue).
   *
   * Applying this in WHERE rather than post-fetch is critical: pagination
   * cursors work correctly, no chance of "leaking" an item via a bug in
   * filter logic later in the stack.
   */
  private visibilityFilter(user: AuthenticatedUser): Prisma.ApplicationWhereInput {
    switch (user.role) {
      case UserRole.ADMIN:
        return {};
      case UserRole.APPLICANT:
        return { applicantId: user.id };
      case UserRole.REVIEWER:
        return {
          OR: [
            { reviewerId: user.id },
            {
              state: {
                in: [ApplicationState.SUBMITTED, ApplicationState.RESUBMITTED],
              },
            },
          ],
        };
      case UserRole.APPROVER:
        return {
          OR: [
            { approverId: user.id },
            { state: ApplicationState.UNDER_REVIEW },
          ],
        };
    }
  }
}

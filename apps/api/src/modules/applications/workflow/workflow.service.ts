import {
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  ApplicationState,
  AuditAction,
  Prisma,
  Application,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import {
  resolveTransition,
  IllegalTransitionError,
  UnauthorizedTransitionError,
} from './state-machine';
import { WorkflowAction, ActorContext } from './transitions';

/**
 * WorkflowService — where the pure state machine meets the database.
 *
 * Responsibilities:
 *   1. Load the application atomically (inside a transaction).
 *   2. Build the actor context (who is the actor relative to this app?).
 *   3. Ask the state machine: legal? authorized?
 *   4. Enforce reviewer-≠-approver — this layer is the first one with
 *      both IDs available, so the check belongs here.
 *   5. Perform the optimistic-locked UPDATE. If 0 rows affected → 409.
 *   6. Write the audit row in the SAME transaction. Atomic with state change.
 *
 * Everything that mutates application state goes through this method.
 * The controller layer only calls transition(); it doesn't reach into Prisma.
 */

interface TransitionInput {
  applicationId: string;
  action: WorkflowAction;
  /** The version the client believes the row is at (optimistic locking). */
  expectedVersion: number;
  user: AuthenticatedUser;
  /** Optional context for actions that need it (info request note, decision note). */
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class WorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async transition(input: TransitionInput): Promise<Application> {
    const { applicationId, action, expectedVersion, user, reason } = input;

    return this.prisma.$transaction(async (tx) => {
      // 1. Load the current state inside the transaction so we see a
      //    consistent snapshot. No SELECT FOR UPDATE — optimistic locking
      //    handles the race, and row locks would hurt concurrency.
      const app = await tx.application.findUnique({
        where: { id: applicationId },
      });
      if (!app) throw new NotFoundException('Application not found');

      // 2. Build the actor context for the state machine.
      const actor: ActorContext = {
        role: user.role,
        isApplicant: app.applicantId === user.id,
        isAssignedReviewer: app.reviewerId === user.id,
      };

      // 3. Pure-machine decision: legal? authorized?
      let rule;
      try {
        rule = resolveTransition(app.state, action, actor);
      } catch (e) {
        if (e instanceof IllegalTransitionError) {
          throw new ConflictException({
            code: e.code,
            message: e.message,
          });
        }
        if (e instanceof UnauthorizedTransitionError) {
          throw new ForbiddenException({
            code: e.code,
            message: e.message,
          });
        }
        throw e;
      }

      // 4. Reviewer-≠-approver enforcement. The state machine couldn't do
      //    this because it doesn't have IDs. The DB CHECK constraint will
      //    catch a violation too, but failing here gives a clear 403 with a
      //    specific error code instead of a generic constraint violation 500.
      if (
        (action === WorkflowAction.APPROVE || action === WorkflowAction.REJECT) &&
        app.reviewerId === user.id
      ) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'The same user cannot review and approve the same application',
        });
      }

      // 5. Compute the per-action patch (state + any side-column writes).
      const patch = this.computePatch(action, rule.to, user.id, reason);

      // 6. Optimistic-locked update: only succeeds if version matches.
      //    Prisma's updateMany with WHERE version = ? returns count=0 on
      //    mismatch (vs update() which would throw a less-clear error).
      const updated = await tx.application.updateMany({
        where: { id: applicationId, version: expectedVersion },
        data: { ...patch, version: { increment: 1 } },
      });

      if (updated.count === 0) {
        throw new ConflictException({
          code: 'CONCURRENT_MODIFICATION',
          message:
            'This application was modified by someone else. Refresh and try again.',
        });
      }

      // 7. Audit in the SAME transaction. If this fails, the state change
      //    rolls back automatically — atomicity guaranteed.
      await this.audit.recordWithTx(tx, {
        actorId: user.id,
        actorEmail: user.email,
        actorRole: user.role,
        action: this.mapToAuditAction(action),
        applicationId,
        previousState: app.state,
        newState: rule.to,
        metadata: reason ? { reason } : undefined,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });

      // 8. Return the fresh row so the caller can render the new state.
      //    findUniqueOrThrow not findUnique — by now the row definitely exists.
      return tx.application.findUniqueOrThrow({
        where: { id: applicationId },
      });
    });
  }

  /**
   * Per-action row patch. Some transitions touch more than just `state`:
   *   START_REVIEW   — assigns the reviewer (no-op write on RESUBMITTED loops).
   *   REQUEST_INFO   — records the note into infoRequestNote.
   *   APPROVE/REJECT — assigns the approver, records decisionNote, stamps decidedAt.
   */
  private computePatch(
    action: WorkflowAction,
    to: ApplicationState,
    userId: string,
    reason: string | undefined,
  ): Prisma.ApplicationUpdateManyMutationInput & {
    reviewerId?: string;
    approverId?: string;
  } {
    const base = { state: to };

    switch (action) {
      case WorkflowAction.START_REVIEW:
        return { ...base, reviewerId: userId };

      case WorkflowAction.REQUEST_INFO:
        return { ...base, infoRequestNote: reason ?? null };

      case WorkflowAction.APPROVE:
      case WorkflowAction.REJECT:
        return {
          ...base,
          approverId: userId,
          decisionNote: reason ?? null,
          decidedAt: new Date(),
        };

      default:
        return base;
    }
  }

  /**
   * Map workflow action → audit action. They're nearly 1:1 but the audit
   * enum uses past-tense names (APPLICATION_SUBMITTED, REVIEW_STARTED) to
   * read better in the audit log timeline.
   */
  private mapToAuditAction(action: WorkflowAction): AuditAction {
    switch (action) {
      case WorkflowAction.SUBMIT:
        return AuditAction.APPLICATION_SUBMITTED;
      case WorkflowAction.START_REVIEW:
        return AuditAction.REVIEW_STARTED;
      case WorkflowAction.REQUEST_INFO:
        return AuditAction.INFO_REQUESTED;
      case WorkflowAction.RESUBMIT:
        return AuditAction.APPLICATION_RESUBMITTED;
      case WorkflowAction.APPROVE:
        return AuditAction.APPLICATION_APPROVED;
      case WorkflowAction.REJECT:
        return AuditAction.APPLICATION_REJECTED;
    }
  }
}

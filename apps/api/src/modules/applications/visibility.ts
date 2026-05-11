import { Prisma, UserRole, ApplicationState } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

/**
 * Row-level visibility filter for applications.
 *
 *   ADMIN     — everything.
 *   APPLICANT — only their own applications.
 *   REVIEWER  — applications they're assigned to, OR unassigned items
 *               in the review queue (SUBMITTED, RESUBMITTED) so they
 *               can pick work up.
 *   APPROVER  — applications they decided on, OR applications currently
 *               UNDER_REVIEW (their queue).
 *
 * Applying this in WHERE rather than post-fetch is critical: pagination
 * cursors work correctly, and there's no chance of "leaking" an item
 * via a bug in filter logic later in the stack.
 *
 * Exported as a plain function (not a service method) so any module
 * — Applications, Documents, Audit — can compose it into its own
 * queries without dragging in DI dependencies and the cycles that
 * follow. This is row-level security; it doesn't need a class.
 */
export function applicationVisibilityFilter(
  user: AuthenticatedUser,
): Prisma.ApplicationWhereInput {
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

/**
 * Workflow transition table.
 *
 * This file is THE source of truth for legal application state changes.
 * Every transition is one row. Anything not represented here is illegal —
 * the state machine rejects it.
 *
 * Design properties:
 *   - Data, not branches. Adding/changing a transition is a row edit, not
 *     a sprawl across multiple service methods.
 *   - Authorization is per-rule via canAct(actor). This expresses both
 *     "what role" and "what relationship to this application" — the
 *     coarser HTTP-layer @Roles() is not enough on its own.
 *   - The reviewer ≠ approver rule is NOT enforced here; this layer doesn't
 *     have IDs. WorkflowService enforces it where the IDs are available.
 *     Database CHECK constraint enforces it as the final defense.
 */

import { ApplicationState, UserRole } from '@prisma/client';

/**
 * Every action that can move an application between states.
 * Adding a new action requires:
 *   1. A new entry in this enum.
 *   2. A new row (or rows) in TRANSITIONS.
 *   3. A mapping to AuditAction in WorkflowService.mapToAuditAction().
 *   4. A controller endpoint to expose it.
 */
export enum WorkflowAction {
  SUBMIT = 'SUBMIT',
  START_REVIEW = 'START_REVIEW',
  REQUEST_INFO = 'REQUEST_INFO',
  RESUBMIT = 'RESUBMIT',
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}

/**
 * The actor's identity relative to a specific application.
 *
 * `role` is the user's job function (APPLICANT/REVIEWER/APPROVER/ADMIN).
 *
 * `isApplicant` and `isAssignedReviewer` are computed by WorkflowService
 * from the application row and the authenticated user. They let us express
 * "the applicant who owns this one" and "the reviewer assigned to this one"
 * — relationships that pure role checks can't capture.
 *
 * We deliberately omit isAssignedApprover: approvers get assigned AT the
 * moment of approval (when they click Approve), not earlier. The relevant
 * pre-existing relationship is the reviewer's.
 */
export interface ActorContext {
  role: UserRole;
  isApplicant: boolean;
  isAssignedReviewer: boolean;
}

/**
 * One row in the transition table.
 *
 * Read as:
 *   "From `from` state, action `action` is allowed if canAct(actor) is true,
 *    and the result is `to` state. Otherwise reject with `forbiddenReason`."
 */
export interface TransitionRule {
  action: WorkflowAction;
  from: ApplicationState;
  to: ApplicationState;
  canAct: (actor: ActorContext) => boolean;
  forbiddenReason: string;
}

/**
 * THE TRANSITION TABLE.
 *
 * Read top to bottom — it doubles as the workflow specification.
 */
export const TRANSITIONS: readonly TransitionRule[] = [
  // ── DRAFT → SUBMITTED ─────────────────────────────────────────────────
  // Only the application's owner can submit. A different applicant cannot
  // submit on behalf of someone else (privacy + audit clarity).
  {
    action: WorkflowAction.SUBMIT,
    from: ApplicationState.DRAFT,
    to: ApplicationState.SUBMITTED,
    canAct: (a) => a.role === UserRole.APPLICANT && a.isApplicant,
    forbiddenReason:
      'Only the applicant who owns this application can submit it',
  },

  // ── SUBMITTED → UNDER_REVIEW (any reviewer claims it) ────────────────
  // Open queue: any reviewer can pick up an unassigned application.
  // The act of starting review assigns them as the application's reviewer.
  {
    action: WorkflowAction.START_REVIEW,
    from: ApplicationState.SUBMITTED,
    to: ApplicationState.UNDER_REVIEW,
    canAct: (a) => a.role === UserRole.REVIEWER,
    forbiddenReason: 'Only a reviewer can start review',
  },

  // ── RESUBMITTED → UNDER_REVIEW (assigned reviewer continues) ─────────
  // Once a reviewer owns an application, they own its review cycles.
  // A different reviewer cannot poach a resubmission — that breaks
  // continuity of context (they don't know what info was requested).
  {
    action: WorkflowAction.START_REVIEW,
    from: ApplicationState.RESUBMITTED,
    to: ApplicationState.UNDER_REVIEW,
    canAct: (a) => a.role === UserRole.REVIEWER && a.isAssignedReviewer,
    forbiddenReason:
      'Only the originally assigned reviewer can continue this review',
  },

  // ── UNDER_REVIEW → INFO_REQUESTED ────────────────────────────────────
  // Only the assigned reviewer can pause the review and ask for more info.
  // Requires a note (enforced at the DTO layer in the controller).
  {
    action: WorkflowAction.REQUEST_INFO,
    from: ApplicationState.UNDER_REVIEW,
    to: ApplicationState.INFO_REQUESTED,
    canAct: (a) => a.role === UserRole.REVIEWER && a.isAssignedReviewer,
    forbiddenReason: 'Only the assigned reviewer can request more information',
  },

  // ── INFO_REQUESTED → RESUBMITTED ─────────────────────────────────────
  // The applicant updates documents/info and pushes back to the reviewer.
  {
    action: WorkflowAction.RESUBMIT,
    from: ApplicationState.INFO_REQUESTED,
    to: ApplicationState.RESUBMITTED,
    canAct: (a) => a.role === UserRole.APPLICANT && a.isApplicant,
    forbiddenReason:
      'Only the applicant who owns this application can resubmit it',
  },

  // ── UNDER_REVIEW → APPROVED ──────────────────────────────────────────
  // Approver issues final approval. The role check is here; the per-
  // application "approver ≠ reviewer" rule is enforced at the workflow
  // service layer where we have access to the IDs.
  {
    action: WorkflowAction.APPROVE,
    from: ApplicationState.UNDER_REVIEW,
    to: ApplicationState.APPROVED,
    canAct: (a) => a.role === UserRole.APPROVER,
    forbiddenReason: 'Only an approver can issue approval',
  },

  // ── UNDER_REVIEW → REJECTED ──────────────────────────────────────────
  // Same role rule as approve. APPROVED and REJECTED are absorbing states.
  {
    action: WorkflowAction.REJECT,
    from: ApplicationState.UNDER_REVIEW,
    to: ApplicationState.REJECTED,
    canAct: (a) => a.role === UserRole.APPROVER,
    forbiddenReason: 'Only an approver can issue rejection',
  },
];

/**
 * Terminal states have no outgoing transitions. Useful for "is this
 * application still mutable?" checks anywhere in the codebase
 * (e.g., the documents module refuses uploads on terminal states).
 */
export const TERMINAL_STATES: readonly ApplicationState[] = [
  ApplicationState.APPROVED,
  ApplicationState.REJECTED,
];

/**
 * Pure state-machine functions.
 *
 * No imports from Prisma, NestJS, or any framework. No I/O. Trivially
 * unit-testable: hundreds of cases in milliseconds.
 *
 * Two operations:
 *   resolveTransition  — given (state, action, actor), return the rule that
 *                         applies, or throw a typed error.
 *   availableActions   — given (state, actor), return what actions are
 *                         legal right now. Used by the UI to render only
 *                         the buttons that will work.
 */

import { ApplicationState } from '@prisma/client';
import {
  TRANSITIONS,
  WorkflowAction,
  ActorContext,
  TransitionRule,
  TERMINAL_STATES,
} from './transitions';

/**
 * The transition isn't in the table at all (illegal action for this state).
 * Maps to HTTP 409 in the WorkflowService layer.
 */
export class IllegalTransitionError extends Error {
  readonly code = 'ILLEGAL_STATE_TRANSITION';
  constructor(
    public readonly from: ApplicationState,
    public readonly action: WorkflowAction,
  ) {
    super(`Action ${action} is not allowed from state ${from}`);
    this.name = 'IllegalTransitionError';
  }
}

/**
 * The transition is legal in principle, but this actor can't perform it
 * (wrong role, not the applicant, not the assigned reviewer, etc.).
 * Maps to HTTP 403.
 */
export class UnauthorizedTransitionError extends Error {
  readonly code = 'FORBIDDEN';
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'UnauthorizedTransitionError';
  }
}

/**
 * Find the matching transition rule, or throw.
 *
 * Two-phase resolution:
 *   1. Is there ANY rule for (from, action)? If not → IllegalTransitionError.
 *      This is a state problem, not an actor problem.
 *   2. Does this actor satisfy canAct? If not → UnauthorizedTransitionError.
 *      This is an authorization problem.
 *
 * The split matters: a 403 tells the client "you can't do this," a 409
 * tells them "this can't be done from here." Different UX, different
 * code paths in the frontend.
 */
export function resolveTransition(
  from: ApplicationState,
  action: WorkflowAction,
  actor: ActorContext,
): TransitionRule {
  const rule = TRANSITIONS.find((t) => t.from === from && t.action === action);
  if (!rule) throw new IllegalTransitionError(from, action);

  if (!rule.canAct(actor)) {
    throw new UnauthorizedTransitionError(rule.forbiddenReason);
  }

  return rule;
}

/**
 * "What can this user do here?" Used by GET /applications/:id/available-actions
 * to drive the UI button list. The frontend doesn't duplicate workflow
 * knowledge — it just renders what the backend says is possible.
 */
export function availableActions(
  from: ApplicationState,
  actor: ActorContext,
): WorkflowAction[] {
  return TRANSITIONS
    .filter((t) => t.from === from && t.canAct(actor))
    .map((t) => t.action);
}

/**
 * Is this state terminal (no outgoing transitions)?
 * Used by Documents to forbid uploads, by UI to hide action panels, etc.
 */
export function isTerminal(state: ApplicationState): boolean {
  return TERMINAL_STATES.includes(state);
}

/**
 * State machine unit tests.
 *
 * The most important test file in the codebase. These are the regulatory
 * contract: every legal transition, every illegal one, every authorization
 * boundary. If the workflow changes, these tests force a conversation.
 *
 * Pure tests — no DB, no Nest test module, no fixtures. Run in milliseconds.
 */

import { ApplicationState, UserRole } from '@prisma/client';
import {
  resolveTransition,
  availableActions,
  isTerminal,
  IllegalTransitionError,
  UnauthorizedTransitionError,
} from '../../src/modules/applications/workflow/state-machine';
import {
  WorkflowAction,
  ActorContext,
  TERMINAL_STATES,
} from '../../src/modules/applications/workflow/transitions';

// Build small actor shapes for the cases we care about. Naming convention:
//  applicant      — applicant role, IS the owner of the application
//  otherApplicant — applicant role, is NOT the owner
//  reviewer       — reviewer role, NOT the assigned reviewer
//  assignedReviewer — reviewer role, IS the assigned reviewer
//  approver       — approver role
//  admin          — admin (read-only on workflow; should not be able to act)
const applicant: ActorContext = {
  role: UserRole.APPLICANT,
  isApplicant: true,
  isAssignedReviewer: false,
};
const otherApplicant: ActorContext = {
  role: UserRole.APPLICANT,
  isApplicant: false,
  isAssignedReviewer: false,
};
const reviewer: ActorContext = {
  role: UserRole.REVIEWER,
  isApplicant: false,
  isAssignedReviewer: false,
};
const assignedReviewer: ActorContext = {
  role: UserRole.REVIEWER,
  isApplicant: false,
  isAssignedReviewer: true,
};
const approver: ActorContext = {
  role: UserRole.APPROVER,
  isApplicant: false,
  isAssignedReviewer: false,
};
const admin: ActorContext = {
  role: UserRole.ADMIN,
  isApplicant: false,
  isAssignedReviewer: false,
};

describe('state machine — legal transitions', () => {
  it('DRAFT + SUBMIT (applicant) → SUBMITTED', () => {
    const rule = resolveTransition(
      ApplicationState.DRAFT,
      WorkflowAction.SUBMIT,
      applicant,
    );
    expect(rule.to).toBe(ApplicationState.SUBMITTED);
  });

  it('SUBMITTED + START_REVIEW (any reviewer) → UNDER_REVIEW', () => {
    const rule = resolveTransition(
      ApplicationState.SUBMITTED,
      WorkflowAction.START_REVIEW,
      reviewer,
    );
    expect(rule.to).toBe(ApplicationState.UNDER_REVIEW);
  });

  it('UNDER_REVIEW + REQUEST_INFO (assigned reviewer) → INFO_REQUESTED', () => {
    const rule = resolveTransition(
      ApplicationState.UNDER_REVIEW,
      WorkflowAction.REQUEST_INFO,
      assignedReviewer,
    );
    expect(rule.to).toBe(ApplicationState.INFO_REQUESTED);
  });

  it('INFO_REQUESTED + RESUBMIT (applicant) → RESUBMITTED', () => {
    const rule = resolveTransition(
      ApplicationState.INFO_REQUESTED,
      WorkflowAction.RESUBMIT,
      applicant,
    );
    expect(rule.to).toBe(ApplicationState.RESUBMITTED);
  });

  it('RESUBMITTED + START_REVIEW (assigned reviewer) → UNDER_REVIEW', () => {
    const rule = resolveTransition(
      ApplicationState.RESUBMITTED,
      WorkflowAction.START_REVIEW,
      assignedReviewer,
    );
    expect(rule.to).toBe(ApplicationState.UNDER_REVIEW);
  });

  it('UNDER_REVIEW + APPROVE (approver) → APPROVED', () => {
    const rule = resolveTransition(
      ApplicationState.UNDER_REVIEW,
      WorkflowAction.APPROVE,
      approver,
    );
    expect(rule.to).toBe(ApplicationState.APPROVED);
  });

  it('UNDER_REVIEW + REJECT (approver) → REJECTED', () => {
    const rule = resolveTransition(
      ApplicationState.UNDER_REVIEW,
      WorkflowAction.REJECT,
      approver,
    );
    expect(rule.to).toBe(ApplicationState.REJECTED);
  });
});

describe('state machine — illegal transitions (state problem, 409)', () => {
  it('DRAFT + APPROVE → IllegalTransitionError (cannot skip review)', () => {
    expect(() =>
      resolveTransition(
        ApplicationState.DRAFT,
        WorkflowAction.APPROVE,
        approver,
      ),
    ).toThrow(IllegalTransitionError);
  });

  it('SUBMITTED + APPROVE → IllegalTransitionError (cannot skip review)', () => {
    expect(() =>
      resolveTransition(
        ApplicationState.SUBMITTED,
        WorkflowAction.APPROVE,
        approver,
      ),
    ).toThrow(IllegalTransitionError);
  });

  it('SUBMITTED + REJECT → IllegalTransitionError (must be UNDER_REVIEW first)', () => {
    expect(() =>
      resolveTransition(
        ApplicationState.SUBMITTED,
        WorkflowAction.REJECT,
        approver,
      ),
    ).toThrow(IllegalTransitionError);
  });

  it('APPROVED + REJECT → IllegalTransitionError (terminal)', () => {
    expect(() =>
      resolveTransition(
        ApplicationState.APPROVED,
        WorkflowAction.REJECT,
        approver,
      ),
    ).toThrow(IllegalTransitionError);
  });

  it('APPROVED + SUBMIT → IllegalTransitionError (terminal)', () => {
    expect(() =>
      resolveTransition(
        ApplicationState.APPROVED,
        WorkflowAction.SUBMIT,
        applicant,
      ),
    ).toThrow(IllegalTransitionError);
  });

  it('REJECTED + APPROVE → IllegalTransitionError (terminal)', () => {
    expect(() =>
      resolveTransition(
        ApplicationState.REJECTED,
        WorkflowAction.APPROVE,
        approver,
      ),
    ).toThrow(IllegalTransitionError);
  });

  it('UNDER_REVIEW + SUBMIT → IllegalTransitionError (cannot resubmit while under review)', () => {
    expect(() =>
      resolveTransition(
        ApplicationState.UNDER_REVIEW,
        WorkflowAction.SUBMIT,
        applicant,
      ),
    ).toThrow(IllegalTransitionError);
  });

  it('INFO_REQUESTED + APPROVE → IllegalTransitionError (must go through RESUBMITTED → UNDER_REVIEW first)', () => {
    expect(() =>
      resolveTransition(
        ApplicationState.INFO_REQUESTED,
        WorkflowAction.APPROVE,
        approver,
      ),
    ).toThrow(IllegalTransitionError);
  });
});

describe('state machine — unauthorized actors (authorization problem, 403)', () => {
  it('DRAFT + SUBMIT (other applicant, not the owner) → UnauthorizedTransitionError', () => {
    expect(() =>
      resolveTransition(
        ApplicationState.DRAFT,
        WorkflowAction.SUBMIT,
        otherApplicant,
      ),
    ).toThrow(UnauthorizedTransitionError);
  });

  it('UNDER_REVIEW + APPROVE (applicant) → UnauthorizedTransitionError', () => {
    expect(() =>
      resolveTransition(
        ApplicationState.UNDER_REVIEW,
        WorkflowAction.APPROVE,
        applicant,
      ),
    ).toThrow(UnauthorizedTransitionError);
  });

  it('UNDER_REVIEW + APPROVE (reviewer, not approver) → UnauthorizedTransitionError', () => {
    expect(() =>
      resolveTransition(
        ApplicationState.UNDER_REVIEW,
        WorkflowAction.APPROVE,
        reviewer,
      ),
    ).toThrow(UnauthorizedTransitionError);
  });

  it('UNDER_REVIEW + APPROVE (admin) → UnauthorizedTransitionError (admins observe only)', () => {
    expect(() =>
      resolveTransition(
        ApplicationState.UNDER_REVIEW,
        WorkflowAction.APPROVE,
        admin,
      ),
    ).toThrow(UnauthorizedTransitionError);
  });

  it('UNDER_REVIEW + REQUEST_INFO (unassigned reviewer) → UnauthorizedTransitionError', () => {
    expect(() =>
      resolveTransition(
        ApplicationState.UNDER_REVIEW,
        WorkflowAction.REQUEST_INFO,
        reviewer,
      ),
    ).toThrow(UnauthorizedTransitionError);
  });

  it('RESUBMITTED + START_REVIEW (different reviewer, not the assigned one) → UnauthorizedTransitionError', () => {
    expect(() =>
      resolveTransition(
        ApplicationState.RESUBMITTED,
        WorkflowAction.START_REVIEW,
        reviewer,
      ),
    ).toThrow(UnauthorizedTransitionError);
  });

  it('INFO_REQUESTED + RESUBMIT (other applicant) → UnauthorizedTransitionError', () => {
    expect(() =>
      resolveTransition(
        ApplicationState.INFO_REQUESTED,
        WorkflowAction.RESUBMIT,
        otherApplicant,
      ),
    ).toThrow(UnauthorizedTransitionError);
  });
});

describe('state machine — availableActions for UI button rendering', () => {
  it('DRAFT for the owner → [SUBMIT]', () => {
    expect(availableActions(ApplicationState.DRAFT, applicant)).toEqual([
      WorkflowAction.SUBMIT,
    ]);
  });

  it("DRAFT for another applicant → [] (can't see another applicant's options)", () => {
    expect(availableActions(ApplicationState.DRAFT, otherApplicant)).toEqual(
      [],
    );
  });

  it('SUBMITTED for any reviewer → [START_REVIEW]', () => {
    expect(availableActions(ApplicationState.SUBMITTED, reviewer)).toEqual([
      WorkflowAction.START_REVIEW,
    ]);
  });

  it('UNDER_REVIEW for the assigned reviewer → [REQUEST_INFO]', () => {
    // Approve/reject belong to approver; assigned reviewer only requests info.
    expect(
      availableActions(ApplicationState.UNDER_REVIEW, assignedReviewer),
    ).toEqual([WorkflowAction.REQUEST_INFO]);
  });

  it('UNDER_REVIEW for an approver → [APPROVE, REJECT]', () => {
    expect(availableActions(ApplicationState.UNDER_REVIEW, approver)).toEqual(
      expect.arrayContaining([WorkflowAction.APPROVE, WorkflowAction.REJECT]),
    );
    expect(
      availableActions(ApplicationState.UNDER_REVIEW, approver),
    ).toHaveLength(2);
  });

  it('INFO_REQUESTED for the applicant → [RESUBMIT]', () => {
    expect(
      availableActions(ApplicationState.INFO_REQUESTED, applicant),
    ).toEqual([WorkflowAction.RESUBMIT]);
  });

  it('APPROVED for anyone → [] (terminal)', () => {
    for (const a of [applicant, reviewer, assignedReviewer, approver, admin]) {
      expect(availableActions(ApplicationState.APPROVED, a)).toEqual([]);
    }
  });

  it('REJECTED for anyone → [] (terminal)', () => {
    for (const a of [applicant, reviewer, assignedReviewer, approver, admin]) {
      expect(availableActions(ApplicationState.REJECTED, a)).toEqual([]);
    }
  });
});

describe('state machine — invariants', () => {
  it('terminal states have no outgoing transitions in the table', () => {
    // This is a structural invariant: if anyone adds a rule whose `from` is
    // a terminal state, this test fails and forces a conversation.
    for (const terminal of TERMINAL_STATES) {
      for (const a of [
        applicant,
        reviewer,
        assignedReviewer,
        approver,
        admin,
      ]) {
        expect(availableActions(terminal, a)).toEqual([]);
      }
    }
  });

  it('isTerminal returns true for APPROVED and REJECTED only', () => {
    expect(isTerminal(ApplicationState.APPROVED)).toBe(true);
    expect(isTerminal(ApplicationState.REJECTED)).toBe(true);
    expect(isTerminal(ApplicationState.DRAFT)).toBe(false);
    expect(isTerminal(ApplicationState.SUBMITTED)).toBe(false);
    expect(isTerminal(ApplicationState.UNDER_REVIEW)).toBe(false);
    expect(isTerminal(ApplicationState.INFO_REQUESTED)).toBe(false);
    expect(isTerminal(ApplicationState.RESUBMITTED)).toBe(false);
  });
});

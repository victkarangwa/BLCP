/**
 * Typed domain errors.
 *
 * These get thrown by service code and mapped to HTTP responses by the
 * global exception filter. Defining them as classes (not strings) gives
 * us TypeScript exhaustiveness in the filter and clearer stack traces.
 *
 * The filter reads `code` to populate the standard error envelope's
 * `error.code` field — that's the stable identifier the frontend
 * switches on.
 */

export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  details?: Record<string, unknown>;
}

export class IllegalStateTransitionError extends DomainError {
  readonly code = 'ILLEGAL_STATE_TRANSITION';
  readonly httpStatus = 409;
  constructor(
    public readonly from: string,
    public readonly action: string,
  ) {
    super(`Action ${action} is not allowed from state ${from}`);
    this.name = 'IllegalStateTransitionError';
  }
}

export class UnauthorizedTransitionError extends DomainError {
  readonly code = 'FORBIDDEN';
  readonly httpStatus = 403;
  constructor(reason: string) {
    super(reason);
    this.name = 'UnauthorizedTransitionError';
  }
}

export class ConcurrentModificationError extends DomainError {
  readonly code = 'CONCURRENT_MODIFICATION';
  readonly httpStatus = 409;
  constructor() {
    super('This resource was modified by someone else. Refresh and try again.');
    this.name = 'ConcurrentModificationError';
  }
}

export class ReviewerEqualsApproverError extends DomainError {
  readonly code = 'FORBIDDEN';
  readonly httpStatus = 403;
  constructor() {
    super('The same user cannot review and approve the same application');
    this.name = 'ReviewerEqualsApproverError';
  }
}

export class IdempotencyKeyReusedError extends DomainError {
  readonly code = 'IDEMPOTENCY_KEY_REUSED';
  readonly httpStatus = 409;
  constructor() {
    super('Idempotency-Key reused with a different request body');
    this.name = 'IdempotencyKeyReusedError';
  }
}

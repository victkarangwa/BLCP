import type { ApplicationState } from './application';

export type AuditAction =
  | 'APPLICATION_CREATED'
  | 'APPLICATION_SUBMITTED'
  | 'APPLICATION_RESUBMITTED'
  | 'REVIEW_STARTED'
  | 'INFO_REQUESTED'
  | 'REVIEW_COMPLETED'
  | 'APPLICATION_APPROVED'
  | 'APPLICATION_REJECTED'
  | 'DOCUMENT_UPLOADED'
  | 'DOCUMENT_VERSIONED'
  | 'USER_LOGGED_IN'
  | 'USER_LOGGED_OUT'
  | 'USER_LOGIN_FAILED';

export interface AuditEntry {
  id: string;
  actorId: string | null;
  actorEmail: string;
  actorRole: 'APPLICANT' | 'REVIEWER' | 'APPROVER' | 'ADMIN' | null;
  action: AuditAction;
  applicationId: string | null;
  previousState: ApplicationState | null;
  newState: ApplicationState | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  occurredAt: string;
}

export interface AuditPage {
  items: AuditEntry[];
  nextCursor: string | null;
}

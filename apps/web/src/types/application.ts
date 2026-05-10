/**
 * Application domain types — frontend-side mirrors of the API contract.
 *
 * Kept deliberately separate from the backend's Prisma types: the OpenAPI
 * spec is the contract. If the API changes, this file changes too — that's
 * the explicit handshake, not an implicit shared package.
 */

export type ApplicationState =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'INFO_REQUESTED'
  | 'RESUBMITTED'
  | 'APPROVED'
  | 'REJECTED';

export type WorkflowAction =
  | 'SUBMIT'
  | 'START_REVIEW'
  | 'REQUEST_INFO'
  | 'RESUBMIT'
  | 'APPROVE'
  | 'REJECT';

export interface ApplicationListItem {
  id: string;
  referenceCode: string;
  institutionName: string;
  licenseType: string;
  state: ApplicationState;
  version: number;
  applicantId: string;
  reviewerId: string | null;
  approverId: string | null;
  createdAt: string;
  updatedAt: string;
  applicant?: { id: string; fullName: string };
  reviewer?: { id: string; fullName: string } | null;
  approver?: { id: string; fullName: string } | null;
}

export interface ApplicationDetail extends ApplicationListItem {
  infoRequestNote: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  applicant: { id: string; fullName: string; email: string };
  reviewer: { id: string; fullName: string; email: string } | null;
  approver: { id: string; fullName: string; email: string } | null;
}

export interface ApplicationListResponse {
  items: ApplicationListItem[];
  nextCursor: string | null;
}

export interface AvailableActionsResponse {
  actions: WorkflowAction[];
  version: number;
  isTerminal: boolean;
}

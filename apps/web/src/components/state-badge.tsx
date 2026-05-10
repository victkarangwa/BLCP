import type { ApplicationState } from '@/types/application';

/**
 * Color-coded state badge. Colors carry semantic weight:
 *   - Gray: draft (not yet in flight)
 *   - Blue: in flight (submitted, under review, resubmitted)
 *   - Amber: waiting on the other side (info requested)
 *   - Green: approved
 *   - Red: rejected
 */
const STYLES: Record<ApplicationState, string> = {
  DRAFT: 'bg-gray-100 text-gray-700 ring-gray-200',
  SUBMITTED: 'bg-blue-50 text-blue-700 ring-blue-200',
  UNDER_REVIEW: 'bg-blue-50 text-blue-700 ring-blue-200',
  RESUBMITTED: 'bg-blue-50 text-blue-700 ring-blue-200',
  INFO_REQUESTED: 'bg-amber-50 text-amber-700 ring-amber-200',
  APPROVED: 'bg-green-50 text-green-700 ring-green-200',
  REJECTED: 'bg-red-50 text-red-700 ring-red-200',
};

const LABEL: Record<ApplicationState, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under review',
  INFO_REQUESTED: 'Info requested',
  RESUBMITTED: 'Resubmitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

export function StateBadge({ state }: { state: ApplicationState }) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ring-1 ${STYLES[state]}`}
    >
      {LABEL[state]}
    </span>
  );
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { Skeleton } from './skeleton';
import { ErrorState } from './error-state';
import { EmptyState } from './empty-state';
import { StateBadge } from './state-badge';
import type { ApplicationState } from '@/types/application';
import type { AuditAction, AuditEntry, AuditPage } from '@/types/audit';

/**
 * Chronological audit trail for a single application.
 *
 *   - Reads from GET /audit/applications/:id (insider-only on backend).
 *   - Displays oldest-first so the eye reads the story from the top
 *     (API returns desc; we reverse here).
 *   - Renders state transitions with from/to badges; document events
 *     show the documentType + version from metadata.
 *
 * Anyone the backend would let in (applicant, assigned reviewer/approver,
 * admin) gets a 200. Strangers get 404. We don't have to re-check anything
 * client-side; just render what we get.
 */

const ACTION_LABEL: Record<AuditAction, string> = {
  APPLICATION_CREATED: 'Created application',
  APPLICATION_SUBMITTED: 'Submitted',
  APPLICATION_RESUBMITTED: 'Resubmitted',
  REVIEW_STARTED: 'Started review',
  INFO_REQUESTED: 'Requested more information',
  REVIEW_COMPLETED: 'Completed review',
  APPLICATION_APPROVED: 'Approved',
  APPLICATION_REJECTED: 'Rejected',
  DOCUMENT_UPLOADED: 'Uploaded document',
  DOCUMENT_VERSIONED: 'New document version',
  USER_LOGGED_IN: 'Signed in',
  USER_LOGGED_OUT: 'Signed out',
  USER_LOGIN_FAILED: 'Failed sign-in attempt',
};

/** Dot color groups actions visually: lifecycle / decision / docs / auth. */
const DOT_CLASS: Record<AuditAction, string> = {
  APPLICATION_CREATED: 'bg-gray-400',
  APPLICATION_SUBMITTED: 'bg-blue-500',
  APPLICATION_RESUBMITTED: 'bg-blue-500',
  REVIEW_STARTED: 'bg-blue-500',
  INFO_REQUESTED: 'bg-amber-500',
  REVIEW_COMPLETED: 'bg-blue-500',
  APPLICATION_APPROVED: 'bg-green-500',
  APPLICATION_REJECTED: 'bg-red-500',
  DOCUMENT_UPLOADED: 'bg-indigo-500',
  DOCUMENT_VERSIONED: 'bg-indigo-500',
  USER_LOGGED_IN: 'bg-gray-300',
  USER_LOGGED_OUT: 'bg-gray-300',
  USER_LOGIN_FAILED: 'bg-red-300',
};

export function AuditTimeline({ applicationId }: { applicationId: string }) {
  const { data, error, isLoading, refetch } = useQuery<AuditPage>({
    queryKey: queryKeys.applications.audit(applicationId),
    // 50 is plenty for a single application's history. If this ever
    // overflows we'll add load-more; for the take-home, one page suffices.
    queryFn: () =>
      api<AuditPage>(`/audit/applications/${applicationId}?limit=50`),
  });

  if (isLoading) return <Skeleton rows={4} />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data || data.items.length === 0) {
    return <EmptyState title="No history yet" />;
  }

  // API returns desc (newest first). Reverse so the timeline reads top-down
  // chronologically — easier to follow the application's life.
  const chronological = [...data.items].reverse();

  return (
    <ol className="relative space-y-4 border-l border-gray-200 pl-5">
      {chronological.map((e) => (
        <TimelineRow key={e.id} entry={e} />
      ))}
    </ol>
  );
}

function TimelineRow({ entry }: { entry: AuditEntry }) {
  const meta = entry.metadata ?? {};
  const reason =
    typeof meta.reason === 'string' ? meta.reason : undefined;
  const documentType =
    typeof meta.documentType === 'string' ? meta.documentType : undefined;
  const version = typeof meta.version === 'number' ? meta.version : undefined;

  return (
    <li className="relative">
      <span
        className={`absolute -left-[27px] mt-1 inline-block h-3 w-3 rounded-full ring-4 ring-white ${DOT_CLASS[entry.action]}`}
        aria-hidden
      />
      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-medium text-gray-900">
          {ACTION_LABEL[entry.action]}
        </span>
        <span className="text-xs text-gray-500">
          by {entry.actorEmail}
          {entry.actorRole && <span className="text-gray-400"> ({entry.actorRole})</span>}
        </span>
        <span className="ml-auto text-xs text-gray-400">
          {new Date(entry.occurredAt).toLocaleString()}
        </span>
      </div>

      {entry.previousState && entry.newState && (
        <div className="mt-1 flex items-center gap-2 text-xs">
          <StateBadge state={entry.previousState as ApplicationState} />
          <span className="text-gray-400">→</span>
          <StateBadge state={entry.newState as ApplicationState} />
        </div>
      )}

      {documentType && (
        <div className="mt-1 text-xs text-gray-600">
          <span className="font-mono">{documentType}</span>
          {version !== undefined && <span> v{version}</span>}
        </div>
      )}

      {reason && (
        <div className="mt-1 rounded bg-gray-50 px-2 py-1 text-xs text-gray-700">
          {reason}
        </div>
      )}
    </li>
  );
}

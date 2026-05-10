'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useMe } from '@/hooks/use-me';
import { Skeleton } from '@/components/skeleton';
import { ErrorState } from '@/components/error-state';
import { EmptyState } from '@/components/empty-state';
import { StateBadge } from '@/components/state-badge';
import type { ApplicationListResponse } from '@/types/application';

/**
 * Applications list — what each role sees here is governed by the API's
 * visibility filter. We don't filter anything client-side.
 *
 *   Applicant → only their own apps.
 *   Reviewer  → their assignments + the queue (SUBMITTED/RESUBMITTED).
 *   Approver  → their decisions + the queue (UNDER_REVIEW).
 *   Admin     → everything.
 *
 * Empty state messaging is role-aware so the user knows whether they're
 * waiting on someone else or whether there's just nothing to do.
 */
export default function ApplicationsListPage() {
  const { data: me } = useMe();
  const { data, error, isLoading, refetch } = useQuery<ApplicationListResponse>({
    queryKey: queryKeys.applications.list(),
    queryFn: () => api<ApplicationListResponse>('/applications'),
  });

  return (
    <div>
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">
          {me?.role === 'APPLICANT' ? 'My applications' :
           me?.role === 'ADMIN' ? 'All applications' : 'Queue'}
        </h1>
        {me?.role === 'APPLICANT' && (
          <Link
            href="/applications/new"
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            New application
          </Link>
        )}
      </header>

      {isLoading ? (
        <Skeleton rows={5} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : !data || data.items.length === 0 ? (
        <EmptyForRole role={me?.role} />
      ) : (
        <div className="overflow-hidden rounded border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Institution</th>
                <th className="px-4 py-3">License type</th>
                <th className="px-4 py-3">State</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.items.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/applications/${a.id}`}
                      className="font-mono text-xs text-blue-700 hover:underline"
                    >
                      {a.referenceCode}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-900">{a.institutionName}</td>
                  <td className="px-4 py-3 text-gray-600">{a.licenseType}</td>
                  <td className="px-4 py-3">
                    <StateBadge state={a.state} />
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {new Date(a.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EmptyForRole({ role }: { role: string | undefined }) {
  if (role === 'APPLICANT') {
    return (
      <EmptyState
        title="You haven't started any applications yet"
        hint="Create one to begin the licensing workflow."
        action={
          <Link
            href="/applications/new"
            className="inline-flex rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            New application
          </Link>
        }
      />
    );
  }
  if (role === 'REVIEWER') {
    return (
      <EmptyState
        title="No applications waiting for review"
        hint="When applicants submit work, it'll appear here."
      />
    );
  }
  if (role === 'APPROVER') {
    return (
      <EmptyState
        title="No applications awaiting your decision"
        hint="Reviewed applications appear here for approval or rejection."
      />
    );
  }
  return <EmptyState title="No applications" />;
}

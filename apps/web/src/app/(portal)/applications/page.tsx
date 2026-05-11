'use client';

import { useState } from 'react';
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

  // Cursor history. Pushing a cursor when "Next" is clicked; popping when
  // "Previous" is clicked. The last entry (or undefined) is the active
  // cursor sent to the API. We deliberately don't sync this to the URL —
  // the cursors are opaque ids, ugly in the address bar, and the user's
  // back-button expectation is "leave the list," not "previous page."
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const activeCursor = cursorStack[cursorStack.length - 1];

  const { data, error, isLoading, refetch } = useQuery<ApplicationListResponse>({
    // Include the cursor in the cache key so each page is cached separately;
    // navigating back to a previous page is instant.
    queryKey: [...queryKeys.applications.list(), activeCursor ?? null],
    queryFn: () =>
      api<ApplicationListResponse>(
        activeCursor
          ? `/applications?cursor=${encodeURIComponent(activeCursor)}`
          : '/applications',
      ),
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
        <>
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

          {/* Cursor pagination footer. We use a stack so "Previous" returns
              to the exact same page (cached) rather than a count-based step
              that could shift under concurrent inserts. */}
          {(cursorStack.length > 0 || data.nextCursor) && (
            <nav
              className="mt-3 flex items-center justify-between text-xs text-gray-600"
              aria-label="Pagination"
            >
              <button
                onClick={() => setCursorStack((s) => s.slice(0, -1))}
                disabled={cursorStack.length === 0}
                className="rounded border border-gray-300 bg-white px-3 py-1 font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ← Previous
              </button>
              <span className="text-gray-400">
                {data.items.length} item{data.items.length === 1 ? '' : 's'}
              </span>
              <button
                onClick={() =>
                  data.nextCursor &&
                  setCursorStack((s) => [...s, data.nextCursor as string])
                }
                disabled={!data.nextCursor}
                className="rounded border border-gray-300 bg-white px-3 py-1 font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next →
              </button>
            </nav>
          )}
        </>
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

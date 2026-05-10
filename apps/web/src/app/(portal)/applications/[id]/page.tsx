'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { Skeleton } from '@/components/skeleton';
import { ErrorState } from '@/components/error-state';
import { StateBadge } from '@/components/state-badge';
import { ApplicationActions } from '@/components/application-actions';
import type { ApplicationDetail } from '@/types/application';

/**
 * Application detail page.
 *
 * Three sections: header (identity + state), parties (applicant/reviewer/
 * approver), and actions. The actions component owns its own data flow
 * (queries /available-actions independently) so the user sees buttons
 * appropriate to their role and the current state — the page itself doesn't
 * need to know workflow rules.
 *
 * `params` is now a Promise in Next 15+. We unwrap it with React.use().
 */
export default function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, error, isLoading, refetch } = useQuery<ApplicationDetail>({
    queryKey: queryKeys.applications.detail(id),
    queryFn: () => api<ApplicationDetail>(`/applications/${id}`),
  });

  if (isLoading) return <Skeleton rows={6} />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <header className="rounded border border-gray-200 bg-white p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="font-mono text-xs text-gray-500">
              {data.referenceCode}
            </div>
            <h1 className="mt-1 text-xl font-semibold text-gray-900">
              {data.institutionName}
            </h1>
            <div className="mt-1 text-sm text-gray-600">{data.licenseType}</div>
          </div>
          <StateBadge state={data.state} />
        </div>

        {data.infoRequestNote && data.state === 'INFO_REQUESTED' && (
          <div className="mt-4 rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p className="font-medium">Reviewer requested:</p>
            <p className="mt-1">{data.infoRequestNote}</p>
          </div>
        )}

        {data.decisionNote && (data.state === 'APPROVED' || data.state === 'REJECTED') && (
          <div
            className={`mt-4 rounded px-3 py-2 text-sm ${
              data.state === 'APPROVED'
                ? 'bg-green-50 text-green-900'
                : 'bg-red-50 text-red-900'
            }`}
          >
            <p className="font-medium">
              {data.state === 'APPROVED' ? 'Approval note' : 'Rejection reason'}
            </p>
            <p className="mt-1">{data.decisionNote}</p>
            {data.decidedAt && (
              <p className="mt-1 text-xs opacity-75">
                Decided {new Date(data.decidedAt).toLocaleString()}
              </p>
            )}
          </div>
        )}
      </header>

      <section className="rounded border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Parties</h2>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Party label="Applicant" name={data.applicant?.fullName} email={data.applicant?.email} />
          <Party label="Reviewer"  name={data.reviewer?.fullName ?? 'Not assigned'}  email={data.reviewer?.email} />
          <Party label="Approver"  name={data.approver?.fullName ?? 'Not assigned'}  email={data.approver?.email} />
        </dl>
      </section>

      <ApplicationActions applicationId={data.id} />
    </div>
  );
}

function Party({
  label,
  name,
  email,
}: {
  label: string;
  name?: string;
  email?: string;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm text-gray-900">{name ?? '—'}</dd>
      {email && <dd className="text-xs text-gray-500">{email}</dd>}
    </div>
  );
}

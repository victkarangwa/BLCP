'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useMe } from '@/hooks/use-me';
import type { ApplicationDetail } from '@/types/application';

/**
 * Create a DRAFT application.
 *
 *   - Applicants only. Backend (RolesGuard) returns 403 for others; we
 *     mirror that with a friendly message so non-applicants don't get a
 *     confusing 403 toast.
 *
 *   - Sends an Idempotency-Key. Per Pattern B from the design: creation
 *     endpoints are the ones where retries can duplicate. Workflow
 *     transitions don't need it (optimistic locking covers that case).
 */
export default function NewApplicationPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [institutionName, setInstitutionName] = useState('');
  const [licenseType, setLicenseType] = useState('COMMERCIAL_BANK');
  // One key per page-mount: retries of the same submit reuse the key
  // (safe replay); a fresh form gets a fresh key.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const create = useMutation({
    mutationFn: () =>
      api<ApplicationDetail>('/applications', {
        method: 'POST',
        body: { institutionName, licenseType },
        idempotencyKey,
      }),
    onSuccess: (app) => {
      qc.invalidateQueries({ queryKey: queryKeys.applications.all });
      router.push(`/applications/${app.id}`);
    },
  });

  if (me && me.role !== 'APPLICANT') {
    return (
      <p className="text-sm text-gray-600">
        Only applicants can create applications.
      </p>
    );
  }

  return (
    <div className="max-w-lg">
      <h1 className="mb-4 text-xl font-semibold text-gray-900">
        New application
      </h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
        className="space-y-4 rounded border border-gray-200 bg-white p-5"
      >
        <label className="block">
          <span className="block text-sm font-medium text-gray-700">
            Institution name
          </span>
          <input
            type="text"
            required
            minLength={2}
            maxLength={200}
            value={institutionName}
            onChange={(e) => setInstitutionName(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>

        <label className="block">
          <span className="block text-sm font-medium text-gray-700">
            License type
          </span>
          <select
            value={licenseType}
            onChange={(e) => setLicenseType(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="COMMERCIAL_BANK">Commercial bank</option>
            <option value="MICROFINANCE">Microfinance</option>
            <option value="FOREX_BUREAU">Forex bureau</option>
            <option value="MOBILE_MONEY_OPERATOR">Mobile money operator</option>
          </select>
        </label>

        {create.error instanceof ApiError && (
          <p className="text-sm text-red-700">{create.error.message}</p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {create.isPending ? 'Creating…' : 'Create draft'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/applications')}
            className="rounded px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

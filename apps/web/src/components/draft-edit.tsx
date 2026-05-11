'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/**
 * Inline edit form for a DRAFT application's institutionName + licenseType.
 *
 *   - Shown only when the parent decides — typically when state === DRAFT
 *     and the current user is the applicant. The PATCH endpoint enforces
 *     the same rules; the UI just mirrors them so we don't tempt users
 *     with controls that would 409.
 *
 *   - Two-step UI: read-only fields by default; "Edit" button toggles into
 *     the form. Keeps the page calm in the common (read) case.
 *
 *   - On save we invalidate the application detail. The list query is
 *     covered by the parent's broader invalidations on workflow actions —
 *     here we don't change state, just content.
 */
export function DraftEdit({
  applicationId,
  initialInstitutionName,
  initialLicenseType,
}: {
  applicationId: string;
  initialInstitutionName: string;
  initialLicenseType: string;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [institutionName, setInstitutionName] = useState(initialInstitutionName);
  const [licenseType, setLicenseType] = useState(initialLicenseType);

  const update = useMutation({
    mutationFn: () =>
      api(`/applications/${applicationId}`, {
        method: 'PATCH',
        body: { institutionName, licenseType },
      }),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: queryKeys.applications.detail(applicationId),
      });
      qc.invalidateQueries({ queryKey: queryKeys.applications.all });
      setEditing(false);
    },
  });

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="text-xs font-medium text-blue-700 hover:underline"
      >
        Edit
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        update.mutate();
      }}
      className="mt-3 grid grid-cols-1 gap-3 rounded border border-blue-200 bg-blue-50/40 p-3 sm:grid-cols-2"
    >
      <label className="block">
        <span className="block text-xs font-medium text-gray-700">
          Institution name
        </span>
        <input
          type="text" required minLength={2} maxLength={200}
          value={institutionName}
          onChange={(e) => setInstitutionName(e.target.value)}
          className="mt-1 block w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-gray-700">
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

      {update.error instanceof ApiError && (
        <p className="col-span-full text-xs text-red-700">
          {update.error.message}
        </p>
      )}

      <div className="col-span-full flex gap-2">
        <button
          type="submit"
          disabled={update.isPending}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {update.isPending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setInstitutionName(initialInstitutionName);
            setLicenseType(initialLicenseType);
          }}
          className="rounded px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
